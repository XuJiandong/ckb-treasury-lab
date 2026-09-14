# config-type-script

The singleton configuration cell of the voting system. See
[the specification](../../docs/config-type-script-spec.md).

* `args`: 20 bytes, Type ID (`blake160(first input of the creating transaction
  || output index)`);
* data: `VotingConfig`, see `crates/ckb-vote-types/molecules/types.mol`;
* `0 in / 1 out` (minting): the Type ID rule is enforced;
* `1 in / 1 out` (updating): allowed, for instance to set `emergent_halt`; the
  data must still decode as a `VotingConfig`;
* `1 in / 0 out` (burning): rejected, a burned config cell would freeze every
  voting script.

Every other script of the system loads this cell as a cell dependency, and
`config.emergent_halt` stops all of them. The cell must therefore be locked by a
safe lock script (a multisig is suggested).

*This contract was bootstrapped with [ckb-script-templates].*

[ckb-script-templates]: https://github.com/nervosnetwork/ckb-script-templates
