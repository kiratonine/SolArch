use std::sync::{Arc, Mutex};

use solarch_core::license::{ProcessClockSample, RollbackGuard, RollbackState};

use crate::{error::ViewerError, secure_store::SecretStore};

pub struct RollbackManager {
    store: Arc<dyn SecretStore>,
    guard: Mutex<Option<RollbackGuard>>,
}

impl RollbackManager {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            guard: Mutex::new(None),
        }
    }

    /// Called only after a successful authoritative HTTPS refresh in Part 03.
    pub fn reset_after_online_refresh(
        &self,
        sample: ProcessClockSample,
    ) -> Result<RollbackState, ViewerError> {
        let mut guard = RollbackGuard::default();
        let state = guard.observe(sample).map_err(ViewerError::from)?;
        self.persist(state)?;
        *self.guard.lock().map_err(|_| ViewerError::Internal)? = Some(guard);
        Ok(state)
    }

    pub fn observe_local(&self, sample: ProcessClockSample) -> Result<RollbackState, ViewerError> {
        let mut slot = self.guard.lock().map_err(|_| ViewerError::Internal)?;
        if slot.is_none() {
            let bytes = self.store.read()?.ok_or(ViewerError::RefreshRequired)?;
            if bytes.len() != 8 {
                return Err(ViewerError::CorruptSecureStore);
            }
            let encoded: [u8; 8] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| ViewerError::CorruptSecureStore)?;
            let high_water_unix_seconds = i64::from_le_bytes(encoded);
            if high_water_unix_seconds < 0 {
                return Err(ViewerError::CorruptSecureStore);
            }
            *slot = Some(RollbackGuard::restore(RollbackState {
                high_water_unix_seconds,
            }));
        }
        let state = slot
            .as_mut()
            .ok_or(ViewerError::Internal)?
            .observe(sample)
            .map_err(ViewerError::from)?;
        self.persist(state)?;
        Ok(state)
    }

    fn persist(&self, state: RollbackState) -> Result<(), ViewerError> {
        self.store
            .write(&state.high_water_unix_seconds.to_le_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_store::MemorySecretStore;

    #[test]
    fn missing_or_malformed_state_fails_closed() {
        let missing = RollbackManager::new(Arc::new(MemorySecretStore::default()));
        assert!(matches!(
            missing.observe_local(sample(1_000, 0)),
            Err(ViewerError::RefreshRequired)
        ));
        let malformed = RollbackManager::new(Arc::new(MemorySecretStore::with_value(vec![0; 7])));
        assert!(matches!(
            malformed.observe_local(sample(1_000, 0)),
            Err(ViewerError::CorruptSecureStore)
        ));
    }

    #[test]
    fn authoritative_reset_persists_high_water_across_restart() {
        let store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::default());
        RollbackManager::new(store.clone())
            .reset_after_online_refresh(sample(10_000, 0))
            .unwrap();
        let restarted = RollbackManager::new(store);
        assert!(restarted.observe_local(sample(9_700, 1_000)).is_ok());
        assert!(matches!(
            restarted.observe_local(sample(9_699, 2_000)),
            Err(ViewerError::RefreshRequired)
        ));
    }

    fn sample(utc_unix_seconds: i64, monotonic_millis: u64) -> ProcessClockSample {
        ProcessClockSample {
            utc_unix_seconds,
            monotonic_millis,
        }
    }
}
