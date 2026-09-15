//! Helpers to locate and read the proposal cell that a vote or a counting cell
//! refers to.
//!
//! Vote and counting cells carry `blake160(proposal_type_script)` in their
//! `args`, which identifies the proposal cell unambiguously: the type script of
//! a proposal cell is unique on the whole chain (Type ID), and finding a script
//! whose hash matches a given 20 byte value is infeasible otherwise.
//!
//! The proposal type script itself points at the config cell, so a vote or a
//! counting cell reaches the config through the proposal cell
//! ([`ProposalRef::config_id`]).

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Script, prelude::Entity},
    high_level::{QueryIter, load_cell_data, load_cell_type, load_header},
};
use ckb_vote_types::molecules::types::ProposalCellData;

use crate::{config::u64_of, constants, error::Error, hash};

/// A proposal cell referenced through the `cell_deps` of the current transaction.
#[derive(Debug, Clone)]
pub struct ProposalRef {
    /// Index of the cell in `Source::CellDep`.
    pub index: usize,
    /// The type script of the proposal cell.
    pub script: Script,
    /// `blake160(config type script)`, read from the proposal type script args.
    ///
    /// Vote and counting cells are bound to a proposal through
    /// `blake160(proposal type script)`, so the config cell is reachable from
    /// them through the proposal cell.
    pub config_id: [u8; constants::CONFIG_ID_LEN],
    /// `status` field of the cell data.
    pub status: u8,
    /// `total_yes` field of the cell data.
    pub total_yes: u64,
    /// The block number in which the *original* proposal cell was created.
    ///
    /// It is `0` while the proposal is open and is filled in when the proposal
    /// is finalized: the finalized cell is created after the voting window is
    /// over, so its own [`block_number`](Self::block_number) cannot anchor the
    /// voting window, and the counting script falls back to this field.
    pub origin_block_number: u64,
    /// The block number in which the referenced cell was created.
    pub block_number: u64,
}

/// Finds the proposal cell whose type script id is `proposal_id`.
///
/// The cell must be referenced through `cell_deps`, and the header of the block
/// that created it must be listed in `header_deps` (see [`block_number_of`]).
pub fn find_proposal(proposal_id: &[u8; constants::PROPOSAL_ID_LEN]) -> Result<ProposalRef, Error> {
    let mut found: Option<ProposalRef> = None;
    for (index, type_script) in QueryIter::new(load_cell_type, Source::CellDep).enumerate() {
        let Some(type_script) = type_script else {
            continue;
        };
        if &hash::script_id(&type_script) != proposal_id {
            continue;
        }
        if found.is_some() {
            // The proposal type script is a Type ID, so at most one cell can
            // ever match; two matches mean a malformed transaction.
            return Err(Error::ProposalCellNotFound);
        }
        // The proposal type script args are
        // `blake160(config type script) || Type ID`.
        let args = type_script.args().raw_data();
        if args.len() != constants::PROPOSAL_ARGS_LEN {
            return Err(Error::ProposalDataInvalid);
        }
        let mut config_id = [0u8; constants::CONFIG_ID_LEN];
        config_id.copy_from_slice(&args[..constants::CONFIG_ID_LEN]);

        let data =
            load_cell_data(index, Source::CellDep).map_err(|_| Error::ProposalCellNotFound)?;
        let proposal =
            ProposalCellData::from_slice(&data).map_err(|_| Error::ProposalDataInvalid)?;
        found = Some(ProposalRef {
            index,
            script: type_script,
            config_id,
            status: proposal.status().as_slice()[0],
            total_yes: u64_of(proposal.total_yes()),
            origin_block_number: u64_of(proposal.origin_block_number()),
            block_number: block_number_of(index, Source::CellDep)?,
        });
    }
    found.ok_or(Error::ProposalCellNotFound)
}

/// Reads the block number in which the cell at `index` of `source` was created.
///
/// ckb-vm resolves the creating block of a cell from the node's own chain data;
/// the syscall only succeeds when that block header is listed in the
/// transaction's `header_deps`, which is what makes the value trustworthy
/// on-chain. `source` is usually `Source::CellDep`; `Source::Input` reads the
/// creating block of an input cell, which is how the proposal script learns the
/// block in which the open proposal cell it finalizes was created.
pub fn block_number_of(index: usize, source: Source) -> Result<u64, Error> {
    let header = load_header(index, source).map_err(|_| Error::HeaderMissing)?;
    Ok(u64_of(header.raw().number()))
}
