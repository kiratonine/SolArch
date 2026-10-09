use std::collections::BTreeMap;

#[cfg(any(test, feature = "development-fixtures", feature = "live-devnet"))]
use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(any(test, feature = "development-fixtures", feature = "live-devnet"))]
use ed25519_dalek::VerifyingKey;
use solarch_core::license::LicenseTrustStore;
#[cfg(any(test, feature = "development-fixtures", feature = "live-devnet"))]
use solarch_core::production_crypto::SignaturePrefix;

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

    #[cfg(any(test, feature = "development-fixtures", feature = "live-devnet"))]
    fn from_keys(keys: impl IntoIterator<Item = (String, [u8; 32])>) -> Result<Self, ViewerError> {
        let mut values = BTreeMap::new();
        for (key_id, key) in keys {
            if SignaturePrefix::new(&key_id).is_err()
                || VerifyingKey::from_bytes(&key).is_err()
                || values.insert(key_id, key).is_some()
            {
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
        #[cfg(test)]
        {
            Self::development_fixtures()
        }
        #[cfg(all(not(test), feature = "live-devnet"))]
        {
            Self::live_devnet_from_build()
        }
        #[cfg(all(
            not(test),
            not(feature = "live-devnet"),
            feature = "development-fixtures"
        ))]
        {
            Self::development_fixtures()
        }
        #[cfg(all(
            not(test),
            not(feature = "live-devnet"),
            not(feature = "development-fixtures")
        ))]
        {
            Ok(Self::production())
        }
    }

    #[cfg(all(feature = "live-devnet", not(test)))]
    fn live_devnet_from_build() -> Result<Self, ViewerError> {
        Self::from_public_anchors(
            option_env!("SOLARCH_ARCHIVE_TRUST_KEY_ID"),
            option_env!("SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64"),
            option_env!("SOLARCH_LICENSE_TRUST_KEY_ID"),
            option_env!("SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64"),
        )
    }

    #[cfg(any(test, feature = "live-devnet"))]
    fn from_public_anchors(
        archive_key_id: Option<&str>,
        archive_public_key: Option<&str>,
        license_key_id: Option<&str>,
        license_public_key: Option<&str>,
    ) -> Result<Self, ViewerError> {
        let archive_key_id = archive_key_id.ok_or(ViewerError::Internal)?;
        let license_key_id = license_key_id.ok_or(ViewerError::Internal)?;
        let archive = decode_key(archive_public_key.ok_or(ViewerError::Internal)?)?;
        let license = decode_key(license_public_key.ok_or(ViewerError::Internal)?)?;
        if archive == license {
            return Err(ViewerError::Internal);
        }
        Ok(Self {
            archive_keys: ArchiveTrustStore::from_keys([(archive_key_id.to_owned(), archive)])?,
            license_keys: LicenseTrustStore::from_keys([(license_key_id.to_owned(), license)])
                .map_err(|_| ViewerError::Internal)?,
        })
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

#[cfg(any(test, feature = "development-fixtures", feature = "live-devnet"))]
fn decode_key(value: &str) -> Result<[u8; 32], ViewerError> {
    let decoded: [u8; 32] = STANDARD
        .decode(value)
        .map_err(|_| ViewerError::Internal)?
        .try_into()
        .map_err(|_| ViewerError::Internal)?;
    if STANDARD.encode(decoded) != value {
        return Err(ViewerError::Internal);
    }
    Ok(decoded)
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

    #[test]
    fn live_public_anchors_are_exact_role_separated_and_fail_closed() {
        let archive = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
        let license = "JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0=";
        let trust = TrustConfig::from_public_anchors(
            Some("arc-devnet-01"),
            Some(archive),
            Some("lic-devnet-01"),
            Some(license),
        )
        .unwrap();
        assert!(trust.archive_keys.key("arc-devnet-01").is_ok());
        assert!(trust.archive_keys.key("lic-devnet-01").is_err());

        for invalid in [
            TrustConfig::from_public_anchors(
                None,
                Some(archive),
                Some("lic-devnet-01"),
                Some(license),
            ),
            TrustConfig::from_public_anchors(
                Some("ARC"),
                Some(archive),
                Some("lic-devnet-01"),
                Some(license),
            ),
            TrustConfig::from_public_anchors(
                Some("archive"),
                Some(archive),
                Some("license"),
                Some(archive),
            ),
            TrustConfig::from_public_anchors(
                Some("archive"),
                Some("AAAA"),
                Some("license"),
                Some(license),
            ),
        ] {
            assert!(invalid.is_err());
        }
    }
}
