//! Core-owned structural v1 encoding (SLR_FORMAT §§3–4 delegate widths to Core).
//!
//! Prelude: `SOLARCH\0` (8 bytes), major u16 LE = 1, minor u16 LE = 0,
//! reserved u32 LE = 0, then five (offset u64 LE, length u64 LE) pairs.
//! Sections in order: public header JSON UTF-8, encrypted manifest, encrypted
//! index, encrypted content, opaque signature/integrity block. Prelude = 96 bytes.
//! Sections are contiguous with no gaps/trailing bytes. Header <= 64 KiB;
//! manifest/index <= 16 MiB each; total <= 1 GiB. No crypto wire profile is
//! implied: successful structural parsing is NEVER signature verification.
use crate::{integrity::checked_range, Error, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;

pub const MAGIC: &[u8; 8] = b"SOLARCH\0";
pub const PRELUDE_LEN: usize = 96;
pub const MAX_HEADER: usize = 64 * 1024;
pub const MAX_CONTAINER: usize = 1024 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicHeader {
    pub format: String,
    pub version: String,
    pub archive_id: String,
    pub created_at: String,
    pub title: String,
    pub creator_wallet: String,
    pub commercial_snapshot: CommercialSnapshot,
    pub license_snapshot: LicenseSnapshot,
    pub backend: Backend,
    pub crypto: CryptoMetadata,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CommercialSnapshot {
    pub price_amount: String,
    pub price_currency: String,
    pub platform_fee_bps: u16,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LicenseSnapshot {
    pub max_devices: u32,
    pub allow_export: bool,
    pub watermark_enabled: bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Backend {
    pub archive_api_id: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CryptoMetadata {
    pub content_algorithm: String,
    pub chunk_size: u32,
}

impl PublicHeader {
    pub fn validate(&self) -> Result<()> {
        let text = [
            &self.archive_id,
            &self.created_at,
            &self.title,
            &self.creator_wallet,
            &self.backend.archive_api_id,
            &self.crypto.content_algorithm,
        ];
        if self.format != "solarch"
            || self.version != "1.0.0"
            || text
                .iter()
                .any(|s| s.is_empty() || s.len() > 4096 || s.chars().any(char::is_control))
            || self.backend.archive_api_id != self.archive_id
            || self.commercial_snapshot.price_currency != "USDC"
            || self.commercial_snapshot.platform_fee_bps != 500
            || self.license_snapshot.max_devices != 1
            || self.license_snapshot.allow_export
            || !self.license_snapshot.watermark_enabled
            || self.crypto.chunk_size == 0
            || self.crypto.chunk_size > 1024 * 1024
            || !valid_decimal(&self.commercial_snapshot.price_amount)
        {
            return Err(Error::InvalidHeader);
        }
        Ok(())
    }
}

fn valid_decimal(value: &str) -> bool {
    if value.is_empty() || value.len() > 32 {
        return false;
    }
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or_default();
    if whole.is_empty() || !whole.bytes().all(|c| c.is_ascii_digit()) {
        return false;
    }
    if let Some(fraction) = parts.next() {
        if fraction.is_empty()
            || fraction.len() > 6
            || !fraction.bytes().all(|c| c.is_ascii_digit())
        {
            return false;
        }
    }
    parts.next().is_none()
}

/// An explicitly UNVERIFIED parse: no API here can authorize opening content.
pub struct UnverifiedContainer<'a> {
    pub header: PublicHeader,
    pub sections: [&'a [u8]; 5],
}

/// Public metadata from a seekable container. Protected sections are not read or
/// authenticated. The same structural limits apply as for `parse_structure`.
pub struct UnverifiedInspection {
    pub header: PublicHeader,
    pub size_bytes: u64,
    pub section_sizes: [u64; 5],
}

/// Reads only the fixed prelude and bounded public header, irrespective of the
/// encrypted content length. Offsets are validated against the actual stream
/// length; encrypted sections are never allocated, read or deserialized here.
/// Successful inspection is not signature or content verification.
pub fn inspect_structure(reader: &mut (impl Read + Seek)) -> Result<UnverifiedInspection> {
    let size_bytes = reader.seek(SeekFrom::End(0)).map_err(|_| Error::Io)?;
    reader.seek(SeekFrom::Start(0)).map_err(|_| Error::Io)?;
    let mut prelude = [0; PRELUDE_LEN];
    let prefix_len = size_bytes.min(PRELUDE_LEN as u64) as usize;
    reader
        .read_exact(&mut prelude[..prefix_len])
        .map_err(read_error)?;
    let ranges = section_ranges(&prelude[..prefix_len], size_bytes)?;
    let mut header_bytes = vec![0; ranges[0].len()];
    reader.read_exact(&mut header_bytes).map_err(read_error)?;
    let header = parse_header(&header_bytes)?;
    // Detect truncation/growth while reading metadata. This is not a filesystem
    // transaction and makes no claim to detect same-length content replacement.
    if reader.seek(SeekFrom::End(0)).map_err(|_| Error::Io)? != size_bytes {
        return Err(Error::OutOfBounds);
    }
    Ok(UnverifiedInspection {
        header,
        size_bytes,
        section_sizes: ranges.map(|range| range.len() as u64),
    })
}

fn read_error(error: std::io::Error) -> Error {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        Error::TruncatedInput
    } else {
        Error::Io
    }
}

pub fn parse_structure(bytes: &[u8]) -> Result<UnverifiedContainer<'_>> {
    let ranges = section_ranges(bytes, bytes.len() as u64)?;
    let sections = ranges.map(|range| &bytes[range]);
    let header = parse_header(sections[0])?;
    Ok(UnverifiedContainer { header, sections })
}

fn parse_header(bytes: &[u8]) -> Result<PublicHeader> {
    let header: PublicHeader = serde_json::from_slice(bytes).map_err(|_| Error::InvalidHeader)?;
    header.validate()?;
    Ok(header)
}

// Shared by slice parsing and seekable inspection so limits, gap/overlap checks,
// version dispatch and malformed-input behavior cannot drift between them.
fn section_ranges(prelude: &[u8], size_bytes: u64) -> Result<[Range<usize>; 5]> {
    if prelude.len() < 8 {
        return Err(Error::TruncatedInput);
    }
    if prelude.get(..8) != Some(MAGIC.as_slice()) {
        return Err(Error::InvalidMagic);
    }
    if prelude.len() < PRELUDE_LEN {
        return Err(Error::TruncatedInput);
    }
    if size_bytes > MAX_CONTAINER as u64 {
        return Err(Error::LimitExceeded);
    }
    let total = usize::try_from(size_bytes).map_err(|_| Error::OutOfBounds)?;
    if prelude[8..12] != [1, 0, 0, 0] {
        return Err(Error::UnsupportedVersion);
    }
    if prelude[12..16] != [0; 4] {
        return Err(Error::InvalidHeader);
    }
    let mut ranges = std::array::from_fn(|_| 0..0);
    let mut expected = PRELUDE_LEN;
    for (i, section) in ranges.iter_mut().enumerate() {
        let base = 16 + i * 16;
        let offset = read_u64(prelude, base)?;
        let len = read_u64(prelude, base + 8)?;
        if len == 0 {
            return Err(Error::InvalidChunkMetadata);
        }
        let range = checked_range(offset, len, total)?;
        if range.start != expected {
            return Err(Error::OutOfBounds);
        }
        let cap = match i {
            0 => MAX_HEADER,
            1 | 2 => 16 * 1024 * 1024,
            4 => 64 * 1024,
            _ => MAX_CONTAINER,
        };
        if range.len() > cap {
            return Err(Error::LimitExceeded);
        }
        expected = range.end;
        *section = range;
    }
    if expected != total {
        return Err(Error::OutOfBounds);
    }
    Ok(ranges)
}

fn read_u64(bytes: &[u8], start: usize) -> Result<u64> {
    let slice = bytes.get(start..start + 8).ok_or(Error::TruncatedInput)?;
    let array = <[u8; 8]>::try_from(slice).map_err(|_| Error::TruncatedInput)?;
    Ok(u64::from_le_bytes(array))
}

/// Structural serialization only. Opaque crypto sections must be provided by a
/// future agreed crypto profile. Never labels output as authenticated `.slr`.
pub fn serialize_structure(
    header: &PublicHeader,
    protected_sections: [&[u8]; 4],
) -> Result<Vec<u8>> {
    header.validate()?;
    let json = serde_json::to_vec(header).map_err(|_| Error::Serialization)?;
    let sections = [
        json.as_slice(),
        protected_sections[0],
        protected_sections[1],
        protected_sections[2],
        protected_sections[3],
    ];
    let total = sections.iter().try_fold(PRELUDE_LEN, |size, section| {
        size.checked_add(section.len()).ok_or(Error::OutOfBounds)
    })?;
    if total > MAX_CONTAINER {
        return Err(Error::LimitExceeded);
    }
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
    let mut offset = PRELUDE_LEN;
    for section in sections {
        bytes.extend_from_slice(&(offset as u64).to_le_bytes());
        bytes.extend_from_slice(&(section.len() as u64).to_le_bytes());
        offset += section.len();
    }
    for section in sections {
        bytes.extend_from_slice(section);
    }
    parse_structure(&bytes)?;
    Ok(bytes)
}

#[cfg(test)]
#[path = "format_inspection_tests.rs"]
mod inspection_tests;

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) fn header() -> PublicHeader {
        serde_json::from_str(r#"{"format":"solarch","version":"1.0.0","archive_id":"arc_test","created_at":"2026-09-07T00:00:00Z","title":"Synthetic fixture","creator_wallet":"test-only-wallet","commercial_snapshot":{"price_amount":"10.00","price_currency":"USDC","platform_fee_bps":500},"license_snapshot":{"max_devices":1,"allow_export":false,"watermark_enabled":true},"backend":{"archive_api_id":"arc_test"},"crypto":{"content_algorithm":"test-only-opaque-profile","chunk_size":1048576}}"#).unwrap()
    }
    pub(super) fn fixture() -> Vec<u8> {
        serialize_structure(
            &header(),
            [
                b"manifest ciphertext",
                b"index ciphertext",
                b"chunk ciphertext",
                b"signature opaque",
            ],
        )
        .unwrap()
    }
    #[test]
    fn minimal_structural_roundtrip() {
        let bytes = fixture();
        let parsed = parse_structure(&bytes).unwrap();
        assert!(parsed.header == header());
        assert_eq!(
            serialize_structure(&parsed.header, parsed.sections[1..].try_into().unwrap()).unwrap(),
            bytes
        );
    }
    #[test]
    fn invalid_magic_version_reserved_and_all_truncations() {
        let valid = fixture();
        for end in 0..valid.len() {
            assert!(parse_structure(&valid[..end]).is_err());
        }
        for (position, error) in [
            (0, Error::InvalidMagic),
            (8, Error::UnsupportedVersion),
            (10, Error::UnsupportedVersion),
            (12, Error::InvalidHeader),
        ] {
            let mut bytes = valid.clone();
            bytes[position] ^= 2;
            assert!(matches!(parse_structure(&bytes), Err(e) if e == error));
        }
    }
    #[test]
    fn offset_length_overflow_overlap_gap_and_trailing_bytes() {
        for base in (16..96).step_by(8) {
            for value in [0, 1, u64::MAX] {
                let mut bytes = fixture();
                bytes[base..base + 8].copy_from_slice(&value.to_le_bytes());
                assert!(parse_structure(&bytes).is_err());
            }
        }
        let mut bytes = fixture();
        bytes.push(0);
        assert!(parse_structure(&bytes).is_err());
    }
    #[test]
    fn public_header_validation() {
        for price in ["", "NaN", "-1", "1e3", "1.1234567", "1.2.3"] {
            let mut h = header();
            h.commercial_snapshot.price_amount = price.into();
            assert!(h.validate().is_err());
        }
        let mut h = header();
        h.license_snapshot.max_devices = 2;
        assert!(h.validate().is_err());
        let mut bytes = fixture();
        bytes[PRELUDE_LEN] = 0;
        assert!(parse_structure(&bytes).is_err());
    }
}
