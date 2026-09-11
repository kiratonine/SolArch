use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ViewerError {
    #[error("invalid command input")]
    InvalidInput,
    #[error("archive is not trusted")]
    UntrustedArchive,
    #[error("archive verification failed")]
    InvalidArchive,
    #[error("secure storage is unavailable")]
    SecureStoreUnavailable,
    #[error("secure storage contains malformed data")]
    CorruptSecureStore,
    #[error("local license storage failed")]
    LicenseStorage,
    #[error("local payment state storage failed")]
    PaymentStorage,
    #[error("backend is unavailable")]
    BackendUnavailable,
    #[error("backend metadata does not match the archive")]
    MetadataMismatch,
    #[error("payment intent credential is unavailable")]
    MissingIntentCredential,
    #[error("device refresh credential is unavailable")]
    MissingRefreshCredential,
    #[error("payment intent expired")]
    PaymentExpired,
    #[error("payment failed")]
    PaymentFailed,
    #[error("device limit reached")]
    DeviceLimitReached,
    #[error("license revoked")]
    LicenseRevoked,
    #[error("archive blocked")]
    ArchiveBlocked,
    #[error("device license is invalid")]
    InvalidLicense,
    #[error("device license belongs to another device")]
    WrongDevice,
    #[error("device license has expired")]
    Expired,
    #[error("online refresh is required")]
    RefreshRequired,
    #[error("internal viewer state failed")]
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CommandError {
    pub code: &'static str,
    pub message_key: &'static str,
}

impl From<ViewerError> for CommandError {
    fn from(value: ViewerError) -> Self {
        let (code, message_key) = match value {
            ViewerError::InvalidInput => ("INVALID_INPUT", "errors.invalidInput"),
            ViewerError::UntrustedArchive => ("UNTRUSTED_ARCHIVE", "errors.untrustedArchive"),
            ViewerError::InvalidArchive => ("INVALID_ARCHIVE", "errors.invalidArchive"),
            ViewerError::SecureStoreUnavailable => {
                ("SECURE_STORE_UNAVAILABLE", "errors.secureStoreUnavailable")
            }
            ViewerError::CorruptSecureStore => {
                ("CORRUPT_SECURE_STORE", "errors.corruptSecureStore")
            }
            ViewerError::LicenseStorage => ("LICENSE_STORAGE", "errors.licenseStorage"),
            ViewerError::PaymentStorage => ("PAYMENT_STORAGE", "errors.paymentStorage"),
            ViewerError::BackendUnavailable => ("BACKEND_UNAVAILABLE", "errors.backendUnavailable"),
            ViewerError::MetadataMismatch => ("METADATA_MISMATCH", "errors.metadataMismatch"),
            ViewerError::MissingIntentCredential => (
                "MISSING_INTENT_CREDENTIAL",
                "errors.missingIntentCredential",
            ),
            ViewerError::MissingRefreshCredential => (
                "MISSING_REFRESH_CREDENTIAL",
                "errors.missingRefreshCredential",
            ),
            ViewerError::PaymentExpired => ("PAYMENT_EXPIRED", "errors.paymentExpired"),
            ViewerError::PaymentFailed => ("PAYMENT_FAILED", "errors.paymentFailed"),
            ViewerError::DeviceLimitReached => {
                ("DEVICE_LIMIT_REACHED", "errors.deviceLimitReached")
            }
            ViewerError::LicenseRevoked => ("LICENSE_REVOKED", "errors.licenseRevoked"),
            ViewerError::ArchiveBlocked => ("ARCHIVE_BLOCKED", "errors.archiveBlocked"),
            ViewerError::InvalidLicense => ("INVALID_LICENSE", "errors.invalidLicense"),
            ViewerError::WrongDevice => ("WRONG_DEVICE", "errors.wrongDevice"),
            ViewerError::Expired => ("LICENSE_EXPIRED", "errors.expired"),
            ViewerError::RefreshRequired => ("REFRESH_REQUIRED", "errors.refreshRequired"),
            ViewerError::Internal => ("INTERNAL", "errors.internal"),
        };
        Self { code, message_key }
    }
}

impl From<solarch_core::Error> for ViewerError {
    fn from(value: solarch_core::Error) -> Self {
        match value {
            solarch_core::Error::UnknownTrustKey => Self::InvalidLicense,
            solarch_core::Error::WrongDevice => Self::WrongDevice,
            solarch_core::Error::Expired => Self::Expired,
            solarch_core::Error::RefreshRequired => Self::RefreshRequired,
            solarch_core::Error::InvalidLicense
            | solarch_core::Error::InvalidDeviceKey
            | solarch_core::Error::AuthenticationFailed => Self::InvalidLicense,
            _ => Self::InvalidArchive,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_stable_sanitized_codes() {
        let error = CommandError::from(ViewerError::WrongDevice);
        assert_eq!(error.code, "WRONG_DEVICE");
        let json = serde_json::to_string(&error).unwrap();
        assert!(!json.contains("ACK"));
        assert!(!json.contains("private"));
    }

    #[test]
    fn unknown_license_role_key_maps_to_invalid_license() {
        assert!(matches!(
            ViewerError::from(solarch_core::Error::UnknownTrustKey),
            ViewerError::InvalidLicense
        ));
    }
}
