use std::{
    ffi::{OsStr, OsString},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use solarch_core::{
    archive::{self, ArchiveBuilder, BuildRequest},
    production_crypto::ArchiveContentKey,
    Error, Result,
};

const ACK_FRAME_MAGIC: &[u8; 8] = b"SLRKEY01";
const SIGNING_FRAME_MAGIC: &[u8; 8] = b"SLRSIGN1";
const MAX_JSON_LINE_BYTES: usize = 4096;
const MAX_INSPECT_JSON_LINE_BYTES: usize = solarch_core::format::MAX_HEADER + 1024;

pub fn run(args: Vec<OsString>) -> Result<()> {
    match args.first().and_then(|argument| argument.to_str()) {
        Some("--help" | "-h") if args.len() == 1 => print_help(),
        Some("create") => create(&args[1..]),
        Some("inspect") => inspect(&args[1..]),
        Some("verify") => verify(&args[1..]),
        _ => Err(Error::InvalidBuilderInput),
    }
}

fn print_help() -> Result<()> {
    println!(
        "SolArch .slr v1\n\n\
Usage:\n\
  solarch create --input-dir <path> --metadata <path> --output <path> \\\n  --signing-key-id <id> --signing-public-key <B64>\n\
  solarch inspect <file>\n\
  solarch verify --archive <file> --signing-key-id <id> \\\n  --signing-public-key <B64>\n\
  solarch verify --pending-build <file> --input-dir <path> --metadata <path> \\\n  --signing-key-id <id>\n\n\
inspect returns UNVERIFIED public metadata. Finalized verify authenticates the \
container signature but does not verify protected plaintext without the ACK."
    );
    Ok(())
}

fn create(args: &[OsString]) -> Result<()> {
    let options = parse_options(
        args,
        &[
            "--input-dir",
            "--metadata",
            "--output",
            "--signing-key-id",
            "--signing-public-key",
        ],
    )?;
    let input_dir = required_path(&options, "--input-dir")?;
    let metadata = required_path(&options, "--metadata")?;
    let output_argument = required_value(&options, "--output")?;
    let output = PathBuf::from(output_argument);
    let output_text = output_argument.to_str().ok_or(Error::InvalidBuilderInput)?;
    let key_id = required_text(&options, "--signing-key-id")?;
    let public_key = parse_public_key(required_text(&options, "--signing-public-key")?)?;

    let stdin = std::io::stdin();
    let mut stdin = stdin.lock();
    let ack = read_ack_frame(&mut stdin, false)?;
    let pending = ArchiveBuilder::prepare(BuildRequest {
        input_dir,
        metadata_path: metadata,
        output_path: &output,
        signing_key_id: key_id,
        signing_public_key: public_key,
        archive_content_key: &ack,
    })?;

    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    stdout
        .write_all(SIGNING_FRAME_MAGIC)
        .and_then(|()| stdout.write_all(&pending.result().signing_digest))
        .and_then(|()| stdout.flush())
        .map_err(|_| Error::Io)?;

    let signature = read_signature_and_eof(&mut stdin)?;
    let result = pending.accept_signature(signature)?;
    write_json_line(
        &mut stdout,
        &json!({
            "archive_fingerprint": result.archive_fingerprint,
            "file_count": result.file_count,
            "output_path": output_text,
            "size_bytes": result.size_bytes,
            "success": true,
        }),
    )
}

fn verify(args: &[OsString]) -> Result<()> {
    if args
        .first()
        .is_some_and(|argument| argument == OsStr::new("--pending-build"))
    {
        verify_pending_command(args)
    } else {
        verify_finalized_command(args)
    }
}

fn verify_pending_command(args: &[OsString]) -> Result<()> {
    let options = parse_options(
        args,
        &[
            "--pending-build",
            "--input-dir",
            "--metadata",
            "--signing-key-id",
        ],
    )?;
    let pending = required_path(&options, "--pending-build")?;
    let input_dir = required_path(&options, "--input-dir")?;
    let metadata = required_path(&options, "--metadata")?;
    let key_id = required_text(&options, "--signing-key-id")?;
    let stdin = std::io::stdin();
    let mut stdin = stdin.lock();
    let ack = read_ack_frame(&mut stdin, true)?;
    let result = archive::verify_pending(pending, input_dir, metadata, key_id, &ack)?;
    let stdout = std::io::stdout();
    write_json_line(
        &mut stdout.lock(),
        &json!({
            "file_count": result.file_count,
            "signing_digest": result.signing_digest,
            "size_bytes": result.size_bytes,
            "success": true,
        }),
    )
}

fn verify_finalized_command(args: &[OsString]) -> Result<()> {
    let options = parse_options(
        args,
        &["--archive", "--signing-key-id", "--signing-public-key"],
    )?;
    let archive_path = required_path(&options, "--archive")?;
    let key_id = required_text(&options, "--signing-key-id")?;
    let public_key = parse_public_key(required_text(&options, "--signing-public-key")?)?;
    let result = archive::verify_finalized(archive_path, key_id, public_key)?;
    let stdout = std::io::stdout();
    write_json_line(
        &mut stdout.lock(),
        &json!({
            "archive_fingerprint": result.archive_fingerprint,
            "protected_content_verified": result.protected_content_verified,
            "signing_key_id": result.signing_key_id,
            "size_bytes": result.size_bytes,
            "success": true,
            "verification": "AUTHENTICATED_CONTAINER",
        }),
    )
}

fn inspect(args: &[OsString]) -> Result<()> {
    if args.len() != 1 {
        return Err(Error::InvalidBuilderInput);
    }
    let path = Path::new(&args[0]);
    let metadata = std::fs::symlink_metadata(path).map_err(|_| Error::Io)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(Error::Io);
    }
    let mut file = std::fs::File::open(path).map_err(|_| Error::Io)?;
    if !file.metadata().map_err(|_| Error::Io)?.is_file() {
        return Err(Error::Io);
    }
    let parsed = solarch_core::format::inspect_structure(&mut file)?;
    let stdout = std::io::stdout();
    write_json_line_with_limit(
        &mut stdout.lock(),
        &json!({
            "protected_content_verified": false,
            "public_header": parsed.header,
            "section_sizes": parsed.section_sizes,
            "size_bytes": parsed.size_bytes,
            "verification": "UNVERIFIED",
        }),
        MAX_INSPECT_JSON_LINE_BYTES,
    )
}

fn parse_options<'a, 'b>(
    args: &'a [OsString],
    expected: &'b [&'b str],
) -> Result<Vec<(&'b str, &'a OsStr)>> {
    if args.len() != expected.len() * 2 {
        return Err(Error::InvalidBuilderInput);
    }
    let mut parsed = Vec::with_capacity(expected.len());
    for pair in args.chunks_exact(2) {
        let name = pair[0].to_str().ok_or(Error::InvalidBuilderInput)?;
        if !expected.contains(&name) || parsed.iter().any(|(seen, _)| *seen == name) {
            return Err(Error::InvalidBuilderInput);
        }
        let stable_name = expected
            .iter()
            .copied()
            .find(|item| *item == name)
            .ok_or(Error::InvalidBuilderInput)?;
        parsed.push((stable_name, pair[1].as_os_str()));
    }
    if expected
        .iter()
        .any(|name| !parsed.iter().any(|(seen, _)| seen == name))
    {
        return Err(Error::InvalidBuilderInput);
    }
    Ok(parsed)
}

fn required_value<'a>(options: &'a [(&str, &OsStr)], name: &str) -> Result<&'a OsStr> {
    options
        .iter()
        .find_map(|(option, value)| (*option == name).then_some(*value))
        .filter(|value| !value.is_empty())
        .ok_or(Error::InvalidBuilderInput)
}

fn required_path<'a>(options: &'a [(&str, &OsStr)], name: &str) -> Result<&'a Path> {
    Ok(Path::new(required_value(options, name)?))
}

fn required_text<'a>(options: &'a [(&str, &OsStr)], name: &str) -> Result<&'a str> {
    required_value(options, name)?
        .to_str()
        .ok_or(Error::InvalidBuilderInput)
}

fn parse_public_key(encoded: &str) -> Result<[u8; 32]> {
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|_| Error::InvalidBuilderInput)?;
    if STANDARD.encode(&decoded) != encoded {
        return Err(Error::InvalidBuilderInput);
    }
    decoded.try_into().map_err(|_| Error::InvalidBuilderInput)
}

fn read_ack_frame(reader: &mut impl Read, require_eof: bool) -> Result<ArchiveContentKey> {
    let mut frame = [0_u8; 40];
    if let Err(error) = reader.read_exact(&mut frame) {
        frame.fill(0);
        return Err(map_read(error));
    }
    if &frame[..8] != ACK_FRAME_MAGIC {
        frame.fill(0);
        return Err(Error::InvalidBuilderInput);
    }
    if require_eof {
        require_eof_after(reader, &mut frame)?;
    }
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(&frame[8..]);
    frame.fill(0);
    let ack = ArchiveContentKey::from_bytes(bytes);
    bytes.fill(0);
    Ok(ack)
}

fn read_signature_and_eof(reader: &mut impl Read) -> Result<[u8; 64]> {
    let mut signature = [0_u8; 64];
    reader.read_exact(&mut signature).map_err(map_read)?;
    require_eof_after(reader, &mut signature)?;
    Ok(signature)
}

fn require_eof_after<const N: usize>(
    reader: &mut impl Read,
    sensitive: &mut [u8; N],
) -> Result<()> {
    let mut trailing = [0_u8; 1];
    match reader.read(&mut trailing) {
        Ok(0) => Ok(()),
        Ok(_) => {
            sensitive.fill(0);
            Err(Error::InvalidBuilderInput)
        }
        Err(_) => {
            sensitive.fill(0);
            Err(Error::Io)
        }
    }
}

fn map_read(error: std::io::Error) -> Error {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        Error::TruncatedInput
    } else {
        Error::Io
    }
}

fn write_json_line(writer: &mut impl Write, value: &Value) -> Result<()> {
    write_json_line_with_limit(writer, value, MAX_JSON_LINE_BYTES)
}

fn write_json_line_with_limit(
    writer: &mut impl Write,
    value: &Value,
    max_bytes: usize,
) -> Result<()> {
    let mut bytes = serde_jcs::to_vec(value).map_err(|_| Error::Serialization)?;
    bytes.push(b'\n');
    if bytes.len() > max_bytes {
        return Err(Error::LimitExceeded);
    }
    writer
        .write_all(&bytes)
        .and_then(|()| writer.flush())
        .map_err(|_| Error::Io)
}
