//! Bounded section arithmetic for untrusted containers.
use crate::{Error, Result};
pub fn checked_range(offset: u64, length: u64, total: usize) -> Result<std::ops::Range<usize>> {
    let end = offset.checked_add(length).ok_or(Error::OutOfBounds)?;
    let start = usize::try_from(offset).map_err(|_| Error::OutOfBounds)?;
    let end = usize::try_from(end).map_err(|_| Error::OutOfBounds)?;
    if end > total {
        return Err(Error::OutOfBounds);
    }
    Ok(start..end)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_overflow_and_escape() {
        assert!(checked_range(u64::MAX, 1, 10).is_err());
        assert!(checked_range(9, 2, 10).is_err());
        assert_eq!(checked_range(9, 1, 10).unwrap(), 9..10);
    }
}
