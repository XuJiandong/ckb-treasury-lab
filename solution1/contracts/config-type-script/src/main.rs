//! Config type script.
//!
//! See `docs/config-type-script-spec.md`.
//!
//! The config cell holds the parameters of the whole voting system. It is a
//! Type ID cell, which makes it unique on the chain, and it may be updated in
//! place but never burned:
//!
//! * minting (`0` in / `1` out): `args` must follow the Type ID rule;
//! * updating (`1` in / `1` out): only the cell data may change, so the cell
//!   can for instance be updated to set `emergent_halt` and stop the system;
//! * burning (`1` in / `0` out): rejected - a burned config cell would freeze
//!   every voting script forever.
//!
//! The cell data must always decode as a `VotingConfig`, otherwise a single bad
//! update would brick the system as well.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
// By default, the following heap configuration is used:
// * 16KB fixed heap
// * 1.2MB(rounded up to be 16-byte aligned) dynamic heap
// * Minimal memory block in dynamic heap is 64 bytes
// For more details, please refer to ckb-std's default_alloc macro
// and the buddy-alloc alloc implementation.
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    ckb_constants::Source,
    high_level::{load_cell_data, load_cell_type_hash, load_script, QueryIter},
};
use ckb_vote_common::{config::Config, deployment::TYPE_ID_ARGS_LEN, error::Error, rc};

pub fn program_entry() -> i8 {
    rc(run())
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::SyscallError)?;
    if script.args().raw_data().len() != TYPE_ID_ARGS_LEN {
        return Err(Error::ArgsInvalid);
    }

    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    match (inputs, outputs) {
        // Minting: the args are derived from the first input and the output
        // index of this very transaction, which is what makes the cell unique.
        (0, 1) => {
            ckb_std::type_id::check_type_id(0, TYPE_ID_ARGS_LEN).map_err(|_| Error::TypeIdInvalid)?
        }
        // Updating: the args stay the same, so the Type ID is preserved.
        (1, 1) => {}
        (1, 0) => return Err(Error::ConfigCellBurned),
        _ => return Err(Error::ConfigCellTransitionInvalid),
    }

    // A config cell that does not decode would halt every voting script.
    let data = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    let config = Config::from_data(&data)?;
    config.validate()
}
