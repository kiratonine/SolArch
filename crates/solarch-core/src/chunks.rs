//! Deterministic partitioning and authenticated in-memory selected chunk access.
use crate::{
    crypto::{ContentKey, EncryptedMessage, EncryptionSession},
    Error, Result,
};
use zeroize::Zeroizing;

pub const DEFAULT_CHUNK_SIZE: usize = 1024 * 1024;
pub const MAX_CHUNKS: usize = 65536;

/// Half-open ranges are platform independent once converted from bounded sizes.
pub fn partition(size: usize, chunk_size: usize) -> Result<Vec<std::ops::Range<usize>>> {
    if chunk_size == 0 || chunk_size > DEFAULT_CHUNK_SIZE {
        return Err(Error::InvalidChunkMetadata);
    }
    let count = size / chunk_size + usize::from(!size.is_multiple_of(chunk_size));
    if count > MAX_CHUNKS {
        return Err(Error::LimitExceeded);
    }
    let mut ranges = Vec::with_capacity(count);
    let mut start = 0;
    while start < size {
        let end = start.saturating_add(chunk_size).min(size);
        ranges.push(start..end);
        start = end;
    }
    Ok(ranges)
}

pub struct EncryptedChunks {
    chunks: Vec<EncryptedMessage>,
    context: Vec<u8>,
}

impl EncryptedChunks {
    pub fn encrypt(
        session: &mut EncryptionSession,
        input: &[u8],
        chunk_size: usize,
        context: &[u8],
    ) -> Result<Self> {
        if context.len() > 4096 {
            return Err(Error::LimitExceeded);
        }
        let ranges = partition(input.len(), chunk_size)?;
        let mut chunks = Vec::with_capacity(ranges.len());
        for (i, range) in ranges.into_iter().enumerate() {
            chunks.push(session.encrypt(&input[range], &aad(context, i))?);
        }
        Ok(Self {
            chunks,
            context: context.to_vec(),
        })
    }
    pub fn len(&self) -> usize {
        self.chunks.len()
    }
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }
    pub fn decrypt_selected(&self, key: &ContentKey, index: usize) -> Result<Zeroizing<Vec<u8>>> {
        let chunk = self.chunks.get(index).ok_or(Error::OutOfBounds)?;
        key.decrypt(chunk, &aad(&self.context, index))
    }
}

fn aad(context: &[u8], index: usize) -> Vec<u8> {
    let mut value = b"SolArch in-memory chunk\0".to_vec();
    value.extend_from_slice(context);
    value.extend_from_slice(&(index as u64).to_le_bytes());
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partition_bounds() {
        assert_eq!(partition(5, 2).unwrap(), vec![0..2, 2..4, 4..5]);
        assert!(partition(0, 1).unwrap().is_empty());
        assert!(partition(1, 0).is_err());
        assert!(partition(usize::MAX, 1).is_err());
        assert!(partition(1, DEFAULT_CHUNK_SIZE + 1).is_err());
    }
    #[test]
    fn selected_chunk_multichunk_and_reordering() {
        let input = b"synthetic multi-chunk example";
        let mut session = EncryptionSession::new().unwrap();
        let mut chunks = EncryptedChunks::encrypt(&mut session, input, 5, b"file1").unwrap();
        let mut recovered = Vec::new();
        for i in 0..chunks.len() {
            recovered.extend_from_slice(&chunks.decrypt_selected(session.key(), i).unwrap());
        }
        assert_eq!(recovered, input);
        assert!(chunks
            .decrypt_selected(session.key(), chunks.len())
            .is_err());
        chunks.chunks.swap(0, 1);
        assert!(chunks.decrypt_selected(session.key(), 0).is_err());
    }
}
