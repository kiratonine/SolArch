use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use solarch_core::license::{
    validate_fresh_response, FreshLicenseValidationContext, LicenseValidationContext,
    ProcessClockSample,
};

use crate::{
    archive_service::ArchiveService,
    backend::{
        BackendApi, BackendConfig, BackendError, BackendErrorCode, CreateIntentRequest,
        ValidatedArchiveMetadata, VerifyIntentRequest, VerifyOutcome, VerifyTransport,
    },
    device::DeviceManager,
    error::ViewerError,
    license_repository::LocalLicenseRepository,
    payment_repository::{ActiveIntent, ActiveIntentRepository, ActiveIntentStatus},
    rollback::RollbackManager,
    secure_store::{KeyedSecretStore, SecretPurpose},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentState {
    PaymentReady,
    PaymentPending,
    AwaitingFinality,
    Activating,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentView {
    pub state: PaymentState,
    pub payment_intent_id: String,
    pub amount: String,
    pub currency: String,
    pub solana_pay_url: String,
    pub expires_at: String,
}

struct Runtime {
    metadata: Option<ValidatedArchiveMetadata>,
    active: Option<ActiveIntent>,
}

pub struct PaymentService {
    backend: Option<Arc<dyn BackendApi>>,
    config: Option<BackendConfig>,
    secrets: Arc<dyn KeyedSecretStore>,
    repository: ActiveIntentRepository,
    runtime: Mutex<Runtime>,
    operation: Mutex<()>,
    nonce_source: Arc<dyn NonceSource>,
}

pub trait NonceSource: Send + Sync {
    fn generate(&self) -> Result<[u8; 32], ViewerError>;
}

struct OsNonceSource;

impl NonceSource for OsNonceSource {
    fn generate(&self) -> Result<[u8; 32], ViewerError> {
        let mut nonce = [0_u8; 32];
        getrandom::fill(&mut nonce).map_err(|_| ViewerError::Internal)?;
        Ok(nonce)
    }
}

impl PaymentService {
    pub fn new(
        backend: Option<Arc<dyn BackendApi>>,
        config: Option<BackendConfig>,
        secrets: Arc<dyn KeyedSecretStore>,
        repository: ActiveIntentRepository,
    ) -> Self {
        Self::with_nonce_source(
            backend,
            config,
            secrets,
            repository,
            Arc::new(OsNonceSource),
        )
    }

    fn with_nonce_source(
        backend: Option<Arc<dyn BackendApi>>,
        config: Option<BackendConfig>,
        secrets: Arc<dyn KeyedSecretStore>,
        repository: ActiveIntentRepository,
        nonce_source: Arc<dyn NonceSource>,
    ) -> Self {
        Self {
            backend,
            config,
            secrets,
            repository,
            runtime: Mutex::new(Runtime {
                metadata: None,
                active: None,
            }),
            operation: Mutex::new(()),
            nonce_source,
        }
    }

    pub fn reset_for_archive_switch(&self) -> Result<(), ViewerError> {
        let mut runtime = self.runtime.lock().map_err(|_| ViewerError::Internal)?;
        runtime.metadata = None;
        runtime.active = None;
        Ok(())
    }

    pub fn current_payment(&self) -> Result<Option<PaymentView>, ViewerError> {
        let _guard = self.operation.lock().map_err(|_| ViewerError::Internal)?;
        let active = self
            .runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active
            .clone();
        let Some(active) = active else {
            return Ok(None);
        };
        if self.resumable_intent_secret(&active)?.is_some() {
            Ok(Some(payment_view(&active)))
        } else {
            Ok(None)
        }
    }

    pub fn check_metadata(
        &self,
        archives: &ArchiveService,
        device: &DeviceManager,
    ) -> Result<(), ViewerError> {
        let _guard = self.operation.lock().map_err(|_| ViewerError::Internal)?;
        let archive = archives.locked_identity()?;
        let response = self
            .backend()?
            .archive_metadata(&archive.archive_id)
            .map_err(map_backend)?;
        let metadata = response
            .validate(&archive.public_header, &archive.fingerprint)
            .map_err(|_| ViewerError::MetadataMismatch)?;
        let device_public_key = device.public_key()?;
        let active = self.repository.load(&archive.archive_id)?;
        let active = if let Some(active) = active {
            active.validate(&metadata, &device_public_key, self.config()?)?;
            if self.resumable_intent_secret(&active)?.is_some() {
                Some(active)
            } else {
                None
            }
        } else {
            None
        };
        let mut runtime = self.runtime.lock().map_err(|_| ViewerError::Internal)?;
        runtime.metadata = Some(metadata);
        runtime.active = active;
        Ok(())
    }

    pub fn prepare_payment(
        &self,
        archives: &ArchiveService,
        device: &DeviceManager,
    ) -> Result<PaymentView, ViewerError> {
        let _guard = self.operation.lock().map_err(|_| ViewerError::Internal)?;
        let archive = archives.locked_identity()?;
        let device_public_key = device.public_key()?;
        let (existing, metadata) = {
            let runtime = self.runtime.lock().map_err(|_| ViewerError::Internal)?;
            (
                runtime.active.clone(),
                runtime
                    .metadata
                    .clone()
                    .ok_or(ViewerError::MetadataMismatch)?,
            )
        };
        if let Some(active) = existing {
            if self.resumable_intent_secret(&active)?.is_some() {
                return Ok(payment_view(&active));
            }
        }
        if metadata.0.archive_id != archive.archive_id {
            return Err(ViewerError::MetadataMismatch);
        }
        let response = self
            .backend()?
            .create_intent(&CreateIntentRequest {
                archive_id: archive.archive_id,
                device_public_key: device_public_key.clone(),
            })
            .map_err(map_backend)?;
        let validated = response
            .validate(&metadata, &device_public_key, self.config()?)
            .map_err(|_| ViewerError::MetadataMismatch)?;
        let active = ActiveIntent::from(&validated);
        write_verified(
            self.secrets.as_ref(),
            SecretPurpose::PaymentIntent,
            &active.payment_intent_id,
            validated.client_secret.as_bytes(),
        )?;
        if let Err(error) = self.repository.save(&active) {
            let _ = self
                .secrets
                .delete(SecretPurpose::PaymentIntent, &active.payment_intent_id);
            return Err(error);
        }
        self.runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active = Some(active.clone());
        Ok(payment_view(&active))
    }

    pub fn verify_payment(&self) -> Result<(PaymentView, VerifyOutcome), ViewerError> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| ViewerError::BackendUnavailable)?;
        let mut active = self
            .runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active
            .clone()
            .ok_or(ViewerError::PaymentStorage)?;
        let secret = self
            .resumable_intent_secret(&active)?
            .ok_or(ViewerError::MissingIntentCredential)?;
        let secret = std::str::from_utf8(&secret).map_err(|_| ViewerError::Internal)?;
        let transport = match self.backend()?.verify_intent(
            &active.payment_intent_id,
            secret,
            &VerifyIntentRequest {
                device_public_key: active.device_public_key.clone(),
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                let mapped = map_backend_ref(&error);
                if terminal_intent_error(&error) {
                    self.discard_orphaned_intent(&active)?;
                }
                return Err(mapped);
            }
        };
        let outcome = match transport {
            VerifyTransport::Pending(value) => crate::backend::validate_verify_pending(value)
                .map_err(|_| ViewerError::PaymentFailed)?,
            VerifyTransport::Confirmed(value) => crate::backend::validate_verify_confirmed(
                value,
                &active.archive_id,
                &active.fingerprint,
                &active.device_public_key,
            )
            .map_err(|_| ViewerError::PaymentFailed)?,
        };
        active.status = match outcome {
            VerifyOutcome::Pending => ActiveIntentStatus::Pending,
            VerifyOutcome::AwaitingFinality => ActiveIntentStatus::AwaitingFinality,
            VerifyOutcome::Confirmed => ActiveIntentStatus::Confirmed,
        };
        self.repository.save(&active)?;
        self.runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active = Some(active.clone());
        Ok((payment_view(&active), outcome))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn activate(
        &self,
        archives: &ArchiveService,
        device: &DeviceManager,
        licenses: &LocalLicenseRepository,
        license_trust: &solarch_core::license::LicenseTrustStore,
        rollback: &RollbackManager,
        clock: ProcessClockSample,
    ) -> Result<(), ViewerError> {
        let _guard = self.operation.lock().map_err(|_| ViewerError::Internal)?;
        let active = self
            .runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active
            .clone()
            .filter(|intent| intent.status == ActiveIntentStatus::Confirmed)
            .ok_or(ViewerError::PaymentFailed)?;
        let archive = archives.locked_identity()?;
        let private = device.load_or_create()?;
        let secret = self
            .resumable_intent_secret(&active)?
            .ok_or(ViewerError::MissingIntentCredential)?;
        let secret_text = std::str::from_utf8(&secret).map_err(|_| ViewerError::Internal)?;
        let (nonce, nonce_b64) = self.fresh_nonce()?;
        let response = self
            .backend()?
            .activate(
                &active.payment_intent_id,
                secret_text,
                &crate::backend::ActivationRequest {
                    device_public_key: active.device_public_key.clone(),
                    device_name: "Windows device".to_owned(),
                    viewer_version: env!("CARGO_PKG_VERSION").to_owned(),
                    request_nonce: nonce_b64,
                },
            )
            .map_err(map_backend)?;
        let (grant, refresh_token) = response
            .into_parts()
            .map_err(|_| ViewerError::InvalidLicense)?;
        let now = time::OffsetDateTime::from_unix_timestamp(clock.utc_unix_seconds)
            .map_err(|_| ViewerError::RefreshRequired)?;
        let validated = validate_fresh_response(
            &grant,
            license_trust,
            &private,
            &FreshLicenseValidationContext {
                license: LicenseValidationContext {
                    archive_id: &archive.archive_id,
                    archive_fingerprint: &archive.fingerprint,
                    device_public_key: private.public_key_bytes().map_err(ViewerError::from)?,
                    now,
                },
                outstanding_request_nonce: nonce,
            },
        )
        .map_err(ViewerError::from)?;
        let license_id = validated.signed_grant().license.payload.license_id.clone();
        let refresh_key = refresh_key(&archive.archive_id, &license_id);
        if let Err(error) = write_verified(
            self.secrets.as_ref(),
            SecretPurpose::DeviceRefresh,
            &refresh_key,
            refresh_token.as_bytes(),
        ) {
            let _ = delete_verified(
                self.secrets.as_ref(),
                SecretPurpose::DeviceRefresh,
                &refresh_key,
            );
            return Err(error);
        }
        licenses.save_validated(&validated)?;
        rollback.reset_after_online_refresh(clock)?;
        archives.install_unwrapped(
            &archive.archive_id,
            &archive.fingerprint,
            validated.into_unwrapped(),
        )?;
        self.cleanup_completed_intent(&active);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn refresh(
        &self,
        archives: &ArchiveService,
        device: &DeviceManager,
        licenses: &LocalLicenseRepository,
        license_trust: &solarch_core::license::LicenseTrustStore,
        rollback: &RollbackManager,
        clock: ProcessClockSample,
    ) -> Result<(), ViewerError> {
        let _guard = self.operation.lock().map_err(|_| ViewerError::Internal)?;
        let archive = archives.locked_identity()?;
        let private = device.load_or_create()?;
        let device_public_key = private.public_key_base64().map_err(ViewerError::from)?;
        let current_metadata = licenses
            .load_and_validate_for_refresh(
                &archive.archive_id,
                license_trust,
                &private,
                &LicenseValidationContext {
                    archive_id: &archive.archive_id,
                    archive_fingerprint: &archive.fingerprint,
                    device_public_key: private.public_key_bytes().map_err(ViewerError::from)?,
                    now: time::OffsetDateTime::UNIX_EPOCH,
                },
            )?
            .ok_or(ViewerError::InvalidLicense)?;
        let license_id = current_metadata.license_id;
        let key = refresh_key(&archive.archive_id, &license_id);
        let token = self
            .secrets
            .read(SecretPurpose::DeviceRefresh, &key)?
            .ok_or(ViewerError::MissingRefreshCredential)?;
        let token_text =
            std::str::from_utf8(&token).map_err(|_| ViewerError::CorruptSecureStore)?;
        if !crate::backend::valid_token32(token_text) {
            return Err(ViewerError::CorruptSecureStore);
        }
        let (nonce, nonce_b64) = self.fresh_nonce()?;
        let grant = match self.backend()?.refresh(
            &license_id,
            token_text,
            &crate::backend::RefreshRequest {
                archive_id: archive.archive_id.clone(),
                device_public_key,
                request_nonce: nonce_b64,
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                let mapped = map_backend_ref(&error);
                if !error.retryable() {
                    archives.relock()?;
                }
                if terminal_license_error(&error) {
                    delete_verified(self.secrets.as_ref(), SecretPurpose::DeviceRefresh, &key)?;
                }
                return Err(mapped);
            }
        };
        let now = time::OffsetDateTime::from_unix_timestamp(clock.utc_unix_seconds)
            .map_err(|_| ViewerError::RefreshRequired)?;
        let validated = validate_fresh_response(
            &grant,
            license_trust,
            &private,
            &FreshLicenseValidationContext {
                license: LicenseValidationContext {
                    archive_id: &archive.archive_id,
                    archive_fingerprint: &archive.fingerprint,
                    device_public_key: private.public_key_bytes().map_err(ViewerError::from)?,
                    now,
                },
                outstanding_request_nonce: nonce,
            },
        )
        .map_err(ViewerError::from)?;
        if validated.signed_grant().license.payload.license_id != license_id {
            return Err(ViewerError::InvalidLicense);
        }
        licenses.save_validated(&validated)?;
        rollback.reset_after_online_refresh(clock)?;
        archives.install_unwrapped(
            &archive.archive_id,
            &archive.fingerprint,
            validated.into_unwrapped(),
        )
    }

    fn backend(&self) -> Result<&dyn BackendApi, ViewerError> {
        self.backend
            .as_deref()
            .ok_or(ViewerError::BackendUnavailable)
    }

    fn config(&self) -> Result<&BackendConfig, ViewerError> {
        self.config.as_ref().ok_or(ViewerError::BackendUnavailable)
    }

    fn fresh_nonce(&self) -> Result<([u8; 32], String), ViewerError> {
        let nonce = self.nonce_source.generate()?;
        Ok((nonce, STANDARD.encode(nonce)))
    }

    fn resumable_intent_secret(
        &self,
        active: &ActiveIntent,
    ) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, ViewerError> {
        let result = self
            .secrets
            .read(SecretPurpose::PaymentIntent, &active.payment_intent_id)
            .and_then(|secret| secret.ok_or(ViewerError::MissingIntentCredential))
            .and_then(|secret| {
                let token =
                    std::str::from_utf8(&secret).map_err(|_| ViewerError::CorruptSecureStore)?;
                if !crate::backend::valid_token32(token) {
                    return Err(ViewerError::CorruptSecureStore);
                }
                Ok(secret)
            });
        match result {
            Ok(secret) => Ok(Some(secret)),
            Err(ViewerError::MissingIntentCredential | ViewerError::CorruptSecureStore) => {
                self.discard_orphaned_intent(active)?;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    fn discard_orphaned_intent(&self, active: &ActiveIntent) -> Result<(), ViewerError> {
        self.runtime
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .active = None;
        delete_verified(
            self.secrets.as_ref(),
            SecretPurpose::PaymentIntent,
            &active.payment_intent_id,
        )?;
        self.repository.clear(&active.archive_id)
    }

    fn cleanup_completed_intent(&self, active: &ActiveIntent) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.active = None;
        }
        if delete_verified(
            self.secrets.as_ref(),
            SecretPurpose::PaymentIntent,
            &active.payment_intent_id,
        )
        .is_ok()
        {
            let _ = self.repository.clear(&active.archive_id);
        }
    }

    pub(crate) fn cleanup_completed_intent_after_unlock(
        &self,
        archive_id: &str,
        fingerprint: &str,
        device_public_key: &str,
    ) {
        let Ok(_guard) = self.operation.lock() else {
            return;
        };
        let Ok(Some(active)) = self.repository.load(archive_id) else {
            return;
        };
        if active.status == ActiveIntentStatus::Confirmed
            && active.archive_id == archive_id
            && active.fingerprint == fingerprint
            && active.device_public_key == device_public_key
            && solarch_core::format::valid_id(&active.payment_intent_id)
        {
            self.cleanup_completed_intent(&active);
        }
    }
}

fn payment_view(intent: &ActiveIntent) -> PaymentView {
    PaymentView {
        state: match intent.status {
            ActiveIntentStatus::Created => PaymentState::PaymentReady,
            ActiveIntentStatus::Pending => PaymentState::PaymentPending,
            ActiveIntentStatus::AwaitingFinality => PaymentState::AwaitingFinality,
            ActiveIntentStatus::Confirmed => PaymentState::Activating,
        },
        payment_intent_id: intent.payment_intent_id.clone(),
        amount: intent.amount.clone(),
        currency: intent.currency.clone(),
        solana_pay_url: intent.solana_pay_url.clone(),
        expires_at: intent.expires_at.clone(),
    }
}

fn write_verified(
    store: &dyn KeyedSecretStore,
    purpose: SecretPurpose,
    key: &str,
    value: &[u8],
) -> Result<(), ViewerError> {
    store.write(purpose, key, value)?;
    let persisted = store
        .read(purpose, key)?
        .ok_or(ViewerError::SecureStoreUnavailable)?;
    if persisted.as_slice() != value {
        return Err(ViewerError::SecureStoreUnavailable);
    }
    Ok(())
}

fn delete_verified(
    store: &dyn KeyedSecretStore,
    purpose: SecretPurpose,
    key: &str,
) -> Result<(), ViewerError> {
    store.delete(purpose, key)?;
    if store.read(purpose, key)?.is_some() {
        return Err(ViewerError::SecureStoreUnavailable);
    }
    Ok(())
}

fn refresh_key(archive_id: &str, license_id: &str) -> String {
    format!("{archive_id}\0{license_id}")
}

fn map_backend(error: BackendError) -> ViewerError {
    map_backend_ref(&error)
}

fn map_backend_ref(error: &BackendError) -> ViewerError {
    match error {
        BackendError::Configuration | BackendError::Unavailable => ViewerError::BackendUnavailable,
        BackendError::InvalidResponse => ViewerError::InvalidLicense,
        BackendError::Rejected { code, .. } => match *code {
            BackendErrorCode::ArchiveBlocked | BackendErrorCode::ArchiveNotAvailable => {
                ViewerError::ArchiveBlocked
            }
            BackendErrorCode::PaymentFailed => ViewerError::PaymentFailed,
            BackendErrorCode::PaymentIntentExpired => ViewerError::PaymentExpired,
            BackendErrorCode::DeviceLimitReached => ViewerError::DeviceLimitReached,
            BackendErrorCode::EntitlementRevoked | BackendErrorCode::LicenseRevoked => {
                ViewerError::LicenseRevoked
            }
            BackendErrorCode::EntitlementExpired | BackendErrorCode::LicenseExpired => {
                ViewerError::Expired
            }
            BackendErrorCode::BackendUnavailable | BackendErrorCode::RateLimited => {
                ViewerError::BackendUnavailable
            }
            _ => ViewerError::InvalidLicense,
        },
    }
}

fn terminal_intent_error(error: &BackendError) -> bool {
    matches!(
        error,
        BackendError::Rejected {
            code: BackendErrorCode::PaymentFailed
                | BackendErrorCode::PaymentIntentExpired
                | BackendErrorCode::InvalidIntentCredential
                | BackendErrorCode::ArchiveBlocked
                | BackendErrorCode::ArchiveNotAvailable,
            ..
        }
    )
}

fn terminal_license_error(error: &BackendError) -> bool {
    matches!(
        error,
        BackendError::Rejected {
            code: BackendErrorCode::InvalidRefreshCredential
                | BackendErrorCode::DeviceBindingMismatch
                | BackendErrorCode::DeviceLimitReached
                | BackendErrorCode::EntitlementRevoked
                | BackendErrorCode::LicenseRevoked
                | BackendErrorCode::EntitlementExpired
                | BackendErrorCode::LicenseExpired
                | BackendErrorCode::LicenseNotFound
                | BackendErrorCode::ArchiveBlocked,
            ..
        }
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Barrier,
    };

    use super::*;
    use crate::{
        archive_service::ArchiveService,
        backend::{
            ActivationResponse, ArchiveMetadataResponse, CreatorDto, LicensePolicyDto, MoneyDto,
            PaymentIntentResponse, VerifyConfirmedResponse, VerifyPendingResponse,
        },
        secure_store::{MemoryKeyedSecretStore, MemorySecretStore, SecretStore},
        trust::TrustConfig,
    };
    use ed25519_dalek::{Signer as _, SigningKey};
    use hpke::{
        aead::AesGcm256,
        kdf::HkdfSha256,
        kem::X25519HkdfSha256,
        rand_core::{Infallible, TryCryptoRng, TryRng},
        single_shot_seal_with_rng, Deserializable, OpModeS, Serializable,
    };
    use sha2::{Digest, Sha256};
    use solarch_core::license::LicenseGrant;

    const TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const FINGERPRINT: &str = "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb";
    const DEVICE: &str = "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=";

    struct FixedNonce;

    impl NonceSource for FixedNonce {
        fn generate(&self) -> Result<[u8; 32], ViewerError> {
            Ok(std::array::from_fn(|index| 0x80 + index as u8))
        }
    }

    #[derive(Default)]
    struct SequenceNonce(AtomicUsize);

    impl NonceSource for SequenceNonce {
        fn generate(&self) -> Result<[u8; 32], ViewerError> {
            let sequence = self.0.fetch_add(1, Ordering::SeqCst);
            let byte = u8::try_from(sequence).map_err(|_| ViewerError::Internal)?;
            Ok([0x80_u8.wrapping_add(byte); 32])
        }
    }

    #[derive(Default)]
    struct MockBackend {
        creates: AtomicUsize,
        verifies: AtomicUsize,
        activation_nonces: Mutex<Vec<String>>,
        activation_failures: AtomicUsize,
        verify_error: Mutex<Option<BackendErrorCode>>,
        verify_blocker: Mutex<Option<(Arc<Barrier>, Arc<Barrier>)>>,
        metadata_mismatch: AtomicBool,
        refresh_error: Mutex<Option<BackendErrorCode>>,
    }

    impl BackendApi for MockBackend {
        fn archive_metadata(
            &self,
            archive_id: &str,
        ) -> Result<ArchiveMetadataResponse, BackendError> {
            assert_eq!(archive_id, "arc_test_01");
            Ok(ArchiveMetadataResponse {
                archive_id: archive_id.to_owned(),
                status: "published".into(),
                platform_fee_bps: 500,
                title: "Test archive".into(),
                price: MoneyDto {
                    amount: "10.00".into(),
                    currency: "USDC".into(),
                },
                creator: CreatorDto {
                    wallet: "11111111111111111111111111111111".into(),
                },
                license_policy: LicensePolicyDto {
                    max_devices: 1,
                    allow_export: false,
                    watermark_enabled: true,
                },
                archive_fingerprint: if self.metadata_mismatch.load(Ordering::SeqCst) {
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()
                } else {
                    FINGERPRINT.into()
                },
            })
        }

        fn create_intent(
            &self,
            request: &CreateIntentRequest,
        ) -> Result<PaymentIntentResponse, BackendError> {
            assert_eq!(request.archive_id, "arc_test_01");
            assert_eq!(request.device_public_key, DEVICE);
            self.creates.fetch_add(1, Ordering::SeqCst);
            Ok(PaymentIntentResponse {
                payment_intent_id: "pi_test_01".into(),
                archive_id: "arc_test_01".into(),
                archive_fingerprint: FINGERPRINT.into(),
                device_public_key: DEVICE.into(),
                payment_intent_client_secret: TOKEN.into(),
                amount: "10.00".into(),
                currency: "USDC".into(),
                creator_share: "9.50".into(),
                platform_share: "0.50".into(),
                payment_reference: "11111111111111111111111111111111".into(),
                solana_pay_url: "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction".into(),
                created_at: "2026-09-07T00:00:00Z".into(),
                expires_at: "2026-09-07T00:30:00Z".into(),
                status: "created".into(),
            })
        }

        fn verify_intent(
            &self,
            intent_id: &str,
            intent_secret: &str,
            request: &VerifyIntentRequest,
        ) -> Result<VerifyTransport, BackendError> {
            assert_eq!(intent_id, "pi_test_01");
            assert_eq!(intent_secret, TOKEN);
            assert_eq!(request.device_public_key, DEVICE);
            if let Some((entered, release)) = self.verify_blocker.lock().unwrap().clone() {
                entered.wait();
                release.wait();
            }
            if let Some(code) = self.verify_error.lock().unwrap().take() {
                return Err(BackendError::Rejected {
                    code,
                    request_id: Some("req_test".into()),
                });
            }
            Ok(match self.verifies.fetch_add(1, Ordering::SeqCst) {
                0 => VerifyTransport::Pending(VerifyPendingResponse {
                    verified: false,
                    status: "pending".into(),
                }),
                1 => VerifyTransport::Pending(VerifyPendingResponse {
                    verified: false,
                    status: "awaiting_finality".into(),
                }),
                _ => VerifyTransport::Confirmed(VerifyConfirmedResponse {
                    verified: true,
                    status: "confirmed".into(),
                    payment_id: "pay_test_01".into(),
                    entitlement_id: "ent_test_01".into(),
                    archive_id: "arc_test_01".into(),
                    archive_fingerprint: FINGERPRINT.into(),
                    device_public_key: DEVICE.into(),
                    next_step: "activate_device".into(),
                }),
            })
        }

        fn activate(
            &self,
            _intent_id: &str,
            _intent_secret: &str,
            request: &crate::backend::ActivationRequest,
        ) -> Result<ActivationResponse, BackendError> {
            self.activation_nonces
                .lock()
                .unwrap()
                .push(request.request_nonce.clone());
            if self
                .activation_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                return Err(BackendError::Unavailable);
            }
            let grant = issued_grant(
                &request.request_nonce,
                "2026-09-07T00:00:00Z",
                "2026-09-10T00:00:00Z",
            );
            Ok(ActivationResponse {
                license: grant.license,
                wrapped_content_key: grant.wrapped_content_key,
                device_refresh_token: TOKEN.into(),
            })
        }

        fn refresh(
            &self,
            license_id: &str,
            refresh_token: &str,
            request: &crate::backend::RefreshRequest,
        ) -> Result<LicenseGrant, BackendError> {
            assert_eq!(license_id, "lic_test_01");
            assert_eq!(refresh_token, TOKEN);
            assert_eq!(request.archive_id, "arc_test_01");
            if let Some(code) = self.refresh_error.lock().unwrap().take() {
                return Err(BackendError::Rejected {
                    code,
                    request_id: Some("req_refresh".into()),
                });
            }
            Ok(issued_grant(
                &request.request_nonce,
                "2026-09-10T00:00:00Z",
                "2026-09-13T00:00:00Z",
            ))
        }
    }

    #[derive(Default)]
    struct FailingWriteStore {
        values: Mutex<std::collections::HashMap<(SecretPurpose, String), Vec<u8>>>,
        fail_purpose: Mutex<Option<SecretPurpose>>,
        write_failures: AtomicUsize,
        fail_delete_purpose: Mutex<Option<SecretPurpose>>,
        delete_failures: AtomicUsize,
    }

    impl FailingWriteStore {
        fn failing(purpose: SecretPurpose) -> Self {
            Self {
                values: Mutex::default(),
                fail_purpose: Mutex::new(Some(purpose)),
                write_failures: AtomicUsize::new(1),
                fail_delete_purpose: Mutex::new(None),
                delete_failures: AtomicUsize::new(0),
            }
        }

        fn failing_delete_once(purpose: SecretPurpose) -> Self {
            Self {
                values: Mutex::default(),
                fail_purpose: Mutex::new(None),
                write_failures: AtomicUsize::new(0),
                fail_delete_purpose: Mutex::new(Some(purpose)),
                delete_failures: AtomicUsize::new(1),
            }
        }
    }

    impl KeyedSecretStore for FailingWriteStore {
        fn read(
            &self,
            purpose: SecretPurpose,
            key: &str,
        ) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, ViewerError> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(purpose, key.to_owned()))
                .cloned()
                .map(zeroize::Zeroizing::new))
        }

        fn write(
            &self,
            purpose: SecretPurpose,
            key: &str,
            secret: &[u8],
        ) -> Result<(), ViewerError> {
            if *self.fail_purpose.lock().unwrap() == Some(purpose)
                && self
                    .write_failures
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                        remaining.checked_sub(1)
                    })
                    .is_ok()
            {
                return Err(ViewerError::SecureStoreUnavailable);
            }
            self.values
                .lock()
                .unwrap()
                .insert((purpose, key.to_owned()), secret.to_vec());
            Ok(())
        }

        fn delete(&self, purpose: SecretPurpose, key: &str) -> Result<(), ViewerError> {
            if *self.fail_delete_purpose.lock().unwrap() == Some(purpose)
                && self
                    .delete_failures
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                        remaining.checked_sub(1)
                    })
                    .is_ok()
            {
                return Err(ViewerError::SecureStoreUnavailable);
            }
            self.values
                .lock()
                .unwrap()
                .remove(&(purpose, key.to_owned()));
            Ok(())
        }
    }

    struct FailOnceSecretStore {
        value: Mutex<Option<Vec<u8>>>,
        write_failures: AtomicUsize,
    }

    impl FailOnceSecretStore {
        fn new() -> Self {
            Self {
                value: Mutex::new(None),
                write_failures: AtomicUsize::new(1),
            }
        }
    }

    impl SecretStore for FailOnceSecretStore {
        fn read(&self) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, ViewerError> {
            Ok(self
                .value
                .lock()
                .unwrap()
                .clone()
                .map(zeroize::Zeroizing::new))
        }

        fn write(&self, secret: &[u8]) -> Result<(), ViewerError> {
            if self
                .write_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                return Err(ViewerError::SecureStoreUnavailable);
            }
            *self.value.lock().unwrap() = Some(secret.to_vec());
            Ok(())
        }

        fn delete(&self) -> Result<(), ViewerError> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn intent_is_secret_first_resumable_nonduplicating_and_finality_gated() {
        let directory = tempfile::tempdir().unwrap();
        let payments_root = directory.path().join("payments");
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        let ready = service.prepare_payment(&archives, &device).unwrap();
        assert_eq!(ready.state, PaymentState::PaymentReady);
        assert_eq!(ready.solana_pay_url, "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction");
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert_eq!(
            std::str::from_utf8(
                &vault
                    .read(SecretPurpose::PaymentIntent, "pi_test_01")
                    .unwrap()
                    .unwrap()
            )
            .unwrap(),
            TOKEN
        );
        assert_eq!(service.prepare_payment(&archives, &device).unwrap(), ready);
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert!(matches!(
            service.activate(
                &archives,
                &device,
                &LocalLicenseRepository::new(directory.path().join("early-licenses")).unwrap(),
                &TrustConfig::development_fixtures().unwrap().license_keys,
                &RollbackManager::new(Arc::new(MemorySecretStore::default())),
                sample(),
            ),
            Err(ViewerError::PaymentFailed)
        ));

        assert_eq!(service.verify_payment().unwrap().1, VerifyOutcome::Pending);
        assert_eq!(
            service.verify_payment().unwrap().1,
            VerifyOutcome::AwaitingFinality
        );
        assert_eq!(
            service.verify_payment().unwrap().1,
            VerifyOutcome::Confirmed
        );

        drop(service);
        let resumed = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault,
            ActiveIntentRepository::new(payments_root).unwrap(),
            Arc::new(FixedNonce),
        );
        resumed.check_metadata(&archives, &device).unwrap();
        assert_eq!(
            resumed.current_payment().unwrap().unwrap().state,
            PaymentState::Activating
        );
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn durable_activation_persists_replacement_before_consuming_intent() {
        let directory = tempfile::tempdir().unwrap();
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let rollback = RollbackManager::new(Arc::new(MemorySecretStore::default()));
        let service = PaymentService::with_nonce_source(
            Some(backend),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let license_trust = TrustConfig::development_fixtures().unwrap().license_keys;
        service
            .activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &rollback,
                sample(),
            )
            .unwrap();
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_none());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());
        let files = archives
            .list_files(time::OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap())
            .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_id, "file_000000");
        assert_eq!(
            &*archives
                .read_file_range(
                    "file_000000",
                    0,
                    1,
                    time::OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap()
                )
                .unwrap(),
            b"\x89"
        );
    }

    #[test]
    fn activation_cleanup_failure_keeps_license_hides_qr_and_retries_on_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let payments_root = directory.path().join("payments");
        let vault = Arc::new(FailingWriteStore::failing_delete_once(
            SecretPurpose::PaymentIntent,
        ));
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let rollback = RollbackManager::new(Arc::new(MemorySecretStore::default()));
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let license_trust = TrustConfig::development_fixtures().unwrap().license_keys;

        service
            .activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &rollback,
                sample(),
            )
            .unwrap();
        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());
        assert!(service.current_payment().unwrap().is_none());
        assert_eq!(
            service
                .repository
                .load("arc_test_01")
                .unwrap()
                .unwrap()
                .status,
            ActiveIntentStatus::Confirmed
        );
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
        assert!(service.prepare_payment(&archives, &device).is_err());
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);

        drop(service);
        archives.relock().unwrap();
        let archive = archives.locked_identity().unwrap();
        let private = device.load_or_create().unwrap();
        let unwrapped = licenses
            .load_and_validate(
                &archive.archive_id,
                &license_trust,
                &private,
                &LicenseValidationContext {
                    archive_id: &archive.archive_id,
                    archive_fingerprint: &archive.fingerprint,
                    device_public_key: private.public_key_bytes().unwrap(),
                    now: at("2026-09-08T00:00:00Z"),
                },
            )
            .unwrap();
        archives
            .install_unwrapped(
                &archive.archive_id,
                &archive.fingerprint,
                unwrapped.unwrap(),
            )
            .unwrap();
        let restarted = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(payments_root).unwrap(),
            Arc::new(FixedNonce),
        );
        restarted.cleanup_completed_intent_after_unlock(
            &archive.archive_id,
            &archive.fingerprint,
            DEVICE,
        );
        assert!(restarted.current_payment().unwrap().is_none());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_none());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());
        assert!(restarted.repository.load("arc_test_01").unwrap().is_none());
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert!(restarted.prepare_payment(&archives, &device).is_err());
    }

    #[test]
    fn activation_metadata_cleanup_failure_is_removed_after_cached_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let payments_root = directory.path().join("payments");
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.repository.fail_next_clear_for_test();
        service
            .activate(
                &archives,
                &device,
                &licenses,
                &TrustConfig::development_fixtures().unwrap().license_keys,
                &RollbackManager::new(Arc::new(MemorySecretStore::default())),
                sample(),
            )
            .unwrap();

        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_none());
        assert!(service.repository.load("arc_test_01").unwrap().is_some());
        assert!(service.current_payment().unwrap().is_none());
        assert!(service.prepare_payment(&archives, &device).is_err());
        drop(service);

        let restarted = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(payments_root).unwrap(),
            Arc::new(FixedNonce),
        );
        restarted.cleanup_completed_intent_after_unlock("arc_test_01", FINGERPRINT, DEVICE);
        assert!(restarted.repository.load("arc_test_01").unwrap().is_none());
        assert!(restarted.current_payment().unwrap().is_none());
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert!(restarted.prepare_payment(&archives, &device).is_err());
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn license_write_failure_keeps_intent_for_restart_activation_retry() {
        let directory = tempfile::tempdir().unwrap();
        let payments_root = directory.path().join("payments");
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        licenses.fail_next_save_for_test();
        let nonce = Arc::new(SequenceNonce::default());
        let rollback_store = Arc::new(MemorySecretStore::default());
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            nonce.clone(),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let license_trust = TrustConfig::development_fixtures().unwrap().license_keys;

        assert!(matches!(
            service.activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &RollbackManager::new(rollback_store.clone()),
                sample(),
            ),
            Err(ViewerError::LicenseStorage)
        ));
        assert!(!licenses.has_local_grant("arc_test_01").unwrap());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());
        assert!(service.repository.load("arc_test_01").unwrap().is_some());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());

        drop(service);
        let restarted = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault,
            ActiveIntentRepository::new(payments_root).unwrap(),
            nonce,
        );
        restarted.check_metadata(&archives, &device).unwrap();
        assert_eq!(
            restarted.prepare_payment(&archives, &device).unwrap().state,
            PaymentState::Activating
        );
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        restarted
            .activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &RollbackManager::new(rollback_store),
                sample(),
            )
            .unwrap();
        let activation_nonces = backend.activation_nonces.lock().unwrap();
        assert_eq!(activation_nonces.len(), 2);
        assert_ne!(activation_nonces[0], activation_nonces[1]);
        drop(activation_nonces);
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(restarted.current_payment().unwrap().is_none());
    }

    #[test]
    fn rollback_write_failure_preserves_durable_license_and_activation_retry() {
        let directory = tempfile::tempdir().unwrap();
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let rollback_store = Arc::new(FailOnceSecretStore::new());
        let rollback = RollbackManager::new(rollback_store);
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(SequenceNonce::default()),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let license_trust = TrustConfig::development_fixtures().unwrap().license_keys;

        assert!(matches!(
            service.activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &rollback,
                sample(),
            ),
            Err(ViewerError::SecureStoreUnavailable)
        ));
        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());
        assert!(service.repository.load("arc_test_01").unwrap().is_some());
        assert!(archives.list_files(at("2026-09-08T00:00:00Z")).is_err());

        service
            .activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &rollback,
                sample(),
            )
            .unwrap();
        let activation_nonces = backend.activation_nonces.lock().unwrap();
        assert_eq!(activation_nonces.len(), 2);
        assert_ne!(activation_nonces[0], activation_nonces[1]);
        drop(activation_nonces);
        assert!(service.current_payment().unwrap().is_none());
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn changed_archive_install_failure_keeps_license_for_original_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("vector.slr");
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let rollback = RollbackManager::new(Arc::new(MemorySecretStore::default()));
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let license_trust = TrustConfig::development_fixtures().unwrap().license_keys;
        std::fs::write(&archive_path, b"changed after payment confirmation").unwrap();

        assert!(service
            .activate(
                &archives,
                &device,
                &licenses,
                &license_trust,
                &rollback,
                sample(),
            )
            .is_err());
        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_some());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());
        assert!(service.repository.load("arc_test_01").unwrap().is_some());
        assert!(archives.list_files(at("2026-09-08T00:00:00Z")).is_err());

        let original = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        std::fs::write(&archive_path, original).unwrap();
        let archive = archives.open(&archive_path).unwrap();
        let private = device.load_or_create().unwrap();
        let unwrapped = licenses
            .load_and_validate(
                &archive.archive_id,
                &license_trust,
                &private,
                &LicenseValidationContext {
                    archive_id: &archive.archive_id,
                    archive_fingerprint: &archive.fingerprint,
                    device_public_key: private.public_key_bytes().unwrap(),
                    now: at("2026-09-08T00:00:00Z"),
                },
            )
            .unwrap()
            .unwrap();
        archives
            .install_unwrapped(&archive.archive_id, &archive.fingerprint, unwrapped)
            .unwrap();
        service.cleanup_completed_intent_after_unlock(
            &archive.archive_id,
            &archive.fingerprint,
            DEVICE,
        );
        assert!(service.current_payment().unwrap().is_none());
        assert!(service.repository.load("arc_test_01").unwrap().is_none());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_none());
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn intent_secret_failures_recover_orphans_without_exposing_old_qr() {
        let directory = tempfile::tempdir().unwrap();
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let failing: Arc<dyn KeyedSecretStore> =
            Arc::new(FailingWriteStore::failing(SecretPurpose::PaymentIntent));
        let repository =
            ActiveIntentRepository::new(directory.path().join("failed-payments")).unwrap();
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            failing,
            repository,
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        assert!(matches!(
            service.prepare_payment(&archives, &device),
            Err(ViewerError::SecureStoreUnavailable)
        ));
        assert!(service.current_payment().unwrap().is_none());

        let payments_root = directory.path().join("missing-secret-payments");
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            Arc::new(FixedNonce),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        vault
            .delete(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap();
        drop(service);

        let restarted = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            Arc::new(FixedNonce),
        );
        restarted.check_metadata(&archives, &device).unwrap();
        assert!(restarted.current_payment().unwrap().is_none());
        assert!(ActiveIntentRepository::new(payments_root)
            .unwrap()
            .load("arc_test_01")
            .unwrap()
            .is_none());
        assert_eq!(
            restarted.prepare_payment(&archives, &device).unwrap().state,
            PaymentState::PaymentReady
        );

        for (case, corrupt_secret) in [
            ("non-utf8", &b"\xff\x00"[..]),
            ("invalid-token32", &b"not-a-valid-token32"[..]),
        ] {
            let corrupt_root = directory.path().join(format!("{case}-secret-payments"));
            let corrupt_vault: Arc<dyn KeyedSecretStore> =
                Arc::new(MemoryKeyedSecretStore::default());
            let service = PaymentService::with_nonce_source(
                Some(backend.clone()),
                Some(config.clone()),
                corrupt_vault.clone(),
                ActiveIntentRepository::new(corrupt_root.clone()).unwrap(),
                Arc::new(FixedNonce),
            );
            service.check_metadata(&archives, &device).unwrap();
            service.prepare_payment(&archives, &device).unwrap();
            corrupt_vault
                .write(SecretPurpose::PaymentIntent, "pi_test_01", corrupt_secret)
                .unwrap();
            drop(service);

            let restarted = PaymentService::with_nonce_source(
                Some(backend.clone()),
                Some(config.clone()),
                corrupt_vault,
                ActiveIntentRepository::new(corrupt_root.clone()).unwrap(),
                Arc::new(FixedNonce),
            );
            restarted.check_metadata(&archives, &device).unwrap();
            assert!(restarted.current_payment().unwrap().is_none());
            assert!(ActiveIntentRepository::new(corrupt_root)
                .unwrap()
                .load("arc_test_01")
                .unwrap()
                .is_none());
            assert_eq!(
                restarted.prepare_payment(&archives, &device).unwrap().state,
                PaymentState::PaymentReady
            );
        }
        assert_eq!(backend.creates.load(Ordering::SeqCst), 7);
    }

    #[test]
    fn authoritative_metadata_mismatch_prevents_intent_creation() {
        let directory = tempfile::tempdir().unwrap();
        let backend = Arc::new(MockBackend::default());
        backend.metadata_mismatch.store(true, Ordering::SeqCst);
        let (archives, device) = open_fixture(directory.path());
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(BackendConfig::development("https://api.solarch.example/").unwrap()),
            Arc::new(MemoryKeyedSecretStore::default()),
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(FixedNonce),
        );

        assert!(matches!(
            service.check_metadata(&archives, &device),
            Err(ViewerError::MetadataMismatch)
        ));
        assert!(matches!(
            service.prepare_payment(&archives, &device),
            Err(ViewerError::MetadataMismatch)
        ));
        assert_eq!(backend.creates.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn verification_is_single_flight_and_terminal_expiry_cleans_intent() {
        let directory = tempfile::tempdir().unwrap();
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let service = Arc::new(PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(FixedNonce),
        ));
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();

        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        *backend.verify_blocker.lock().unwrap() = Some((entered.clone(), release.clone()));
        let first = {
            let service = service.clone();
            std::thread::spawn(move || service.verify_payment())
        };
        entered.wait();
        assert!(matches!(
            service.verify_payment(),
            Err(ViewerError::BackendUnavailable)
        ));
        release.wait();
        assert_eq!(first.join().unwrap().unwrap().1, VerifyOutcome::Pending);
        *backend.verify_blocker.lock().unwrap() = None;

        *backend.verify_error.lock().unwrap() = Some(BackendErrorCode::RateLimited);
        assert!(matches!(
            service.verify_payment(),
            Err(ViewerError::BackendUnavailable)
        ));
        assert!(service.current_payment().unwrap().is_some());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());

        *backend.verify_error.lock().unwrap() = Some(BackendErrorCode::PaymentIntentExpired);
        assert!(matches!(
            service.verify_payment(),
            Err(ViewerError::PaymentExpired)
        ));
        assert!(service.current_payment().unwrap().is_none());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_none());
    }

    #[test]
    fn activation_retry_uses_fresh_nonce_and_refresh_extends_expired_window() {
        let directory = tempfile::tempdir().unwrap();
        let vault: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let backend = Arc::new(MockBackend::default());
        backend.activation_failures.store(1, Ordering::SeqCst);
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let rollback = RollbackManager::new(Arc::new(MemorySecretStore::default()));
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault,
            ActiveIntentRepository::new(directory.path().join("payments")).unwrap(),
            Arc::new(SequenceNonce::default()),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        let trust = TrustConfig::development_fixtures().unwrap().license_keys;
        assert!(matches!(
            service.activate(&archives, &device, &licenses, &trust, &rollback, sample()),
            Err(ViewerError::BackendUnavailable)
        ));
        service
            .activate(&archives, &device, &licenses, &trust, &rollback, sample())
            .unwrap();
        let nonces = backend.activation_nonces.lock().unwrap();
        assert_eq!(nonces.len(), 2);
        assert_ne!(nonces[0], nonces[1]);
        drop(nonces);

        archives.relock().unwrap();
        let refresh_sample = ProcessClockSample {
            utc_unix_seconds: 1_789_084_800,
            monotonic_millis: 2_000,
        };
        service
            .refresh(
                &archives,
                &device,
                &licenses,
                &trust,
                &rollback,
                refresh_sample,
            )
            .unwrap();
        let after_old_deadline = time::OffsetDateTime::from_unix_timestamp(1_789_171_200).unwrap();
        assert_eq!(archives.list_files(after_old_deadline).unwrap().len(), 1);

        archives.relock().unwrap();
        *backend.refresh_error.lock().unwrap() = Some(BackendErrorCode::LicenseRevoked);
        assert!(matches!(
            service.refresh(
                &archives,
                &device,
                &licenses,
                &trust,
                &rollback,
                refresh_sample,
            ),
            Err(ViewerError::LicenseRevoked)
        ));
        assert!(archives.list_files(after_old_deadline).is_err());
        assert!(service
            .secrets
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn refresh_token_write_failure_keeps_intent_for_restart_activation_retry() {
        let directory = tempfile::tempdir().unwrap();
        let payments_root = directory.path().join("payments");
        let vault = Arc::new(FailingWriteStore::failing(SecretPurpose::DeviceRefresh));
        let backend = Arc::new(MockBackend::default());
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        let (archives, device) = open_fixture(directory.path());
        let licenses = LocalLicenseRepository::new(directory.path().join("licenses")).unwrap();
        let nonce = Arc::new(SequenceNonce::default());
        let rollback_store = Arc::new(MemorySecretStore::default());
        let service = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config.clone()),
            vault.clone(),
            ActiveIntentRepository::new(payments_root.clone()).unwrap(),
            nonce.clone(),
        );
        service.check_metadata(&archives, &device).unwrap();
        service.prepare_payment(&archives, &device).unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        service.verify_payment().unwrap();
        assert!(matches!(
            service.activate(
                &archives,
                &device,
                &licenses,
                &TrustConfig::development_fixtures().unwrap().license_keys,
                &RollbackManager::new(rollback_store.clone()),
                sample(),
            ),
            Err(ViewerError::SecureStoreUnavailable)
        ));
        assert!(!licenses.has_local_grant("arc_test_01").unwrap());
        assert_eq!(
            service.current_payment().unwrap().unwrap().state,
            PaymentState::Activating
        );
        assert!(service.repository.load("arc_test_01").unwrap().is_some());
        assert!(vault
            .read(SecretPurpose::PaymentIntent, "pi_test_01")
            .unwrap()
            .is_some());
        assert!(vault
            .read(
                SecretPurpose::DeviceRefresh,
                &refresh_key("arc_test_01", "lic_test_01")
            )
            .unwrap()
            .is_none());
        assert!(archives.list_files(at("2026-09-08T00:00:00Z")).is_err());

        drop(service);
        let restarted = PaymentService::with_nonce_source(
            Some(backend.clone()),
            Some(config),
            vault.clone(),
            ActiveIntentRepository::new(payments_root).unwrap(),
            nonce,
        );
        restarted.check_metadata(&archives, &device).unwrap();
        assert_eq!(
            restarted.prepare_payment(&archives, &device).unwrap().state,
            PaymentState::Activating
        );
        assert_eq!(backend.creates.load(Ordering::SeqCst), 1);
        restarted
            .activate(
                &archives,
                &device,
                &licenses,
                &TrustConfig::development_fixtures().unwrap().license_keys,
                &RollbackManager::new(rollback_store),
                sample(),
            )
            .unwrap();
        let activation_nonces = backend.activation_nonces.lock().unwrap();
        assert_eq!(activation_nonces.len(), 2);
        assert_ne!(activation_nonces[0], activation_nonces[1]);
        drop(activation_nonces);
        assert!(licenses.has_local_grant("arc_test_01").unwrap());
        assert!(restarted.current_payment().unwrap().is_none());
        assert_eq!(
            archives
                .list_files(at("2026-09-08T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
    }

    fn open_fixture(root: &std::path::Path) -> (ArchiveService, DeviceManager) {
        let archive_path = root.join("vector.slr");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        std::fs::write(&archive_path, bytes).unwrap();
        let trust = TrustConfig::development_fixtures().unwrap();
        let archives = ArchiveService::new(trust.archive_keys);
        archives.open(&archive_path).unwrap();
        let device = DeviceManager::new(Arc::new(MemorySecretStore::with_value(
            vector_private_bytes().to_vec(),
        )));
        (archives, device)
    }

    fn fixture_grant() -> LicenseGrant {
        LicenseGrant::parse_transport(include_bytes!(
            "../../../../tests/fixtures/license_v1_vector.json"
        ))
        .unwrap()
    }

    fn issued_grant(nonce: &str, issued_at: &str, offline_valid_until: &str) -> LicenseGrant {
        let mut grant = fixture_grant();
        grant.license.payload.request_nonce = nonce.to_owned();
        grant.license.payload.issued_at = issued_at.to_owned();
        grant.license.payload.offline_valid_until = offline_valid_until.to_owned();

        let payload = grant.payload_jcs().unwrap();
        let mut info = b"SolArch/content-key-wrap/info/v1\0".to_vec();
        info.extend_from_slice(&Sha256::digest(&payload));
        let mut aad = b"SolArch/content-key-wrap/aad/v1\0".to_vec();
        aad.extend_from_slice(&payload);
        let public_bytes: [u8; 32] = STANDARD.decode(DEVICE).unwrap().try_into().unwrap();
        let public = <X25519HkdfSha256 as hpke::Kem>::PublicKey::from_bytes(&public_bytes).unwrap();
        let mut rng = TestRng(0x1357_9bdf_2468_ace0);
        let (enc, ciphertext) =
            single_shot_seal_with_rng::<AesGcm256, HkdfSha256, X25519HkdfSha256>(
                &OpModeS::Base,
                &public,
                &info,
                &std::array::from_fn::<_, 32, _>(|index| 0xa0 + index as u8),
                &aad,
                &mut rng,
            )
            .unwrap();
        grant.wrapped_content_key.enc = STANDARD.encode(enc.to_bytes());
        grant.wrapped_content_key.ciphertext = STANDARD.encode(ciphertext);

        let signing = SigningKey::from_bytes(&std::array::from_fn(|index| 0x40 + index as u8));
        let mut message = b"SolArch/license-signature/v1\0".to_vec();
        message.extend_from_slice(&grant.signature_object_jcs().unwrap());
        grant.license.server_signature = STANDARD.encode(signing.sign(&message).to_bytes());
        grant
    }

    struct TestRng(u64);

    impl TestRng {
        fn advance(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
    }

    impl TryRng for TestRng {
        type Error = Infallible;

        fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
            Ok(self.advance() as u32)
        }

        fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
            Ok(self.advance())
        }

        fn try_fill_bytes(&mut self, destination: &mut [u8]) -> Result<(), Self::Error> {
            for chunk in destination.chunks_mut(8) {
                let bytes = self.advance().to_le_bytes();
                chunk.copy_from_slice(&bytes[..chunk.len()]);
            }
            Ok(())
        }
    }

    impl TryCryptoRng for TestRng {}

    fn sample() -> ProcessClockSample {
        ProcessClockSample {
            utc_unix_seconds: 1_788_825_600,
            monotonic_millis: 1_000,
        }
    }

    fn at(value: &str) -> time::OffsetDateTime {
        solarch_core::format::parse_timestamp(value).unwrap()
    }

    fn vector_private_bytes() -> [u8; 32] {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/license_v1_test_secrets.json"
        ))
        .unwrap();
        let value = fixture["device_x25519_private_key_hex"].as_str().unwrap();
        let mut result = [0_u8; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            result[index] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        result
    }
}
