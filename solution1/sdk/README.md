# CKB Voting System SDK

TypeScript SDK and `ckb-vote` CLI for the on-chain voting system of
`contracts/`: the config cell, the proposal lifecycle, the vote cells and the
counting cells. It is built on [`@ckb-ccc/shell`](https://github.com/ckb-devrel/ccc)
and runs **only under Bun** (developed with `bun 1.4.2`).

The SDK builds and sends the transactions the four type scripts expect, and
queries the cells they produce. Every rule it enforces locally comes from
`docs/*.md` and from `contracts/*/src/main.rs`.

```
src/
  config.ts       deployment config (JSON) loading and validation
  client.ts       client / signer construction
  codec.ts        molecule codecs of the four cell payloads
  constants.ts    statuses, directions, lengths, system script hashes
  utils.ts        hashing, Type ID, script/cell/header helpers
  query.ts        cell discovery and decoding
  config-cell.ts  create / update the config cell, check a deployment
  proposal.ts     create, finalize, pass, challenge, recycle, veto, grant
  vote.ts         cast and withdraw a vote
  counting.ts     create and consume a counting cell
  deploy.ts       publish the contract binaries
  devnet.ts       derive a devnet's known-script cell deps from block 0
  cli/            the ckb-vote CLI
```

## Install

```sh
cd sdk
bun install
```

## Quick start on a local devnet

The examples assume a devnet node on `http://127.0.0.1:8114` and a funded
private key file (`pk`), e.g. the first genesis account of
`docs/knowledge/devnet.md`.

```sh
# 1. Derive the devnet's genesis cell deps (they differ per devnet).
bun run src/cli/index.ts devnet-scripts --out ../deployment/devnet.json

# 2. Publish the five binaries from ../build/release and complete the config.
bun run src/cli/index.ts deploy \
  --config ../deployment/devnet.json \
  --private-key-file pk \
  --out ../deployment/devnet.json

# 3. Mint the config cell and record its Type ID.
bun run src/cli/index.ts create-config \
  --config ../deployment/devnet.json --write ../deployment/devnet.json \
  --private-key-file pk \
  --minimal-proposal-capacity 200 --yes-threshold 100 \
  --vote-duration 5 --vote-window 1000 --challenge-time 5

# 4. A DAO deposit older than the proposal is what a vote is backed by.
#    (Create one with any DAO tool; the SDK only consumes deposits.)

# 5. Create a proposal, vote and collect the votes.
PROPOSAL=$(bun run src/cli/index.ts create-proposal \
  --config ../deployment/devnet.json --private-key-file pk \
  --description "Fund the docs" --requested-amount 150 --json | jq -r .proposalCell.txHash)

bun run src/cli/index.ts vote \
  --config ../deployment/devnet.json --private-key-file pk \
  --proposal $PROPOSAL:0 --direction yes

COUNTING=$(bun run src/cli/index.ts create-counting \
  --config ../deployment/devnet.json --private-key-file pk \
  --proposal $PROPOSAL:0 --direction yes \
  --start-hash 0 --end-hash 65535 --json | jq -r .countingCell.txHash)

# 6. Finalize after vote_duration, pass after challenge_time, claim the grant.
bun run src/cli/index.ts finalize-proposal \
  --config ../deployment/devnet.json --private-key-file pk \
  --proposal $PROPOSAL:0 --counting $COUNTING:0 --wait
bun run src/cli/index.ts pass-proposal \
  --config ../deployment/devnet.json --private-key-file pk \
  --proposal <FINALIZED>:0 --wait
bun run src/cli/index.ts receive-grant \
  --config ../deployment/devnet.json --private-key-file pk \
  --proposal <PASSED>:0
```

Every command accepts `--config <path>`, `--rpc-url <url>` and `--json`;
`--private-key` or `--private-key-file` is needed to send a transaction. Run
`bun run src/cli/index.ts --help` for the full list.

After `bun link` (or `bun install -g .`) the same commands are available as
`ckb-vote`, which runs `bin/ckb-vote.ts` with Bun.

## Deployment config

Nothing about a deployment is hard-coded: scripts, code cells and the config
cell all live in one JSON file (`deployment.example.json` shows the shape).
`deploy` and `devnet-scripts` generate it; `create-config --write` and
`update-config --write` keep the config cell coordinates up to date.

```jsonc
{
  "rpcUrl": "http://127.0.0.1:8114",
  "feeRate": 1500,
  "scripts": {
    "config":        { "codeHash": "0x..", "hashType": "data1", "args": "0x<Type ID>",
                       "cellDep": { "txHash": "0x..", "index": 0, "depType": "code" } },
    "proposal":      { "codeHash": "0x..", "hashType": "data1", "cellDep": { ... } },
    "vote":          { ... },
    "counting":      { ... },
    "alwaysSuccess": { ... }
  },
  "configCell": { "txHash": "0x..", "index": 0 },
  "knownScripts": { "Secp256k1Blake160": { ... }, "NervosDao": { ... } }
}
```

- `scripts.<name>.codeHash` / `hashType` are what the SDK writes in a script
  that references the deployed one; `cellDep` is the code cell to list in
  `cell_deps`.
- `scripts.config.args` is the Type ID of the config type script. It is
  produced by `create-config` and is required before a proposal can be created.
- `configCell` is optional: when it is missing (or stale, after an update) the
  config cell is searched by type script, which needs a node indexer.
- `knownScripts` overrides CCC's built-in system script cell deps, which differ
  on a devnet. `devnet-scripts` derives them from block 0.

## API

```ts
import { ccc } from "@ckb-ccc/shell";
import {
  loadConfig,
  buildClient,
  createProposal,
  castVote,
  createCountingCell,
  finalizeProposal,
  receiveGrant,
  findProposalCells,
  findVoteCells,
  findCountingCells,
  ProposalStatus,
} from "@ckb-vote/sdk";

const config = loadConfig("../deployment/devnet.json");
const signer = new ccc.SignerCkbPrivateKey(buildClient(config), privateKey);

const { proposalCell, proposalId } = await createProposal(signer, config, {
  description: "Fund the docs",
  requestedAmount: 150n * 100_000_000n,
  recipient: "ckt1q...", // defaults to the signer's lock
  capacity: 200n * 100_000_000n, // the bond, defaults to the configured minimum
});

await castVote(signer, config, {
  proposalOutPoint: proposalCell,
  direction: "yes",
  // `deposits` selects the DAO deposits; by default every deposit of the voter
  // that is older than the proposal is used.
});

const counting = await createCountingCell(signer, config, {
  proposalOutPoint: proposalCell,
  direction: "yes",
  startHash: 0,
  endHash: 0xffff,
});

await finalizeProposal(signer, config, {
  proposalOutPoint: proposalCell,
  countingOutPoints: [counting.countingCell],
  wait: true, // wait until config.vote_duration elapsed
});

for await (const { cell, data } of findProposalCells(client, config)) {
  console.log(cell.outPoint, ProposalStatus[data.status], data.description);
}
```

Every operation throws before sending anything when a local rule of the
specification is violated (empty hash range, overlapping counting ranges, "NO"
votes below `total_yes`, a grant that does not pay `recipient_lock_hash`, …), and
the contract still validates the transaction on chain.

## What the SDK handles

- **Type IDs.** The config and proposal type scripts are Type IDs, so their
  `args` are derived from the first input and the output index after the inputs
  are collected.
- **Cell deps.** Every script code cell, the config cell, the referenced
  proposal / vote / counting cells and the DAO deposits are added exactly once:
  the vote script rejects a transaction whose `cell_deps` reach the same out
  point twice.
- **Header deps.** The scripts read the creating block of a cell through
  `load_header`, so the SDK lists exactly the headers the transaction needs.
- **`since`.** `finalize`, `pass` and `recycle` set a relative, block-number
  `since` and can wait for the chain to reach the required block (`wait`).
- **DAO deposits.** The vote is backed by the voter's deposited DAO cells that
  are older than the proposal; newer ones are skipped and reported.

## Notes and gotchas

- **Bun only.** The package is TypeScript-first and uses Bun's native TS
  execution; there is no `tsc` build step (`bunx tsc --noEmit` type checks).
- **`hash_type` must not be `data`.** A script whose hash type is `data` runs
  on CKB VM version 0, which the ckb-std 1.x binaries cannot use
  (`MemWriteOnExecutablePage`). `deploy` publishes with `data1` for this
  reason; hand-written configs should use `data1` or `type`.
- **No dependency groups in `cell_deps`.** The vote script's out-point
  uniqueness check reads a group's `OutPointVec` from `Source::CellDep`, which
  the VM resolves to the group's _first member_, so any real dep group makes it
  fail with `EncodingInvalid` (exit code 3). `devnet-scripts` therefore lists
  the secp256k1 data cell and code cell as plain `code` deps instead of the
  standard dep group.
- **`vote_window`.** A vote cell must be counted within `config.vote_window`
  blocks after the proposal was created; `create-counting` reports the offending
  cell instead of sending a doomed transaction.
- **Queries list live cells only.** `list-proposals` shows the proposals that
  still exist; a consumed (recycled, vetoed, challenged or granted) proposal no
  longer appears.
- **Indexer.** The discovery commands (`list-*`, config cell discovery, vote
  and deposit lookup) use the node's `get_cells` indexer; every write command
  also works from explicit out points.
