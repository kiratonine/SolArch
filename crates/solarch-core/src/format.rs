//! Exact frozen `.slr` v1 prelude and Public Header codec.
//!
//! Prelude: `SOLARCH\0` (8 bytes), major u16 LE = 1, minor u16 LE = 0,
//! reserved u32 LE = 0, then five (offset u64 LE, length u64 LE) pairs.
//! Sections in order: public header JSON UTF-8, encrypted manifest, encrypted
//! index, encrypted content and SIG1. Structural parsing remains UNVERIFIED.
use crate::{canonical, integrity::checked_range, Error, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;

pub const MAGIC: &[u8; 8] = b"SOLARCH\0";
pub const PRELUDE_LEN: usize = 96;
pub const MAX_HEADER: usize = 64 * 1024;
pub const MAX_CONTAINER: usize = 1024 * 1024 * 1024;
pub const MAX_ENCRYPTED_MANIFEST: usize = 16 * 1024 * 1024;
pub const MAX_ENCRYPTED_INDEX: usize = 262_168;
pub const MAX_ENCRYPTED_DATA: usize = 8 + 512 * 1024 * 1024 + 16_384 * 16;
pub const SIGNATURE_BLOCK_LEN: usize = 104;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
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
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CommercialSnapshot {
    pub price_amount: String,
    pub price_currency: String,
    pub platform_fee_bps: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LicenseSnapshot {
    pub max_devices: u32,
    pub allow_export: bool,
    pub watermark_enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Backend {
    pub archive_api_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CryptoMetadata {
    pub content_algorithm: String,
    pub kdf: String,
    pub chunk_size: u32,
}

impl PublicHeader {
    pub fn validate(&self) -> Result<()> {
        if self.format != "solarch"
            || self.version != "1.0.0"
            || !valid_id(&self.archive_id)
            || self.backend.archive_api_id != self.archive_id
            || self.title.is_empty()
            || self.title.len() > 1024
            || self.title.contains('\0')
            || !valid_timestamp(&self.created_at)
            || !valid_wallet(&self.creator_wallet)
            || self.commercial_snapshot.price_currency != "USDC"
            || self.commercial_snapshot.platform_fee_bps != 500
            || self.license_snapshot.max_devices != 1
            || self.license_snapshot.allow_export
            || !self.license_snapshot.watermark_enabled
            || self.crypto.content_algorithm != "XChaCha20-Poly1305"
            || self.crypto.kdf != "HKDF-SHA-256"
            || self.crypto.chunk_size != 1_048_576
            || !valid_price(&self.commercial_snapshot.price_amount)
        {
            return Err(Error::InvalidHeader);
        }
        Ok(())
    }

    pub fn to_jcs(&self) -> Result<Vec<u8>> {
        self.validate()?;
        canonical::to_jcs(self)
    }
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn valid_wallet(value: &str) -> bool {
    bs58::decode(value)
        .into_vec()
        .ok()
        .filter(|bytes| bytes.len() == 32)
        .is_some_and(|bytes| bs58::encode(bytes).into_string() == value)
}

pub fn parse_timestamp(value: &str) -> Option<time::OffsetDateTime> {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19) && !byte.is_ascii_digit()
        })
    {
        return None;
    }
    let parse = |range: std::ops::Range<usize>| {
        std::str::from_utf8(&bytes[range]).ok()?.parse::<u32>().ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0..4),
        parse(5..7),
        parse(8..10),
        parse(11..13),
        parse(14..16),
        parse(17..19),
    ) else {
        return None;
    };
    if !(1970..=9999).contains(&year) || second > 59 {
        return None;
    }
    let Ok(month) = time::Month::try_from(month as u8) else {
        return None;
    };
    let date = time::Date::from_calendar_date(year as i32, month, day as u8).ok()?;
    let clock = time::Time::from_hms(hour as u8, minute as u8, second as u8).ok()?;
    Some(date.with_time(clock).assume_utc())
}

pub(crate) fn valid_timestamp(value: &str) -> bool {
    parse_timestamp(value).is_some()
}

fn valid_price(value: &str) -> bool {
    if value.is_empty() || value.len() > 21 {
        return false;
    }
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next().unwrap_or_default();
    if whole.is_empty()
        || fraction.len() != 6
        || parts.next().is_some()
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || !fraction.bytes().all(|c| c.is_ascii_digit())
        || (whole.len() > 1 && whole.starts_with('0'))
        || whole.len() + fraction.len() > 20
    {
        return false;
    }
    let Some(units) = whole
        .parse::<u64>()
        .ok()
        .and_then(|amount| amount.checked_mul(1_000_000))
        .and_then(|amount| amount.checked_add(fraction.parse::<u64>().ok()?))
    else {
        return false;
    };
    units > 0
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

pub fn parse_header(bytes: &[u8]) -> Result<PublicHeader> {
    let header: PublicHeader = canonical::parse_exact(bytes, Error::InvalidHeader)?;
    header.validate()?;
    Ok(header)
}

// Shared by slice parsing and seekable inspection so limits, gap/overlap checks,
// version dispatch and malformed-input behavior cannot drift between them.
pub(crate) fn section_ranges(prelude: &[u8], size_bytes: u64) -> Result<[Range<usize>; 5]> {
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
            1 => MAX_ENCRYPTED_MANIFEST,
            2 => MAX_ENCRYPTED_INDEX,
            3 => MAX_ENCRYPTED_DATA,
            4 => SIGNATURE_BLOCK_LEN,
            _ => MAX_CONTAINER,
        };
        let minimum = match i {
            0 => 1,
            1 => 17,
            2 => 24,
            3 => 8,
            4 => SIGNATURE_BLOCK_LEN,
            _ => unreachable!(),
        };
        if range.len() < minimum
            || range.len() > cap
            || (i == 4 && range.len() != SIGNATURE_BLOCK_LEN)
        {
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

pub(crate) fn encode_prelude(section_lengths: [u64; 5]) -> Result<[u8; PRELUDE_LEN]> {
    if section_lengths.contains(&0)
        || section_lengths[0] > MAX_HEADER as u64
        || section_lengths[1] > MAX_ENCRYPTED_MANIFEST as u64
        || section_lengths[2] > MAX_ENCRYPTED_INDEX as u64
        || section_lengths[3] > MAX_ENCRYPTED_DATA as u64
        || section_lengths[4] != SIGNATURE_BLOCK_LEN as u64
    {
        return Err(Error::LimitExceeded);
    }
    let mut bytes = [0_u8; PRELUDE_LEN];
    bytes[..8].copy_from_slice(MAGIC);
    bytes[8..10].copy_from_slice(&1_u16.to_le_bytes());
    let mut offset = PRELUDE_LEN as u64;
    for (index, length) in section_lengths.into_iter().enumerate() {
        let base = 16 + index * 16;
        bytes[base..base + 8].copy_from_slice(&offset.to_le_bytes());
        bytes[base + 8..base + 16].copy_from_slice(&length.to_le_bytes());
        offset = offset.checked_add(length).ok_or(Error::OutOfBounds)?;
    }
    if offset > MAX_CONTAINER as u64 {
        return Err(Error::LimitExceeded);
    }
    section_ranges(&bytes, offset)?;
    Ok(bytes)
}

pub(crate) fn declared_size(prelude: &[u8]) -> Result<u64> {
    if prelude.len() != PRELUDE_LEN {
        return Err(Error::TruncatedInput);
    }
    let offset = read_u64(prelude, 80)?;
    let length = read_u64(prelude, 88)?;
    offset.checked_add(length).ok_or(Error::OutOfBounds)
}

fn read_u64(bytes: &[u8], start: usize) -> Result<u64> {
    let slice = bytes.get(start..start + 8).ok_or(Error::TruncatedInput)?;
    let array = <[u8; 8]>::try_from(slice).map_err(|_| Error::TruncatedInput)?;
    Ok(u64::from_le_bytes(array))
}

/// Structural serialization helper. Opaque crypto sections must already follow
/// the production profile; this function itself never authenticates them.
pub fn serialize_structure(
    header: &PublicHeader,
    protected_sections: [&[u8]; 4],
) -> Result<Vec<u8>> {
    header.validate()?;
    let json = canonical::to_jcs(header)?;
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
        serde_json::from_str(r#"{"format":"solarch","version":"1.0.0","archive_id":"arc_test","created_at":"2026-09-07T00:00:00Z","title":"Synthetic fixture","creator_wallet":"11111111111111111111111111111111","commercial_snapshot":{"price_amount":"10.000000","price_currency":"USDC","platform_fee_bps":500},"license_snapshot":{"max_devices":1,"allow_export":false,"watermark_enabled":true},"backend":{"archive_api_id":"arc_test"},"crypto":{"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256","chunk_size":1048576}}"#).unwrap()
    }
    pub(super) fn fixture() -> Vec<u8> {
        serialize_structure(
            &header(),
            [
                &[1_u8; 17],
                &[2_u8; 24],
                &[3_u8; 8],
                &[0_u8; SIGNATURE_BLOCK_LEN],
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

        for timestamp in [
            "+026-09-07T00:00:00Z",
            "2026-00-07T00:00:00Z",
            "2026-02-30T00:00:00Z",
            "2026-09-07T24:00:00Z",
            "2026-09-07T00:00:60Z",
        ] {
            let mut h = header();
            h.created_at = timestamp.into();
            assert_eq!(h.validate(), Err(Error::InvalidHeader));
        }
    }

    #[test]
    fn public_header_requires_exact_closed_jcs() {
        let canonical = header().to_jcs().unwrap();
        assert!(parse_header(&canonical).unwrap() == header());

        let mut duplicate = br#"{"archive_id":"other","#.to_vec();
        duplicate.extend_from_slice(&canonical[1..]);
        assert!(matches!(
            parse_header(&duplicate),
            Err(Error::InvalidHeader)
        ));

        let mut unknown = br#"{"extra":1,"#.to_vec();
        unknown.extend_from_slice(&canonical[1..]);
        assert!(matches!(parse_header(&unknown), Err(Error::InvalidHeader)));

        let mut noncanonical = canonical;
        noncanonical.push(b'\n');
        assert!(matches!(
            parse_header(&noncanonical),
            Err(Error::InvalidHeader)
        ));
    }

    #[test]
    fn encrypted_data_limit_is_enforced_by_prelude() {
        let mut lengths = [1, 17, 24, MAX_ENCRYPTED_DATA as u64, 104];
        assert!(encode_prelude(lengths).is_ok());
        lengths[3] += 1;
        assert_eq!(encode_prelude(lengths), Err(Error::LimitExceeded));
    }
}
