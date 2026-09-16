//! Uniqueness of the transaction's `cell_deps` (RFC 0022).
//!
//! `cell_deps` may reach the same cell more than once: the very same
//! `OutPoint` can be written down twice, and a dependency group ("Dep Group")
//! expands to its members, so a cell can also be reached both directly and
//! through a group - or through two different groups.
//!
//! A script that sums data over `Source::CellDep` would count such a cell
//! twice, which is a soundness problem whenever the sum is consensus relevant
//! (for instance the DAO deposits backing a vote). ckb-vm offers no syscall for
//! the out-point of a *resolved* dependency, so the check expands the groups
//! from their own cell data, exactly like the VM does.

use alloc::vec::Vec;

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        packed::{OutPoint, OutPointVec},
        prelude::Entity,
    },
    high_level::{load_cell_data, load_transaction},
};

#[cfg(feature = "enable_log")]
use ckb_std::log::warn;

use crate::error::Error;

/// `dep_type` of a dependency group (RFC 0022, "Dep Group").
const DEP_TYPE_DEP_GROUP: u8 = 1;

/// Rejects a transaction that writes the same `OutPoint` down twice in
/// `cell_deps`, after expanding the dependency groups.
///
/// A dependency group is a cell whose data stores an `OutPointVec`; using it in
/// `cell_deps` has the same effect as listing each of its members on its own
/// (RFC 0022, "Dep Group"). The members are collected here, so a cell that is
/// reached twice - once directly and once through a group, or through two
/// different groups - is rejected with [`Error::DuplicatedCellDep`].
pub fn ensure_unique_cell_deps() -> Result<(), Error> {
    let transaction = load_transaction().map_err(|_| Error::SyscallError)?;

    let mut out_points: Vec<[u8; OutPoint::TOTAL_SIZE]> = Vec::new();
    for (index, cell_dep) in transaction.raw().cell_deps().into_iter().enumerate() {
        let out_point = cell_dep.out_point();
        if cell_dep.dep_type().as_slice()[0] == DEP_TYPE_DEP_GROUP {
            collect_dep_group(index, &mut out_points)?;
        }
        out_points.push(
            out_point
                .as_slice()
                .try_into()
                .map_err(|_| Error::EncodingInvalid)?,
        );
    }

    if any_duplicate(&mut out_points) {
        #[cfg(feature = "enable_log")]
        warn!("a cell dep out-point is referenced twice");
        return Err(Error::DuplicatedCellDep);
    }
    Ok(())
}

/// Appends the out-point of every member of the dependency group reached at
/// `index` of `Source::CellDep`.
///
/// A dependency group stores its members as a molecule encoded `OutPointVec`
/// in its cell data (RFC 0022, "Dep Group"), and the VM expands it before the
/// script runs. A member is a bare `OutPoint` with no `dep_type`, so a group
/// nested inside another group is not followed any further - which matches the
/// one level expansion the node itself performs.
fn collect_dep_group(
    index: usize,
    out_points: &mut Vec<[u8; OutPoint::TOTAL_SIZE]>,
) -> Result<(), Error> {
    let data = load_cell_data(index, Source::CellDep).map_err(|_| Error::SyscallError)?;
    let members = OutPointVec::from_slice(&data).map_err(|_| Error::EncodingInvalid)?;

    for member in members.into_iter() {
        out_points.push(
            member
                .as_slice()
                .try_into()
                .map_err(|_| Error::EncodingInvalid)?,
        );
    }
    Ok(())
}

/// Tells whether `out_points` contains the same value twice.
///
/// Sorting makes it enough to compare neighbours.
fn any_duplicate(out_points: &mut [[u8; OutPoint::TOTAL_SIZE]]) -> bool {
    out_points.sort_unstable();
    out_points.windows(2).any(|pair| pair[0] == pair[1])
}

#[cfg(test)]
mod tests {
    use ckb_std::ckb_types::{
        packed::OutPoint,
        prelude::{Builder, Entity, Pack},
    };

    use super::any_duplicate;

    /// Builds a distinct `OutPoint` from a single byte.
    fn out_point(index: u8) -> [u8; OutPoint::TOTAL_SIZE] {
        let mut tx_hash = [0u8; 32];
        tx_hash[0] = index;
        let out_point = OutPoint::new_builder()
            .tx_hash(tx_hash.pack())
            .index(index as u32)
            .build();
        out_point
            .as_slice()
            .try_into()
            .expect("an OutPoint serializes to TOTAL_SIZE bytes")
    }

    #[test]
    fn distinct_out_points_are_accepted() {
        assert!(!any_duplicate(&mut [
            out_point(1),
            out_point(2),
            out_point(3)
        ]));
        assert!(!any_duplicate(&mut []));
        assert!(!any_duplicate(&mut [out_point(7)]));
    }

    #[test]
    fn a_repeated_out_point_is_detected() {
        assert!(any_duplicate(&mut [
            out_point(1),
            out_point(2),
            out_point(1)
        ]));
        assert!(any_duplicate(&mut [out_point(4), out_point(4)]));
    }
}
