//! Host-independent logical paths. These paths never authorize filesystem access.
use std::collections::HashSet;

use serde::{Deserialize, Deserializer, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::error::{Error, Result};

pub const MAX_PATH_BYTES: usize = 4096;
pub const MAX_PATH_DEPTH: usize = 32;
const MAX_COMPONENT_BYTES: usize = 255;

#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize)]
#[serde(transparent)]
pub struct NormalizedPath(String);

impl NormalizedPath {
    pub fn new(path: &str) -> Result<Self> {
        if path.is_empty() || path.len() > MAX_PATH_BYTES {
            return Err(Error::UnsafePath);
        }
        let normalized: String = path.replace('\\', "/").nfc().collect();
        if normalized.len() > MAX_PATH_BYTES {
            return Err(Error::UnsafePath);
        }
        let mut depth = 0;
        for component in normalized.split('/') {
            depth += 1;
            if depth > MAX_PATH_DEPTH
                || component.is_empty()
                || component == "."
                || component == ".."
                || component.len() > MAX_COMPONENT_BYTES
                || component.ends_with(['.', ' '])
                || component
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                || is_reserved(component)
            {
                return Err(Error::UnsafePath);
            }
        }
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for NormalizedPath {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let path = String::deserialize(deserializer)?;
        Self::new(&path).map_err(serde::de::Error::custom)
    }
}

fn is_reserved(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").to_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

#[derive(Default)]
pub struct PathSet {
    canonical: HashSet<String>,
}

impl PathSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, path: &str) -> Result<NormalizedPath> {
        let path = NormalizedPath::new(path)?;
        // Conservative Unicode casing also rejects collisions such as ß / SS.
        let canonical: String = path.as_str().to_uppercase().nfc().collect();
        if !self.canonical.insert(canonical) {
            return Err(Error::DuplicateNormalizedPath);
        }
        Ok(path)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtectedType {
    Pdf,
    Png,
    Jpeg,
    WebP,
    Docx,
    Xlsx,
}

impl ProtectedType {
    /// Checks metadata only; this does not establish that bytes match their MIME type.
    pub fn from_path(path: &NormalizedPath) -> Result<Self> {
        let name = path
            .as_str()
            .rsplit('/')
            .next()
            .ok_or(Error::UnsupportedFileType)?;
        let (stem, extension) = name.rsplit_once('.').ok_or(Error::UnsupportedFileType)?;
        if stem.is_empty() {
            return Err(Error::UnsupportedFileType);
        }
        match extension.to_ascii_lowercase().as_str() {
            "pdf" => Ok(Self::Pdf),
            "png" => Ok(Self::Png),
            "jpg" | "jpeg" => Ok(Self::Jpeg),
            "webp" => Ok(Self::WebP),
            "docx" => Ok(Self::Docx),
            "xlsx" => Ok(Self::Xlsx),
            _ => Err(Error::UnsupportedFileType),
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::WebP => "image/webp",
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_is_logical_and_unicode_stable() {
        assert_eq!(
            NormalizedPath::new("course\\cafe\u{301}.PDF")
                .unwrap()
                .as_str(),
            "course/café.PDF"
        );
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        for path in [
            "",
            "../a.pdf",
            "a/../b.pdf",
            "a\\..\\b.pdf",
            "/a.pdf",
            "C:\\a.pdf",
            "C:a.pdf",
            "\\\\server\\a.pdf",
            "a\0.pdf",
            "a//b.pdf",
            "./a.pdf",
            "a/",
            "a:stream.pdf",
            "NUL.pdf",
            "COM1.pdf",
            "lpt³.pdf",
            "a. /b.pdf",
            "a./b.pdf",
            "a?/b.pdf",
        ] {
            assert_eq!(
                NormalizedPath::new(path),
                Err(Error::UnsafePath),
                "{path:?}"
            );
        }
        assert!(NormalizedPath::new(&"a/".repeat(MAX_PATH_DEPTH)).is_err());
        assert!(NormalizedPath::new(&"a".repeat(256)).is_err());
        assert!(NormalizedPath::new(&"a".repeat(MAX_PATH_BYTES + 1)).is_err());
    }

    #[test]
    fn canonical_duplicates_are_rejected() {
        for (first, second) in [
            ("a\\b.pdf", "a/b.pdf"),
            ("a.PDF", "A.pdf"),
            ("café.pdf", "cafe\u{301}.pdf"),
            ("straße.pdf", "STRASSE.pdf"),
        ] {
            let mut set = PathSet::new();
            set.insert(first).unwrap();
            assert_eq!(set.insert(second), Err(Error::DuplicateNormalizedPath));
        }
    }

    #[test]
    fn supported_extensions_have_expected_mime() {
        for (extension, mime) in [
            ("PDF", "application/pdf"),
            ("png", "image/png"),
            ("jpg", "image/jpeg"),
            ("jpeg", "image/jpeg"),
            ("webp", "image/webp"),
            (
                "docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            (
                "xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
        ] {
            assert_eq!(
                ProtectedType::from_path(
                    &NormalizedPath::new(&format!("file.{extension}")).unwrap()
                )
                .unwrap()
                .mime_type(),
                mime
            );
        }
        for name in [
            "a.exe",
            "a.doc",
            "a.xls",
            "a.pptx",
            "a.mp4",
            "a",
            ".pdf",
            "a.pdf.exe",
        ] {
            assert_eq!(
                ProtectedType::from_path(&NormalizedPath::new(name).unwrap()),
                Err(Error::UnsupportedFileType)
            );
        }
    }

    #[test]
    fn deserialization_cannot_bypass_validation() {
        assert!(serde_json::from_str::<NormalizedPath>("\"../secret.pdf\"").is_err());
        assert_eq!(
            serde_json::from_str::<NormalizedPath>("\"ok.pdf\"")
                .unwrap()
                .as_str(),
            "ok.pdf"
        );
    }
}
