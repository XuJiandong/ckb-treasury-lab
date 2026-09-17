//! Protocol constants that a voting script cannot derive from a transaction.
//!
//! The config cell is *not* here: every script points at it through the leading
//! bytes of its `args` (see [`CONFIG_ID_LEN`]), so no deployment parameter has
//! to be compiled into the binaries.

/// Script hash type `data` (the code hash is the blake2b hash of the code cell data).
pub const SCRIPT_HASH_TYPE_DATA: u8 = 0;
/// Script hash type `type` (the code hash is the type script hash of the code cell).
pub const SCRIPT_HASH_TYPE_TYPE: u8 = 1;
/// Script hash type `data1` (like `data`, but the code cell may be upgraded).
pub const SCRIPT_HASH_TYPE_DATA1: u8 = 2;
/// The largest valid script hash type.
pub const MAX_SCRIPT_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_DATA1;

/// The length of a Type ID, and of the ckb-blake160-hash of a script.
pub const TYPE_ID_LEN: usize = 20;

/// The leading `args` bytes of a proposal script: `blake160(config type script)`.
pub const CONFIG_ID_LEN: usize = 20;

/// Proposal type script args: `blake160(config type script) || Type ID`.
pub const PROPOSAL_ARGS_LEN: usize = CONFIG_ID_LEN + TYPE_ID_LEN;

/// Vote and counting type script args: `blake160(proposal type script)`.
pub const PROPOSAL_ID_LEN: usize = 20;

/// Nervos DAO type script code hash (RFC 0024 genesis script list).
pub const DAO_TYPE_SCRIPT_CODE_HASH: [u8; 32] = [
    0x82, 0xd7, 0x6d, 0x1b, 0x75, 0xfe, 0x2f, 0xd9, 0xa2, 0x7d, 0xfb, 0xaa, 0x65, 0xa0, 0x39, 0x22,
    0x1a, 0x38, 0x0d, 0x76, 0xc9, 0x26, 0xf3, 0x78, 0xd3, 0xf8, 0x1c, 0xf3, 0xe7, 0xe1, 0x3f, 0x2e,
];
/// The Nervos DAO type script uses `hash_type: type`.
pub const DAO_TYPE_SCRIPT_HASH_TYPE: u8 = SCRIPT_HASH_TYPE_TYPE;
