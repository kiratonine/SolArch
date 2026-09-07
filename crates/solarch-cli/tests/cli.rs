use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        for _ in 0..1024 {
            let id = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let directory =
                std::env::temp_dir().join(format!("solarch-cli-test-{}-{id}", std::process::id()));
            match std::fs::create_dir(&directory) {
                Ok(()) => return Self(directory),
                // A stale directory from an earlier process with a reused PID
                // belongs to that process. Never reuse or delete it.
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("cannot create test fixture directory: {error}"),
            }
        }
        panic!("cannot allocate a unique test fixture directory")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn header() -> solarch_core::format::PublicHeader {
    serde_json::from_value(serde_json::json!({
        "format":"solarch","version":"1.0.0","archive_id":"arc_test",
        "created_at":"2026-09-07T00:00:00Z","title":"Test","creator_wallet":"synthetic-wallet",
        "commercial_snapshot":{"price_amount":"10.00","price_currency":"USDC","platform_fee_bps":500},
        "license_snapshot":{"max_devices":1,"allow_export":false,"watermark_enabled":true},
        "backend":{"archive_api_id":"arc_test"},
        "crypto":{"content_algorithm":"test-only-opaque","chunk_size":1024}
    })).unwrap()
}

#[test]
fn concurrent_fixtures_have_distinct_directories() {
    let workers: Vec<_> = (0..16).map(|_| std::thread::spawn(Fixture::new)).collect();
    let fixtures: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    let names: std::collections::HashSet<_> = fixtures.iter().map(|fixture| &fixture.0).collect();
    assert_eq!(names.len(), fixtures.len());
    assert!(fixtures.iter().all(|fixture| fixture.0.is_dir()));
}

#[test]
fn inspect_only_emits_unverified_public_metadata() {
    let fixture = Fixture::new();
    let mut bytes = solarch_core::format::serialize_structure(
        &header(),
        [
            b"private-manifest-marker",
            b"private-index-marker",
            b"private-chunk-marker",
            b"opaque-signature",
        ],
    )
    .unwrap();
    let file = fixture.0.join("synthetic.slr");
    std::fs::write(&file, &bytes).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&file)
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    let value: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(value["verification"], "UNVERIFIED");
    assert_eq!(value["protected_content_verified"], false);
    assert!(!stdout.contains("private-"));
    bytes[0] = 0;
    std::fs::write(&file, bytes).unwrap();
    let failed = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&file)
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(failed.stdout.is_empty());
}

#[test]
fn inspect_large_sparse_container_and_reject_truncation() {
    use std::io::{Seek, SeekFrom, Write};
    let fixture = Fixture::new();
    let path = fixture.0.join("large-structural-only.slr");
    let public_header = serde_json::to_vec(&header()).unwrap();
    let content_len = 256 * 1024 * 1024_u64;
    let lengths = [public_header.len() as u64, 40, 40, content_len, 64];
    let mut prelude = solarch_core::format::MAGIC.to_vec();
    prelude.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
    let mut total = solarch_core::format::PRELUDE_LEN as u64;
    for length in lengths {
        prelude.extend_from_slice(&total.to_le_bytes());
        prelude.extend_from_slice(&length.to_le_bytes());
        total += length;
    }
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(&prelude).unwrap();
    file.write_all(&public_header).unwrap();
    // Sparse opaque content: structural fixture, no crypto validation claimed.
    file.set_len(total).unwrap();
    file.seek(SeekFrom::Start(total - 1)).unwrap();
    file.write_all(&[0]).unwrap();
    file.sync_all().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["size_bytes"], total);
    assert_eq!(result["section_sizes"][3], content_len);
    assert_eq!(result["verification"], "UNVERIFIED");
    assert_eq!(result["protected_content_verified"], false);
    file.set_len(total - 1).unwrap();
    file.sync_all().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}

#[test]
fn help_is_honest_about_contract_gate() {
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("unavailable"));
}

#[test]
fn production_commands_fail_closed_without_sensitive_echo() {
    for command in ["create", "inspect", "verify", "unknown"] {
        let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
            .args([command, "synthetic-sensitive-marker"])
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(!stderr.contains("synthetic-sensitive-marker"));
        assert!(!stderr.contains("panicked"));
    }
}
