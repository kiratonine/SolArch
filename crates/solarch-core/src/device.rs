//! Device A X25519 identity primitives.
//!
//! Secret-bearing values deliberately have no serialization or clone support.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use hpke::{kem::X25519HkdfSha256, Deserializable, Kem as _, Serializable};
use zeroize::{Zeroize, Zeroizing};

use crate::{Error, Result};

pub const DEVICE_KEY_BYTES: usize = 32;
pub const DEVICE_PUBLIC_KEY_B64_BYTES: usize = 44;

type Kem = X25519HkdfSha256;

/// Raw RFC 7748 little-endian X25519 private key material.
pub struct DevicePrivateKey(Zeroizing<[u8; DEVICE_KEY_BYTES]>);

impl DevicePrivateKey {
    /// Generates fresh device key material from the operating-system CSPRNG.
    pub fn generate() -> Result<Self> {
        let mut ikm = Zeroizing::new([0_u8; DEVICE_KEY_BYTES]);
        getrandom::fill(ikm.as_mut()).map_err(|_| Error::InvalidDeviceKey)?;
        let (private, _) = Kem::derive_keypair(ikm.as_ref());
        let serialized = private.to_bytes();
        let mut bytes = [0_u8; DEVICE_KEY_BYTES];
        bytes.copy_from_slice(serialized.as_slice());
        Ok(Self(Zeroizing::new(bytes)))
    }

    /// Restores an exact raw private key obtained from protected OS storage.
    pub fn from_bytes(mut bytes: [u8; DEVICE_KEY_BYTES]) -> Result<Self> {
        let parsed = <Kem as hpke::Kem>::PrivateKey::from_bytes(&bytes)
            .map_err(|_| Error::InvalidDeviceKey)?;
        let canonical = parsed.to_bytes();
        if canonical.as_slice() != bytes {
            bytes.zeroize();
            return Err(Error::InvalidDeviceKey);
        }
        Ok(Self(Zeroizing::new(bytes)))
    }

    /// Exposes the secret only to Rust secure-store/session integrations.
    /// It must never be serialized, logged, persisted outside OS secure storage,
    /// or returned through an application IPC command.
    pub fn secret_bytes(&self) -> &[u8; DEVICE_KEY_BYTES] {
        &self.0
    }

    pub fn public_key_bytes(&self) -> Result<[u8; DEVICE_KEY_BYTES]> {
        let private = self.kem_private()?;
        let public = Kem::sk_to_pk(&private).to_bytes();
        let mut bytes = [0_u8; DEVICE_KEY_BYTES];
        bytes.copy_from_slice(public.as_slice());
        Ok(bytes)
    }

    pub fn public_key_base64(&self) -> Result<String> {
        Ok(STANDARD.encode(self.public_key_bytes()?))
    }

    pub(crate) fn kem_private(&self) -> Result<<Kem as hpke::Kem>::PrivateKey> {
        <Kem as hpke::Kem>::PrivateKey::from_bytes(self.0.as_ref())
            .map_err(|_| Error::InvalidDeviceKey)
    }
}

impl std::fmt::Debug for DevicePrivateKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DevicePrivateKey([REDACTED])")
    }
}

/// Strict RFC 4648 standard-alphabet, padded public-key decoding.
pub fn decode_public_key_base64(value: &str) -> Result<[u8; DEVICE_KEY_BYTES]> {
    if value.len() != DEVICE_PUBLIC_KEY_B64_BYTES || !value.ends_with('=') {
        return Err(Error::InvalidDeviceKey);
    }
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| Error::InvalidDeviceKey)?;
    if decoded.len() != DEVICE_KEY_BYTES || STANDARD.encode(&decoded) != value {
        return Err(Error::InvalidDeviceKey);
    }
    let bytes: [u8; DEVICE_KEY_BYTES] = decoded.try_into().map_err(|_| Error::InvalidDeviceKey)?;
    if !is_canonical_x25519_coordinate(&bytes) {
        return Err(Error::InvalidDeviceKey);
    }
    Ok(bytes)
}

pub(crate) fn is_canonical_x25519_coordinate(bytes: &[u8; 32]) -> bool {
    const FIELD_PRIME_LE: [u8; 32] = [
        0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ];
    for index in (0..32).rev() {
        if bytes[index] < FIELD_PRIME_LE[index] {
            return true;
        }
        if bytes[index] > FIELD_PRIME_LE[index] {
            return false;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_recipient_private_key_derives_expected_public_key() {
        let private = vector_private_bytes();
        let key = DevicePrivateKey::from_bytes(private).unwrap();
        assert_eq!(
            key.public_key_base64().unwrap(),
            "aTZYJUYw9zrY2nj7Mxv5ds1C+Q4OnJ6D9AxRBypvdBc="
        );
        assert_eq!(format!("{key:?}"), "DevicePrivateKey([REDACTED])");
    }

    #[test]
    fn public_key_encoding_is_canonical_and_bounded() {
        let key = DevicePrivateKey::generate().unwrap();
        let encoded = key.public_key_base64().unwrap();
        assert_eq!(encoded.len(), DEVICE_PUBLIC_KEY_B64_BYTES);
        assert_eq!(
            decode_public_key_base64(&encoded).unwrap(),
            key.public_key_bytes().unwrap()
        );
        for bad in [
            encoded.trim_end_matches('=').to_owned(),
            format!(" {encoded}"),
            "//////////////////////////////////////////8=".to_owned(),
        ] {
            assert!(decode_public_key_base64(&bad).is_err());
        }
    }

    fn hex32(value: &str) -> [u8; 32] {
        let mut result = [0_u8; 32];
        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            result[index] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
        }
        result
    }

    fn vector_private_bytes() -> [u8; 32] {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/license_v1_test_secrets.json"
        ))
        .unwrap();
        hex32(fixture["device_x25519_private_key_hex"].as_str().unwrap())
    }
}
