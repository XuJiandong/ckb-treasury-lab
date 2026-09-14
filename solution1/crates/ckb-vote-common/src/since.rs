//! `since` helpers.
//!
//! Every duration of the voting system is expressed as a *relative* `since`
//! value with the block number metric, see
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

/// Extracts the block number of a duration stored in the config cell.
///
/// Config durations are relative block number values as well. Whether the
/// relative flag itself is stored is a deployment detail, so it is accepted
/// both ways; what matters is that the metric is the block number.
pub fn block_duration(value: u64) -> Result<u64, Error> {
    let since = Since::new(value);
    if !since.flags_is_valid() {
        return Err(Error::ConfigCellInvalid);
    }
    match since.extract_lock_value() {
        Some(LockValue::BlockNumber(number)) => Ok(number),
        _ => Err(Error::ConfigCellInvalid),
    }
}
