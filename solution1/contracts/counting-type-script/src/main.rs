//! Counting type script.
//!
//! See `docs/counting-type-script-spec.md`.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use alloc::vec::Vec;

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::Entity,
    high_level::{
        QueryIter, load_cell_data, load_cell_lock_hash, load_cell_type, load_cell_type_hash,
        load_script,
    },
};
use ckb_vote_common::{
    config::{Config, u64_of},
    constants,
    error::Error,
    proposal, range, rc, status,
};
use ckb_vote_types::molecules::types::{Counting, Vote};

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

    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    match (inputs, outputs) {
        (0, 1) => create(&proposal_id),
        // Consuming a counting cell recycles its capacity. No other transition
        // exists: a counting cell may not be rewritten.
        (_, 0) if inputs > 0 => Ok(()),
        _ => Err(Error::CountingCellTransitionInvalid),
    }
}

/// Validates a freshly created counting cell.
fn create(proposal_id: &[u8; constants::PROPOSAL_ID_LEN]) -> Result<(), Error> {
    let data = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::CountingDataInvalid)?;
    let counting = Counting::from_slice(&data).map_err(|_| Error::CountingDataInvalid)?;
    let direction = counting.direction().as_slice()[0];
    if direction != status::DIRECTION_NO && direction != status::DIRECTION_YES {
        return Err(Error::CountingDataInvalid);
    }
    // Every hash range has to satisfy `start_hash <= end_hash`;
    // `HashRange::new` enforces it.
    let hash_range = read_hash_range(&counting)?;
    let declared_amount = u64_of(counting.vote_amount());

    // The proposal cell is referenced through the cell deps, exactly like in the
    // challenge phase where the already finalized cell is used. It also carries
    // the pointer to the config cell.
    let proposal = proposal::find_proposal(proposal_id)?;
    let config = Config::load(&proposal.config_id)?;
    if proposal.status != status::PROPOSAL_STATUS_OPEN
        && proposal.status != status::PROPOSAL_STATUS_FINALIZED
    {
        return Err(Error::ProposalStatusInvalidForCounting);
    }

    // "YES" votes are counted before the proposal is consumed, "NO" votes are
    // counted for a challenge; both need the vote cells as cell deps.
    // `vote_window` is a block count, directly comparable with the block
    // numbers of the proposal and vote cells.
    let vote_window = config.vote_window;
    let mut voter_locks: Vec<[u8; 32]> = Vec::new();
    let mut total_amount = 0u64;

    for (index, type_script) in QueryIter::new(load_cell_type, Source::CellDep).enumerate() {
        let Some(type_script) = type_script else {
            continue;
        };
        if !config.is_vote_script(&type_script) {
            continue;
        }
        // Every vote cell of this transaction must vote for this proposal.
        if type_script.args().raw_data().as_ref() != &proposal_id[..] {
            return Err(Error::VoteCellProposalMismatch);
        }

        let vote_data =
            load_cell_data(index, Source::CellDep).map_err(|_| Error::VoteCellInvalid)?;
        let vote = Vote::from_slice(&vote_data).map_err(|_| Error::VoteCellInvalid)?;
        if vote.direction().as_slice()[0] != direction {
            return Err(Error::VoteDirectionMismatch);
        }

        // The 2 byte prefix of the voter lock hash slices the voters into
        // ranges; both bounds of `[start_hash, end_hash]` are included.
        let lock_hash =
            load_cell_lock_hash(index, Source::CellDep).map_err(|_| Error::VoteCellInvalid)?;
        if !hash_range.contains(read_u16(&lock_hash[..2])) {
            return Err(Error::VoteLockOutOfRange);
        }

        // The vote must have been cast inside the voting window, measured from
        // the block that created the proposal cell.
        let vote_block = proposal::block_number_of(index)?;
        let offset = vote_block
            .checked_sub(proposal.block_number)
            .ok_or(Error::VoteOutsideWindow)?;
        if offset >= vote_window {
            return Err(Error::VoteOutsideWindow);
        }

        voter_locks.push(lock_hash);
        total_amount = total_amount
            .checked_add(u64_of(vote.vote_amount()))
            .ok_or(Error::AmountOverflow)?;
    }

    if voter_locks.is_empty() {
        return Err(Error::VoteCellMissing);
    }
    if total_amount != declared_amount {
        return Err(Error::VoteAmountMismatch);
    }

    // A voter may only appear once in a counting cell.
    voter_locks.sort_unstable();
    if voter_locks.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(Error::VoteLockNotUnique);
    }
    Ok(())
}

/// Reads the inclusive hash range `[start_hash, end_hash]` of this cell.
///
/// Fails with [`Error::CountingRangeInvalid`] when the range does not satisfy
/// `start_hash <= end_hash`.
fn read_hash_range(counting: &Counting) -> Result<range::HashRange, Error> {
    range::HashRange::new(
        read_u16(counting.start_hash().as_slice()),
        read_u16(counting.end_hash().as_slice()),
    )
}

/// Reads a 2 byte hash range boundary as a big endian `u16`.
fn read_u16(bytes: &[u8]) -> u16 {
    u16::from_be_bytes([bytes[0], bytes[1]])
}
