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

## Logging

Every contract carries an `enable_log` feature which is part of the default
features, so a plain `make build` produces scripts that report what they do. It
wires `ckb-std/log`, installs ckb-std's logger in the entry point and lets the
scripts emit `log!`, `warn!` and `error!` messages: `log!` follows the normal
path, `warn!` marks notable events and rule violations, and `error!` records why
a transaction was rejected - the exit code alone does not say that.

Logging costs a few kilobytes per binary and some cycles. For a minimal, logging
free build, disable the default features of the contract:

```bash
make -C contracts/proposal-type-script build CARGO_ARGS="--no-default-features"
```

Add `BUILD_DIR=build/release` (or `build/debug`, matching `MODE`) to have the
binary land where `make test` loads it from.

The messages show up in the node log
(`[logger] filter = "info,ckb-script=debug"`) or through `ckb-debugger`.
