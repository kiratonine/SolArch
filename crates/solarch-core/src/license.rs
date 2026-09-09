//! Exact frozen Device License P/W/SIG validation and RFC 9180 HPKE unwrap.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use hpke::{
    aead::AesGcm256, kdf::HkdfSha256, kem::X25519HkdfSha256, single_shot_open, Deserializable,
    OpModeR,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    canonical,
    device::{decode_public_key_base64, is_canonical_x25519_coordinate, DevicePrivateKey},
    format::{parse_timestamp, valid_id, valid_wallet},
    production_crypto::ArchiveContentKey,
    Error, Result,
};

pub const MAX_LICENSE_TRANSPORT_BYTES: usize = 16_384;
pub const MAX_LICENSE_JSON_DEPTH: usize = 8;
pub const OFFLINE_WINDOW_SECONDS: i64 = 259_200;
pub const CLOCK_ROLLBACK_TOLERANCE_SECONDS: i64 = 300;

const LICENSE_SIGNATURE_DOMAIN: &[u8] = b"SolArch/license-signature/v1\0";
const HPKE_INFO_DOMAIN: &[u8] = b"SolArch/content-key-wrap/info/v1\0";
const HPKE_AAD_DOMAIN: &[u8] = b"SolArch/content-key-wrap/aad/v1\0";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LicenseRights {
    pub open: bool,
    pub export: bool,
    pub max_devices: u16,
    pub watermark_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LicensePayload {
    pub version: u16,
    pub key_id: String,
    pub license_id: String,
    pub entitlement_id: String,
    pub archive_id: String,
    pub archive_fingerprint: String,
    pub buyer_wallet: String,
    pub device_public_key: String,
    pub status: String,
    pub issued_at: String,
    pub offline_valid_until: String,
    pub request_nonce: String,
    pub rights: LicenseRights,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WrappedContentKey {
    pub version: u16,
    pub kem_id: u16,
    pub kdf_id: u16,
    pub aead_id: u16,
    pub enc: String,
    pub ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignedLicense {
    pub payload: LicensePayload,
    pub server_signature: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LicenseGrant {
    pub license: SignedLicense,
    pub wrapped_content_key: WrappedContentKey,
}

#[derive(Serialize)]
struct SignatureObject<'a> {
    payload: &'a LicensePayload,
    wrapped_content_key: &'a WrappedContentKey,
}

impl LicenseGrant {
    pub fn parse_transport(bytes: &[u8]) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MAX_LICENSE_TRANSPORT_BYTES {
            return Err(Error::InvalidLicense);
        }
        let grant = canonical::parse_bounded(bytes, MAX_LICENSE_JSON_DEPTH, Error::InvalidLicense)?;
        validate_schema(&grant)?;
        Ok(grant)
    }

    pub fn payload_jcs(&self) -> Result<Vec<u8>> {
        canonical::to_jcs(&self.license.payload).map_err(|_| Error::InvalidLicense)
    }

    pub fn signature_object_jcs(&self) -> Result<Vec<u8>> {
        canonical::to_jcs(&SignatureObject {
            payload: &self.license.payload,
            wrapped_content_key: &self.wrapped_content_key,
        })
        .map_err(|_| Error::InvalidLicense)
    }

    pub fn to_storage_jcs(&self) -> Result<Vec<u8>> {
        let bytes = canonical::to_jcs(self).map_err(|_| Error::InvalidLicense)?;
        if bytes.len() > MAX_LICENSE_TRANSPORT_BYTES {
            return Err(Error::InvalidLicense);
        }
        Ok(bytes)
    }
}

/// License-role trust anchors only. Archive-role keys belong in a distinct map.
#[derive(Clone, Debug, Default)]
pub struct LicenseTrustStore(BTreeMap<String, [u8; 32]>);

impl LicenseTrustStore {
    pub fn from_keys(keys: impl IntoIterator<Item = (String, [u8; 32])>) -> Result<Self> {
        let mut trusted = BTreeMap::new();
        for (key_id, key) in keys {
            if !valid_key_id(&key_id)
                || VerifyingKey::from_bytes(&key).is_err()
                || trusted.insert(key_id, key).is_some()
            {
                return Err(Error::InvalidLicense);
            }
        }
        Ok(Self(trusted))
    }

    fn get(&self, key_id: &str) -> Result<[u8; 32]> {
        self.0.get(key_id).copied().ok_or(Error::UnknownTrustKey)
    }
}

pub struct LicenseValidationContext<'a> {
    pub archive_id: &'a str,
    pub archive_fingerprint: &'a str,
    pub device_public_key: [u8; 32],
    pub now: OffsetDateTime,
}

/// Validation context for a freshly received activation or refresh response.
///
/// The outstanding nonce is deliberately present only on this path. A cached
/// signed grant retains its issuance nonce as authenticated historical metadata,
/// but restoring that grant does not require request state to survive a restart.
pub struct FreshLicenseValidationContext<'a> {
    pub license: LicenseValidationContext<'a>,
    pub outstanding_request_nonce: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedLicenseMetadata {
    pub license_id: String,
    pub entitlement_id: String,
    pub buyer_wallet: String,
    pub issued_at: OffsetDateTime,
    pub offline_valid_until: OffsetDateTime,
}

pub struct UnwrappedLicense {
    pub metadata: ValidatedLicenseMetadata,
    pub archive_content_key: ArchiveContentKey,
}

/// A fresh Backend grant that passed every signature, binding, nonce, time and
/// HPKE check. Local storage accepts this type instead of an unauthenticated
/// transport object.
pub struct ValidatedFreshLicenseGrant<'a> {
    grant: &'a LicenseGrant,
    unwrapped: UnwrappedLicense,
}

impl<'a> ValidatedFreshLicenseGrant<'a> {
    pub fn signed_grant(&self) -> &'a LicenseGrant {
        self.grant
    }

    pub fn into_unwrapped(self) -> UnwrappedLicense {
        self.unwrapped
    }
}

impl std::fmt::Debug for UnwrappedLicense {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("UnwrappedLicense")
            .field("metadata", &self.metadata)
            .field("archive_content_key", &"[REDACTED]")
            .finish()
    }
}

pub fn validate_fresh_response<'a>(
    grant: &'a LicenseGrant,
    trust: &LicenseTrustStore,
    device_private_key: &DevicePrivateKey,
    context: &FreshLicenseValidationContext<'_>,
) -> Result<ValidatedFreshLicenseGrant<'a>> {
    let unwrapped = validate_and_unwrap(
        grant,
        trust,
        device_private_key,
        &context.license,
        Some(&context.outstanding_request_nonce),
    )?;
    Ok(ValidatedFreshLicenseGrant { grant, unwrapped })
}

pub fn validate_cached_grant(
    grant: &LicenseGrant,
    trust: &LicenseTrustStore,
    device_private_key: &DevicePrivateKey,
    context: &LicenseValidationContext<'_>,
) -> Result<UnwrappedLicense> {
    validate_and_unwrap(grant, trust, device_private_key, context, None)
}

fn validate_and_unwrap(
    grant: &LicenseGrant,
    trust: &LicenseTrustStore,
    device_private_key: &DevicePrivateKey,
    context: &LicenseValidationContext<'_>,
    expected_request_nonce: Option<&[u8; 32]>,
) -> Result<UnwrappedLicense> {
    validate_schema(grant)?;
    let public_key = trust.get(&grant.license.payload.key_id)?;
    verify_signature(grant, public_key)?;

    let payload = &grant.license.payload;
    let payload_device =
        decode_public_key_base64(&payload.device_public_key).map_err(|_| Error::InvalidLicense)?;
    if payload_device != context.device_public_key
        || device_private_key.public_key_bytes()? != context.device_public_key
    {
        return Err(Error::WrongDevice);
    }
    if payload.archive_id != context.archive_id
        || payload.archive_fingerprint != context.archive_fingerprint
    {
        return Err(Error::InvalidLicense);
    }
    if let Some(expected_nonce) = expected_request_nonce {
        let payload_nonce = decode_exact_base64::<32>(&payload.request_nonce)?;
        if &payload_nonce != expected_nonce {
            return Err(Error::InvalidLicense);
        }
    }

    let issued_at = parse_timestamp(&payload.issued_at).ok_or(Error::InvalidLicense)?;
    let deadline = parse_timestamp(&payload.offline_valid_until).ok_or(Error::InvalidLicense)?;
    let expected_deadline = issued_at
        .checked_add(time::Duration::seconds(OFFLINE_WINDOW_SECONDS))
        .ok_or(Error::InvalidLicense)?;
    if deadline != expected_deadline {
        return Err(Error::InvalidLicense);
    }
    if context.now < issued_at || context.now >= deadline {
        return Err(Error::Expired);
    }

    let payload_jcs = grant.payload_jcs()?;
    let mut info = Vec::with_capacity(HPKE_INFO_DOMAIN.len() + 32);
    info.extend_from_slice(HPKE_INFO_DOMAIN);
    info.extend_from_slice(&Sha256::digest(&payload_jcs));
    let mut aad = Vec::with_capacity(HPKE_AAD_DOMAIN.len() + payload_jcs.len());
    aad.extend_from_slice(HPKE_AAD_DOMAIN);
    aad.extend_from_slice(&payload_jcs);

    let enc = decode_exact_base64::<32>(&grant.wrapped_content_key.enc)?;
    if !is_canonical_x25519_coordinate(&enc) {
        return Err(Error::InvalidLicense);
    }
    let encapped = <X25519HkdfSha256 as hpke::Kem>::EncappedKey::from_bytes(&enc)
        .map_err(|_| Error::InvalidLicense)?;
    let ciphertext = decode_exact_base64::<48>(&grant.wrapped_content_key.ciphertext)?;
    let private = device_private_key.kem_private()?;
    let mut plaintext = Zeroizing::new(
        single_shot_open::<AesGcm256, HkdfSha256, X25519HkdfSha256>(
            &OpModeR::Base,
            &private,
            &encapped,
            &info,
            &ciphertext,
            &aad,
        )
        .map_err(|_| Error::AuthenticationFailed)?,
    );
    if plaintext.len() != 32 {
        return Err(Error::AuthenticationFailed);
    }
    let mut ack = [0_u8; 32];
    ack.copy_from_slice(&plaintext);
    plaintext.zeroize();

    Ok(UnwrappedLicense {
        metadata: ValidatedLicenseMetadata {
            license_id: payload.license_id.clone(),
            entitlement_id: payload.entitlement_id.clone(),
            buyer_wallet: payload.buyer_wallet.clone(),
            issued_at,
            offline_valid_until: deadline,
        },
        archive_content_key: ArchiveContentKey::from_bytes(ack),
    })
}

fn verify_signature(grant: &LicenseGrant, public_key: [u8; 32]) -> Result<()> {
    let signature = decode_exact_base64::<64>(&grant.license.server_signature)?;
    let mut message = Vec::with_capacity(LICENSE_SIGNATURE_DOMAIN.len() + 1024);
    message.extend_from_slice(LICENSE_SIGNATURE_DOMAIN);
    message.extend_from_slice(&grant.signature_object_jcs()?);
    VerifyingKey::from_bytes(&public_key)
        .map_err(|_| Error::InvalidLicense)?
        .verify_strict(&message, &Signature::from_bytes(&signature))
        .map_err(|_| Error::InvalidLicense)
}

fn validate_schema(grant: &LicenseGrant) -> Result<()> {
    let payload = &grant.license.payload;
    let rights = &payload.rights;
    if payload.version != 1
        || !valid_key_id(&payload.key_id)
        || !valid_id(&payload.license_id)
        || !valid_id(&payload.entitlement_id)
        || !valid_id(&payload.archive_id)
        || !valid_fingerprint(&payload.archive_fingerprint)
        || !valid_wallet(&payload.buyer_wallet)
        || decode_public_key_base64(&payload.device_public_key).is_err()
        || payload.status != "active"
        || parse_timestamp(&payload.issued_at).is_none()
        || parse_timestamp(&payload.offline_valid_until).is_none()
        || decode_exact_base64::<32>(&payload.request_nonce).is_err()
        || !rights.open
        || rights.export
        || rights.max_devices != 1
        || !rights.watermark_enabled
        || grant.wrapped_content_key.version != 1
        || grant.wrapped_content_key.kem_id != 32
        || grant.wrapped_content_key.kdf_id != 1
        || grant.wrapped_content_key.aead_id != 2
        || decode_exact_base64::<32>(&grant.wrapped_content_key.enc).is_err()
        || decode_exact_base64::<48>(&grant.wrapped_content_key.ciphertext).is_err()
        || decode_exact_base64::<64>(&grant.license.server_signature).is_err()
    {
        return Err(Error::InvalidLicense);
    }
    Ok(())
}

fn decode_exact_base64<const N: usize>(value: &str) -> Result<[u8; N]> {
    let bytes = STANDARD.decode(value).map_err(|_| Error::InvalidLicense)?;
    if bytes.len() != N || STANDARD.encode(&bytes) != value {
        return Err(Error::InvalidLicense);
    }
    bytes.try_into().map_err(|_| Error::InvalidLicense)
}

fn valid_key_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Persistable best-effort clock state. It contains no key material.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RollbackState {
    pub high_water_unix_seconds: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProcessClockSample {
    pub utc_unix_seconds: i64,
    pub monotonic_millis: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RollbackGuard {
    high_water_unix_seconds: Option<i64>,
    process_sample: Option<ProcessClockSample>,
}

impl RollbackGuard {
    pub fn restore(state: RollbackState) -> Self {
        Self {
            high_water_unix_seconds: Some(state.high_water_unix_seconds),
            process_sample: None,
        }
    }

    pub fn observe(&mut self, sample: ProcessClockSample) -> Result<RollbackState> {
        if self.high_water_unix_seconds.is_some_and(|high| {
            sample
                .utc_unix_seconds
                .saturating_add(CLOCK_ROLLBACK_TOLERANCE_SECONDS)
                < high
        }) {
            return Err(Error::RefreshRequired);
        }
        if let Some(previous) = self.process_sample {
            let elapsed_millis = sample
                .monotonic_millis
                .checked_sub(previous.monotonic_millis)
                .ok_or(Error::RefreshRequired)?;
            let elapsed_seconds =
                i64::try_from(elapsed_millis / 1000).map_err(|_| Error::RefreshRequired)?;
            let expected_utc = previous.utc_unix_seconds.saturating_add(elapsed_seconds);
            if sample
                .utc_unix_seconds
                .saturating_add(CLOCK_ROLLBACK_TOLERANCE_SECONDS)
                < expected_utc
            {
                return Err(Error::RefreshRequired);
            }
        }
        let high_water = self
            .high_water_unix_seconds
            .map_or(sample.utc_unix_seconds, |high| {
                high.max(sample.utc_unix_seconds)
            });
        self.high_water_unix_seconds = Some(high_water);
        self.process_sample = Some(sample);
        Ok(RollbackState {
            high_water_unix_seconds: high_water,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const P_JCS: &str = r#"{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1}"#;
    const Q_JCS: &str = r#"{"payload":{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1},"wrapped_content_key":{"aead_id":2,"ciphertext":"GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I","enc":"utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=","kdf_id":1,"kem_id":32,"version":1}}"#;
    const GRANT: &str = r#"{"license":{"payload":{"archive_fingerprint":"57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb","archive_id":"arc_test_01","buyer_wallet":"11111111111111111111111111111111","device_public_key":"aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc=","entitlement_id":"ent_test_01","issued_at":"2026-09-07T00:00:00Z","key_id":"lic-test-01","license_id":"lic_test_01","offline_valid_until":"2026-09-10T00:00:00Z","request_nonce":"gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8=","rights":{"export":false,"max_devices":1,"open":true,"watermark_enabled":true},"status":"active","version":1},"server_signature":"wLcOtVg7S0qywsufOSmRTPHACKPxVTO5qYivffQ5Xk0ylSvAjIV7b5u4LlnEycUM++zQ/5d5nMr4tTUaiWg1BA=="},"wrapped_content_key":{"aead_id":2,"ciphertext":"GO7bNoKdgUkCfV0rm1B3O7zAZPDfjLgoajBypokNP5+GsUXCjUMLys2HbagyFi6I","enc":"utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye/1Oh18=","kdf_id":1,"kem_id":32,"version":1}}"#;

    #[test]
    fn frozen_vector_reproduces_jcs_signature_and_exact_ack() {
        let grant = LicenseGrant::parse_transport(GRANT.as_bytes()).unwrap();
        assert_eq!(grant.payload_jcs().unwrap(), P_JCS.as_bytes());
        assert_eq!(grant.signature_object_jcs().unwrap(), Q_JCS.as_bytes());
        let key = vector_private_key();
        assert_eq!(
            key.public_key_base64().unwrap(),
            "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="
        );
        let result = validate_fresh_response(
            &grant,
            &trust(),
            &key,
            &fresh_context(at("2026-09-08T00:00:00Z")),
        )
        .unwrap()
        .into_unwrapped();
        assert_eq!(
            result.archive_content_key.test_bytes(),
            &std::array::from_fn::<_, 32, _>(|index| 0xa0 + index as u8)
        );
        assert_eq!(result.metadata.license_id, "lic_test_01");
    }

    #[test]
    fn transport_is_bounded_closed_and_strict_but_need_not_be_jcs() {
        let reordered = format!(
            " {{ \"wrapped_content_key\": {}, \"license\": {} }} ",
            serde_json::to_string(&grant().wrapped_content_key).unwrap(),
            serde_json::to_string(&grant().license).unwrap()
        );
        assert!(LicenseGrant::parse_transport(reordered.as_bytes()).is_ok());
        for bad in [
            GRANT.replacen("\"license\":", "\"license\":null,\"old\":", 1),
            GRANT.replacen("\"license\":", "\"unknown\":1,\"license\":", 1),
            GRANT.replacen("\"version\":1", "\"version\":1,\"version\":1", 1),
            GRANT.replacen("\"server_signature\":", "\"missing_signature\":", 1),
            "{\"license\":{\"payload\":{\"a\":{\"b\":{\"c\":{\"d\":{\"e\":{\"f\":{\"g\":{\"h\":1}}}}}}}}}}".to_owned(),
        ] {
            assert!(LicenseGrant::parse_transport(bad.as_bytes()).is_err());
        }
        assert!(
            LicenseGrant::parse_transport(&vec![b' '; MAX_LICENSE_TRANSPORT_BYTES + 1]).is_err()
        );
    }

    #[test]
    fn schema_rejects_bad_encodings_identifiers_literals_and_suites() {
        let mut cases = Vec::new();
        let mut value = grant();
        value.license.payload.version = 2;
        cases.push(value);
        let mut value = grant();
        value.license.payload.key_id = "UPPER".into();
        cases.push(value);
        let mut value = grant();
        value.license.payload.license_id = "bad/id".into();
        cases.push(value);
        let mut value = grant();
        value.license.payload.archive_fingerprint = "A".repeat(64);
        cases.push(value);
        let mut value = grant();
        value.license.payload.buyer_wallet = "bad".into();
        cases.push(value);
        let mut value = grant();
        value.license.payload.device_public_key.pop();
        cases.push(value);
        let mut value = grant();
        value.license.payload.request_nonce.push('=');
        cases.push(value);
        let mut value = grant();
        value.license.payload.issued_at = "2026-09-07T00:00:00+00:00".into();
        cases.push(value);
        let mut value = grant();
        value.license.payload.status = "revoked".into();
        cases.push(value);
        let mut value = grant();
        value.license.payload.rights.open = false;
        cases.push(value);
        let mut value = grant();
        value.license.payload.rights.export = true;
        cases.push(value);
        let mut value = grant();
        value.license.payload.rights.max_devices = 2;
        cases.push(value);
        let mut value = grant();
        value.license.payload.rights.watermark_enabled = false;
        cases.push(value);
        let mut value = grant();
        value.wrapped_content_key.version = 2;
        cases.push(value);
        let mut value = grant();
        value.wrapped_content_key.kem_id = 31;
        cases.push(value);
        let mut value = grant();
        value.wrapped_content_key.kdf_id = 2;
        cases.push(value);
        let mut value = grant();
        value.wrapped_content_key.aead_id = 1;
        cases.push(value);
        let mut value = grant();
        value.wrapped_content_key.ciphertext.pop();
        cases.push(value);
        let mut value = grant();
        value.license.server_signature.pop();
        cases.push(value);
        for case in cases {
            assert!(LicenseGrant::parse_transport(&serde_json::to_vec(&case).unwrap()).is_err());
        }
        assert!(decode_public_key_base64("//////////////////////////////////////////8=").is_err());
    }

    #[test]
    fn signature_trust_and_every_local_binding_fail_closed() {
        let key = vector_private_key();
        let valid = grant();
        let mut forged = valid.clone();
        forged.license.server_signature.replace_range(0..1, "A");
        assert!(validate_cached_grant(
            &forged,
            &trust(),
            &key,
            &context(at("2026-09-08T00:00:00Z"))
        )
        .is_err());
        assert!(matches!(
            validate_cached_grant(
                &valid,
                &LicenseTrustStore::default(),
                &key,
                &context(at("2026-09-08T00:00:00Z"))
            ),
            Err(Error::UnknownTrustKey)
        ));
        let archive_role = LicenseTrustStore::from_keys([(
            "arc-test-01".to_owned(),
            b64_32("A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg="),
        )])
        .unwrap();
        assert!(matches!(
            validate_cached_grant(
                &valid,
                &archive_role,
                &key,
                &context(at("2026-09-08T00:00:00Z"))
            ),
            Err(Error::UnknownTrustKey)
        ));

        let mut ctx = context(at("2026-09-08T00:00:00Z"));
        ctx.archive_id = "arc_other";
        assert!(validate_cached_grant(&valid, &trust(), &key, &ctx).is_err());
        let mut ctx = context(at("2026-09-08T00:00:00Z"));
        ctx.archive_fingerprint =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        assert!(validate_cached_grant(&valid, &trust(), &key, &ctx).is_err());
        let mut fresh = fresh_context(at("2026-09-08T00:00:00Z"));
        fresh.outstanding_request_nonce[0] ^= 1;
        assert!(validate_fresh_response(&valid, &trust(), &key, &fresh).is_err());
        assert!(validate_cached_grant(
            &valid,
            &trust(),
            &key,
            &context(at("2026-09-08T00:00:00Z"))
        )
        .is_ok());
        let other = DevicePrivateKey::from_bytes([7_u8; 32]).unwrap();
        assert!(matches!(
            validate_cached_grant(
                &valid,
                &trust(),
                &other,
                &context(at("2026-09-08T00:00:00Z"))
            ),
            Err(Error::WrongDevice)
        ));
    }

    #[test]
    fn time_window_is_exact_and_exclusive() {
        let key = vector_private_key();
        let valid = grant();
        for now in [
            "2026-09-06T23:59:59Z",
            "2026-09-10T00:00:00Z",
            "2026-09-11T00:00:00Z",
        ] {
            assert!(matches!(
                validate_cached_grant(&valid, &trust(), &key, &context(at(now))),
                Err(Error::Expired)
            ));
        }
        let mut bad_deadline = valid;
        bad_deadline.license.payload.offline_valid_until = "2026-09-09T23:59:59Z".into();
        resign(&mut bad_deadline);
        assert!(matches!(
            validate_cached_grant(
                &bad_deadline,
                &trust(),
                &key,
                &context(at("2026-09-08T00:00:00Z"))
            ),
            Err(Error::InvalidLicense)
        ));
    }

    #[test]
    fn wrong_hpke_key_and_modified_or_low_order_envelope_fail_closed() {
        let valid = grant();
        let wrong = DevicePrivateKey::from_bytes([9_u8; 32]).unwrap();
        let mut wrong_context = context(at("2026-09-08T00:00:00Z"));
        wrong_context.device_public_key = wrong.public_key_bytes().unwrap();
        let mut for_wrong = valid.clone();
        for_wrong.license.payload.device_public_key = wrong.public_key_base64().unwrap();
        resign(&mut for_wrong);
        assert!(validate_cached_grant(&for_wrong, &trust(), &wrong, &wrong_context).is_err());

        let mut unsigned_modified = valid.clone();
        change_base64_character(&mut unsigned_modified.wrapped_content_key.enc, 0);
        assert!(validate_cached_grant(
            &unsigned_modified,
            &trust(),
            &vector_private_key(),
            &context(at("2026-09-08T00:00:00Z"))
        )
        .is_err());

        for (field, modify_tag) in [("enc", false), ("ciphertext", false), ("ciphertext", true)] {
            let mut modified = valid.clone();
            let target = if field == "enc" {
                &mut modified.wrapped_content_key.enc
            } else {
                &mut modified.wrapped_content_key.ciphertext
            };
            let index = if modify_tag { target.len() - 1 } else { 0 };
            change_base64_character(target, index);
            resign(&mut modified);
            assert!(validate_cached_grant(
                &modified,
                &trust(),
                &vector_private_key(),
                &context(at("2026-09-08T00:00:00Z"))
            )
            .is_err());
        }

        let mut low_order = valid;
        low_order.wrapped_content_key.enc = STANDARD.encode([0_u8; 32]);
        resign(&mut low_order);
        assert!(validate_cached_grant(
            &low_order,
            &trust(),
            &vector_private_key(),
            &context(at("2026-09-08T00:00:00Z"))
        )
        .is_err());
    }

    #[test]
    fn rollback_guard_enforces_cross_restart_and_monotonic_tolerance() {
        let mut guard = RollbackGuard::restore(RollbackState {
            high_water_unix_seconds: 10_000,
        });
        assert!(guard
            .observe(ProcessClockSample {
                utc_unix_seconds: 9_700,
                monotonic_millis: 0,
            })
            .is_ok());
        assert!(matches!(
            guard.observe(ProcessClockSample {
                utc_unix_seconds: 9_699,
                monotonic_millis: 1,
            }),
            Err(Error::RefreshRequired)
        ));
        let mut guard = RollbackGuard::default();
        guard
            .observe(ProcessClockSample {
                utc_unix_seconds: 20_000,
                monotonic_millis: 1_000,
            })
            .unwrap();
        assert!(matches!(
            guard.observe(ProcessClockSample {
                utc_unix_seconds: 20_299,
                monotonic_millis: 602_000,
            }),
            Err(Error::RefreshRequired)
        ));
    }

    fn grant() -> LicenseGrant {
        LicenseGrant::parse_transport(GRANT.as_bytes()).unwrap()
    }

    fn vector_private_key() -> DevicePrivateKey {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/license_v1_test_secrets.json"
        ))
        .unwrap();
        DevicePrivateKey::from_bytes(hex32(
            fixture["device_x25519_private_key_hex"].as_str().unwrap(),
        ))
        .unwrap()
    }

    fn trust() -> LicenseTrustStore {
        LicenseTrustStore::from_keys([(
            "lic-test-01".to_owned(),
            b64_32("JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0="),
        )])
        .unwrap()
    }

    fn context(now: OffsetDateTime) -> LicenseValidationContext<'static> {
        LicenseValidationContext {
            archive_id: "arc_test_01",
            archive_fingerprint: "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb",
            device_public_key: b64_32("aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="),
            now,
        }
    }

    fn fresh_context(now: OffsetDateTime) -> FreshLicenseValidationContext<'static> {
        FreshLicenseValidationContext {
            license: context(now),
            outstanding_request_nonce: b64_32("gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8="),
        }
    }

    fn resign(grant: &mut LicenseGrant) {
        let signing = SigningKey::from_bytes(&std::array::from_fn(|index| 0x40 + index as u8));
        let mut message = LICENSE_SIGNATURE_DOMAIN.to_vec();
        message.extend_from_slice(&grant.signature_object_jcs().unwrap());
        grant.license.server_signature = STANDARD.encode(signing.sign(&message).to_bytes());
    }

    fn at(value: &str) -> OffsetDateTime {
        parse_timestamp(value).unwrap()
    }

    fn b64_32(value: &str) -> [u8; 32] {
        STANDARD.decode(value).unwrap().try_into().unwrap()
    }

    fn change_base64_character(value: &mut String, index: usize) {
        let replacement = if value.as_bytes()[index] == b'A' {
            "B"
        } else {
            "A"
        };
        value.replace_range(index..index + 1, replacement);
    }

    fn hex32(value: &str) -> [u8; 32] {
        let mut result = [0_u8; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            result[index] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        result
    }
}
