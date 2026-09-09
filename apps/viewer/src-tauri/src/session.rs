use solarch_core::{license::ValidatedLicenseMetadata, production_crypto::ArchiveContentKey};
use time::OffsetDateTime;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedArchiveIdentity {
    pub archive_id: String,
    pub fingerprint: String,
}

pub enum SessionState {
    Empty,
    Locked(VerifiedArchiveIdentity),
    Unwrapped {
        archive: VerifiedArchiveIdentity,
        license: ValidatedLicenseMetadata,
        ack: ArchiveContentKey,
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
                .field("ack", &"[REDACTED]")
                .field("offline_deadline", offline_deadline)
                .finish(),
        }
    }
}

impl SessionState {
    pub fn has_in_memory_ack(&self) -> bool {
        match self {
            Self::Unwrapped { ack, .. } => {
                let _ = ack;
                true
            }
            Self::Empty | Self::Locked(_) => false,
        }
    }
}
