# Vote Type Script Specification
This type script identifies a vote cell, through which any user can cast a vote.

## Script

```
code_hash: <code_hash of vote type script>
hash_type: <hash_type of vote type script>
args: <20 bytes, ckb-blake160-hash of proposal type script>
```
The `args` is the ckb-blake160-hash of the proposal type script for which the vote is cast.


## Witness
No Witness is required.


## Cell Data
The cell data has the following structure in molecule format:
```
table Vote {
    vote_amount: Uint64,
    direction: byte,
}
```
The `vote_amount` is the sum of all related DAO deposit amounts, as described later.
The `direction` is `0` for "NO" or `1` for "YES". A "NO" vote can challenge the final results.

## Processing
The first output cell is the vote cell and carries this type script. Its lock script should represent the voter's identity and must be unlocked in the input cells. The other cells in this transaction can't be vote cell.

The script iterates over all cell_deps to find the proposal type script whose hash matches `args`. While iterating, the script collects all DAO deposit cells whose lock script matches the voter's lock script. The sum of all these DAO deposits must equal the `vote_amount` in the cell data. All DAO deposit cells should be older than the proposal cell, as determined by comparing the `number` in the `header` (block number).

## Others
Users must keep vote cells alive throughout the voting process. Any user can withdraw an existing vote by consuming the vote cell. A user may also cast a vote using only part of a DAO deposit, by referring to that portion of the deposit.

