//! `since` helpers.
//!
//! A transaction unlocks an input whose cell has to mature with a *relative*
//! `since` value using the block number metric. The value of such a `since` is
//! the number of blocks that have to pass after the block that created the
//! cell, which is directly comparable with the block counts of the config cell
//! (`vote_duration`, `challenge_time`), see
//! [RFC 0017](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0017-tx-valid-since/0017-tx-valid-since.md).

use ckb_std::since::{LockValue, Since};

use crate::error::Error;

/// Extracts the block number of a `since` value that the transaction uses to
/// unlock an input.
///
/// The value must be relative (it is a delay counted from the block that
/// created the cell) and must use the block number metric.
pub fn relative_block_number(since: u64) -> Result<u64, Error> {
    let since = Since::new(since);
    if since.is_absolute() || !since.flags_is_valid() {
        return Err(Error::SinceInvalid);
    }
    match since.extract_lock_value() {
        Some(LockValue::BlockNumber(number)) => Ok(number),
        _ => Err(Error::SinceInvalid),
    }
}
