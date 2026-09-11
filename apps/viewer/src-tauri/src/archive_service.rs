use std::{path::Path, sync::Mutex};

use serde::Serialize;
use solarch_core::{
    archive::{inspect_signing_key_id, verify_archive, ProtectedArchiveReader},
    license::UnwrappedLicense,
};
use time::OffsetDateTime;

use crate::{
    error::ViewerError,
    session::{SessionState, VerifiedArchiveIdentity},
    trust::ArchiveTrustStore,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedArchiveDto {
    pub title: String,
    pub creator_wallet: String,
    pub price_amount: String,
    pub price_currency: String,
    pub archive_id: String,
    pub max_devices: u32,
    pub allow_export: bool,
    pub watermark_enabled: bool,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedFileDto {
    pub file_id: String,
    pub path: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

pub struct ArchiveService {
    trust: ArchiveTrustStore,
    session: Mutex<SessionState>,
}

impl ArchiveService {
    pub fn new(trust: ArchiveTrustStore) -> Self {
        Self {
            trust,
            session: Mutex::new(SessionState::Empty),
        }
    }

    pub fn open(&self, path: &Path) -> Result<VerifiedArchiveDto, ViewerError> {
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Empty;
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("slr"))
        {
            return Err(ViewerError::InvalidInput);
        }
        let key_id = inspect_signing_key_id(path).map_err(ViewerError::from)?;
        let key = self.trust.key(&key_id)?;
        let verified = verify_archive(path, &key_id, key).map_err(ViewerError::from)?;
        let header = verified.public_header;
        let identity = VerifiedArchiveIdentity {
            archive_id: header.archive_id.clone(),
            fingerprint: verified.archive_fingerprint.clone(),
            path: path.to_path_buf(),
            signing_key_id: key_id,
            signing_public_key: key,
            file_identity: verified.file_identity,
            public_header: header.clone(),
        };
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Locked(identity);
        Ok(VerifiedArchiveDto {
            title: header.title,
            creator_wallet: header.creator_wallet,
            price_amount: header.commercial_snapshot.price_amount,
            price_currency: header.commercial_snapshot.price_currency,
            archive_id: header.archive_id,
            max_devices: header.license_snapshot.max_devices,
            allow_export: header.license_snapshot.allow_export,
            watermark_enabled: header.license_snapshot.watermark_enabled,
            fingerprint: verified.archive_fingerprint,
        })
    }

    pub fn close(&self) -> Result<(), ViewerError> {
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Empty;
        Ok(())
    }

    pub fn install_unwrapped(
        &self,
        archive_id: &str,
        fingerprint: &str,
        unwrapped: UnwrappedLicense,
    ) -> Result<(), ViewerError> {
        let expected = {
            let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            match &*session {
                SessionState::Locked(current)
                | SessionState::Unwrapped {
                    archive: current, ..
                } if current.archive_id == archive_id && current.fingerprint == fingerprint => {
                    current.clone()
                }
                _ => return Err(ViewerError::InvalidLicense),
            }
        };
        let reader = ProtectedArchiveReader::open(
            &expected.path,
            &expected.signing_key_id,
            expected.signing_public_key,
            &expected.fingerprint,
            &expected.file_identity,
            &unwrapped.archive_content_key,
        )
        .map_err(ViewerError::from)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if !matches!(
            &*session,
            SessionState::Locked(current) | SessionState::Unwrapped { archive: current, .. }
                if current == &expected
        ) {
            return Err(ViewerError::InvalidLicense);
        }
        let deadline = unwrapped.metadata.offline_valid_until;
        *session = SessionState::Unwrapped {
            archive: expected,
            license: unwrapped.metadata,
            reader: Box::new(reader),
            offline_deadline: deadline,
        };
        Ok(())
    }

    pub fn enforce_deadline(&self, now: OffsetDateTime) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if let SessionState::Unwrapped {
            archive,
            offline_deadline,
            ..
        } = &*session
        {
            if now >= *offline_deadline {
                let locked = archive.clone();
                *session = SessionState::Locked(locked);
                return Err(ViewerError::RefreshRequired);
            }
        }
        Ok(())
    }

    pub fn list_files(&self, now: OffsetDateTime) -> Result<Vec<ProtectedFileDto>, ViewerError> {
        self.enforce_deadline(now)?;
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { reader, .. } = &*session else {
            return Err(ViewerError::InvalidLicense);
        };
        Ok(reader
            .files()
            .iter()
            .map(|file| ProtectedFileDto {
                file_id: file.file_id.clone(),
                path: file.path.as_str().to_owned(),
                display_name: file.display_name.clone(),
                mime_type: file.mime_type.clone(),
                size_bytes: file.size_bytes,
            })
            .collect())
    }

    pub fn read_file_range(
        &self,
        file_id: &str,
        offset: u64,
        length: u64,
        now: OffsetDateTime,
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, ViewerError> {
        self.enforce_deadline(now)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { reader, .. } = &mut *session else {
            return Err(ViewerError::InvalidLicense);
        };
        reader
            .read_file_range(file_id, offset, length)
            .map_err(ViewerError::from)
    }

    pub fn locked_identity(&self) -> Result<VerifiedArchiveIdentity, ViewerError> {
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        match &*session {
            SessionState::Locked(identity) => Ok(identity.clone()),
            SessionState::Empty | SessionState::Unwrapped { .. } => {
                Err(ViewerError::InvalidLicense)
            }
        }
    }

    pub fn current_identity(&self) -> Result<VerifiedArchiveIdentity, ViewerError> {
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        match &*session {
            SessionState::Locked(identity)
            | SessionState::Unwrapped {
                archive: identity, ..
            } => Ok(identity.clone()),
            SessionState::Empty => Err(ViewerError::InvalidLicense),
        }
    }

    pub fn relock(&self) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if let SessionState::Unwrapped { archive, .. } = &*session {
            *session = SessionState::Locked(archive.clone());
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn session(&self) -> &Mutex<SessionState> {
        &self.session
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use base64::{engine::general_purpose::STANDARD, Engine as _};

    use super::*;
    use crate::trust::TrustConfig;

    #[test]
    fn trusted_vector_opens_to_locked_and_tamper_fails() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("vector.slr");
        let bytes = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        fs::write(&archive, &bytes).unwrap();
        let service =
            ArchiveService::new(TrustConfig::development_fixtures().unwrap().archive_keys);
        let result = service.open(&archive).unwrap();
        assert_eq!(result.archive_id, "arc_test_01");
        assert_eq!(
            result.fingerprint,
            "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb"
        );
        assert!(matches!(
            *service.session.lock().unwrap(),
            SessionState::Locked(_)
        ));

        let mut tampered = bytes;
        tampered[200] ^= 1;
        fs::write(&archive, tampered).unwrap();
        assert!(service.open(&archive).is_err());
        assert!(matches!(
            *service.session.lock().unwrap(),
            SessionState::Empty
        ));
    }

    #[test]
    fn unknown_archive_key_fails_closed() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("vector.slr");
        let bytes = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        fs::write(&archive, bytes).unwrap();
        let service = ArchiveService::new(ArchiveTrustStore::default());
        assert!(matches!(
            service.open(&archive),
            Err(ViewerError::UntrustedArchive)
        ));
    }
}
