#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

#[cfg(feature = "enable_log")]
use ckb_std::log::{Level, log};

pub fn program_entry() -> i8 {
    #[cfg(feature = "enable_log")]
    init_log();

    ckb_std::debug!("This is a sample contract!");

    // Unlike `debug!`, this survives a release build without debug assertions.
    #[cfg(feature = "enable_log")]
    log!(Level::Info, "always success lock: transaction accepted");

    0
}

/// Installs ckb-std's logger, which forwards the `log!` messages of this script
/// to the node log.
///
/// Logging costs cycles and binary size, so it is compiled in only when the
/// `enable_log` feature is enabled - which the default features do.
#[cfg(feature = "enable_log")]
fn init_log() {
    // A logger that is already installed - by the simulator or by the test
    // process - is not an error: the messages are emitted all the same.
    let _ = ckb_std::logger::init();
}
