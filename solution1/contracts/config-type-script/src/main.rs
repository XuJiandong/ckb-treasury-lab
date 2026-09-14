//! Config type script.
//!
//! See `docs/config-type-script-spec.md`.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    ckb_constants::Source,
    high_level::{QueryIter, load_cell_data, load_cell_type_hash, load_script},
};
use ckb_vote_common::{config::Config, constants::TYPE_ID_LEN, error::Error, rc};

pub fn program_entry() -> i8 {
    rc(run())
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::SyscallError)?;
    if script.args().raw_data().len() != TYPE_ID_LEN {
        return Err(Error::ArgsInvalid);
    }

    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    match (inputs, outputs) {
        // Minting: the args are derived from the first input and the output
        // index of this very transaction, which is what makes the cell unique.
        (0, 1) => {
            ckb_std::type_id::check_type_id(0, TYPE_ID_LEN).map_err(|_| Error::TypeIdInvalid)?
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
