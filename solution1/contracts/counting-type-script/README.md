# counting-type-script

An aggregated batch of votes, so that the tally does not have to fit into a
single transaction. See [the specification](../../docs/counting-type-script-spec.md).

* `args`: 20 bytes, `blake160(proposal_type_script)`;
* data: `Counting { start_hash, end_hash, direction, vote_amount }`;
* creating a counting cell (`0 in / 1 out`):
  * the referenced proposal cell (a `cell_dep`) must be open, or finalized
    during the challenge phase;
  * every vote cell of the proposal listed in `cell_deps` must use the same
    direction, have a lock script whose hash starts with a 2 byte value inside
    the inclusive `[start_hash, end_hash]` range, must have been cast at most
    `config.vote_window` blocks after the proposal cell, and the voter locks
    must be unique;
  * the sum of the vote amounts must equal `vote_amount`, which makes the cell a
    self contained certificate;
* `1 in / 0 out` consumes the cell; a counting cell can not be updated, a
  certificate may not be rewritten after the fact.

The transaction must list the block headers of the proposal cell and of the
referenced vote cells in `header_deps`, see the [top level README](../../README.md).

*This contract was bootstrapped with [ckb-script-templates].*

[ckb-script-templates]: https://github.com/nervosnetwork/ckb-script-templates
