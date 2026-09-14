# proposal-type-script

The proposal cell, its finalized state and its passed state. See
[the specification](../../docs/proposal-type-script-spec.md).

* `args`: 20 bytes, Type ID (`blake160(first input of the creating transaction
  || output index)`);
* data: `ProposalCellData { status, description, applied_amount, total_yes }`,
  `status` is `0` (open), `1` (finalized) or `2` (passed);
* creating a proposal (`0 in / 1 out`): the Type ID rule is enforced, the status
  must be `0`, `total_yes` must be `0` and the capacity must be at least
  `config.minimal_proposal_capacity`;
* finalizing (`1 in / 1 out`, `0 -> 1`): only after `config.vote_duration`, the
  output must be locked by the `always success` lock, the "YES" counting cells
  must certify at least `config.yes_threshold`, `total_yes` must record their
  sum, and the bond may not shrink;
* passing (`1 in / 1 out`, `1 -> 2`): only after `config.challenge_time`;
* settling (`1 in / 0 out`): a passed proposal can be consumed by whoever
  applies the grant, a finalized one can be vetoed by `config.veto_lock_script_hash`,
  challenged by enough "NO" counting cells, or recycled after
  `vote_duration + challenge_time`; an open one can only be recycled.

`description` and `applied_amount` are frozen when the proposal is created.

*This contract was bootstrapped with [ckb-script-templates].*

[ckb-script-templates]: https://github.com/nervosnetwork/ckb-script-templates
