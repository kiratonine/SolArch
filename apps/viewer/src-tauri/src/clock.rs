use std::{sync::OnceLock, time::Instant};

use solarch_core::license::ProcessClockSample;

use crate::error::ViewerError;

pub fn process_clock_sample() -> Result<ProcessClockSample, ViewerError> {
    static START: OnceLock<Instant> = OnceLock::new();
    let elapsed = START.get_or_init(Instant::now).elapsed().as_millis();
    #[cfg(feature = "development-fixtures")]
    if let Ok(value) = std::env::var("SOLARCH_DEV_CLOCK_UNIX_SECONDS") {
        let utc_unix_seconds = value
            .parse::<i64>()
            .ok()
            .filter(|seconds| *seconds >= 0)
            .ok_or(ViewerError::RefreshRequired)?;
        return Ok(ProcessClockSample {
            utc_unix_seconds,
            monotonic_millis: u64::try_from(elapsed).unwrap_or(u64::MAX),
        });
    }
    let utc = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| ViewerError::RefreshRequired)?;
    Ok(ProcessClockSample {
        utc_unix_seconds: i64::try_from(utc.as_secs()).map_err(|_| ViewerError::RefreshRequired)?,
        monotonic_millis: u64::try_from(elapsed).unwrap_or(u64::MAX),
    })
}
