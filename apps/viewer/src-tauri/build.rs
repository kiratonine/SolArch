fn watch_live_build_configuration() {
    for name in [
        "SOLARCH_BACKEND_ORIGIN",
        "SOLARCH_ARCHIVE_TRUST_KEY_ID",
        "SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64",
        "SOLARCH_LICENSE_TRUST_KEY_ID",
        "SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
}

#[cfg(all(windows, feature = "desktop-runtime"))]
fn main() {
    watch_live_build_configuration();
    tauri_build::build()
}

#[cfg(not(all(windows, feature = "desktop-runtime")))]
fn main() {
    watch_live_build_configuration();
}
