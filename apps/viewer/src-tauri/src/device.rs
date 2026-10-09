use std::sync::Arc;

use solarch_core::device::DevicePrivateKey;
use zeroize::Zeroize;

use crate::{error::ViewerError, secure_store::SecretStore};

pub struct DeviceManager {
    store: Arc<dyn SecretStore>,
}

impl DeviceManager {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store }
    }

    pub fn load_or_create(&self) -> Result<DevicePrivateKey, ViewerError> {
        if let Some(mut stored) = self.store.read()? {
            if stored.len() != 32 {
                return Err(ViewerError::CorruptSecureStore);
            }
            let mut bytes = [0_u8; 32];
            bytes.copy_from_slice(&stored);
            stored.zeroize();
            return DevicePrivateKey::from_bytes(bytes)
                .map_err(|_| ViewerError::CorruptSecureStore);
        }

        let generated =
            DevicePrivateKey::generate().map_err(|_| ViewerError::SecureStoreUnavailable)?;
        self.store.write(generated.secret_bytes())?;
        let mut persisted = self
            .store
            .read()?
            .ok_or(ViewerError::SecureStoreUnavailable)?;
        if persisted.as_slice() != generated.secret_bytes() {
            persisted.zeroize();
            return Err(ViewerError::SecureStoreUnavailable);
        }
        persisted.zeroize();
        Ok(generated)
    }

    pub fn public_key(&self) -> Result<String, ViewerError> {
        self.load_or_create()?
            .public_key_base64()
            .map_err(|_| ViewerError::CorruptSecureStore)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_store::MemorySecretStore;

    #[test]
    fn get_or_create_is_stable_across_manager_restart() {
        let store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::default());
        let first = DeviceManager::new(store.clone()).public_key().unwrap();
        let second = DeviceManager::new(store).public_key().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 44);
    }

    #[test]
    fn malformed_existing_value_fails_without_regeneration() {
        let store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::with_value(vec![7; 31]));
        let manager = DeviceManager::new(store.clone());
        assert!(matches!(
            manager.public_key(),
            Err(ViewerError::CorruptSecureStore)
        ));
        assert_eq!(store.read().unwrap().unwrap().len(), 31);
    }
}
