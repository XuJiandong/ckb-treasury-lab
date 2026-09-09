# Proposal Type Script Specification
This is the proposal type script specification, which identifies the proposal cell, finalized proposal cell and passed proposal cell.


## Script
The script has the following structure:
```
code_hash: <code_hash to proposal type script>
hash_type: <hash_type to proposal type script>
args: <20 bytes, Type ID like args>
```

The `args` is the ckb-blake160-hash of the first CellInput structure of the creating transaction, combined with the output index of the cell. This makes the script unique across the entire blockchain. This mechanics is used in [Type ID](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md#type-id).

## Cell Data
The corresponding cell data has the following structure in molecule format:
```
table ProposalCellData {
    status: byte
    description: Bytes,
    applied_amount: Uint64,
    total_yes: Uint64,
}
```

The `status` field can take the following valid values to indicate the type of cell:
- 0: proposal cell
- 1: finalized proposal cell
- 2: passed proposal cell

The `description` field is UTF-8 text that describes the proposal.

The `applied_amount` field is the amount of assets that can be granted if the voting passes.

## Witness
No witness is needed.

## Processing
The type script goes through several phases, which are described in the following sections.


### Creating
In this phase, a proposal cell is created. The `args` must follow the Type ID rule, as described in the `Script` section, and the `status` field must be 0. The `total_yes` field should be 0.

The cell's `capacity` must be larger than `config.minimal_proposal_capacity`. If the proposal fails due to a challenge, this capacity is the assets to be lost.

The cell's lock script should be chosen from the initiator's pubkey, so that only the initiator can unlock the proposal cell and control the final operation.

### Updating to be finalized
In this phase, a proposal cell, together with some counting cells, is consumed to generate a finalized proposal cell. This can only happen after `config.vote_duration`, a relative `since` value based on the proposal cell, elapses. The `args` should be kept the same, as the Type ID rule requires. The output lock script of the finalized proposal cell should be the `always success` lock script, so that it can be challenged by others.

The script then goes through all counting cells, which are identified by `config.counting_cell_code_hash`/`config.counting_cell_hash_type`. It checks that the `args` is the ckb-blake160-hash of the proposal cell. Finally, it sums all "YES" values in the counting cells' cell data. If the sum is less than the `config.yes_threshold`, it fails. The `total_yes` field should be the sum.

Then it checks the `hash range` of all counting cells: they must not overlap. 

Finally, the `status` field in cell data should changed from `0`("proposal") to `1`("finalized").

### Updating to be passed
After the `config.challenge_time`(relative `since` value) elapses, the finalized proposal cell can be updated to a passed proposal cell.
The `status` field in the cell data should change from `1` ("finalized") to `2` ("passed").
See [RFC](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0017-tx-valid-since/0017-tx-valid-since.md) for more information.

### Updating to be challenged
This process is identical to the `Updating to be finalized` phase, except for the following:
* All counting cells should have a direction of "NO"

It sums all "NO" values (called `total_no`) in the counting cells' cell data. It then combines the `total_no` with `total_yes`; if the result meets a predefined value, it fails. TODO: This algorithm and its values are not defined yet.

The `status` field in input cell data should be `1`("finalized").

When a challenge succeeds, the finalized proposal cell is consumed, and the challenger receives all assets in the proposal cell as an incentive.

### Recycling the Proposal Cell

Once the sum of `config.vote_duration` and `config.challenge_time` (both relative `since` values) has elapsed, the initiator can consume the proposal cell and recycle its assets when the proposal fails to pass. The transaction must not include an output with a type script identical to the consumed proposal type script, so that the proposal cell is burned.

### Veto

If an input lock script's hash matches `config.veto_lock_script_hash`, a finalized proposal cell can be consumed and burned. This mechanism allows the administrator (represented by `config.veto_lock_script_hash`) to cancel a proposal.
