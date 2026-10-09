//! Production-compatible SolArch `.slr` v1 archive core.
#![forbid(unsafe_code)]

pub mod archive;
pub mod canonical;
pub mod device;
pub mod error;
pub mod format;
pub mod integrity;
pub mod license;
pub mod manifest;
pub mod paths;
pub mod production_crypto;
pub mod source;

pub use error::{Error, Result};
