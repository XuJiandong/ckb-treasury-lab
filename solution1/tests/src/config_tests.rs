//! Unit tests for the config type script.
//!
//! The config cell is the root of the voting system: it may only be minted
//! (`0 in / 1 out`) or updated (`1 in / 1 out`), its `args` follow the Type ID
//! rule of the creating transaction and its payload has to decode as a
//! `VotingConfig`. Every rule below is named after the corresponding section of
//! `docs/config-type-script-spec.md`.

use crate::helpers::{
    CONFIG_CAPACITY, FUNDING_CAPACITY, Fixture, MAX_CYCLES, ONE_CKB, YES_THRESHOLD,
    assert_script_error, type_id,
};
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{TransactionBuilder, TransactionView},
    packed::*,
    prelude::*,
};
use ckb_vote_common::error::Error;

/// Mints a config cell at output #0 and returns the assembled transaction.
///
/// `args` receives the first input so that a test can build a Type ID, or a
/// deliberately wrong one, out of it.
fn mint_tx<F>(fixture: &mut Fixture, capacity: u64, data: Bytes, args: F) -> TransactionView
where
    F: FnOnce(&CellInput) -> Bytes,
{
    let lock = fixture.lock.clone();
    let funding = fixture.funding_cell(&lock, FUNDING_CAPACITY);
    let input = CellInput::new_builder().previous_output(funding).build();
    let config_script = fixture.config_script_with_args(args(&input));
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(capacity)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Consumes the fixture's config cell and writes `data` into a new config cell
/// with the same type script (`1 in / 1 out`).
fn update_tx(fixture: &mut Fixture, data: Bytes) -> TransactionView {
    let lock = fixture.lock.clone();
    let config_cell = fixture.config_cell.clone();
    let config_script = fixture.config_script.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CONFIG_CAPACITY)
            .lock(lock.clone())
            .type_(Some(config_script).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(ONE_CKB)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(config_cell)
                .build(),
        )
        .outputs(outputs)
        .outputs_data([data, Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Consumes the fixture's config cell without creating a new one (`1 in / 0 out`).
fn burn_tx(fixture: &mut Fixture) -> TransactionView {
    let lock = fixture.lock.clone();
    let config_cell = fixture.config_cell.clone();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CONFIG_CAPACITY)
            .lock(lock)
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(config_cell)
                .build(),
        )
        .outputs(outputs)
        .outputs_data([Bytes::new()].pack())
        .build();
    fixture.context.complete_tx(tx)
}

/// Spec: config, "Script" - minting follows the Type ID rule: the args are
/// `blake160(first input || output index)`.
#[test]
fn test_mint_config_cell() {
    let mut fixture = Fixture::new();
    let data = fixture.config_data();
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, data, |input| {
        type_id(input, 0).to_vec().into()
    });

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("a config cell with a valid Type ID is minted");
    println!("consume cycles: {}", cycles);
}

/// Spec: config, "Script" - the Type ID rule means the args are bound to the
/// first input and the output index: a Type ID of another output is rejected.
#[test]
fn test_config_cell_type_id_is_checked() {
    let mut fixture = Fixture::new();
    let data = fixture.config_data();
    // The cell is created at output #0, but the args carry the Type ID of #1.
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, data, |input| {
        type_id(input, 1).to_vec().into()
    });

    assert_script_error(&fixture.context, &tx, Error::TypeIdInvalid);
}

/// Spec: config, "Script" - the args are a 20 byte Type ID, so any other length
/// is malformed.
#[test]
fn test_config_args_length() {
    let mut fixture = Fixture::new();
    let data = fixture.config_data();
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, data, |_| {
        Bytes::from(vec![0u8; 19])
    });

    assert_script_error(&fixture.context, &tx, Error::ArgsInvalid);
}

/// Spec: config, "Cell Data" - the payload has to decode as a `VotingConfig`.
#[test]
fn test_config_data_must_decode() {
    let mut fixture = Fixture::new();
    // Hand written bytes: a 4 byte payload cannot be a `VotingConfig` table.
    let malformed = Bytes::from(vec![0xffu8; 4]);
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, malformed, |input| {
        type_id(input, 0).to_vec().into()
    });

    assert_script_error(&fixture.context, &tx, Error::ConfigCellInvalid);
}

/// Spec: config, "Cell Data" - `emergent_halt` is a boolean flag, a value other
/// than 0 or 1 can never be meaningful.
#[test]
fn test_config_emergent_halt_out_of_range() {
    let mut fixture = Fixture::new();
    fixture.config.emergent_halt = 2;
    let data = fixture.config_data();
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, data, |input| {
        type_id(input, 0).to_vec().into()
    });

    assert_script_error(&fixture.context, &tx, Error::ConfigCellInvalid);
}

/// Spec: config, "Cell Data" - every `hash_type` field has to be a valid
/// `ScriptHashType`; the largest one is `data1` (2).
#[test]
fn test_config_hash_type_out_of_range() {
    let mut fixture = Fixture::new();
    // 3 is above `constants::MAX_SCRIPT_HASH_TYPE`.
    fixture.vote_hash_type = 3;
    let data = fixture.config_data();
    let tx = mint_tx(&mut fixture, CONFIG_CAPACITY, data, |input| {
        type_id(input, 0).to_vec().into()
    });

    assert_script_error(&fixture.context, &tx, Error::ConfigCellInvalid);
}

/// Spec: config, "Script" - updating keeps the `args`: `1 in / 1 out` with the
/// very same type script is accepted and the new payload is stored.
#[test]
fn test_update_config_cell_keeps_args() {
    let mut fixture = Fixture::new();
    // A meaningful update: the "YES" threshold changes.
    fixture.config.yes_threshold = YES_THRESHOLD * 2;
    let data = fixture.config_data();
    let tx = update_tx(&mut fixture, data);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the config cell is updated in place");
    println!("consume cycles: {}", cycles);
}

/// Spec: config, "Cell Data" - setting `emergent_halt` is a legal update: it is
/// what halts the whole voting system.
#[test]
fn test_halt_config_cell() {
    let mut fixture = Fixture::new();
    fixture.config.emergent_halt = 1;
    let data = fixture.config_data();
    let tx = update_tx(&mut fixture, data);

    let cycles = fixture
        .context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("the config cell can be updated to halt the system");
    println!("consume cycles: {}", cycles);
}

/// Spec: config, "Script" - the config cell must not be burned: `1 in / 0 out`
/// is rejected.
#[test]
fn test_config_cell_cannot_be_burned() {
    let mut fixture = Fixture::new();
    let tx = burn_tx(&mut fixture);

    assert_script_error(&fixture.context, &tx, Error::ConfigCellBurned);
}

/// Spec: config, "Script" - only minting and updating are allowed, so creating
/// two config cells at once is rejected.
#[test]
fn test_config_cell_transition_invalid() {
    let mut fixture = Fixture::new();
    let lock = fixture.lock.clone();
    let funding = fixture.funding_cell(&lock, FUNDING_CAPACITY);
    // The same script on both outputs: `(0 in / 2 out)`.
    let config_script = fixture.config_script_with_args(Bytes::from(vec![0x22u8; 20]));
    let data = fixture.config_data();
    let outputs = vec![
        CellOutput::new_builder()
            .capacity(CONFIG_CAPACITY)
            .lock(lock.clone())
            .type_(Some(config_script.clone()).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(CONFIG_CAPACITY)
            .lock(lock)
            .type_(Some(config_script).pack())
            .build(),
    ];

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(funding).build())
        .outputs(outputs)
        .outputs_data([data.clone(), data].pack())
        .build();
    let tx = fixture.context.complete_tx(tx);

    assert_script_error(&fixture.context, &tx, Error::ConfigCellTransitionInvalid);
}
