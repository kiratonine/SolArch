#[cfg(all(windows, feature = "desktop-runtime"))]
fn main() {
    tauri_build::build()
}

#[cfg(not(all(windows, feature = "desktop-runtime")))]
fn main() {}
