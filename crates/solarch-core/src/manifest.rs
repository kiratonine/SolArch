//! Protected metadata model. Serialization here is not a production container codec.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::paths::{NormalizedPath, PathSet, ProtectedType};

pub const MAX_FILES: usize = 10_000;
pub const MAX_TOTAL_SIZE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub const MAX_CHUNKS: u64 = 1_000_000;

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
    /// Opaque caller-provided hash; no external hash encoding is established here.
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
    /// Validate after deserialization and before use. Chunk byte lengths must also
    /// be checked against the separately authenticated index by its consumer.
    pub fn validate(&self, expected_archive_id: &str, chunk_count: u64) -> Result<()> {
        if !valid_text(&self.archive_id, 256) || self.archive_id != expected_archive_id {
            return Err(Error::InvalidManifest);
        }
        if self.files.is_empty() || self.files.len() > MAX_FILES || chunk_count > MAX_CHUNKS {
            return Err(Error::LimitExceeded);
        }
        let mut paths = PathSet::new();
        let mut ids = HashSet::new();
        let mut chunks = HashSet::new();
        let mut total_size = 0_u64;
        for file in &self.files {
            paths.insert(file.path.as_str())?;
            if !valid_text(&file.file_id, 256)
                || !ids.insert(file.file_id.as_str())
                || !valid_text(&file.display_name, 255)
                || file.display_name.contains(['/', '\\'])
                || !valid_text(&file.hash, 1024)
                || ProtectedType::from_path(&file.path)?.mime_type() != file.mime_type
                || !file.viewer_policy.internal_viewer_only
                || file.viewer_policy.export_allowed
                || !file.viewer_policy.watermark_required
            {
                return Err(Error::InvalidManifest);
            }
            total_size = total_size
                .checked_add(file.size_bytes)
                .ok_or(Error::LimitExceeded)?;
            if total_size > MAX_TOTAL_SIZE_BYTES || file.chunks.len() as u64 > MAX_CHUNKS {
                return Err(Error::LimitExceeded);
            }
            if (file.size_bytes == 0) != file.chunks.is_empty() {
                return Err(Error::InvalidChunkMetadata);
            }
            for &chunk in &file.chunks {
                if chunk >= chunk_count || !chunks.insert(chunk) {
                    return Err(Error::InvalidChunkMetadata);
                }
            }
        }
        if chunks.len() as u64 != chunk_count {
            return Err(Error::InvalidChunkMetadata);
        }
        Ok(())
    }
}

fn valid_text(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        Manifest {
            archive_id: "arc_test".into(),
            files: vec![ManifestFile {
                file_id: "file_001".into(),
                path: NormalizedPath::new("course/a.pdf").unwrap(),
                display_name: "a.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: 3,
                hash: "opaque-caller-hash".into(),
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
        value.files[1].path = NormalizedPath::new("b.pdf").unwrap();
        assert_eq!(value.validate("arc_test", 1), Err(Error::InvalidManifest));
        value.files[1].file_id = "file_002".into();
        assert_eq!(
            value.validate("arc_test", 1),
            Err(Error::InvalidChunkMetadata)
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
