//! Errors intentionally contain no input values, file content, or secret material.
#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("invalid magic")]
    InvalidMagic,
    #[error("unsupported format version")]
    UnsupportedVersion,
    #[error("truncated input")]
    TruncatedInput,
    #[error("invalid public header")]
    InvalidHeader,
    #[error("invalid manifest")]
    InvalidManifest,
    #[error("invalid chunk metadata")]
    InvalidChunkMetadata,
    #[error("offset or length out of bounds")]
    OutOfBounds,
    #[error("authentication failed")]
    AuthenticationFailed,
    #[error("integrity mismatch")]
    IntegrityMismatch,
    #[error("signature verification failed")]
    SignatureFailure,
    #[error("unsafe archive path")]
    UnsafePath,
    #[error("duplicate normalized archive path")]
    DuplicateNormalizedPath,
    #[error("unsupported protected file type")]
    UnsupportedFileType,
    #[error("I/O operation failed")]
    Io,
    #[error("serialization failed")]
    Serialization,
    #[error("invalid builder input")]
    InvalidBuilderInput,
    #[error("resource limit exceeded")]
    LimitExceeded,
    #[error("invalid device key")]
    InvalidDeviceKey,
    #[error("invalid device license")]
    InvalidLicense,
    #[error("unknown trusted key")]
    UnknownTrustKey,
    #[error("device binding does not match")]
    WrongDevice,
    #[error("license is outside its local validity window")]
    Expired,
    #[error("online license refresh is required")]
    RefreshRequired,
}

pub type Result<T> = std::result::Result<T, Error>;
