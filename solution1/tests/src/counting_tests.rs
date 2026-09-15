//! Unit tests for the counting type script.
//!
//! A counting cell is a certificate: it aggregates the vote cells inside its
//! hash range into a single `vote_amount`. Counting cells are immutable - they
//! may only be created or consumed - and are referenced by the proposal script
//! when a proposal is finalized or challenged. Every test names the rule of
//! `docs/counting-type-script-spec.md` it covers.

use crate::helpers::{
    CERTIFICATE_CAPACITY, FUNDING_CAPACITY, Fixture, MAX_CYCLES, ONE_CKB, PlacedCell, Proposal,
    VOTE_AMOUNT, VOTE_DURATION, VOTE_WINDOW, VoteSpec, assert_script_error, counting_data, dep,
    lock_prefix,
};
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{TransactionBuilder, TransactionView},
    packed::*,
    prelude::*,
};
use ckb_vote_common::{error::Error, status};

// --------------------------------------------------------------------------
// Assemblers
// --------------------------------------------------------------------------

/// The knobs of a counting cell creation.
struct CountPlan {
    /// The proposal cell this counting cell points at.
    proposal: Proposal,
    /// Whether the proposal cell is referenced through `cell_deps`.
    proposal_dep: bool,
    /// Whether the proposal's header is listed in `header_deps`.
    proposal_header: bool,
    direction: u8,
    start_hash: u16,
    end_hash: u16,
    amount: u64,
    /// Raw counting payload; `None` builds a well formed one.
    data: Option<Bytes>,
    /// Raw script args; `None` uses `blake160(proposal type script)`.
    args: Option<Bytes>,
    /// The vote cells to create and reference through `cell_deps`.
    votes: Vec<VoteSpec>,
    /// Extra cell deps, used for hand built vote cells.
    extra_deps: Vec<OutPoint>,
}

/// An open proposal plus a valid counting plan: a single vote cell created in
/// the proposal's own block, inside a range that holds exactly the voter's lock
/// hash prefix.
fn counting_setup(fixture: &mut Fixture) -> (Proposal, CountPlan) {
    let spec = fixture.proposal_spec();
    let proposal = fixture.proposal_cell(&spec);
    let prefix = lock_prefix(&fixture.voter_lock);
    let mut vote = fixture.vote_spec(&proposal);
    vote.block = Some(proposal.block_number);
    let plan = CountPlan {
        proposal: proposal.clone(),
        proposal_dep: true,
        proposal_header: true,
        direction: status::DIRECTION_YES,
        start_hash: prefix,
        end_hash: prefix,
        amount: VOTE_AMOUNT,
        data: None,
        args: None,
        votes: vec![vote],
        extra_deps: Vec::new(),
    };
    (proposal, plan)
}

/// A vote cell created `offset` blocks after the proposal.
fn vote_at(fixture: &Fixture, proposal: &Proposal, offset: u64) -> VoteSpec {
    let mut spec = fixture.vote_spec(proposal);
    spec.block = Some(proposal.block_number + offset);
    spec
}

/// Assembles the counting cell creation transaction described by `plan`.
fn counting_tx(fixture: &mut Fixture, plan: &CountPlan) -> TransactionView {
    let lock = fixture.lock.clone();
    let funding = fixture.funding_cell(&lock, FUNDING_CAPACITY);
    let config_cell = fixture.config_cell.clone();
    let out_point = fixture.counting_out_point.clone();
    let args = plan
        .args
        .clone()
        .unwrap_or_else(|| plan.proposal.id.to_vec().into());
    let script = fixture.script(&out_point, args);
    let data = plan.data.clone().unwrap_or_else(|| {
        counting_data(plan.start_hash, plan.end_hash, plan.direction, plan.amount)
    });

    // The referenced vote cells have to exist on chain before the transaction
    // can list them in `cell_deps`.
    let votes: Vec<PlacedCell> = plan
        .votes
        .iter()
        .map(|spec| fixture.vote_cell(spec))
        .collect();

    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CERTIFICATE_CAPACITY)
            .lock(lock.clone())
            .type_(Some(script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let mut builder = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .cell_dep(dep(&config_cell));
    let mut header_deps = Vec::new();
    if plan.proposal_dep {
        builder = builder.cell_dep(dep(&plan.proposal.out_point));
        if plan.proposal_header {
            header_deps.push(plan.proposal.block_hash.clone());
        }
    }
    for cell in &votes {
        builder = builder.cell_dep(dep(&cell.out_point));
        if let Some(hash) = &cell.block_hash {
            header_deps.push(hash.clone());
        }
    }
    for cell in &plan.extra_deps {
        builder = builder.cell_dep(dep(cell));
    }

    let tx = builder
        .header_deps(Fixture::header_deps(header_deps))
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Assembles a transaction that consumes a counting cell and creates no new
/// one.
fn consume_tx(fixture: &mut Fixture, counting: &OutPoint) -> TransactionView {
    let lock = fixture.lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CERTIFICATE_CAPACITY)
            .lock(lock)
            .build(),
    ];
    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(counting.clone())
                .build(),
        )
        .outputs(outputs)
        .outputs_data([Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Assembles a transaction that rewrites a counting cell in place.
fn rewrite_tx(
    fixture: &mut Fixture,
    script: Script,
    input: &OutPoint,
    data: Bytes,
) -> TransactionView {
    let lock = fixture.lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CERTIFICATE_CAPACITY)
            .lock(lock.clone())
            .type_(Some(script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];
    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input.clone())
                .build(),
        )
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Creates a counting cell on chain from `plan` and returns it with its type
/// script.
fn place_counting(fixture: &mut Fixture, plan: &CountPlan) -> (OutPoint, Script) {
    let args: Bytes = plan
        .args
        .clone()
        .unwrap_or_else(|| plan.proposal.id.to_vec().into());
    let script = {
        let out_point = fixture.counting_out_point.clone();
        fixture.script(&out_point, args)
    };
    let data = plan.data.clone().unwrap_or_else(|| {
        counting_data(plan.start_hash, plan.end_hash, plan.direction, plan.amount)
    });
    let lock = fixture.lock.clone();
    let out_point = fixture.create_cell(&lock, CERTIFICATE_CAPACITY, Some(script.clone()), data);
    (out_point, script)
}

// --------------------------------------------------------------------------
// Creating
// --------------------------------------------------------------------------

/// Spec: counting, "Processing" - the counting cell aggregates the vote cells
/// inside its hash range; both bounds are inclusive, so a range of exactly the
/// voter's lock hash prefix is accepted.
#[test]
fn test_create_counting_cell() {
    let mut fixture = Fixture::new();
    let (_, plan) = counting_setup(&mut fixture);
    let tx = counting_tx(&mut fixture, &plan);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the counting cell aggregates the vote");
    println!("consume cycles: {}", cycles);
}

/// Spec: counting, "Others" - collecting "no" votes is not tied to the open
/// phase: the challenger counts the "NO" votes against the finalized proposal
/// cell, which only exists after voting ended. The window is anchored at
/// `origin_block_number`, the block that created the original proposal cell, so
/// the earlier votes stay countable.
#[test]
fn test_create_counting_cell_for_a_finalized_proposal() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_FINALIZED;
    // The finalized cell replaces the open one only after `vote_duration`
    // blocks, so it lives at a block later than every vote.
    spec.block = proposal.block_number + VOTE_DURATION + 1;
    // ... and it records the block that created the original proposal cell.
    spec.origin_block_number = proposal.block_number;
    let finalized = fixture.proposal_cell(&spec);
    // The proposal type script is unique, so `id` does not change; the "NO"
    // counting cell is collected during the challenge phase.
    plan.proposal = finalized.clone();
    plan.direction = status::DIRECTION_NO;
    for vote in &mut plan.votes {
        vote.proposal_id = finalized.id;
        vote.direction = status::DIRECTION_NO;
    }
    let tx = counting_tx(&mut fixture, &plan);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("a finalized proposal can be counted for a challenge");
    println!("consume cycles: {}", cycles);
}

/// Spec: counting, "Others" - when a finalized proposal cell is referenced the
/// window is measured from `origin_block_number`, not from the block that
/// created the finalized cell: a vote cast exactly `config.vote_window` blocks
/// after the original proposal is outside the window, even though it predates
/// the finalized cell by many blocks.
#[test]
fn test_counting_finalized_window_anchored_at_origin() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_FINALIZED;
    spec.block = proposal.block_number + VOTE_DURATION + 1;
    spec.origin_block_number = proposal.block_number;
    let finalized = fixture.proposal_cell(&spec);
    plan.proposal = finalized.clone();
    plan.direction = status::DIRECTION_NO;
    plan.votes = vec![vote_at(&fixture, &proposal, VOTE_WINDOW)];
    for vote in &mut plan.votes {
        vote.proposal_id = finalized.id;
        vote.direction = status::DIRECTION_NO;
    }
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteOutsideWindow);
}

/// Spec: counting, "Others" - a "YES" counting cell has to reference the
/// proposal cell, so counting "YES" votes against a finalized proposal cell is
/// rejected; only "NO" votes may be collected during the challenge phase.
#[test]
fn test_counting_yes_for_finalized_proposal_invalid() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_FINALIZED;
    spec.block = proposal.block_number + VOTE_DURATION + 1;
    spec.origin_block_number = proposal.block_number;
    let finalized = fixture.proposal_cell(&spec);
    // The proposal type script is unique, so `id` does not change; the "YES"
    // counting cell still has to point at the open proposal cell.
    plan.proposal = finalized.clone();
    for vote in &mut plan.votes {
        vote.proposal_id = finalized.id;
    }
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(
        &fixture.context,
        &tx,
        Error::ProposalStatusInvalidForCounting,
    );
}

/// Spec: counting, "Script" - the args are 20 bytes, the ckb-blake160-hash of
/// the proposal type script.
#[test]
fn test_counting_args_length() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.args = Some(Bytes::from(vec![0u8; 19]));
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::ArgsInvalid);
}

/// Spec: counting, "Cell Data" - the payload has to decode as a `Counting`.
#[test]
fn test_counting_data_malformed() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    // Hand written bytes: a 4 byte payload cannot be a `Counting` table.
    plan.data = Some(Bytes::from(vec![0xffu8; 4]));
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::CountingDataInvalid);
}

/// Spec: counting, "Cell Data" - `direction` is 0 ("NO") or 1 ("YES").
#[test]
fn test_counting_direction_invalid() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.direction = 2;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::CountingDataInvalid);
}

/// Spec: counting, "Cell Data" - `start_hash` and `end_hash` form the inclusive
/// range `[start_hash, end_hash]`, so `start_hash > end_hash` is empty and
/// invalid.
#[test]
fn test_counting_range_invalid() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.start_hash = 10;
    plan.end_hash = 5;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::CountingRangeInvalid);
}

/// Spec: counting, "Processing" - the proposal whose ckb-blake160-hash matches
/// `args` must be found in `cell_deps`.
#[test]
fn test_counting_proposal_missing() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.proposal_dep = false;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::ProposalCellNotFound);
}

/// Spec: counting, "Others" - a "YES" counting cell has to reference the
/// proposal cell; a passed proposal can no longer be counted.
#[test]
fn test_counting_proposal_status_invalid() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_PASSED;
    let passed = fixture.proposal_cell(&spec);
    plan.proposal = passed.clone();
    for vote in &mut plan.votes {
        vote.proposal_id = passed.id;
    }
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(
        &fixture.context,
        &tx,
        Error::ProposalStatusInvalidForCounting,
    );
}

/// Spec: counting, "Processing" - the header of a referenced cell must be
/// listed in `header_deps`, otherwise its block number cannot be trusted.
#[test]
fn test_counting_missing_header_dep() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    // The vote cell sits in another block, so only the vote header ends up in
    // `header_deps`; the proposal cell is linked to block 100 but its header is
    // not listed, so its block number cannot be read.
    plan.votes = vec![vote_at(&fixture, &proposal, 1)];
    plan.proposal_header = false;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::HeaderMissing);
}

/// Spec: config, "Cell Data" - `emergent_halt` halts every voting script, so a
/// halted config cell makes the counting script fail.
#[test]
fn test_counting_halted() {
    let mut fixture = Fixture::new();
    fixture.config.emergent_halt = 1;
    fixture.refresh_config_cell();
    let (_, plan) = counting_setup(&mut fixture);
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::EmergentHalt);
}

/// Spec: counting, "Processing" - a vote cell must point back at the proposal
/// of the counting cell.
#[test]
fn test_counting_vote_proposal_mismatch() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.votes[0].proposal_id = [0x44u8; 20];
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteCellProposalMismatch);
}

/// Spec: counting, "Processing" - the `direction` of every vote cell must equal
/// the `direction` of the counting cell.
#[test]
fn test_counting_direction_mismatch() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.votes[0].direction = status::DIRECTION_NO;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteDirectionMismatch);
}

/// Spec: counting, "Processing" - the first two bytes of the voter's lock hash
/// have to fall inside `[start_hash, end_hash]`.
#[test]
fn test_counting_vote_lock_out_of_range() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    // One above the voter's lock hash prefix: the range excludes it.
    let outside = if plan.start_hash == u16::MAX {
        plan.start_hash - 1
    } else {
        plan.start_hash + 1
    };
    plan.start_hash = outside;
    plan.end_hash = outside;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteLockOutOfRange);
}

/// Spec: counting, "Processing" - a vote is only valid inside
/// `config.vote_window`; a vote cast exactly `vote_window` blocks after the
/// proposal is outside the window.
#[test]
fn test_counting_vote_outside_window() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    plan.votes = vec![vote_at(&fixture, &proposal, VOTE_WINDOW)];
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteOutsideWindow);
}

/// Spec: counting, "Processing" - the sum of the vote cells must equal the
/// `vote_amount` of the counting cell.
#[test]
fn test_counting_amount_mismatch() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.amount = VOTE_AMOUNT + 1;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteAmountMismatch);
}

/// Spec: counting, "Processing" - all voter locks inside a counting cell must
/// be unique, otherwise the same voter is counted twice.
#[test]
fn test_counting_duplicate_voter() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    let vote = plan.votes[0].clone();
    plan.votes = vec![vote.clone(), vote];
    plan.amount = 2 * VOTE_AMOUNT;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteLockNotUnique);
}

/// Spec: counting, "Processing" - at least one vote cell has to be referenced,
/// otherwise there is nothing to count.
#[test]
fn test_counting_no_vote_cell() {
    let mut fixture = Fixture::new();
    let (_, mut plan) = counting_setup(&mut fixture);
    plan.votes = Vec::new();
    plan.amount = 0;
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteCellMissing);
}

/// Spec: counting, "Processing" - a referenced vote cell must hold a well
/// formed `Vote`.
#[test]
fn test_counting_vote_cell_invalid() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = counting_setup(&mut fixture);
    // Hand written bytes: a vote cell whose payload cannot be decoded.
    let script = fixture.vote_script(proposal.id);
    let voter_lock = fixture.voter_lock.clone();
    let bad_vote = fixture.create_cell(
        &voter_lock,
        CERTIFICATE_CAPACITY,
        Some(script),
        Bytes::from(vec![0xffu8; 4]),
    );
    plan.votes = Vec::new();
    plan.extra_deps = vec![bad_vote];
    let tx = counting_tx(&mut fixture, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteCellInvalid);
}

// --------------------------------------------------------------------------
// Consuming and rewriting
// --------------------------------------------------------------------------

/// Spec: counting, "Others" - a counting cell can be consumed, which recycles
/// its capacity.
#[test]
fn test_consume_counting_cell() {
    let mut fixture = Fixture::new();
    let (_, plan) = counting_setup(&mut fixture);
    let (counting, _) = place_counting(&mut fixture, &plan);
    let tx = consume_tx(&mut fixture, &counting);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the counting cell is consumed");
    println!("consume cycles: {}", cycles);
}

/// Spec: counting, "Processing" - a counting cell is immutable: rewriting it
/// with `1 in / 1 out` is rejected.
#[test]
fn test_rewrite_counting_cell() {
    let mut fixture = Fixture::new();
    let (_, plan) = counting_setup(&mut fixture);
    let (counting, script) = place_counting(&mut fixture, &plan);
    let data = counting_data(plan.start_hash, plan.end_hash, plan.direction, plan.amount);
    let tx = rewrite_tx(&mut fixture, script, &counting, data);

    assert_script_error(&fixture.context, &tx, Error::CountingCellTransitionInvalid);
}

/// Spec: counting, "Processing" - consuming more than one counting cell of the
/// same proposal at once is still a consumption, not a rewrite.
#[test]
fn test_consume_two_counting_cells() {
    let mut fixture = Fixture::new();
    let (_, plan) = counting_setup(&mut fixture);
    let (first, _) = place_counting(&mut fixture, &plan);
    let (second, _) = place_counting(&mut fixture, &plan);
    let lock = fixture.lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CERTIFICATE_CAPACITY)
            .lock(lock)
            .build(),
    ];
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(first).build())
        .input(CellInput::new_builder().previous_output(second).build())
        .outputs(outputs)
        .outputs_data([Bytes::new()].pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("counting cells are consumed");
    println!("consume cycles: {}", cycles);
}
