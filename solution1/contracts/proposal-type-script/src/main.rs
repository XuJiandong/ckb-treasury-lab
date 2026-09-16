//! Proposal type script.
//!
//! See `docs/proposal-type-script-spec.md`.
//!

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use alloc::vec::Vec;

#[cfg(feature = "enable_log")]
use ckb_std::log::{Level, error, log, warn};
use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Script, prelude::Entity},
    high_level::{
        QueryIter, load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash,
        load_cell_type, load_cell_type_hash, load_input_since, load_script,
    },
};
use ckb_vote_common::{
    config::{Config, u64_of},
    constants::{CONFIG_ID_LEN, PROPOSAL_ARGS_LEN, TYPE_ID_LEN},
    error::Error,
    hash, proposal, range, rc, since, status,
};
use ckb_vote_types::molecules::types::{Counting, ProposalCellData};

/// The length of `recipient_lock_hash`: the ckb-blake160-hash of a lock script.
const RECIPIENT_LOCK_HASH_LEN: usize = 20;

pub fn program_entry() -> i8 {
    #[cfg(feature = "enable_log")]
    init_log();

    let result = run();

    // `rc` reduces a rejection to a numeric exit code, which does not tell why
    // the transaction was rejected; `error!` keeps the reason in the node log.
    #[cfg(feature = "enable_log")]
    if let Err(error) = &result {
        error!("proposal type script rejected the transaction: {:?}", error);
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
    // `args` is `blake160(config type script) || Type ID`.
    let args = script.args().raw_data();
    if args.len() != PROPOSAL_ARGS_LEN {
        return Err(Error::ArgsInvalid);
    }
    let mut config_id = [0u8; CONFIG_ID_LEN];
    config_id.copy_from_slice(&args[..CONFIG_ID_LEN]);

    // The type script of a proposal is a Type ID, so at most one proposal cell
    // can exist. Both counters are therefore 0 or 1, and a transaction that
    // contains two of them (or none at all) is malformed.
    let inputs = QueryIter::new(load_cell_type_hash, Source::GroupInput).count();
    let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
    #[cfg(feature = "enable_log")]
    log!(
        Level::Info,
        "proposal cell transition: {} input(s), {} output(s)",
        inputs,
        outputs
    );
    match (inputs, outputs) {
        // A brand new proposal.
        (0, 1) => create(&config_id),
        // A proposal being updated: open -> finalized, or finalized -> passed.
        (1, 1) => update(&script, &config_id),
        // A proposal being settled: recycled, vetoed, challenged or granted.
        (1, 0) => settle(&script, &config_id),
        _ => Err(Error::ProposalStatusInvalid),
    }
}

/// Creates a proposal cell.
fn create(config_id: &[u8; CONFIG_ID_LEN]) -> Result<(), Error> {
    let config = Config::load(config_id)?;

    // The tail of the args is derived from the first input and the output index,
    // which is what makes the proposal unique on the chain.
    ckb_std::type_id::check_type_id(CONFIG_ID_LEN, TYPE_ID_LEN)
        .map_err(|_| Error::TypeIdInvalid)?;

    let proposal = read_proposal_data(Source::GroupOutput)?;
    if proposal.status().as_slice()[0] != status::PROPOSAL_STATUS_OPEN {
        return Err(Error::ProposalStatusInvalid);
    }
    if u64_of(proposal.total_yes()) != 0 {
        return Err(Error::ProposalDataInvalid);
    }
    if u64_of(proposal.origin_block_number()) != 0 {
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
fn update(script: &Script, config_id: &[u8; CONFIG_ID_LEN]) -> Result<(), Error> {
    let config = Config::load(config_id)?;
    let input = read_proposal_data(Source::GroupInput)?;
    let output = read_proposal_data(Source::GroupOutput)?;

    // What the voters decide on may not be rewritten after the fact: the
    // description, the requested amount and the recipient of the grant.
    if u64_of(input.requested_amount()) != u64_of(output.requested_amount())
        || input.description().as_slice() != output.description().as_slice()
        || input.recipient_lock_hash().as_slice() != output.recipient_lock_hash().as_slice()
    {
        return Err(Error::ProposalFieldsChanged);
    }

    let since = load_input_since(0, Source::GroupInput).map_err(|_| Error::SyscallError)?;

    match (input.status().as_slice()[0], output.status().as_slice()[0]) {
        (status::PROPOSAL_STATUS_OPEN, status::PROPOSAL_STATUS_FINALIZED) => finalize(
            script,
            &config,
            since::relative_block_number(since)?,
            &output,
        ),
        (status::PROPOSAL_STATUS_FINALIZED, status::PROPOSAL_STATUS_PASSED) => {
            // `challenge_time` is a block count, directly comparable with the
            // block number carried by the relative `since`.
            if since::relative_block_number(since)? <= config.challenge_time {
                return Err(Error::ChallengeTimeNotElapsed);
            }
            // The origin anchors the voting window of a challenge, so it is
            // consensus relevant and may not be rewritten on the way to passed.
            if u64_of(input.origin_block_number()) != u64_of(output.origin_block_number()) {
                return Err(Error::ProposalDataInvalid);
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
    // `vote_duration` is a block count, directly comparable with the block
    // number carried by the relative `since` of the proposal input.
    if elapsed <= config.vote_duration {
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
    if !config.is_always_success_lock(&lock) {
        return Err(Error::AlwaysSuccessLockRequired);
    }

    // The origin anchors the voting window of a challenge: a challenge measures
    // its "NO" votes from the block that created the *original* proposal cell,
    // which is exactly the open cell being consumed here. ckb-vm resolves that
    // block from the header listed in `header_deps`.
    let origin = proposal::block_number_of(0, Source::GroupInput)?;
    if u64_of(output.origin_block_number()) != origin {
        return Err(Error::ProposalDataInvalid);
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
    #[cfg(feature = "enable_log")]
    log!(
        Level::Info,
        "the proposal is finalized: {} YES shannons certified by {} counting cell(s)",
        tally.total_amount,
        tally.count
    );
    Ok(())
}

/// Settles a proposal by consuming it without any proposal output.
fn settle(script: &Script, config_id: &[u8; CONFIG_ID_LEN]) -> Result<(), Error> {
    let config = Config::load(config_id)?;
    let proposal = read_proposal_data(Source::GroupInput)?;

    match proposal.status().as_slice()[0] {
        // Receiving the assets: the passed proposal is consumed entirely and the
        // transaction has to deliver `requested_amount` to `recipient_lock_hash`.
        // The assets themselves come from the treasury, which is out of scope.
        status::PROPOSAL_STATUS_PASSED => grant(&proposal),
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
                #[cfg(feature = "enable_log")]
                warn!("the administrator vetoed the finalized proposal");
                return Ok(());
            }
            // 2. A challenger wins by collecting at least as much "NO" weight
            //    as the certified "YES" votes; the bond is the incentive.
            let tally = collect_counting_cells(script, &config, status::DIRECTION_NO)?;
            if tally.count > 0 && tally.total_amount >= u64_of(proposal.total_yes()) {
                // The challenger is the owner of the "NO" certificates, so the
                // bond has to reach a lock script one of them uses; otherwise
                // the challenge would be settled for somebody else's benefit.
                if !challenge_reward_present(&tally)? {
                    #[cfg(feature = "enable_log")]
                    warn!(
                        "the challenge does not pay the lock script of any of its counting cells"
                    );
                    return Err(Error::ChallengeRewardMissing);
                }
                #[cfg(feature = "enable_log")]
                warn!(
                    "the proposal was challenged: {} NO shannons against {} YES shannons",
                    tally.total_amount,
                    u64_of(proposal.total_yes())
                );
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

/// Receives the assets of a passed proposal.
///
/// The proposal cell is consumed entirely (this branch is the `1 in / 0 out`
/// one: no proposal output may be created), and the transaction has to deliver
/// the grant to the recipient: an output whose lock script hashes to
/// `recipient_lock_hash` and that holds at least `requested_amount`.
///
/// The assets themselves come from a treasury provider, which is not described
/// in the specification and therefore not checked here.
fn grant(proposal: &ProposalCellData) -> Result<(), Error> {
    let requested_amount = u64_of(proposal.requested_amount());
    // `recipient_lock_hash` is 20 bytes: the ckb-blake160-hash of the recipient
    // lock script, that is the leading bytes of the ckb-hash of that script.
    let mut recipient_lock_hash = [0u8; RECIPIENT_LOCK_HASH_LEN];
    recipient_lock_hash.copy_from_slice(proposal.recipient_lock_hash().as_slice());

    let mut recipient_found = false;
    for (index, lock_hash) in QueryIter::new(load_cell_lock_hash, Source::Output).enumerate() {
        if lock_hash[..RECIPIENT_LOCK_HASH_LEN] != recipient_lock_hash {
            continue;
        }
        recipient_found = true;
        let capacity =
            load_cell_capacity(index, Source::Output).map_err(|_| Error::SyscallError)?;
        if capacity >= requested_amount {
            #[cfg(feature = "enable_log")]
            log!(
                Level::Info,
                "the passed proposal is settled: {} shannons delivered to the recipient",
                requested_amount
            );
            return Ok(());
        }
    }

    if recipient_found {
        Err(Error::RecipientAmountTooSmall)
    } else {
        Err(Error::RecipientOutputMissing)
    }
}

/// The aggregation of the counting cells referenced by a transaction.
struct Tally {
    /// The sum of the `vote_amount` fields of the counting cells.
    total_amount: u64,
    /// How many counting cells were found.
    count: usize,
    /// The lock script hash of every counting cell that was found.
    ///
    /// A counting cell is created and owned by the party that collects the
    /// votes, so its lock script identifies the initiator ("YES") or the
    /// challenger ("NO").
    lock_hashes: Vec<[u8; 32]>,
}

/// Collects the counting cells of `direction` referenced by this transaction.
///
/// Counting cells may be consumed (inputs) or merely referenced (cell deps);
/// both are accepted, the design only requires them to accompany the proposal
/// cell. Each counting cell is a certificate that was validated by the counting
/// type script when it was created, so summing their `vote_amount` is enough.
///
/// The hash ranges of the cells must not overlap: two ranges `[h1, h2]` and
/// `[h3, h4]` overlap when some value satisfies `h1 <= v <= h2` and
/// `h3 <= v <= h4`. That is what makes the sum meaningful, since a voter whose
/// lock hash prefix belongs to both ranges could otherwise be counted twice.
fn collect_counting_cells(script: &Script, config: &Config, direction: u8) -> Result<Tally, Error> {
    // The counting cells point back at this very proposal cell.
    let proposal_id = hash::script_id(script);
    let mut ranges: Vec<range::HashRange> = Vec::new();
    let mut lock_hashes: Vec<[u8; 32]> = Vec::new();
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
            // Every hash range has to satisfy `start_hash <= end_hash`;
            // `HashRange::new` enforces it.
            let hash_range = read_hash_range(&counting)?;
            ranges.push(hash_range);
            lock_hashes
                .push(load_cell_lock_hash(index, source).map_err(|_| Error::CountingCellInvalid)?);
            total_amount = total_amount
                .checked_add(u64_of(counting.vote_amount()))
                .ok_or(Error::AmountOverflow)?;
        }
    }

    if range::any_overlap(&mut ranges) {
        return Err(Error::CountingRangeOverlap);
    }

    Ok(Tally {
        total_amount,
        count: ranges.len(),
        lock_hashes,
    })
}

/// Tells whether the transaction pays one of the counting cells' lock scripts,
/// that is whether the challenger receives the bond.
///
/// `docs/proposal-type-script-spec.md`, "Updating to be challenged": *"The
/// receiver's lock script should be one of lock script used in counting
/// cells."* The counting cells are the challenger's certificates and are
/// controlled by their creator, so their lock script is the identity that is
/// allowed to collect the incentive.
fn challenge_reward_present(tally: &Tally) -> Result<bool, Error> {
    Ok(QueryIter::new(load_cell_lock_hash, Source::Output)
        .any(|lock_hash| tally.lock_hashes.contains(&lock_hash)))
}

/// Tells whether the voting and the challenge windows have elapsed, which is
/// when the bond of a proposal that did not pass can be recycled.
fn recycle_elapsed(config: &Config) -> Result<bool, Error> {
    let since = load_input_since(0, Source::GroupInput).map_err(|_| Error::SyscallError)?;
    let elapsed = since::relative_block_number(since)?;
    // Both config fields are block counts.
    let total = config
        .vote_duration
        .checked_add(config.challenge_time)
        .ok_or(Error::AmountOverflow)?;
    Ok(elapsed > total)
}

/// Tells whether one of the input lock scripts is the administrator's veto lock.
fn vetoed(config: &Config) -> Result<bool, Error> {
    Ok(QueryIter::new(load_cell_lock_hash, Source::Input)
        .any(|lock_hash| lock_hash == config.veto_lock_script_hash))
}

fn read_proposal_data(source: Source) -> Result<ProposalCellData, Error> {
    let data = load_cell_data(0, source).map_err(|_| Error::ProposalDataInvalid)?;
    ProposalCellData::from_slice(&data).map_err(|_| Error::ProposalDataInvalid)
}

/// Reads the inclusive hash range `[start_hash, end_hash]` of a counting cell.
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
