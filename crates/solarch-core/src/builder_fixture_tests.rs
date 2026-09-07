//! Synthetic reproducible fixtures only. This codec is compiled exclusively for
//! unit tests; it does not define signing/fingerprint/nonce production contracts.
use super::*;
use crate::{
    format::{parse_structure, serialize_structure},
    manifest::{ManifestFile, ViewerPolicy},
    paths::NormalizedPath,
    signature::verify_bytes,
};
use ed25519_dalek::{Signer, SigningKey};

fn fixture(multi: bool) -> (Vec<u8>, EncryptionSession) {
    let header = super::tests::header();
    let mut manifest = super::tests::manifest();
    let chunks: &[&[u8]] = if multi {
        &[b"abc", b"def", b"synthetic image"]
    } else {
        &[b"abc", b"def"]
    };
    if multi {
        manifest.files.push(ManifestFile {
            file_id: "file2".into(),
            path: NormalizedPath::new("private/b.png").unwrap(),
            display_name: "b.png".into(),
            mime_type: "image/png".into(),
            size_bytes: 15,
            hash: "test-only-opaque".into(),
            chunks: vec![2],
            viewer_policy: ViewerPolicy::default(),
        });
    }
    let mut session = EncryptionSession::fixture_session();
    let archive = ArchiveBuilder::build_in_memory(
        PreparedInput {
            header,
            manifest,
            chunks,
        },
        &mut session,
    )
    .unwrap();
    let manifest = archive.manifest.fixture_bytes();
    let index = archive.index.fixture_bytes();
    let mut data = Vec::new();
    for chunk in &archive.chunks {
        let bytes = chunk.fixture_bytes();
        data.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        data.extend_from_slice(&bytes);
    }
    let mut bytes =
        serialize_structure(&archive.header, [&manifest, &index, &data, &[0; 64]]).unwrap();
    let end = bytes.len() - 64;
    // Test-only coverage and trust key: explicitly NOT the platform trust model.
    let signature = SigningKey::from_bytes(&[42; 32])
        .sign(&bytes[..end])
        .to_bytes();
    bytes[end..].copy_from_slice(&signature);
    (bytes, session)
}

fn open_fixture(bytes: &[u8]) -> Result<InMemoryArchive> {
    let parsed = parse_structure(bytes)?;
    let signature: &[u8; 64] = parsed.sections[4]
        .try_into()
        .map_err(|_| Error::SignatureFailure)?;
    verify_bytes(
        &SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes(),
        &bytes[..bytes.len() - 64],
        signature,
    )?;
    let context = serde_json::to_vec(&parsed.header).map_err(|_| Error::Serialization)?;
    let mut data = parsed.sections[3];
    let mut chunks = Vec::new();
    while !data.is_empty() {
        let prefix = data.get(..8).ok_or(Error::TruncatedInput)?;
        let len = u64::from_le_bytes(prefix.try_into().map_err(|_| Error::TruncatedInput)?);
        let range = crate::integrity::checked_range(8, len, data.len())?;
        chunks.push(EncryptedMessage::from_fixture_bytes(&data[range.clone()])?);
        data = &data[range.end..];
    }
    Ok(InMemoryArchive {
        header: parsed.header,
        context,
        manifest: EncryptedMessage::from_fixture_bytes(parsed.sections[1])?,
        index: EncryptedMessage::from_fixture_bytes(parsed.sections[2])?,
        chunks,
        file_count: 0,
        encrypted_size_bytes: 0,
    })
}

#[test]
fn deterministic_minimal_and_multifile_full_test_only_roundtrip() {
    for multi in [false, true] {
        let (bytes, session) = fixture(multi);
        assert_eq!(bytes, fixture(multi).0);
        assert!(!bytes.windows(32).any(|w| w == [7; 32]));
        assert!(!bytes.windows(13).any(|w| w == b"private/a.pdf"));
        let opened = open_fixture(&bytes).unwrap();
        let manifest = opened.decrypt_manifest(session.key()).unwrap();
        assert_eq!(manifest.files.len(), if multi { 2 } else { 1 });
        assert_eq!(&**opened.decrypt_chunk(session.key(), 0).unwrap(), b"abc");
        assert_eq!(&**opened.decrypt_chunk(session.key(), 1).unwrap(), b"def");
        if multi {
            assert_eq!(
                &**opened.decrypt_chunk(session.key(), 2).unwrap(),
                b"synthetic image"
            );
        }
    }
}

#[test]
fn corrupted_header_manifest_index_chunk_signature_and_version_fixtures() {
    let (valid, _) = fixture(true);
    let parsed = parse_structure(&valid).unwrap();
    let mut positions = vec![
        ("corrupted-header.slr", crate::format::PRELUDE_LEN),
        ("unsupported-version.slr", 8),
    ];
    let names = [
        "corrupted-manifest.slr",
        "corrupted-index.slr",
        "corrupted-chunk.slr",
        "invalid-signature.slr",
    ];
    let mut offset = crate::format::PRELUDE_LEN + parsed.sections[0].len();
    for (name, section) in names.into_iter().zip(parsed.sections[1..].iter()) {
        positions.push((name, offset));
        offset += section.len();
    }
    for (name, position) in positions {
        let mut corrupted = valid.clone();
        corrupted[position] ^= 1;
        assert!(open_fixture(&corrupted).is_err(), "{name}");
        assert_ne!(digest_bytes(&corrupted), digest_bytes(&valid));
    }
    for end in 0..valid.len() {
        assert!(open_fixture(&valid[..end]).is_err());
    }
}

#[test]
fn aead_fails_even_if_test_signer_resigns_corrupted_ciphertext() {
    for section in 1..=3 {
        let (mut bytes, session) = fixture(false);
        let parsed = parse_structure(&bytes).unwrap();
        let position = crate::format::PRELUDE_LEN
            + parsed.sections[..section]
                .iter()
                .map(|s| s.len())
                .sum::<usize>()
            + if section == 3 { 8 + 24 } else { 24 };
        bytes[position] ^= 1;
        let end = bytes.len() - 64;
        let sig = SigningKey::from_bytes(&[42; 32])
            .sign(&bytes[..end])
            .to_bytes();
        bytes[end..].copy_from_slice(&sig);
        let archive = open_fixture(&bytes).unwrap();
        if section == 3 {
            assert!(archive.decrypt_chunk(session.key(), 0).is_err());
        } else {
            assert!(archive.decrypt_manifest(session.key()).is_err());
        }
    }
}
