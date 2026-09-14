# vote-type-script

A DAO backed vote for a proposal. See
[the specification](../../docs/vote-type-script-spec.md).

* `args`: 20 bytes, `blake160(proposal_type_script)`;
* data: `Vote { vote_amount, direction }`, `direction` is `0` for "NO" and `1`
  for "YES";
* casting a vote (`0 in / 1 out`):
  * the vote cell lock script must be unlocked by an input, which proves the
    ownership of the DAO deposits;
  * the referenced proposal cell (a `cell_dep`) must still be open;
  * every DAO deposit of the voter listed in `cell_deps` must predate the
    proposal cell, and their total capacity must equal `vote_amount`;
  * at most one vote cell per proposal may be created in a transaction, since
    all the vote cells of a proposal share the same type script (and hence the
    same script group);
* consuming a vote cell (`1 in / 0 out`) withdraws the vote and recycles its
  capacity.

The transaction must list the block headers of the proposal cell and of the
referenced DAO deposits in `header_deps`, see the [top level README](../../README.md).

*This contract was bootstrapped with [ckb-script-templates].*

[ckb-script-templates]: https://github.com/nervosnetwork/ckb-script-templates
