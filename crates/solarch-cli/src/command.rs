use solarch_core::{Error, Result};
use std::ffi::OsString;

pub fn run(args: Vec<OsString>) -> Result<()> {
    match args.first().and_then(|arg| arg.to_str()) {
        Some("--help" | "-h") if args.len() == 1 => {
            println!("SolArch Core foundation\n\nUsage: solarch inspect <file>\n       solarch <create|verify>\n\ninspect returns UNVERIFIED public/structural metadata only. It cannot authorize access.\nProduction create/verify are unavailable pending the shared signature,\nfingerprint and CLI key-handoff contracts. No keys are read.\nUse the Rust in-memory builder and unit tests for development validation.");
            Ok(())
        }
        Some("inspect") if args.len() == 2 => inspect(&args[1]),
        Some("create" | "verify") => Err(Error::ContractUnavailable),
        _ => Err(Error::InvalidBuilderInput),
    }
}

fn inspect(path: &OsString) -> Result<()> {
    if !std::fs::symlink_metadata(path)
        .map_err(|_| Error::Io)?
        .is_file()
    {
        return Err(Error::Io);
    }
    let mut file = std::fs::File::open(path).map_err(|_| Error::Io)?;
    if !file.metadata().map_err(|_| Error::Io)?.is_file() {
        return Err(Error::Io);
    }
    let parsed = solarch_core::format::inspect_structure(&mut file)?;
    let output = serde_json::json!({
        "verification": "UNVERIFIED",
        "protected_content_verified": false,
        "public_header": parsed.header,
        "size_bytes": parsed.size_bytes,
        "section_sizes": parsed.section_sizes,
    });
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|_| Error::Serialization)?
    );
    Ok(())
}
