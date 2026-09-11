#[cfg(windows)]
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::ViewerError;

pub const DEVICE_SERVICE: &str = "app.solarch.viewer.device.v1";
pub const DEVICE_ACCOUNT: &str = "device-a-x25519-private-key";
pub const CLOCK_SERVICE: &str = "app.solarch.viewer.clock.v1";
pub const CLOCK_ACCOUNT: &str = "validated-utc-high-water";
pub const INTENT_SERVICE: &str = "app.solarch.viewer.intent.v1";
pub const REFRESH_SERVICE: &str = "app.solarch.viewer.refresh.v1";

pub trait SecretStore: Send + Sync {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError>;
    fn write(&self, secret: &[u8]) -> Result<(), ViewerError>;
    fn delete(&self) -> Result<(), ViewerError>;
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum SecretPurpose {
    PaymentIntent,
    DeviceRefresh,
}

pub trait KeyedSecretStore: Send + Sync {
    fn read(
        &self,
        purpose: SecretPurpose,
        key: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError>;
    fn write(&self, purpose: SecretPurpose, key: &str, secret: &[u8]) -> Result<(), ViewerError>;
    fn delete(&self, purpose: SecretPurpose, key: &str) -> Result<(), ViewerError>;
}

#[cfg(windows)]
pub struct WindowsCredentialStore {
    service: String,
    account: String,
}

#[cfg(windows)]
impl WindowsCredentialStore {
    pub fn device_store() -> Self {
        Self {
            service: scoped_service(DEVICE_SERVICE),
            account: DEVICE_ACCOUNT.to_owned(),
        }
    }

    pub fn clock_store() -> Self {
        Self {
            service: scoped_service(CLOCK_SERVICE),
            account: CLOCK_ACCOUNT.to_owned(),
        }
    }

    #[cfg(test)]
    pub fn for_test(service: &'static str, account: &'static str) -> Self {
        Self {
            service: service.to_owned(),
            account: account.to_owned(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, ViewerError> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|_| ViewerError::SecureStoreUnavailable)
    }

    #[cfg(test)]
    pub fn delete_for_test(&self) -> Result<(), ViewerError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ViewerError::SecureStoreUnavailable),
        }
    }
}

#[cfg(windows)]
impl SecretStore for WindowsCredentialStore {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError> {
        match self.entry()?.get_secret() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(keyring::Error::BadDataFormat(_, _)) | Err(keyring::Error::BadEncoding(_)) => {
                Err(ViewerError::CorruptSecureStore)
            }
            Err(_) => Err(ViewerError::SecureStoreUnavailable),
        }
    }

    fn write(&self, secret: &[u8]) -> Result<(), ViewerError> {
        self.entry()?
            .set_secret(secret)
            .map_err(|_| ViewerError::SecureStoreUnavailable)
    }

    fn delete(&self) -> Result<(), ViewerError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ViewerError::SecureStoreUnavailable),
        }
    }
}

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsKeyedSecretStore;

#[cfg(windows)]
impl WindowsKeyedSecretStore {
    fn entry(purpose: SecretPurpose, key: &str) -> Result<keyring::Entry, ViewerError> {
        let base = match purpose {
            SecretPurpose::PaymentIntent => INTENT_SERVICE,
            SecretPurpose::DeviceRefresh => REFRESH_SERVICE,
        };
        let service = scoped_service(base);
        let digest = Sha256::digest(key.as_bytes());
        let account = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        keyring::Entry::new(&service, &account).map_err(|_| ViewerError::SecureStoreUnavailable)
    }
}

#[cfg(windows)]
fn scoped_service(base: &str) -> String {
    #[cfg(feature = "development-fixtures")]
    if let Ok(scope) = std::env::var("SOLARCH_DEV_CREDENTIAL_SCOPE") {
        if !scope.is_empty()
            && scope.len() <= 48
            && scope
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return format!("{base}.dev.{scope}");
        }
    }
    base.to_owned()
}

#[cfg(windows)]
impl KeyedSecretStore for WindowsKeyedSecretStore {
    fn read(
        &self,
        purpose: SecretPurpose,
        key: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError> {
        match Self::entry(purpose, key)?.get_secret() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(keyring::Error::BadDataFormat(_, _)) | Err(keyring::Error::BadEncoding(_)) => {
                Err(ViewerError::CorruptSecureStore)
            }
            Err(_) => Err(ViewerError::SecureStoreUnavailable),
        }
    }

    fn write(&self, purpose: SecretPurpose, key: &str, secret: &[u8]) -> Result<(), ViewerError> {
        Self::entry(purpose, key)?
            .set_secret(secret)
            .map_err(|_| ViewerError::SecureStoreUnavailable)
    }

    fn delete(&self, purpose: SecretPurpose, key: &str) -> Result<(), ViewerError> {
        match Self::entry(purpose, key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ViewerError::SecureStoreUnavailable),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemorySecretStore(std::sync::Mutex<Option<Vec<u8>>>);

#[cfg(test)]
impl MemorySecretStore {
    pub fn with_value(value: Vec<u8>) -> Self {
        Self(std::sync::Mutex::new(Some(value)))
    }
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)
            .map(|value| value.clone().map(Zeroizing::new))
    }

    fn write(&self, secret: &[u8]) -> Result<(), ViewerError> {
        *self.0.lock().map_err(|_| ViewerError::Internal)? = Some(secret.to_vec());
        Ok(())
    }

    fn delete(&self) -> Result<(), ViewerError> {
        *self.0.lock().map_err(|_| ViewerError::Internal)? = None;
        Ok(())
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryKeyedSecretStore(
    std::sync::Mutex<std::collections::HashMap<(SecretPurpose, String), Vec<u8>>>,
);

#[cfg(test)]
impl KeyedSecretStore for MemoryKeyedSecretStore {
    fn read(
        &self,
        purpose: SecretPurpose,
        key: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)
            .map(|values| {
                values
                    .get(&(purpose, key.to_owned()))
                    .cloned()
                    .map(Zeroizing::new)
            })
    }

    fn write(&self, purpose: SecretPurpose, key: &str, secret: &[u8]) -> Result<(), ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .insert((purpose, key.to_owned()), secret.to_vec());
        Ok(())
    }

    fn delete(&self, purpose: SecretPurpose, key: &str) -> Result<(), ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)?
            .remove(&(purpose, key.to_owned()));
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[test]
    fn keyed_credentials_are_purpose_separated_durable_and_deletable() {
        const KEY: &str = "part03-native-keyed-secret-smoke-v1";
        let store = WindowsKeyedSecretStore;
        store.delete(SecretPurpose::PaymentIntent, KEY).unwrap();
        store.delete(SecretPurpose::DeviceRefresh, KEY).unwrap();

        store
            .write(SecretPurpose::PaymentIntent, KEY, b"intent-secret")
            .unwrap();
        store
            .write(SecretPurpose::DeviceRefresh, KEY, b"refresh-secret")
            .unwrap();

        let restarted = WindowsKeyedSecretStore;
        assert_eq!(
            &*restarted
                .read(SecretPurpose::PaymentIntent, KEY)
                .unwrap()
                .unwrap(),
            b"intent-secret"
        );
        assert_eq!(
            &*restarted
                .read(SecretPurpose::DeviceRefresh, KEY)
                .unwrap()
                .unwrap(),
            b"refresh-secret"
        );

        restarted.delete(SecretPurpose::PaymentIntent, KEY).unwrap();
        assert!(restarted
            .read(SecretPurpose::PaymentIntent, KEY)
            .unwrap()
            .is_none());
        assert!(restarted
            .read(SecretPurpose::DeviceRefresh, KEY)
            .unwrap()
            .is_some());
        restarted.delete(SecretPurpose::DeviceRefresh, KEY).unwrap();
    }
}
