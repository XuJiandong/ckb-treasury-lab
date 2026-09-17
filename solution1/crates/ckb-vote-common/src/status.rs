//! Status and direction values shared by the voting scripts.

/// `status` of a proposal cell: the proposal is open, votes can be cast.
pub const PROPOSAL_STATUS_OPEN: u8 = 0;
/// `status` of a proposal cell: the proposal has been finalized and can be challenged.
pub const PROPOSAL_STATUS_FINALIZED: u8 = 1;
/// `status` of a proposal cell: the proposal has passed, the grant can be applied.
pub const PROPOSAL_STATUS_PASSED: u8 = 2;

/// `direction` of a vote / counting cell: the vote rejects the proposal.
pub const DIRECTION_NO: u8 = 0;
/// `direction` of a vote / counting cell: the vote supports the proposal.
pub const DIRECTION_YES: u8 = 1;
