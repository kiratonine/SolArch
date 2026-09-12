#![deny(unsafe_code)]

pub mod archive_service;
pub mod backend;
pub mod clock;
pub mod device;
pub mod error;
pub mod launch;
pub mod license_repository;
pub mod payment_repository;
pub mod payment_service;
pub mod renderer;
pub mod rollback;
pub mod secure_store;
pub mod session;
pub mod trust;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use archive_service::{ArchiveService, ProtectedFileDto, VerifiedArchiveDto, WatermarkDto};
use backend::{BackendApi, BackendConfig, HttpBackendClient};
use device::DeviceManager;
#[cfg(all(windows, feature = "desktop-runtime"))]
use error::CommandError;
use error::ViewerError;
use license_repository::LocalLicenseRepository;
use payment_repository::ActiveIntentRepository;
use payment_service::{PaymentService, PaymentView};
use rollback::RollbackManager;
use secure_store::{KeyedSecretStore, SecretStore};
use trust::TrustConfig;

#[cfg(all(windows, feature = "desktop-runtime"))]
struct WebviewHardeningState(std::sync::atomic::AtomicBool);

#[cfg(all(windows, feature = "desktop-runtime"))]
impl WebviewHardeningState {
    fn pending() -> Self {
        Self(std::sync::atomic::AtomicBool::new(false))
    }

    fn mark_ready(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }

    fn ensure_ready(&self) -> Result<(), ViewerError> {
        if self.0.load(std::sync::atomic::Ordering::Acquire) {
            Ok(())
        } else {
            Err(ViewerError::RendererClosed)
        }
    }
}

#[cfg(all(windows, feature = "desktop-runtime"))]
const MAX_IPC_PATH_BYTES: usize = 4096;

pub struct AppState {
    open_gate: Mutex<()>,
    archives: ArchiveService,
    device: DeviceManager,
    #[allow(dead_code)]
    licenses: LocalLicenseRepository,
    #[allow(dead_code)]
    license_trust: solarch_core::license::LicenseTrustStore,
    rollback: RollbackManager,
    payments: PaymentService,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerStateKind {
    Idle,
    Opening,
    Locked,
    CheckingMetadata,
    PaymentPreparing,
    PaymentReady,
    PaymentPending,
    AwaitingFinality,
    Activating,
    Unlocked,
    RefreshRequired,
    Refreshing,
    BackendUnavailable,
    PaymentExpired,
    PaymentFailed,
    DeviceLimitReached,
    LicenseRevoked,
    ArchiveBlocked,
    Error,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerSnapshot {
    pub state: ViewerStateKind,
    pub archive: Option<VerifiedArchiveDto>,
    pub payment: Option<PaymentView>,
    pub files: Vec<ProtectedFileDto>,
    pub watermark: Option<WatermarkDto>,
}

impl AppState {
    pub fn new(
        store: Arc<dyn SecretStore>,
        clock_store: Arc<dyn SecretStore>,
        keyed_store: Arc<dyn KeyedSecretStore>,
        app_data_dir: PathBuf,
    ) -> Result<Self, ViewerError> {
        let trust = TrustConfig::for_current_build()?;
        let configured = configured_backend();
        let (backend, backend_config) = match configured {
            Ok((client, config)) => (Some(client), Some(config)),
            Err(_) => (None, None),
        };
        Self::new_inner(
            store,
            clock_store,
            keyed_store,
            app_data_dir,
            trust,
            backend,
            backend_config,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new_inner(
        store: Arc<dyn SecretStore>,
        clock_store: Arc<dyn SecretStore>,
        keyed_store: Arc<dyn KeyedSecretStore>,
        app_data_dir: PathBuf,
        trust: TrustConfig,
        backend: Option<Arc<dyn BackendApi>>,
        backend_config: Option<BackendConfig>,
    ) -> Result<Self, ViewerError> {
        let payment_repository = ActiveIntentRepository::new(app_data_dir.join("payments"))?;
        Ok(Self {
            open_gate: Mutex::new(()),
            archives: ArchiveService::new(trust.archive_keys),
            device: DeviceManager::new(store),
            licenses: LocalLicenseRepository::new(app_data_dir.join("licenses"))?,
            license_trust: trust.license_keys,
            rollback: RollbackManager::new(clock_store),
            payments: PaymentService::new(backend, backend_config, keyed_store, payment_repository),
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

    pub fn open_archive_flow(&self, path: &std::path::Path) -> Result<ViewerSnapshot, ViewerError> {
        launch::validate_archive_candidate(path)?;
        let _open_guard = self.open_gate.lock().map_err(|_| ViewerError::Internal)?;
        self.payments.reset_for_archive_switch()?;
        let archive = self.archives.open(path)?;
        let clock = clock::process_clock_sample()?;
        match self.restore_local_license(clock) {
            Ok(true) => self.unlocked_snapshot(archive, clock),
            Ok(false) => match self.payments.check_metadata(&self.archives, &self.device) {
                Ok(()) => Ok(ViewerSnapshot {
                    state: self
                        .payments
                        .current_payment()?
                        .as_ref()
                        .map(payment_state_kind)
                        .unwrap_or(ViewerStateKind::Locked),
                    archive: Some(archive),
                    payment: self.payments.current_payment()?,
                    files: Vec::new(),
                    watermark: None,
                }),
                Err(ViewerError::BackendUnavailable) => Ok(ViewerSnapshot {
                    state: ViewerStateKind::BackendUnavailable,
                    archive: Some(archive),
                    payment: None,
                    files: Vec::new(),
                    watermark: None,
                }),
                Err(error) => Err(error),
            },
            Err(ViewerError::Expired | ViewerError::RefreshRequired) => {
                match self.payments.refresh(
                    &self.archives,
                    &self.device,
                    &self.licenses,
                    &self.license_trust,
                    &self.rollback,
                    clock,
                ) {
                    Ok(()) => self.unlocked_snapshot(archive, clock),
                    Err(ViewerError::BackendUnavailable) => Ok(ViewerSnapshot {
                        state: ViewerStateKind::RefreshRequired,
                        archive: Some(archive),
                        payment: None,
                        files: Vec::new(),
                        watermark: None,
                    }),
                    Err(error) => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn start_payment(&self) -> Result<ViewerSnapshot, ViewerError> {
        let payment = self
            .payments
            .prepare_payment(&self.archives, &self.device)?;
        Ok(ViewerSnapshot {
            state: payment_state_kind(&payment),
            archive: None,
            payment: Some(payment),
            files: Vec::new(),
            watermark: None,
        })
    }

    pub fn retry_metadata(&self) -> Result<ViewerSnapshot, ViewerError> {
        self.payments.check_metadata(&self.archives, &self.device)?;
        let payment = self.payments.current_payment()?;
        Ok(ViewerSnapshot {
            state: payment
                .as_ref()
                .map(payment_state_kind)
                .unwrap_or(ViewerStateKind::Locked),
            archive: None,
            payment,
            files: Vec::new(),
            watermark: None,
        })
    }

    pub fn poll_payment(&self) -> Result<ViewerSnapshot, ViewerError> {
        let (payment, _) = self.payments.verify_payment()?;
        Ok(ViewerSnapshot {
            state: payment_state_kind(&payment),
            archive: None,
            payment: Some(payment),
            files: Vec::new(),
            watermark: None,
        })
    }

    pub fn activate_payment(&self) -> Result<ViewerSnapshot, ViewerError> {
        let clock = clock::process_clock_sample()?;
        self.payments.activate(
            &self.archives,
            &self.device,
            &self.licenses,
            &self.license_trust,
            &self.rollback,
            clock,
        )?;
        let identity = self.archives.current_identity()?;
        self.unlocked_snapshot(archive_dto(&identity), clock)
    }

    pub fn refresh_license(&self) -> Result<ViewerSnapshot, ViewerError> {
        let clock = clock::process_clock_sample()?;
        self.payments.refresh(
            &self.archives,
            &self.device,
            &self.licenses,
            &self.license_trust,
            &self.rollback,
            clock,
        )?;
        let identity = self.archives.current_identity()?;
        self.unlocked_snapshot(archive_dto(&identity), clock)
    }

    fn unlocked_snapshot(
        &self,
        archive: VerifiedArchiveDto,
        clock: solarch_core::license::ProcessClockSample,
    ) -> Result<ViewerSnapshot, ViewerError> {
        if let Ok(device_public_key) = self.device.public_key() {
            self.payments.cleanup_completed_intent_after_unlock(
                &archive.archive_id,
                &archive.fingerprint,
                &device_public_key,
            );
        }
        let now = time::OffsetDateTime::from_unix_timestamp(clock.utc_unix_seconds)
            .map_err(|_| ViewerError::RefreshRequired)?;
        Ok(ViewerSnapshot {
            state: ViewerStateKind::Unlocked,
            archive: Some(archive),
            payment: None,
            files: self.archives.list_files(now)?,
            watermark: Some(self.archives.watermark(now)?),
        })
    }
}

fn configured_backend() -> Result<(Arc<dyn BackendApi>, BackendConfig), backend::BackendError> {
    #[cfg(feature = "development-fixtures")]
    if let Ok(value) = std::env::var("SOLARCH_DEV_BACKEND_FIXTURE") {
        let mode = backend::dev_fixture::DevFixtureMode::parse(&value)
            .ok_or(backend::BackendError::Configuration)?;
        let config = BackendConfig::development("https://api.solarch.example/")?;
        return Ok((
            Arc::new(backend::dev_fixture::DevFixtureBackend::new(mode)),
            config,
        ));
    }
    #[cfg(feature = "development-fixtures")]
    if let Ok(origin) = std::env::var("SOLARCH_DEV_BACKEND_ORIGIN") {
        let config = BackendConfig::development(&origin)?;
        let client = Arc::new(HttpBackendClient::new(config.clone())?);
        return Ok((client, config));
    }
    let config = BackendConfig::production()?;
    let client = Arc::new(HttpBackendClient::new(config.clone())?);
    Ok((client, config))
}

fn payment_state_kind(payment: &PaymentView) -> ViewerStateKind {
    match payment.state {
        payment_service::PaymentState::PaymentReady => ViewerStateKind::PaymentReady,
        payment_service::PaymentState::PaymentPending => ViewerStateKind::PaymentPending,
        payment_service::PaymentState::AwaitingFinality => ViewerStateKind::AwaitingFinality,
        payment_service::PaymentState::Activating => ViewerStateKind::Activating,
    }
}

fn archive_dto(identity: &session::VerifiedArchiveIdentity) -> VerifiedArchiveDto {
    let header = &identity.public_header;
    VerifiedArchiveDto {
        title: header.title.clone(),
        creator_wallet: header.creator_wallet.clone(),
        price_amount: header.commercial_snapshot.price_amount.clone(),
        price_currency: header.commercial_snapshot.price_currency.clone(),
        archive_id: header.archive_id.clone(),
        max_devices: header.license_snapshot.max_devices,
        allow_export: header.license_snapshot.allow_export,
        watermark_enabled: header.license_snapshot.watermark_enabled,
        fingerprint: identity.fingerprint.clone(),
    }
}

#[cfg(all(windows, feature = "desktop-runtime"))]
const FILE_OPEN_EVENT: &str = "viewer://archive-opened";
#[cfg(all(windows, feature = "desktop-runtime"))]
const PROTECTED_SESSION_EXPIRED_EVENT: &str = "viewer://protected-session-expired";

#[cfg(all(windows, feature = "desktop-runtime"))]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOpenEvent {
    snapshot: Option<ViewerSnapshot>,
    error: Option<CommandError>,
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn get_device_public_key(state: tauri::State<'_, Arc<AppState>>) -> Result<String, CommandError> {
    state.device.public_key().map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn get_installer_locale() -> Option<&'static str> {
    launch::installer_locale()
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn open_archive(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    if path.is_empty() || path.len() > MAX_IPC_PATH_BYTES || path.contains('\0') {
        return Err(ViewerError::InvalidInput.into());
    }
    let state = Arc::clone(state.inner());
    let worker = Arc::clone(&state);
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        worker.open_archive_flow(&PathBuf::from(path))
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(CommandError::from)?;
    arm_protected_deadline(&app, &state, &snapshot);
    Ok(snapshot)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn take_startup_archive(
    pending: tauri::State<'_, launch::PendingStartupArchive>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<ViewerSnapshot>, CommandError> {
    let Some(path) = pending.take().map_err(CommandError::from)? else {
        return Ok(None);
    };
    let state = Arc::clone(state.inner());
    let worker = Arc::clone(&state);
    let snapshot = tauri::async_runtime::spawn_blocking(move || worker.open_archive_flow(&path))
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(CommandError::from)?;
    arm_protected_deadline(&app, &state, &snapshot);
    Ok(Some(snapshot))
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn startup_archive_pending(
    pending: tauri::State<'_, launch::PendingStartupArchive>,
) -> Result<bool, CommandError> {
    pending.has_pending().map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn start_payment(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.start_payment())
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn retry_metadata(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.retry_metadata())
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn poll_payment(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.poll_payment())
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn activate_payment(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    let state = Arc::clone(state.inner());
    let worker = Arc::clone(&state);
    let snapshot = tauri::async_runtime::spawn_blocking(move || worker.activate_payment())
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(CommandError::from)?;
    arm_protected_deadline(&app, &state, &snapshot);
    Ok(snapshot)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn refresh_license(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewerSnapshot, CommandError> {
    let state = Arc::clone(state.inner());
    let worker = Arc::clone(&state);
    let snapshot = tauri::async_runtime::spawn_blocking(move || worker.refresh_license())
        .await
        .map_err(|_| CommandError::from(ViewerError::Internal))?
        .map_err(CommandError::from)?;
    arm_protected_deadline(&app, &state, &snapshot);
    Ok(snapshot)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn protected_session_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let now = renderer_now()?;
        state.archives.enforce_deadline(now)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn renderer_begin_open(
    file_id: String,
    kind: renderer::RendererKind,
    state: tauri::State<'_, Arc<AppState>>,
    hardening: tauri::State<'_, Arc<WebviewHardeningState>>,
) -> Result<renderer::RendererOpenRequestDto, CommandError> {
    validate_file_id_input(&file_id)?;
    hardening.ensure_ready().map_err(CommandError::from)?;
    state
        .archives
        .begin_renderer_open(&file_id, kind, renderer_now()?)
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn renderer_cancel_open(
    request_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    validate_request_input(&request_id)?;
    state
        .archives
        .cancel_renderer_open(&request_id)
        .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn pdf_open(
    request_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<renderer::PdfOpenDto, CommandError> {
    validate_request_input(&request_id)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.archives.pdf_open(&request_id, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn pdf_read_range(
    handle: String,
    offset: u64,
    length: u64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<tauri::ipc::Response, CommandError> {
    validate_handle_input(&handle)?;
    let state = Arc::clone(state.inner());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        state
            .archives
            .pdf_read_range(&handle, offset, length, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(CommandError::from)?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn image_open(
    request_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<renderer::ImageOpenDto, CommandError> {
    validate_request_input(&request_id)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.archives.image_open(&request_id, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn image_render_data(
    handle: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<tauri::ipc::Response, CommandError> {
    validate_handle_input(&handle)?;
    let state = Arc::clone(state.inner());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        state.archives.image_render_data(&handle, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(CommandError::from)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn docx_open(
    request_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<renderer::DocxOpenDto, CommandError> {
    validate_request_input(&request_id)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.archives.docx_open(&request_id, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
async fn xlsx_open(
    request_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<renderer::XlsxOpenDto, CommandError> {
    validate_request_input(&request_id)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.archives.xlsx_open(&request_id, renderer_now()?)
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn xlsx_sheet_window(
    handle: String,
    sheet_index: u32,
    row_offset: u32,
    row_count: u32,
    column_offset: u32,
    column_count: u32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<renderer::XlsxWindowDto, CommandError> {
    validate_handle_input(&handle)?;
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.archives.xlsx_sheet_window(
            &handle,
            sheet_index,
            row_offset,
            row_count,
            column_offset,
            column_count,
            renderer_now()?,
        )
    })
    .await
    .map_err(|_| CommandError::from(ViewerError::Internal))?
    .map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn renderer_close(
    handle: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    validate_handle_input(&handle)?;
    state.archives.renderer_close(&handle).map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn renderer_now() -> Result<time::OffsetDateTime, ViewerError> {
    let sample = clock::process_clock_sample()?;
    time::OffsetDateTime::from_unix_timestamp(sample.utc_unix_seconds)
        .map_err(|_| ViewerError::RefreshRequired)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn validate_file_id_input(file_id: &str) -> Result<(), CommandError> {
    if file_id.is_empty() || file_id.len() > 128 || !file_id.is_ascii() {
        return Err(ViewerError::InvalidInput.into());
    }
    Ok(())
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn validate_handle_input(handle: &str) -> Result<(), CommandError> {
    if handle.len() != 38 || !handle.is_ascii() || !handle.starts_with("view_") {
        return Err(ViewerError::InvalidInput.into());
    }
    Ok(())
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn validate_request_input(request_id: &str) -> Result<(), CommandError> {
    if request_id.len() != 38 || !request_id.is_ascii() || !request_id.starts_with("open_") {
        return Err(ViewerError::InvalidInput.into());
    }
    Ok(())
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn arm_protected_deadline(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    snapshot: &ViewerSnapshot,
) {
    if snapshot.state != ViewerStateKind::Unlocked {
        return;
    }
    let Ok(token) = state.archives.deadline_token() else {
        return;
    };
    let app = app.clone();
    let state = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        #[cfg(feature = "development-fixtures")]
        let development_delay = development_expiry_delay();
        loop {
            let now = match renderer_now() {
                Ok(now) => now,
                Err(_) => token.deadline,
            };
            let delay_ms = (token.deadline - now).whole_milliseconds().max(0);
            #[cfg(feature = "development-fixtures")]
            let delay_ms = development_delay.map_or(delay_ms, i128::from);
            let delay_ms = u64::try_from(delay_ms).unwrap_or(u64::MAX);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            #[cfg(feature = "development-fixtures")]
            let now = if development_delay.is_some() {
                token.deadline
            } else {
                renderer_now().unwrap_or(token.deadline)
            };
            #[cfg(not(feature = "development-fixtures"))]
            let now = renderer_now().unwrap_or(token.deadline);
            match state.archives.expire_session(token, now) {
                Ok(true) => {
                    use tauri::Emitter as _;
                    let _ = app.emit(PROTECTED_SESSION_EXPIRED_EVENT, ());
                    return;
                }
                Ok(false) if now < token.deadline => continue,
                Ok(false) | Err(_) => return,
            }
        }
    });
}

#[cfg(all(windows, feature = "desktop-runtime", feature = "development-fixtures"))]
fn development_expiry_delay() -> Option<u64> {
    std::env::var("SOLARCH_DEV_EXPIRY_AFTER_MILLIS")
        .ok()?
        .parse::<u64>()
        .ok()
        .filter(|value| *value <= 60_000)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[tauri::command]
fn close_archive(state: tauri::State<'_, Arc<AppState>>) -> Result<(), CommandError> {
    state
        .payments
        .reset_for_archive_switch()
        .map_err(CommandError::from)?;
    state.archives.close().map_err(Into::into)
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn handle_second_instance(app: &tauri::AppHandle, args: Vec<String>) {
    use tauri::{Emitter as _, Manager as _};

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let Some(path) = launch::archive_path_from_plugin_args(&args) else {
        return;
    };
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let state = Arc::clone(state.inner());
    let app = app.clone();
    let _ = app.emit("viewer://archive-open-requested", ());
    tauri::async_runtime::spawn(async move {
        let worker = Arc::clone(&state);
        let result = tauri::async_runtime::spawn_blocking(move || worker.open_archive_flow(&path))
            .await
            .map_err(|_| ViewerError::Internal)
            .and_then(|result| result);
        let payload = match result {
            Ok(snapshot) => {
                arm_protected_deadline(&app, &state, &snapshot);
                FileOpenEvent {
                    snapshot: Some(snapshot),
                    error: None,
                }
            }
            Err(error) => FileOpenEvent {
                snapshot: None,
                error: Some(error.into()),
            },
        };
        let _ = app.emit(FILE_OPEN_EVENT, payload);
    });
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn configure_webview_hardening(
    app: &tauri::AppHandle,
    hardening: Arc<WebviewHardeningState>,
) -> Result<(), String> {
    use tauri::Manager as _;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview is unavailable".to_owned())?;
    let app = app.clone();
    window
        .with_webview(move |platform| {
            if windows_webview_hardening::apply(&platform).is_ok() {
                hardening.mark_ready();
            } else {
                // Protected renderer commands remain fail-closed until the native boundary is ready.
                app.exit(1);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(all(windows, feature = "desktop-runtime"))]
#[allow(unsafe_code)]
mod windows_webview_hardening {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface as _;

    pub(super) fn apply(platform: &tauri::webview::PlatformWebview) -> Result<(), ()> {
        // WebView2 exposes these supported settings through COM. The generated bindings mark
        // COM calls unsafe; the controller is owned by Tauri for the lifetime of this callback.
        unsafe {
            let webview = platform.controller().CoreWebView2().map_err(|_| ())?;
            let settings = webview.Settings().map_err(|_| ())?;
            settings
                .SetAreDefaultContextMenusEnabled(false)
                .map_err(|_| ())?;
            settings.SetAreDevToolsEnabled(false).map_err(|_| ())?;
            let settings3 = settings.cast::<ICoreWebView2Settings3>().map_err(|_| ())?;
            settings3
                .SetAreBrowserAcceleratorKeysEnabled(false)
                .map_err(|_| ())?;
        }
        Ok(())
    }
}

#[cfg(all(windows, feature = "desktop-runtime"))]
pub fn run() -> Result<(), String> {
    use secure_store::{WindowsCredentialStore, WindowsKeyedSecretStore};
    use tauri::Manager as _;

    let startup_archive = launch::archive_path_from_os_args(std::env::args_os());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_second_instance(app, args);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            #[cfg(feature = "development-fixtures")]
            let app_data = match std::env::var("SOLARCH_DEV_APP_DATA_DIR") {
                Ok(override_path) => {
                    let candidate = PathBuf::from(override_path);
                    if !candidate.is_absolute() {
                        return Err("development app-data override must be absolute".into());
                    }
                    candidate
                }
                Err(_) => app_data,
            };
            let device_store = WindowsCredentialStore::device_store();
            #[cfg(feature = "development-fixtures")]
            seed_development_fixture_device(&device_store).map_err(|error| error.to_string())?;
            let store: Arc<dyn SecretStore> = Arc::new(device_store);
            let clock_store: Arc<dyn SecretStore> = Arc::new(WindowsCredentialStore::clock_store());
            let keyed_store: Arc<dyn KeyedSecretStore> = Arc::new(WindowsKeyedSecretStore);
            let state = AppState::new(store, clock_store, keyed_store, app_data)
                .map_err(|error| error.to_string())?;
            app.manage(Arc::new(state));
            let hardening = Arc::new(WebviewHardeningState::pending());
            app.manage(Arc::clone(&hardening));
            configure_webview_hardening(app.handle(), hardening)?;
            Ok(())
        })
        .manage(launch::PendingStartupArchive::new(startup_archive))
        .invoke_handler(tauri::generate_handler![
            get_device_public_key,
            get_installer_locale,
            open_archive,
            startup_archive_pending,
            take_startup_archive,
            start_payment,
            retry_metadata,
            poll_payment,
            activate_payment,
            refresh_license,
            protected_session_status,
            renderer_begin_open,
            renderer_cancel_open,
            pdf_open,
            pdf_read_range,
            image_open,
            image_render_data,
            docx_open,
            xlsx_open,
            xlsx_sheet_window,
            renderer_close,
            close_archive
        ])
        .run(tauri::generate_context!())
        .map_err(|error| error.to_string())
}

#[cfg(all(windows, feature = "desktop-runtime", feature = "development-fixtures"))]
fn seed_development_fixture_device(
    store: &secure_store::WindowsCredentialStore,
) -> Result<(), ViewerError> {
    if std::env::var("SOLARCH_DEV_BACKEND_FIXTURE").is_err() {
        return Ok(());
    }
    let hex = "3caa61bc13e56473e913a85c33cf4d603ac99a517eea95ed4573e772b64435f7";
    let mut expected = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        expected[index] = u8::from_str_radix(
            std::str::from_utf8(chunk).map_err(|_| ViewerError::Internal)?,
            16,
        )
        .map_err(|_| ViewerError::Internal)?;
    }
    match store.read()? {
        Some(existing) if existing.as_slice() == expected => Ok(()),
        Some(_) => Err(ViewerError::CorruptSecureStore),
        None => {
            store.write(&expected)?;
            let persisted = store.read()?.ok_or(ViewerError::SecureStoreUnavailable)?;
            if persisted.as_slice() != expected {
                return Err(ViewerError::SecureStoreUnavailable);
            }
            Ok(())
        }
    }
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
    use secure_store::{MemoryKeyedSecretStore, MemorySecretStore};
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
            Arc::new(MemoryKeyedSecretStore::default()),
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
        let keyed_store: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let state = AppState::new(
            device_store.clone(),
            clock_store.clone(),
            keyed_store.clone(),
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

        keyed_store
            .write(
                secure_store::SecretPurpose::DeviceRefresh,
                "arc_test_01\0lic_test_01",
                b"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            )
            .unwrap();

        let restarted = AppState::new(
            device_store,
            clock_store,
            keyed_store,
            directory.path().to_owned(),
        )
        .unwrap();
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
            Err(ViewerError::RefreshRequired)
        ));
        assert!(matches!(
            *restarted.archives.session().lock().unwrap(),
            SessionState::Locked(_)
        ));
        assert!(matches!(
            restarted.payments.refresh(
                &restarted.archives,
                &restarted.device,
                &restarted.licenses,
                &restarted.license_trust,
                &restarted.rollback,
                solarch_core::license::ProcessClockSample {
                    utc_unix_seconds: 1_788_998_400,
                    monotonic_millis: 3_000,
                },
            ),
            Err(ViewerError::BackendUnavailable)
        ));
        assert!(restarted
            .archives
            .list_files(time::OffsetDateTime::from_unix_timestamp(1_788_998_400).unwrap())
            .is_err());
    }

    #[test]
    fn fresh_install_without_local_grant_does_not_require_clock_high_water() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::new(
            Arc::new(MemorySecretStore::with_value(
                vector_private_bytes().to_vec(),
            )),
            Arc::new(MemorySecretStore::default()),
            Arc::new(MemoryKeyedSecretStore::default()),
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

    #[test]
    fn expired_cached_grant_with_refresh_credential_denies_when_backend_is_unavailable() {
        let directory = tempfile::tempdir().unwrap();
        let keyed_store: Arc<dyn KeyedSecretStore> = Arc::new(MemoryKeyedSecretStore::default());
        let state = AppState::new(
            Arc::new(MemorySecretStore::with_value(
                vector_private_bytes().to_vec(),
            )),
            Arc::new(MemorySecretStore::with_value(
                1_788_825_600_i64.to_le_bytes().to_vec(),
            )),
            keyed_store.clone(),
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
        keyed_store
            .write(
                secure_store::SecretPurpose::DeviceRefresh,
                "arc_test_01\0lic_test_01",
                b"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            )
            .unwrap();
        let deadline = solarch_core::license::ProcessClockSample {
            utc_unix_seconds: 1_788_998_400,
            monotonic_millis: 2_000,
        };
        assert!(matches!(
            state.restore_local_license(deadline),
            Err(ViewerError::Expired)
        ));
        assert!(matches!(
            state.payments.refresh(
                &state.archives,
                &state.device,
                &state.licenses,
                &state.license_trust,
                &state.rollback,
                deadline,
            ),
            Err(ViewerError::BackendUnavailable)
        ));
        assert!(state
            .archives
            .list_files(time::OffsetDateTime::from_unix_timestamp(1_788_998_400).unwrap())
            .is_err());
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
            Arc::new(MemoryKeyedSecretStore::default()),
            directory.path().to_owned(),
        )
        .unwrap()
        .device
        .public_key()
        .unwrap();
        let second = AppState::new(
            Arc::new(WindowsCredentialStore::for_test(SERVICE, ACCOUNT)),
            Arc::new(MemorySecretStore::default()),
            Arc::new(MemoryKeyedSecretStore::default()),
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
