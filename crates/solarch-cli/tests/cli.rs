use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
const ACK: [u8; 32] = [0x31; 32];
const KEY_ID: &str = "archive-test-01";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        for _ in 0..1024 {
            let id = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let directory =
                std::env::temp_dir().join(format!("solarch-cli-test-{}-{id}", std::process::id()));
            match std::fs::create_dir(&directory) {
                Ok(()) => return Self(directory),
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

struct BuildFixture {
    _fixture: Fixture,
    input: PathBuf,
    metadata: PathBuf,
    output: PathBuf,
    signing_key: SigningKey,
    public_key_b64: String,
}

impl BuildFixture {
    fn new() -> Self {
        Self::with_title("CLI test")
    }

    fn with_title(title: &str) -> Self {
        let fixture = Fixture::new();
        let input = fixture.0.join("source");
        std::fs::create_dir(&input).unwrap();
        std::fs::write(input.join("document.pdf"), b"%PDF-1.7\nsynthetic\n%%EOF\n").unwrap();
        let metadata = fixture.0.join("header.json");
        let header = serde_json::json!({
            "archive_id": "arc_cli_test",
            "backend": {"archive_api_id": "arc_cli_test"},
            "commercial_snapshot": {
                "platform_fee_bps": 500,
                "price_amount": "10.000000",
                "price_currency": "USDC"
            },
            "created_at": "2026-09-08T00:00:00Z",
            "creator_wallet": "11111111111111111111111111111111",
            "crypto": {
                "chunk_size": 1048576,
                "content_algorithm": "XChaCha20-Poly1305",
                "kdf": "HKDF-SHA-256"
            },
            "format": "solarch",
            "license_snapshot": {
                "allow_export": false,
                "max_devices": 1,
                "watermark_enabled": true
            },
            "title": title,
            "version": "1.0.0"
        });
        std::fs::write(&metadata, serde_jcs::to_vec(&header).unwrap()).unwrap();
        let output = fixture.0.join("archive.slr");
        let signing_key = SigningKey::from_bytes(&[0x57; 32]);
        let public_key_b64 = STANDARD.encode(signing_key.verifying_key().as_bytes());
        Self {
            _fixture: fixture,
            input,
            metadata,
            output,
            signing_key,
            public_key_b64,
        }
    }

    fn create_command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_solarch"));
        command.args([
            "create",
            "--input-dir",
            self.input.to_str().unwrap(),
            "--metadata",
            self.metadata.to_str().unwrap(),
            "--output",
            self.output.to_str().unwrap(),
            "--signing-key-id",
            KEY_ID,
            "--signing-public-key",
            &self.public_key_b64,
        ]);
        command
    }

    fn pending_verify_command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_solarch"));
        command.args([
            "verify",
            "--pending-build",
            self.pending_path().to_str().unwrap(),
            "--input-dir",
            self.input.to_str().unwrap(),
            "--metadata",
            self.metadata.to_str().unwrap(),
            "--signing-key-id",
            KEY_ID,
        ]);
        command
    }

    fn final_verify_command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_solarch"));
        command.args([
            "verify",
            "--archive",
            self.output.to_str().unwrap(),
            "--signing-key-id",
            KEY_ID,
            "--signing-public-key",
            &self.public_key_b64,
        ]);
        command
    }

    fn pending_path(&self) -> PathBuf {
        PathBuf::from(format!("{}.pending", self.output.display()))
    }
}

fn ack_frame() -> Vec<u8> {
    let mut frame = b"SLRKEY01".to_vec();
    frame.extend_from_slice(&ACK);
    frame
}

fn spawn_create(fixture: &BuildFixture) -> Child {
    fixture
        .create_command()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn read_signing_request(child: &mut Child) -> [u8; 32] {
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&ack_frame())
        .unwrap();
    child.stdin.as_mut().unwrap().flush().unwrap();
    let mut frame = [0_u8; 40];
    child
        .stdout
        .as_mut()
        .unwrap()
        .read_exact(&mut frame)
        .unwrap();
    assert_eq!(&frame[..8], b"SLRSIGN1");
    frame[8..].try_into().unwrap()
}

fn complete_create(fixture: &BuildFixture) -> serde_json::Value {
    let mut child = spawn_create(fixture);
    let digest = read_signing_request(&mut child);
    let signature = fixture
        .signing_key
        .sign(&solarch_core::production_crypto::signing_message(&digest));
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&signature.to_bytes())
        .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert_success(&output);
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(output.stdout.ends_with(b"\n"));
    assert!(output.stdout.len() <= 4096);
    value
}

fn run_with_input(command: &mut Command, input: &[u8]) -> std::process::Output {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}

fn assert_success(output: &std::process::Output) {
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stderr).contains("panicked"));
}

fn assert_sanitized_failure(output: &std::process::Output) {
    assert!(!output.status.success());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("panicked"));
    assert!(!output.stderr.windows(ACK.len()).any(|window| window == ACK));
}

#[test]
fn create_duplex_pending_verify_inspect_and_final_verify_succeed() {
    let fixture = BuildFixture::new();
    let mut child = spawn_create(&fixture);
    let digest = read_signing_request(&mut child);
    assert!(fixture.pending_path().is_file());
    assert!(!fixture.output.is_file());

    let pending = run_with_input(&mut fixture.pending_verify_command(), &ack_frame());
    assert_success(&pending);
    let pending_json: serde_json::Value = serde_json::from_slice(&pending.stdout).unwrap();
    assert_eq!(pending_json["success"], true);
    assert_eq!(pending_json["signing_digest"], hex(&digest));
    assert_eq!(pending_json["file_count"], 1);

    let signature = fixture
        .signing_key
        .sign(&solarch_core::production_crypto::signing_message(&digest));
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&signature.to_bytes())
        .unwrap();
    drop(child.stdin.take());
    let created = child.wait_with_output().unwrap();
    assert_success(&created);
    let create_json: serde_json::Value = serde_json::from_slice(&created.stdout).unwrap();
    assert_eq!(create_json["success"], true);
    assert_eq!(create_json["file_count"], 1);
    assert_eq!(create_json["output_path"], fixture.output.to_str().unwrap());
    assert!(fixture.output.is_file());
    assert!(!fixture.pending_path().exists());

    let inspect = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&fixture.output)
        .output()
        .unwrap();
    assert_success(&inspect);
    let inspect_json: serde_json::Value = serde_json::from_slice(&inspect.stdout).unwrap();
    assert_eq!(inspect_json["verification"], "UNVERIFIED");
    assert_eq!(inspect_json["protected_content_verified"], false);

    let verified = fixture.final_verify_command().output().unwrap();
    assert_success(&verified);
    let verify_json: serde_json::Value = serde_json::from_slice(&verified.stdout).unwrap();
    assert_eq!(verify_json["verification"], "AUTHENTICATED_CONTAINER");
    assert_eq!(verify_json["protected_content_verified"], false);
    assert_eq!(
        verify_json["archive_fingerprint"],
        create_json["archive_fingerprint"]
    );
}

#[test]
fn create_rejects_malformed_ack_without_publishing() {
    for frame in [vec![0x73; 40], vec![0x73; 39]] {
        let fixture = BuildFixture::new();
        let output = run_with_input(&mut fixture.create_command(), &frame);
        assert_sanitized_failure(&output);
        assert!(output.stdout.is_empty());
        assert!(!fixture.output.exists());
        assert!(!fixture.pending_path().exists());
    }

    let fixture = BuildFixture::new();
    let mut extra = ack_frame();
    extra.push(0);
    let output = run_with_input(&mut fixture.create_command(), &extra);
    assert_sanitized_failure(&output);
    assert_eq!(&output.stdout[..8], b"SLRSIGN1");
    assert_eq!(output.stdout.len(), 40);
    assert!(!fixture.output.exists());
    assert!(!fixture.pending_path().exists());
}

#[test]
fn create_rejects_bad_signature_and_extra_bytes_without_publishing() {
    for response in [vec![0_u8; 63], vec![0_u8; 64], vec![0_u8; 65]] {
        let fixture = BuildFixture::new();
        let mut child = spawn_create(&fixture);
        read_signing_request(&mut child);
        child.stdin.as_mut().unwrap().write_all(&response).unwrap();
        drop(child.stdin.take());
        let output = child.wait_with_output().unwrap();
        assert_sanitized_failure(&output);
        assert!(output.stdout.is_empty());
        assert!(!fixture.output.exists());
        assert!(!fixture.pending_path().exists());
    }
}

#[test]
fn create_rejects_signature_for_a_different_digest() {
    let fixture = BuildFixture::new();
    let mut child = spawn_create(&fixture);
    let mut digest = read_signing_request(&mut child);
    digest[0] ^= 1;
    let signature = fixture
        .signing_key
        .sign(&solarch_core::production_crypto::signing_message(&digest));
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&signature.to_bytes())
        .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert_sanitized_failure(&output);
    assert!(output.stdout.is_empty());
    assert!(!fixture.output.exists());
    assert!(!fixture.pending_path().exists());
}

#[test]
fn create_rejects_existing_output_without_signing_request() {
    let fixture = BuildFixture::new();
    std::fs::write(&fixture.output, b"existing").unwrap();
    let output = run_with_input(&mut fixture.create_command(), &ack_frame());
    assert_sanitized_failure(&output);
    assert!(output.stdout.is_empty());
    assert_eq!(std::fs::read(&fixture.output).unwrap(), b"existing");
    assert!(!fixture.pending_path().exists());
}

#[test]
fn pending_verify_rejects_wrong_ack_source_mismatch_and_signature_bytes() {
    let fixture = BuildFixture::new();
    let mut child = spawn_create(&fixture);
    let digest = read_signing_request(&mut child);

    let mut wrong_ack = b"SLRKEY01".to_vec();
    wrong_ack.extend_from_slice(&[0x32; 32]);
    let wrong = run_with_input(&mut fixture.pending_verify_command(), &wrong_ack);
    assert_sanitized_failure(&wrong);
    assert!(wrong.stdout.is_empty());

    std::fs::write(
        fixture.input.join("document.pdf"),
        b"%PDF-1.7\nchanged\n%%EOF\n",
    )
    .unwrap();
    let source_mismatch = run_with_input(&mut fixture.pending_verify_command(), &ack_frame());
    assert_sanitized_failure(&source_mismatch);
    assert!(source_mismatch.stdout.is_empty());

    let mut extra = ack_frame();
    extra.extend_from_slice(&[0_u8; 64]);
    let extra_signature = run_with_input(&mut fixture.pending_verify_command(), &extra);
    assert_sanitized_failure(&extra_signature);
    assert!(extra_signature.stdout.is_empty());

    let signature = fixture
        .signing_key
        .sign(&solarch_core::production_crypto::signing_message(&digest));
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&signature.to_bytes())
        .unwrap();
    drop(child.stdin.take());
    let _ = child.wait_with_output().unwrap();
}

#[test]
fn finalized_verify_rejects_mutated_signature_and_inspect_rejects_malformed() {
    let fixture = BuildFixture::new();
    complete_create(&fixture);
    let mut bytes = std::fs::read(&fixture.output).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    std::fs::write(&fixture.output, bytes).unwrap();
    let verified = fixture.final_verify_command().output().unwrap();
    assert_sanitized_failure(&verified);
    assert!(verified.stdout.is_empty());

    std::fs::write(&fixture.output, b"not-an-archive").unwrap();
    let inspected = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&fixture.output)
        .output()
        .unwrap();
    assert_sanitized_failure(&inspected);
    assert!(inspected.stdout.is_empty());
}

#[test]
fn inspect_accepts_valid_header_whose_title_expands_past_protocol_json_limit() {
    let title = "\u{001f}".repeat(1024);
    let fixture = BuildFixture::with_title(&title);
    complete_create(&fixture);

    let inspected = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("inspect")
        .arg(&fixture.output)
        .output()
        .unwrap();
    assert_success(&inspected);
    assert!(inspected.stdout.len() > 4096);
    assert!(inspected.stdout.len() <= solarch_core::format::MAX_HEADER + 1024);
    let value: serde_json::Value = serde_json::from_slice(&inspected.stdout).unwrap();
    assert_eq!(value["public_header"]["title"], title);
    assert_eq!(value["verification"], "UNVERIFIED");
}

#[test]
fn strict_arguments_and_public_key_base64_fail_closed() {
    let fixture = BuildFixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .args(["verify", "--archive"])
        .arg(&fixture.output)
        .args([
            "--signing-key-id",
            KEY_ID,
            "--signing-public-key",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ])
        .output()
        .unwrap();
    assert_sanitized_failure(&output);
    assert!(output.stdout.is_empty());
}

#[test]
fn help_documents_the_exact_commands_without_patch_artifacts() {
    let output = Command::new(env!("CARGO_BIN_EXE_solarch"))
        .arg("--help")
        .output()
        .unwrap();
    assert_success(&output);
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("solarch create --input-dir"));
    assert!(help.contains("solarch verify --pending-build"));
    assert!(!help.contains("\n+"));
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(TABLE[(byte >> 4) as usize] as char);
        output.push(TABLE[(byte & 15) as usize] as char);
    }
    output
}
