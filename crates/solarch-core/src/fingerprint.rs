//! Raw SHA-256 primitive only: NOT an agreed external archive_fingerprint.
//! Coverage/canonicalization and API text encoding remain a shared contract gate.
use sha2::{Digest, Sha256};
pub fn digest_bytes(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_vector_and_mutation() {
        assert_eq!(
            digest_bytes(b"abc"),
            [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad
            ]
        );
        assert_ne!(digest_bytes(b"abc"), digest_bytes(b"abd"));
    }
}
