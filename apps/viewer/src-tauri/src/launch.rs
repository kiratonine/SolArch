use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    sync::Mutex,
};

use solarch_core::production_crypto::MAX_FINALIZED_ARCHIVE_BYTES;

use crate::error::ViewerError;

const MAX_WINDOWS_COMMAND_LINE_UNITS: usize = 32_767;
#[cfg(windows)]
const WINDOWS_ENGLISH_LANGUAGE_ID: u32 = 1_033;
#[cfg(windows)]
const WINDOWS_RUSSIAN_LANGUAGE_ID: u32 = 1_049;

pub struct PendingStartupArchive(Mutex<Option<PathBuf>>);

impl PendingStartupArchive {
    pub fn new(path: Option<PathBuf>) -> Self {
        Self(Mutex::new(path))
    }

    pub fn take(&self) -> Result<Option<PathBuf>, ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)
            .map(|mut path| path.take())
    }

    pub fn has_pending(&self) -> Result<bool, ViewerError> {
        self.0
            .lock()
            .map_err(|_| ViewerError::Internal)
            .map(|path| path.is_some())
    }
}

pub fn archive_path_from_os_args<I>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    args.next()?;
    let candidate = PathBuf::from(args.next()?);
    if args.next().is_some() {
        return None;
    }
    validate_archive_candidate(&candidate).ok()?;
    Some(candidate)
}

pub fn archive_path_from_plugin_args(args: &[String]) -> Option<PathBuf> {
    archive_path_from_os_args(args.iter().map(OsString::from))
}

pub fn validate_archive_candidate(path: &Path) -> Result<(), ViewerError> {
    if !path.is_absolute()
        || !is_bounded_argument(path.as_os_str())
        || !path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| extension.eq_ignore_ascii_case("slr"))
    {
        return Err(ViewerError::InvalidInput);
    }
    let metadata = std::fs::metadata(path).map_err(|_| ViewerError::InvalidInput)?;
    if !metadata.is_file() || metadata.len() > MAX_FINALIZED_ARCHIVE_BYTES {
        return Err(ViewerError::InvalidInput);
    }
    Ok(())
}

#[cfg(windows)]
fn is_bounded_argument(value: &OsStr) -> bool {
    use std::os::windows::ffi::OsStrExt as _;

    let mut units = value.encode_wide();
    let bounded = units
        .by_ref()
        .take(MAX_WINDOWS_COMMAND_LINE_UNITS + 1)
        .count()
        <= MAX_WINDOWS_COMMAND_LINE_UNITS;
    bounded && !value.encode_wide().any(|unit| unit == 0)
}

#[cfg(not(windows))]
fn is_bounded_argument(value: &OsStr) -> bool {
    use std::os::unix::ffi::OsStrExt as _;

    let bytes = value.as_bytes();
    bytes.len() <= MAX_WINDOWS_COMMAND_LINE_UNITS && !bytes.contains(&0)
}

#[cfg(windows)]
pub fn installer_locale() -> Option<&'static str> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let installer = current_user
        .open_subkey(r"Software\SolArch\SolArch Viewer")
        .ok()?;
    let language_id = installer
        .get_value::<u32, _>("Installer Language")
        .ok()
        .or_else(|| {
            installer
                .get_value::<String, _>("Installer Language")
                .ok()
                .and_then(|value| parse_installer_language_id(&value))
        })?;
    locale_for_language_id(language_id)
}

#[cfg(windows)]
fn parse_installer_language_id(value: &str) -> Option<u32> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

#[cfg(windows)]
fn locale_for_language_id(language_id: u32) -> Option<&'static str> {
    match language_id {
        WINDOWS_RUSSIAN_LANGUAGE_ID => Some("ru"),
        WINDOWS_ENGLISH_LANGUAGE_ID => Some("en"),
        _ => None,
    }
}

#[cfg(not(windows))]
pub fn installer_locale() -> Option<&'static str> {
    None
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn args(path: &Path) -> Vec<OsString> {
        vec![
            OsString::from("solarch-viewer"),
            path.as_os_str().to_owned(),
        ]
    }

    #[test]
    fn accepts_one_existing_unicode_slr_file_without_string_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("Архив_日本語.slr");
        fs::write(&archive, b"SLR1").unwrap();
        assert_eq!(archive_path_from_os_args(args(&archive)), Some(archive));
    }

    #[test]
    fn rejects_missing_wrong_extension_directory_and_extra_arguments() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("archive.slr");
        let other = directory.path().join("archive.pdf");
        fs::write(&archive, b"SLR1").unwrap();
        fs::write(&other, b"SLR1").unwrap();

        assert!(archive_path_from_os_args([OsString::from("viewer")]).is_none());
        assert!(archive_path_from_os_args(args(&other)).is_none());
        assert!(archive_path_from_os_args(args(directory.path())).is_none());
        assert!(archive_path_from_os_args(args(&directory.path().join("missing.slr"))).is_none());

        let mut extra = args(&archive);
        extra.push(OsString::from("unexpected"));
        assert!(archive_path_from_os_args(extra).is_none());
    }

    #[test]
    fn rejects_relative_and_oversize_archive_arguments() {
        let directory = tempfile::tempdir().unwrap();
        let relative = PathBuf::from("relative.slr");
        fs::write(directory.path().join(&relative), b"SLR1").unwrap();
        assert!(archive_path_from_os_args(args(&relative)).is_none());

        let archive = directory.path().join("oversize.slr");
        let file = fs::File::create(&archive).unwrap();
        file.set_len(MAX_FINALIZED_ARCHIVE_BYTES + 1).unwrap();
        assert!(archive_path_from_os_args(args(&archive)).is_none());
    }

    #[test]
    fn plugin_adapter_keeps_unicode_path() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("архив.slr");
        fs::write(&archive, b"SLR1").unwrap();
        let arguments = vec![
            "solarch-viewer.exe".to_owned(),
            archive.to_string_lossy().into_owned(),
        ];
        assert_eq!(archive_path_from_plugin_args(&arguments), Some(archive));
    }

    #[cfg(windows)]
    #[test]
    fn installer_language_ids_map_only_to_supported_viewer_locales() {
        assert_eq!(
            locale_for_language_id(WINDOWS_RUSSIAN_LANGUAGE_ID),
            Some("ru")
        );
        assert_eq!(
            locale_for_language_id(WINDOWS_ENGLISH_LANGUAGE_ID),
            Some("en")
        );
        assert_eq!(locale_for_language_id(1_031), None);
        assert_eq!(parse_installer_language_id("1049"), Some(1_049));
        assert_eq!(parse_installer_language_id("1033"), Some(1_033));
        assert_eq!(parse_installer_language_id(" 1033"), None);
        assert_eq!(parse_installer_language_id("1033x"), None);
    }
}
