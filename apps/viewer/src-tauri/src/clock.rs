use std::{sync::OnceLock, time::Instant};

use solarch_core::license::ProcessClockSample;

use crate::error::ViewerError;

pub trait ClockSource: Send + Sync {
    fn sample(&self) -> Result<ProcessClockSample, ViewerError>;
}

#[derive(Default)]
pub struct ProcessClockSource;

impl ClockSource for ProcessClockSource {
    fn sample(&self) -> Result<ProcessClockSample, ViewerError> {
        process_clock_sample()
    }
}

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
    #[cfg(feature = "live-e2e-clock")]
    {
        let value = std::env::var("SOLARCH_LIVE_E2E_CLOCK_UNIX_SECONDS")
            .map_err(|_| ViewerError::RefreshRequired)?;
        let utc_unix_seconds = parse_live_e2e_seconds(&value)?;
        Ok(ProcessClockSample {
            utc_unix_seconds,
            monotonic_millis: u64::try_from(elapsed).unwrap_or(u64::MAX),
        })
    }
    #[cfg(not(feature = "live-e2e-clock"))]
    {
        let utc = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ViewerError::RefreshRequired)?;
        Ok(ProcessClockSample {
            utc_unix_seconds: i64::try_from(utc.as_secs())
                .map_err(|_| ViewerError::RefreshRequired)?,
            monotonic_millis: u64::try_from(elapsed).unwrap_or(u64::MAX),
        })
    }
}

#[cfg(feature = "live-e2e-clock")]
fn parse_live_e2e_seconds(value: &str) -> Result<i64, ViewerError> {
    if value.is_empty()
        || value.len() > 10
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ViewerError::RefreshRequired);
    }
    value
        .parse::<i64>()
        .ok()
        .filter(|seconds| (0..=9_999_999_999).contains(seconds))
        .ok_or(ViewerError::RefreshRequired)
}

#[cfg(all(test, feature = "live-e2e-clock"))]
mod tests {
    use super::parse_live_e2e_seconds;

    #[test]
    fn live_e2e_clock_accepts_only_canonical_bounded_seconds() {
        assert_eq!(parse_live_e2e_seconds("1789084800").unwrap(), 1_789_084_800);
        for invalid in ["", "01789084800", "-1", "+1", "1.0", "10000000000"] {
            assert!(parse_live_e2e_seconds(invalid).is_err());
        }
    }
}
