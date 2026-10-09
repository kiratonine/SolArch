use super::*;
use std::io::{self, Cursor};

// Test-only prelude creation deliberately bypasses PublicHeader::validate so
// parser tests exercise invalid untrusted policy, not just builder rejection.
fn metadata(header: &PublicHeader, content_size: u64) -> (Vec<u8>, u64) {
    let json = serde_jcs::to_vec(header).unwrap();
    let lengths = [
        json.len() as u64,
        17,
        24,
        content_size,
        SIGNATURE_BLOCK_LEN as u64,
    ];
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
    let mut end = PRELUDE_LEN as u64;
    for length in lengths {
        bytes.extend_from_slice(&end.to_le_bytes());
        bytes.extend_from_slice(&length.to_le_bytes());
        end += length;
    }
    bytes.extend_from_slice(&json);
    (bytes, end)
}

fn raw_small_container(header: &PublicHeader) -> Vec<u8> {
    let (mut bytes, total) = metadata(header, 8);
    bytes.resize(total as usize, 0);
    bytes
}

#[test]
fn mvp_policy_accepts_protected_watermarked_header() {
    let header = super::tests::header();
    assert_eq!(header.validate(), Ok(()));
    let bytes = raw_small_container(&header);
    assert!(parse_structure(&bytes).is_ok());
    let inspected = inspect_structure(&mut Cursor::new(&bytes)).unwrap();
    assert!(!inspected.header.license_snapshot.allow_export);
    assert!(inspected.header.license_snapshot.watermark_enabled);
}

#[test]
fn unsafe_mvp_policies_rejected_by_validation_serialization_and_both_parsers() {
    for (allow_export, watermark_enabled) in [(true, true), (false, false), (true, false)] {
        let mut header = super::tests::header();
        header.license_snapshot.allow_export = allow_export;
        header.license_snapshot.watermark_enabled = watermark_enabled;
        assert_eq!(header.validate(), Err(Error::InvalidHeader));
        assert!(matches!(
            serialize_structure(&header, [b"a"; 4]),
            Err(Error::InvalidHeader)
        ));
        let bytes = raw_small_container(&header);
        assert!(matches!(parse_structure(&bytes), Err(Error::InvalidHeader)));
        assert!(matches!(
            inspect_structure(&mut Cursor::new(bytes)),
            Err(Error::InvalidHeader)
        ));
    }
}

// Models a large sparse stream but disallows every read past metadata. Unlike a
// sparse-file success test alone, this proves opaque sections aren't read at all.
struct MetadataOnlyReader {
    prefix: Cursor<Vec<u8>>,
    total: u64,
    bytes_read: usize,
    changed_length: Option<u64>,
}

impl Read for MetadataOnlyReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.prefix.position() + output.len() as u64 > self.prefix.get_ref().len() as u64 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "read outside metadata",
            ));
        }
        let read = self.prefix.read(output)?;
        self.bytes_read += read;
        if self.prefix.position() == self.prefix.get_ref().len() as u64 {
            if let Some(length) = self.changed_length.take() {
                self.total = length;
            }
        }
        Ok(read)
    }
}

impl Seek for MetadataOnlyReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let position = match from {
            SeekFrom::Start(position) => i128::from(position),
            SeekFrom::End(offset) => i128::from(self.total) + i128::from(offset),
            SeekFrom::Current(offset) => i128::from(self.prefix.position()) + i128::from(offset),
        };
        let position =
            u64::try_from(position).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        self.prefix.set_position(position);
        Ok(position)
    }
}

fn large_reader() -> MetadataOnlyReader {
    let header = super::tests::header();
    let (bytes, total) = metadata(&header, MAX_ENCRYPTED_DATA as u64);
    MetadataOnlyReader {
        prefix: Cursor::new(bytes),
        total,
        bytes_read: 0,
        changed_length: None,
    }
}

#[test]
fn seek_inspection_reads_only_metadata_at_maximum_data_size() {
    let mut reader = large_reader();
    // Public API always starts at byte zero, even if caller has sought elsewhere.
    reader.seek(SeekFrom::Start(123)).unwrap();
    let inspected = inspect_structure(&mut reader).unwrap();
    assert_eq!(inspected.section_sizes[3], MAX_ENCRYPTED_DATA as u64);
    assert_eq!(reader.bytes_read, reader.prefix.get_ref().len());
    assert!(reader.bytes_read <= PRELUDE_LEN + MAX_HEADER);
    assert_eq!(
        inspected.section_sizes.iter().sum::<u64>() + PRELUDE_LEN as u64,
        inspected.size_bytes
    );
}

#[test]
fn seek_inspection_rejects_length_changes_and_oversized_container_or_header() {
    for delta in [-1, 1] {
        let mut reader = large_reader();
        reader.changed_length = Some((reader.total as i128 + delta) as u64);
        assert!(matches!(
            inspect_structure(&mut reader),
            Err(Error::OutOfBounds)
        ));
    }
    let mut reader = large_reader();
    reader.total = MAX_CONTAINER as u64 + 1;
    assert!(matches!(
        inspect_structure(&mut reader),
        Err(Error::LimitExceeded)
    ));
    assert_eq!(reader.bytes_read, PRELUDE_LEN);
    let mut reader = large_reader();
    reader.prefix.get_mut()[24..32].copy_from_slice(&(MAX_HEADER as u64 + 1).to_le_bytes());
    assert!(matches!(
        inspect_structure(&mut reader),
        Err(Error::LimitExceeded)
    ));
    assert_eq!(reader.bytes_read, PRELUDE_LEN);
}

#[test]
fn seek_and_slice_parsers_agree_on_corruption_and_all_truncations() {
    let valid = super::tests::fixture();
    let assert_same_failure = |bytes: &[u8]| {
        let expected = parse_structure(bytes).map(|_| ());
        assert!(expected.is_err());
        assert_eq!(
            inspect_structure(&mut Cursor::new(bytes)).map(|_| ()),
            expected
        );
    };
    for end in 0..valid.len() {
        assert_same_failure(&valid[..end]);
    }
    for index in [0, 8, 10, 12, PRELUDE_LEN] {
        let mut bytes = valid.clone();
        bytes[index] ^= 2;
        assert_same_failure(&bytes);
    }
    for base in (16..96).step_by(8) {
        for value in [0_u64, 1, u64::MAX] {
            let mut bytes = valid.clone();
            bytes[base..base + 8].copy_from_slice(&value.to_le_bytes());
            assert_same_failure(&bytes);
        }
    }
    let mut trailing = valid;
    trailing.push(0);
    assert_same_failure(&trailing);
}
