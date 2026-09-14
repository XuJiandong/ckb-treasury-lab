//! Unit tests for the vote type script.
//!
//! A vote cell is created while the proposal is still open and is backed by the
//! voter's Nervos DAO deposits; consuming it without a vote output withdraws
//! the vote. Every test names the rule of `docs/vote-type-script-spec.md` it
//! covers.

use crate::helpers::{
    CERTIFICATE_CAPACITY, FUNDING_CAPACITY, Fixture, MAX_CYCLES, ONE_CKB, PlacedCell, Proposal,
    VOTE_AMOUNT, assert_script_error, dep, vote_data,
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

/// The knobs of a "cast a vote" transaction.
///
/// The default plan is a valid `YES` vote of [`VOTE_AMOUNT`], backed by a DAO
/// deposit older than the proposal; a failure test flips exactly one field.
struct VotePlan {
    /// Lock of the vote cell, that is the voter's identity.
    vote_lock: Script,
    /// Lock of the funding input, which has to match `vote_lock`.
    input_lock: Script,
    direction: u8,
    amount: u64,
    /// Raw vote payload; `None` builds a well formed one.
    data: Option<Bytes>,
    /// Whether the proposal cell is referenced through `cell_deps`.
    proposal_dep: bool,
    /// The DAO deposit backing the vote; `None` means no deposit at all.
    deposit: Option<PlacedCell>,
    /// How many vote cells the transaction creates.
    vote_outputs: usize,
}

/// An open proposal plus a valid vote plan pointing at it.
fn vote_setup(fixture: &mut Fixture) -> (Proposal, VotePlan) {
    let spec = fixture.proposal_spec();
    let proposal = fixture.proposal_cell(&spec);
    let voter_lock = fixture.voter_lock.clone();
    let deposit =
        fixture.dao_deposit_cell(&voter_lock, VOTE_AMOUNT, Some(proposal.block_number - 10));
    let plan = VotePlan {
        vote_lock: voter_lock.clone(),
        input_lock: voter_lock,
        direction: status::DIRECTION_YES,
        amount: VOTE_AMOUNT,
        data: None,
        proposal_dep: true,
        deposit: Some(deposit),
        vote_outputs: 1,
    };
    (proposal, plan)
}

/// Assembles the vote transaction described by `plan`.
fn vote_tx(fixture: &mut Fixture, proposal: &Proposal, plan: &VotePlan) -> TransactionView {
    let funding = fixture.funding_cell(&plan.input_lock, FUNDING_CAPACITY);
    let script = fixture.vote_script(proposal.id);
    let config_cell = fixture.config_cell.clone();

    let mut outputs = Vec::new();
    let mut outputs_data = Vec::new();
    for _ in 0..plan.vote_outputs {
        outputs.push(
            CellOutput::new_builder()
                .capacity(CERTIFICATE_CAPACITY)
                .lock(plan.vote_lock.clone())
                .type_(Some(script.clone()).pack())
                .build(),
        );
        outputs_data.push(
            plan.data
                .clone()
                .unwrap_or_else(|| vote_data(plan.amount, plan.direction)),
        );
    }
    outputs.push(
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(plan.vote_lock.clone())
            .build(),
    );
    outputs_data.push(Bytes::new());

    let mut builder = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .cell_dep(dep(&config_cell));
    let mut header_deps = Vec::new();
    if plan.proposal_dep {
        builder = builder.cell_dep(dep(&proposal.out_point));
        header_deps.push(proposal.block_hash.clone());
    }
    if let Some(deposit) = &plan.deposit {
        builder = builder.cell_dep(dep(&deposit.out_point));
        if let Some(hash) = &deposit.block_hash {
            header_deps.push(hash.clone());
        }
    }

    let tx = builder
        .header_deps(Fixture::header_deps(header_deps))
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Assembles a vote withdrawal: the vote cell is consumed and no vote cell is
/// created.
fn withdraw_tx(fixture: &mut Fixture, proposal: &Proposal) -> TransactionView {
    let lock = fixture.lock.clone();
    let script = fixture.vote_script(proposal.id);
    let vote_cell = fixture.create_cell(
        &lock,
        CERTIFICATE_CAPACITY,
        Some(script),
        vote_data(VOTE_AMOUNT, status::DIRECTION_YES),
    );
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CERTIFICATE_CAPACITY)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(vote_cell).build())
        .outputs(outputs)
        .outputs_data([Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

// --------------------------------------------------------------------------
// Casting a vote
// --------------------------------------------------------------------------

/// Spec: vote, "Processing" - a voter casts a "YES" vote by creating a vote
/// cell whose lock is unlocked by an input and whose `vote_amount` equals the
/// sum of the voter's DAO deposits.
#[test]
fn test_cast_yes_vote() {
    let mut fixture = Fixture::new();
    let (proposal, plan) = vote_setup(&mut fixture);
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the YES vote is accepted");
    println!("consume cycles: {}", cycles);
}

/// Spec: vote, "Cell Data" - `direction = 0` is a "NO" vote, which can later
/// challenge the result; it is a valid vote as well.
#[test]
fn test_cast_no_vote() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.direction = status::DIRECTION_NO;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the NO vote is accepted");
    println!("consume cycles: {}", cycles);
}

/// Spec: vote, "Others" - any user can withdraw an existing vote by consuming
/// the vote cell: a transaction with no vote output recycles the capacity.
#[test]
fn test_withdraw_vote() {
    let mut fixture = Fixture::new();
    let (proposal, _) = vote_setup(&mut fixture);
    let tx = withdraw_tx(&mut fixture, &proposal);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the vote is withdrawn");
    println!("consume cycles: {}", cycles);
}

/// Spec: vote, "Script" - the args are 20 bytes, the ckb-blake160-hash of the
/// proposal type script.
#[test]
fn test_vote_args_length() {
    let mut fixture = Fixture::new();
    let lock = fixture.lock.clone();
    let funding = fixture.funding_cell(&lock, FUNDING_CAPACITY);
    let out_point = fixture.vote_out_point.clone();
    let script = fixture.script(&out_point, Bytes::from(vec![42]));
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
        .input(CellInput::new_builder().previous_output(funding).build())
        .outputs(outputs)
        .outputs_data([Bytes::new(), Bytes::new()].pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert_script_error(&fixture.context, &tx, Error::ArgsInvalid);
}

/// Spec: vote, "Cell Data" - the payload has to decode as a `Vote`.
#[test]
fn test_vote_data_malformed() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    // Hand written bytes: a 4 byte payload cannot be a `Vote` table.
    plan.data = Some(Bytes::from(vec![0xffu8; 4]));
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteDataInvalid);
}

/// Spec: vote, "Cell Data" - `direction` is 0 ("NO") or 1 ("YES").
#[test]
fn test_vote_direction_invalid() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.direction = 2;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteDataInvalid);
}

/// Spec: vote, "Cell Data" - `vote_amount` is the sum of the backing deposits,
/// so a vote of nothing is malformed.
#[test]
fn test_vote_amount_zero() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.amount = 0;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteDataInvalid);
}

/// Spec: vote, "Processing" - a transaction may only carry one vote cell for a
/// proposal.
#[test]
fn test_vote_multiple_cells() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.vote_outputs = 2;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::MultipleVoteCells);
}

/// Spec: vote, "Processing" - the vote cell's lock has to represent the voter
/// and must be unlocked in the input cells.
#[test]
fn test_vote_lock_not_unlocked() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    // The funding input uses another `always success` instance, so the voter's
    // lock is never unlocked.
    plan.input_lock = fixture.lock.clone();
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoterLockNotUnlocked);
}

/// Spec: vote, "Processing" - the proposal type script whose hash matches
/// `args` must be found in `cell_deps`.
#[test]
fn test_vote_proposal_missing() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.proposal_dep = false;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::ProposalCellNotFound);
}

/// Spec: vote, "Processing" - the referenced cell must be an open proposal: a
/// vote can only be cast before the proposal is finalized.
#[test]
fn test_vote_proposal_not_open() {
    let mut fixture = Fixture::new();
    let (_, plan) = vote_setup(&mut fixture);
    let mut spec = fixture.proposal_spec();
    spec.status = status::PROPOSAL_STATUS_FINALIZED;
    let proposal = fixture.proposal_cell(&spec);
    let plan = VotePlan { ..plan };
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::ProposalNotOpen);
}

/// Spec: config, "Cell Data" - `emergent_halt` halts every voting script, so a
/// halted config cell makes a vote fail.
#[test]
fn test_vote_halted() {
    let mut fixture = Fixture::new();
    fixture.config.emergent_halt = 1;
    fixture.refresh_config_cell();
    let (proposal, plan) = vote_setup(&mut fixture);
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::EmergentHalt);
}

/// Spec: vote, "Processing" - the `vote_amount` is the sum of the related DAO
/// deposits, so a vote without any deposit cannot be cast.
#[test]
fn test_vote_deposit_missing() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    plan.deposit = None;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::DaoDepositMissing);
}

/// Spec: vote, "Processing" - a DAO deposit counts only when it is older than
/// the proposal cell: a deposit created in the proposal's own block is too new.
#[test]
fn test_vote_deposit_too_new() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    let voter_lock = fixture.voter_lock.clone();
    plan.deposit =
        Some(fixture.dao_deposit_cell(&voter_lock, VOTE_AMOUNT, Some(proposal.block_number)));
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::DaoDepositTooNew);
}

/// Spec: vote, "Processing" - the sum of the voter's DAO deposits has to equal
/// the `vote_amount` in the cell data.
#[test]
fn test_vote_amount_mismatch() {
    let mut fixture = Fixture::new();
    let (proposal, mut plan) = vote_setup(&mut fixture);
    // One shannon more than the deposit holds.
    plan.amount = VOTE_AMOUNT + 1;
    let tx = vote_tx(&mut fixture, &proposal, &plan);

    assert_script_error(&fixture.context, &tx, Error::VoteAmountMismatch);
}
