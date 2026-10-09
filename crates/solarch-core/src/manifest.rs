//! Exact closed JCS manifest model for `.slr` v1.

use serde::{Deserialize, Serialize};

use crate::canonical;
use crate::error::{Error, Result};
use crate::paths::{NormalizedPath, PathSet, ProtectedType};

pub const MAX_FILES: usize = 10_000;
pub const MAX_TOTAL_SIZE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_FILE_SIZE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_CHUNKS: u64 = 16_384;
pub const CHUNK_SIZE: u64 = 1_048_576;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub archive_id: String,
    pub files: Vec<ManifestFile>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestFile {
    pub file_id: String,
    pub path: NormalizedPath,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    /// Lowercase SHA-256 of complete original bytes.
    pub hash: String,
    pub chunks: Vec<u64>,
    pub viewer_policy: ViewerPolicy,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewerPolicy {
    pub internal_viewer_only: bool,
    pub export_allowed: bool,
    pub watermark_required: bool,
}

impl Default for ViewerPolicy {
    fn default() -> Self {
        Self {
            internal_viewer_only: true,
            export_allowed: false,
            watermark_required: true,
        }
    }
}

impl Manifest {
    pub fn validate(&self, expected_archive_id: &str, chunk_count: u64) -> Result<()> {
        if !valid_id(&self.archive_id) || self.archive_id != expected_archive_id {
            return Err(Error::InvalidManifest);
        }
        if self.files.is_empty() || self.files.len() > MAX_FILES || chunk_count > MAX_CHUNKS {
            return Err(Error::LimitExceeded);
        }
        let mut paths = PathSet::new();
        let mut next_chunk = 0_u64;
        let mut total_size = 0_u64;
        let mut previous_path: Option<&str> = None;
        for (ordinal, file) in self.files.iter().enumerate() {
            paths.insert_file(file.path.as_str())?;
            if previous_path.is_some_and(|path| path.as_bytes() >= file.path.as_str().as_bytes())
                || file.file_id != format!("file_{ordinal:06}")
                || file.display_name != file.path.as_str().rsplit('/').next().unwrap_or("")
                || file.display_name.is_empty()
                || file.display_name.len() > 255
                || !valid_hash(&file.hash)
                || ProtectedType::from_path(&file.path)?.mime_type() != file.mime_type
                || !file.viewer_policy.internal_viewer_only
                || file.viewer_policy.export_allowed
                || !file.viewer_policy.watermark_required
            {
                return Err(Error::InvalidManifest);
            }
            previous_path = Some(file.path.as_str());
            total_size = total_size
                .checked_add(file.size_bytes)
                .ok_or(Error::LimitExceeded)?;
            if total_size > MAX_TOTAL_SIZE_BYTES
                || file.size_bytes > MAX_FILE_SIZE_BYTES
                || file.chunks.len() as u64 > MAX_CHUNKS
            {
                return Err(Error::LimitExceeded);
            }
            if (file.size_bytes == 0) != file.chunks.is_empty() {
                return Err(Error::InvalidChunkMetadata);
            }
            let expected_chunks = if file.size_bytes == 0 {
                0
            } else {
                file.size_bytes.div_ceil(CHUNK_SIZE)
            };
            if file.chunks.len() as u64 != expected_chunks {
                return Err(Error::InvalidChunkMetadata);
            }
            for &chunk in &file.chunks {
                if chunk != next_chunk || chunk >= chunk_count {
                    return Err(Error::InvalidChunkMetadata);
                }
                next_chunk += 1;
            }
        }
        if next_chunk != chunk_count {
            return Err(Error::InvalidChunkMetadata);
        }
        Ok(())
    }

    pub fn to_jcs(&self, expected_archive_id: &str, chunk_count: u64) -> Result<Vec<u8>> {
        self.validate(expected_archive_id, chunk_count)?;
        canonical::to_jcs(self)
    }

    pub fn parse_exact(bytes: &[u8], expected_archive_id: &str, chunk_count: u64) -> Result<Self> {
        let manifest: Self = canonical::parse_exact(bytes, Error::InvalidManifest)?;
        manifest.validate(expected_archive_id, chunk_count)?;
        Ok(manifest)
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        Manifest {
            archive_id: "arc_test".into(),
            files: vec![ManifestFile {
                file_id: "file_000000".into(),
                path: NormalizedPath::new("course/a.pdf").unwrap(),
                display_name: "a.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: 3,
                hash: "00".repeat(32),
                chunks: vec![0],
                viewer_policy: ViewerPolicy::default(),
            }],
        }
    }

    #[test]
    fn metadata_round_trip_and_archive_binding() {
        let original = manifest();
        let bytes = serde_json::to_vec(&original).unwrap();
        let decoded: Manifest = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.validate("arc_test", 1), Ok(()));
        assert_eq!(decoded.validate("other", 1), Err(Error::InvalidManifest));
    }

    #[test]
    fn duplicate_paths_ids_and_chunks_rejected() {
        let mut value = manifest();
        value.files.push(value.files[0].clone());
        assert_eq!(
            value.validate("arc_test", 1),
            Err(Error::DuplicateNormalizedPath)
        );
        value.files[1].path = NormalizedPath::new("z.pdf").unwrap();
        assert_eq!(value.validate("arc_test", 1), Err(Error::InvalidManifest));
        value.files[1].file_id = "file_000001".into();
        value.files[1].display_name = "z.pdf".into();
        assert_eq!(
            value.validate("arc_test", 1),
            Err(Error::InvalidChunkMetadata)
        );
    }

    #[test]
    fn file_directory_prefix_conflicts_are_rejected() {
        let mut value = manifest();
        value.files[0].path = NormalizedPath::new("A.PDF/inside.png").unwrap();
        value.files[0].display_name = "inside.png".into();
        value.files[0].mime_type = "image/png".into();
        let mut second = manifest().files.remove(0);
        second.file_id = "file_000001".into();
        second.path = NormalizedPath::new("a.pdf").unwrap();
        value.files.push(second);
        assert_eq!(
            value.validate("arc_test", 2),
            Err(Error::DuplicateNormalizedPath)
        );
    }

    #[test]
    fn chunk_bounds_and_unreferenced_chunks_rejected() {
        let mut value = manifest();
        assert_eq!(
            value.validate("arc_test", 2),
            Err(Error::InvalidChunkMetadata)
        );
        value.files[0].chunks = vec![u64::MAX];
        assert_eq!(
            value.validate("arc_test", 1),
            Err(Error::InvalidChunkMetadata)
        );
        value.files[0].chunks.clear();
        assert_eq!(
            value.validate("arc_test", 1),
            Err(Error::InvalidChunkMetadata)
        );
        value.files[0].size_bytes = 0;
        assert_eq!(value.validate("arc_test", 0), Ok(()));
    }

    #[test]
    fn unsafe_policy_mime_and_metadata_rejected() {
        for mutation in 0..6 {
            let mut value = manifest();
            match mutation {
                0 => value.files[0].viewer_policy.export_allowed = true,
                1 => value.files[0].viewer_policy.watermark_required = false,
                2 => value.files[0].viewer_policy.internal_viewer_only = false,
                3 => value.files[0].mime_type = "application/octet-stream".into(),
                4 => value.files[0].display_name = "../a.pdf".into(),
                _ => value.files[0].hash.clear(),
            }
            assert_eq!(value.validate("arc_test", 1), Err(Error::InvalidManifest));
        }
    }

    #[test]
    fn size_and_count_limits_are_enforced() {
        let mut value = manifest();
        value.files[0].size_bytes = u64::MAX;
        assert_eq!(value.validate("arc_test", 1), Err(Error::LimitExceeded));
        assert_eq!(
            manifest().validate("arc_test", MAX_CHUNKS + 1),
            Err(Error::LimitExceeded)
        );
        value.files.clear();
        assert_eq!(value.validate("arc_test", 0), Err(Error::LimitExceeded));
    }
}
