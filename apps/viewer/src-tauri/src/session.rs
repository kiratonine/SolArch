use std::path::PathBuf;

use solarch_core::{
    archive::{ProtectedArchiveReader, VerifiedFileIdentity},
    license::ValidatedLicenseMetadata,
};
use time::OffsetDateTime;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedArchiveIdentity {
    pub archive_id: String,
    pub fingerprint: String,
    pub path: PathBuf,
    pub signing_key_id: String,
    pub signing_public_key: [u8; 32],
    pub file_identity: VerifiedFileIdentity,
    pub public_header: solarch_core::format::PublicHeader,
}

pub enum SessionState {
    Empty,
    Locked(VerifiedArchiveIdentity),
    Unwrapped {
        archive: VerifiedArchiveIdentity,
        license: ValidatedLicenseMetadata,
        reader: Box<ProtectedArchiveReader>,
        offline_deadline: OffsetDateTime,
    },
}

impl std::fmt::Debug for SessionState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => formatter.write_str("SessionState::Empty"),
            Self::Locked(archive) => formatter.debug_tuple("Locked").field(archive).finish(),
            Self::Unwrapped {
                archive,
                license,
                offline_deadline,
                ..
            } => formatter
                .debug_struct("Unwrapped")
                .field("archive", archive)
                .field("license", license)
                .field("reader", &"[REDACTED PROTECTED READER]")
                .field("offline_deadline", offline_deadline)
                .finish(),
        }
    }
}

impl SessionState {
    pub fn has_in_memory_ack(&self) -> bool {
        match self {
            Self::Unwrapped { reader, .. } => {
                let _ = reader;
                true
            }
            Self::Empty | Self::Locked(_) => false,
        }
    }
}
