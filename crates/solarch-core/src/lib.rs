//! Archive Core foundation. No approved production crypto wire profile yet.
#![forbid(unsafe_code)]

pub mod builder;
pub mod chunks;
pub mod crypto;
pub mod error;
pub mod fingerprint;
pub mod format;
pub mod integrity;
pub mod manifest;
pub mod paths;
pub mod signature;

pub use error::{Error, Result};
