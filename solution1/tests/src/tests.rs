//! Integration tests for the on-chain voting system.
//!
//! These tests run the real contracts (built into `build/<mode>`) on ckb-vm
//! through `ckb-testtool`. They cover the cell creation rules of the four type
//! scripts; the flows that need block numbers (votes, counting) additionally
//! require the creating block headers to be attached as `header_deps`.
//!
//! See https://github.com/xxuejie/ckb-native-build-sample/blob/main/tests/src/tests.rs

use ckb_testtool::{
    builtin::ALWAYS_SUCCESS,
    ckb_hash::new_blake2b,
    ckb_types::{bytes::Bytes, core::TransactionBuilder, packed::*, prelude::*},
    context::Context,
};
use ckb_vote_types::molecules::types::{ProposalCellData, VotingConfig};

/// Maximum number of cycles a test transaction may consume.
const MAX_CYCLES: u64 = 10_000_000;
/// 1 CKB, in shannons.
const ONE_CKB: u64 = 100_000_000;

/// Deploys the `always success` lock and creates a funding cell for it.
fn funding_cell(context: &mut Context, capacity: u64) -> (Script, CellInput) {
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let lock = context
        .build_script(&always_success_out_point, Bytes::new())
        .expect("always success lock");
    let out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(capacity)
            .lock(lock.clone())
            .build(),
        Bytes::new(),
    );
    let input = CellInput::new_builder().previous_output(out_point).build();
    (lock, input)
}

/// The Type ID rule: `blake160(first input of the transaction || output index)`.
fn type_id_args(input: &CellInput, output_index: u64) -> Bytes {
    let mut hasher = new_blake2b();
    hasher.update(input.as_slice());
    hasher.update(&output_index.to_le_bytes());
    let mut digest = [0u8; 32];
    hasher.finalize(&mut digest);
    Bytes::copy_from_slice(&digest[..20])
}

/// A well formed `VotingConfig` payload.
fn voting_config_data(minimal_proposal_capacity: u64) -> Bytes {
    VotingConfig::new_builder()
        .emergent_halt(0u8)
        .vote_code_hash([7u8; 32])
        .vote_hash_type(2u8)
        .counting_code_hash([8u8; 32])
        .counting_hash_type(2u8)
        .yes_threshold(500u64.to_le_bytes())
        .minimal_proposal_capacity(minimal_proposal_capacity.to_le_bytes())
        .vote_duration(10u64.to_le_bytes())
        .vote_window(10u64.to_le_bytes())
        .challenge_time(10u64.to_le_bytes())
        .veto_lock_script_hash([9u8; 32])
        .build()
        .as_slice()
        .to_vec()
        .into()
}

/// A well formed `ProposalCellData` payload.
fn proposal_data(status: u8, applied_amount: u64, total_yes: u64) -> Bytes {
    ProposalCellData::new_builder()
        .status(status)
        .description(b"a proposal under test".to_vec())
        .applied_amount(applied_amount.to_le_bytes())
        .total_yes(total_yes.to_le_bytes())
        .build()
        .as_slice()
        .to_vec()
        .into()
}

#[test]
fn test_always_success() {
    // deploy contract
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("always-success");

    // prepare scripts
    let lock_script = context
        .build_script(&out_point, Bytes::from(vec![42]))
        .expect("script");

    // prepare cells
    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500)
            .lock(lock_script.clone())
            .build(),
        CellOutput::new_builder()
            .capacity(500)
            .lock(lock_script)
            .build(),
    ];

    let outputs_data = vec![Bytes::new(); 2];

    // build transaction
    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .build();
    let tx = context.complete_tx(tx);

    // run
    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("pass verification");
    println!("consume cycles: {}", cycles);
}

/// Minting the config cell: the args must follow the Type ID rule and the data
/// must decode as a `VotingConfig`.
#[test]
fn test_config_cell_minting() {
    let mut context = Context::default();
    let config_out_point = context.deploy_cell_by_name("config-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    let config_script = context
        .build_script(&config_out_point, type_id_args(&input, 0))
        .expect("config script");
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data([voting_config_data(100 * ONE_CKB), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("config cell is minted");
    println!("consume cycles: {}", cycles);
}

/// The config cell args are a Type ID, so a cell that does not follow the rule
/// must be rejected.
#[test]
fn test_config_cell_type_id_is_checked() {
    let mut context = Context::default();
    let config_out_point = context.deploy_cell_by_name("config-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    // The Type ID of output #1 while the cell is created at output #0.
    let config_script = context
        .build_script(&config_out_point, type_id_args(&input, 1))
        .expect("config script");
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data([voting_config_data(100 * ONE_CKB), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

/// Creating a proposal: the proposal script loads the config cell from the cell
/// deps, checks the Type ID args, the initial status and the bond.
#[test]
fn test_proposal_cell_creation() {
    let mut context = Context::default();
    let proposal_out_point = context.deploy_cell_by_name("proposal-type-script");
    let config_out_point = context.deploy_cell_by_name("config-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    // The config cell is only referenced as a cell dep, so the type script of
    // the dep is never executed.
    let config_script = context
        .build_script(&config_out_point, Bytes::from(vec![7u8; 20]))
        .expect("config script");
    let config_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        voting_config_data(100 * ONE_CKB),
    );

    let proposal_script = context
        .build_script(&proposal_out_point, type_id_args(&input, 0))
        .expect("proposal script");
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(100 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(proposal_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(900 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .cell_dep(
            CellDep::new_builder()
                .out_point(config_cell)
                .build(),
        )
        .outputs(outputs)
        .outputs_data([proposal_data(0, 100 * ONE_CKB, 0), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("proposal cell is created");
    println!("consume cycles: {}", cycles);
}

/// A proposal bond below `config.minimal_proposal_capacity` is rejected.
#[test]
fn test_proposal_cell_requires_minimal_bond() {
    let mut context = Context::default();
    let proposal_out_point = context.deploy_cell_by_name("proposal-type-script");
    let config_out_point = context.deploy_cell_by_name("config-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    let config_script = context
        .build_script(&config_out_point, Bytes::from(vec![7u8; 20]))
        .expect("config script");
    let config_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        voting_config_data(100 * ONE_CKB),
    );

    let proposal_script = context
        .build_script(&proposal_out_point, type_id_args(&input, 0))
        .expect("proposal script");
    let outputs = vec![
        // 99 CKB, one CKB short of the configured minimum.
        CellOutput::new_builder()
            .capacity(99 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(proposal_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(901 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .cell_dep(
            CellDep::new_builder()
                .out_point(config_cell)
                .build(),
        )
        .outputs(outputs)
        .outputs_data([proposal_data(0, 100 * ONE_CKB, 0), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

/// The vote cell args are `blake160(proposal type script)`.
#[test]
fn test_vote_cell_requires_proposal_id_args() {
    let mut context = Context::default();
    let vote_out_point = context.deploy_cell_by_name("vote-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    let vote_script = context
        .build_script(&vote_out_point, Bytes::from(vec![42]))
        .expect("vote script");
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(vote_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data([Bytes::new(), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

/// The counting cell args are `blake160(proposal type script)` as well.
#[test]
fn test_counting_cell_requires_proposal_id_args() {
    let mut context = Context::default();
    let counting_out_point = context.deploy_cell_by_name("counting-type-script");
    let (lock, input) = funding_cell(&mut context, 1000 * ONE_CKB);

    let counting_script = context
        .build_script(&counting_out_point, Bytes::from(vec![42]))
        .expect("counting script");
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock.clone())
            .type_(Some(counting_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(500 * ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data([Bytes::new(), Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}
