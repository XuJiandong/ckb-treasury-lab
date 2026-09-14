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

#[cfg(feature = "enable_log")]
use ckb_std::log::{Level, error, log, warn};
use ckb_std::{
    ckb_constants::Source,
    high_level::{QueryIter, load_cell_data, load_cell_type_hash, load_script},
};
use ckb_vote_common::{config::Config, constants::TYPE_ID_LEN, error::Error, rc};

pub fn program_entry() -> i8 {
    #[cfg(feature = "enable_log")]
    init_log();

    let result = run();

    // `rc` reduces a rejection to a numeric exit code, which does not tell why
    // the transaction was rejected; `error!` keeps the reason in the node log.
    #[cfg(feature = "enable_log")]
    if let Err(error) = &result {
        error!("config type script rejected the transaction: {:?}", error);
    }

    rc(result)
}

/// Installs ckb-std's logger, which forwards the `log!`, `warn!` and `error!`
/// messages of this script to the node log.
///
/// Logging costs cycles and binary size, so it is compiled in only when the
/// `enable_log` feature is enabled - which the default features do.
#[cfg(feature = "enable_log")]
fn init_log() {
    // A logger that is already installed - by the simulator or by the test
    // process - is not an error: the messages are emitted all the same.
    let _ = ckb_std::logger::init();
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::SyscallError)?;
    if script.args().raw_data().len() != TYPE_ID_LEN {
        return Err(Error::ArgsInvalid);
    }

    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    #[cfg(feature = "enable_log")]
    log!(
        Level::Info,
        "config cell transition: {} input(s), {} output(s)",
        inputs,
        outputs
    );
    match (inputs, outputs) {
        // Minting: the args are derived from the first input and the output
        // index of this very transaction, which is what makes the cell unique.
        (0, 1) => {
            ckb_std::type_id::check_type_id(0, TYPE_ID_LEN).map_err(|_| Error::TypeIdInvalid)?
        }
        // Updating: the args stay the same, so the Type ID is preserved.
        (1, 1) => {}
        // Burning the config cell would leave every voting script without its
        // parameters, so the singleton may only be minted or updated.
        (1, 0) => {
            #[cfg(feature = "enable_log")]
            warn!("the config cell is the root of the voting system: it may not be burned");
            return Err(Error::ConfigCellBurned);
        }
        _ => return Err(Error::ConfigCellTransitionInvalid),
    }

    // A config cell that does not decode would halt every voting script.
    let data = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    let config = Config::from_data(&data)?;
    config.validate()
}
