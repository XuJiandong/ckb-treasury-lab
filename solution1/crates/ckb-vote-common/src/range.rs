//! Hash ranges of counting cells.
//!
//! A counting cell covers the voters whose lock script hash starts with a 2
//! byte value inside `[start_hash, end_hash]`, both bounds included and read as
//! big endian `u16` values. When a proposal is finalized (or challenged), the
//! ranges of the referenced counting cells must not overlap, so that no voter
//! can be counted twice.

use crate::error::Error;

/// An inclusive hash range `[start, end]`.
///
/// Every hash range satisfies `start <= end`: a range with `start > end`
/// contains no value at all and is rejected by [`HashRange::new`], so a
/// `HashRange` value is always usable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct HashRange {
    start: u16,
    end: u16,
}

impl HashRange {
    /// Builds the hash range `[start, end]`.
    ///
    /// Every hash range has to satisfy `start <= end`, otherwise it is empty
    /// and [`Error::CountingRangeInvalid`] is returned.
    pub fn new(start: u16, end: u16) -> Result<HashRange, Error> {
        if start > end {
            return Err(Error::CountingRangeInvalid);
        }
        Ok(HashRange { start, end })
    }

    /// Lower bound, included.
    pub fn start(&self) -> u16 {
        self.start
    }

    /// Upper bound, included.
    pub fn end(&self) -> u16 {
        self.end
    }

    /// Tells whether `value` falls inside this range: `start <= value <= end`.
    pub fn contains(&self, value: u16) -> bool {
        self.start <= value && value <= self.end
    }

    /// Tells whether two ranges overlap, that is whether some value belongs to
    /// both of them: `exists v: h1 <= v <= h2 && h3 <= v <= h4`.
    ///
    /// Ranges that only touch (`[1, 2]` and `[3, 4]`) do not overlap; ranges
    /// that share a bound (`[1, 2]` and `[2, 3]`) do.
    pub fn overlaps(&self, other: &HashRange) -> bool {
        self.start <= other.end && other.start <= self.end
    }
}

/// Tells whether any two of the `ranges` overlap.
///
/// Ranges that merely touch are fine, so `[1, 2]` and `[3, 4]` are accepted
/// while `[1, 2]` and `[2, 3]` are not.
pub fn any_overlap(ranges: &mut [HashRange]) -> bool {
    // Sorting makes it enough to compare neighbours: a range always starts
    // after its predecessor, so an overlap with an earlier range implies an
    // overlap with the previous one.
    ranges.sort_unstable();
    ranges.windows(2).any(|pair| pair[0].overlaps(&pair[1]))
}

#[cfg(test)]
mod tests {
    use super::HashRange;
    use crate::error::Error;

    fn range(start: u16, end: u16) -> HashRange {
        HashRange::new(start, end).expect("valid range")
    }

    #[test]
    fn every_range_satisfies_start_le_end() {
        assert_eq!(
            HashRange::new(3, 2).unwrap_err(),
            Error::CountingRangeInvalid
        );
        assert_eq!(
            HashRange::new(65535, 0).unwrap_err(),
            Error::CountingRangeInvalid
        );
        // A range covering a single value is valid.
        assert_eq!(range(3, 3).start(), 3);
        assert_eq!(range(3, 3).end(), 3);
    }

    #[test]
    fn contains_includes_both_bounds() {
        let range = range(10, 20);
        assert!(!range.contains(9));
        assert!(range.contains(10));
        assert!(range.contains(15));
        assert!(range.contains(20));
        assert!(!range.contains(21));
    }

    #[test]
    fn ranges_overlap_when_a_value_belongs_to_both() {
        // Disjoint, even when they only touch.
        assert!(!range(1, 2).overlaps(&range(3, 4)));
        assert!(!range(65535, 65535).overlaps(&range(0, 0)));
        // Sharing a bound is enough: that value belongs to both ranges.
        assert!(range(1, 2).overlaps(&range(2, 3)));
        // Contained and crossing ranges.
        assert!(range(1, 10).overlaps(&range(2, 3)));
        assert!(range(2, 3).overlaps(&range(1, 10)));
        // Identical and single value ranges.
        assert!(range(5, 5).overlaps(&range(5, 5)));
        assert!(!range(5, 5).overlaps(&range(6, 6)));
    }

    #[test]
    fn any_overlap_scans_the_whole_set() {
        assert!(!super::any_overlap(&mut [
            range(1, 2),
            range(3, 4),
            range(5, 9)
        ]));
        assert!(super::any_overlap(&mut [
            range(1, 2),
            range(3, 4),
            range(2, 3)
        ]));
        assert!(super::any_overlap(&mut [range(1, 100), range(3, 4)]));
        assert!(!super::any_overlap(&mut []));
    }
}
