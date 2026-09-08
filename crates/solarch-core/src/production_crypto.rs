//! Frozen production `.slr` v1 cryptographic and binary-codec helpers.
//!
//! Secret-bearing types deliberately do not implement `Clone` or serialization.

use std::io::Read;

use chacha20poly1305::{
    aead::{AeadInPlace, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use ed25519_dalek::{Signature, VerifyingKey};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{Error, Result};

pub const CHUNK_PLAINTEXT_BYTES: u32 = 1_048_576;
pub const MAX_CHUNK_COUNT: usize = 16_384;
pub const MAX_PROTECTED_FILE_COUNT: usize = 10_000;
pub const MAX_PROTECTED_FILE_BYTES: u64 = 536_870_912;
pub const MAX_TOTAL_PLAINTEXT_BYTES: u64 = 536_870_912;
pub const MAX_PUBLIC_HEADER_BYTES: usize = 65_536;
pub const MAX_ENCRYPTED_MANIFEST_BYTES: usize = 16_777_216;
pub const MAX_ENCRYPTED_INDEX_BYTES: usize = 262_168;
pub const MAX_ENCRYPTED_DATA_BYTES: u64 =
    8 + MAX_TOTAL_PLAINTEXT_BYTES + (MAX_CHUNK_COUNT as u64 * AEAD_TAG_BYTES as u64);
pub const MAX_FINALIZED_ARCHIVE_BYTES: u64 = 1_073_741_824;
pub const AEAD_TAG_BYTES: usize = 16;
pub const INDEX_RECORD_BYTES: usize = 16;
pub const INDEX_DATA_PREFIX_BYTES: usize = 8;
pub const SIGNATURE_PREFIX_BYTES: usize = 40;
pub const SIGNATURE_BLOCK_BYTES: usize = 104;

const MANIFEST_KEY_INFO: &[u8] = b"SolArch/slr/manifest-key/v1\0";
const INDEX_KEY_INFO: &[u8] = b"SolArch/slr/index-key/v1\0";
const CONTENT_KEY_INFO: &[u8] = b"SolArch/slr/content-key/v1\0";
const MANIFEST_AAD_DOMAIN: &[u8] = b"SolArch/slr/manifest-aad/v1\0";
const INDEX_AAD_DOMAIN: &[u8] = b"SolArch/slr/index-aad/v1\0";
const CHUNK_AAD_DOMAIN: &[u8] = b"SolArch/slr/chunk-aad/v1\0";
const SIGNATURE_DOMAIN: &[u8] = b"SolArch/slr-signature/v1\0";

/// Backend-owned Archive Content Key received through the private IPC frame.
pub struct ArchiveContentKey(Zeroizing<[u8; 32]>);

impl ArchiveContentKey {
    pub fn from_bytes(mut bytes: [u8; 32]) -> Self {
        let secret = Self(Zeroizing::new(bytes));
        bytes.zeroize();
        secret
    }
}

impl std::fmt::Debug for ArchiveContentKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ArchiveContentKey([REDACTED])")
    }
}

/// Purpose-separated keys derived from one ACK and the exact Public Header.
pub struct DerivedKeys {
    manifest: Zeroizing<[u8; 32]>,
    index: Zeroizing<[u8; 32]>,
    content: Zeroizing<[u8; 32]>,
}

impl std::fmt::Debug for DerivedKeys {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DerivedKeys([REDACTED])")
    }
}

pub fn header_hash(header_bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(header_bytes).into()
}

pub fn derive_keys(header_bytes: &[u8], ack: &ArchiveContentKey) -> Result<DerivedKeys> {
    let hash = header_hash(header_bytes);
    let hkdf = Hkdf::<Sha256>::new(Some(&hash), &*ack.0);
    let mut manifest = Zeroizing::new([0_u8; 32]);
    let mut index = Zeroizing::new([0_u8; 32]);
    let mut content = Zeroizing::new([0_u8; 32]);
    hkdf.expand(MANIFEST_KEY_INFO, manifest.as_mut())
        .map_err(|_| Error::InvalidBuilderInput)?;
    hkdf.expand(INDEX_KEY_INFO, index.as_mut())
        .map_err(|_| Error::InvalidBuilderInput)?;
    hkdf.expand(CONTENT_KEY_INFO, content.as_mut())
        .map_err(|_| Error::InvalidBuilderInput)?;
    Ok(DerivedKeys {
        manifest,
        index,
        content,
    })
}

pub fn encrypt_manifest(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    if plaintext.is_empty() || plaintext.len() > MAX_ENCRYPTED_MANIFEST_BYTES - AEAD_TAG_BYTES {
        return Err(Error::LimitExceeded);
    }
    encrypt(
        &keys.manifest,
        &[0; 24],
        &section_aad(MANIFEST_AAD_DOMAIN, header_hash, plaintext.len())?,
        plaintext,
    )
}

pub fn decrypt_manifest(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    if ciphertext.len() <= AEAD_TAG_BYTES || ciphertext.len() > MAX_ENCRYPTED_MANIFEST_BYTES {
        return Err(Error::InvalidManifest);
    }
    let plaintext_len = ciphertext.len() - AEAD_TAG_BYTES;
    decrypt(
        &keys.manifest,
        &[0; 24],
        &section_aad(MANIFEST_AAD_DOMAIN, header_hash, plaintext_len)?,
        ciphertext,
    )
}

pub fn encrypt_index(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    if plaintext.len() < INDEX_DATA_PREFIX_BYTES
        || plaintext.len() > MAX_ENCRYPTED_INDEX_BYTES - AEAD_TAG_BYTES
    {
        return Err(Error::LimitExceeded);
    }
    encrypt(
        &keys.index,
        &[0; 24],
        &section_aad(INDEX_AAD_DOMAIN, header_hash, plaintext.len())?,
        plaintext,
    )
}

pub fn decrypt_index(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    if ciphertext.len() < INDEX_DATA_PREFIX_BYTES + AEAD_TAG_BYTES
        || ciphertext.len() > MAX_ENCRYPTED_INDEX_BYTES
    {
        return Err(Error::InvalidChunkMetadata);
    }
    let plaintext_len = ciphertext.len() - AEAD_TAG_BYTES;
    decrypt(
        &keys.index,
        &[0; 24],
        &section_aad(INDEX_AAD_DOMAIN, header_hash, plaintext_len)?,
        ciphertext,
    )
}

pub fn encrypt_chunk(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    chunk_id: u64,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    if chunk_id >= MAX_CHUNK_COUNT as u64
        || plaintext.is_empty()
        || plaintext.len() > CHUNK_PLAINTEXT_BYTES as usize
    {
        return Err(Error::LimitExceeded);
    }
    encrypt(
        &keys.content,
        &chunk_nonce(chunk_id),
        &chunk_aad(header_hash, chunk_id, plaintext.len())?,
        plaintext,
    )
}

pub fn decrypt_chunk(
    keys: &DerivedKeys,
    header_hash: &[u8; 32],
    chunk_id: u64,
    plaintext_len: u32,
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    if chunk_id >= MAX_CHUNK_COUNT as u64
        || plaintext_len == 0
        || plaintext_len > CHUNK_PLAINTEXT_BYTES
        || ciphertext.len() != plaintext_len as usize + AEAD_TAG_BYTES
    {
        return Err(Error::InvalidChunkMetadata);
    }
    decrypt(
        &keys.content,
        &chunk_nonce(chunk_id),
        &chunk_aad(header_hash, chunk_id, plaintext_len as usize)?,
        ciphertext,
    )
}

fn encrypt(key: &[u8; 32], nonce: &[u8; 24], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut buffer = Zeroizing::new(plaintext.to_vec());
    cipher
        .encrypt_in_place(XNonce::from_slice(nonce), aad, &mut *buffer)
        .map_err(|_| Error::AuthenticationFailed)?;
    Ok(std::mem::take(&mut *buffer))
}

fn decrypt(
    key: &[u8; 32],
    nonce: &[u8; 24],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut buffer = Zeroizing::new(ciphertext.to_vec());
    cipher
        .decrypt_in_place(XNonce::from_slice(nonce), aad, &mut *buffer)
        .map_err(|_| Error::AuthenticationFailed)?;
    Ok(buffer)
}

fn section_aad(domain: &[u8], hash: &[u8; 32], plaintext_len: usize) -> Result<Vec<u8>> {
    let plaintext_len = u64::try_from(plaintext_len).map_err(|_| Error::LimitExceeded)?;
    let mut aad = Vec::with_capacity(domain.len() + hash.len() + 8);
    aad.extend_from_slice(domain);
    aad.extend_from_slice(hash);
    aad.extend_from_slice(&plaintext_len.to_le_bytes());
    Ok(aad)
}

fn chunk_aad(hash: &[u8; 32], chunk_id: u64, plaintext_len: usize) -> Result<Vec<u8>> {
    let plaintext_len = u64::try_from(plaintext_len).map_err(|_| Error::LimitExceeded)?;
    let mut aad = Vec::with_capacity(CHUNK_AAD_DOMAIN.len() + hash.len() + 16);
    aad.extend_from_slice(CHUNK_AAD_DOMAIN);
    aad.extend_from_slice(hash);
    aad.extend_from_slice(&chunk_id.to_le_bytes());
    aad.extend_from_slice(&plaintext_len.to_le_bytes());
    Ok(aad)
}

fn chunk_nonce(chunk_id: u64) -> [u8; 24] {
    let mut nonce = [0_u8; 24];
    nonce[16..].copy_from_slice(&chunk_id.to_le_bytes());
    nonce
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IndexRecord {
    pub offset: u64,
    pub ciphertext_length: u32,
    pub plaintext_length: u32,
}

pub fn encode_idx1(records: &[IndexRecord]) -> Result<Vec<u8>> {
    validate_index_records(records, None)?;
    let count = u32::try_from(records.len()).map_err(|_| Error::LimitExceeded)?;
    let capacity = INDEX_DATA_PREFIX_BYTES
        .checked_add(
            records
                .len()
                .checked_mul(INDEX_RECORD_BYTES)
                .ok_or(Error::LimitExceeded)?,
        )
        .ok_or(Error::LimitExceeded)?;
    let mut bytes = Vec::with_capacity(capacity);
    bytes.extend_from_slice(b"IDX1");
    bytes.extend_from_slice(&count.to_le_bytes());
    for record in records {
        bytes.extend_from_slice(&record.offset.to_le_bytes());
        bytes.extend_from_slice(&record.ciphertext_length.to_le_bytes());
        bytes.extend_from_slice(&record.plaintext_length.to_le_bytes());
    }
    Ok(bytes)
}

pub fn decode_idx1(bytes: &[u8]) -> Result<Vec<IndexRecord>> {
    if bytes.len() < INDEX_DATA_PREFIX_BYTES || bytes.len() > MAX_ENCRYPTED_INDEX_BYTES - 16 {
        return Err(Error::InvalidChunkMetadata);
    }
    if &bytes[..4] != b"IDX1" {
        return Err(Error::InvalidChunkMetadata);
    }
    let count = read_u32(&bytes[4..8])? as usize;
    if count > MAX_CHUNK_COUNT {
        return Err(Error::LimitExceeded);
    }
    let expected_len = INDEX_DATA_PREFIX_BYTES
        .checked_add(
            count
                .checked_mul(INDEX_RECORD_BYTES)
                .ok_or(Error::LimitExceeded)?,
        )
        .ok_or(Error::LimitExceeded)?;
    if bytes.len() != expected_len {
        return Err(Error::InvalidChunkMetadata);
    }
    let mut records = Vec::with_capacity(count);
    for record in bytes[8..].chunks_exact(INDEX_RECORD_BYTES) {
        records.push(IndexRecord {
            offset: read_u64(&record[..8])?,
            ciphertext_length: read_u32(&record[8..12])?,
            plaintext_length: read_u32(&record[12..16])?,
        });
    }
    validate_index_records(&records, None)?;
    Ok(records)
}

/// Validates exact contiguous DAT1 framing against authenticated index records.
pub fn validate_dat1(data: &[u8], records: &[IndexRecord]) -> Result<()> {
    if data.len() < INDEX_DATA_PREFIX_BYTES {
        return Err(Error::InvalidChunkMetadata);
    }
    validate_dat1_layout(
        &data[..INDEX_DATA_PREFIX_BYTES],
        u64::try_from(data.len()).map_err(|_| Error::LimitExceeded)?,
        records,
    )
}

/// Streaming-friendly DAT1 validation using only its eight-byte prefix and the
/// signed data-section length. Chunk bytes may then be read at validated offsets.
pub fn validate_dat1_layout(
    prefix: &[u8],
    data_length: u64,
    records: &[IndexRecord],
) -> Result<()> {
    if prefix.len() != INDEX_DATA_PREFIX_BYTES
        || &prefix[..4] != b"DAT1"
        || data_length > MAX_ENCRYPTED_DATA_BYTES
    {
        return Err(Error::InvalidChunkMetadata);
    }
    let count = read_u32(&prefix[4..8])? as usize;
    if count != records.len() || count > MAX_CHUNK_COUNT {
        return Err(Error::InvalidChunkMetadata);
    }
    validate_index_records(records, Some(data_length))
}

pub fn indexed_chunk<'a>(
    data: &'a [u8],
    records: &[IndexRecord],
    chunk_id: usize,
) -> Result<&'a [u8]> {
    validate_dat1(data, records)?;
    let record = records.get(chunk_id).ok_or(Error::InvalidChunkMetadata)?;
    let start = usize::try_from(record.offset).map_err(|_| Error::OutOfBounds)?;
    let end = start
        .checked_add(record.ciphertext_length as usize)
        .ok_or(Error::OutOfBounds)?;
    data.get(start..end).ok_or(Error::OutOfBounds)
}

fn validate_index_records(records: &[IndexRecord], data_len: Option<u64>) -> Result<()> {
    if records.len() > MAX_CHUNK_COUNT {
        return Err(Error::LimitExceeded);
    }
    let mut expected_offset = INDEX_DATA_PREFIX_BYTES as u64;
    for record in records {
        if record.offset != expected_offset
            || record.plaintext_length == 0
            || record.plaintext_length > CHUNK_PLAINTEXT_BYTES
            || record.ciphertext_length
                != record
                    .plaintext_length
                    .checked_add(AEAD_TAG_BYTES as u32)
                    .ok_or(Error::InvalidChunkMetadata)?
        {
            return Err(Error::InvalidChunkMetadata);
        }
        expected_offset = expected_offset
            .checked_add(record.ciphertext_length as u64)
            .ok_or(Error::OutOfBounds)?;
    }
    if let Some(data_len) = data_len {
        if expected_offset != data_len {
            return Err(Error::InvalidChunkMetadata);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignaturePrefix {
    key_id: String,
}

impl SignaturePrefix {
    pub fn new(key_id: &str) -> Result<Self> {
        validate_key_id(key_id.as_bytes())?;
        Ok(Self {
            key_id: key_id.to_owned(),
        })
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn encode(&self) -> [u8; SIGNATURE_PREFIX_BYTES] {
        let mut bytes = [0_u8; SIGNATURE_PREFIX_BYTES];
        bytes[..4].copy_from_slice(b"SIG1");
        bytes[4..6].copy_from_slice(&1_u16.to_le_bytes());
        bytes[6..8].copy_from_slice(&1_u16.to_le_bytes());
        bytes[8..8 + self.key_id.len()].copy_from_slice(self.key_id.as_bytes());
        bytes
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != SIGNATURE_PREFIX_BYTES
            || &bytes[..4] != b"SIG1"
            || read_u16(&bytes[4..6])? != 1
            || read_u16(&bytes[6..8])? != 1
        {
            return Err(Error::SignatureFailure);
        }
        let padded = &bytes[8..40];
        let id_len = padded.iter().position(|byte| *byte == 0).unwrap_or(32);
        if padded[id_len..].iter().any(|byte| *byte != 0) {
            return Err(Error::SignatureFailure);
        }
        validate_key_id(&padded[..id_len])?;
        let key_id = std::str::from_utf8(&padded[..id_len])
            .map_err(|_| Error::SignatureFailure)?
            .to_owned();
        Ok(Self { key_id })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignatureBlock {
    pub prefix: SignaturePrefix,
    pub signature: [u8; 64],
}

impl SignatureBlock {
    pub fn encode(&self) -> [u8; SIGNATURE_BLOCK_BYTES] {
        let mut bytes = [0_u8; SIGNATURE_BLOCK_BYTES];
        bytes[..SIGNATURE_PREFIX_BYTES].copy_from_slice(&self.prefix.encode());
        bytes[SIGNATURE_PREFIX_BYTES..].copy_from_slice(&self.signature);
        bytes
    }

    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != SIGNATURE_BLOCK_BYTES {
            return Err(Error::SignatureFailure);
        }
        Ok(Self {
            prefix: SignaturePrefix::parse(&bytes[..SIGNATURE_PREFIX_BYTES])?,
            signature: bytes[SIGNATURE_PREFIX_BYTES..]
                .try_into()
                .map_err(|_| Error::SignatureFailure)?,
        })
    }
}

fn validate_key_id(bytes: &[u8]) -> Result<()> {
    if bytes.is_empty()
        || bytes.len() > 32
        || !bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_' || *byte == b'-'
        })
    {
        return Err(Error::SignatureFailure);
    }
    Ok(())
}

pub fn signing_digest(prefix_covered_bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(prefix_covered_bytes).into()
}

pub fn signing_message(digest: &[u8; 32]) -> Vec<u8> {
    let mut message = Vec::with_capacity(SIGNATURE_DOMAIN.len() + digest.len());
    message.extend_from_slice(SIGNATURE_DOMAIN);
    message.extend_from_slice(digest);
    message
}

pub fn verify_archive_signature(
    trusted_key: &[u8; 32],
    digest: &[u8; 32],
    signature: &[u8; 64],
) -> Result<()> {
    let key = VerifyingKey::from_bytes(trusted_key).map_err(|_| Error::SignatureFailure)?;
    key.verify_strict(&signing_message(digest), &Signature::from_bytes(signature))
        .map_err(|_| Error::SignatureFailure)
}

pub fn sha256_reader<R: Read>(reader: &mut R, max_bytes: u64) -> Result<([u8; 32], u64)> {
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = Zeroizing::new([0_u8; 64 * 1024]);
    loop {
        let read = reader.read(&mut buffer[..]).map_err(|_| Error::Io)?;
        if read == 0 {
            break;
        }
        total = total.checked_add(read as u64).ok_or(Error::LimitExceeded)?;
        if total > max_bytes {
            return Err(Error::LimitExceeded);
        }
        hasher.update(&buffer[..read]);
    }
    Ok((hasher.finalize().into(), total))
}

/// Hashes exactly `expected_bytes` and rejects both truncation and trailing data.
pub fn sha256_reader_exact<R: Read>(reader: &mut R, expected_bytes: u64) -> Result<[u8; 32]> {
    if expected_bytes > MAX_FINALIZED_ARCHIVE_BYTES {
        return Err(Error::LimitExceeded);
    }
    let mut hasher = Sha256::new();
    let mut remaining = expected_bytes;
    let mut buffer = Zeroizing::new([0_u8; 64 * 1024]);
    while remaining != 0 {
        let requested = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| Error::LimitExceeded)?;
        let read = reader
            .read(&mut buffer[..requested])
            .map_err(|_| Error::Io)?;
        if read == 0 {
            return Err(Error::TruncatedInput);
        }
        hasher.update(&buffer[..read]);
        remaining -= read as u64;
    }
    let mut trailing = [0_u8; 1];
    if reader.read(&mut trailing).map_err(|_| Error::Io)? != 0 {
        return Err(Error::OutOfBounds);
    }
    Ok(hasher.finalize().into())
}

pub fn fingerprint_reader<R: Read>(reader: &mut R) -> Result<(String, u64)> {
    let (digest, size) = sha256_reader(reader, MAX_FINALIZED_ARCHIVE_BYTES)?;
    Ok((lowercase_hex(&digest), size))
}

pub fn fingerprint_bytes(bytes: &[u8]) -> Result<String> {
    let size = u64::try_from(bytes.len()).map_err(|_| Error::LimitExceeded)?;
    if size > MAX_FINALIZED_ARCHIVE_BYTES {
        return Err(Error::LimitExceeded);
    }
    Ok(lowercase_hex(&Sha256::digest(bytes)))
}

pub fn lowercase_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn read_u16(bytes: &[u8]) -> Result<u16> {
    Ok(u16::from_le_bytes(
        bytes.try_into().map_err(|_| Error::TruncatedInput)?,
    ))
}

fn read_u32(bytes: &[u8]) -> Result<u32> {
    Ok(u32::from_le_bytes(
        bytes.try_into().map_err(|_| Error::TruncatedInput)?,
    ))
}

fn read_u64(bytes: &[u8]) -> Result<u64> {
    Ok(u64::from_le_bytes(
        bytes.try_into().map_err(|_| Error::TruncatedInput)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_bytes(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let digit = |byte: u8| match byte {
                    b'0'..=b'9' => byte - b'0',
                    b'a'..=b'f' => byte - b'a' + 10,
                    _ => panic!("invalid test hex"),
                };
                (digit(pair[0]) << 4) | digit(pair[1])
            })
            .collect()
    }

    fn test_keys(header: &[u8]) -> DerivedKeys {
        derive_keys(header, &ArchiveContentKey::from_bytes([0x11; 32])).unwrap()
    }

    #[test]
    fn ack_and_derived_keys_are_redacted() {
        let ack = ArchiveContentKey::from_bytes([0x11; 32]);
        assert_eq!(format!("{ack:?}"), "ArchiveContentKey([REDACTED])");
        assert_eq!(
            format!("{:?}", derive_keys(b"{}", &ack).unwrap()),
            "DerivedKeys([REDACTED])"
        );
    }

    #[test]
    fn all_encryption_profiles_roundtrip_and_fail_closed() {
        let header = b"{\"archive_id\":\"arc_test_01\"}";
        let hash = header_hash(header);
        let keys = test_keys(header);

        let manifest = encrypt_manifest(&keys, &hash, b"{\"files\":[]}").unwrap();
        assert_eq!(
            &**decrypt_manifest(&keys, &hash, &manifest).unwrap(),
            b"{\"files\":[]}"
        );
        assert!(decrypt_manifest(&test_keys(b"different"), &hash, &manifest).is_err());

        let index_plaintext = encode_idx1(&[]).unwrap();
        let index = encrypt_index(&keys, &hash, &index_plaintext).unwrap();
        assert_eq!(
            &**decrypt_index(&keys, &hash, &index).unwrap(),
            &index_plaintext
        );

        let chunk = encrypt_chunk(&keys, &hash, 7, b"protected").unwrap();
        assert_eq!(
            &**decrypt_chunk(&keys, &hash, 7, 9, &chunk).unwrap(),
            b"protected"
        );
        assert!(decrypt_chunk(&keys, &hash, 8, 9, &chunk).is_err());
        assert!(decrypt_chunk(&keys, &header_hash(b"other"), 7, 9, &chunk).is_err());
        let mut tampered = chunk;
        tampered[0] ^= 1;
        assert!(decrypt_chunk(&keys, &hash, 7, 9, &tampered).is_err());
    }

    #[test]
    fn frozen_interoperability_crypto_vector_matches_exactly() {
        let header = br#"{"archive_id":"arc_test_01","backend":{"archive_api_id":"arc_test_01"},"commercial_snapshot":{"platform_fee_bps":500,"price_amount":"10.000000","price_currency":"USDC"},"created_at":"2026-09-07T00:00:00Z","creator_wallet":"11111111111111111111111111111111","crypto":{"chunk_size":1048576,"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256"},"format":"solarch","license_snapshot":{"allow_export":false,"max_devices":1,"watermark_enabled":true},"title":"Test archive","version":"1.0.0"}"#;
        let manifest = br#"{"archive_id":"arc_test_01","files":[{"chunks":[0],"display_name":"a.png","file_id":"file_000000","hash":"5e3d382db4dd83d59aa5742793ad6b7903409e865c83bcbc54835049f043bc15","mime_type":"image/png","path":"a.png","size_bytes":68,"viewer_policy":{"export_allowed":false,"internal_viewer_only":true,"watermark_required":true}}]}"#;
        let ack = ArchiveContentKey::from_bytes(std::array::from_fn(|index| 0xa0 + index as u8));
        let hash = header_hash(header);
        assert_eq!(
            lowercase_hex(&hash),
            "a5010b5fd7206692fe71fe28deca70c4d1597b6eeed75027e7597bdfe0731a75"
        );
        let keys = derive_keys(header, &ack).unwrap();

        let expected_manifest = hex_bytes("79ee84cbd6e42653f5e2a244dc8b287cbedf09339896f54d9602144166e1a918d586d19e75e24cf5c07f91c6f96916336a520f1d298733a6b78df99c4b7c13e35486406030133467ffdf50ce0a6678ba5741874c560b05ac873027c6b31c33906393aa678bf7ca9c89c48049a77633170eb80733b2e160ccdc011bbe5d7846bd523402c476051e423d3aba7cfa2d4f260d1837244d4b7422e3e85fa6ce7c443304cb8d31e378c44ce198de51bed1f90d4b8bba995b3f792a62b45b3c4d0b9aafc5152a3b1a72ae47bc7872e732e42abc40ae809361e1db9a17b0ce0ca43e050cea29a4426dd716b79ae4f11b4c679eb507b06f63cb8589a7f114f7eda1082357674b3f2f879090e8e56be1fa558bba60248bfc302680e0f46d7032d3588c3a12893c0aec68399cf634700563e02587e2585d7029261757c7a73120b3e19e93c7434d82b385967b8057d0bc63da747784fe9a8367");
        assert_eq!(
            encrypt_manifest(&keys, &hash, manifest).unwrap(),
            expected_manifest
        );

        let records = [IndexRecord {
            offset: 8,
            ciphertext_length: 84,
            plaintext_length: 68,
        }];
        let index = encode_idx1(&records).unwrap();
        assert_eq!(
            lowercase_hex(&index),
            "494458310100000008000000000000005400000044000000"
        );
        assert_eq!(
            encrypt_index(&keys, &hash, &index).unwrap(),
            hex_bytes(
                "5df3ca881f32f9a43a87b8095a550009f49be63b940cd73d36c702f14489fb701904ef1422a469a9"
            )
        );

        let png = hex_bytes("89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da63fcff1f0003030200efa2a75b0000000049454e44ae426082");
        let encrypted_chunk = encrypt_chunk(&keys, &hash, 0, &png).unwrap();
        assert_eq!(
            encrypted_chunk,
            hex_bytes("315d2432544a0b8df8cb69349dd3a49fc4cf2dce1d82809d31f9f6d850acab622d21eb9e9e37efcd1a3e8bc57e4d9125d4069fc1f3d1511fab1d9a38769d88197ef980e788a4042d589917eaf9ac88a81b672bf8")
        );
        let mut data = b"DAT1\x01\0\0\0".to_vec();
        data.extend_from_slice(&encrypted_chunk);
        validate_dat1(&data, &records).unwrap();

        assert_eq!(
            lowercase_hex(&SignaturePrefix::new("arc-test-01").unwrap().encode()),
            "53494731010001006172632d746573742d3031000000000000000000000000000000000000000000"
        );
        let signing_digest: [u8; 32] = [
            0x7a, 0xcf, 0xe5, 0xc1, 0xf4, 0x5a, 0x80, 0xad, 0xe6, 0x1e, 0xd4, 0x80, 0xb3, 0x8d,
            0xb5, 0x63, 0x7b, 0xe3, 0x49, 0x36, 0xf2, 0x50, 0x08, 0x84, 0x56, 0x40, 0xc0, 0xf6,
            0xeb, 0x4f, 0x5f, 0xbb,
        ];
        assert_eq!(
            lowercase_hex(&signing_message(&signing_digest)),
            "536f6c417263682f736c722d7369676e61747572652f7631007acfe5c1f45a80ade61ed480b38db5637be34936f25008845640c0f6eb4f5fbb"
        );
        let trusted_key: [u8; 32] =
            hex_bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8")
                .try_into()
                .unwrap();
        let signature: [u8; 64] = hex_bytes("c4a6d3fc35aa654f10334e72490f259d1ce65d5d12a2aca2ee478c561be67782631b07257a36636e3ab250d972e4dc133e54e2803bf7c6176901ae73c3d7ee07").try_into().unwrap();
        verify_archive_signature(&trusted_key, &signing_digest, &signature).unwrap();
        let mut wrong_digest = signing_digest;
        wrong_digest[0] ^= 1;
        assert!(verify_archive_signature(&trusted_key, &wrong_digest, &signature).is_err());
    }

    #[test]
    fn idx1_dat1_are_exact_and_contiguous() {
        let records = [
            IndexRecord {
                offset: 8,
                ciphertext_length: 19,
                plaintext_length: 3,
            },
            IndexRecord {
                offset: 27,
                ciphertext_length: 21,
                plaintext_length: 5,
            },
        ];
        let encoded = encode_idx1(&records).unwrap();
        assert_eq!(encoded.len(), 40);
        assert_eq!(decode_idx1(&encoded).unwrap(), records);

        let mut data = b"DAT1\x02\0\0\0".to_vec();
        data.extend_from_slice(&[1; 19]);
        data.extend_from_slice(&[2; 21]);
        validate_dat1(&data, &records).unwrap();
        assert_eq!(indexed_chunk(&data, &records, 1).unwrap(), &[2; 21]);

        let mut bad_records = records;
        bad_records[1].offset += 1;
        assert!(encode_idx1(&bad_records).is_err());
        data.push(0);
        assert!(validate_dat1(&data, &records).is_err());

        assert_eq!(encode_idx1(&[]).unwrap(), b"IDX1\0\0\0\0");
        validate_dat1(b"DAT1\0\0\0\0", &[]).unwrap();
    }

    #[test]
    fn sig1_prefix_and_block_are_exact() {
        let prefix = SignaturePrefix::new("archive_key-1").unwrap();
        let encoded = prefix.encode();
        assert_eq!(encoded.len(), 40);
        assert_eq!(SignaturePrefix::parse(&encoded).unwrap(), prefix);

        let block = SignatureBlock {
            prefix,
            signature: [0xa5; 64],
        };
        let encoded = block.encode();
        assert_eq!(encoded.len(), 104);
        assert_eq!(SignatureBlock::parse(&encoded).unwrap(), block);

        for invalid in ["", "UPPER", "has.dot", "contains space"] {
            assert!(SignaturePrefix::new(invalid).is_err());
        }
        let mut embedded_nul = SignaturePrefix::new("ok").unwrap().encode();
        embedded_nul[11] = b'x';
        assert!(SignaturePrefix::parse(&embedded_nul).is_err());
    }

    #[test]
    fn signing_and_fingerprint_hash_exact_bytes() {
        let digest = signing_digest(b"pending bytes");
        let message = signing_message(&digest);
        assert_eq!(&message[..SIGNATURE_DOMAIN.len()], SIGNATURE_DOMAIN);
        assert_eq!(&message[SIGNATURE_DOMAIN.len()..], &digest);

        let mut input = std::io::Cursor::new(b"abc");
        let (fingerprint, size) = fingerprint_reader(&mut input).unwrap();
        assert_eq!(size, 3);
        assert_eq!(
            fingerprint,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let mut oversized = std::io::Cursor::new(b"abcd");
        assert!(sha256_reader(&mut oversized, 3).is_err());

        let mut exact = std::io::Cursor::new(b"abc");
        assert_eq!(
            sha256_reader_exact(&mut exact, 3).unwrap(),
            <[u8; 32]>::from(Sha256::digest(b"abc"))
        );
        let mut short = std::io::Cursor::new(b"ab");
        assert!(matches!(
            sha256_reader_exact(&mut short, 3),
            Err(Error::TruncatedInput)
        ));
        let mut trailing = std::io::Cursor::new(b"abcd");
        assert!(matches!(
            sha256_reader_exact(&mut trailing, 3),
            Err(Error::OutOfBounds)
        ));
    }
}
