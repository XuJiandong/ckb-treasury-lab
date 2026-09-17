//! Layout of the transaction's `cell_deps` (RFC 0022).
//!
//! A vote is backed by the DAO deposits the voter writes down in `cell_deps`,
//! and a single entry can reach *several* cells: a dependency group ("Dep
//! Group", RFC 0022) is a cell whose data is an `OutPointVec`, and the VM
//! resolves it to each of its members. ckb-vm offers no syscall for the
//! out-point of a *resolved* dependency, so a script cannot tell which of the
//! cells it sees was written down on its own and which came out of a group.
//!
//! The spec therefore draws the line at the first dependency group: only the
//! `cell_deps` written down before it are candidates for a DAO deposit
//! ([`end_of_dao_deposit`]). Everything a group expands to lands after that
//! boundary, so a member can neither add to the sum nor repeat a deposit that
//! was already counted - the "vote, withdraw and vote again" trick of a
//! duplicated dependency group.
//!
//! No separate duplicate check is needed. Before the boundary every entry is a
//! plain dependency, and consensus rejects a transaction whose raw `cell_deps`
//! repeat the same packed `CellDep` (`DuplicateDepsVerifier`, RFC 0022), so the
//! out-points the script counts are already unique.

use ckb_std::high_level::load_transaction;

use crate::error::Error;

/// `dep_type` of a dependency group (RFC 0022, "Dep Group").
const DEP_TYPE_DEP_GROUP: u8 = 1;

/// The number of leading `cell_deps` that may carry a DAO deposit.
///
/// The packed transaction is iterated in molecule and the index of the first
/// `cell_dep` whose `dep_type` is `dep_group` is returned; without a group the
/// number of `cell_deps` is returned instead.
///
/// The VM expands a dependency group *in place*, so the returned index is also
/// the first `Source::CellDep` slot that belongs to an expansion: the slots
/// before it are exactly the entries written down as plain code dependencies.
pub fn end_of_dao_deposit() -> Result<usize, Error> {
    let transaction = load_transaction().map_err(|_| Error::SyscallError)?;

    let mut end = 0usize;
    for cell_dep in transaction.raw().cell_deps().into_iter() {
        if cell_dep.dep_type().as_slice()[0] == DEP_TYPE_DEP_GROUP {
            break;
        }
        end += 1;
    }
    Ok(end)
}
