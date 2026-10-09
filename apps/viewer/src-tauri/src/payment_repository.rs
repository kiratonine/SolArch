#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solarch_core::{canonical, Error as CoreError};

use crate::{
    backend::{dto, BackendConfig, ValidatedArchiveMetadata, ValidatedPaymentIntent},
    error::ViewerError,
};

const MAX_ACTIVE_INTENT_BYTES: usize = 4096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActiveIntentStatus {
    Created,
    Pending,
    AwaitingFinality,
    Confirmed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveIntent {
    pub payment_intent_id: String,
    pub archive_id: String,
    pub fingerprint: String,
    pub device_public_key: String,
    pub amount: String,
    pub currency: String,
    pub solana_pay_url: String,
    pub created_at: String,
    pub expires_at: String,
    pub status: ActiveIntentStatus,
}

impl From<&ValidatedPaymentIntent> for ActiveIntent {
    fn from(value: &ValidatedPaymentIntent) -> Self {
        let response = &value.public;
        Self {
            payment_intent_id: response.payment_intent_id.clone(),
            archive_id: response.archive_id.clone(),
            fingerprint: response.archive_fingerprint.clone(),
            device_public_key: response.device_public_key.clone(),
            amount: response.amount.clone(),
            currency: response.currency.clone(),
            solana_pay_url: response.solana_pay_url.clone(),
            created_at: response.created_at.clone(),
            expires_at: response.expires_at.clone(),
            status: ActiveIntentStatus::Created,
        }
    }
}

impl ActiveIntent {
    pub fn validate(
        &self,
        metadata: &ValidatedArchiveMetadata,
        device_public_key: &str,
        config: &BackendConfig,
    ) -> Result<(), ViewerError> {
        let expected = &metadata.0;
        let created_at = solarch_core::format::parse_timestamp(&self.created_at)
            .ok_or(ViewerError::PaymentStorage)?;
        let expires_at = solarch_core::format::parse_timestamp(&self.expires_at)
            .ok_or(ViewerError::PaymentStorage)?;
        if !solarch_core::format::valid_id(&self.payment_intent_id)
            || self.archive_id != expected.archive_id
            || self.fingerprint != expected.archive_fingerprint
            || self.device_public_key != device_public_key
            || solarch_core::device::decode_public_key_base64(&self.device_public_key).is_err()
            || dto::parse_usdc(&self.amount).map_err(|_| ViewerError::PaymentStorage)?
                != dto::parse_usdc(&expected.price.amount)
                    .map_err(|_| ViewerError::PaymentStorage)?
            || self.currency != "USDC"
            || created_at.checked_add(time::Duration::seconds(1800)) != Some(expires_at)
            || dto::validate_solana_pay_url(&self.solana_pay_url, &self.payment_intent_id, config)
                .is_err()
        {
            return Err(ViewerError::PaymentStorage);
        }
        Ok(())
    }
}

pub struct ActiveIntentRepository {
    root: PathBuf,
    #[cfg(test)]
    fail_next_clear: AtomicBool,
}

impl ActiveIntentRepository {
    pub fn new(root: PathBuf) -> Result<Self, ViewerError> {
        fs::create_dir_all(&root).map_err(|_| ViewerError::PaymentStorage)?;
        let metadata = fs::symlink_metadata(&root).map_err(|_| ViewerError::PaymentStorage)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(ViewerError::PaymentStorage);
        }
        Ok(Self {
            root,
            #[cfg(test)]
            fail_next_clear: AtomicBool::new(false),
        })
    }

    pub fn save(&self, intent: &ActiveIntent) -> Result<(), ViewerError> {
        let bytes = canonical::to_jcs(intent).map_err(|_| ViewerError::PaymentStorage)?;
        if bytes.len() > MAX_ACTIVE_INTENT_BYTES {
            return Err(ViewerError::PaymentStorage);
        }
        let mut output = AtomicWriteFile::options()
            .read(true)
            .open(self.path_for(&intent.archive_id))
            .map_err(|_| ViewerError::PaymentStorage)?;
        output
            .write_all(&bytes)
            .map_err(|_| ViewerError::PaymentStorage)?;
        output.commit().map_err(|_| ViewerError::PaymentStorage)
    }

    pub fn load(&self, archive_id: &str) -> Result<Option<ActiveIntent>, ViewerError> {
        let path = self.path_for(archive_id);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ViewerError::PaymentStorage),
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_ACTIVE_INTENT_BYTES as u64
        {
            return Err(ViewerError::PaymentStorage);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(&path)
            .map_err(|_| ViewerError::PaymentStorage)?
            .take(MAX_ACTIVE_INTENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ViewerError::PaymentStorage)?;
        if bytes.len() as u64 != metadata.len() {
            return Err(ViewerError::PaymentStorage);
        }
        let intent: ActiveIntent = canonical::parse_exact(&bytes, CoreError::Serialization)
            .map_err(|_| ViewerError::PaymentStorage)?;
        if intent.archive_id != archive_id {
            return Err(ViewerError::PaymentStorage);
        }
        Ok(Some(intent))
    }

    pub fn clear(&self, archive_id: &str) -> Result<(), ViewerError> {
        #[cfg(test)]
        if self.fail_next_clear.swap(false, Ordering::SeqCst) {
            return Err(ViewerError::PaymentStorage);
        }
        match fs::remove_file(self.path_for(archive_id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(ViewerError::PaymentStorage),
        }
    }

    #[cfg(test)]
    pub(crate) fn fail_next_clear_for_test(&self) {
        self.fail_next_clear.store(true, Ordering::SeqCst);
    }

    fn path_for(&self, archive_id: &str) -> PathBuf {
        let digest = Sha256::digest(archive_id.as_bytes());
        let name = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.root.join(format!("{name}.json"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_round_trips_only_nonsecret_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let repository = ActiveIntentRepository::new(directory.path().to_owned()).unwrap();
        let intent = ActiveIntent {
            payment_intent_id: "pi_1".into(),
            archive_id: "arc_1".into(),
            fingerprint: "a".repeat(64),
            device_public_key: "device-public".into(),
            amount: "10.00".into(),
            currency: "USDC".into(),
            solana_pay_url:
                "solana:https://api.example/v1/solana-pay/payment-intents/pi_1/transaction".into(),
            created_at: "2026-09-10T00:00:00Z".into(),
            expires_at: "2026-09-10T00:30:00Z".into(),
            status: ActiveIntentStatus::Pending,
        };
        repository.save(&intent).unwrap();
        assert_eq!(repository.load("arc_1").unwrap(), Some(intent));
        let entry = fs::read_dir(directory.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let disk = fs::read_to_string(entry).unwrap();
        assert!(!disk.contains("client_secret"));
        assert!(!disk.contains("refresh_token"));
    }
}
