#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};

use atomic_write_file::AtomicWriteFile;
use sha2::{Digest, Sha256};
use solarch_core::{
    device::DevicePrivateKey,
    license::{
        validate_cached_grant, validate_cached_grant_for_refresh, LicenseGrant, LicenseTrustStore,
        LicenseValidationContext, UnwrappedLicense, ValidatedFreshLicenseGrant,
        ValidatedLicenseMetadata, MAX_LICENSE_TRANSPORT_BYTES,
    },
};

use crate::error::ViewerError;

pub struct LocalLicenseRepository {
    root: PathBuf,
    #[cfg(test)]
    fail_next_save: AtomicBool,
}

impl LocalLicenseRepository {
    pub fn new(root: PathBuf) -> Result<Self, ViewerError> {
        fs::create_dir_all(&root).map_err(|_| ViewerError::LicenseStorage)?;
        let metadata = fs::symlink_metadata(&root).map_err(|_| ViewerError::LicenseStorage)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(ViewerError::LicenseStorage);
        }
        Ok(Self {
            root,
            #[cfg(test)]
            fail_next_save: AtomicBool::new(false),
        })
    }

    pub fn save_validated(
        &self,
        validated: &ValidatedFreshLicenseGrant<'_>,
    ) -> Result<(), ViewerError> {
        #[cfg(test)]
        if self.fail_next_save.swap(false, Ordering::SeqCst) {
            return Err(ViewerError::LicenseStorage);
        }
        let grant = validated.signed_grant();
        let bytes = grant
            .to_storage_jcs()
            .map_err(|_| ViewerError::InvalidLicense)?;
        let destination = self.path_for(&grant.license.payload.archive_id);
        let mut output = AtomicWriteFile::options()
            .read(true)
            .open(&destination)
            .map_err(|_| ViewerError::LicenseStorage)?;
        output
            .write_all(&bytes)
            .map_err(|_| ViewerError::LicenseStorage)?;
        output.commit().map_err(|_| ViewerError::LicenseStorage)
    }

    #[cfg(test)]
    pub(crate) fn fail_next_save_for_test(&self) {
        self.fail_next_save.store(true, Ordering::SeqCst);
    }

    pub fn has_local_grant(&self, archive_id: &str) -> Result<bool, ViewerError> {
        match fs::symlink_metadata(self.path_for(archive_id)) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(ViewerError::LicenseStorage),
        }
    }

    pub fn load_and_validate(
        &self,
        archive_id: &str,
        trust: &LicenseTrustStore,
        device: &DevicePrivateKey,
        context: &LicenseValidationContext<'_>,
    ) -> Result<Option<UnwrappedLicense>, ViewerError> {
        let Some(grant) = self.read(archive_id)? else {
            return Ok(None);
        };
        validate_cached_grant(&grant, trust, device, context)
            .map(Some)
            .map_err(ViewerError::from)
    }

    pub fn load_and_validate_for_refresh(
        &self,
        archive_id: &str,
        trust: &LicenseTrustStore,
        device: &DevicePrivateKey,
        context: &LicenseValidationContext<'_>,
    ) -> Result<Option<ValidatedLicenseMetadata>, ViewerError> {
        let Some(grant) = self.read(archive_id)? else {
            return Ok(None);
        };
        validate_cached_grant_for_refresh(&grant, trust, device, context)
            .map(Some)
            .map_err(ViewerError::from)
    }

    fn read(&self, archive_id: &str) -> Result<Option<LicenseGrant>, ViewerError> {
        let path = self.path_for(archive_id);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ViewerError::LicenseStorage),
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_LICENSE_TRANSPORT_BYTES as u64
        {
            return Err(ViewerError::LicenseStorage);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(&path)
            .map_err(|_| ViewerError::LicenseStorage)?
            .take(MAX_LICENSE_TRANSPORT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ViewerError::LicenseStorage)?;
        if bytes.len() as u64 != metadata.len() {
            return Err(ViewerError::LicenseStorage);
        }
        let grant =
            LicenseGrant::parse_transport(&bytes).map_err(|_| ViewerError::InvalidLicense)?;
        if grant.license.payload.archive_id != archive_id {
            return Err(ViewerError::InvalidLicense);
        }
        Ok(Some(grant))
    }

    fn path_for(&self, archive_id: &str) -> PathBuf {
        self.root
            .join(format!("{}.license.json", safe_name(archive_id)))
    }
}

fn safe_name(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trust::TrustConfig;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use solarch_core::license::{validate_fresh_response, FreshLicenseValidationContext};

    const GRANT: &str = r#"{"license":{"payload":{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1},"server_signature":"wLcOtVg7S0qywsufOSmRTPHACKPxVTO5qYivffQ5Xk0ylSvAjIV7b5u4LlnEycUM++zQ/5d5nMr4tTUaiWg1BA=="},"wrapped_content_key":{"aead_id":2,"ciphertext":"GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I","enc":"utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=","kdf_id":1,"kem_id":32,"version":1}}"#;

    #[test]
    fn stores_only_bounded_signed_grant_under_hashed_name() {
        let directory = tempfile::tempdir().unwrap();
        let repository = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let grant = LicenseGrant::parse_transport(GRANT.as_bytes()).unwrap();
        let validated = validated_fresh(&grant);
        repository.save_validated(&validated).unwrap();
        assert_eq!(repository.read("arc_test_01").unwrap(), Some(grant));
        let entries: Vec<_> = fs::read_dir(directory.path().join("licenses"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].contains("arc_test_01"));
        let bytes = fs::read(directory.path().join("licenses").join(&entries[0])).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("3caa61bc"));
        assert!(!text.contains("a0a1a2a3"));
    }

    #[test]
    fn corrupt_or_mismatched_local_license_is_denied() {
        let directory = tempfile::tempdir().unwrap();
        let repository = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        fs::write(repository.path_for("arc_test_01"), b"not json").unwrap();
        assert!(matches!(
            repository.read("arc_test_01"),
            Err(ViewerError::InvalidLicense)
        ));
        let grant = LicenseGrant::parse_transport(GRANT.as_bytes()).unwrap();
        fs::write(
            repository.path_for("other_archive"),
            grant.to_storage_jcs().unwrap(),
        )
        .unwrap();
        assert!(matches!(
            repository.read("other_archive"),
            Err(ViewerError::InvalidLicense)
        ));
    }

    #[test]
    fn every_loaded_grant_is_cryptographically_revalidated() {
        let directory = tempfile::tempdir().unwrap();
        let repository = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let mut grant = LicenseGrant::parse_transport(GRANT.as_bytes()).unwrap();
        let validated = validated_fresh(&grant);
        repository.save_validated(&validated).unwrap();
        let trust = TrustConfig::development_fixtures().unwrap();
        let device = DevicePrivateKey::from_bytes(vector_private_bytes()).unwrap();
        let context = LicenseValidationContext {
            archive_id: "arc_test_01",
            archive_fingerprint: "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb",
            device_public_key: b64_32("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="),
            now: time::OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap(),
        };
        let loaded = repository
            .load_and_validate("arc_test_01", &trust.license_keys, &device, &context)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.metadata.license_id, "lic_test_01");

        grant.license.server_signature.replace_range(0..1, "A");
        fs::write(
            repository.path_for("arc_test_01"),
            grant.to_storage_jcs().unwrap(),
        )
        .unwrap();
        assert!(repository
            .load_and_validate("arc_test_01", &trust.license_keys, &device, &context)
            .is_err());
    }

    fn validated_fresh(grant: &LicenseGrant) -> ValidatedFreshLicenseGrant<'_> {
        let trust = TrustConfig::development_fixtures().unwrap();
        let device = DevicePrivateKey::from_bytes(vector_private_bytes()).unwrap();
        validate_fresh_response(
            grant,
            &trust.license_keys,
            &device,
            &FreshLicenseValidationContext {
                license: LicenseValidationContext {
                    archive_id: "arc_test_01",
                    archive_fingerprint:
                        "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb",
                    device_public_key: b64_32("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="),
                    now: time::OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap(),
                },
                outstanding_request_nonce: std::array::from_fn(|index| 0x80 + index as u8),
            },
        )
        .unwrap()
    }

    fn b64_32(value: &str) -> [u8; 32] {
        STANDARD.decode(value).unwrap().try_into().unwrap()
    }

    fn hex32(value: &str) -> [u8; 32] {
        let mut result = [0_u8; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            result[index] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        result
    }

    fn vector_private_bytes() -> [u8; 32] {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/license_v1_test_secrets.json"
        ))
        .unwrap();
        hex32(fixture["device_x25519_private_key_hex"].as_str().unwrap())
    }
}
