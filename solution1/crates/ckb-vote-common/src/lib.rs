//! Shared code of the on-chain voting system.
//!
//! The voting system is made of four scripts (see `docs/`):
//!
//! * `config-type-script`: the singleton configuration cell;
//! * `proposal-type-script`: the proposal / finalized proposal / passed proposal cell;
//! * `vote-type-script`: a DAO backed vote cell;
//! * `counting-type-script`: an aggregated batch of vote cells.
//!
//! Every script reads its parameters from the config cell, so the loading logic
//! (and the deployment parameters it needs) lives here instead of being
//! duplicated four times.
#![no_std]
extern crate alloc;

pub mod config;
pub mod deployment;
pub mod error;
pub mod hash;
pub mod proposal;
pub mod since;
pub mod status;

pub use config::Config;
pub use error::{Error, Result};

/// Converts a script result into the `i8` return value expected from a CKB
/// script entry point: `0` on success and a positive error code otherwise.
pub fn rc(result: Result<()>) -> i8 {
    match result {
        Ok(()) => 0,
        Err(error) => error as i8,
    }
}
