//! Scripts and cells that the voting scripts must recognise but that cannot be
//! derived from the transaction itself.
//!
//! Two kinds of information live here:
//!
//! 1. **Genesis scripts.** The Nervos DAO type script is part of the genesis
//!    block, so its code hash is a well known constant (RFC 0024).
//! 2. **Deployment parameters.** The config cell, and the `always success` lock
//!    used by finalized proposal cells, are deployed together with the voting
//!    scripts. Their code hashes are only known after deployment.
//!
//! The deployment parameters are *pinned* by filling in the constants below and
//! rebuilding. As long as a constant is left as all zeros the scripts fall back
//! to a relaxed, structural check that keeps the system usable on a devnet or
//! inside `ckb-testtool`; a production deployment **must** pin them, otherwise
//! an attacker could substitute a permissive config cell or a restrictive
//! finalized-proposal lock.

/// Script hash type `data` (the code hash is the blake2b hash of the code cell data).
pub const SCRIPT_HASH_TYPE_DATA: u8 = 0;
/// Script hash type `type` (the code hash is the type script hash of the code cell).
pub const SCRIPT_HASH_TYPE_TYPE: u8 = 1;
/// Script hash type `data1` (like `data`, but the code cell may be upgraded).
pub const SCRIPT_HASH_TYPE_DATA1: u8 = 2;
/// The largest valid script hash type.
pub const MAX_SCRIPT_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_DATA1;

/// The length of a Type ID style `args` field.
pub const TYPE_ID_ARGS_LEN: usize = 20;

/// Nervos DAO type script code hash (RFC 0024 genesis script list).
pub const DAO_TYPE_SCRIPT_CODE_HASH: [u8; 32] = [
    0x82, 0xd7, 0x6d, 0x1b, 0x75, 0xfe, 0x2f, 0xd9, 0xa2, 0x7d, 0xfb, 0xaa, 0x65, 0xa0, 0x39, 0x22,
    0x1a, 0x38, 0x0d, 0x76, 0xc9, 0x26, 0xf3, 0x78, 0xd3, 0xf8, 0x1c, 0xf3, 0xe7, 0xe1, 0x3f, 0x2e,
];
/// The Nervos DAO type script uses `hash_type: type`.
pub const DAO_TYPE_SCRIPT_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_TYPE;

/// Code hash of the deployed config type script, or all zeros while unpinned.
pub const CONFIG_TYPE_SCRIPT_CODE_HASH: [u8; 32] = [0u8; 32];
/// Hash type of the deployed config type script.
pub const CONFIG_TYPE_SCRIPT_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_TYPE;

/// Code hash of the deployed `always success` lock script, or all zeros while unpinned.
pub const ALWAYS_SUCCESS_CODE_HASH: [u8; 32] = [0u8; 32];
/// Hash type of the deployed `always success` lock script.
pub const ALWAYS_SUCCESS_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_DATA1;

/// Tells whether a deployment parameter has been pinned.
pub fn is_pinned(code_hash: &[u8; 32]) -> bool {
    code_hash.iter().any(|byte| *byte != 0)
}

/// Tells whether [`CONFIG_TYPE_SCRIPT_CODE_HASH`] has been pinned.
pub fn config_identity_is_pinned() -> bool {
    is_pinned(&CONFIG_TYPE_SCRIPT_CODE_HASH)
}

/// Tells whether [`ALWAYS_SUCCESS_CODE_HASH`] has been pinned.
pub fn always_success_is_pinned() -> bool {
    is_pinned(&ALWAYS_SUCCESS_CODE_HASH)
}
