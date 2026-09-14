//! Helpers to locate and read the proposal cell that a vote or a counting cell
//! refers to.
//!
//! Vote and counting cells carry `blake160(proposal_type_script)` in their
//! `args`, which identifies the proposal cell unambiguously: the type script of
//! a proposal cell is unique on the whole chain (Type ID), and finding a script
//! whose hash matches a given 20 byte value is infeasible otherwise.

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{packed::Script, prelude::Entity},
    high_level::{load_cell_data, load_cell_type, load_header, QueryIter},
};
use ckb_vote_types::molecules::types::ProposalCellData;

use crate::{config::u64_of, error::Error, hash};

/// A proposal cell referenced through the `cell_deps` of the current transaction.
#[derive(Debug, Clone)]
pub struct ProposalRef {
    /// Index of the cell in `Source::CellDep`.
    pub index: usize,
    /// The type script of the proposal cell.
    pub script: Script,
    /// `status` field of the cell data.
    pub status: u8,
    /// `total_yes` field of the cell data.
    pub total_yes: u64,
    /// The block number in which the proposal cell was created.
    pub block_number: u64,
}

/// Finds the proposal cell whose type script id is `proposal_id`.
///
/// The cell must be referenced through `cell_deps`, and the header of the block
/// that created it must be listed in `header_deps` (see [`block_number_of`]).
pub fn find_proposal(proposal_id: &[u8; 20]) -> Result<ProposalRef, Error> {
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
        let data = load_cell_data(index, Source::CellDep).map_err(|_| Error::ProposalCellNotFound)?;
        let proposal =
            ProposalCellData::from_slice(&data).map_err(|_| Error::ProposalDataInvalid)?;
        found = Some(ProposalRef {
            index,
            script: type_script,
            status: proposal.status().as_slice()[0],
            total_yes: u64_of(proposal.total_yes()),
            block_number: block_number_of(index)?,
        });
    }
    found.ok_or(Error::ProposalCellNotFound)
}

/// Reads the block number in which the cell at `index` of `cell_deps` was created.
///
/// ckb-vm resolves the creating block of a cell from the node's own chain data;
/// the syscall only succeeds when that block header is listed in the
/// transaction's `header_deps`, which is what makes the value trustworthy
/// on-chain.
pub fn block_number_of(index: usize) -> Result<u64, Error> {
    let header = load_header(index, Source::CellDep).map_err(|_| Error::HeaderMissing)?;
    Ok(u64_of(header.raw().number()))
}
