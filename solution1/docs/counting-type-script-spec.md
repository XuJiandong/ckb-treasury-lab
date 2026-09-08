# Counting Type Script Specification
This type script identifies a counting cell, through which the proposal initiator can collect votes.

## Script
```
code_hash: <code_hash of counting type script> 
hash_type: <hash_type of counting type script>
args: <20 bytes, ckb-blake160-hash of proposal type script>
```
The `args` is the ckb-blake160-hash of the proposal type script for which the vote is cast.

## Witness
No Witness is required.

## Cell Data
The cell data has the following structure in molecule format:
```
table Counting {
    start_hash: Bytes2,
    end_hash: Bytes2,
    direction: byte,
    vote_amount: Uint64,
}
```
`start_hash` and `end_hash` are read as big-endian `u16` integers, forming an inclusive hash range `[start_hash, end_hash]`. 

The `direction` is `0` for "NO" and `1` for "YES". The `vote_amount` is the sum of all related amounts in vote cells, as described later.

## Processing
The initiator can collect votes before the proposal cell is consumed. During the challenge phase, a challenger can likewise collect "no" votes while the finalized proposal cell is alive; since the finalized proposal cell carries the same type script, it can be referenced via cell_deps in place of the already consumed proposal cell.

The script iterates over all cells in `cell_deps` to find a proposal type script whose ckb-blake160-hash matches `args`; if none is found, the script fails.

While iterating, it collects all vote cells whose `code_hash` and `hash_type` match `config.vote_code_hash` and `config.vote_hash_type`. The vote type script's `args` should match the ckb-blake160-hash of the proposal type script. The ckb-hash of the corresponding lock script must follow this rule: the first 2 bytes of the hash, converted into `u16` in big-endian, should fall within [`start_hash`, `end_hash`]. And all these locks should be unique.

The script sums the `vote_amount` of all vote cells. The sum must equal the `vote_amount` in this cell's data. Also, the `direction` of every vote cell must equal the `direction` in this cell's data.

## Others
When the number of vote cells is large, it is suggested to slice them into several counting cells. Each counting cell handles an average-sized batch of vote cells. A counting cell's responsibility is to enable counting to work across different transactions and to reduce the workload.

The time to collect vote cells is not strict: "yes" votes may be collected any time before the proposal cell is consumed, and "no" votes for a challenge any time before the finalized proposal cell is consumed. The counting cells are controlled by their creators — the initiator for "yes" votes and the challenger for "no" votes — who can count the votes exactly before the referenced cell is consumed.
