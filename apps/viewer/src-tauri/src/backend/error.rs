use serde::Deserialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BackendErrorCode {
    ArchiveBlocked,
    ArchiveNotAvailable,
    InvalidRequest,
    InvalidIntentCredential,
    InvalidRefreshCredential,
    PaymentFailed,
    PaymentIntentExpired,
    PaymentNotConfirmed,
    DeviceBindingMismatch,
    DeviceLimitReached,
    RequestNonceReplay,
    EntitlementRevoked,
    LicenseRevoked,
    EntitlementExpired,
    LicenseExpired,
    LicenseNotFound,
    BackendUnavailable,
    RateLimited,
}

impl BackendErrorCode {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "ARCHIVE_BLOCKED" => Self::ArchiveBlocked,
            "ARCHIVE_NOT_AVAILABLE" => Self::ArchiveNotAvailable,
            "INVALID_REQUEST" => Self::InvalidRequest,
            "INVALID_INTENT_CREDENTIAL" => Self::InvalidIntentCredential,
            "INVALID_REFRESH_CREDENTIAL" => Self::InvalidRefreshCredential,
            "PAYMENT_FAILED" => Self::PaymentFailed,
            "PAYMENT_INTENT_EXPIRED" => Self::PaymentIntentExpired,
            "PAYMENT_NOT_CONFIRMED" => Self::PaymentNotConfirmed,
            "DEVICE_BINDING_MISMATCH" => Self::DeviceBindingMismatch,
            "DEVICE_LIMIT_REACHED" => Self::DeviceLimitReached,
            "REQUEST_NONCE_REPLAY" => Self::RequestNonceReplay,
            "ENTITLEMENT_REVOKED" => Self::EntitlementRevoked,
            "LICENSE_REVOKED" => Self::LicenseRevoked,
            "ENTITLEMENT_EXPIRED" => Self::EntitlementExpired,
            "LICENSE_EXPIRED" => Self::LicenseExpired,
            "LICENSE_NOT_FOUND" => Self::LicenseNotFound,
            "BACKEND_UNAVAILABLE" => Self::BackendUnavailable,
            "RATE_LIMITED" => Self::RateLimited,
            _ => return None,
        })
    }

    pub fn retryable(self) -> bool {
        matches!(self, Self::BackendUnavailable | Self::RateLimited)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("backend configuration is unavailable")]
    Configuration,
    #[error("backend transport is unavailable")]
    Unavailable,
    #[error("backend returned an invalid response")]
    InvalidResponse,
    #[error("backend rejected the request")]
    Rejected {
        code: BackendErrorCode,
        request_id: Option<String>,
    },
}

impl BackendError {
    pub fn retryable(&self) -> bool {
        matches!(self, Self::Unavailable)
            || matches!(self, Self::Rejected { code, .. } if code.retryable())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ErrorResponse {
    pub code: String,
    #[allow(dead_code)]
    pub message: String,
    pub request_id: String,
}
