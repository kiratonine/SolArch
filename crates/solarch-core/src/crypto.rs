//! In-memory AEAD building blocks, not a serialized `.slr` crypto profile.
//! A session owns one fresh key and a monotonic nonce counter; it cannot be cloned
//! or reset. The caller can retain the key in memory for later decryption.
use chacha20poly1305::{
    aead::{AeadInPlace, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};
use zeroize::Zeroizing;

use crate::{Error, Result};

pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

pub struct ContentKey(Zeroizing<[u8; 32]>);

impl ContentKey {
    pub fn generate() -> Result<Self> {
        let mut bytes = Zeroizing::new([0; 32]);
        OsRng
            .try_fill_bytes(bytes.as_mut())
            .map_err(|_| Error::RandomUnavailable)?;
        Ok(Self(bytes))
    }

    pub fn decrypt(&self, message: &EncryptedMessage, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if message.bytes.len() < 16 || message.bytes.len() > MAX_MESSAGE_BYTES + 16 {
            return Err(Error::InvalidChunkMetadata);
        }
        let cipher = XChaCha20Poly1305::new((&*self.0).into());
        let mut plaintext = Zeroizing::new(message.bytes.clone());
        cipher
            .decrypt_in_place(XNonce::from_slice(&message.nonce), aad, &mut *plaintext)
            .map_err(|_| Error::AuthenticationFailed)?;
        Ok(plaintext)
    }
}

impl std::fmt::Debug for ContentKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ContentKey([REDACTED])")
    }
}

/// Opaque in-memory ciphertext. No serde or public wire encoding.
pub struct EncryptedMessage {
    nonce: [u8; 24],
    bytes: Vec<u8>,
}

impl EncryptedMessage {
    pub fn ciphertext_len(&self) -> usize {
        self.bytes.len()
    }

    #[cfg(test)]
    pub(crate) fn fixture_bytes(&self) -> Vec<u8> {
        let mut bytes = self.nonce.to_vec();
        bytes.extend_from_slice(&self.bytes);
        bytes
    }

    #[cfg(test)]
    pub(crate) fn from_fixture_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 40 {
            return Err(Error::TruncatedInput);
        }
        Ok(Self {
            nonce: bytes[..24].try_into().map_err(|_| Error::TruncatedInput)?,
            bytes: bytes[24..].to_vec(),
        })
    }
}

pub struct EncryptionSession {
    key: ContentKey,
    next: u64,
}

impl EncryptionSession {
    #[cfg(test)]
    pub(crate) fn fixture_session() -> Self {
        Self {
            key: ContentKey(Zeroizing::new([7; 32])),
            next: 0,
        }
    }
    pub fn new() -> Result<Self> {
        Ok(Self {
            key: ContentKey::generate()?,
            next: 0,
        })
    }

    /// Internal nonce strategy: unique counter under a fresh session-owned key.
    /// A failed call consumes the counter as well. No key import/reset API exists.
    pub fn encrypt(&mut self, plaintext: &[u8], aad: &[u8]) -> Result<EncryptedMessage> {
        if plaintext.len() > MAX_MESSAGE_BYTES || aad.len() > MAX_MESSAGE_BYTES {
            return Err(Error::LimitExceeded);
        }
        let counter = self.next;
        self.next = self.next.checked_add(1).ok_or(Error::LimitExceeded)?;
        let mut nonce = [0; 24];
        nonce[16..].copy_from_slice(&counter.to_le_bytes());
        let cipher = XChaCha20Poly1305::new((&*self.key.0).into());
        let mut bytes = Zeroizing::new(plaintext.to_vec());
        cipher
            .encrypt_in_place(XNonce::from_slice(&nonce), aad, &mut *bytes)
            .map_err(|_| Error::AuthenticationFailed)?;
        Ok(EncryptedMessage {
            nonce,
            bytes: std::mem::take(&mut *bytes),
        })
    }

    pub fn key(&self) -> &ContentKey {
        &self.key
    }

    /// Transfers key ownership in memory only. Does not serialize or print it.
    pub fn into_key(self) -> ContentKey {
        self.key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deterministic_session() -> EncryptionSession {
        // Test-only key, never available through the production API.
        EncryptionSession {
            key: ContentKey(Zeroizing::new([7; 32])),
            next: 0,
        }
    }

    #[test]
    fn roundtrip_wrong_key_aad_and_tampering() {
        let mut session = deterministic_session();
        let mut message = session
            .encrypt(b"synthetic test content", b"manifest")
            .unwrap();
        assert_eq!(
            &**session.key().decrypt(&message, b"manifest").unwrap(),
            b"synthetic test content"
        );
        assert!(ContentKey::generate()
            .unwrap()
            .decrypt(&message, b"manifest")
            .is_err());
        assert!(session.key().decrypt(&message, b"index").is_err());
        message.bytes[0] ^= 1;
        assert!(session.key().decrypt(&message, b"manifest").is_err());
        message.bytes[0] ^= 1;
        let last = message.bytes.len() - 1;
        message.bytes[last] ^= 1;
        assert!(session.key().decrypt(&message, b"manifest").is_err());
        message.bytes.truncate(8);
        assert!(session.key().decrypt(&message, b"manifest").is_err());
    }

    #[test]
    fn nonces_unique_and_exhaustion_fails() {
        let mut session = deterministic_session();
        let mut nonces = std::collections::HashSet::new();
        for _ in 0..1000 {
            assert!(nonces.insert(session.encrypt(b"chunk", b"context").unwrap().nonce));
        }
        session.next = u64::MAX;
        assert!(matches!(
            session.encrypt(b"", b""),
            Err(Error::LimitExceeded)
        ));
    }

    #[test]
    fn deterministic_fixture_and_redacted_diagnostics() {
        let a = deterministic_session()
            .encrypt(b"test", b"context")
            .unwrap();
        let b = deterministic_session()
            .encrypt(b"test", b"context")
            .unwrap();
        assert_eq!(a.bytes, b.bytes);
        assert_eq!(
            format!("{:?}", deterministic_session().key()),
            "ContentKey([REDACTED])"
        );
        assert_eq!(
            Error::AuthenticationFailed.to_string(),
            "authentication failed"
        );
    }
}
