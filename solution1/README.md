# CKB Draft Voting System

A candidate solution, See [design document](./docs/design.md)

## Crates and contracts

| Path | Description |
| --- | --- |
| `contracts/config-type-script` | the singleton config cell ([spec](./docs/config-type-script-spec.md)) |
| `contracts/proposal-type-script` | proposal / finalized proposal / passed proposal ([spec](./docs/proposal-type-script-spec.md)) |
| `contracts/vote-type-script` | a DAO backed vote ([spec](./docs/vote-type-script-spec.md)) |
| `contracts/counting-type-script` | an aggregated batch of votes ([spec](./docs/counting-type-script-spec.md)) |
| `contracts/always-success` | the lock of a finalized proposal cell, so that it can be challenged |
| `crates/ckb-vote-types` | the molecule types of the system |
| `crates/ckb-vote-common` | shared script code: config loading, errors, hashes, `since` |

```bash
make build   # builds every contract for riscv64imac-unknown-none-elf
make test    # runs the integration tests from tests/ on ckb-vm
```

## How the scripts find each other

* A **vote** cell and a **counting** cell store `blake160(proposal_type_script)`
  in their `args`, which is what binds them to a proposal. The proposal cell is
  referenced through `cell_deps`.
* A vote / counting cell identifies the **proposal** by hashing the type scripts
  it finds in `cell_deps`; no code hash has to be configured for that, the
  proposal type script is unique on the chain (Type ID).
* The **config** cell is a cell dependency of every transaction that runs a
  voting script. Its script identity is not derivable from the transaction, so
  it is a deployment parameter, see below.
* Counting cells may either be consumed (inputs) or only referenced (cell deps)
  when a proposal is finalized or challenged; both are accepted.

## Block numbers

A vote is only valid inside `config.vote_window` blocks after the proposal cell,
and a DAO deposit only counts when it is older than the proposal cell. Both
checks need the block number that created a cell, which ckb-vm can resolve for
cells in `cell_deps` - but only when the matching block header is attached to
the transaction:

* creating a **vote** cell: `header_deps` must contain the headers of the blocks
  that created the proposal cell and every referenced DAO deposit;
* creating a **counting** cell: `header_deps` must contain the headers of the
  blocks that created the proposal cell and every referenced vote cell.

## Deployment parameters

`crates/ckb-vote-common/src/deployment.rs` holds the scripts and cells that a
script cannot derive from the transaction:

| Constant | Meaning |
| --- | --- |
| `DAO_TYPE_SCRIPT_CODE_HASH` | the genesis Nervos DAO type script (RFC 0024), used to recognise DAO deposits |
| `CONFIG_TYPE_SCRIPT_CODE_HASH` / `_HASH_TYPE` | the deployed config type script |
| `ALWAYS_SUCCESS_CODE_HASH` / `_HASH_TYPE` | the deployed `always success` lock script, required for finalized proposal cells |

The DAO constant is a genesis value and is already filled in. The two other
constants are all zeros by default, which means *not pinned*: the scripts then
fall back to a relaxed check (the config cell is recognised by a 20 byte Type ID
style `args` plus a well formed `VotingConfig` payload, and the finalized
proposal lock is only required to have no args). A production deployment **must**
fill these in and rebuild, otherwise a transaction could substitute a permissive
config cell, or lock a finalized proposal with a lock that nobody can challenge.

## Decisions left open by the specifications

* The challenge rule is still a `TODO` in the proposal specification. This
  implementation cancels a finalized proposal when the referenced "NO" counting
  cells certify at least as much weight as the `total_yes` recorded in the
  proposal cell (`total_no >= total_yes`).
* A proposal bond may not be reduced by the `open -> finalized` transition: it
  is the challenger's incentive. `description` and `applied_amount` are frozen
  when the proposal is created, they are what the voters decide on.
* `config.minimal_proposal_capacity` is treated as a minimum, so a bond equal to
  it is accepted.
* Every path of every script fails while `config.emergent_halt` is set, as
  described in the config specification.
