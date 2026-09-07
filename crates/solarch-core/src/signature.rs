//! Ed25519 primitive with explicit caller-supplied trust anchor.
//! No embedded key is treated as trusted. Container signing coverage is not set here.
use crate::{Error, Result};
use ed25519_dalek::{Signature, VerifyingKey};

pub fn verify_bytes(trusted_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<()> {
    let key = VerifyingKey::from_bytes(trusted_key).map_err(|_| Error::SignatureFailure)?;
    key.verify_strict(message, &Signature::from_bytes(signature))
        .map_err(|_| Error::SignatureFailure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    #[test]
    fn valid_modified_forged_and_wrong_trust() {
        // Deterministic synthetic test-only signing key.
        let signer = SigningKey::from_bytes(&[42; 32]);
        let trusted = signer.verifying_key().to_bytes();
        let signature = signer.sign(b"test-only signed bytes").to_bytes();
        assert!(verify_bytes(&trusted, b"test-only signed bytes", &signature).is_ok());
        assert!(verify_bytes(&trusted, b"modified", &signature).is_err());
        assert!(verify_bytes(&trusted, b"test-only signed bytes", &[0; 64]).is_err());
        assert!(verify_bytes(
            &SigningKey::from_bytes(&[43; 32]).verifying_key().to_bytes(),
            b"test-only signed bytes",
            &signature
        )
        .is_err());
    }
}
