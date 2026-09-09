#![forbid(unsafe_code)]

pub mod archive_service;
pub mod device;
pub mod error;
pub mod license_repository;
pub mod rollback;
pub mod secure_store;
pub mod session;
pub mod trust;

use std::{path::PathBuf, sync::Arc};

use archive_service::ArchiveService;
#[cfg(all(windows, feature = "desktop-runtime"))]
use archive_service::VerifiedArchiveDto;
use device::DeviceManager;
#[cfg(all(windows, feature = "desktop-runtime"))]
use error::CommandError;
use error::ViewerError;
use license_repository::LocalLicenseRepository;
use rollback::RollbackManager;
use secure_store::SecretStore;
use trust::TrustConfig;

#[cfg(all(windows, feature = "desktop-runtime"))]
const MAX_IPC_PATH_BYTES: usize = 4096;

pub struct AppState {
    archives: ArchiveService,
    device: DeviceManager,
    #[allow(dead_code)]
    licenses: LocalLicenseRepository,
    #[allow(dead_code)]
    license_trust: solarch_core::license::LicenseTrustStore,
    rollback: RollbackManager,
}

impl AppState {
    pub fn new(
        store: Arc<dyn SecretStore>,
        clock_store: Arc<dyn SecretStore>,
        app_data_dir: PathBuf,
    ) -> Result<Self, ViewerError> {
        let trust = TrustConfig::for_current_build()?;
        Ok(Self {
            archives: ArchiveService::new(trust.archive_keys),
            device: DeviceManager::new(store),
            licenses: LocalLicenseRepository::new(app_data_dir.join("licenses"))?,
            license_trust: trust.license_keys,
            rollback: RollbackManager::new(clock_store),
        })
    }

    pub fn restore_local_license(
        &self,
        clock_sample: solarch_core::license::ProcessClockSample,
    ) -> Result<bool, ViewerError> {
        let archive = self.archives.locked_identity()?;
        if !self.licenses.has_local_grant(&archive.archive_id)? {
            return Ok(false);
        }
        self.rollback.observe_local(clock_sample)?;
        let now = time::OffsetDateTime::from_unix_timestamp(clock_sample.utc_unix_seconds)
            .map_err(|_| ViewerError::RefreshRequired)?;
        let device = self.device.load_or_create()?;
        let context = solarch_core::license::LicenseValidationContext {
            archive_id: &archive.archive_id,
            archive_fingerprint: &archive.fingerprint,
            device_public_key: device
                .public_key_bytes()
                .map_err(|_| ViewerError::CorruptSecureStore)?,
            now,
        };
        let Some(unwrapped) = self.licenses.load_and_validate(
            &archive.archive_id,
            &self.license_trust,
            &device,
            &context,
        )?
        else {
            return Ok(false);
        };
        self.archives
            .install_unwrapped(&archive.archive_id, &archive.fingerprint, unwrapped)?;
        Ok(true)
    }
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn get_device_public_key(state: tauri::State<'_, Arc<AppState>>) -> Result<String, CommandError> {
    state.device.public_key().map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn open_archive(
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<VerifiedArchiveDto, CommandError> {
    if path.is_empty() || path.len() > MAX_IPC_PATH_BYTES || path.contains('\0') {
        return Err(ViewerError::InvalidInput.into());
    }
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.archives.open(&PathBuf::from(path)))
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn close_archive(state: tauri::State<'_, Arc<AppState>>) -> Result<(), CommandError> {
    state.archives.close().map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
pub fn run() -> Result<(), String> {
    use secure_store::WindowsCredentialStore;
    use tauri::Manager as _;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let store: Arc<dyn SecretStore> = Arc::new(WindowsCredentialStore::device_store());
            let clock_store: Arc<dyn SecretStore> = Arc::new(WindowsCredentialStore::clock_store());
            let state =
                AppState::new(store, clock_store, app_data).map_err(|error| error.to_string())?;
            app.manage(Arc::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_public_key,
            open_archive,
            close_archive
        ])
        .run(tauri::generate_context!())
        .map_err(|error| error.to_string())
}

#[cfg(not(all(windows, feature = "desktop-runtime")))]
pub fn run() -> Result<(), String> {
    Err(
        "SolArch Viewer desktop runtime requires Windows and the desktop-runtime feature"
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use secure_store::MemorySecretStore;
    use session::SessionState;

    #[test]
    fn app_state_is_send_and_sync_for_blocking_archive_work() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AppState>();
    }

    #[test]
    fn ipc_surface_contains_only_public_commands() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::new(
            Arc::new(MemorySecretStore::default()),
            Arc::new(MemorySecretStore::default()),
            directory.path().to_owned(),
        )
        .unwrap();
        let public = state.device.public_key().unwrap();
        assert_eq!(public.len(), 44);
        assert!(!serde_json::to_string(&public).unwrap().contains("private"));
        assert!(matches!(
            *state.archives.session().lock().unwrap(),
            SessionState::Empty
        ));
    }

    #[test]
    fn cached_license_reopens_after_process_restart_without_outstanding_nonce() {
        let directory = tempfile::tempdir().unwrap();
        let private = vector_private_bytes();
        let device_store: Arc<dyn SecretStore> =
            Arc::new(MemorySecretStore::with_value(private.to_vec()));
        let clock_store: Arc<dyn SecretStore> = Arc::new(MemorySecretStore::default());
        let state = AppState::new(
            device_store.clone(),
            clock_store.clone(),
            directory.path().to_owned(),
        )
        .unwrap();
        let archive_path = directory.path().join("vector.slr");
        write_vector_archive(&archive_path);
        let opened = state.archives.open(&archive_path).unwrap();
        let grant = solarch_core::license::LicenseGrant::parse_transport(include_bytes!(
            "../../../../tests/fixtures/license_v1_vector.json"
        ))
        .unwrap();
        let device = state.device.load_or_create().unwrap();
        let validated = solarch_core::license::validate_fresh_response(
            &grant,
            &state.license_trust,
            &device,
            &solarch_core::license::FreshLicenseValidationContext {
                license: solarch_core::license::LicenseValidationContext {
                    archive_id: &opened.archive_id,
                    archive_fingerprint: &opened.fingerprint,
                    device_public_key: device.public_key_bytes().unwrap(),
                    now: time::OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap(),
                },
                outstanding_request_nonce: std::array::from_fn(|index| 0x80 + index as u8),
            },
        )
        .unwrap();
        state.licenses.save_validated(&validated).unwrap();
        state
            .rollback
            .reset_after_online_refresh(solarch_core::license::ProcessClockSample {
                utc_unix_seconds: 1_788_825_600,
                monotonic_millis: 1_000,
            })
            .unwrap();
        drop(validated);
        drop(state);

        let restarted =
            AppState::new(device_store, clock_store, directory.path().to_owned()).unwrap();
        restarted.archives.open(&archive_path).unwrap();
        assert!(restarted
            .restore_local_license(solarch_core::license::ProcessClockSample {
                utc_unix_seconds: 1_788_825_600,
                monotonic_millis: 2_000,
            })
            .unwrap());
        {
            let session = restarted.archives.session().lock().unwrap();
            assert!(session.has_in_memory_ack());
            assert!(!format!("{session:?}").contains("a0a1a2a3"));
        }
        assert!(matches!(
            restarted.archives.enforce_deadline(
                time::OffsetDateTime::from_unix_timestamp(1_788_998_400).unwrap()
            ),
            Err(ViewerError::Expired)
        ));
        assert!(matches!(
            *restarted.archives.session().lock().unwrap(),
            SessionState::Locked(_)
        ));
    }

    #[test]
    fn fresh_install_without_local_grant_does_not_require_clock_high_water() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::new(
            Arc::new(MemorySecretStore::with_value(
                vector_private_bytes().to_vec(),
            )),
            Arc::new(MemorySecretStore::default()),
            directory.path().to_owned(),
        )
        .unwrap();
        let archive_path = directory.path().join("vector.slr");
        write_vector_archive(&archive_path);
        state.archives.open(&archive_path).unwrap();

        assert!(!state
            .restore_local_license(solarch_core::license::ProcessClockSample {
                utc_unix_seconds: 1_788_825_600,
                monotonic_millis: 1_000,
            })
            .unwrap());
    }

    fn write_vector_archive(path: &std::path::Path) {
        let archive_bytes = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        std::fs::write(path, archive_bytes).unwrap();
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
            "../../../../tests/fixtures/license_v1_test_secrets.json"
        ))
        .unwrap();
        hex32(fixture["device_x25519_private_key_hex"].as_str().unwrap())
    }

    #[cfg(windows)]
    #[test]
    fn windows_credential_manager_survives_restart_without_plaintext_file() {
        use secure_store::WindowsCredentialStore;

        const SERVICE: &str = "app.solarch.viewer.part02-native-test";
        const ACCOUNT: &str = "device-a-restart-smoke";
        let cleanup = WindowsCredentialStore::for_test(SERVICE, ACCOUNT);
        cleanup.delete_for_test().unwrap();
        let directory = tempfile::tempdir().unwrap();

        let first = AppState::new(
            Arc::new(WindowsCredentialStore::for_test(SERVICE, ACCOUNT)),
            Arc::new(MemorySecretStore::default()),
            directory.path().to_owned(),
        )
        .unwrap()
        .device
        .public_key()
        .unwrap();
        let second = AppState::new(
            Arc::new(WindowsCredentialStore::for_test(SERVICE, ACCOUNT)),
            Arc::new(MemorySecretStore::default()),
            directory.path().to_owned(),
        )
        .unwrap()
        .device
        .public_key()
        .unwrap();
        assert_eq!(first, second);
        assert!(std::fs::read_dir(directory.path().join("licenses"))
            .unwrap()
            .next()
            .is_none());
        cleanup.delete_for_test().unwrap();
    }
}
