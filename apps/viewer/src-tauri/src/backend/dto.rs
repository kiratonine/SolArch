use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use solarch_core::{
    device::decode_public_key_base64,
    format::{parse_timestamp, valid_id, valid_wallet, PublicHeader},
    license::{LicenseGrant, SignedLicense, WrappedContentKey},
};
use time::OffsetDateTime;
use url::Url;
use zeroize::Zeroizing;

use super::{config::BackendConfig, error::BackendError};

pub const MAX_REQUEST_BYTES: usize = 4096;
pub const MAX_RESPONSE_BYTES: usize = 16_384;
pub const MAX_JSON_DEPTH: usize = 8;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MoneyDto {
    pub amount: String,
    pub currency: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreatorDto {
    pub wallet: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LicensePolicyDto {
    pub max_devices: u32,
    pub allow_export: bool,
    pub watermark_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveMetadataResponse {
    pub archive_id: String,
    pub status: String,
    pub platform_fee_bps: u32,
    pub title: String,
    pub price: MoneyDto,
    pub creator: CreatorDto,
    pub license_policy: LicensePolicyDto,
    pub archive_fingerprint: String,
}

#[derive(Clone, Debug)]
pub struct ValidatedArchiveMetadata(pub ArchiveMetadataResponse);

impl ArchiveMetadataResponse {
    pub fn validate(
        self,
        local: &PublicHeader,
        fingerprint: &str,
    ) -> Result<ValidatedArchiveMetadata, BackendError> {
        if !valid_id(&self.archive_id)
            || self.archive_id != local.archive_id
            || self.status != "published"
            || self.platform_fee_bps != 500
            || !valid_wallet(&self.creator.wallet)
            || self.creator.wallet != local.creator_wallet
            || parse_usdc(&self.price.amount)?
                != parse_usdc(&local.commercial_snapshot.price_amount)?
            || self.price.currency != "USDC"
            || self.price.currency != local.commercial_snapshot.price_currency
            || self.license_policy.max_devices != local.license_snapshot.max_devices
            || self.license_policy.allow_export != local.license_snapshot.allow_export
            || self.license_policy.watermark_enabled != local.license_snapshot.watermark_enabled
            || !valid_fingerprint(&self.archive_fingerprint)
            || self.archive_fingerprint != fingerprint
        {
            return Err(BackendError::InvalidResponse);
        }
        Ok(ValidatedArchiveMetadata(self))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreateIntentRequest {
    pub archive_id: String,
    pub device_public_key: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentIntentResponse {
    pub payment_intent_id: String,
    pub archive_id: String,
    pub archive_fingerprint: String,
    pub device_public_key: String,
    pub payment_intent_client_secret: String,
    pub amount: String,
    pub currency: String,
    pub creator_share: String,
    pub platform_share: String,
    pub payment_reference: String,
    pub solana_pay_url: String,
    pub created_at: String,
    pub expires_at: String,
    pub status: String,
}

impl std::fmt::Debug for PaymentIntentResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PaymentIntentResponse")
            .field("payment_intent_id", &self.payment_intent_id)
            .field("payment_intent_client_secret", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug)]
pub struct PaymentIntentPublic {
    pub payment_intent_id: String,
    pub archive_id: String,
    pub archive_fingerprint: String,
    pub device_public_key: String,
    pub amount: String,
    pub currency: String,
    pub solana_pay_url: String,
    pub created_at: String,
    pub expires_at: String,
}

pub struct ValidatedPaymentIntent {
    pub public: PaymentIntentPublic,
    pub client_secret: Zeroizing<String>,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

impl std::fmt::Debug for ValidatedPaymentIntent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ValidatedPaymentIntent")
            .field("public", &self.public)
            .field("client_secret", &"[REDACTED]")
            .finish()
    }
}

impl PaymentIntentResponse {
    pub fn validate(
        mut self,
        metadata: &ValidatedArchiveMetadata,
        device_public_key: &str,
        config: &BackendConfig,
    ) -> Result<ValidatedPaymentIntent, BackendError> {
        let local = &metadata.0;
        let total = parse_usdc(&self.amount)?;
        let creator = parse_usdc(&self.creator_share)?;
        let platform = parse_usdc(&self.platform_share)?;
        let exact_creator = total.checked_mul(95).ok_or(BackendError::InvalidResponse)?;
        if !valid_id(&self.payment_intent_id)
            || self.archive_id != local.archive_id
            || self.archive_fingerprint != local.archive_fingerprint
            || !valid_fingerprint(&self.archive_fingerprint)
            || self.device_public_key != device_public_key
            || decode_public_key_base64(&self.device_public_key).is_err()
            || total != parse_usdc(&local.price.amount)?
            || self.currency != "USDC"
            || exact_creator % 100 != 0
            || creator != exact_creator / 100
            || platform
                != total
                    .checked_sub(creator)
                    .ok_or(BackendError::InvalidResponse)?
            || !valid_token32(&self.payment_intent_client_secret)
            || !valid_solana_reference(&self.payment_reference)
            || self.status != "created"
        {
            return Err(BackendError::InvalidResponse);
        }
        validate_solana_pay_url(&self.solana_pay_url, &self.payment_intent_id, config)?;
        let created_at = parse_timestamp(&self.created_at).ok_or(BackendError::InvalidResponse)?;
        let expires_at = parse_timestamp(&self.expires_at).ok_or(BackendError::InvalidResponse)?;
        if created_at.checked_add(time::Duration::seconds(1800)) != Some(expires_at) {
            return Err(BackendError::InvalidResponse);
        }
        let client_secret = Zeroizing::new(std::mem::take(&mut self.payment_intent_client_secret));
        Ok(ValidatedPaymentIntent {
            public: PaymentIntentPublic {
                payment_intent_id: self.payment_intent_id,
                archive_id: self.archive_id,
                archive_fingerprint: self.archive_fingerprint,
                device_public_key: self.device_public_key,
                amount: self.amount,
                currency: self.currency,
                solana_pay_url: self.solana_pay_url,
                created_at: self.created_at,
                expires_at: self.expires_at,
            },
            client_secret,
            created_at,
            expires_at,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyIntentRequest {
    pub device_public_key: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyPendingResponse {
    pub verified: bool,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyConfirmedResponse {
    pub verified: bool,
    pub status: String,
    pub payment_id: String,
    pub entitlement_id: String,
    pub archive_id: String,
    pub archive_fingerprint: String,
    pub device_public_key: String,
    pub next_step: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerifyOutcome {
    Pending,
    AwaitingFinality,
    Confirmed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationRequest {
    pub device_public_key: String,
    pub device_name: String,
    pub viewer_version: String,
    pub request_nonce: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationResponse {
    pub license: SignedLicense,
    pub wrapped_content_key: WrappedContentKey,
    pub device_refresh_token: String,
}

impl ActivationResponse {
    pub fn into_parts(mut self) -> Result<(LicenseGrant, Zeroizing<String>), BackendError> {
        if !valid_token32(&self.device_refresh_token) {
            return Err(BackendError::InvalidResponse);
        }
        Ok((
            LicenseGrant {
                license: self.license,
                wrapped_content_key: self.wrapped_content_key,
            },
            Zeroizing::new(std::mem::take(&mut self.device_refresh_token)),
        ))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RefreshRequest {
    pub archive_id: String,
    pub device_public_key: String,
    pub request_nonce: String,
}

pub fn validate_verify_pending(
    value: VerifyPendingResponse,
) -> Result<VerifyOutcome, BackendError> {
    match (value.verified, value.status.as_str()) {
        (false, "pending") => Ok(VerifyOutcome::Pending),
        (false, "awaiting_finality") => Ok(VerifyOutcome::AwaitingFinality),
        _ => Err(BackendError::InvalidResponse),
    }
}

pub fn validate_verify_confirmed(
    value: VerifyConfirmedResponse,
    archive_id: &str,
    archive_fingerprint: &str,
    device_public_key: &str,
) -> Result<VerifyOutcome, BackendError> {
    if !value.verified
        || value.status != "confirmed"
        || !valid_id(&value.payment_id)
        || !valid_id(&value.entitlement_id)
        || value.archive_id != archive_id
        || value.archive_fingerprint != archive_fingerprint
        || value.device_public_key != device_public_key
        || value.next_step != "activate_device"
    {
        return Err(BackendError::InvalidResponse);
    }
    Ok(VerifyOutcome::Confirmed)
}

pub fn valid_token32(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value)
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_solana_reference(value: &str) -> bool {
    bs58::decode(value)
        .into_vec()
        .is_ok_and(|bytes| bytes.len() == 32 && bs58::encode(bytes).into_string() == value)
}

pub(crate) fn validate_solana_pay_url(
    value: &str,
    intent_id: &str,
    config: &BackendConfig,
) -> Result<(), BackendError> {
    let https = value
        .strip_prefix("solana:")
        .ok_or(BackendError::InvalidResponse)?;
    if https.contains('%') {
        return Err(BackendError::InvalidResponse);
    }
    let parsed = Url::parse(https).map_err(|_| BackendError::InvalidResponse)?;
    let expected_path = format!("/v1/solana-pay/payment-intents/{intent_id}/transaction");
    if parsed.scheme() != "https"
        || parsed.origin() != config.origin().origin()
        || parsed.path() != expected_path
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.as_str() != https
    {
        return Err(BackendError::InvalidResponse);
    }
    Ok(())
}

pub(crate) fn parse_usdc(value: &str) -> Result<u64, BackendError> {
    let (whole, fraction) = value.split_once('.').ok_or(BackendError::InvalidResponse)?;
    if whole.is_empty()
        || fraction.is_empty()
        || fraction.len() > 6
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || (whole.len() > 1 && whole.starts_with('0'))
    {
        return Err(BackendError::InvalidResponse);
    }
    let whole = whole
        .parse::<u64>()
        .map_err(|_| BackendError::InvalidResponse)?;
    let fraction = format!("{fraction:0<6}")
        .parse::<u64>()
        .map_err(|_| BackendError::InvalidResponse)?;
    whole
        .checked_mul(1_000_000)
        .and_then(|base| base.checked_add(fraction))
        .ok_or(BackendError::InvalidResponse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_money_and_reference_are_strict() {
        assert!(valid_token32("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"));
        assert!(!valid_token32(
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
        ));
        assert_eq!(parse_usdc("10.00").unwrap(), 10_000_000);
        assert_eq!(parse_usdc("10.000000").unwrap(), 10_000_000);
        assert!(parse_usdc("01.00").is_err());
        assert!(valid_solana_reference("11111111111111111111111111111111"));
        assert!(!valid_solana_reference("0OIl"));
    }

    #[test]
    fn authoritative_metadata_and_intent_bind_every_trusted_field() {
        let header = valid_header();
        let fingerprint = "a".repeat(64);
        let metadata = valid_metadata(&fingerprint)
            .validate(&header, &fingerprint)
            .unwrap();
        let config = BackendConfig::development("https://api.solarch.example/").unwrap();
        assert!(valid_intent(&fingerprint)
            .validate(
                &metadata,
                "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
                &config
            )
            .is_ok());

        for mutation in 0..8 {
            let mut value = valid_intent(&fingerprint);
            match mutation {
                0 => value.amount = "10.01".into(),
                1 => value.creator_share = "9.49".into(),
                2 => value.platform_share = "0.49".into(),
                3 => {
                    value.device_public_key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into()
                }
                4 => value.archive_fingerprint = "b".repeat(64),
                5 => value.payment_intent_client_secret.push('='),
                6 => value.solana_pay_url.push_str("?secret=x"),
                _ => value.expires_at = "2026-09-07T00:30:01Z".into(),
            }
            assert!(value
                .validate(
                    &metadata,
                    "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=",
                    &config
                )
                .is_err());
        }

        for mutation in 0..10 {
            let mut mismatch = valid_metadata(&fingerprint);
            match mutation {
                0 => mismatch.archive_id = "arc_other".into(),
                1 => mismatch.archive_fingerprint = "b".repeat(64),
                2 => mismatch.creator.wallet = bs58::encode([1_u8; 32]).into_string(),
                3 => mismatch.price.amount = "10.000001".into(),
                4 => mismatch.price.currency = "EUR".into(),
                5 => mismatch.platform_fee_bps = 501,
                6 => mismatch.license_policy.max_devices = 2,
                7 => mismatch.license_policy.allow_export = true,
                8 => mismatch.license_policy.watermark_enabled = false,
                _ => mismatch.status = "draft".into(),
            }
            assert!(mismatch.validate(&header, &fingerprint).is_err());
        }
    }

    #[test]
    fn marketplace_presentation_title_may_differ_from_signed_title() {
        let header = valid_header();
        let fingerprint = "a".repeat(64);
        let mut metadata = valid_metadata(&fingerprint);
        metadata.title = "Editable marketplace presentation".into();

        let validated = metadata.validate(&header, &fingerprint).unwrap();

        assert_eq!(validated.0.title, "Editable marketplace presentation");
        assert_ne!(validated.0.title, header.title);
    }

    fn valid_header() -> PublicHeader {
        solarch_core::format::parse_header(br#"{"archive_id":"arc_test_01","backend":{"archive_api_id":"arc_test_01"},"commercial_snapshot":{"platform_fee_bps":500,"price_amount":"10.000000","price_currency":"USDC"},"created_at":"2026-09-07T00:00:00Z","creator_wallet":"11111111111111111111111111111111","crypto":{"chunk_size":1048576,"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256"},"format":"solarch","license_snapshot":{"allow_export":false,"max_devices":1,"watermark_enabled":true},"title":"Test archive","version":"1.0.0"}"#).unwrap()
    }

    fn valid_metadata(fingerprint: &str) -> ArchiveMetadataResponse {
        ArchiveMetadataResponse {
            archive_id: "arc_test_01".into(),
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
            archive_fingerprint: fingerprint.into(),
        }
    }

    fn valid_intent(fingerprint: &str) -> PaymentIntentResponse {
        PaymentIntentResponse {
            payment_intent_id: "pi_test_01".into(),
            archive_id: "arc_test_01".into(),
            archive_fingerprint: fingerprint.into(),
            device_public_key: "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=".into(),
            payment_intent_client_secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8".into(),
            amount: "10.00".into(),
            currency: "USDC".into(),
            creator_share: "9.50".into(),
            platform_share: "0.50".into(),
            payment_reference: "11111111111111111111111111111111".into(),
            solana_pay_url: "solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction".into(),
            created_at: "2026-09-07T00:00:00Z".into(),
            expires_at: "2026-09-07T00:30:00Z".into(),
            status: "created".into(),
        }
    }
}
