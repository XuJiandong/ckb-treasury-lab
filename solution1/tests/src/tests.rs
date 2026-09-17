//! Module root of the integration tests.
//!
//! Every rule of every script lives in the file of that script:
//!
//! * [`crate::config_tests`] - config type script
//! * [`crate::proposal_tests`] - proposal type script
//! * [`crate::vote_tests`] - vote type script
//! * [`crate::counting_tests`] - counting type script
//!
//! The shared fixtures and assertions live in [`crate::helpers`]. This file
//! only keeps the `always success` smoke test, which proves that the toolchain
//! and the VM harness work; the binary carries no rule of its own.
//!
//! See https://github.com/xxuejie/ckb-native-build-sample/blob/main/tests/src/tests.rs

use crate::helpers::MAX_CYCLES;
use ckb_testtool::{
    ckb_types::{bytes::Bytes, core::TransactionBuilder, packed::*, prelude::*},
    context::Context,
};

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
