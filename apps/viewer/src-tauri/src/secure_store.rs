use zeroize::Zeroizing;

use crate::error::ViewerError;

pub const DEVICE_SERVICE: &str = "app.solarch.viewer.device.v1";
pub const DEVICE_ACCOUNT: &str = "device-a-x25519-private-key";
pub const CLOCK_SERVICE: &str = "app.solarch.viewer.clock.v1";
pub const CLOCK_ACCOUNT: &str = "validated-utc-high-water";

pub trait SecretStore: Send + Sync {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ViewerError>;
    fn write(&self, secret: &[u8]) -> Result<(), ViewerError>;
}

#[cfg(windows)]
pub struct WindowsCredentialStore {
    service: &'static str,
    account: &'static str,
}

#[cfg(windows)]
impl WindowsCredentialStore {
    pub fn device_store() -> Self {
        Self {
            service: DEVICE_SERVICE,
            account: DEVICE_ACCOUNT,
        }
    }

    pub fn clock_store() -> Self {
        Self {
            service: CLOCK_SERVICE,
            account: CLOCK_ACCOUNT,
        }
    }

    #[cfg(test)]
    pub fn for_test(service: &'static str, account: &'static str) -> Self {
        Self { service, account }
    }

    fn entry(&self) -> Result<keyring::Entry, ViewerError> {
        keyring::Entry::new(self.service, self.account)
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
}
