# Config Type Script Specification
In this voting system, many configurations need to be set. We collect them into a dedicated config cell, whose type script is the config type script described here.

Any field can be referred to as `config.<field>` across design and specification documents.

## Script

```
code_hash: <code_hash to config type script>
hash_type: <hash_type to config type script>
args: <20 bytes, Type ID like args>
```

The `args` is the ckb-blake160-hash of the first CellInput structure of the creating transaction, combined with the output index of the cell. This makes the script unique across the entire blockchain. This mechanics is used in [Type ID](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md#type-id).

## Cell Data
It has following structures in molecule format:

```
table VotingConfig {
    vote_code_hash: Bytes32,
    vote_hash_type: byte,
    counting_code_hash: Bytes32,
    counting_hash_type: byte,
    yes_threshold: Uint64,
    minimal_proposal_capacity: Uint64,
    challenge_time: Uint64,
}
```

## Security
This cell is very important and should be locked by a very safe lock script, as compromising it can break the whole voting system. It is suggested to use multisig to lock this cell.

