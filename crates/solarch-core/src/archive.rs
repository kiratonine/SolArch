//! Production `.slr` v1 builder and verification boundary.

use std::{
    ffi::OsString,
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{
    format::{self, PublicHeader, PRELUDE_LEN},
    manifest::{Manifest, ManifestFile, ViewerPolicy},
    production_crypto::{
        decode_idx1, decrypt_chunk, decrypt_index, decrypt_manifest, derive_keys, encode_idx1,
        encrypt_chunk, encrypt_index, encrypt_manifest, header_hash, lowercase_hex,
        signing_message, validate_dat1_layout, ArchiveContentKey, DerivedKeys, IndexRecord,
        SignatureBlock, SignaturePrefix, MAX_FINALIZED_ARCHIVE_BYTES, SIGNATURE_BLOCK_BYTES,
        SIGNATURE_PREFIX_BYTES,
    },
    source::{SourceFile, SourceInventory},
    Error, Result,
};

#[derive(Debug)]
pub struct BuildRequest<'a> {
    pub input_dir: &'a Path,
    pub metadata_path: &'a Path,
    pub output_path: &'a Path,
    pub signing_key_id: &'a str,
    pub signing_public_key: [u8; 32],
    pub archive_content_key: &'a ArchiveContentKey,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingBuildResult {
    pub signing_digest: [u8; 32],
    pub file_count: usize,
    pub size_bytes: u64,
    pub pending_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FinalBuildResult {
    pub output_path: PathBuf,
    pub archive_fingerprint: String,
    pub file_count: usize,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingVerification {
    pub signing_digest: String,
    pub file_count: usize,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FinalVerification {
    pub archive_fingerprint: String,
    pub size_bytes: u64,
    pub signing_key_id: String,
    pub protected_content_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedArchive {
    pub public_header: PublicHeader,
    pub archive_fingerprint: String,
    pub size_bytes: u64,
    pub signing_key_id: String,
    /// Opaque identity of the exact file object verified while entering Locked.
    pub file_identity: VerifiedFileIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedFileIdentity(FileIdentity);

/// Maximum plaintext returned by one internal protected range request.
pub const MAX_PROTECTED_READ_BYTES: u64 = 4 * 1024 * 1024;

/// Authenticated, lazy protected-content view over the exact archive verified
/// while entering Locked. Secret-derived keys never leave this Rust value.
pub struct ProtectedArchiveReader {
    path: PathBuf,
    file: File,
    identity: FileIdentity,
    header_hash: [u8; 32],
    keys: DerivedKeys,
    manifest: Manifest,
    records: Vec<IndexRecord>,
    data_range: std::ops::Range<usize>,
}

impl std::fmt::Debug for ProtectedArchiveReader {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProtectedArchiveReader")
            .field("path", &self.path)
            .field("file_count", &self.manifest.files.len())
            .field("keys", &"[REDACTED]")
            .finish()
    }
}

pub struct PendingBuild {
    result: PendingBuildResult,
    output_path: PathBuf,
    signing_key_id: String,
    verifying_key: VerifyingKey,
    pending_identity: FileIdentity,
    completed: bool,
}

impl std::fmt::Debug for PendingBuild {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PendingBuild")
            .field("result", &self.result)
            .field("output_path", &self.output_path)
            .field("completed", &self.completed)
            .finish_non_exhaustive()
    }
}

impl Drop for PendingBuild {
    fn drop(&mut self) {
        if !self.completed {
            remove_if_same(&self.result.pending_path, &self.pending_identity);
        }
    }
}

pub struct ArchiveBuilder;

impl ArchiveBuilder {
    pub fn prepare(request: BuildRequest<'_>) -> Result<PendingBuild> {
        if request.output_path.as_os_str().is_empty()
            || fs::symlink_metadata(request.output_path).is_ok()
        {
            return Err(Error::InvalidBuilderInput);
        }
        let pending_path = pending_path(request.output_path);
        if fs::symlink_metadata(&pending_path).is_ok() {
            return Err(Error::InvalidBuilderInput);
        }
        let metadata_bytes = read_bounded(request.metadata_path, format::MAX_HEADER as u64)?;
        let header = format::parse_header(&metadata_bytes)?;
        let inventory = SourceInventory::discover(request.input_dir)?;
        let (manifest, records) = build_manifest_and_records(&header, &inventory)?;
        let manifest_bytes =
            Zeroizing::new(manifest.to_jcs(&header.archive_id, records.len() as u64)?);
        let header_digest = header_hash(&metadata_bytes);
        let keys = derive_keys(&metadata_bytes, request.archive_content_key)?;
        let encrypted_manifest = encrypt_manifest(&keys, &header_digest, &manifest_bytes)?;
        let index_bytes = Zeroizing::new(encode_idx1(&records)?);
        let encrypted_index = encrypt_index(&keys, &header_digest, &index_bytes)?;
        let data_length = records.iter().try_fold(8_u64, |total, record| {
            total
                .checked_add(record.ciphertext_length as u64)
                .ok_or(Error::LimitExceeded)
        })?;
        let prefix = SignaturePrefix::new(request.signing_key_id)?;
        let prelude = format::encode_prelude([
            metadata_bytes.len() as u64,
            encrypted_manifest.len() as u64,
            encrypted_index.len() as u64,
            data_length,
            SIGNATURE_BLOCK_BYTES as u64,
        ])?;
        let declared_size = format::declared_size(&prelude)?;
        if declared_size > MAX_FINALIZED_ARCHIVE_BYTES {
            return Err(Error::LimitExceeded);
        }

        let mut pending = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending_path)
            .map_err(|_| Error::Io)?;
        let build_result = (|| {
            pending.write_all(&prelude).map_err(|_| Error::Io)?;
            pending.write_all(&metadata_bytes).map_err(|_| Error::Io)?;
            pending
                .write_all(&encrypted_manifest)
                .map_err(|_| Error::Io)?;
            pending.write_all(&encrypted_index).map_err(|_| Error::Io)?;
            pending.write_all(b"DAT1").map_err(|_| Error::Io)?;
            pending
                .write_all(&(records.len() as u32).to_le_bytes())
                .map_err(|_| Error::Io)?;
            stream_encrypted_chunks(
                &inventory,
                &manifest,
                &records,
                &keys,
                &header_digest,
                &mut pending,
            )?;
            pending.write_all(&prefix.encode()).map_err(|_| Error::Io)?;
            pending.sync_all().map_err(|_| Error::Io)?;
            let physical = pending.metadata().map_err(|_| Error::Io)?.len();
            if physical.checked_add(64) != Some(declared_size) {
                return Err(Error::OutOfBounds);
            }
            drop(pending);
            let signing_digest = digest_exact_file(&pending_path, physical)?;
            Ok(PendingBuildResult {
                signing_digest,
                file_count: inventory.files().len(),
                size_bytes: declared_size,
                pending_path: pending_path.clone(),
            })
        })();
        let result = match build_result {
            Ok(result) => result,
            Err(error) => {
                let _ = fs::remove_file(&pending_path);
                return Err(error);
            }
        };
        let verifying_key = VerifyingKey::from_bytes(&request.signing_public_key)
            .map_err(|_| Error::SignatureFailure)?;
        let pending_identity = FileIdentity::from_path(&pending_path)?;
        Ok(PendingBuild {
            result,
            output_path: request.output_path.to_path_buf(),
            signing_key_id: request.signing_key_id.to_owned(),
            verifying_key,
            pending_identity,
            completed: false,
        })
    }
}

impl PendingBuild {
    pub fn result(&self) -> &PendingBuildResult {
        &self.result
    }

    pub fn accept_signature(mut self, signature_bytes: [u8; 64]) -> Result<FinalBuildResult> {
        let signature = Signature::from_bytes(&signature_bytes);
        self.verifying_key
            .verify_strict(&signing_message(&self.result.signing_digest), &signature)
            .map_err(|_| Error::SignatureFailure)?;
        let current_digest = digest_exact_file(
            &self.result.pending_path,
            self.result
                .size_bytes
                .checked_sub(64)
                .ok_or(Error::OutOfBounds)?,
        )?;
        if current_digest != self.result.signing_digest {
            return Err(Error::IntegrityMismatch);
        }
        self.pending_identity
            .verify_path(&self.result.pending_path)?;
        let mut file = OpenOptions::new()
            .append(true)
            .open(&self.result.pending_path)
            .map_err(|_| Error::Io)?;
        file.write_all(&signature_bytes).map_err(|_| Error::Io)?;
        file.sync_all().map_err(|_| Error::Io)?;
        drop(file);
        self.pending_identity = FileIdentity::from_path(&self.result.pending_path)?;
        let verified = verify_finalized(
            &self.result.pending_path,
            &self.signing_key_id,
            self.verifying_key.to_bytes(),
        )?;
        if verified.size_bytes != self.result.size_bytes {
            return Err(Error::IntegrityMismatch);
        }
        self.pending_identity
            .verify_path(&self.result.pending_path)?;
        fs::hard_link(&self.result.pending_path, &self.output_path).map_err(|_| Error::Io)?;
        if let Err(error) = self.pending_identity.verify_path(&self.output_path) {
            remove_if_same(&self.output_path, &self.pending_identity);
            return Err(error);
        }
        if fs::remove_file(&self.result.pending_path).is_err() {
            remove_if_same(&self.output_path, &self.pending_identity);
            return Err(Error::Io);
        }
        self.completed = true;
        Ok(FinalBuildResult {
            output_path: self.output_path.clone(),
            archive_fingerprint: verified.archive_fingerprint,
            file_count: self.result.file_count,
            size_bytes: verified.size_bytes,
        })
    }
}

pub fn verify_finalized(
    path: &Path,
    expected_key_id: &str,
    public_key: [u8; 32],
) -> Result<FinalVerification> {
    let (mut file, ranges, size, identity) = open_layout(path, false)?;
    let result = verify_finalized_open(&mut file, &ranges, size, expected_key_id, public_key)?;
    identity.verify(path, &file)?;
    Ok(result)
}

/// Returns the untrusted SIG1 key ID used only to select an archive-role trust
/// anchor. Callers must then verify the archive with that exact trusted key.
pub fn inspect_signing_key_id(path: &Path) -> Result<String> {
    let (mut file, ranges, _, identity) = open_layout(path, false)?;
    let prefix_range = ranges[4].start..ranges[4].start + SIGNATURE_PREFIX_BYTES;
    let prefix = read_range(&mut file, &prefix_range)?;
    let key_id = SignaturePrefix::parse(&prefix)?.key_id().to_owned();
    identity.verify(path, &file)?;
    Ok(key_id)
}

/// Authenticates the finalized bytes and returns header metadata read from the
/// same stable file handle. No unverified header value is returned on failure.
pub fn verify_archive(
    path: &Path,
    expected_key_id: &str,
    public_key: [u8; 32],
) -> Result<VerifiedArchive> {
    let (mut file, ranges, size, identity) = open_layout(path, false)?;
    let verification =
        verify_finalized_open(&mut file, &ranges, size, expected_key_id, public_key)?;
    let header = format::parse_header(&read_range(&mut file, &ranges[0])?)?;
    identity.verify(path, &file)?;
    Ok(VerifiedArchive {
        public_header: header,
        archive_fingerprint: verification.archive_fingerprint,
        size_bytes: verification.size_bytes,
        signing_key_id: verification.signing_key_id,
        file_identity: VerifiedFileIdentity(identity),
    })
}

impl ProtectedArchiveReader {
    pub fn open(
        path: &Path,
        expected_key_id: &str,
        public_key: [u8; 32],
        expected_fingerprint: &str,
        expected_identity: &VerifiedFileIdentity,
        ack: &ArchiveContentKey,
    ) -> Result<Self> {
        let (mut file, ranges, size, identity) = open_layout(path, false)?;
        if identity != expected_identity.0 {
            return Err(Error::IntegrityMismatch);
        }
        let verification =
            verify_finalized_open(&mut file, &ranges, size, expected_key_id, public_key)?;
        if verification.archive_fingerprint != expected_fingerprint {
            return Err(Error::IntegrityMismatch);
        }

        let header_bytes = read_range(&mut file, &ranges[0])?;
        let header = format::parse_header(&header_bytes)?;
        let digest = header_hash(&header_bytes);
        let keys = derive_keys(&header_bytes, ack)?;
        let index_plaintext = decrypt_index(&keys, &digest, &read_range(&mut file, &ranges[2])?)?;
        let records = decode_idx1(&index_plaintext)?;
        let manifest_plaintext =
            decrypt_manifest(&keys, &digest, &read_range(&mut file, &ranges[1])?)?;
        let manifest = Manifest::parse_exact(
            &manifest_plaintext,
            &header.archive_id,
            records.len() as u64,
        )?;
        validate_manifest_record_lengths(&manifest, &records)?;
        let prefix_end = ranges[3].start.checked_add(8).ok_or(Error::OutOfBounds)?;
        let prefix = read_range(&mut file, &(ranges[3].start..prefix_end))?;
        validate_dat1_layout(&prefix, ranges[3].len() as u64, &records)?;
        identity.verify(path, &file)?;

        Ok(Self {
            path: path.to_path_buf(),
            file,
            identity,
            header_hash: digest,
            keys,
            manifest,
            records,
            data_range: ranges[3].clone(),
        })
    }

    pub fn files(&self) -> &[ManifestFile] {
        &self.manifest.files
    }

    pub fn read_file_range(
        &mut self,
        file_id: &str,
        offset: u64,
        length: u64,
    ) -> Result<Zeroizing<Vec<u8>>> {
        if length > MAX_PROTECTED_READ_BYTES {
            return Err(Error::LimitExceeded);
        }
        let manifest_file = self
            .manifest
            .files
            .iter()
            .find(|candidate| candidate.file_id == file_id)
            .ok_or(Error::InvalidManifest)?;
        let end = offset.checked_add(length).ok_or(Error::OutOfBounds)?;
        if end > manifest_file.size_bytes {
            return Err(Error::OutOfBounds);
        }
        self.identity.verify(&self.path, &self.file)?;
        if length == 0 {
            return Ok(Zeroizing::new(Vec::new()));
        }

        let output_len = usize::try_from(length).map_err(|_| Error::LimitExceeded)?;
        let mut output = Zeroizing::new(Vec::with_capacity(output_len));
        let first = offset / crate::manifest::CHUNK_SIZE;
        let last = (end - 1) / crate::manifest::CHUNK_SIZE;
        for file_chunk_index in first..=last {
            let manifest_index =
                usize::try_from(file_chunk_index).map_err(|_| Error::InvalidChunkMetadata)?;
            let chunk_id = *manifest_file
                .chunks
                .get(manifest_index)
                .ok_or(Error::InvalidChunkMetadata)?;
            let record_index = usize::try_from(chunk_id).map_err(|_| Error::OutOfBounds)?;
            let record = self
                .records
                .get(record_index)
                .ok_or(Error::InvalidChunkMetadata)?;
            let ciphertext_start = u64::try_from(self.data_range.start)
                .map_err(|_| Error::OutOfBounds)?
                .checked_add(record.offset)
                .ok_or(Error::OutOfBounds)?;
            self.file
                .seek(SeekFrom::Start(ciphertext_start))
                .map_err(|_| Error::Io)?;
            let mut ciphertext = vec![0_u8; record.ciphertext_length as usize];
            self.file.read_exact(&mut ciphertext).map_err(map_read)?;
            let plaintext = decrypt_chunk(
                &self.keys,
                &self.header_hash,
                chunk_id,
                record.plaintext_length,
                &ciphertext,
            )?;

            let chunk_file_start = file_chunk_index
                .checked_mul(crate::manifest::CHUNK_SIZE)
                .ok_or(Error::OutOfBounds)?;
            let chunk_file_end = chunk_file_start
                .checked_add(record.plaintext_length as u64)
                .ok_or(Error::OutOfBounds)?;
            let copy_start = offset.max(chunk_file_start);
            let copy_end = end.min(chunk_file_end);
            let local_start =
                usize::try_from(copy_start - chunk_file_start).map_err(|_| Error::OutOfBounds)?;
            let local_end =
                usize::try_from(copy_end - chunk_file_start).map_err(|_| Error::OutOfBounds)?;
            output.extend_from_slice(
                plaintext
                    .get(local_start..local_end)
                    .ok_or(Error::OutOfBounds)?,
            );
        }
        if output.len() != output_len {
            return Err(Error::IntegrityMismatch);
        }
        self.identity.verify(&self.path, &self.file)?;
        Ok(output)
    }

    /// Reassembles one authenticated file for a format-specific parser. This is
    /// intentionally an internal Core API, not a generic Viewer IPC command.
    /// Every chunk is AEAD-authenticated and the complete Manifest hash is
    /// checked before the plaintext is returned.
    pub fn read_complete_file_bounded(
        &mut self,
        file_id: &str,
        maximum: u64,
    ) -> Result<Zeroizing<Vec<u8>>> {
        let manifest_file = self
            .manifest
            .files
            .iter()
            .find(|candidate| candidate.file_id == file_id)
            .ok_or(Error::InvalidManifest)?;
        if manifest_file.size_bytes > maximum {
            return Err(Error::LimitExceeded);
        }
        let size_bytes = manifest_file.size_bytes;
        let expected_hash = manifest_file.hash.clone();
        let capacity = usize::try_from(size_bytes).map_err(|_| Error::LimitExceeded)?;
        let mut output = Zeroizing::new(Vec::with_capacity(capacity));
        let mut offset = 0_u64;
        while offset < size_bytes {
            let length = (size_bytes - offset).min(MAX_PROTECTED_READ_BYTES);
            let range = self.read_file_range(file_id, offset, length)?;
            output.extend_from_slice(&range);
            offset = offset.checked_add(length).ok_or(Error::OutOfBounds)?;
        }
        if output.len() != capacity || lowercase_hex(&Sha256::digest(&*output)) != expected_hash {
            return Err(Error::IntegrityMismatch);
        }
        Ok(output)
    }
}

/// Verifies the finalized signature/fingerprint and, with the caller-owned ACK,
/// independently authenticates and reconstructs every protected source file.
pub fn verify_finalized_with_content(
    path: &Path,
    input_dir: &Path,
    metadata_path: &Path,
    expected_key_id: &str,
    public_key: [u8; 32],
    ack: &ArchiveContentKey,
) -> Result<FinalVerification> {
    let (mut file, ranges, size, identity) = open_layout(path, false)?;
    let mut result = verify_finalized_open(&mut file, &ranges, size, expected_key_id, public_key)?;
    verify_protected_contents(
        &mut file,
        &ranges,
        input_dir,
        metadata_path,
        expected_key_id,
        ack,
    )?;
    identity.verify(path, &file)?;
    result.protected_content_verified = true;
    Ok(result)
}

fn verify_finalized_open(
    file: &mut File,
    ranges: &[std::ops::Range<usize>; 5],
    size: u64,
    expected_key_id: &str,
    public_key: [u8; 32],
) -> Result<FinalVerification> {
    let (digest, fingerprint, signature_bytes) =
        hash_finalized_once(file, size, ranges[4].start as u64)?;
    let block = SignatureBlock::parse(&signature_bytes)?;
    if block.prefix.key_id() != expected_key_id {
        return Err(Error::SignatureFailure);
    }
    let key = VerifyingKey::from_bytes(&public_key).map_err(|_| Error::SignatureFailure)?;
    key.verify_strict(
        &signing_message(&digest),
        &Signature::from_bytes(&block.signature),
    )
    .map_err(|_| Error::SignatureFailure)?;
    Ok(FinalVerification {
        archive_fingerprint: fingerprint,
        size_bytes: size,
        signing_key_id: block.prefix.key_id().to_owned(),
        protected_content_verified: false,
    })
}

fn hash_finalized_once(
    file: &mut File,
    size: u64,
    signature_offset: u64,
) -> Result<([u8; 32], String, [u8; SIGNATURE_BLOCK_BYTES])> {
    if size > MAX_FINALIZED_ARCHIVE_BYTES
        || signature_offset.checked_add(SIGNATURE_BLOCK_BYTES as u64) != Some(size)
    {
        return Err(Error::OutOfBounds);
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| Error::Io)?;
    let covered_end = signature_offset + SIGNATURE_PREFIX_BYTES as u64;
    let mut covered = Sha256::new();
    let mut whole = Sha256::new();
    let mut signature = [0_u8; SIGNATURE_BLOCK_BYTES];
    let mut position = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    while position < size {
        let requested = (size - position).min(buffer.len() as u64) as usize;
        file.read_exact(&mut buffer[..requested])
            .map_err(map_read)?;
        whole.update(&buffer[..requested]);
        if position < covered_end {
            let count = (covered_end - position).min(requested as u64) as usize;
            covered.update(&buffer[..count]);
        }
        let block_start = position.max(signature_offset);
        let block_end = (position + requested as u64).min(size);
        if block_start < block_end {
            let source_start = (block_start - position) as usize;
            let target_start = (block_start - signature_offset) as usize;
            let count = (block_end - block_start) as usize;
            signature[target_start..target_start + count]
                .copy_from_slice(&buffer[source_start..source_start + count]);
        }
        position += requested as u64;
    }
    let mut trailing = [0_u8; 1];
    if file.read(&mut trailing).map_err(|_| Error::Io)? != 0 {
        return Err(Error::OutOfBounds);
    }
    Ok((
        covered.finalize().into(),
        lowercase_hex(&whole.finalize()),
        signature,
    ))
}

pub fn verify_pending(
    pending_path: &Path,
    input_dir: &Path,
    metadata_path: &Path,
    expected_key_id: &str,
    ack: &ArchiveContentKey,
) -> Result<PendingVerification> {
    let (mut file, ranges, declared_size, identity) = open_layout(pending_path, true)?;
    let file_count = verify_protected_contents(
        &mut file,
        &ranges,
        input_dir,
        metadata_path,
        expected_key_id,
        ack,
    )?;
    let physical = declared_size.checked_sub(64).ok_or(Error::OutOfBounds)?;
    let digest = digest_prefix(&mut file, physical)?;
    identity.verify(pending_path, &file)?;
    Ok(PendingVerification {
        signing_digest: lowercase_hex(&digest),
        file_count,
        size_bytes: declared_size,
    })
}

fn verify_protected_contents(
    file: &mut File,
    ranges: &[std::ops::Range<usize>; 5],
    input_dir: &Path,
    metadata_path: &Path,
    expected_key_id: &str,
    ack: &ArchiveContentKey,
) -> Result<usize> {
    let expected_metadata = read_bounded(metadata_path, format::MAX_HEADER as u64)?;
    format::parse_header(&expected_metadata)?;
    let header_bytes = read_range(file, &ranges[0])?;
    if header_bytes != expected_metadata {
        return Err(Error::IntegrityMismatch);
    }
    let header = format::parse_header(&header_bytes)?;
    let prefix_range = ranges[4].start..ranges[4].start + 40;
    let signature_prefix = read_range(file, &prefix_range)?;
    if SignaturePrefix::parse(&signature_prefix)?.key_id() != expected_key_id {
        return Err(Error::SignatureFailure);
    }
    let hash = header_hash(&header_bytes);
    let keys = derive_keys(&header_bytes, ack)?;
    let encrypted_index = read_range(file, &ranges[2])?;
    let index_plaintext = decrypt_index(&keys, &hash, &encrypted_index)?;
    let records = decode_idx1(&index_plaintext)?;
    let encrypted_manifest = read_range(file, &ranges[1])?;
    let manifest_plaintext = decrypt_manifest(&keys, &hash, &encrypted_manifest)?;
    let manifest = Manifest::parse_exact(
        &manifest_plaintext,
        &header.archive_id,
        records.len() as u64,
    )?;
    validate_data_and_manifest(file, &ranges[3], &records, &manifest, &keys, &hash)?;
    validate_source_inventory(input_dir, &manifest)?;
    Ok(manifest.files.len())
}

fn build_manifest_and_records(
    header: &PublicHeader,
    inventory: &SourceInventory,
) -> Result<(Manifest, Vec<IndexRecord>)> {
    let mut files = Vec::with_capacity(inventory.files().len());
    let mut records = Vec::new();
    let mut data_offset = 8_u64;
    for (ordinal, source) in inventory.files().iter().enumerate() {
        let mut handle = source.open_verified()?;
        let (hash, read_size) =
            crate::production_crypto::sha256_reader(&mut handle, source.size_bytes())?;
        if read_size != source.size_bytes() {
            return Err(Error::InvalidBuilderInput);
        }
        source.verify_unchanged(&handle)?;
        let mut remaining = source.size_bytes();
        let mut chunks = Vec::new();
        while remaining != 0 {
            let plaintext = remaining.min(crate::manifest::CHUNK_SIZE) as u32;
            let ciphertext = plaintext.checked_add(16).ok_or(Error::LimitExceeded)?;
            let id = records.len() as u64;
            chunks.push(id);
            records.push(IndexRecord {
                offset: data_offset,
                ciphertext_length: ciphertext,
                plaintext_length: plaintext,
            });
            data_offset = data_offset
                .checked_add(ciphertext as u64)
                .ok_or(Error::LimitExceeded)?;
            remaining -= plaintext as u64;
        }
        files.push(ManifestFile {
            file_id: format!("file_{ordinal:06}"),
            path: source.normalized_path().clone(),
            display_name: source
                .normalized_path()
                .as_str()
                .rsplit('/')
                .next()
                .ok_or(Error::UnsafePath)?
                .to_owned(),
            mime_type: source.mime_type().to_owned(),
            size_bytes: source.size_bytes(),
            hash: lowercase_hex(&hash),
            chunks,
            viewer_policy: ViewerPolicy::default(),
        });
    }
    let manifest = Manifest {
        archive_id: header.archive_id.clone(),
        files,
    };
    manifest.validate(&header.archive_id, records.len() as u64)?;
    Ok((manifest, records))
}

fn stream_encrypted_chunks(
    inventory: &SourceInventory,
    manifest: &Manifest,
    records: &[IndexRecord],
    keys: &crate::production_crypto::DerivedKeys,
    header_hash: &[u8; 32],
    output: &mut File,
) -> Result<()> {
    let mut record_index = 0_usize;
    let mut buffer = Zeroizing::new(vec![0_u8; crate::manifest::CHUNK_SIZE as usize]);
    for (source, expected_file) in inventory.files().iter().zip(&manifest.files) {
        let mut input = source.open_verified()?;
        let mut source_hash = Sha256::new();
        let mut remaining = source.size_bytes();
        while remaining != 0 {
            let record = records
                .get(record_index)
                .ok_or(Error::InvalidChunkMetadata)?;
            let count = record.plaintext_length as usize;
            let expected_count = remaining.min(crate::manifest::CHUNK_SIZE) as usize;
            if count != expected_count {
                return Err(Error::InvalidChunkMetadata);
            }
            input.read_exact(&mut buffer[..count]).map_err(map_read)?;
            source_hash.update(&buffer[..count]);
            let encrypted =
                encrypt_chunk(keys, header_hash, record_index as u64, &buffer[..count])?;
            if encrypted.len() != record.ciphertext_length as usize {
                return Err(Error::InvalidChunkMetadata);
            }
            output.write_all(&encrypted).map_err(|_| Error::Io)?;
            remaining -= count as u64;
            record_index += 1;
        }
        let mut trailing = [0_u8; 1];
        if input.read(&mut trailing).map_err(|_| Error::Io)? != 0 {
            return Err(Error::InvalidBuilderInput);
        }
        source.verify_unchanged(&input)?;
        if lowercase_hex(&source_hash.finalize()) != expected_file.hash {
            return Err(Error::InvalidBuilderInput);
        }
    }
    if record_index != records.len() {
        return Err(Error::InvalidChunkMetadata);
    }
    Ok(())
}

fn build_hash_for_source(source: &SourceFile) -> Result<[u8; 32]> {
    let mut file = source.open_verified()?;
    let (hash, size) = crate::production_crypto::sha256_reader(&mut file, source.size_bytes())?;
    if size != source.size_bytes() {
        return Err(Error::InvalidBuilderInput);
    }
    source.verify_unchanged(&file)?;
    Ok(hash)
}

fn validate_data_and_manifest(
    file: &mut File,
    data_range: &std::ops::Range<usize>,
    records: &[IndexRecord],
    manifest: &Manifest,
    keys: &crate::production_crypto::DerivedKeys,
    header_hash: &[u8; 32],
) -> Result<()> {
    validate_manifest_record_lengths(manifest, records)?;
    file.seek(SeekFrom::Start(data_range.start as u64))
        .map_err(|_| Error::Io)?;
    let mut prefix = [0_u8; 8];
    file.read_exact(&mut prefix).map_err(map_read)?;
    if &prefix[..4] != b"DAT1"
        || u32::from_le_bytes(prefix[4..].try_into().map_err(|_| Error::TruncatedInput)?) as usize
            != records.len()
    {
        return Err(Error::InvalidChunkMetadata);
    }
    let expected_data_len = records.iter().try_fold(8_usize, |length, record| {
        length
            .checked_add(record.ciphertext_length as usize)
            .ok_or(Error::LimitExceeded)
    })?;
    if data_range.len() != expected_data_len {
        return Err(Error::InvalidChunkMetadata);
    }
    let mut consumed = 0_usize;
    for manifest_file in &manifest.files {
        let mut file_hasher = Sha256::new();
        let mut file_size = 0_u64;
        for &chunk_id in &manifest_file.chunks {
            let index = usize::try_from(chunk_id).map_err(|_| Error::OutOfBounds)?;
            if index != consumed {
                return Err(Error::InvalidChunkMetadata);
            }
            let record = records.get(index).ok_or(Error::InvalidChunkMetadata)?;
            let mut ciphertext = vec![0_u8; record.ciphertext_length as usize];
            file.read_exact(&mut ciphertext).map_err(map_read)?;
            let plaintext = decrypt_chunk(
                keys,
                header_hash,
                chunk_id,
                record.plaintext_length,
                &ciphertext,
            )?;
            file_hasher.update(&*plaintext);
            file_size = file_size
                .checked_add(plaintext.len() as u64)
                .ok_or(Error::LimitExceeded)?;
            consumed += 1;
        }
        if file_size != manifest_file.size_bytes
            || lowercase_hex(&file_hasher.finalize()) != manifest_file.hash
        {
            return Err(Error::IntegrityMismatch);
        }
    }
    if consumed != records.len() {
        return Err(Error::InvalidChunkMetadata);
    }
    Ok(())
}

fn validate_manifest_record_lengths(manifest: &Manifest, records: &[IndexRecord]) -> Result<()> {
    let mut record_index = 0_usize;
    for manifest_file in &manifest.files {
        let mut remaining = manifest_file.size_bytes;
        for &chunk_id in &manifest_file.chunks {
            let index = usize::try_from(chunk_id).map_err(|_| Error::InvalidChunkMetadata)?;
            if index != record_index {
                return Err(Error::InvalidChunkMetadata);
            }
            let record = records.get(index).ok_or(Error::InvalidChunkMetadata)?;
            let expected = remaining.min(crate::manifest::CHUNK_SIZE);
            if u64::from(record.plaintext_length) != expected {
                return Err(Error::InvalidChunkMetadata);
            }
            remaining = remaining
                .checked_sub(expected)
                .ok_or(Error::InvalidChunkMetadata)?;
            record_index += 1;
        }
        if remaining != 0 {
            return Err(Error::InvalidChunkMetadata);
        }
    }
    if record_index != records.len() {
        return Err(Error::InvalidChunkMetadata);
    }
    Ok(())
}

fn validate_source_inventory(input_dir: &Path, manifest: &Manifest) -> Result<()> {
    let inventory = SourceInventory::discover(input_dir)?;
    if inventory.files().len() != manifest.files.len() {
        return Err(Error::IntegrityMismatch);
    }
    for (source, expected) in inventory.files().iter().zip(&manifest.files) {
        if source.normalized_path() != &expected.path
            || source.mime_type() != expected.mime_type
            || source.size_bytes() != expected.size_bytes
            || lowercase_hex(&build_hash_for_source(source)?) != expected.hash
        {
            return Err(Error::IntegrityMismatch);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileIdentity {
    len: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl FileIdentity {
    fn from_metadata(metadata: &Metadata) -> Result<Self> {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(Error::Io);
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;

        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        })
    }

    fn from_path(path: &Path) -> Result<Self> {
        Self::from_metadata(&fs::symlink_metadata(path).map_err(|_| Error::Io)?)
    }

    fn verify(&self, path: &Path, file: &File) -> Result<()> {
        let opened = Self::from_metadata(&file.metadata().map_err(|_| Error::Io)?)?;
        let current = Self::from_path(path)?;
        if &opened != self || &current != self {
            return Err(Error::IntegrityMismatch);
        }
        Ok(())
    }

    fn verify_path(&self, path: &Path) -> Result<()> {
        let file = File::open(path).map_err(|_| Error::Io)?;
        self.verify(path, &file)
    }

    #[cfg(unix)]
    fn same_object(&self, other: &Self) -> bool {
        self.device == other.device && self.inode == other.inode
    }

    #[cfg(not(unix))]
    fn same_object(&self, other: &Self) -> bool {
        self == other
    }
}

fn remove_if_same(path: &Path, identity: &FileIdentity) {
    if FileIdentity::from_path(path).is_ok_and(|current| identity.same_object(&current)) {
        let _ = fs::remove_file(path);
    }
}

fn open_layout(
    path: &Path,
    pending: bool,
) -> Result<(File, [std::ops::Range<usize>; 5], u64, FileIdentity)> {
    let metadata = fs::symlink_metadata(path).map_err(|_| Error::Io)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(Error::Io);
    }
    let identity = FileIdentity::from_metadata(&metadata)?;
    let mut file = File::open(path).map_err(|_| Error::Io)?;
    identity.verify(path, &file)?;
    let physical = identity.len;
    let mut prelude = [0_u8; PRELUDE_LEN];
    file.read_exact(&mut prelude).map_err(map_read)?;
    let declared = format::declared_size(&prelude)?;
    let expected_physical = if pending {
        declared.checked_sub(64).ok_or(Error::OutOfBounds)?
    } else {
        declared
    };
    if physical != expected_physical {
        return Err(Error::OutOfBounds);
    }
    let ranges = format::section_ranges(&prelude, declared)?;
    let header_bytes = read_range(&mut file, &ranges[0])?;
    format::parse_header(&header_bytes)?;
    Ok((file, ranges, declared, identity))
}

fn read_range(file: &mut File, range: &std::ops::Range<usize>) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(range.start as u64))
        .map_err(|_| Error::Io)?;
    let mut bytes = vec![0_u8; range.len()];
    file.read_exact(&mut bytes).map_err(map_read)?;
    Ok(bytes)
}

fn digest_exact_file(path: &Path, expected_size: u64) -> Result<[u8; 32]> {
    let mut file = File::open(path).map_err(|_| Error::Io)?;
    let digest = digest_prefix(&mut file, expected_size)?;
    if file.metadata().map_err(|_| Error::Io)?.len() != expected_size {
        return Err(Error::IntegrityMismatch);
    }
    Ok(digest)
}

fn digest_prefix(file: &mut File, length: u64) -> Result<[u8; 32]> {
    file.seek(SeekFrom::Start(0)).map_err(|_| Error::Io)?;
    let mut limited = file.take(length);
    let (digest, actual) = crate::production_crypto::sha256_reader(&mut limited, length)?;
    if actual != length {
        return Err(Error::TruncatedInput);
    }
    Ok(digest)
}

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|_| Error::Io)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > maximum {
        return Err(Error::LimitExceeded);
    }
    let file = File::open(path).map_err(|_| Error::Io)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Io)?;
    if bytes.len() as u64 != metadata.len() || bytes.len() as u64 > maximum {
        return Err(Error::Io);
    }
    Ok(bytes)
}

fn pending_path(output: &Path) -> PathBuf {
    let mut value: OsString = output.as_os_str().to_owned();
    value.push(".pending");
    PathBuf::from(value)
}

fn map_read(error: std::io::Error) -> Error {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        Error::TruncatedInput
    } else {
        Error::Io
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Cursor;
    use std::sync::atomic::{AtomicU64, Ordering};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    static TEMP_ID: AtomicU64 = AtomicU64::new(0);
    const HEADER: &str = r#"{"archive_id":"arc_test_01","backend":{"archive_api_id":"arc_test_01"},"commercial_snapshot":{"platform_fee_bps":500,"price_amount":"10.000000","price_currency":"USDC"},"created_at":"2026-09-07T00:00:00Z","creator_wallet":"11111111111111111111111111111111","crypto":{"chunk_size":1048576,"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256"},"format":"solarch","license_snapshot":{"allow_export":false,"max_devices":1,"watermark_enabled":true},"title":"Test archive","version":"1.0.0"}"#;
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("solarch-production-{}-{id}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn setup() -> (
        TestDir,
        PathBuf,
        PathBuf,
        PathBuf,
        ArchiveContentKey,
        SigningKey,
    ) {
        let root = TestDir::new();
        let input = root.0.join("input");
        fs::create_dir(&input).unwrap();
        fs::write(input.join("a.png"), STANDARD.decode(PNG).unwrap()).unwrap();
        let metadata = root.0.join("header.json");
        fs::write(&metadata, HEADER).unwrap();
        let output = root.0.join("archive.slr");
        let ack = ArchiveContentKey::from_bytes(std::array::from_fn(|i| 0xa0 + i as u8));
        let signing = SigningKey::from_bytes(&std::array::from_fn(|i| i as u8));
        (root, input, metadata, output, ack, signing)
    }

    fn ooxml(main_path: &str, main_content_type: &str) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("[Content_Types].xml", options).unwrap();
        write!(
            writer,
            "<Types><Override PartName=\"/{main_path}\" ContentType=\"{main_content_type}\"/></Types>"
        )
        .unwrap();
        writer.start_file("_rels/.rels", options).unwrap();
        writer.write_all(b"<Relationships/>").unwrap();
        writer.start_file(main_path, options).unwrap();
        writer.write_all(b"<root/>").unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn frozen_vector_build_pending_verify_finalize_and_verify() {
        let (_root, input, metadata, output, ack, signing) = setup();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        assert_eq!(
            lowercase_hex(&pending.result().signing_digest),
            "7acfe5c1f45a80ade61ed480b38db5637be34936f25008845640c0f6eb4f5fbb"
        );
        assert_eq!(pending.result().size_bytes, 1166);
        let verified_pending = verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "arc-test-01",
            &ack,
        )
        .unwrap();
        assert_eq!(verified_pending.file_count, 1);
        assert_eq!(
            verified_pending.signing_digest,
            lowercase_hex(&pending.result().signing_digest)
        );
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        let finalized = pending.accept_signature(signature.to_bytes()).unwrap();
        assert_eq!(finalized.size_bytes, 1166);
        assert_eq!(
            finalized.archive_fingerprint,
            "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb"
        );
        let bytes = fs::read(&output).unwrap();
        let expected = STANDARD
            .decode(include_str!("../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        assert_eq!(bytes, expected);
        assert_eq!(
            verify_finalized(&output, "arc-test-01", signing.verifying_key().to_bytes())
                .unwrap()
                .archive_fingerprint,
            finalized.archive_fingerprint
        );
        assert!(
            verify_finalized_with_content(
                &output,
                &input,
                &metadata,
                "arc-test-01",
                signing.verifying_key().to_bytes(),
                &ack,
            )
            .unwrap()
            .protected_content_verified
        );
    }

    #[test]
    fn pending_verifier_rejects_wrong_ack_source_metadata_and_length() {
        let (_root, input, metadata, output, ack, signing) = setup();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        let wrong_ack = ArchiveContentKey::from_bytes([7; 32]);
        assert!(verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "arc-test-01",
            &wrong_ack
        )
        .is_err());
        let mut other_header: serde_json::Value =
            serde_json::from_slice(HEADER.as_bytes()).unwrap();
        other_header["title"] = serde_json::Value::String("Different title".into());
        fs::write(&metadata, serde_jcs::to_vec(&other_header).unwrap()).unwrap();
        assert!(verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "arc-test-01",
            &ack
        )
        .is_err());
        fs::write(&metadata, HEADER).unwrap();
        assert!(verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "wrong-key-id",
            &ack
        )
        .is_err());
        fs::write(input.join("a.png"), [0_u8; 68]).unwrap();
        assert!(verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "arc-test-01",
            &ack
        )
        .is_err());
        let mut file = OpenOptions::new()
            .append(true)
            .open(&pending.result().pending_path)
            .unwrap();
        file.write_all(&[0]).unwrap();
        assert!(verify_pending(
            &pending.result().pending_path,
            &input,
            &metadata,
            "arc-test-01",
            &ack
        )
        .is_err());
    }

    #[test]
    fn bad_signature_and_existing_paths_fail_without_publishing() {
        let (_root, input, metadata, output, ack, signing) = setup();
        let pending_collision = PathBuf::from(format!("{}.pending", output.display()));
        fs::write(&pending_collision, b"existing pending").unwrap();
        assert!(ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .is_err());
        assert_eq!(fs::read(&pending_collision).unwrap(), b"existing pending");
        fs::remove_file(&pending_collision).unwrap();
        fs::write(&output, b"existing").unwrap();
        assert!(ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .is_err());
        fs::remove_file(&output).unwrap();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        assert!(pending.accept_signature([0; 64]).is_err());
        assert!(!output.exists());
        assert!(!PathBuf::from(format!("{}.pending", output.display())).exists());
    }

    #[test]
    fn output_created_during_signing_is_never_replaced() {
        let (_root, input, metadata, output, ack, signing) = setup();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        fs::write(&output, b"racing output").unwrap();
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        assert!(pending.accept_signature(signature.to_bytes()).is_err());
        assert_eq!(fs::read(&output).unwrap(), b"racing output");
        assert!(!PathBuf::from(format!("{}.pending", output.display())).exists());
    }

    #[test]
    fn pending_verifier_rejects_each_encrypted_section_and_sig1_mutation() {
        for section in 1..=4 {
            let (_root, input, metadata, output, ack, signing) = setup();
            let pending = ArchiveBuilder::prepare(BuildRequest {
                input_dir: &input,
                metadata_path: &metadata,
                output_path: &output,
                signing_key_id: "arc-test-01",
                signing_public_key: signing.verifying_key().to_bytes(),
                archive_content_key: &ack,
            })
            .unwrap();
            let pending_path = pending.result().pending_path.clone();
            let mut bytes = fs::read(&pending_path).unwrap();
            let declared = format::declared_size(&bytes[..PRELUDE_LEN]).unwrap();
            let ranges = format::section_ranges(&bytes[..PRELUDE_LEN], declared).unwrap();
            let position = ranges[section].start + usize::from(section == 3) * 8;
            bytes[position] ^= 1;
            fs::write(&pending_path, bytes).unwrap();
            assert!(verify_pending(&pending_path, &input, &metadata, "arc-test-01", &ack).is_err());
        }
    }

    #[test]
    fn manifest_chunk_lengths_require_full_non_final_chunks() {
        let manifest = Manifest {
            archive_id: "arc_test".into(),
            files: vec![ManifestFile {
                file_id: "file_000000".into(),
                path: crate::paths::NormalizedPath::new("a.pdf").unwrap(),
                display_name: "a.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: crate::manifest::CHUNK_SIZE + 1,
                hash: "00".repeat(32),
                chunks: vec![0, 1],
                viewer_policy: ViewerPolicy::default(),
            }],
        };
        let records = [
            IndexRecord {
                offset: 8,
                ciphertext_length: 17,
                plaintext_length: 1,
            },
            IndexRecord {
                offset: 25,
                ciphertext_length: crate::manifest::CHUNK_SIZE as u32 + 16,
                plaintext_length: crate::manifest::CHUNK_SIZE as u32,
            },
        ];
        assert!(manifest.validate("arc_test", 2).is_ok());
        assert_eq!(
            validate_manifest_record_lengths(&manifest, &records),
            Err(Error::InvalidChunkMetadata)
        );
    }

    #[test]
    fn finalized_verifier_rejects_wrong_trust_and_every_mutation_changes_fingerprint() {
        let (_root, input, metadata, output, ack, signing) = setup();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        pending.accept_signature(signature.to_bytes()).unwrap();
        assert!(
            verify_finalized(&output, "wrong-key-id", signing.verifying_key().to_bytes()).is_err()
        );
        assert!(verify_finalized(
            &output,
            "arc-test-01",
            SigningKey::from_bytes(&[9; 32]).verifying_key().to_bytes()
        )
        .is_err());

        let original = fs::read(&output).unwrap();
        let fingerprint = crate::production_crypto::fingerprint_bytes(&original).unwrap();
        for position in 0..original.len() {
            let mut mutated = original.clone();
            mutated[position] ^= 1;
            assert_ne!(
                crate::production_crypto::fingerprint_bytes(&mutated).unwrap(),
                fingerprint
            );
        }
    }

    #[test]
    fn multifile_all_mvp_formats_complete_production_flow() {
        let (root, input, metadata, output, ack, signing) = setup();
        fs::write(input.join("b.pdf"), b"%PDF-1.7\n%%EOF\n").unwrap();
        fs::write(input.join("c.jpg"), [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        let mut webp = b"RIFF\x08\0\0\0WEBPVP8 ".to_vec();
        assert_eq!(webp.len(), 16);
        fs::write(input.join("d.webp"), &mut webp).unwrap();
        fs::write(
            input.join("e.docx"),
            ooxml(
                "word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            ),
        )
        .unwrap();
        fs::write(
            input.join("f.xlsx"),
            ooxml(
                "xl/workbook.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            ),
        )
        .unwrap();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        assert_eq!(pending.result().file_count, 6);
        assert_eq!(
            verify_pending(
                &pending.result().pending_path,
                &input,
                &metadata,
                "arc-test-01",
                &ack,
            )
            .unwrap()
            .file_count,
            6
        );
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        let result = pending.accept_signature(signature.to_bytes()).unwrap();
        assert_eq!(result.file_count, 6);
        assert!(output.exists());
        assert!(
            verify_finalized_with_content(
                &output,
                &input,
                &metadata,
                "arc-test-01",
                signing.verifying_key().to_bytes(),
                &ack,
            )
            .unwrap()
            .protected_content_verified
        );
        drop(root);
    }

    #[test]
    fn protected_reader_is_lazy_bounded_authenticated_and_identity_bound() {
        let (_root, input, metadata, output, ack, signing) = setup();
        fs::remove_file(input.join("a.png")).unwrap();
        let mut source = vec![0x5a; crate::manifest::CHUNK_SIZE as usize + 37];
        source[..9].copy_from_slice(b"%PDF-1.7\n");
        let source_len = source.len();
        source[source_len - 6..].copy_from_slice(b"%%EOF\n");
        fs::write(input.join("a.pdf"), &source).unwrap();
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        pending.accept_signature(signature.to_bytes()).unwrap();
        let verified =
            verify_archive(&output, "arc-test-01", signing.verifying_key().to_bytes()).unwrap();

        let mut reader = ProtectedArchiveReader::open(
            &output,
            "arc-test-01",
            signing.verifying_key().to_bytes(),
            &verified.archive_fingerprint,
            &verified.file_identity,
            &ack,
        )
        .unwrap();
        assert_eq!(reader.files().len(), 1);
        assert_eq!(reader.files()[0].file_id, "file_000000");
        assert_eq!(
            &*reader.read_file_range("file_000000", 0, 1).unwrap(),
            &source[..1]
        );
        let cross_offset = crate::manifest::CHUNK_SIZE - 8;
        assert_eq!(
            &*reader
                .read_file_range("file_000000", cross_offset, 24)
                .unwrap(),
            &source[cross_offset as usize..cross_offset as usize + 24]
        );
        assert_eq!(
            &*reader
                .read_file_range("file_000000", source.len() as u64 - 1, 1)
                .unwrap(),
            &source[source.len() - 1..]
        );
        assert!(reader.read_file_range("missing", 0, 1).is_err());
        assert!(reader.read_file_range("file_000000", u64::MAX, 2).is_err());
        assert!(reader
            .read_file_range("file_000000", 0, MAX_PROTECTED_READ_BYTES + 1)
            .is_err());

        let wrong_ack = ArchiveContentKey::from_bytes([9; 32]);
        assert!(ProtectedArchiveReader::open(
            &output,
            "arc-test-01",
            signing.verifying_key().to_bytes(),
            &verified.archive_fingerprint,
            &verified.file_identity,
            &wrong_ack,
        )
        .is_err());

        let original = fs::read(&output).unwrap();
        let replacement = output.with_extension("replacement");
        fs::write(&replacement, &original).unwrap();
        let old = output.with_extension("old");
        fs::rename(&output, &old).unwrap();
        fs::rename(&replacement, &output).unwrap();
        assert!(reader.read_file_range("file_000000", 0, 1).is_err());
        assert!(ProtectedArchiveReader::open(
            &output,
            "arc-test-01",
            signing.verifying_key().to_bytes(),
            &verified.archive_fingerprint,
            &verified.file_identity,
            &ack,
        )
        .is_err());
    }

    #[test]
    fn empty_protected_file_builds_with_zero_chunks_and_verifies() {
        let (_root, input, metadata, output, ack, signing) = setup();
        fs::remove_file(input.join("a.png")).unwrap();
        fs::write(input.join("empty.pdf"), b"").unwrap();

        let inventory = SourceInventory::discover(&input).unwrap();
        let header_bytes = fs::read(&metadata).unwrap();
        let header = format::parse_header(&header_bytes).unwrap();
        let (manifest, records) = build_manifest_and_records(&header, &inventory).unwrap();
        assert!(records.is_empty());
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].size_bytes, 0);
        assert!(manifest.files[0].chunks.is_empty());
        assert_eq!(
            manifest.files[0].hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &output,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        assert_eq!(pending.result().file_count, 1);
        assert_eq!(
            verify_pending(
                &pending.result().pending_path,
                &input,
                &metadata,
                "arc-test-01",
                &ack,
            )
            .unwrap()
            .file_count,
            1
        );
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        pending.accept_signature(signature.to_bytes()).unwrap();
        assert!(
            verify_finalized_with_content(
                &output,
                &input,
                &metadata,
                "arc-test-01",
                signing.verifying_key().to_bytes(),
                &ack,
            )
            .unwrap()
            .protected_content_verified
        );
    }
}
