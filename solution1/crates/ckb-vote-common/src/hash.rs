//! Hash helpers.
//!
//! `ckb-hash` is blake2b with the personalization `ckb-default-hash`; the
//! convention used across the design documents is:
//!
//! * *ckb-hash*: the full 32 byte digest;
//! * *ckb-blake160-hash*: the leading 20 bytes of the digest.

use ckb_std::ckb_types::{packed::Script, prelude::Entity};

/// The 32 byte ckb hash of `data`.
pub fn blake2b_256(data: &[u8]) -> [u8; 32] {
    ckb_hash::blake2b_256(data)
}

/// The 20 byte ckb-blake160-hash of `data`.
pub fn blake160(data: &[u8]) -> [u8; 20] {
    let digest = blake2b_256(data);
    let mut hash = [0u8; 20];
    hash.copy_from_slice(&digest[..20]);
    hash
}

/// The ckb-blake160-hash of a serialized script.
///
/// Vote and counting cells store this value in their `args` to point at the
/// proposal cell they belong to.
pub fn script_id(script: &Script) -> [u8; 20] {
    blake160(script.as_slice())
}

/// The ckb hash of a serialized script, which is also used as the type script
/// hash of a cell.
pub fn script_hash(script: &Script) -> [u8; 32] {
    blake2b_256(script.as_slice())
}
