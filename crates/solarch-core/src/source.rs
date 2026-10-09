//! Deterministic discovery and bounded validation of protected source files.
//!
//! This module never copies or extracts plaintext. Discovered files retain a
//! filesystem identity which is checked whenever the builder opens them.

use std::{
    collections::HashSet,
    fs::{self, File, Metadata},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

use quick_xml::{events::Event, Reader};

use crate::{
    paths::{NormalizedPath, PathSet, ProtectedType, MAX_PATH_DEPTH},
    Error, Result,
};

pub const MAX_SOURCE_FILES: usize = 10_000;
pub const MAX_SINGLE_FILE_BYTES: u64 = 536_870_912;
pub const MAX_TOTAL_PLAINTEXT_BYTES: u64 = 536_870_912;

// A representable archive has at most MAX_SOURCE_FILES leaf files, each with
// at most MAX_PATH_DEPTH components. Counting every encountered file/directory
// against this derived budget bounds hostile empty topology without reducing
// any frozen archive/file/path limit.
const MAX_SOURCE_ENTRIES: usize = MAX_SOURCE_FILES * MAX_PATH_DEPTH;

const MAX_PROBE_BYTES: usize = 65_557;
const MAX_OOXML_NAME_BYTES: usize = 4_096;
const MAX_CONTENT_TYPES_BYTES: u64 = 1_048_576;
const ZIP_LOCAL_MAGIC: &[u8; 4] = b"PK\x03\x04";
const ZIP_CENTRAL_MAGIC: &[u8; 4] = b"PK\x01\x02";
const ZIP_EOCD_MAGIC: &[u8; 4] = b"PK\x05\x06";

#[derive(Debug)]
pub struct SourceInventory {
    root: PathBuf,
    files: Vec<SourceFile>,
    total_size_bytes: u64,
}

impl SourceInventory {
    pub fn discover(input_dir: &Path) -> Result<Self> {
        Self::discover_with_entry_limit(input_dir, MAX_SOURCE_ENTRIES)
    }

    fn discover_with_entry_limit(input_dir: &Path, entry_limit: usize) -> Result<Self> {
        let root_metadata = fs::symlink_metadata(input_dir).map_err(|_| Error::Io)?;
        if root_metadata.file_type().is_symlink()
            || is_reparse_point(&root_metadata)
            || !root_metadata.is_dir()
        {
            return Err(Error::UnsafePath);
        }

        let root = input_dir.to_path_buf();
        let mut discovered = Vec::new();
        let mut remaining_entries = entry_limit;
        let mut total_size_bytes = 0_u64;
        discover_directory(
            &root,
            &root,
            &mut discovered,
            &mut remaining_entries,
            &mut total_size_bytes,
        )?;
        let root_after = fs::symlink_metadata(&root).map_err(|_| Error::Io)?;
        if root_after.file_type().is_symlink()
            || is_reparse_point(&root_after)
            || !root_after.is_dir()
            || !same_filesystem_object(&root_metadata, &root_after)
        {
            return Err(Error::UnsafePath);
        }
        if discovered.is_empty() {
            return Err(Error::InvalidBuilderInput);
        }

        // Empty directories have no representation in `.slr` and are never
        // retained. Collision state therefore scales only with the frozen
        // protected-file limit, while `PathSet` provides O(log n) insertion.
        let mut collision_paths = PathSet::new();
        for file in &discovered {
            collision_paths.insert_file(file.normalized_path.as_str())?;
        }

        discovered.sort_by(|left, right| {
            left.normalized_path
                .as_str()
                .as_bytes()
                .cmp(right.normalized_path.as_str().as_bytes())
        });
        Ok(Self {
            root,
            files: discovered,
            total_size_bytes,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn files(&self) -> &[SourceFile] {
        &self.files
    }

    pub fn total_size_bytes(&self) -> u64 {
        self.total_size_bytes
    }
}

#[derive(Debug)]
pub struct SourceFile {
    source_path: PathBuf,
    normalized_path: NormalizedPath,
    protected_type: ProtectedType,
    size_bytes: u64,
    identity: FileIdentity,
}

impl SourceFile {
    pub fn source_path(&self) -> &Path {
        &self.source_path
    }

    pub fn normalized_path(&self) -> &NormalizedPath {
        &self.normalized_path
    }

    pub fn protected_type(&self) -> ProtectedType {
        self.protected_type
    }

    pub fn mime_type(&self) -> &'static str {
        self.protected_type.mime_type()
    }

    pub fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    /// Opens the original file and rejects a symlink/reparse-point or identity
    /// change since discovery. Callers should retain this handle while reading.
    pub fn open_verified(&self) -> Result<File> {
        let path_metadata = fs::symlink_metadata(&self.source_path).map_err(|_| Error::Io)?;
        if path_metadata.file_type().is_symlink()
            || is_reparse_point(&path_metadata)
            || !path_metadata.is_file()
        {
            return Err(Error::UnsafePath);
        }
        let mut file = File::open(&self.source_path).map_err(|_| Error::Io)?;
        let opened_metadata = file.metadata().map_err(|_| Error::Io)?;
        let current_identity = FileIdentity::from_metadata(&opened_metadata)?;
        if current_identity != self.identity
            || FileIdentity::from_metadata(&path_metadata)? != self.identity
        {
            return Err(Error::InvalidBuilderInput);
        }
        validate_protected_content(&mut file, self.protected_type, self.size_bytes)?;
        file.seek(SeekFrom::Start(0)).map_err(|_| Error::Io)?;
        self.verify_unchanged(&file)?;
        Ok(file)
    }

    /// Rechecks the retained handle and path after streaming completes.
    pub fn verify_unchanged(&self, file: &File) -> Result<()> {
        let opened = FileIdentity::from_metadata(&file.metadata().map_err(|_| Error::Io)?)?;
        let path_metadata = fs::symlink_metadata(&self.source_path).map_err(|_| Error::Io)?;
        if path_metadata.file_type().is_symlink()
            || is_reparse_point(&path_metadata)
            || FileIdentity::from_metadata(&path_metadata)? != self.identity
            || opened != self.identity
        {
            return Err(Error::InvalidBuilderInput);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileIdentity {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl FileIdentity {
    fn from_metadata(metadata: &Metadata) -> Result<Self> {
        if !metadata.is_file() {
            return Err(Error::UnsafePath);
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;

        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        })
    }
}

fn discover_directory(
    root: &Path,
    directory: &Path,
    files: &mut Vec<SourceFile>,
    remaining_entries: &mut usize,
    total_size_bytes: &mut u64,
) -> Result<()> {
    for entry in fs::read_dir(directory).map_err(|_| Error::Io)? {
        *remaining_entries = remaining_entries
            .checked_sub(1)
            .ok_or(Error::LimitExceeded)?;
        let entry = entry.map_err(|_| Error::Io)?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| Error::Io)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(Error::UnsafePath);
        }
        let relative = path.strip_prefix(root).map_err(|_| Error::UnsafePath)?;
        let relative = relative.to_str().ok_or(Error::UnsafePath)?;

        if metadata.is_dir() {
            // Validate every traversed path, but do not retain directory names:
            // empty hostile topology must not consume path-proportional memory.
            NormalizedPath::new(relative)?;
            discover_directory(root, &path, files, remaining_entries, total_size_bytes)?;
            let after = fs::symlink_metadata(&path).map_err(|_| Error::Io)?;
            if after.file_type().is_symlink()
                || is_reparse_point(&after)
                || !after.is_dir()
                || !same_filesystem_object(&metadata, &after)
            {
                return Err(Error::UnsafePath);
            }
        } else if metadata.is_file() {
            if files.len() == MAX_SOURCE_FILES {
                return Err(Error::LimitExceeded);
            }
            let normalized_path = NormalizedPath::new(relative)?;
            let protected_type = ProtectedType::from_path(&normalized_path)?;
            if metadata.len() > MAX_SINGLE_FILE_BYTES {
                return Err(Error::LimitExceeded);
            }
            *total_size_bytes = total_size_bytes
                .checked_add(metadata.len())
                .filter(|total| *total <= MAX_TOTAL_PLAINTEXT_BYTES)
                .ok_or(Error::LimitExceeded)?;

            let identity = FileIdentity::from_metadata(&metadata)?;
            let mut file = File::open(&path).map_err(|_| Error::Io)?;
            if FileIdentity::from_metadata(&file.metadata().map_err(|_| Error::Io)?)? != identity {
                return Err(Error::InvalidBuilderInput);
            }
            validate_protected_content(&mut file, protected_type, metadata.len())?;
            if FileIdentity::from_metadata(&file.metadata().map_err(|_| Error::Io)?)? != identity
                || FileIdentity::from_metadata(
                    &fs::symlink_metadata(&path).map_err(|_| Error::Io)?,
                )? != identity
            {
                return Err(Error::InvalidBuilderInput);
            }
            files.push(SourceFile {
                source_path: path,
                normalized_path,
                protected_type,
                size_bytes: metadata.len(),
                identity,
            });
        } else {
            return Err(Error::UnsafePath);
        }
    }
    Ok(())
}

fn validate_protected_content(
    file: &mut File,
    protected_type: ProtectedType,
    size: u64,
) -> Result<()> {
    if size == 0 {
        return Ok(());
    }
    match protected_type {
        ProtectedType::Pdf => validate_pdf(file, size),
        ProtectedType::Png => validate_png(file),
        ProtectedType::Jpeg => validate_jpeg(file, size),
        ProtectedType::WebP => validate_webp(file, size),
        ProtectedType::Docx => validate_ooxml(file, size, OoxmlKind::Docx),
        ProtectedType::Xlsx => validate_ooxml(file, size, OoxmlKind::Xlsx),
    }
}

fn validate_pdf(file: &mut File, size: u64) -> Result<()> {
    if size < 12 {
        return Err(Error::UnsupportedFileType);
    }
    let mut prefix = [0_u8; 5];
    read_exact_at(file, 0, &mut prefix)?;
    if &prefix != b"%PDF-" {
        return Err(Error::UnsupportedFileType);
    }
    let tail_len = usize::try_from(size.min(1_024)).map_err(|_| Error::LimitExceeded)?;
    let mut tail = vec![0_u8; tail_len];
    read_exact_at(file, size - tail_len as u64, &mut tail)?;
    if !tail.windows(5).any(|window| window == b"%%EOF") {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

fn validate_png(file: &mut File) -> Result<()> {
    let mut header = [0_u8; 33];
    read_exact_at(file, 0, &mut header)?;
    if header[..8] != *b"\x89PNG\r\n\x1a\n"
        || header[8..12] != 13_u32.to_be_bytes()
        || header[12..16] != *b"IHDR"
        || u32::from_be_bytes(header[16..20].try_into().map_err(|_| Error::Io)?) == 0
        || u32::from_be_bytes(header[20..24].try_into().map_err(|_| Error::Io)?) == 0
    {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

fn validate_jpeg(file: &mut File, size: u64) -> Result<()> {
    if size < 4 {
        return Err(Error::UnsupportedFileType);
    }
    let mut prefix = [0_u8; 3];
    let mut suffix = [0_u8; 2];
    read_exact_at(file, 0, &mut prefix)?;
    read_exact_at(file, size - 2, &mut suffix)?;
    if prefix[0..2] != [0xff, 0xd8] || prefix[2] != 0xff || suffix != [0xff, 0xd9] {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

fn validate_webp(file: &mut File, size: u64) -> Result<()> {
    let mut header = [0_u8; 16];
    read_exact_at(file, 0, &mut header)?;
    let declared = u32::from_le_bytes(header[4..8].try_into().map_err(|_| Error::Io)?) as u64;
    if &header[..4] != b"RIFF"
        || &header[8..12] != b"WEBP"
        || !matches!(&header[12..16], b"VP8 " | b"VP8L" | b"VP8X")
        || declared.checked_add(8) != Some(size)
    {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum OoxmlKind {
    Docx,
    Xlsx,
}

fn validate_ooxml(file: &mut File, size: u64, expected: OoxmlKind) -> Result<()> {
    if size < 22 {
        return Err(Error::UnsupportedFileType);
    }
    let mut local_magic = [0_u8; 4];
    read_exact_at(file, 0, &mut local_magic)?;
    if &local_magic != ZIP_LOCAL_MAGIC {
        return Err(Error::UnsupportedFileType);
    }

    let tail_len =
        usize::try_from(size.min(MAX_PROBE_BYTES as u64)).map_err(|_| Error::LimitExceeded)?;
    let tail_offset = size - tail_len as u64;
    let mut tail = vec![0_u8; tail_len];
    read_exact_at(file, tail_offset, &mut tail)?;
    let eocd_index = tail
        .windows(4)
        .rposition(|window| window == ZIP_EOCD_MAGIC)
        .ok_or(Error::UnsupportedFileType)?;
    if eocd_index + 22 > tail.len() {
        return Err(Error::UnsupportedFileType);
    }
    let eocd = &tail[eocd_index..];
    let disk = le_u16(eocd, 4)?;
    let central_disk = le_u16(eocd, 6)?;
    let disk_entries = le_u16(eocd, 8)?;
    let entries = le_u16(eocd, 10)?;
    let central_size = u64::from(le_u32(eocd, 12)?);
    let central_offset = u64::from(le_u32(eocd, 16)?);
    let comment_len = usize::from(le_u16(eocd, 20)?);
    let eocd_absolute = tail_offset + eocd_index as u64;
    if disk != 0
        || central_disk != 0
        || disk_entries != entries
        || entries == 0
        || eocd_index + 22 + comment_len != tail.len()
        || central_offset.checked_add(central_size) != Some(eocd_absolute)
    {
        return Err(Error::UnsupportedFileType);
    }

    file.seek(SeekFrom::Start(central_offset))
        .map_err(|_| Error::Io)?;
    let mut has_content_types = false;
    let mut has_root_relationships = false;
    let mut has_word_document = false;
    let mut has_excel_workbook = false;
    let mut package_names = HashSet::new();
    let mut consumed = 0_u64;
    for _ in 0..entries {
        let mut header = [0_u8; 46];
        file.read_exact(&mut header)
            .map_err(|_| Error::UnsupportedFileType)?;
        if &header[..4] != ZIP_CENTRAL_MAGIC {
            return Err(Error::UnsupportedFileType);
        }
        let flags = le_u16(&header, 8)?;
        let method = le_u16(&header, 10)?;
        let compressed_size = u64::from(le_u32(&header, 20)?);
        let uncompressed_size = le_u32(&header, 24)?;
        let name_len = usize::from(le_u16(&header, 28)?);
        let extra_len = usize::from(le_u16(&header, 30)?);
        let comment_len = usize::from(le_u16(&header, 32)?);
        let local_offset = u64::from(le_u32(&header, 42)?);
        if flags & 1 != 0
            || !matches!(method, 0 | 8)
            || uncompressed_size == u32::MAX
            || compressed_size == u64::from(u32::MAX)
            || name_len == 0
            || name_len > MAX_OOXML_NAME_BYTES
        {
            return Err(Error::UnsupportedFileType);
        }
        let variable_len = name_len
            .checked_add(extra_len)
            .and_then(|len| len.checked_add(comment_len))
            .ok_or(Error::LimitExceeded)?;
        consumed = consumed
            .checked_add(46 + variable_len as u64)
            .ok_or(Error::LimitExceeded)?;
        if consumed > central_size {
            return Err(Error::UnsupportedFileType);
        }
        let mut name = vec![0_u8; name_len];
        file.read_exact(&mut name)
            .map_err(|_| Error::UnsupportedFileType)?;
        file.seek(SeekFrom::Current(
            i64::try_from(extra_len + comment_len).map_err(|_| Error::LimitExceeded)?,
        ))
        .map_err(|_| Error::Io)?;
        let name = std::str::from_utf8(&name).map_err(|_| Error::UnsupportedFileType)?;
        let normalized = name.replace('\\', "/").to_ascii_lowercase();
        if normalized.contains('\0')
            || normalized.starts_with('/')
            || normalized.split('/').any(|part| part == "..")
        {
            return Err(Error::UnsupportedFileType);
        }
        if !package_names.insert(normalized.clone()) {
            return Err(Error::UnsupportedFileType);
        }
        let central_resume = file.stream_position().map_err(|_| Error::Io)?;
        validate_local_zip_entry(
            file,
            local_offset,
            central_offset,
            flags,
            method,
            compressed_size,
            name.as_bytes(),
        )?;
        file.seek(SeekFrom::Start(central_resume))
            .map_err(|_| Error::Io)?;
        match normalized.as_str() {
            "[content_types].xml" => has_content_types = true,
            "_rels/.rels" => has_root_relationships = true,
            "word/document.xml" => has_word_document = true,
            "xl/workbook.xml" => has_excel_workbook = true,
            _ => {}
        }
        if is_macro_payload(&normalized) {
            return Err(Error::UnsupportedFileType);
        }
    }
    if consumed != central_size || !has_content_types || !has_root_relationships {
        return Err(Error::UnsupportedFileType);
    }
    match expected {
        OoxmlKind::Docx if has_word_document && !has_excel_workbook => {}
        OoxmlKind::Xlsx if has_excel_workbook && !has_word_document => {}
        _ => return Err(Error::UnsupportedFileType),
    }
    validate_ooxml_content_types(file, expected)
}

fn validate_ooxml_content_types(file: &File, expected: OoxmlKind) -> Result<()> {
    let reader = file.try_clone().map_err(|_| Error::Io)?;
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| Error::UnsupportedFileType)?;
    let content_types = archive
        .by_name("[Content_Types].xml")
        .map_err(|_| Error::UnsupportedFileType)?;
    if content_types.size() > MAX_CONTENT_TYPES_BYTES {
        return Err(Error::UnsupportedFileType);
    }
    let mut bytes = Vec::with_capacity(content_types.size() as usize);
    content_types
        .take(MAX_CONTENT_TYPES_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::UnsupportedFileType)?;
    if bytes.len() as u64 > MAX_CONTENT_TYPES_BYTES {
        return Err(Error::UnsupportedFileType);
    }
    validate_content_types_xml(&bytes, expected)
}

fn validate_content_types_xml(bytes: &[u8], expected: OoxmlKind) -> Result<()> {
    let (expected_part, expected_type) = match expected {
        OoxmlKind::Docx => (
            "/word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        OoxmlKind::Xlsx => (
            "/xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ),
    };
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut depth = 0_usize;
    let mut saw_root = false;
    let mut root_closed = false;
    let mut found_main = false;
    let mut events = 0_usize;

    loop {
        events = events.checked_add(1).ok_or(Error::LimitExceeded)?;
        if events > MAX_CONTENT_TYPES_BYTES as usize {
            return Err(Error::LimitExceeded);
        }
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| Error::UnsupportedFileType)?
        {
            Event::Start(element) => {
                if depth == 0 {
                    if saw_root || root_closed || element.name().as_ref() != "Types" {
                        return Err(Error::UnsupportedFileType);
                    }
                    saw_root = true;
                } else if depth == 1 && element.name().as_ref() == "Override" {
                    validate_override(&element, expected_part, expected_type, &mut found_main)?;
                }
                depth = depth.checked_add(1).ok_or(Error::LimitExceeded)?;
                if depth > 64 {
                    return Err(Error::LimitExceeded);
                }
            }
            Event::Empty(element) => {
                if depth == 0 {
                    return Err(Error::UnsupportedFileType);
                }
                if depth == 1 && element.name().as_ref() == "Override" {
                    validate_override(&element, expected_part, expected_type, &mut found_main)?;
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or(Error::UnsupportedFileType)?;
                if depth == 0 {
                    root_closed = true;
                }
            }
            Event::DocType(_) | Event::GeneralRef(_) => {
                return Err(Error::UnsupportedFileType);
            }
            Event::Eof => break,
            Event::Decl(_) if saw_root || root_closed || depth != 0 => {
                return Err(Error::UnsupportedFileType);
            }
            Event::Text(text) if depth == 0 && !text.as_ref().is_empty() => {
                return Err(Error::UnsupportedFileType);
            }
            Event::PI(_) => return Err(Error::UnsupportedFileType),
            Event::Text(_) | Event::CData(_) | Event::Comment(_) | Event::Decl(_) => {}
        }
        buffer.clear();
    }

    if !saw_root || !root_closed || depth != 0 || !found_main {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

fn validate_override(
    element: &quick_xml::events::BytesStart<'_>,
    expected_part: &str,
    expected_type: &str,
    found_main: &mut bool,
) -> Result<()> {
    let mut part_name = None;
    let mut content_type = None;
    let mut attributes = element.attributes();
    attributes.with_checks(true);
    for attribute in attributes {
        let attribute = attribute.map_err(|_| Error::UnsupportedFileType)?;
        match attribute.key.as_ref() {
            "PartName" if part_name.is_none() => part_name = Some(attribute.value),
            "ContentType" if content_type.is_none() => content_type = Some(attribute.value),
            "PartName" | "ContentType" => return Err(Error::UnsupportedFileType),
            _ => {}
        }
    }
    if part_name.as_deref() == Some(expected_part) {
        if *found_main || content_type.as_deref() != Some(expected_type) {
            return Err(Error::UnsupportedFileType);
        }
        *found_main = true;
    }
    Ok(())
}

fn validate_local_zip_entry(
    file: &mut File,
    local_offset: u64,
    central_offset: u64,
    central_flags: u16,
    central_method: u16,
    compressed_size: u64,
    central_name: &[u8],
) -> Result<()> {
    let mut header = [0_u8; 30];
    read_exact_at(file, local_offset, &mut header)?;
    if &header[..4] != ZIP_LOCAL_MAGIC
        || le_u16(&header, 6)? != central_flags
        || le_u16(&header, 8)? != central_method
    {
        return Err(Error::UnsupportedFileType);
    }
    let name_len = usize::from(le_u16(&header, 26)?);
    let extra_len = usize::from(le_u16(&header, 28)?);
    if name_len != central_name.len() || name_len > MAX_OOXML_NAME_BYTES {
        return Err(Error::UnsupportedFileType);
    }
    let data_offset = local_offset
        .checked_add(30)
        .and_then(|offset| offset.checked_add(name_len as u64))
        .and_then(|offset| offset.checked_add(extra_len as u64))
        .ok_or(Error::LimitExceeded)?;
    if !matches!(
        data_offset.checked_add(compressed_size),
        Some(end) if end <= central_offset
    ) {
        return Err(Error::UnsupportedFileType);
    }
    let mut local_name = vec![0_u8; name_len];
    read_exact_at(file, local_offset + 30, &mut local_name)?;
    if local_name != central_name {
        return Err(Error::UnsupportedFileType);
    }
    Ok(())
}

fn is_macro_payload(name: &str) -> bool {
    let leaf = name.rsplit('/').next().unwrap_or(name);
    matches!(leaf, "vbaproject.bin" | "vbadata.xml")
        || name.starts_with("xl/macrosheets/")
        || name.starts_with("xl/dialogsheets/")
}

fn read_exact_at(file: &mut File, offset: u64, buffer: &mut [u8]) -> Result<()> {
    file.seek(SeekFrom::Start(offset)).map_err(|_| Error::Io)?;
    file.read_exact(buffer)
        .map_err(|_| Error::UnsupportedFileType)
}

fn le_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or(Error::UnsupportedFileType)?;
    Ok(u16::from_le_bytes(
        value.try_into().map_err(|_| Error::UnsupportedFileType)?,
    ))
}

fn le_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or(Error::UnsupportedFileType)?;
    Ok(u32::from_le_bytes(
        value.try_into().map_err(|_| Error::UnsupportedFileType)?,
    ))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

#[cfg(unix)]
fn same_filesystem_object(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_filesystem_object(left: &Metadata, right: &Metadata) -> bool {
    left.file_type() == right.file_type()
        && left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Cursor, Write},
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("solarch-source-test-{}-{id}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn write(&self, relative: &str, bytes: &[u8]) {
            let path = self.0.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, bytes).unwrap();
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn minimal_pdf() -> &'static [u8] {
        b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
    }

    #[test]
    fn discovers_recursively_and_sorts_normalized_utf8_bytes() {
        let dir = TestDir::new();
        dir.write("z.pdf", minimal_pdf());
        dir.write("nested/a.PDF", minimal_pdf());
        let inventory = SourceInventory::discover(&dir.0).unwrap();
        let paths: Vec<_> = inventory
            .files()
            .iter()
            .map(|file| file.normalized_path().as_str())
            .collect();
        assert_eq!(paths, ["nested/a.PDF", "z.pdf"]);
        assert_eq!(
            inventory.total_size_bytes(),
            (minimal_pdf().len() * 2) as u64
        );
        assert!(inventory.files()[0].open_verified().is_ok());
    }

    #[test]
    fn rejects_extension_spoofing_and_empty_inventory() {
        let empty = TestDir::new();
        assert!(matches!(
            SourceInventory::discover(&empty.0),
            Err(Error::InvalidBuilderInput)
        ));
        let spoofed = TestDir::new();
        spoofed.write("payload.pdf", b"MZ executable");
        assert!(matches!(
            SourceInventory::discover(&spoofed.0),
            Err(Error::UnsupportedFileType)
        ));
    }

    #[test]
    fn accepts_explicit_zero_byte_exception_for_every_supported_extension() {
        for extension in ["pdf", "png", "jpg", "webp", "docx", "xlsx"] {
            let dir = TestDir::new();
            dir.write(&format!("empty.{extension}"), b"");
            let inventory = SourceInventory::discover(&dir.0).unwrap();
            assert_eq!(inventory.files().len(), 1, "extension {extension}");
            assert_eq!(
                inventory.files()[0].size_bytes(),
                0,
                "extension {extension}"
            );
            assert!(inventory.files()[0].open_verified().is_ok());
        }
    }

    #[test]
    fn traversal_entry_budget_fails_closed_without_per_directory_collection() {
        let dir = TestDir::new();
        for name in ["one", "two", "three", "four"] {
            fs::create_dir(dir.0.join(name)).unwrap();
        }
        assert_eq!(
            SourceInventory::discover_with_entry_limit(&dir.0, 3).unwrap_err(),
            Error::LimitExceeded
        );
    }

    #[test]
    fn empty_directory_topology_is_not_retained_in_collision_state() {
        let dir = TestDir::new();
        for index in 0..512 {
            fs::create_dir(dir.0.join(format!("unused-{index:04}"))).unwrap();
        }
        dir.write("content.pdf", minimal_pdf());
        let inventory = SourceInventory::discover(&dir.0).unwrap();
        assert_eq!(inventory.files().len(), 1);
        assert_eq!(
            inventory.files()[0].normalized_path().as_str(),
            "content.pdf"
        );
    }

    #[test]
    fn detects_replacement_after_discovery() {
        let dir = TestDir::new();
        dir.write("a.pdf", minimal_pdf());
        let inventory = SourceInventory::discover(&dir.0).unwrap();
        let mut replacement = File::create(dir.0.join("a.pdf")).unwrap();
        replacement.write_all(b"different bytes").unwrap();
        replacement.sync_all().unwrap();
        assert!(matches!(
            inventory.files()[0].open_verified(),
            Err(Error::InvalidBuilderInput)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_sources() {
        use std::os::unix::fs::symlink;
        let dir = TestDir::new();
        dir.write("target.pdf", minimal_pdf());
        symlink(dir.0.join("target.pdf"), dir.0.join("link.pdf")).unwrap();
        assert!(matches!(
            SourceInventory::discover(&dir.0),
            Err(Error::UnsafePath)
        ));
    }

    #[test]
    fn recognizes_ooxml_kind_and_rejects_macro_payload() {
        let dir = TestDir::new();
        dir.write(
            "valid.docx",
            &stored_zip(&["[Content_Types].xml", "_rels/.rels", "word/document.xml"]),
        );
        let inventory = SourceInventory::discover(&dir.0).unwrap();
        assert_eq!(inventory.files()[0].protected_type(), ProtectedType::Docx);

        let macro_dir = TestDir::new();
        macro_dir.write(
            "macro.docx",
            &stored_zip(&[
                "[Content_Types].xml",
                "_rels/.rels",
                "word/document.xml",
                "word/vbaProject.bin",
            ]),
        );
        assert!(matches!(
            SourceInventory::discover(&macro_dir.0),
            Err(Error::UnsupportedFileType)
        ));
    }

    #[test]
    fn ooxml_content_types_require_parsed_exact_main_override() {
        let names = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];
        let approved =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

        let commented = TestDir::new();
        commented.write(
            "commented.docx",
            &stored_zip_with_content_types(
                &names,
                &format!(
                    "<Types><!-- <Override PartName=\"/word/document.xml\" ContentType=\"{approved}\"/> --></Types>"
                ),
            ),
        );
        assert_eq!(
            SourceInventory::discover(&commented.0).unwrap_err(),
            Error::UnsupportedFileType
        );

        let entity = TestDir::new();
        entity.write(
            "entity.docx",
            &stored_zip_with_content_types(
                &names,
                &format!(
                    "<!DOCTYPE Types [<!ENTITY main \"{approved}\">]><Types><Override PartName=\"/word/document.xml\" ContentType=\"&main;\"/></Types>"
                ),
            ),
        );
        assert_eq!(
            SourceInventory::discover(&entity.0).unwrap_err(),
            Error::UnsupportedFileType
        );

        let macro_enabled = TestDir::new();
        macro_enabled.write(
            "macro-spoof.docx",
            &stored_zip_with_content_types(
                &names,
                "<Types><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.ms-word.document.macroEnabled.main+xml\"/></Types>",
            ),
        );
        assert_eq!(
            SourceInventory::discover(&macro_enabled.0).unwrap_err(),
            Error::UnsupportedFileType
        );

        let duplicate_attribute = TestDir::new();
        duplicate_attribute.write(
            "duplicate-attribute.docx",
            &stored_zip_with_content_types(
                &names,
                &format!(
                    "<Types><Override PartName=\"/word/document.xml\" ContentType=\"{approved}\" Attacker=\"one\" Attacker=\"two\"/></Types>"
                ),
            ),
        );
        assert_eq!(
            SourceInventory::discover(&duplicate_attribute.0).unwrap_err(),
            Error::UnsupportedFileType
        );
    }

    fn stored_zip(names: &[&str]) -> Vec<u8> {
        let (main_path, main_type) = if names.contains(&"word/document.xml") {
            (
                "/word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            )
        } else {
            (
                "/xl/workbook.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            )
        };
        stored_zip_with_content_types(
            names,
            &format!(
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"{main_path}\" ContentType=\"{main_type}\"/></Types>"
            ),
        )
    }

    fn stored_zip_with_content_types(names: &[&str], content_types: &str) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut archive = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for name in names {
            archive.start_file(*name, options).unwrap();
            if *name == "[Content_Types].xml" {
                archive.write_all(content_types.as_bytes()).unwrap();
            }
        }
        archive.finish().unwrap().into_inner()
    }
}
