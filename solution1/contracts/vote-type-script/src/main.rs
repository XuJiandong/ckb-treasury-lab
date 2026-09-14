//! Vote type script.
//!
//! See `docs/vote-type-script-spec.md`.

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
    ckb_types::{packed::Script, prelude::Entity},
    high_level::{
        QueryIter, load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash,
        load_cell_type, load_cell_type_hash, load_script,
    },
};
use ckb_vote_common::{
    config::{self, u64_of},
    constants,
    error::Error,
    hash, proposal, rc, status,
};
use ckb_vote_types::molecules::types::Vote;

pub fn program_entry() -> i8 {
    rc(run())
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::SyscallError)?;
    let proposal_id: [u8; constants::PROPOSAL_ID_LEN] = script
        .args()
        .raw_data()
        .as_ref()
        .try_into()
        .map_err(|_| Error::ArgsInvalid)?;

    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    if outputs == 0 {
        // Withdrawing a vote: the cell is consumed and its capacity recycled.
        // This path does not depend on the proposal or on the config cell, so a
        // voter can always take the capacity back.
        return Ok(());
    }
    if outputs > 1 {
        return Err(Error::MultipleVoteCells);
    }

    let vote_data = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::VoteDataInvalid)?;
    let vote = Vote::from_slice(&vote_data).map_err(|_| Error::VoteDataInvalid)?;
    let direction = vote.direction().as_slice()[0];
    if direction != status::DIRECTION_NO && direction != status::DIRECTION_YES {
        return Err(Error::VoteDataInvalid);
    }
    let declared_amount = u64_of(vote.vote_amount());
    if declared_amount == 0 {
        return Err(Error::VoteDataInvalid);
    }

    let vote_lock = load_cell_lock(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    let vote_lock_hash = hash::script_hash(&vote_lock);
    // The vote cell represents the DAO owner, so its lock script must be
    // unlocked by the transaction.
    if !QueryIter::new(load_cell_lock_hash, Source::Input)
        .any(|lock_hash| lock_hash == vote_lock_hash)
    {
        return Err(Error::VoterLockNotUnlocked);
    }

    // A vote is only valid while the proposal is open. The proposal type script
    // also points at the config cell, which every voting script has to consult:
    // it fails as soon as the system is halted.
    let proposal = proposal::find_proposal(&proposal_id)?;
    config::ensure_running(&proposal.config_id)?;
    if proposal.status != status::PROPOSAL_STATUS_OPEN {
        return Err(Error::ProposalNotOpen);
    }

    // Sum up the voter's DAO deposits and compare them with the declared amount.
    let mut total_amount = 0u64;
    let mut deposit_count = 0usize;
    for (index, type_script) in QueryIter::new(load_cell_type, Source::CellDep).enumerate() {
        let Some(type_script) = type_script else {
            continue;
        };
        if !is_dao_type_script(&type_script) {
            continue;
        }
        let lock_hash =
            load_cell_lock_hash(index, Source::CellDep).map_err(|_| Error::SyscallError)?;
        if lock_hash != vote_lock_hash {
            continue;
        }
        // The deposit must predate the proposal, which makes the "vote,
        // withdraw and vote again" trick impossible.
        if proposal::block_number_of(index)? >= proposal.block_number {
            return Err(Error::DaoDepositTooNew);
        }
        let capacity =
            load_cell_capacity(index, Source::CellDep).map_err(|_| Error::SyscallError)?;
        total_amount = total_amount
            .checked_add(capacity)
            .ok_or(Error::AmountOverflow)?;
        deposit_count += 1;
    }

    if deposit_count == 0 {
        return Err(Error::DaoDepositMissing);
    }
    if total_amount != declared_amount {
        return Err(Error::VoteAmountMismatch);
    }
    Ok(())
}

/// Tells whether a type script is the Nervos DAO type script (RFC 0024).
fn is_dao_type_script(type_script: &Script) -> bool {
    config::script_matches(
        type_script,
        &constants::DAO_TYPE_SCRIPT_CODE_HASH,
        constants::DAO_TYPE_SCRIPT_HASH_TYPE,
    )
}
