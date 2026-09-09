use std::collections::BTreeMap;

#[cfg(any(test, feature = "development-fixtures"))]
use base64::{engine::general_purpose::STANDARD, Engine as _};
use solarch_core::license::LicenseTrustStore;

use crate::error::ViewerError;

pub struct TrustConfig {
    pub archive_keys: ArchiveTrustStore,
    pub license_keys: LicenseTrustStore,
}

#[derive(Default)]
pub struct ArchiveTrustStore(BTreeMap<String, [u8; 32]>);

impl ArchiveTrustStore {
    pub fn key(&self, key_id: &str) -> Result<[u8; 32], ViewerError> {
        self.0
            .get(key_id)
            .copied()
            .ok_or(ViewerError::UntrustedArchive)
    }

    #[cfg(any(test, feature = "development-fixtures"))]
    fn from_keys(keys: impl IntoIterator<Item = (String, [u8; 32])>) -> Result<Self, ViewerError> {
        let mut values = BTreeMap::new();
        for (key_id, key) in keys {
            if values.insert(key_id, key).is_some() {
                return Err(ViewerError::Internal);
            }
        }
        Ok(Self(values))
    }
}

impl TrustConfig {
    pub fn production() -> Self {
        Self {
            archive_keys: ArchiveTrustStore::default(),
            license_keys: LicenseTrustStore::default(),
        }
    }

    pub fn for_current_build() -> Result<Self, ViewerError> {
        #[cfg(any(test, feature = "development-fixtures"))]
        {
            Self::development_fixtures()
        }
        #[cfg(not(any(test, feature = "development-fixtures")))]
        {
            Ok(Self::production())
        }
    }

    #[cfg(any(test, feature = "development-fixtures"))]
    pub fn development_fixtures() -> Result<Self, ViewerError> {
        let archive = decode_key("A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=")?;
        let license = decode_key("JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0=")?;
        Ok(Self {
            archive_keys: ArchiveTrustStore::from_keys([("arc-test-01".into(), archive)])?,
            license_keys: LicenseTrustStore::from_keys([("lic-test-01".into(), license)])
                .map_err(|_| ViewerError::Internal)?,
        })
    }
}

#[cfg(any(test, feature = "development-fixtures"))]
fn decode_key(value: &str) -> Result<[u8; 32], ViewerError> {
    STANDARD
        .decode(value)
        .map_err(|_| ViewerError::Internal)?
        .try_into()
        .map_err(|_| ViewerError::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_and_license_roles_are_disjoint() {
        let trust = TrustConfig::development_fixtures().unwrap();
        assert!(trust.archive_keys.key("arc-test-01").is_ok());
        assert!(trust.archive_keys.key("lic-test-01").is_err());
    }

    #[test]
    fn production_archive_trust_is_empty_and_fails_closed() {
        let trust = TrustConfig::production();
        assert!(trust.archive_keys.key("arc-test-01").is_err());
        let _license_trust = trust.license_keys;
    }
}
