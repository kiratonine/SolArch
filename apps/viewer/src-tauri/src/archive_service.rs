use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde::Serialize;
use solarch_core::{
    archive::{inspect_signing_key_id, verify_archive, ProtectedArchiveReader},
    license::UnwrappedLicense,
};
use time::OffsetDateTime;

use crate::{
    error::ViewerError,
    renderer::{
        self, DocxOpenDto, ImageOpenDto, PdfOpenDto, RendererKind, RendererOpenRequestDto,
        RendererRegistry, RendererState, XlsxOpenDto, XlsxWindowDto, DOCX_MIME, JPEG_MIME,
        MAX_IMAGE_SOURCE_BYTES, MAX_OOXML_SOURCE_BYTES, PDF_MIME, PNG_MIME, WEBP_MIME, XLSX_MIME,
    },
    session::{SessionState, VerifiedArchiveIdentity},
    trust::ArchiveTrustStore,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedArchiveDto {
    pub title: String,
    pub creator_wallet: String,
    pub price_amount: String,
    pub price_currency: String,
    pub archive_id: String,
    pub max_devices: u32,
    pub allow_export: bool,
    pub watermark_enabled: bool,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedFileDto {
    pub file_id: String,
    pub path: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkDto {
    pub buyer_wallet_short: String,
    pub license_id_short: String,
    pub archive_id_short: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtectedDeadlineToken {
    pub session_serial: u64,
    pub deadline: OffsetDateTime,
}

pub struct ArchiveService {
    trust: ArchiveTrustStore,
    session: Mutex<SessionState>,
    next_session_serial: AtomicU64,
}

impl ArchiveService {
    pub fn new(trust: ArchiveTrustStore) -> Self {
        Self {
            trust,
            session: Mutex::new(SessionState::Empty),
            next_session_serial: AtomicU64::new(0),
        }
    }

    pub fn open(&self, path: &Path) -> Result<VerifiedArchiveDto, ViewerError> {
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Empty;
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("slr"))
        {
            return Err(ViewerError::InvalidInput);
        }
        let key_id = inspect_signing_key_id(path).map_err(ViewerError::from)?;
        let key = self.trust.key(&key_id)?;
        let verified = verify_archive(path, &key_id, key).map_err(ViewerError::from)?;
        let header = verified.public_header;
        let identity = VerifiedArchiveIdentity {
            archive_id: header.archive_id.clone(),
            fingerprint: verified.archive_fingerprint.clone(),
            path: path.to_path_buf(),
            signing_key_id: key_id,
            signing_public_key: key,
            file_identity: verified.file_identity,
            public_header: header.clone(),
        };
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Locked(identity);
        Ok(VerifiedArchiveDto {
            title: header.title,
            creator_wallet: header.creator_wallet,
            price_amount: header.commercial_snapshot.price_amount,
            price_currency: header.commercial_snapshot.price_currency,
            archive_id: header.archive_id,
            max_devices: header.license_snapshot.max_devices,
            allow_export: header.license_snapshot.allow_export,
            watermark_enabled: header.license_snapshot.watermark_enabled,
            fingerprint: verified.archive_fingerprint,
        })
    }

    pub fn close(&self) -> Result<(), ViewerError> {
        *self.session.lock().map_err(|_| ViewerError::Internal)? = SessionState::Empty;
        Ok(())
    }

    pub fn install_unwrapped(
        &self,
        archive_id: &str,
        fingerprint: &str,
        unwrapped: UnwrappedLicense,
    ) -> Result<(), ViewerError> {
        let expected = {
            let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            match &*session {
                SessionState::Locked(current)
                | SessionState::Unwrapped {
                    archive: current, ..
                } if current.archive_id == archive_id && current.fingerprint == fingerprint => {
                    current.clone()
                }
                _ => return Err(ViewerError::InvalidLicense),
            }
        };
        let reader = ProtectedArchiveReader::open(
            &expected.path,
            &expected.signing_key_id,
            expected.signing_public_key,
            &expected.fingerprint,
            &expected.file_identity,
            &unwrapped.archive_content_key,
        )
        .map_err(ViewerError::from)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if !matches!(
            &*session,
            SessionState::Locked(current) | SessionState::Unwrapped { archive: current, .. }
                if current == &expected
        ) {
            return Err(ViewerError::InvalidLicense);
        }
        let deadline = unwrapped.metadata.offline_valid_until;
        let session_serial = self.next_session_serial.fetch_add(1, Ordering::Relaxed) + 1;
        *session = SessionState::Unwrapped {
            archive: expected,
            license: unwrapped.metadata,
            reader: Box::new(reader),
            offline_deadline: deadline,
            session_serial,
            renderers: Box::new(RendererRegistry::new(session_serial)),
        };
        Ok(())
    }

    pub fn enforce_deadline(&self, now: OffsetDateTime) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if let SessionState::Unwrapped {
            archive,
            offline_deadline,
            ..
        } = &*session
        {
            if now >= *offline_deadline {
                let locked = archive.clone();
                *session = SessionState::Locked(locked);
                return Err(ViewerError::RefreshRequired);
            }
        }
        Ok(())
    }

    pub fn list_files(&self, now: OffsetDateTime) -> Result<Vec<ProtectedFileDto>, ViewerError> {
        self.enforce_deadline(now)?;
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { reader, .. } = &*session else {
            return Err(ViewerError::InvalidLicense);
        };
        Ok(reader
            .files()
            .iter()
            .map(|file| ProtectedFileDto {
                file_id: file.file_id.clone(),
                path: file.path.as_str().to_owned(),
                display_name: file.display_name.clone(),
                mime_type: file.mime_type.clone(),
                size_bytes: file.size_bytes,
            })
            .collect())
    }

    pub fn read_file_range(
        &self,
        file_id: &str,
        offset: u64,
        length: u64,
        now: OffsetDateTime,
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, ViewerError> {
        self.enforce_deadline(now)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { reader, .. } = &mut *session else {
            return Err(ViewerError::InvalidLicense);
        };
        reader
            .read_file_range(file_id, offset, length)
            .map_err(ViewerError::from)
    }

    pub fn watermark(&self, now: OffsetDateTime) -> Result<WatermarkDto, ViewerError> {
        self.enforce_deadline(now)?;
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped {
            archive, license, ..
        } = &*session
        else {
            return Err(ViewerError::InvalidLicense);
        };
        Ok(WatermarkDto {
            buyer_wallet_short: short_identity(&license.buyer_wallet),
            license_id_short: short_identity(&license.license_id),
            archive_id_short: short_identity(&archive.archive_id),
        })
    }

    pub fn deadline_token(&self) -> Result<ProtectedDeadlineToken, ViewerError> {
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped {
            offline_deadline,
            session_serial,
            ..
        } = &*session
        else {
            return Err(ViewerError::InvalidLicense);
        };
        Ok(ProtectedDeadlineToken {
            session_serial: *session_serial,
            deadline: *offline_deadline,
        })
    }

    pub fn expire_session(
        &self,
        token: ProtectedDeadlineToken,
        now: OffsetDateTime,
    ) -> Result<bool, ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped {
            archive,
            offline_deadline,
            session_serial,
            ..
        } = &*session
        else {
            return Ok(false);
        };
        if *session_serial != token.session_serial || *offline_deadline != token.deadline {
            return Ok(false);
        }
        if now < *offline_deadline {
            return Ok(false);
        }
        let locked = archive.clone();
        *session = SessionState::Locked(locked);
        Ok(true)
    }

    pub fn begin_renderer_open(
        &self,
        file_id: &str,
        kind: RendererKind,
        now: OffsetDateTime,
    ) -> Result<RendererOpenRequestDto, ViewerError> {
        self.enforce_deadline(now)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped {
            reader, renderers, ..
        } = &mut *session
        else {
            return Err(ViewerError::InvalidLicense);
        };
        protected_file(reader, file_id, renderer_mime_types(kind))?;
        Ok(RendererOpenRequestDto {
            request_id: renderers.begin(file_id, kind)?,
        })
    }

    pub fn cancel_renderer_open(&self, request_id: &str) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if let SessionState::Unwrapped { renderers, .. } = &mut *session {
            renderers.cancel(request_id);
        }
        Ok(())
    }

    pub fn pdf_open(
        &self,
        request_id: &str,
        now: OffsetDateTime,
    ) -> Result<PdfOpenDto, ViewerError> {
        let result = (|| {
            self.enforce_deadline(now)?;
            let (size_bytes, prefix, tail) = {
                let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
                let SessionState::Unwrapped {
                    reader, renderers, ..
                } = &mut *session
                else {
                    return Err(ViewerError::InvalidLicense);
                };
                let file_id = renderers.pending_file(request_id, RendererKind::Pdf)?;
                let file = protected_file(reader, &file_id, &[PDF_MIME])?;
                let size_bytes = file.size_bytes;
                let prefix_len = size_bytes.min(8);
                let tail_len = size_bytes.min(1_024);
                let prefix = reader
                    .read_file_range(&file_id, 0, prefix_len)
                    .map_err(ViewerError::from)?;
                let tail = reader
                    .read_file_range(&file_id, size_bytes.saturating_sub(tail_len), tail_len)
                    .map_err(ViewerError::from)?;
                (size_bytes, prefix, tail)
            };
            renderer::validate_pdf_open(&prefix, &tail, size_bytes)?;
            let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            let SessionState::Unwrapped { renderers, .. } = &mut *session else {
                return Err(ViewerError::InvalidLicense);
            };
            let handle = renderers.complete(request_id, size_bytes, RendererState::Pdf)?;
            Ok(PdfOpenDto { handle, size_bytes })
        })();
        if result.is_err() {
            let _ = self.cancel_renderer_open(request_id);
        }
        result
    }

    pub fn pdf_read_range(
        &self,
        handle: &str,
        offset: u64,
        length: u64,
        now: OffsetDateTime,
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, ViewerError> {
        if length == 0 || length > renderer::PDF_RANGE_BYTES {
            return Err(ViewerError::InvalidInput);
        }
        self.enforce_deadline(now)?;
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped {
            reader, renderers, ..
        } = &mut *session
        else {
            return Err(ViewerError::InvalidLicense);
        };
        let open = renderers.get(handle, RendererKind::Pdf)?;
        let end = offset
            .checked_add(length)
            .ok_or(ViewerError::InvalidInput)?;
        if end > open.size_bytes {
            return Err(ViewerError::InvalidInput);
        }
        let file_id = open.file_id.clone();
        reader
            .read_file_range(&file_id, offset, length)
            .map_err(ViewerError::from)
    }

    pub fn image_open(
        &self,
        request_id: &str,
        now: OffsetDateTime,
    ) -> Result<ImageOpenDto, ViewerError> {
        let result = (|| {
            self.enforce_deadline(now)?;
            let (size_bytes, mime_type, bytes) = {
                let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
                let SessionState::Unwrapped {
                    reader, renderers, ..
                } = &mut *session
                else {
                    return Err(ViewerError::InvalidLicense);
                };
                let file_id = renderers.pending_file(request_id, RendererKind::Image)?;
                let file = protected_file(reader, &file_id, &[PNG_MIME, JPEG_MIME, WEBP_MIME])?;
                let bytes = reader
                    .read_complete_file_bounded(&file_id, MAX_IMAGE_SOURCE_BYTES)
                    .map_err(map_renderer_core_error)?;
                (file.size_bytes, file.mime_type, bytes)
            };
            let (width, height, sanitized_png) = renderer::decode_image(&bytes, &mime_type)?;
            let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            let SessionState::Unwrapped { renderers, .. } = &mut *session else {
                return Err(ViewerError::InvalidLicense);
            };
            let handle = renderers.complete(
                request_id,
                size_bytes,
                RendererState::Image {
                    sanitized_png: zeroize::Zeroizing::new(sanitized_png),
                },
            )?;
            Ok(ImageOpenDto {
                handle,
                width,
                height,
                mime_type: PNG_MIME,
            })
        })();
        if result.is_err() {
            let _ = self.cancel_renderer_open(request_id);
        }
        result
    }

    pub fn image_render_data(
        &self,
        handle: &str,
        now: OffsetDateTime,
    ) -> Result<Vec<u8>, ViewerError> {
        self.enforce_deadline(now)?;
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { renderers, .. } = &*session else {
            return Err(ViewerError::InvalidLicense);
        };
        let open = renderers.get(handle, RendererKind::Image)?;
        let RendererState::Image { sanitized_png } = &open.state else {
            return Err(ViewerError::RendererClosed);
        };
        Ok(sanitized_png.to_vec())
    }

    pub fn docx_open(
        &self,
        request_id: &str,
        now: OffsetDateTime,
    ) -> Result<DocxOpenDto, ViewerError> {
        let result = (|| {
            self.enforce_deadline(now)?;
            let (size_bytes, bytes) = {
                let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
                let SessionState::Unwrapped {
                    reader, renderers, ..
                } = &mut *session
                else {
                    return Err(ViewerError::InvalidLicense);
                };
                let file_id = renderers.pending_file(request_id, RendererKind::Docx)?;
                let file = protected_file(reader, &file_id, &[DOCX_MIME])?;
                let bytes = reader
                    .read_complete_file_bounded(&file_id, MAX_OOXML_SOURCE_BYTES)
                    .map_err(map_renderer_core_error)?;
                (file.size_bytes, bytes)
            };
            let blocks = renderer::parse_docx(&bytes)?;
            let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            let SessionState::Unwrapped { renderers, .. } = &mut *session else {
                return Err(ViewerError::InvalidLicense);
            };
            let handle = renderers.complete(request_id, size_bytes, RendererState::Docx)?;
            Ok(DocxOpenDto { handle, blocks })
        })();
        if result.is_err() {
            let _ = self.cancel_renderer_open(request_id);
        }
        result
    }

    pub fn xlsx_open(
        &self,
        request_id: &str,
        now: OffsetDateTime,
    ) -> Result<XlsxOpenDto, ViewerError> {
        let result = (|| {
            self.enforce_deadline(now)?;
            let (size_bytes, bytes) = {
                let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
                let SessionState::Unwrapped {
                    reader, renderers, ..
                } = &mut *session
                else {
                    return Err(ViewerError::InvalidLicense);
                };
                let file_id = renderers.pending_file(request_id, RendererKind::Xlsx)?;
                let file = protected_file(reader, &file_id, &[XLSX_MIME])?;
                let bytes = reader
                    .read_complete_file_bounded(&file_id, MAX_OOXML_SOURCE_BYTES)
                    .map_err(map_renderer_core_error)?;
                (file.size_bytes, bytes)
            };
            let sheets = renderer::inspect_xlsx(&bytes)?;
            let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
            let SessionState::Unwrapped { renderers, .. } = &mut *session else {
                return Err(ViewerError::InvalidLicense);
            };
            let handle = renderers.complete(
                request_id,
                size_bytes,
                RendererState::Xlsx {
                    workbook: bytes,
                    sheets: sheets.clone(),
                },
            )?;
            Ok(XlsxOpenDto { handle, sheets })
        })();
        if result.is_err() {
            let _ = self.cancel_renderer_open(request_id);
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    pub fn xlsx_sheet_window(
        &self,
        handle: &str,
        sheet_index: u32,
        row_offset: u32,
        row_count: u32,
        column_offset: u32,
        column_count: u32,
        now: OffsetDateTime,
    ) -> Result<XlsxWindowDto, ViewerError> {
        self.enforce_deadline(now)?;
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { renderers, .. } = &*session else {
            return Err(ViewerError::InvalidLicense);
        };
        let open = renderers.get(handle, RendererKind::Xlsx)?;
        let RendererState::Xlsx { workbook, sheets } = &open.state else {
            return Err(ViewerError::RendererClosed);
        };
        renderer::read_xlsx_window(
            workbook,
            sheets,
            sheet_index,
            row_offset,
            row_count,
            column_offset,
            column_count,
        )
    }

    pub fn renderer_close(&self, handle: &str) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        let SessionState::Unwrapped { renderers, .. } = &mut *session else {
            return Err(ViewerError::RendererClosed);
        };
        renderers.close(handle)
    }

    pub fn locked_identity(&self) -> Result<VerifiedArchiveIdentity, ViewerError> {
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        match &*session {
            SessionState::Locked(identity) => Ok(identity.clone()),
            SessionState::Empty | SessionState::Unwrapped { .. } => {
                Err(ViewerError::InvalidLicense)
            }
        }
    }

    pub fn current_identity(&self) -> Result<VerifiedArchiveIdentity, ViewerError> {
        let session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        match &*session {
            SessionState::Locked(identity)
            | SessionState::Unwrapped {
                archive: identity, ..
            } => Ok(identity.clone()),
            SessionState::Empty => Err(ViewerError::InvalidLicense),
        }
    }

    pub fn relock(&self) -> Result<(), ViewerError> {
        let mut session = self.session.lock().map_err(|_| ViewerError::Internal)?;
        if let SessionState::Unwrapped { archive, .. } = &*session {
            *session = SessionState::Locked(archive.clone());
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn session(&self) -> &Mutex<SessionState> {
        &self.session
    }
}

fn protected_file(
    reader: &ProtectedArchiveReader,
    file_id: &str,
    allowed_mime: &[&str],
) -> Result<solarch_core::manifest::ManifestFile, ViewerError> {
    if file_id.len() > 128 || !file_id.is_ascii() {
        return Err(ViewerError::InvalidInput);
    }
    let file = reader
        .files()
        .iter()
        .find(|candidate| candidate.file_id == file_id)
        .ok_or(ViewerError::UnsupportedFile)?;
    if !allowed_mime.contains(&file.mime_type.as_str()) {
        return Err(ViewerError::UnsupportedFile);
    }
    Ok(file.clone())
}

fn renderer_mime_types(kind: RendererKind) -> &'static [&'static str] {
    match kind {
        RendererKind::Pdf => &[PDF_MIME],
        RendererKind::Image => &[PNG_MIME, JPEG_MIME, WEBP_MIME],
        RendererKind::Docx => &[DOCX_MIME],
        RendererKind::Xlsx => &[XLSX_MIME],
    }
}

fn map_renderer_core_error(error: solarch_core::Error) -> ViewerError {
    match error {
        solarch_core::Error::LimitExceeded => ViewerError::RendererLimit,
        _ => ViewerError::from(error),
    }
}

fn short_identity(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 14 {
        return value.to_owned();
    }
    format!(
        "{}…{}",
        chars[..6].iter().collect::<String>(),
        chars[chars.len() - 4..].iter().collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Cursor, Seek, SeekFrom, Write},
    };

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use ed25519_dalek::{Signer as _, SigningKey};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};
    use solarch_core::{
        archive::{ArchiveBuilder, BuildRequest},
        license::ValidatedLicenseMetadata,
        production_crypto::{signing_message, ArchiveContentKey},
    };
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::*;
    use crate::renderer::DocxBlockDto;
    use crate::trust::TrustConfig;

    const RENDERER_HEADER: &str = r#"{"archive_id":"arc_test_01","backend":{"archive_api_id":"arc_test_01"},"commercial_snapshot":{"platform_fee_bps":500,"price_amount":"10.000000","price_currency":"USDC"},"created_at":"2026-09-07T00:00:00Z","creator_wallet":"11111111111111111111111111111111","crypto":{"chunk_size":1048576,"content_algorithm":"XChaCha20-Poly1305","kdf":"HKDF-SHA-256"},"format":"solarch","license_snapshot":{"allow_export":false,"max_devices":1,"watermark_enabled":true},"title":"Synthetic renderer archive","version":"1.0.0"}"#;

    struct RendererFixture {
        _directory: tempfile::TempDir,
        archive: std::path::PathBuf,
        fingerprint: String,
    }

    fn renderer_fixture() -> RendererFixture {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("input");
        fs::create_dir(&input).unwrap();
        fs::write(input.join("01-pages.pdf"), two_page_pdf()).unwrap();
        for (name, format) in [
            ("02-image.png", ImageFormat::Png),
            ("03-image.jpg", ImageFormat::Jpeg),
            ("04-image.webp", ImageFormat::WebP),
        ] {
            fs::write(input.join(name), small_image(format)).unwrap();
        }
        fs::write(input.join("05-document.docx"), sample_docx()).unwrap();
        fs::write(input.join("06-workbook.xlsx"), sample_xlsx()).unwrap();
        let metadata = directory.path().join("header.json");
        fs::write(&metadata, RENDERER_HEADER).unwrap();
        let archive = directory.path().join("renderer.slr");
        let ack = ArchiveContentKey::from_bytes(std::array::from_fn(|index| 0xa0 + index as u8));
        let signing = SigningKey::from_bytes(&std::array::from_fn(|index| index as u8));
        let pending = ArchiveBuilder::prepare(BuildRequest {
            input_dir: &input,
            metadata_path: &metadata,
            output_path: &archive,
            signing_key_id: "arc-test-01",
            signing_public_key: signing.verifying_key().to_bytes(),
            archive_content_key: &ack,
        })
        .unwrap();
        let signature = signing.sign(&signing_message(&pending.result().signing_digest));
        let finalized = pending.accept_signature(signature.to_bytes()).unwrap();
        RendererFixture {
            _directory: directory,
            archive,
            fingerprint: finalized.archive_fingerprint,
        }
    }

    fn install_fixture(service: &ArchiveService, fixture: RendererFixture) -> RendererFixture {
        service.open(&fixture.archive).unwrap();
        service
            .install_unwrapped(
                "arc_test_01",
                &fixture.fingerprint,
                UnwrappedLicense {
                    metadata: ValidatedLicenseMetadata {
                        license_id: "lic_renderer_test_0001".into(),
                        entitlement_id: "ent_renderer_test_0001".into(),
                        buyer_wallet: "BuyerWallet111111111111111111111111111111".into(),
                        issued_at: OffsetDateTime::from_unix_timestamp(1_788_825_600).unwrap(),
                        offline_valid_until: OffsetDateTime::from_unix_timestamp(1_789_084_800)
                            .unwrap(),
                    },
                    archive_content_key: ArchiveContentKey::from_bytes(std::array::from_fn(
                        |index| 0xa0 + index as u8,
                    )),
                },
            )
            .unwrap();
        fixture
    }

    fn begin(
        service: &ArchiveService,
        file_id: &str,
        kind: RendererKind,
        now: OffsetDateTime,
    ) -> String {
        service
            .begin_renderer_open(file_id, kind, now)
            .unwrap()
            .request_id
    }

    fn small_image(format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(3, 2, |x, y| {
            Rgb([(x * 60) as u8, (y * 80) as u8, 130])
        }));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, format).unwrap();
        output.into_inner()
    }

    fn package(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn sample_docx() -> Vec<u8> {
        package(&[
            (
                "[Content_Types].xml",
                r#"<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
            ("_rels/.rels", "<Relationships/>"),
            (
                "word/document.xml",
                r#"<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Protected heading</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Readable paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#,
            ),
        ])
    }

    fn sample_xlsx() -> Vec<u8> {
        package(&[
            (
                "[Content_Types].xml",
                r#"<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c><c r="C1"><f>1+1</f><v>7</v></c></row></sheetData></worksheet>"#,
            ),
            (
                "xl/worksheets/sheet2.xml",
                r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Details</t></is></c></row></sheetData></worksheet>"#,
            ),
        ])
    }

    fn two_page_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
            "<< /Length 47 >>\nstream\nBT /F1 18 Tf 40 160 Td (Page one) Tj ET\nendstream",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
            "<< /Length 47 >>\nstream\nBT /F1 18 Tf 40 160 Td (Page two) Tj ET\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ];
        let mut output = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(output.len());
            write!(output, "{} 0 obj\n{}\nendobj\n", index + 1, object).unwrap();
        }
        let xref = output.len();
        write!(
            output,
            "xref\n0 {}\n0000000000 65535 f \n",
            objects.len() + 1
        )
        .unwrap();
        for offset in offsets {
            writeln!(output, "{offset:010} 00000 n ").unwrap();
        }
        write!(
            output,
            "trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
        )
        .unwrap();
        output
    }

    #[test]
    fn trusted_vector_opens_to_locked_and_tamper_fails() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("vector.slr");
        let bytes = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        fs::write(&archive, &bytes).unwrap();
        let service =
            ArchiveService::new(TrustConfig::development_fixtures().unwrap().archive_keys);
        let result = service.open(&archive).unwrap();
        assert_eq!(result.archive_id, "arc_test_01");
        assert_eq!(
            result.fingerprint,
            "57ce84068fdd9b23f8860afa27834151f4fefb038d812c2ac77e8a861b1eecdb"
        );
        assert!(matches!(
            *service.session.lock().unwrap(),
            SessionState::Locked(_)
        ));

        let mut tampered = bytes;
        tampered[200] ^= 1;
        fs::write(&archive, tampered).unwrap();
        assert!(service.open(&archive).is_err());
        assert!(matches!(
            *service.session.lock().unwrap(),
            SessionState::Empty
        ));
    }

    #[test]
    fn unknown_archive_key_fails_closed() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("vector.slr");
        let bytes = STANDARD
            .decode(include_str!("../../../../tests/fixtures/slr_v1_vector.b64").trim())
            .unwrap();
        fs::write(&archive, bytes).unwrap();
        let service = ArchiveService::new(ArchiveTrustStore::default());
        assert!(matches!(
            service.open(&archive),
            Err(ViewerError::UntrustedArchive)
        ));
    }

    #[test]
    fn real_encrypted_archive_supports_every_renderer_family_with_bounded_handles() {
        let service =
            ArchiveService::new(TrustConfig::development_fixtures().unwrap().archive_keys);
        let fixture = install_fixture(&service, renderer_fixture());
        assert_eq!(
            fs::read(&fixture.archive).unwrap(),
            STANDARD
                .decode(include_str!("../../../../tests/fixtures/slr_v1_multiformat.b64").trim())
                .unwrap()
        );
        assert_eq!(
            fixture.fingerprint,
            include_str!("../../../../tests/fixtures/slr_v1_multiformat.fingerprint").trim()
        );
        let now = OffsetDateTime::from_unix_timestamp(1_788_825_601).unwrap();
        let files = service.list_files(now).unwrap();
        assert_eq!(files.len(), 6);
        let find = |mime: &str| files.iter().find(|file| file.mime_type == mime).unwrap();

        let pdf_request = begin(&service, &find(PDF_MIME).file_id, RendererKind::Pdf, now);
        let pdf = service.pdf_open(&pdf_request, now).unwrap();
        assert!(service
            .pdf_read_range(
                &pdf.handle,
                0,
                pdf.size_bytes.min(renderer::PDF_RANGE_BYTES),
                now,
            )
            .unwrap()
            .starts_with(b"%PDF-"));
        assert_eq!(
            service.pdf_read_range(&pdf.handle, 0, renderer::PDF_RANGE_BYTES + 1, now),
            Err(ViewerError::InvalidInput)
        );

        for mime in [PNG_MIME, JPEG_MIME, WEBP_MIME] {
            let image_request = begin(&service, &find(mime).file_id, RendererKind::Image, now);
            let image = service.image_open(&image_request, now).unwrap();
            assert_eq!(
                (image.width, image.height, image.mime_type),
                (3, 2, PNG_MIME)
            );
            assert!(service
                .image_render_data(&image.handle, now)
                .unwrap()
                .starts_with(b"\x89PNG"));
        }

        let docx_request = begin(&service, &find(DOCX_MIME).file_id, RendererKind::Docx, now);
        let docx = service.docx_open(&docx_request, now).unwrap();
        assert!(docx
            .blocks
            .iter()
            .any(|block| matches!(block, DocxBlockDto::Table { .. })));
        assert_eq!(
            service.pdf_read_range(&pdf.handle, 0, 1, now),
            Err(ViewerError::RendererClosed)
        );

        let xlsx_request = begin(&service, &find(XLSX_MIME).file_id, RendererKind::Xlsx, now);
        let xlsx = service.xlsx_open(&xlsx_request, now).unwrap();
        assert_eq!(xlsx.sheets.len(), 2);
        let window = service
            .xlsx_sheet_window(&xlsx.handle, 0, 0, 10, 0, 10, now)
            .unwrap();
        assert!(window
            .cells
            .iter()
            .any(|cell| cell.display_value == "Revenue"));
        let first_watermark = service.watermark(now).unwrap();
        assert_eq!(
            first_watermark,
            WatermarkDto {
                buyer_wallet_short: "BuyerW…1111".into(),
                license_id_short: "lic_re…0001".into(),
                archive_id_short: "arc_test_01".into(),
            }
        );
        service
            .install_unwrapped(
                "arc_test_01",
                &fixture.fingerprint,
                UnwrappedLicense {
                    metadata: ValidatedLicenseMetadata {
                        license_id: "lic_renderer_test_0002".into(),
                        entitlement_id: "ent_renderer_test_0002".into(),
                        buyer_wallet: "SecondBuyerWallet2222222222222222".into(),
                        issued_at: OffsetDateTime::from_unix_timestamp(1_788_825_602).unwrap(),
                        offline_valid_until: OffsetDateTime::from_unix_timestamp(1_789_084_801)
                            .unwrap(),
                    },
                    archive_content_key: ArchiveContentKey::from_bytes(std::array::from_fn(
                        |index| 0xa0 + index as u8,
                    )),
                },
            )
            .unwrap();
        assert_eq!(
            service.watermark(now).unwrap(),
            WatermarkDto {
                buyer_wallet_short: "Second…2222".into(),
                license_id_short: "lic_re…0002".into(),
                archive_id_short: "arc_test_01".into(),
            }
        );
        assert_eq!(
            service.xlsx_sheet_window(&xlsx.handle, 0, 0, 1, 0, 1, now),
            Err(ViewerError::RendererClosed)
        );

        drop(fixture);
    }

    #[test]
    fn exact_deadline_relocks_and_invalidates_open_renderer_and_stale_tokens() {
        let service =
            ArchiveService::new(TrustConfig::development_fixtures().unwrap().archive_keys);
        let fixture = install_fixture(&service, renderer_fixture());
        let now = OffsetDateTime::from_unix_timestamp(1_788_825_601).unwrap();
        let image_file = service
            .list_files(now)
            .unwrap()
            .into_iter()
            .find(|file| file.mime_type == PNG_MIME)
            .unwrap();
        let image_request = begin(&service, &image_file.file_id, RendererKind::Image, now);
        let image = service.image_open(&image_request, now).unwrap();
        let token = service.deadline_token().unwrap();
        assert!(!service
            .expire_session(token, token.deadline - time::Duration::nanoseconds(1))
            .unwrap());
        assert!(service.expire_session(token, token.deadline).unwrap());
        assert_eq!(
            service.image_render_data(&image.handle, token.deadline),
            Err(ViewerError::InvalidLicense)
        );

        let fixture = install_fixture(&service, fixture);
        assert!(!service.expire_session(token, token.deadline).unwrap());
        assert!(service.list_files(now).is_ok());
        drop(fixture);
    }

    #[test]
    fn changed_archive_bytes_fail_closed_during_renderer_read() {
        let service =
            ArchiveService::new(TrustConfig::development_fixtures().unwrap().archive_keys);
        let fixture = install_fixture(&service, renderer_fixture());
        let now = OffsetDateTime::from_unix_timestamp(1_788_825_601).unwrap();
        let image_file = service
            .list_files(now)
            .unwrap()
            .into_iter()
            .find(|file| file.mime_type == PNG_MIME)
            .unwrap();
        let mut archive = fs::OpenOptions::new()
            .write(true)
            .open(&fixture.archive)
            .unwrap();
        archive.seek(SeekFrom::Start(800)).unwrap();
        archive.write_all(&[0xAA]).unwrap();
        archive.sync_all().unwrap();
        let image_request = begin(&service, &image_file.file_id, RendererKind::Image, now);
        assert!(matches!(
            service.image_open(&image_request, now),
            Err(ViewerError::InvalidArchive | ViewerError::RendererError)
        ));
    }
}
