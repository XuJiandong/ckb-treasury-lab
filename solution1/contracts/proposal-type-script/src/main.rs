//! Proposal type script.
//!
//! See `docs/proposal-type-script-spec.md`.
//!
//! The same type script identifies the three states of a proposal, which is
//! encoded in the `status` field of the cell data:
//!
//! ```text
//!                    +------------------------------+
//!   create           |  open (0)                    |
//!   (Type ID args)   |  lock = initiator            |
//!                    +------------------------------+
//!                             |
//!                             | since > config.vote_duration
//!                             | + "YES" counting cells >= config.yes_threshold
//!                             v
//!                    +------------------------------+
//!   challenge -----> |  finalized (1)               | -----> recycle (since >
//!   veto      -----> |  lock = always success       |        vote_duration +
//!                    +------------------------------+        challenge_time)
//!                             |
//!                             | since > config.challenge_time
//!                             v
//!                    +------------------------------+
//!                    |  passed (2)                  |
//!                    +------------------------------+
//! ```
//!
//! `description` and `applied_amount` are frozen when the proposal is created:
//! they are what the voters decide on. The bond (`capacity`) is preserved by
//! the finalized transition, since it is the challenger's incentive.

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

use alloc::vec::Vec;

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Script, prelude::Entity},
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash, load_cell_type,
        load_cell_type_hash, load_input_since, load_script, QueryIter,
    },
};
use ckb_vote_common::{
    config::{self, u64_of, Config},
    deployment::{self, TYPE_ID_ARGS_LEN},
    error::Error,
    hash, rc, since, status,
};
use ckb_vote_types::molecules::types::{Counting, ProposalCellData};

pub fn program_entry() -> i8 {
    rc(run())
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::SyscallError)?;
    if script.args().raw_data().len() != TYPE_ID_ARGS_LEN {
        return Err(Error::ArgsInvalid);
    }

    // The type script of a proposal is a Type ID, so at most one proposal cell
    // can exist. Both counters are therefore 0 or 1, and a transaction that
    // contains two of them (or none at all) is malformed.
    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    match (inputs, outputs) {
        // A brand new proposal.
        (0, 1) => create(),
        // A proposal being updated: open -> finalized, or finalized -> passed.
        (1, 1) => update(&script),
        // A proposal being settled: recycled, vetoed, challenged or granted.
        (1, 0) => settle(&script),
        _ => Err(Error::ProposalStatusInvalid),
    }
}

/// Creates a proposal cell.
fn create() -> Result<(), Error> {
    let config = Config::load()?;

    // The args are derived from the first input and the output index, which is
    // what makes the proposal unique on the chain.
    ckb_std::type_id::check_type_id(0, TYPE_ID_ARGS_LEN).map_err(|_| Error::TypeIdInvalid)?;

    let proposal = read_proposal_data(Source::GroupOutput)?;
    if proposal.status().as_slice()[0] != status::PROPOSAL_STATUS_OPEN {
        return Err(Error::ProposalStatusInvalid);
    }
    if u64_of(proposal.total_yes()) != 0 {
        return Err(Error::ProposalDataInvalid);
    }

    // The capacity is the bond of the proposal: it is what a challenger wins,
    // so it has to be at least `config.minimal_proposal_capacity`.
    let capacity = load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    if capacity < config.minimal_proposal_capacity {
        return Err(Error::ProposalCapacityTooSmall);
    }
    Ok(())
}

/// Updates a proposal cell: `open -> finalized` or `finalized -> passed`.
fn update(script: &Script) -> Result<(), Error> {
    let config = Config::load()?;
    let input = read_proposal_data(Source::GroupInput)?;
    let output = read_proposal_data(Source::GroupOutput)?;

    // What the voters decide on may not be rewritten after the fact.
    if u64_of(input.applied_amount()) != u64_of(output.applied_amount())
        || input.description().as_slice() != output.description().as_slice()
    {
        return Err(Error::ProposalFieldsChanged);
    }

    let since = load_input_since(0, Source::GroupInput).map_err(|_| Error::SyscallError)?;

    match (
        input.status().as_slice()[0],
        output.status().as_slice()[0],
    ) {
        (status::PROPOSAL_STATUS_OPEN, status::PROPOSAL_STATUS_FINALIZED) => {
            finalize(script, &config, since::relative_block_number(since)?, &output)
        }
        (status::PROPOSAL_STATUS_FINALIZED, status::PROPOSAL_STATUS_PASSED) => {
            if since::relative_block_number(since)? <= since::block_duration(config.challenge_time)?
            {
                return Err(Error::ChallengeTimeNotElapsed);
            }
            Ok(())
        }
        _ => Err(Error::ProposalStatusInvalid),
    }
}

/// `open -> finalized`: the voting window is over and enough "YES" votes were
/// counted, so the proposal can be challenged by anyone from now on.
fn finalize(
    script: &Script,
    config: &Config,
    elapsed: u64,
    output: &ProposalCellData,
) -> Result<(), Error> {
    if elapsed <= since::block_duration(config.vote_duration)? {
        return Err(Error::VoteDurationNotElapsed);
    }

    // The bond is the challenger's incentive, it may not be drained here.
    let input_capacity =
        load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::SyscallError)?;
    let output_capacity =
        load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    if input_capacity != output_capacity {
        return Err(Error::ProposalCapacityChanged);
    }

    // The finalized cell must be spendable by anyone, otherwise it could not be
    // challenged.
    let lock = load_cell_lock(0, Source::GroupOutput).map_err(|_| Error::SyscallError)?;
    if !is_always_success_lock(&lock) {
        return Err(Error::AlwaysSuccessLockRequired);
    }

    // Sum the "YES" certificates and record the result in `total_yes`.
    let tally = collect_counting_cells(script, config, status::DIRECTION_YES)?;
    if tally.count == 0 {
        return Err(Error::CountingCellMissing);
    }
    if u64_of(output.total_yes()) != tally.total_amount {
        return Err(Error::ProposalDataInvalid);
    }
    if tally.total_amount < config.yes_threshold {
        return Err(Error::YesThresholdNotMet);
    }
    Ok(())
}

/// Settles a proposal by consuming it without any proposal output.
fn settle(script: &Script) -> Result<(), Error> {
    let config = Config::load()?;
    let proposal = read_proposal_data(Source::GroupInput)?;

    match proposal.status().as_slice()[0] {
        // A passed proposal is settled by whoever applies the grant.
        status::PROPOSAL_STATUS_PASSED => Ok(()),
        // An open proposal that never made it can only be recycled by its
        // initiator, once the voting and challenge windows are over.
        status::PROPOSAL_STATUS_OPEN => {
            if recycle_elapsed(&config)? {
                Ok(())
            } else {
                Err(Error::RecycleTooEarly)
            }
        }
        status::PROPOSAL_STATUS_FINALIZED => {
            // 1. The administrator may veto a finalized proposal.
            if vetoed(&config)? {
                return Ok(());
            }
            // 2. A challenger wins by collecting at least as much "NO" weight
            //    as the certified "YES" votes; the bond is the incentive.
            let tally = collect_counting_cells(script, &config, status::DIRECTION_NO)?;
            if tally.count > 0 && tally.total_amount >= u64_of(proposal.total_yes()) {
                return Ok(());
            }
            // 3. Otherwise the bond can only be recycled once nobody is able to
            //    challenge anymore. A missing or non relative `since` simply
            //    means that this is not the case.
            if recycle_elapsed(&config).unwrap_or(false) {
                Ok(())
            } else {
                Err(Error::ChallengeNotMet)
            }
        }
        _ => Err(Error::ProposalStatusInvalid),
    }
}

/// The aggregation of the counting cells referenced by a transaction.
struct Tally {
    /// The sum of the `vote_amount` fields of the counting cells.
    total_amount: u64,
    /// How many counting cells were found.
    count: usize,
}

/// Collects the counting cells of `direction` referenced by this transaction.
///
/// Counting cells may be consumed (inputs) or merely referenced (cell deps);
/// both are accepted, the design only requires them to accompany the proposal
/// cell. Each counting cell is a certificate that was validated by the counting
/// type script when it was created, so summing their `vote_amount` is enough.
///
/// The hash ranges of the cells must not overlap, which is what makes the sum
/// meaningful: a voter can only be counted once across all the batches.
fn collect_counting_cells(
    script: &Script,
    config: &Config,
    direction: u8,
) -> Result<Tally, Error> {
    // The counting cells point back at this very proposal cell.
    let proposal_id = hash::script_id(script);
    let mut ranges: Vec<(u16, u16)> = Vec::new();
    let mut total_amount = 0u64;

    for source in [Source::Input, Source::CellDep] {
        for (index, type_script) in QueryIter::new(load_cell_type, source).enumerate() {
            let Some(type_script) = type_script else {
                continue;
            };
            if !config.is_counting_script(&type_script) {
                continue;
            }
            if type_script.args().raw_data().as_ref() != &proposal_id[..] {
                return Err(Error::CountingCellInvalid);
            }
            let data = load_cell_data(index, source).map_err(|_| Error::CountingCellInvalid)?;
            let counting = Counting::from_slice(&data).map_err(|_| Error::CountingCellInvalid)?;
            if counting.direction().as_slice()[0] != direction {
                return Err(Error::CountingCellInvalid);
            }
            let start = read_u16(counting.start_hash().as_slice());
            let end = read_u16(counting.end_hash().as_slice());
            if start > end {
                return Err(Error::CountingCellInvalid);
            }
            ranges.push((start, end));
            total_amount = total_amount
                .checked_add(u64_of(counting.vote_amount()))
                .ok_or(Error::AmountOverflow)?;
        }
    }

    // Inclusive ranges must be disjoint: sorted ranges may not touch.
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[1].0 <= pair[0].1) {
        return Err(Error::CountingRangeOverlap);
    }

    Ok(Tally {
        total_amount,
        count: ranges.len(),
    })
}

/// Tells whether the voting and the challenge windows have elapsed, which is
/// when the bond of a proposal that did not pass can be recycled.
fn recycle_elapsed(config: &Config) -> Result<bool, Error> {
    let since = load_input_since(0, Source::GroupInput).map_err(|_| Error::SyscallError)?;
    let elapsed = since::relative_block_number(since)?;
    let total = since::block_duration(config.vote_duration)?
        .checked_add(since::block_duration(config.challenge_time)?)
        .ok_or(Error::AmountOverflow)?;
    Ok(elapsed > total)
}

/// Tells whether one of the input lock scripts is the administrator's veto lock.
fn vetoed(config: &Config) -> Result<bool, Error> {
    Ok(QueryIter::new(load_cell_lock_hash, Source::Input)
        .any(|lock_hash| lock_hash == config.veto_lock_script_hash))
}

/// Tells whether a lock script is the `always success` lock.
///
/// The finalized proposal cell has to be spendable by anyone. When the
/// deployment pinned the lock script code hash it is matched exactly; otherwise
/// any lock script without args is accepted, see [`ckb_vote_common::deployment`].
fn is_always_success_lock(lock: &Script) -> bool {
    if deployment::always_success_is_pinned() {
        config::script_matches(
            lock,
            &deployment::ALWAYS_SUCCESS_CODE_HASH,
            deployment::ALWAYS_SUCCESS_HASH_TYPE,
        )
    } else {
        lock.args().raw_data().is_empty()
    }
}

fn read_proposal_data(source: Source) -> Result<ProposalCellData, Error> {
    let data = load_cell_data(0, source).map_err(|_| Error::ProposalDataInvalid)?;
    ProposalCellData::from_slice(&data).map_err(|_| Error::ProposalDataInvalid)
}

/// Reads a 2 byte hash range boundary as a big endian `u16`.
fn read_u16(bytes: &[u8]) -> u16 {
    u16::from_be_bytes([bytes[0], bytes[1]])
}
