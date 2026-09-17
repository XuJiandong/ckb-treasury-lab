/**
 * Protocol constants shared with the on-chain scripts.
 *
 * They mirror `crates/ckb-vote-common/src/constants.rs` and `status.rs`.
 */

import type { ccc } from "@ckb-ccc/shell";

/** Length of a Type ID, and of a ckb-blake160-hash. */
export const TYPE_ID_LEN = 20;

/** Length of `blake160(config type script)`, the leading proposal args. */
export const CONFIG_ID_LEN = 20;

/** Proposal type script args: `blake160(config type script) || Type ID`. */
export const PROPOSAL_ARGS_LEN = CONFIG_ID_LEN + TYPE_ID_LEN;

/** Vote and counting type script args: `blake160(proposal type script)`. */
export const PROPOSAL_ID_LEN = 20;

/** The `recipient_lock_hash` of a proposal: the ckb-blake160-hash of a lock. */
export const RECIPIENT_LOCK_HASH_LEN = 20;

/** Status of a proposal cell (`ProposalCellData.status`). */
export const ProposalStatus = {
  /** Votes can be cast. */
  Open: 0,
  /** Voting is over, enough "YES" votes were counted; it can be challenged. */
  Finalized: 1,
  /** The challenge window elapsed; the grant can be claimed. */
  Passed: 2,
} as const;
export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];

/** Direction of a vote / counting cell. */
export const Direction = {
  /** Rejects the proposal, used to challenge a finalized one. */
  No: 0,
  /** Supports the proposal. */
  Yes: 1,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** The largest `hash_type` byte the contracts accept (`MAX_SCRIPT_HASH_TYPE`). */
export const MAX_HASH_TYPE_BYTE = 2;

/**
 * Code hashes of the genesis system scripts, identical on every chain.
 *
 * They are the `type` hashes of the code cells declared in the chain spec
 * (RFC 0024 for the DAO, the system script list for the locks), which is why
 * only the cell deps differ between networks.
 */
export const SYSTEM_SCRIPT_CODE_HASHES = {
  Secp256k1Blake160:
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
  Secp256k1Multisig:
    "0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8",
  NervosDao:
    "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
} as const;

/** Numeric value of a `HashType`, as stored in the config cell data. */
export const HASH_TYPE_BYTES: Record<ccc.HashType, number> = {
  data: 0,
  type: 1,
  data1: 2,
  // CKB defines `data2` as 4, which is beyond the largest hash type the
  // contracts accept (`MAX_SCRIPT_HASH_TYPE`); it can never be configured.
  data2: 4,
};

/** Parses the `direction` argument of the CLI / API. */
export function parseDirection(value: string | number | bigint): Direction {
  if (value === "yes" || value === 1 || value === 1n) return Direction.Yes;
  if (value === "no" || value === 0 || value === 0n) return Direction.No;
  throw new Error(`Invalid direction ${value}: expected "yes" / "no"`);
}

/** Parses a proposal status. */
export function parseProposalStatus(value: string | number): ProposalStatus {
  if (value === "open" || value === 0) return ProposalStatus.Open;
  if (value === "finalized" || value === 1) return ProposalStatus.Finalized;
  if (value === "passed" || value === 2) return ProposalStatus.Passed;
  throw new Error(
    `Invalid proposal status ${value}: expected "open" / "finalized" / "passed"`,
  );
}

/** Human readable name of a proposal status. */
export function proposalStatusName(status: number): string {
  switch (status) {
    case ProposalStatus.Open:
      return "open";
    case ProposalStatus.Finalized:
      return "finalized";
    case ProposalStatus.Passed:
      return "passed";
    default:
      return `unknown(${status})`;
  }
}
