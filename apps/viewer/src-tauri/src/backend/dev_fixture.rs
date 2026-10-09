//! Explicit synthetic Part 03 integration Backend.
//!
//! This module is compiled only with `development-fixtures`. It performs no
//! blockchain verification and must never be represented as a real payment.

use std::sync::atomic::{AtomicUsize, Ordering};

use base64::{engine::general_purpose::STANDARD, Engine as _};
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

use super::{
    ActivationRequest, ActivationResponse, ArchiveMetadataResponse, BackendApi, BackendError,
    CreateIntentRequest, CreatorDto, LicensePolicyDto, MoneyDto, PaymentIntentResponse,
    RefreshRequest, VerifyConfirmedResponse, VerifyIntentRequest, VerifyPendingResponse,
    VerifyTransport,
};

const TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const ARCHIVE_ID: &str = "arc_test_01";
const FINGERPRINT: &str = "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb";
const DEVICE: &str = "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DevFixtureMode {
    Payment,
    Part04Payment,
    Unavailable,
    Refresh,
}

impl DevFixtureMode {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "part03-payment" => Self::Payment,
            "part04-payment" => Self::Part04Payment,
            "part03-unavailable" => Self::Unavailable,
            "part03-refresh" => Self::Refresh,
            _ => return None,
        })
    }
}

pub struct DevFixtureBackend {
    mode: DevFixtureMode,
    verification_count: AtomicUsize,
}

impl DevFixtureBackend {
    pub fn new(mode: DevFixtureMode) -> Self {
        Self {
            mode,
            verification_count: AtomicUsize::new(0),
        }
    }

    fn available(&self) -> Result<(), BackendError> {
        if self.mode == DevFixtureMode::Unavailable {
            Err(BackendError::Unavailable)
        } else {
            Ok(())
        }
    }

    fn fingerprint(&self) -> Result<String, BackendError> {
        if self.mode != DevFixtureMode::Part04Payment {
            return Ok(FINGERPRINT.into());
        }
        let value = std::env::var("SOLARCH_DEV_ARCHIVE_FINGERPRINT")
            .map_err(|_| BackendError::InvalidResponse)?;
        normalize_fingerprint(&value).ok_or(BackendError::InvalidResponse)
    }
}

fn normalize_fingerprint(value: &str) -> Option<String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(value.to_ascii_lowercase())
}

impl BackendApi for DevFixtureBackend {
    fn archive_metadata(&self, archive_id: &str) -> Result<ArchiveMetadataResponse, BackendError> {
        self.available()?;
        if archive_id != ARCHIVE_ID {
            return Err(BackendError::InvalidResponse);
        }
        let fingerprint = self.fingerprint()?;
        Ok(ArchiveMetadataResponse {
            archive_id: ARCHIVE_ID.into(),
            status: "published".into(),
            platform_fee_bps: 500,
            title: "Test archive".into(),
            price: MoneyDto {
                amount: "10.000000".into(),
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
            archive_fingerprint: fingerprint,
        })
    }

    fn create_intent(
        &self,
        request: &CreateIntentRequest,
    ) -> Result<PaymentIntentResponse, BackendError> {
        self.available()?;
        if request.archive_id != ARCHIVE_ID || request.device_public_key != DEVICE {
            return Err(BackendError::InvalidResponse);
        }
        let fingerprint = self.fingerprint()?;
        Ok(PaymentIntentResponse {
            payment_intent_id: "pi_test_01".into(),
            archive_id: ARCHIVE_ID.into(),
            archive_fingerprint: fingerprint,
            device_public_key: DEVICE.into(),
            payment_intent_client_secret: TOKEN.into(),
            amount: "10.000000".into(),
            currency: "USDC".into(),
            creator_share: "9.500000".into(),
            platform_share: "0.500000".into(),
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
        self.available()?;
        if intent_id != "pi_test_01"
            || intent_secret != TOKEN
            || request.device_public_key != DEVICE
        {
            return Err(BackendError::InvalidResponse);
        }
        let fingerprint = self.fingerprint()?;
        Ok(
            match self.verification_count.fetch_add(1, Ordering::SeqCst) {
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
                    archive_id: ARCHIVE_ID.into(),
                    archive_fingerprint: fingerprint,
                    device_public_key: DEVICE.into(),
                    next_step: "activate_device".into(),
                }),
            },
        )
    }

    fn activate(
        &self,
        intent_id: &str,
        intent_secret: &str,
        request: &ActivationRequest,
    ) -> Result<ActivationResponse, BackendError> {
        self.available()?;
        if intent_id != "pi_test_01"
            || intent_secret != TOKEN
            || request.device_public_key != DEVICE
        {
            return Err(BackendError::InvalidResponse);
        }
        let grant = issue_grant(
            &request.request_nonce,
            "2026-09-07T00:00:00Z",
            "2026-09-10T00:00:00Z",
            &self.fingerprint()?,
        )?;
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
        request: &RefreshRequest,
    ) -> Result<LicenseGrant, BackendError> {
        self.available()?;
        if self.mode != DevFixtureMode::Refresh
            || license_id != "lic_test_01"
            || refresh_token != TOKEN
            || request.archive_id != ARCHIVE_ID
            || request.device_public_key != DEVICE
        {
            return Err(BackendError::InvalidResponse);
        }
        issue_grant(
            &request.request_nonce,
            "2026-09-10T00:00:00Z",
            "2026-09-13T00:00:00Z",
            FINGERPRINT,
        )
    }
}

fn issue_grant(
    nonce: &str,
    issued_at: &str,
    offline_valid_until: &str,
    archive_fingerprint: &str,
) -> Result<LicenseGrant, BackendError> {
    let mut grant = LicenseGrant::parse_transport(include_bytes!(
        "../../../../../tests/fixtures/license_v1_vector.json"
    ))
    .map_err(|_| BackendError::InvalidResponse)?;
    grant.license.payload.request_nonce = nonce.to_owned();
    grant.license.payload.issued_at = issued_at.to_owned();
    grant.license.payload.offline_valid_until = offline_valid_until.to_owned();
    grant.license.payload.archive_fingerprint = archive_fingerprint.to_owned();

    let payload = grant
        .payload_jcs()
        .map_err(|_| BackendError::InvalidResponse)?;
    let mut info = b"SolArch/content-key-wrap/info/v1\0".to_vec();
    info.extend_from_slice(&Sha256::digest(&payload));
    let mut aad = b"SolArch/content-key-wrap/aad/v1\0".to_vec();
    aad.extend_from_slice(&payload);
    let public_bytes: [u8; 32] = STANDARD
        .decode(DEVICE)
        .map_err(|_| BackendError::InvalidResponse)?
        .try_into()
        .map_err(|_| BackendError::InvalidResponse)?;
    let public = <X25519HkdfSha256 as hpke::Kem>::PublicKey::from_bytes(&public_bytes)
        .map_err(|_| BackendError::InvalidResponse)?;
    let mut rng = DeterministicFixtureRng(0x1357_9bdf_2468_ace0);
    let (enc, ciphertext) = single_shot_seal_with_rng::<AesGcm256, HkdfSha256, X25519HkdfSha256>(
        &OpModeS::Base,
        &public,
        &info,
        &std::array::from_fn::<_, 32, _>(|index| 0xa0 + index as u8),
        &aad,
        &mut rng,
    )
    .map_err(|_| BackendError::InvalidResponse)?;
    grant.wrapped_content_key.enc = STANDARD.encode(enc.to_bytes());
    grant.wrapped_content_key.ciphertext = STANDARD.encode(ciphertext);

    let signing = SigningKey::from_bytes(&std::array::from_fn(|index| 0x40 + index as u8));
    let mut message = b"SolArch/license-signature/v1\0".to_vec();
    message.extend_from_slice(
        &grant
            .signature_object_jcs()
            .map_err(|_| BackendError::InvalidResponse)?,
    );
    grant.license.server_signature = STANDARD.encode(signing.sign(&message).to_bytes());
    Ok(grant)
}

struct DeterministicFixtureRng(u64);

impl DeterministicFixtureRng {
    fn advance(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

impl TryRng for DeterministicFixtureRng {
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

impl TryCryptoRng for DeterministicFixtureRng {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part04_mode_requires_an_exact_fingerprint_shape() {
        assert_eq!(
            DevFixtureMode::parse("part04-payment"),
            Some(DevFixtureMode::Part04Payment)
        );
        assert_eq!(
            normalize_fingerprint(
                "410964651C82DF094A4E2E653E9340816B0C5F0B1908343AB55B493A0C0692C4"
            )
            .as_deref(),
            Some("410964651c82df094a4e2e653e9340816b0c5f0b1908343ab55b493a0c0692c4")
        );
        assert!(normalize_fingerprint("too-short").is_none());
        assert!(normalize_fingerprint(
            "zz0964651c82df094a4e2e653e9340816b0c5f0b1908343ab55b493a0c0692c4"
        )
        .is_none());
    }
}
