use std::{
    collections::HashSet,
    io::{Cursor, Read},
};

use calamine::{open_workbook_from_rs, Data, Reader as _, Xlsx};
use image::{ImageFormat, ImageReader};
use quick_xml::{escape::unescape, events::Event, Reader, XmlVersion};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;
use zip::ZipArchive;

use crate::error::ViewerError;

pub const PDF_RANGE_BYTES: u64 = 256 * 1024;
pub const MAX_IMAGE_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 16_777_216;
pub const MAX_IMAGE_RGBA_BYTES: u64 = MAX_IMAGE_PIXELS * 4;
pub const MAX_OOXML_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_OOXML_ENTRIES: usize = 2_048;
const MAX_OOXML_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_OOXML_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 128;
const MAX_DOCX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_DOCX_BLOCKS: usize = 10_000;
const MAX_DOCX_RUNS: usize = 100_000;
const MAX_DOCX_TABLE_CELLS: usize = 20_000;
const MAX_XLSX_SHEETS: usize = 64;
const MAX_XLSX_CELLS_PER_SHEET: usize = 200_000;
const MAX_XLSX_RANGE_AREA: usize = 1_000_000;
pub const MAX_XLSX_WINDOW_ROWS: u32 = 100;
pub const MAX_XLSX_WINDOW_COLUMNS: u32 = 50;
const MAX_CELL_TEXT_BYTES: usize = 4_096;
const DOCX_MAIN_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const XLSX_MAIN_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

pub const PDF_MIME: &str = "application/pdf";
pub const PNG_MIME: &str = "image/png";
pub const JPEG_MIME: &str = "image/jpeg";
pub const WEBP_MIME: &str = "image/webp";
pub const DOCX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
pub const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RendererKind {
    Pdf,
    Image,
    Docx,
    Xlsx,
}

pub enum RendererState {
    Pdf,
    Image {
        sanitized_png: Zeroizing<Vec<u8>>,
    },
    Docx,
    Xlsx {
        workbook: Zeroizing<Vec<u8>>,
        sheets: Vec<XlsxSheetDto>,
    },
}

impl RendererState {
    fn kind(&self) -> RendererKind {
        match self {
            Self::Pdf => RendererKind::Pdf,
            Self::Image { .. } => RendererKind::Image,
            Self::Docx => RendererKind::Docx,
            Self::Xlsx { .. } => RendererKind::Xlsx,
        }
    }
}

pub struct OpenRenderer {
    pub handle: String,
    pub file_id: String,
    pub size_bytes: u64,
    pub state: RendererState,
}

pub struct RendererRegistry {
    session_serial: u64,
    next_request: u64,
    pending: Option<PendingRenderer>,
    current: Option<OpenRenderer>,
}

struct PendingRenderer {
    request_id: String,
    request_serial: u64,
    file_id: String,
    kind: RendererKind,
}

impl RendererRegistry {
    pub fn new(session_serial: u64) -> Self {
        Self {
            session_serial,
            next_request: 0,
            pending: None,
            current: None,
        }
    }

    pub fn begin(&mut self, file_id: &str, kind: RendererKind) -> Result<String, ViewerError> {
        self.next_request = self
            .next_request
            .checked_add(1)
            .ok_or(ViewerError::Internal)?;
        let request_id = format!(
            "open_{:016x}_{:016x}",
            self.session_serial, self.next_request
        );
        self.current = None;
        self.pending = Some(PendingRenderer {
            request_id: request_id.clone(),
            request_serial: self.next_request,
            file_id: file_id.to_owned(),
            kind,
        });
        Ok(request_id)
    }

    pub fn pending_file(
        &self,
        request_id: &str,
        kind: RendererKind,
    ) -> Result<String, ViewerError> {
        self.pending
            .as_ref()
            .filter(|pending| pending.request_id == request_id && pending.kind == kind)
            .map(|pending| pending.file_id.clone())
            .ok_or(ViewerError::RendererClosed)
    }

    pub fn complete(
        &mut self,
        request_id: &str,
        size_bytes: u64,
        state: RendererState,
    ) -> Result<String, ViewerError> {
        let pending = self
            .pending
            .as_ref()
            .filter(|pending| pending.request_id == request_id && pending.kind == state.kind())
            .ok_or(ViewerError::RendererClosed)?;
        let handle = format!(
            "view_{:016x}_{:016x}",
            self.session_serial, pending.request_serial
        );
        let file_id = pending.file_id.clone();
        self.pending = None;
        self.current = Some(OpenRenderer {
            handle: handle.clone(),
            file_id,
            size_bytes,
            state,
        });
        Ok(handle)
    }

    pub fn cancel(&mut self, request_id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.request_id == request_id)
        {
            self.pending = None;
        }
    }

    pub fn get(&self, handle: &str, kind: RendererKind) -> Result<&OpenRenderer, ViewerError> {
        self.current
            .as_ref()
            .filter(|open| open.handle == handle && open.state.kind() == kind)
            .ok_or(ViewerError::RendererClosed)
    }

    pub fn close(&mut self, handle: &str) -> Result<(), ViewerError> {
        match &self.current {
            Some(open) if open.handle == handle => {
                self.current = None;
                Ok(())
            }
            _ => Err(ViewerError::RendererClosed),
        }
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.current.is_none() && self.pending.is_none()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererOpenRequestDto {
    pub request_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOpenDto {
    pub handle: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOpenDto {
    pub handle: String,
    pub width: u32,
    pub height: u32,
    pub mime_type: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxOpenDto {
    pub handle: String,
    pub blocks: Vec<DocxBlockDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocxBlockDto {
    Paragraph {
        style: DocxParagraphStyle,
        runs: Vec<DocxRunDto>,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DocxParagraphStyle {
    Normal,
    Heading,
    List,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxRunDto {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxOpenDto {
    pub handle: String,
    pub sheets: Vec<XlsxSheetDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxSheetDto {
    pub name: String,
    pub row_count: u32,
    pub column_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxWindowDto {
    pub sheet_index: u32,
    pub row_offset: u32,
    pub column_offset: u32,
    pub row_count: u32,
    pub column_count: u32,
    pub cells: Vec<XlsxCellDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxCellDto {
    pub row: u32,
    pub column: u32,
    pub display_value: String,
}

pub fn validate_pdf_open(prefix: &[u8], tail: &[u8], size_bytes: u64) -> Result<(), ViewerError> {
    if size_bytes < 12
        || !prefix.starts_with(b"%PDF-")
        || !tail.windows(5).any(|window| window == b"%%EOF")
    {
        return Err(ViewerError::RendererError);
    }
    Ok(())
}

pub fn decode_image(bytes: &[u8], expected_mime: &str) -> Result<(u32, u32, Vec<u8>), ViewerError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_SOURCE_BYTES {
        return Err(ViewerError::RendererLimit);
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| ViewerError::RendererError)?;
    let expected = match expected_mime {
        PNG_MIME => ImageFormat::Png,
        JPEG_MIME => ImageFormat::Jpeg,
        WEBP_MIME => ImageFormat::WebP,
        _ => return Err(ViewerError::UnsupportedFile),
    };
    if reader.format() != Some(expected) {
        return Err(ViewerError::RendererError);
    }
    let (width, height) = reader.into_dimensions().map_err(map_image_error)?;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or(ViewerError::RendererLimit)?;
    if width == 0 || height == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err(ViewerError::RendererLimit);
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), expected);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(u32::try_from(MAX_IMAGE_PIXELS).unwrap_or(u32::MAX));
    limits.max_image_height = Some(u32::try_from(MAX_IMAGE_PIXELS).unwrap_or(u32::MAX));
    limits.max_alloc = Some(MAX_IMAGE_RGBA_BYTES);
    reader.limits(limits);
    let decoded = reader.decode().map_err(map_image_error)?;
    let mut output = Cursor::new(Vec::new());
    decoded
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| ViewerError::RendererError)?;
    let output = output.into_inner();
    if output.len() as u64 > MAX_IMAGE_RGBA_BYTES {
        return Err(ViewerError::RendererLimit);
    }
    Ok((width, height, output))
}

fn map_image_error(error: image::ImageError) -> ViewerError {
    if matches!(error, image::ImageError::Limits(_)) {
        ViewerError::RendererLimit
    } else {
        ViewerError::RendererError
    }
}

pub fn parse_docx(bytes: &[u8]) -> Result<Vec<DocxBlockDto>, ViewerError> {
    let inventory = preflight_ooxml(bytes, OoxmlKind::Docx)?;
    if !inventory.names.contains("word/document.xml") {
        return Err(ViewerError::RendererError);
    }
    let document = read_zip_entry(bytes, "word/document.xml", MAX_OOXML_ENTRY_BYTES)?;
    parse_docx_document(&document)
}

pub fn inspect_xlsx(bytes: &[u8]) -> Result<Vec<XlsxSheetDto>, ViewerError> {
    preflight_ooxml(bytes, OoxmlKind::Xlsx)?;
    let mut workbook: Xlsx<_> =
        open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| ViewerError::RendererError)?;
    let names = workbook.sheet_names();
    if names.is_empty() || names.len() > MAX_XLSX_SHEETS {
        return Err(ViewerError::RendererLimit);
    }
    let mut sheets = Vec::with_capacity(names.len());
    for name in names {
        if name.len() > 255 {
            return Err(ViewerError::RendererLimit);
        }
        let range = workbook
            .worksheet_range(&name)
            .map_err(|_| ViewerError::RendererError)?;
        let (row_count, column_count) = range_dimensions(&range)?;
        sheets.push(XlsxSheetDto {
            name,
            row_count,
            column_count,
        });
    }
    Ok(sheets)
}

pub fn read_xlsx_window(
    bytes: &[u8],
    sheets: &[XlsxSheetDto],
    sheet_index: u32,
    row_offset: u32,
    row_count: u32,
    column_offset: u32,
    column_count: u32,
) -> Result<XlsxWindowDto, ViewerError> {
    if row_count == 0
        || column_count == 0
        || row_count > MAX_XLSX_WINDOW_ROWS
        || column_count > MAX_XLSX_WINDOW_COLUMNS
    {
        return Err(ViewerError::InvalidInput);
    }
    let sheet = sheets
        .get(usize::try_from(sheet_index).map_err(|_| ViewerError::InvalidInput)?)
        .ok_or(ViewerError::InvalidInput)?;
    let row_end = row_offset
        .checked_add(row_count)
        .ok_or(ViewerError::InvalidInput)?
        .min(sheet.row_count);
    let column_end = column_offset
        .checked_add(column_count)
        .ok_or(ViewerError::InvalidInput)?
        .min(sheet.column_count);
    let mut workbook: Xlsx<_> =
        open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| ViewerError::RendererError)?;
    let range = workbook
        .worksheet_range(&sheet.name)
        .map_err(|_| ViewerError::RendererError)?;
    let mut cells = Vec::new();
    for row in row_offset..row_end {
        for column in column_offset..column_end {
            let Some(value) = range.get_value((row, column)) else {
                continue;
            };
            let display_value = display_cell(value)?;
            if !display_value.is_empty() {
                cells.push(XlsxCellDto {
                    row,
                    column,
                    display_value,
                });
            }
        }
    }
    Ok(XlsxWindowDto {
        sheet_index,
        row_offset,
        column_offset,
        row_count: row_end.saturating_sub(row_offset),
        column_count: column_end.saturating_sub(column_offset),
        cells,
    })
}

fn range_dimensions(range: &calamine::Range<Data>) -> Result<(u32, u32), ViewerError> {
    let Some((last_row, last_column)) = range.end() else {
        return Ok((0, 0));
    };
    let rows = last_row.checked_add(1).ok_or(ViewerError::RendererLimit)?;
    let columns = last_column
        .checked_add(1)
        .ok_or(ViewerError::RendererLimit)?;
    let area = usize::try_from(rows)
        .ok()
        .and_then(|rows| {
            usize::try_from(columns)
                .ok()
                .and_then(|cols| rows.checked_mul(cols))
        })
        .ok_or(ViewerError::RendererLimit)?;
    if area > MAX_XLSX_RANGE_AREA {
        return Err(ViewerError::RendererLimit);
    }
    Ok((rows, columns))
}

fn display_cell(value: &Data) -> Result<String, ViewerError> {
    let value = match value {
        Data::Empty => String::new(),
        Data::String(value) | Data::DateTimeIso(value) | Data::DurationIso(value) => value.clone(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) if value.is_finite() => value.to_string(),
        Data::Float(_) => return Err(ViewerError::RendererError),
        Data::Bool(value) => {
            if *value {
                "TRUE".to_owned()
            } else {
                "FALSE".to_owned()
            }
        }
        Data::DateTime(value) => value.to_string(),
        Data::Error(value) => value.to_string(),
    };
    if value.len() > MAX_CELL_TEXT_BYTES {
        return Err(ViewerError::RendererLimit);
    }
    Ok(value)
}

#[derive(Clone, Copy)]
enum OoxmlKind {
    Docx,
    Xlsx,
}

struct PackageInventory {
    names: HashSet<String>,
}

fn preflight_ooxml(bytes: &[u8], kind: OoxmlKind) -> Result<PackageInventory, ViewerError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_OOXML_SOURCE_BYTES {
        return Err(ViewerError::RendererLimit);
    }
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| ViewerError::RendererError)?;
    if archive.is_empty() || archive.len() > MAX_OOXML_ENTRIES {
        return Err(ViewerError::RendererLimit);
    }
    let mut expanded = 0_u64;
    let mut names = HashSet::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| ViewerError::RendererError)?;
        if entry.encrypted()
            || entry.size() > MAX_OOXML_ENTRY_BYTES
            || entry.enclosed_name().is_none()
        {
            return Err(ViewerError::RendererLimit);
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or(ViewerError::RendererLimit)?;
        if expanded > MAX_OOXML_EXPANDED_BYTES {
            return Err(ViewerError::RendererLimit);
        }
        let name = entry.name().replace('\\', "/").to_ascii_lowercase();
        if name.starts_with('/')
            || name.split('/').any(|part| part == "..")
            || !names.insert(name.clone())
            || is_macro_payload(&name)
        {
            return Err(ViewerError::RendererError);
        }
        if matches!(kind, OoxmlKind::Xlsx)
            && (name.starts_with("xl/externallinks/") || name.starts_with("xl/connections"))
        {
            return Err(ViewerError::RendererError);
        }
        if name.ends_with(".xml") || name.ends_with(".rels") {
            let mut xml = Vec::with_capacity(entry.size() as usize);
            entry
                .take(MAX_OOXML_ENTRY_BYTES + 1)
                .read_to_end(&mut xml)
                .map_err(|_| ViewerError::RendererError)?;
            validate_xml_safety(&xml)?;
            if matches!(kind, OoxmlKind::Xlsx)
                && name.ends_with(".rels")
                && has_external_relationship(&xml)?
            {
                return Err(ViewerError::RendererError);
            }
            if matches!(kind, OoxmlKind::Xlsx) && name.starts_with("xl/worksheets/") {
                validate_worksheet_shape(&xml)?;
            }
        }
    }
    if !names.contains("[content_types].xml") {
        return Err(ViewerError::RendererError);
    }
    validate_content_types(bytes, kind)?;
    Ok(PackageInventory { names })
}

fn validate_content_types(bytes: &[u8], kind: OoxmlKind) -> Result<(), ViewerError> {
    let xml = read_zip_entry(bytes, "[Content_Types].xml", MAX_OOXML_ENTRY_BYTES)?;
    let (expected_part, expected_type) = match kind {
        OoxmlKind::Docx => ("/word/document.xml", DOCX_MAIN_CONTENT_TYPE),
        OoxmlKind::Xlsx => ("/xl/workbook.xml", XLSX_MAIN_CONTENT_TYPE),
    };
    let mut reader = Reader::from_reader(xml.as_slice());
    let mut buffer = Vec::new();
    let mut main_overrides = 0_usize;
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| ViewerError::RendererError)?
        {
            Event::Start(element) | Event::Empty(element)
                if local_name(element.name().as_ref()) == "Override" =>
            {
                let part_name =
                    attribute_value(&element, "PartName")?.ok_or(ViewerError::RendererError)?;
                let content_type =
                    attribute_value(&element, "ContentType")?.ok_or(ViewerError::RendererError)?;
                if content_type.to_ascii_lowercase().contains("macroenabled")
                    || content_type.to_ascii_lowercase().contains("vba")
                {
                    return Err(ViewerError::RendererError);
                }
                if part_name == expected_part {
                    if content_type != expected_type {
                        return Err(ViewerError::RendererError);
                    }
                    main_overrides = main_overrides
                        .checked_add(1)
                        .ok_or(ViewerError::RendererLimit)?;
                }
            }
            Event::DocType(_) | Event::PI(_) | Event::GeneralRef(_) => {
                return Err(ViewerError::RendererError);
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    if main_overrides != 1 {
        return Err(ViewerError::RendererError);
    }
    Ok(())
}

fn has_external_relationship(bytes: &[u8]) -> Result<bool, ViewerError> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| ViewerError::RendererError)?
        {
            Event::Start(element) | Event::Empty(element)
                if local_name(element.name().as_ref()) == "Relationship" =>
            {
                if attribute_value(&element, "TargetMode")?
                    .is_some_and(|value| value.eq_ignore_ascii_case("External"))
                {
                    return Ok(true);
                }
            }
            Event::DocType(_) | Event::PI(_) | Event::GeneralRef(_) => {
                return Err(ViewerError::RendererError);
            }
            Event::Eof => return Ok(false),
            _ => {}
        }
        buffer.clear();
    }
}

fn validate_xml_safety(bytes: &[u8]) -> Result<(), ViewerError> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut depth = 0_usize;
    let mut events = 0_usize;
    loop {
        events = events.checked_add(1).ok_or(ViewerError::RendererLimit)?;
        if events > bytes.len().saturating_mul(2).saturating_add(1) {
            return Err(ViewerError::RendererLimit);
        }
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| ViewerError::RendererError)?
        {
            Event::Start(element) => {
                validate_attributes(&element)?;
                depth = depth.checked_add(1).ok_or(ViewerError::RendererLimit)?;
                if depth > MAX_XML_DEPTH {
                    return Err(ViewerError::RendererLimit);
                }
            }
            Event::Empty(element) => validate_attributes(&element)?,
            Event::End(_) => depth = depth.checked_sub(1).ok_or(ViewerError::RendererError)?,
            Event::DocType(_) | Event::PI(_) => return Err(ViewerError::RendererError),
            Event::GeneralRef(reference) => validate_general_reference(reference.as_ref())?,
            Event::Eof => break,
            Event::Decl(_) | Event::Text(_) | Event::CData(_) | Event::Comment(_) => {}
        }
        buffer.clear();
    }
    if depth != 0 {
        return Err(ViewerError::RendererError);
    }
    Ok(())
}

fn validate_attributes(element: &quick_xml::events::BytesStart<'_>) -> Result<(), ViewerError> {
    let mut attributes = element.attributes();
    attributes.with_checks(true);
    for attribute in attributes {
        attribute
            .map_err(|_| ViewerError::RendererError)?
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|_| ViewerError::RendererError)?;
    }
    Ok(())
}

fn validate_general_reference(reference: &str) -> Result<(), ViewerError> {
    let wrapped = format!("&{reference};");
    unescape(&wrapped).map_err(|_| ViewerError::RendererError)?;
    Ok(())
}

fn validate_worksheet_shape(bytes: &[u8]) -> Result<(), ViewerError> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut cells = 0_usize;
    let mut max_row = 0_usize;
    let mut max_column = 0_usize;
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| ViewerError::RendererError)?
        {
            Event::Start(element) | Event::Empty(element)
                if local_name(element.name().as_ref()) == "c" =>
            {
                let reference =
                    attribute_value(&element, "r")?.ok_or(ViewerError::RendererError)?;
                let (row, column) = parse_cell_reference(&reference)?;
                cells = cells.checked_add(1).ok_or(ViewerError::RendererLimit)?;
                max_row = max_row.max(row);
                max_column = max_column.max(column);
                if cells > MAX_XLSX_CELLS_PER_SHEET
                    || max_row
                        .checked_mul(max_column)
                        .ok_or(ViewerError::RendererLimit)?
                        > MAX_XLSX_RANGE_AREA
                {
                    return Err(ViewerError::RendererLimit);
                }
            }
            Event::DocType(_) | Event::PI(_) => return Err(ViewerError::RendererError),
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(())
}

fn parse_cell_reference(value: &str) -> Result<(usize, usize), ViewerError> {
    let split = value
        .find(|character: char| character.is_ascii_digit())
        .ok_or(ViewerError::RendererError)?;
    let (column, row) = value.split_at(split);
    if column.is_empty() || row.is_empty() || !column.bytes().all(|byte| byte.is_ascii_alphabetic())
    {
        return Err(ViewerError::RendererError);
    }
    let column = column.bytes().try_fold(0_usize, |value, byte| {
        value
            .checked_mul(26)
            .and_then(|value| value.checked_add(usize::from(byte.to_ascii_uppercase() - b'A' + 1)))
            .ok_or(ViewerError::RendererLimit)
    })?;
    let row = row
        .parse::<usize>()
        .map_err(|_| ViewerError::RendererError)?;
    if row == 0 || row > 1_048_576 || column == 0 || column > 16_384 {
        return Err(ViewerError::RendererLimit);
    }
    Ok((row, column))
}

fn read_zip_entry(bytes: &[u8], name: &str, maximum: u64) -> Result<Vec<u8>, ViewerError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| ViewerError::RendererError)?;
    let entry = archive
        .by_name(name)
        .map_err(|_| ViewerError::RendererError)?;
    if entry.size() > maximum {
        return Err(ViewerError::RendererLimit);
    }
    let mut output = Vec::with_capacity(entry.size() as usize);
    entry
        .take(maximum + 1)
        .read_to_end(&mut output)
        .map_err(|_| ViewerError::RendererError)?;
    if output.len() as u64 > maximum {
        return Err(ViewerError::RendererLimit);
    }
    Ok(output)
}

fn parse_docx_document(bytes: &[u8]) -> Result<Vec<DocxBlockDto>, ViewerError> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut blocks = Vec::new();
    let mut paragraph: Option<ParagraphBuilder> = None;
    let mut run: Option<DocxRunDto> = None;
    let mut in_text = false;
    let mut table: Option<Vec<Vec<String>>> = None;
    let mut row: Option<Vec<String>> = None;
    let mut cell: Option<String> = None;
    let mut depth = 0_usize;
    let mut text_bytes = 0_usize;
    let mut run_count = 0_usize;
    let mut table_cells = 0_usize;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| ViewerError::RendererError)?
        {
            Event::Start(element) => {
                validate_attributes(&element)?;
                depth = depth.checked_add(1).ok_or(ViewerError::RendererLimit)?;
                if depth > MAX_XML_DEPTH {
                    return Err(ViewerError::RendererLimit);
                }
                handle_docx_start(
                    &element,
                    &mut paragraph,
                    &mut run,
                    &mut in_text,
                    &mut table,
                    &mut row,
                    &mut cell,
                )?;
            }
            Event::Empty(element) => {
                validate_attributes(&element)?;
                handle_docx_empty(&element, &mut paragraph, &mut run)?;
            }
            Event::Text(text) if in_text => {
                let decoded = unescape(text.as_ref()).map_err(|_| ViewerError::RendererError)?;
                text_bytes = text_bytes
                    .checked_add(decoded.len())
                    .ok_or(ViewerError::RendererLimit)?;
                if text_bytes > MAX_DOCX_TEXT_BYTES {
                    return Err(ViewerError::RendererLimit);
                }
                if let Some(current) = run.as_mut() {
                    current.text.push_str(&decoded);
                }
            }
            Event::GeneralRef(reference) if in_text => {
                let wrapped = format!("&{};", reference.as_ref());
                let decoded = unescape(&wrapped).map_err(|_| ViewerError::RendererError)?;
                text_bytes = text_bytes
                    .checked_add(decoded.len())
                    .ok_or(ViewerError::RendererLimit)?;
                if text_bytes > MAX_DOCX_TEXT_BYTES {
                    return Err(ViewerError::RendererLimit);
                }
                if let Some(current) = run.as_mut() {
                    current.text.push_str(&decoded);
                }
            }
            Event::End(element) => {
                let qualified_name = element.name();
                let name = local_name(qualified_name.as_ref());
                match name {
                    "t" => in_text = false,
                    "r" => {
                        if let (Some(current), Some(target)) = (run.take(), paragraph.as_mut()) {
                            if !current.text.is_empty() {
                                run_count =
                                    run_count.checked_add(1).ok_or(ViewerError::RendererLimit)?;
                                if run_count > MAX_DOCX_RUNS {
                                    return Err(ViewerError::RendererLimit);
                                }
                                target.runs.push(current);
                            }
                        }
                    }
                    "p" => {
                        if let Some(current) = paragraph.take() {
                            let plain = current
                                .runs
                                .iter()
                                .map(|part| part.text.as_str())
                                .collect::<String>();
                            if let Some(target) = cell.as_mut() {
                                if !target.is_empty() && !plain.is_empty() {
                                    target.push('\n');
                                }
                                target.push_str(&plain);
                            } else if !current.runs.is_empty() {
                                blocks.push(DocxBlockDto::Paragraph {
                                    style: current.style,
                                    runs: current.runs,
                                });
                            }
                        }
                    }
                    "tc" => {
                        let value = cell.take().unwrap_or_default();
                        row.as_mut().ok_or(ViewerError::RendererError)?.push(value);
                        table_cells = table_cells
                            .checked_add(1)
                            .ok_or(ViewerError::RendererLimit)?;
                        if table_cells > MAX_DOCX_TABLE_CELLS {
                            return Err(ViewerError::RendererLimit);
                        }
                    }
                    "tr" => {
                        let value = row.take().ok_or(ViewerError::RendererError)?;
                        table
                            .as_mut()
                            .ok_or(ViewerError::RendererError)?
                            .push(value);
                    }
                    "tbl" => {
                        blocks.push(DocxBlockDto::Table {
                            rows: table.take().ok_or(ViewerError::RendererError)?,
                        });
                    }
                    _ => {}
                }
                depth = depth.checked_sub(1).ok_or(ViewerError::RendererError)?;
            }
            Event::DocType(_) | Event::PI(_) => return Err(ViewerError::RendererError),
            Event::Eof => break,
            Event::Decl(_)
            | Event::Text(_)
            | Event::CData(_)
            | Event::Comment(_)
            | Event::GeneralRef(_) => {}
        }
        if blocks.len() > MAX_DOCX_BLOCKS {
            return Err(ViewerError::RendererLimit);
        }
        buffer.clear();
    }
    if depth != 0 || paragraph.is_some() || table.is_some() || row.is_some() || cell.is_some() {
        return Err(ViewerError::RendererError);
    }
    Ok(blocks)
}

struct ParagraphBuilder {
    style: DocxParagraphStyle,
    runs: Vec<DocxRunDto>,
}

fn handle_docx_start(
    element: &quick_xml::events::BytesStart<'_>,
    paragraph: &mut Option<ParagraphBuilder>,
    run: &mut Option<DocxRunDto>,
    in_text: &mut bool,
    table: &mut Option<Vec<Vec<String>>>,
    row: &mut Option<Vec<String>>,
    cell: &mut Option<String>,
) -> Result<(), ViewerError> {
    match local_name(element.name().as_ref()) {
        "p" => {
            *paragraph = Some(ParagraphBuilder {
                style: DocxParagraphStyle::Normal,
                runs: Vec::new(),
            })
        }
        "r" => {
            *run = Some(DocxRunDto {
                text: String::new(),
                bold: false,
                italic: false,
                underline: false,
            })
        }
        "t" => *in_text = true,
        "tbl" => *table = Some(Vec::new()),
        "tr" => *row = Some(Vec::new()),
        "tc" => *cell = Some(String::new()),
        "pStyle" => apply_paragraph_style(element, paragraph)?,
        "numPr" => {
            if let Some(current) = paragraph.as_mut() {
                current.style = DocxParagraphStyle::List;
            }
        }
        "b" => {
            if let Some(current) = run.as_mut() {
                current.bold = true;
            }
        }
        "i" => {
            if let Some(current) = run.as_mut() {
                current.italic = true;
            }
        }
        "u" => {
            if let Some(current) = run.as_mut() {
                current.underline = true;
            }
        }
        _ => {}
    }
    Ok(())
}

fn handle_docx_empty(
    element: &quick_xml::events::BytesStart<'_>,
    paragraph: &mut Option<ParagraphBuilder>,
    run: &mut Option<DocxRunDto>,
) -> Result<(), ViewerError> {
    match local_name(element.name().as_ref()) {
        "pStyle" => apply_paragraph_style(element, paragraph)?,
        "numPr" => {
            if let Some(current) = paragraph.as_mut() {
                current.style = DocxParagraphStyle::List;
            }
        }
        "b" => {
            if let Some(current) = run.as_mut() {
                current.bold = true;
            }
        }
        "i" => {
            if let Some(current) = run.as_mut() {
                current.italic = true;
            }
        }
        "u" => {
            if let Some(current) = run.as_mut() {
                current.underline = true;
            }
        }
        "br" => {
            if let Some(current) = run.as_mut() {
                current.text.push('\n');
            }
        }
        "tab" => {
            if let Some(current) = run.as_mut() {
                current.text.push('\t');
            }
        }
        _ => {}
    }
    Ok(())
}

fn apply_paragraph_style(
    element: &quick_xml::events::BytesStart<'_>,
    paragraph: &mut Option<ParagraphBuilder>,
) -> Result<(), ViewerError> {
    if let (Some(value), Some(current)) = (attribute_value(element, "val")?, paragraph.as_mut()) {
        if value.to_ascii_lowercase().starts_with("heading") {
            current.style = DocxParagraphStyle::Heading;
        }
    }
    Ok(())
}

fn attribute_value(
    element: &quick_xml::events::BytesStart<'_>,
    expected_local_name: &str,
) -> Result<Option<String>, ViewerError> {
    let mut value = None;
    let mut attributes = element.attributes();
    attributes.with_checks(true);
    for attribute in attributes {
        let attribute = attribute.map_err(|_| ViewerError::RendererError)?;
        if local_name(attribute.key.as_ref()) == expected_local_name {
            if value.is_some() {
                return Err(ViewerError::RendererError);
            }
            value = Some(
                attribute
                    .normalized_value(XmlVersion::Implicit1_0)
                    .map_err(|_| ViewerError::RendererError)?
                    .into_owned(),
            );
        }
    }
    Ok(value)
}

fn local_name(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn is_macro_payload(name: &str) -> bool {
    let leaf = name.rsplit('/').next().unwrap_or(name);
    matches!(leaf, "vbaproject.bin" | "vbadata.xml")
        || name.starts_with("xl/macrosheets/")
        || name.starts_with("xl/dialogsheets/")
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use image::{DynamicImage, ImageBuffer, ImageFormat, Luma, Rgb};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::*;

    fn encode_image(format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(2, 2, |x, y| {
            Rgb([(x * 80) as u8, (y * 80) as u8, 120])
        }));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, format).unwrap();
        output.into_inner()
    }

    fn package(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, contents) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn content_types(part: &str, content_type: &str) -> String {
        format!(
            r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="{part}" ContentType="{content_type}"/></Types>"#
        )
    }

    fn docx(document: &str, relationship: Option<&str>, content_type: &str) -> Vec<u8> {
        let types = content_types("/word/document.xml", content_type);
        let mut entries = vec![
            ("[Content_Types].xml", types.as_str()),
            ("_rels/.rels", "<Relationships/>"),
            ("word/document.xml", document),
        ];
        if let Some(relationship) = relationship {
            entries.push(("word/_rels/document.xml.rels", relationship));
        }
        package(&entries)
    }

    fn xlsx(sheet_one: &str, workbook_relationships: &str) -> Vec<u8> {
        let types = content_types("/xl/workbook.xml", XLSX_MAIN_CONTENT_TYPE).to_string();
        let workbook = r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>"#;
        let sheet_two = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Details</t></is></c></row></sheetData></worksheet>"#;
        package(&[
            ("[Content_Types].xml", &types),
            (
                "_rels/.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_relationships),
            ("xl/worksheets/sheet1.xml", sheet_one),
            ("xl/worksheets/sheet2.xml", sheet_two),
        ])
    }

    fn standard_workbook_relationships() -> &'static str {
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"#
    }

    #[test]
    fn pdf_probe_accepts_required_markers_and_rejects_truncation() {
        assert!(validate_pdf_open(b"%PDF-1.7", b"trailer\n%%EOF\n", 24).is_ok());
        assert_eq!(
            validate_pdf_open(b"%PDF-1.7", b"trailer", 20),
            Err(ViewerError::RendererError)
        );
    }

    #[test]
    fn png_jpeg_and_webp_are_decoded_and_sanitized_to_png() {
        for (format, mime) in [
            (ImageFormat::Png, PNG_MIME),
            (ImageFormat::Jpeg, JPEG_MIME),
            (ImageFormat::WebP, WEBP_MIME),
        ] {
            let (width, height, output) = decode_image(&encode_image(format), mime).unwrap();
            assert_eq!((width, height), (2, 2));
            assert!(output.starts_with(b"\x89PNG\r\n\x1a\n"));
        }
        assert_eq!(
            decode_image(&encode_image(ImageFormat::Png), JPEG_MIME),
            Err(ViewerError::RendererError)
        );
        assert_eq!(
            decode_image(b"not an image", PNG_MIME),
            Err(ViewerError::RendererError)
        );
    }

    #[test]
    fn decoded_image_pixel_budget_fails_before_full_decode() {
        let image = DynamicImage::ImageLuma8(ImageBuffer::<Luma<u8>, _>::from_pixel(
            4_097,
            4_097,
            Luma([0]),
        ));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        assert_eq!(
            decode_image(&output.into_inner(), PNG_MIME),
            Err(ViewerError::RendererLimit)
        );
    }

    #[test]
    fn docx_semantic_model_preserves_text_formatting_and_tables_without_html() {
        let document = r#"<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:i/><w:u/></w:rPr><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let relation = r#"<Relationships><Relationship Id="rId9" TargetMode="External" Target="https://example.invalid/tracker"/></Relationships>"#;
        let blocks = parse_docx(&docx(document, Some(relation), DOCX_MAIN_CONTENT_TYPE)).unwrap();
        assert!(matches!(
            &blocks[0],
            DocxBlockDto::Paragraph { style: DocxParagraphStyle::Heading, runs }
                if runs[0].bold && runs[0].italic && runs[0].underline
                    && runs[0].text == "<script>alert(1)</script>"
        ));
        assert!(matches!(&blocks[1], DocxBlockDto::Table { rows } if rows[0][0] == "Cell"));
    }

    #[test]
    fn ooxml_rejects_dtd_entities_duplicate_attributes_macro_spoofing_and_depth() {
        let dtd = r#"<!DOCTYPE w:document [<!ENTITY x "owned">]><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>"#;
        assert_eq!(
            parse_docx(&docx(dtd, None, DOCX_MAIN_CONTENT_TYPE)),
            Err(ViewerError::RendererError)
        );
        let duplicate = r#"<w:document xmlns:w="urn:w" xmlns:w="urn:other"/>"#;
        assert_eq!(
            parse_docx(&docx(duplicate, None, DOCX_MAIN_CONTENT_TYPE)),
            Err(ViewerError::RendererError)
        );
        assert_eq!(
            parse_docx(&docx(
                "<w:document/>",
                None,
                "application/vnd.ms-word.document.macroEnabled.main+xml"
            )),
            Err(ViewerError::RendererError)
        );
        let deeply_nested = format!(
            "<w:document xmlns:w=\"urn:w\">{}{}</w:document>",
            "<w:x>".repeat(MAX_XML_DEPTH + 1),
            "</w:x>".repeat(MAX_XML_DEPTH + 1)
        );
        assert_eq!(
            parse_docx(&docx(&deeply_nested, None, DOCX_MAIN_CONTENT_TYPE)),
            Err(ViewerError::RendererLimit)
        );
    }

    #[test]
    fn xlsx_enumerates_sheets_returns_bounded_cached_values_and_never_recalculates() {
        let sheet = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c><c r="C1"><f>1+1</f><v>7</v></c></row></sheetData></worksheet>"#;
        let bytes = xlsx(sheet, standard_workbook_relationships());
        let sheets = inspect_xlsx(&bytes).unwrap();
        assert_eq!(
            sheets
                .iter()
                .map(|sheet| sheet.name.as_str())
                .collect::<Vec<_>>(),
            ["Overview", "Details"]
        );
        let window = read_xlsx_window(&bytes, &sheets, 0, 0, 1, 0, 3).unwrap();
        assert_eq!(window.cells[0].display_value, "Revenue");
        assert!(window.cells.iter().any(|cell| cell.display_value == "42"));
        assert!(window.cells.iter().any(|cell| cell.display_value == "7"));
        assert!(!window.cells.iter().any(|cell| cell.display_value == "2"));
        assert_eq!(
            read_xlsx_window(&bytes, &sheets, 0, 0, MAX_XLSX_WINDOW_ROWS + 1, 0, 1),
            Err(ViewerError::InvalidInput)
        );
    }

    #[test]
    fn xlsx_rejects_external_relationships_duplicate_cell_attributes_and_huge_ranges() {
        let external = r#"<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://example.invalid/data.xlsx"/></Relationships>"#;
        assert_eq!(
            inspect_xlsx(&xlsx("<worksheet/>", external)),
            Err(ViewerError::RendererError)
        );
        let duplicate = r#"<worksheet><sheetData><row><c r="A1" r="B2"><v>1</v></c></row></sheetData></worksheet>"#;
        assert_eq!(
            inspect_xlsx(&xlsx(duplicate, standard_workbook_relationships())),
            Err(ViewerError::RendererError)
        );
        let huge = r#"<worksheet><sheetData><row><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>"#;
        assert_eq!(
            inspect_xlsx(&xlsx(huge, standard_workbook_relationships())),
            Err(ViewerError::RendererLimit)
        );
    }

    #[test]
    fn latest_pending_request_wins_when_completion_order_reverses() {
        let mut registry = RendererRegistry::new(7);
        let delayed = registry.begin("file_000000", RendererKind::Pdf).unwrap();
        let latest = registry.begin("file_000001", RendererKind::Docx).unwrap();
        assert_eq!(
            registry.complete(&delayed, 20, RendererState::Pdf),
            Err(ViewerError::RendererClosed)
        );
        let current = registry.complete(&latest, 30, RendererState::Docx).unwrap();
        assert!(registry.get(&current, RendererKind::Docx).is_ok());
    }

    #[test]
    fn cancelled_pending_open_cannot_retain_plaintext() {
        let mut registry = RendererRegistry::new(8);
        let request = registry.begin("file_000002", RendererKind::Image).unwrap();
        registry.cancel(&request);
        assert_eq!(
            registry.complete(
                &request,
                4,
                RendererState::Image {
                    sanitized_png: Zeroizing::new(vec![1, 2, 3, 4]),
                },
            ),
            Err(ViewerError::RendererClosed)
        );
        assert!(registry.is_empty());
    }

    #[test]
    fn retry_supersedes_pending_and_stale_close_preserves_current_handle() {
        let mut registry = RendererRegistry::new(9);
        let first = registry.begin("file_000003", RendererKind::Pdf).unwrap();
        let retry = registry.begin("file_000003", RendererKind::Pdf).unwrap();
        registry.cancel(&first);
        assert_eq!(
            registry.complete(&first, 20, RendererState::Pdf),
            Err(ViewerError::RendererClosed)
        );
        let old = registry.complete(&retry, 20, RendererState::Pdf).unwrap();
        let next = registry.begin("file_000004", RendererKind::Docx).unwrap();
        let current = registry.complete(&next, 30, RendererState::Docx).unwrap();
        assert_eq!(registry.close(&old), Err(ViewerError::RendererClosed));
        assert!(registry.get(&current, RendererKind::Docx).is_ok());
        registry.close(&current).unwrap();
        assert!(registry.is_empty());
    }
}
