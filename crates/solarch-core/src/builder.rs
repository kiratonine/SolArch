//! In-memory builder independent of the pending production `.slr` crypto profile.
//! The caller supplies validated metadata and borrowed chunks, retains the session
//! and its Content Key, and is responsible for authorized key custody. This API
//! deliberately has no output-file or external fingerprint encoding yet.
use crate::{
    crypto::{ContentKey, EncryptedMessage, EncryptionSession},
    fingerprint::digest_bytes,
    format::PublicHeader,
    manifest::Manifest,
    Error, Result,
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub struct ArchiveBuilder;
pub const MAX_IN_MEMORY_CONTENT_BYTES: usize = 64 * 1024 * 1024;
pub struct PreparedInput<'a> {
    pub header: PublicHeader,
    pub manifest: Manifest,
    /// Global chunk IDs correspond to positions in this slice.
    pub chunks: &'a [&'a [u8]],
}

/// No plaintext protected metadata is retained here; no wire serialization exists.
pub struct InMemoryArchive {
    header: PublicHeader,
    context: Vec<u8>,
    manifest: EncryptedMessage,
    index: EncryptedMessage,
    chunks: Vec<EncryptedMessage>,
    file_count: usize,
    encrypted_size_bytes: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChunkRecord {
    size: usize,
    digest: [u8; 32],
}

impl ArchiveBuilder {
    pub fn build_in_memory(
        input: PreparedInput<'_>,
        session: &mut EncryptionSession,
    ) -> Result<InMemoryArchive> {
        input.header.validate()?;
        if input.header.crypto.content_algorithm != "XChaCha20-Poly1305" {
            return Err(Error::InvalidHeader);
        }
        input
            .manifest
            .validate(&input.header.archive_id, input.chunks.len() as u64)?;
        if input.chunks.len() > crate::chunks::MAX_CHUNKS {
            return Err(Error::LimitExceeded);
        }
        let total = input.chunks.iter().try_fold(0_usize, |size, chunk| {
            size.checked_add(chunk.len()).ok_or(Error::LimitExceeded)
        })?;
        if total > MAX_IN_MEMORY_CONTENT_BYTES {
            return Err(Error::LimitExceeded);
        }
        let mut records = Vec::with_capacity(input.chunks.len());
        for chunk in input.chunks {
            if chunk.is_empty() || chunk.len() > input.header.crypto.chunk_size as usize {
                return Err(Error::InvalidChunkMetadata);
            }
            records.push(ChunkRecord {
                size: chunk.len(),
                digest: digest_bytes(chunk),
            });
        }
        validate_sizes(&input.manifest, &records)?;
        let context = serde_json::to_vec(&input.header).map_err(|_| Error::Serialization)?;
        let manifest_bytes =
            Zeroizing::new(serde_json::to_vec(&input.manifest).map_err(|_| Error::Serialization)?);
        let index_bytes =
            Zeroizing::new(serde_json::to_vec(&records).map_err(|_| Error::Serialization)?);
        let manifest = session.encrypt(&manifest_bytes, &aad(&context, b"manifest", 0))?;
        let index = session.encrypt(&index_bytes, &aad(&context, b"index", 0))?;
        let mut chunks = Vec::with_capacity(input.chunks.len());
        for (id, plaintext) in input.chunks.iter().enumerate() {
            chunks.push(session.encrypt(plaintext, &aad(&context, b"chunk", id))?);
        }
        let encrypted_size_bytes = chunks.iter().try_fold(
            manifest.ciphertext_len() + index.ciphertext_len(),
            |size, chunk| {
                size.checked_add(chunk.ciphertext_len())
                    .ok_or(Error::LimitExceeded)
            },
        )?;
        Ok(InMemoryArchive {
            header: input.header,
            context,
            manifest,
            index,
            chunks,
            file_count: input.manifest.files.len(),
            encrypted_size_bytes,
        })
    }
}

impl InMemoryArchive {
    pub fn public_header(&self) -> &PublicHeader {
        &self.header
    }
    pub fn file_count(&self) -> usize {
        self.file_count
    }
    /// Ciphertext byte count only, not the size of a serialized `.slr`.
    pub fn encrypted_size_bytes(&self) -> usize {
        self.encrypted_size_bytes
    }

    pub fn decrypt_manifest(&self, key: &ContentKey) -> Result<Manifest> {
        let bytes = key.decrypt(&self.manifest, &aad(&self.context, b"manifest", 0))?;
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| Error::InvalidManifest)?;
        manifest.validate(&self.header.archive_id, self.chunks.len() as u64)?;
        let records = self.decrypt_index(key)?;
        validate_sizes(&manifest, &records)?;
        Ok(manifest)
    }

    fn decrypt_index(&self, key: &ContentKey) -> Result<Vec<ChunkRecord>> {
        let bytes = key.decrypt(&self.index, &aad(&self.context, b"index", 0))?;
        let records: Vec<ChunkRecord> =
            serde_json::from_slice(&bytes).map_err(|_| Error::InvalidChunkMetadata)?;
        if records.len() != self.chunks.len()
            || records
                .iter()
                .any(|r| r.size == 0 || r.size > self.header.crypto.chunk_size as usize)
        {
            return Err(Error::InvalidChunkMetadata);
        }
        Ok(records)
    }

    pub fn decrypt_chunk(&self, key: &ContentKey, id: usize) -> Result<Zeroizing<Vec<u8>>> {
        let chunk = self.chunks.get(id).ok_or(Error::OutOfBounds)?;
        let records = self.decrypt_index(key)?;
        let record = records.get(id).ok_or(Error::InvalidChunkMetadata)?;
        let bytes = key.decrypt(chunk, &aad(&self.context, b"chunk", id))?;
        if bytes.len() != record.size || digest_bytes(&bytes) != record.digest {
            return Err(Error::IntegrityMismatch);
        }
        Ok(bytes)
    }
}

fn validate_sizes(manifest: &Manifest, records: &[ChunkRecord]) -> Result<()> {
    for file in &manifest.files {
        let mut size = 0_u64;
        for &id in &file.chunks {
            let index = usize::try_from(id).map_err(|_| Error::OutOfBounds)?;
            size = size
                .checked_add(records.get(index).ok_or(Error::InvalidChunkMetadata)?.size as u64)
                .ok_or(Error::OutOfBounds)?;
        }
        if size != file.size_bytes {
            return Err(Error::InvalidChunkMetadata);
        }
    }
    Ok(())
}

fn aad(context: &[u8], purpose: &[u8], id: usize) -> Vec<u8> {
    let mut bytes = b"SolArch in-memory builder\0".to_vec();
    bytes.extend_from_slice(&(context.len() as u64).to_le_bytes());
    bytes.extend_from_slice(context);
    bytes.extend_from_slice(purpose);
    bytes.extend_from_slice(&(id as u64).to_le_bytes());
    bytes
}

#[cfg(test)]
#[path = "builder_fixture_tests.rs"]
mod fixture_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        manifest::{ManifestFile, ViewerPolicy},
        paths::NormalizedPath,
    };
    pub(super) fn header() -> PublicHeader {
        serde_json::from_str(r#"{"format":"solarch","version":"1.0.0","archive_id":"arc_test","created_at":"2026-09-07T00:00:00Z","title":"Synthetic fixture","creator_wallet":"test-only-wallet","commercial_snapshot":{"price_amount":"10.00","price_currency":"USDC","platform_fee_bps":500},"license_snapshot":{"max_devices":1,"allow_export":false,"watermark_enabled":true},"backend":{"archive_api_id":"arc_test"},"crypto":{"content_algorithm":"XChaCha20-Poly1305","chunk_size":1048576}}"#).unwrap()
    }
    pub(super) fn manifest() -> Manifest {
        Manifest {
            archive_id: "arc_test".into(),
            files: vec![ManifestFile {
                file_id: "file1".into(),
                path: NormalizedPath::new("private/a.pdf").unwrap(),
                display_name: "a.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: 6,
                hash: "test-only-opaque-hash".into(),
                chunks: vec![0, 1],
                viewer_policy: ViewerPolicy::default(),
            }],
        }
    }
    fn build(session: &mut EncryptionSession) -> InMemoryArchive {
        ArchiveBuilder::build_in_memory(
            PreparedInput {
                header: header(),
                manifest: manifest(),
                chunks: &[b"abc", b"def"],
            },
            session,
        )
        .unwrap()
    }
    #[test]
    fn end_to_end_in_memory_builder_multichunk() {
        let mut session = EncryptionSession::new().unwrap();
        let archive = build(&mut session);
        assert_eq!(archive.file_count(), 1);
        assert!(archive.encrypted_size_bytes() > 6);
        let recovered = archive.decrypt_manifest(session.key()).unwrap();
        assert_eq!(recovered.files[0].path.as_str(), "private/a.pdf");
        let mut bytes = Vec::new();
        for id in &recovered.files[0].chunks {
            bytes.extend_from_slice(&archive.decrypt_chunk(session.key(), *id as usize).unwrap());
        }
        assert_eq!(bytes, b"abcdef");
        assert!(archive
            .decrypt_manifest(&ContentKey::generate().unwrap())
            .is_err());
        assert!(archive.decrypt_chunk(session.key(), usize::MAX).is_err());
    }
    #[test]
    fn manifest_index_swap_chunk_swap_and_header_mutation_rejected() {
        let mut session = EncryptionSession::new().unwrap();
        let mut archive = build(&mut session);
        std::mem::swap(&mut archive.manifest, &mut archive.index);
        assert!(archive.decrypt_manifest(session.key()).is_err());
        std::mem::swap(&mut archive.manifest, &mut archive.index);
        archive.chunks.swap(0, 1);
        assert!(archive.decrypt_chunk(session.key(), 0).is_err());
        archive.context.push(1);
        assert!(archive.decrypt_manifest(session.key()).is_err());
    }
    #[test]
    fn chunk_sizes_must_match_manifest() {
        let mut session = EncryptionSession::new().unwrap();
        assert!(ArchiveBuilder::build_in_memory(
            PreparedInput {
                header: header(),
                manifest: manifest(),
                chunks: &[b"ab", b"de"]
            },
            &mut session
        )
        .is_err());
    }
}
