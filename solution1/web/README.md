# CKB Voting — Web UI mockup

Static, dependency-free UI mockup of the voting system described in
[`../docs/design.md`](../docs/design.md). **There is no wallet, no RPC and no
transaction anywhere in this folder** — every cell, vote and config value comes
from `assets/js/mock-data.js`, and mutations are kept in `localStorage`.

The theme is light: a warm paper canvas with a yellow accent for anything the
user acts on, plus green / red / violet only where the protocol itself is
yes / no / finalized.

## Pages

| File | Entry point in the design |
| --- | --- |
| [`index.html`](index.html) | Welcome page: wallet indicator in the top right, the two entries, the whole `VotingConfig`, the cell/lock map |
| [`voter.html`](voter.html) | `For Voter`: live proposals, yes/no tallies, threshold progress, vote / withdraw |
| [`initiator.html`](initiator.html) | `For Proposal Initiator`: create / pre-check / count / finalize / pass, per-cell countdowns |
| [`challenger.html`](challenger.html) | `For Challenger`: every finalized proposal cell, plus check / count NO / challenge |

## Run

The pages are ES modules, so they need a server (`file://` will not work):

```sh
python3 -m http.server 4321 --directory web
# open http://127.0.0.1:4321/
```

## What the mockup shows

* **Wallet indicator** (top right) — click to pick a wallet; the mock resolves to
  `ckb1qzda0cr08m85hc8jlnfp3zerx8q3wu4f0hl2q0th2vgz0zgqf8q0qmv8tp`. Clicking an
  entry without a wallet asks to connect first, then the CKB address is used as
  the voter / initiator lock script.
* **Config cell** — all 13 `VotingConfig` fields, the config cell out point and
  `propose` type args (`blake160(config type script) || Type ID`).
* **Voter page** — proposals filtered to their voting window; each card shows
  `description`, `requested_amount`, `recipient_lock_hash`, yes/no tallies in
  CKB, `yes_threshold` progress and a countdown in blocks *and* estimated
  seconds (8 s per block). A vote spends the whole DAO deposit (82,450.62 CKB);
  afterwards the vote cell (amount + block number) and a *Withdraw* button
  replace the vote button.
* **Initiator page** — the create form writes a `ProposalCellData` preview
  before submitting; every proposal / finalized / passed cell of the address is
  listed with the operations its state currently allows, a stage strip and the
  relevant countdown:
  * voting open → *Count votes* (reports how many counting cells were
    generated), *Finalize* (only after `vote_duration` elapsed and
    `yes_threshold` reached);
  * finalized → *Pass* (only after `challenge_time` elapsed), *Challenge info*;
  * expired without the threshold → *Recycle bond*;
  * passed → *Claim grant*.
* **Challenger page** — reuses the same proposal-cell element (from
  `assets/js/proposal-card.js`) for every finalized proposal cell, and shows the
  comparison the script makes, `total_no ≥ total_yes`:
  * *Can it be challenged?* — dry run over the NO votes the challenger can see;
  * *Count NO votes* — creates one NO counting cell per lock script and reports
    how many were generated (only ever direction `0`; the deferred "pick which
    counting cells to use" filter is shown as a disabled `future` row);
  * *Challenge* — consumes those counting cells plus the finalized cell and
    mints the challenger cell that holds the bond, so the reward pays a lock
    script one of the counting cells uses. Once settled the cell reads
    `challenged · bond paid` and the reward cell is listed underneath.
* **Deferred features** from the requirements are shown as disabled `future`
  rows: picking which counting cells to use, and voting with a part of a deposit.
* *Reset demo data* in the header clears `localStorage` and restores the seeds.

## Layout

```
web/
├── index.html · voter.html · initiator.html · challenger.html
├── assets/css/tokens.css     # design tokens (light + yellow), base, components
├── assets/css/pages.css      # header, wallet menu, cards, page composition
├── assets/js/
│   ├── main.js               # entry point: shell + wallet + page dispatch
│   ├── mock-data.js          # config cell, type scripts, proposals, votes
│   ├── api.js                # mock SDK surface (views, precheck, vote, challenge…)
│   ├── state.js              # localStorage state (BigInt aware)
│   ├── ui.js                 # icons, toasts, badges, tallies, countdowns
│   ├── dialogs.js            # promise based modals
│   ├── layout.js             # header, wallet indicator, footer
│   ├── proposal-card.js      # the proposal-cell element, shared by both cell pages
│   └── pages/                # welcome.js · voter.js · initiator.js · challenger.js
└── tools/                    # headless-Chrome helpers used to verify the UI
```

## Verifying the UI

`tools/` drives headless Chrome over CDP. It reports JS exceptions, console
errors and failed requests, and can screenshot a page or a whole interaction:

```sh
node tools/check-page.mjs http://127.0.0.1:4321/voter.html \
  --expect ".card.proposal" --size 1440x950 --shot /tmp/voter.png

node tools/flow.mjs http://127.0.0.1:4321/initiator.html \
  '[{"click":".header-actions .btn--primary"},{"wait":1400},
    {"click":".walletopt"},{"wait":1500},
    {"click":"#cell-p1 [data-action=count]"},{"wait":2000},
    {"shot":"/tmp/count.png"}]'
```

Both exit non-zero if anything logged an error.
