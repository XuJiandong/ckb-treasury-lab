//! Unit tests for the proposal type script.
//!
//! A proposal goes through `open -> finalized -> passed` and is finally settled
//! by receiving its grant, by a challenge, by a veto or by recycling it. Every
//! test names the rule of `docs/proposal-type-script-spec.md` it covers and
//! quotes the section it belongs to.

use crate::helpers::{
    CHALLENGE_TIME, FUNDING_CAPACITY, Fixture, MAX_CYCLES, MINIMAL_PROPOSAL_CAPACITY, ONE_CKB,
    PlacedCell, Proposal, ProposalOutput, VOTE_AMOUNT, VOTE_DURATION, YES_THRESHOLD,
    absolute_since, assert_script_error, dep, proposal_args, proposal_data, relative_since,
    relative_timestamp_since,
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

/// Creates a funding input and the proposal type script that follows the Type
/// ID rule for output #0 of the creating transaction.
fn creation_input(fixture: &mut Fixture) -> (CellInput, Script) {
    let lock = fixture.lock.clone();
    let funding = fixture.funding_cell(&lock, FUNDING_CAPACITY);
    let first_input = CellInput::new_builder().previous_output(funding).build();
    let script = fixture.proposal_script_for_creation(&first_input, 0);
    (first_input, script)
}

/// Assembles a proposal creation transaction.
fn create_tx(
    fixture: &mut Fixture,
    first_input: CellInput,
    script: Script,
    capacity: u64,
    data: Bytes,
    with_config: bool,
) -> TransactionView {
    let lock = fixture.lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(capacity)
            .lock(lock.clone())
            .type_(Some(script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let mut builder = TransactionBuilder::default()
        .input(first_input)
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack());
    if with_config {
        let config_cell = fixture.config_cell.clone();
        builder = builder.cell_dep(dep(&config_cell));
    }
    fixture.context.complete_tx(builder.build())
}

/// Assembles a `1 in / 1 out` proposal update (`open -> finalized` or
/// `finalized -> passed`).
fn update_tx(
    fixture: &mut Fixture,
    proposal: &Proposal,
    since: u64,
    output: &ProposalOutput,
    counting: &[PlacedCell],
) -> TransactionView {
    let lock = fixture.lock.clone();
    let config_cell = fixture.config_cell.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(output.capacity)
            .lock(output.lock.clone())
            .type_(Some(proposal.script.clone()).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];
    let data = proposal_data(
        output.status,
        output.requested_amount,
        output.recipient_lock_hash,
        output.total_yes,
        output.origin_block_number,
    );

    let mut headers = vec![proposal.block_hash.clone()];
    let mut builder = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(proposal.out_point.clone())
                .since(since)
                .build(),
        )
        .cell_dep(dep(&config_cell))
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack());
    for cell in counting {
        builder = builder.cell_dep(dep(&cell.out_point));
        if let Some(hash) = &cell.block_hash {
            headers.push(hash.clone());
        }
    }
    let builder = builder.header_deps(Fixture::header_deps(headers).pack());
    fixture.context.complete_tx(builder.build())
}

/// Assembles a `1 in / 0 out` settlement of `proposal`.
fn settle_tx(
    fixture: &mut Fixture,
    proposal: &Proposal,
    since: u64,
    outputs: Vec<CellOutput>,
    outputs_data: Vec<Bytes>,
    extra_deps: &[PlacedCell],
) -> TransactionView {
    let config_cell = fixture.config_cell.clone();
    let mut headers = Vec::new();
    let mut builder = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(proposal.out_point.clone())
                .since(since)
                .build(),
        )
        .cell_dep(dep(&config_cell))
        .outputs(outputs)
        .outputs_data(outputs_data.pack());
    for cell in extra_deps {
        builder = builder.cell_dep(dep(&cell.out_point));
        if let Some(hash) = &cell.block_hash {
            headers.push(hash.clone());
        }
    }
    if !headers.is_empty() {
        builder = builder.header_deps(Fixture::header_deps(headers).pack());
    }
    fixture.context.complete_tx(builder.build())
}

/// A plain output locked by the fixture's default lock.
fn change_output(fixture: &Fixture) -> CellOutput {
    CellOutput::new_builder()
        .capacity(ONE_CKB)
        .lock(fixture.lock.clone())
        .build()
}

/// Creates an open proposal with the default fixture values.
fn open_proposal(fixture: &mut Fixture) -> Proposal {
    let spec = fixture.proposal_spec();
    fixture.proposal_cell(&spec)
}

/// Creates a proposal with a caller chosen status.
fn proposal_with_status(fixture: &mut Fixture, status: u8, total_yes: u64) -> Proposal {
    let mut spec = fixture.proposal_spec();
    spec.status = status;
    spec.total_yes = total_yes;
    // A directly created finalized / passed cell is its own origin.
    spec.origin_block_number = spec.block;
    fixture.proposal_cell(&spec)
}

/// A counting cell that certifies `amount` shannons of "YES" votes.
fn yes_counting(fixture: &mut Fixture, proposal: &Proposal, amount: u64) -> PlacedCell {
    let mut spec = fixture.counting_spec(proposal);
    spec.vote_amount = amount;
    fixture.counting_cell(&spec)
}

/// A counting cell that certifies `amount` shannons of "NO" votes.
fn no_counting(fixture: &mut Fixture, proposal: &Proposal, amount: u64) -> PlacedCell {
    let mut spec = fixture.counting_spec(proposal);
    spec.direction = status::DIRECTION_NO;
    spec.vote_amount = amount;
    fixture.counting_cell(&spec)
}

/// The update output of a successful `open -> finalized` transition.
fn finalized_output(fixture: &Fixture, proposal: &Proposal, total_yes: u64) -> ProposalOutput {
    let mut output = fixture.proposal_output(proposal);
    output.status = status::PROPOSAL_STATUS_FINALIZED;
    output.total_yes = total_yes;
    // The finalized cell records the block that created the open proposal cell.
    output.origin_block_number = proposal.block_number;
    output
}

// --------------------------------------------------------------------------
// Creating
// --------------------------------------------------------------------------

/// Spec: proposal, "Creating" - a proposal is created with `status = 0`,
/// `total_yes = 0` and at least `config.minimal_proposal_capacity` shannons.
/// The capacity is exactly the minimum here, which is the accepted boundary.
#[test]
fn test_create_proposal() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("a well formed proposal cell is created");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Creating" - the `args` tail follows the Type ID rule: the
/// Type ID of another output index is rejected.
#[test]
fn test_create_proposal_requires_the_type_id() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, _) = creation_input(&mut fixture);
    // The cell is created at output #0, but the args carry the id of #1.
    let config_script = fixture.config_script.clone();
    let args = proposal_args(&config_script, &first_input, 1);
    let script = fixture.proposal_script_with_args(args);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::TypeIdInvalid);
}

/// Spec: proposal, "Script" - the args are 20 bytes of config id plus 20 bytes
/// of Type ID, so any other length is malformed.
#[test]
fn test_create_proposal_args_length() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, _) = creation_input(&mut fixture);
    let script = fixture.proposal_script_with_args(Bytes::from(vec![0u8; 39]));
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::ArgsInvalid);
}

/// Spec: proposal, "Creating" - the new cell must be in the `proposal` status.
#[test]
fn test_create_proposal_wrong_status() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    // A brand new cell already claiming to be finalized.
    let data = proposal_data(
        status::PROPOSAL_STATUS_FINALIZED,
        VOTE_AMOUNT,
        recipient,
        0,
        0,
    );
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalStatusInvalid);
}

/// Spec: proposal, "Creating" - `total_yes` starts at 0.
#[test]
fn test_create_proposal_nonzero_total_yes() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 1, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalDataInvalid);
}

/// Spec: proposal, "Creating" - `origin_block_number` starts at 0; only the
/// finalize transition fills it in.
#[test]
fn test_create_proposal_nonzero_origin() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 1);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalDataInvalid);
}

/// Spec: proposal, "Creating" - the capacity is the bond and must be greater
/// than or equal to `config.minimal_proposal_capacity`; one shannon less is
/// rejected.
#[test]
fn test_create_proposal_bond_too_small() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY - 1,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalCapacityTooSmall);
}

/// Spec: proposal, "Script" - the proposal points at its config cell through
/// `blake160(config type script)`, so a transaction that does not carry that
/// cell dep cannot create the proposal.
#[test]
fn test_create_proposal_requires_its_config_cell() {
    let mut fixture = Fixture::new();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    // The config cell exists on chain but is not referenced.
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        false,
    );

    assert_script_error(&fixture.context, &tx, Error::ConfigCellNotFound);
}

/// Spec: config, "Cell Data" - `emergent_halt` halts the whole system, so a
/// halted config cell makes the proposal script fail as well.
#[test]
fn test_create_proposal_halted() {
    let mut fixture = Fixture::new();
    fixture.config.emergent_halt = 1;
    fixture.refresh_config_cell();
    let recipient = fixture.recipient_lock_hash();
    let (first_input, script) = creation_input(&mut fixture);
    let data = proposal_data(status::PROPOSAL_STATUS_OPEN, VOTE_AMOUNT, recipient, 0, 0);
    let tx = create_tx(
        &mut fixture,
        first_input,
        script,
        MINIMAL_PROPOSAL_CAPACITY,
        data,
        true,
    );

    assert_script_error(&fixture.context, &tx, Error::EmergentHalt);
}

// --------------------------------------------------------------------------
// Updating to be finalized
// --------------------------------------------------------------------------

/// Spec: proposal, "Updating to be finalized" - after `config.vote_duration`
/// blocks the proposal is finalized: enough "YES" shannons are certified, the
/// bond is preserved, the output lock is `always success` and `total_yes`
/// records the sum.
#[test]
fn test_finalize_proposal() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let counting = yes_counting(&mut fixture, &proposal, YES_THRESHOLD);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[counting],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the proposal is finalized");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Updating to be finalized" - votes may only be collected once
/// `config.vote_duration` blocks elapsed since the proposal was created, so a
/// counting cell created exactly at `proposal_block + vote_duration` is early.
#[test]
fn test_finalize_counting_cell_created_too_early() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut spec = fixture.counting_spec(&proposal);
    spec.block = Some(proposal.block_number + VOTE_DURATION);
    let counting = fixture.counting_cell(&spec);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::CountingCellTooEarly);
}

/// Spec: proposal, "Updating to be finalized" - the `since` must be larger than
/// `config.vote_duration`; exactly `vote_duration` blocks is not enough.
#[test]
fn test_finalize_equal_vote_duration() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::VoteDurationNotElapsed);
}

/// Spec: proposal, "Updating to be finalized" - the `since` must be relative;
/// an absolute `since` is not a block count.
#[test]
fn test_finalize_absolute_since() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        absolute_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::SinceInvalid);
}

/// Spec: proposal, "Updating to be finalized" - the `since` must use the block
/// number metric; a relative timestamp cannot be compared with
/// `config.vote_duration`.
#[test]
fn test_finalize_non_block_metric_since() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_timestamp_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::SinceInvalid);
}

/// Spec: proposal, "Updating to be finalized" - the input capacity must equal
/// the output capacity: the bond is the challenger's incentive.
#[test]
fn test_finalize_capacity_changed() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.capacity = proposal.capacity + ONE_CKB;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalCapacityChanged);
}

/// Spec: proposal, "Updating to be finalized" - the finalized cell must be
/// locked by the configured `always success` lock so that anyone can challenge
/// it.
#[test]
fn test_finalize_requires_always_success_lock() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.lock = fixture.foreign_lock();
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::AlwaysSuccessLockRequired);
}

/// Spec: proposal, "Updating to be finalized" - at least one counting cell has
/// to be referenced, otherwise the result of the vote is unknown.
#[test]
fn test_finalize_requires_a_counting_cell() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let output = finalized_output(&fixture, &proposal, 0);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::CountingCellMissing);
}

/// Spec: proposal, "Updating to be finalized" - the sum of the "YES" counting
/// cells is below `config.yes_threshold`, so the proposal cannot be finalized.
#[test]
fn test_finalize_yes_threshold_not_met() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let counting = yes_counting(&mut fixture, &proposal, YES_THRESHOLD - 1);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD - 1);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::YesThresholdNotMet);
}

/// Spec: proposal, "Updating to be finalized" - `total_yes` has to be the sum
/// of the counting cells, not an arbitrary number.
#[test]
fn test_finalize_total_yes_must_be_the_sum() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let counting = yes_counting(&mut fixture, &proposal, YES_THRESHOLD);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD + 1);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalDataInvalid);
}

/// Spec: proposal, "Updating to be finalized" - `origin_block_number` has to be
/// the block that created the proposal cell, not an arbitrary number: it
/// anchors the "NO" voting window of a challenge.
#[test]
fn test_finalize_origin_mismatch() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let counting = yes_counting(&mut fixture, &proposal, YES_THRESHOLD);
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.origin_block_number = proposal.block_number - 1;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalDataInvalid);
}

/// Spec: proposal, "Updating to be finalized" - the hash ranges of the counting
/// cells must not overlap, otherwise a voter could be counted twice.
#[test]
fn test_finalize_overlapping_ranges() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut first = fixture.counting_spec(&proposal);
    first.start_hash = 0;
    first.end_hash = 10;
    first.vote_amount = 300;
    let first = fixture.counting_cell(&first);
    let mut second = fixture.counting_spec(&proposal);
    // [10, 20] shares the bound 10 with [0, 10].
    second.start_hash = 10;
    second.end_hash = 20;
    second.vote_amount = 300;
    let second = fixture.counting_cell(&second);
    let output = finalized_output(&fixture, &proposal, 600);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[first, second],
    );

    assert_script_error(&fixture.context, &tx, Error::CountingRangeOverlap);
}

/// Spec: proposal, "Updating to be finalized" - a counting cell must point back
/// at this very proposal through `blake160(proposal type script)`.
#[test]
fn test_finalize_rejects_a_foreign_counting_cell() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut spec = fixture.counting_spec(&proposal);
    spec.proposal_id = [0x44u8; 20];
    let foreign = fixture.counting_cell(&spec);
    let output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[foreign],
    );

    assert_script_error(&fixture.context, &tx, Error::CountingCellInvalid);
}

/// Spec: proposal, "Updating" - `description`, `requested_amount` and
/// `recipient_lock_hash` are immutable once the proposal is created; only the
/// status and `total_yes` may change.
#[test]
fn test_update_immutable_fields() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    // The voters decided on another amount than the one that is being paid out.
    output.requested_amount = proposal.requested_amount + 1;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalFieldsChanged);
}

/// Spec: proposal, "Updating" - `open -> open` is not a transition: an update
/// must move the status forward.
#[test]
fn test_update_open_to_open_is_rejected() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let mut output = finalized_output(&fixture, &proposal, 0);
    output.status = status::PROPOSAL_STATUS_OPEN;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalStatusInvalid);
}

// --------------------------------------------------------------------------
// Updating to be passed
// --------------------------------------------------------------------------

/// Spec: proposal, "Updating to be passed" - once `config.challenge_time`
/// blocks elapsed since the proposal was finalized, it is passed.
#[test]
fn test_pass_proposal() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.status = status::PROPOSAL_STATUS_PASSED;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(CHALLENGE_TIME + 1),
        &output,
        &[],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the finalized proposal is passed");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Updating to be passed" - the `since` must be larger than
/// `config.challenge_time`; exactly `challenge_time` blocks is not enough.
#[test]
fn test_pass_challenge_time_not_elapsed() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.status = status::PROPOSAL_STATUS_PASSED;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(CHALLENGE_TIME),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ChallengeTimeNotElapsed);
}

/// Spec: proposal, "Updating to be passed" - `challenge_time` is a block count,
/// so a relative `since` with another metric cannot be compared with it.
#[test]
fn test_pass_non_block_metric_since() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.status = status::PROPOSAL_STATUS_PASSED;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_timestamp_since(CHALLENGE_TIME + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::SinceInvalid);
}

/// Spec: proposal, "Updating to be passed" - the `origin_block_number` of the
/// finalized cell is consensus relevant, so it may not be rewritten on the way
/// to passed.
#[test]
fn test_pass_preserves_origin() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let mut output = finalized_output(&fixture, &proposal, YES_THRESHOLD);
    output.status = status::PROPOSAL_STATUS_PASSED;
    output.origin_block_number = proposal.origin_block_number + 1;
    let tx = update_tx(
        &mut fixture,
        &proposal,
        relative_since(CHALLENGE_TIME + 1),
        &output,
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalDataInvalid);
}

// --------------------------------------------------------------------------
// Receiving assets
// --------------------------------------------------------------------------

/// Spec: proposal, "Receiving Assets" - the passed proposal is consumed
/// entirely and the grant reaches `recipient_lock_hash`.
#[test]
fn test_passed_proposal_delivers_the_grant() {
    let mut fixture = Fixture::new();
    let proposal =
        proposal_with_status(&mut fixture, status::PROPOSAL_STATUS_PASSED, YES_THRESHOLD);
    let recipient = fixture.recipient_lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(proposal.requested_amount)
            .lock(recipient)
            .build(),
        change_output(&fixture),
    ];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new(), Bytes::new()],
        &[],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the grant is delivered to the recipient");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Receiving Assets" - without an output for
/// `recipient_lock_hash` the passed proposal cannot be consumed.
#[test]
fn test_passed_proposal_requires_the_recipient_output() {
    let mut fixture = Fixture::new();
    let proposal =
        proposal_with_status(&mut fixture, status::PROPOSAL_STATUS_PASSED, YES_THRESHOLD);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::RecipientOutputMissing);
}

/// Spec: proposal, "Receiving Assets" - the recipient output has to hold at
/// least `requested_amount`; one shannon less is rejected.
#[test]
fn test_passed_proposal_recipient_amount_too_small() {
    let mut fixture = Fixture::new();
    let proposal =
        proposal_with_status(&mut fixture, status::PROPOSAL_STATUS_PASSED, YES_THRESHOLD);
    let recipient = fixture.recipient_lock.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(proposal.requested_amount - 1)
            .lock(recipient)
            .build(),
        change_output(&fixture),
    ];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new(), Bytes::new()],
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::RecipientAmountTooSmall);
}

// --------------------------------------------------------------------------
// Challenges, veto and recycling
// --------------------------------------------------------------------------

/// Spec: proposal, "Updating to be challenged" - a challenger wins when the
/// "NO" counting cells reach at least the certified `total_yes`; the bond is
/// the incentive and the proposal cell is burned.
#[test]
fn test_challenge_proposal() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let counting = no_counting(&mut fixture, &proposal, YES_THRESHOLD);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[counting],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the challenge wins the bond");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Updating to be challenged" - a challenge repeats the
/// finalization rule, so a "NO" counting cell created before the voting duration
/// elapsed is rejected as well.
#[test]
fn test_challenge_counting_cell_created_too_early() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let mut spec = fixture.counting_spec(&proposal);
    spec.direction = status::DIRECTION_NO;
    spec.block = Some(proposal.origin_block_number + VOTE_DURATION);
    let counting = fixture.counting_cell(&spec);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::CountingCellTooEarly);
}

/// Spec: proposal, "Updating to be challenged" - the challenge needs
/// `total_no >= total_yes`; below that bar, and with the challenge window still
/// open, the finalized cell cannot be consumed.
#[test]
fn test_challenge_below_the_bar() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(
        &mut fixture,
        status::PROPOSAL_STATUS_FINALIZED,
        YES_THRESHOLD,
    );
    let counting = no_counting(&mut fixture, &proposal, YES_THRESHOLD - 1);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[counting],
    );

    assert_script_error(&fixture.context, &tx, Error::ChallengeNotMet);
}

/// Spec: proposal, "Veto" - the administrator identified by
/// `config.veto_lock_script_hash` can consume and burn a finalized proposal.
#[test]
fn test_veto_proposal() {
    let mut fixture = Fixture::new();
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_FINALIZED;
    spec.total_yes = YES_THRESHOLD;
    spec.lock = fixture.veto_lock.clone();
    let proposal = fixture.proposal_cell(&spec);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the administrator vetoes the proposal");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Recycling the Proposal Cell" - once `vote_duration +
/// challenge_time` blocks elapsed, the initiator can consume a proposal that
/// did not pass and recycle its assets.
#[test]
fn test_recycle_proposal() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + CHALLENGE_TIME + 1),
        outputs,
        vec![Bytes::new()],
        &[],
    );

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the bond is recycled");
    println!("consume cycles: {}", cycles);
}

/// Spec: proposal, "Recycling the Proposal Cell" - `vote_duration +
/// challenge_time` blocks have to elapse first; exactly the sum is too early.
#[test]
fn test_recycle_too_early() {
    let mut fixture = Fixture::new();
    let proposal = open_proposal(&mut fixture);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(VOTE_DURATION + CHALLENGE_TIME),
        outputs,
        vec![Bytes::new()],
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::RecycleTooEarly);
}

/// Spec: proposal, "Processing" - only the three documented statuses exist, so
/// a cell that claims anything else cannot be settled.
#[test]
fn test_settle_unknown_status() {
    let mut fixture = Fixture::new();
    let proposal = proposal_with_status(&mut fixture, 3, 0);
    let outputs = vec![change_output(&fixture)];
    let tx = settle_tx(
        &mut fixture,
        &proposal,
        relative_since(0),
        outputs,
        vec![Bytes::new()],
        &[],
    );

    assert_script_error(&fixture.context, &tx, Error::ProposalStatusInvalid);
}
