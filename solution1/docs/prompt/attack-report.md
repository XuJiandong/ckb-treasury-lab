# Attack Report - CKB Voting System (`solution1`)

Red team review of the four on-chain type scripts in `contracts/` against the
design in `docs/design.md` and the `docs/*-spec.md` documents.

The findings that were fixed are covered by the regular test suite: F2 lives in
[`tests/src/vote_tests.rs`](../tests/src/vote_tests.rs) next to the other vote
rules. The standalone proof-of-concept suite that reproduced F1, F3 and F5 was
removed once the findings were triaged, so those sections below are code
analysis only. F4 was reproduced as script behaviour too, but it is kept below
as a reviewed-and-dismissed item rather than a finding: it is intended design,
and the canonical config is pinned by the treasury cell, as
`docs/proposal-type-script-spec.md` requires.

## Summary

| # | Finding | Attacker goal it serves | Severity | Status | Coverage |
|---|---------|-------------------------|----------|--------|----------|
| F1 | The challenge-phase "NO" window was anchored at an input the initiator chooses | initiator: *make the challenge phase unusable* | High | **Fixed** (`Source::GroupInput`) | code analysis |
| F2 | Voting power could be inflated by referencing the same DAO deposit several times | initiator: *succeed without enough "yes" votes*; challenger: *win without enough "no" votes* | Critical | **Fixed** (`ensure_unique_cell_deps`) | `test_vote_duplicate_cell_dep_is_rejected`, `test_vote_duplicate_through_a_dependency_group_is_rejected`, `test_vote_two_dependency_groups_for_one_deposit_are_rejected` |
| F3 | The challenge bond is not paid to the challenger | challenger/hacker: *earn an incentive abnormally* | High | **Fixed** (`challenge_reward_present`) | code analysis |
| F4 | A proposal picks the config cell that governs it | initiator: *succeed by skipping checks* | Not a bug (intended design) | **By design** (the treasury cell pins the config id) | code analysis |
| F5 | A vote can be withdrawn while `emergent_halt` is set | hacker: *chaos / bypass the kill switch* | Not A bug (intended design) | **By design** | code analysis |
| - | One DAO deposit can vote both "YES" and "NO" | one stake counted on both sides | Medium | Open | code analysis |

F4 is listed for completeness. The proposal script is deliberately
config-agnostic; the deployment's canonical config is enforced by the treasury
cell, which `docs/proposal-type-script-spec.md`, "Receiving Assets", requires to
check the proposal's config id. See [F4](#f4---a-proposal-picks-the-config-cell-that-governs-it-by-design)
for the full reasoning.

A lower-severity divergence and several observations are listed in
[Additional observations](#additional-observations).

## Coverage against the attacker brief

Mapping of `docs/prompt/attack.md` to what was found:

| Brief item | Result |
|------------|--------|
| Initiator: succeed without enough "yes" votes | **F2** (fixed). A private config with a lower threshold is possible (F4), but it yields no assets: the treasury cell rejects a passed proposal that does not name the canonical config id. |
| Initiator: succeed by skipping checks | **F1** (fixed) let the origin check be skipped. F4 is not usable here: the treasury cell checks the proposal's config id before releasing assets. |
| Initiator: make the challenge phase unusable | **F1** (fixed) let the initiator control the challenge-phase "NO" window |
| Hacker: stop the initiator from advancing | *No direct lever found.* The initiator's finalize transaction only consumes its own proposal cell and references its own counting cells; vote and counting cells are immutable and locked by their creators, and no attacker-controlled cell is consumed by the initiator's transaction. The only risk is a careless lock on a counting cell, which is a deployment choice, not a script hole (see observation 6). |
| Hacker: block the initiator's processing | *Same as above.* The scripts have no unbounded loop over attacker data and every payload is length checked; a denial of service would have to come from the initiator's own cell deps or locks. |
| Hacker: inject malicious data | **F1** (fixed; an arbitrary `origin_block_number` used to become consensus relevant), **F5** (the halt switch is bypassed on one path). Molecule data itself is strictly decoded and all arithmetic is checked; see "What was probed and found sound". |
| Challenger: succeed without enough "no" votes | **F2** (fixed; the "NO" certificate could be inflated) |
| Challenger: succeed by skipping checks | **F2** (fixed); otherwise the challenge path enforces direction, range disjointness and `total_no >= total_yes` |
| Challenger: earn an incentive abnormally | **F3** (fixed; the bond now has to reach a lock used by the "NO" counting cells) |

---

## F1 - The challenge-phase window was anchored at an input the initiator chooses (fixed)

**Rule broken.** `docs/proposal-type-script-spec.md`, "Updating to be
finalized": *"The `origin_block_number` should be equal to the block number in
which the proposal cell is created."* `docs/counting-type-script-spec.md`,
"Others": the "NO" window of a finalized proposal is measured from
`origin_block_number`.

**Code (before).** `contracts/proposal-type-script/src/main.rs:205`

```rust
let origin = proposal::block_number_of(0, Source::Input)?;
if u64_of(output.origin_block_number()) != origin {
    return Err(Error::ProposalDataInvalid);
}
```

`proposal::block_number_of(index, source)` forwards to `load_header(index,
source)` (`crates/ckb-vote-common/src/proposal.rs:102`), and for
`Source::Input` the index addresses the transaction's **absolute input list**.
`0` is therefore the *first input of the transaction*, not the proposal input.

**Exploit.** The initiator added a decoy input (a plain funding cell they own)
in front of the proposal cell and wrote the decoy's creating block into
`origin_block_number`. `finalize` accepted it; nothing checked that the origin
was the proposal's own block. Because the counting script reads exactly that
field (`contracts/counting-type-script/src/main.rs:136-140`) and compares
`vote_block - window_origin` against `config.vote_window`
(`main.rs:180-186`), the initiator controlled the window in which "NO" votes
could be certified:

* a decoy created **after** the "NO" votes made `vote_block - origin`
  underflow, so every counting cell built against the finalized cell failed
  with `VoteOutsideWindow`;
* a decoy created **before** the proposal moved the window start earlier: the
  forged window `[origin, origin + vote_window)` closes earlier than the real
  `[proposal_block, proposal_block + vote_window)`, so legitimate "NO" votes
  near the end of the real window fell outside it. An old enough decoy emptied
  the window altogether.

**Fix (applied).** `contracts/proposal-type-script/src/main.rs:205` now reads
the block from the group input:

```rust
let origin = proposal::block_number_of(0, Source::GroupInput)?;
```

`Source::GroupInput` resolves to the inputs that carry this very proposal type
script, so the value is the block that created the consumed proposal cell no
matter where it sits in the input list.

**Note.** A property that outlives the fix: a challenger who pre-collects "NO"
certificates against the still-open proposal is not affected by the origin,
because the proposal script only sums a certificate's payload when it
challenges.

---

## F2 - Voting power could be inflated by repeating a DAO deposit (fixed)

**Rule broken.** `docs/vote-type-script-spec.md`, "Processing": the
`vote_amount` must be *"the sum of all related DAO deposit amounts"*;
`docs/design.md`, "Vote Cell" and the counting rules build the whole tally
(threshold and `total_no >= total_yes`) on that number.

**Code (before).** `contracts/vote-type-script/src/main.rs:128-153`

```rust
for (index, type_script) in QueryIter::new(load_cell_type, Source::CellDep).enumerate() {
    ...
    let capacity = load_cell_capacity(index, Source::CellDep)?;
    total_amount = total_amount.checked_add(capacity)...;
    deposit_count += 1;
}
```

The loop summed every **iteration** of `Source::CellDep` and never remembered
which out-points it had already counted. A DAO deposit listed twice was counted
twice; listing it `n` times gave `n` times its capacity. Nothing downstream
repaired this: the counting script only compares `sum(vote.vote_amount)` with
the counting cell's declared amount
(`contracts/counting-type-script/src/main.rs:197`), and the proposal script only
sums the counting cells (`contracts/proposal-type-script/src/main.rs:344-384`).
The "no double counting" checks the design relies on were *cross-voter*
(unique voter locks inside a counting cell, disjoint hash ranges), not
*per-deposit*.

**Exploit.**

1. Plain duplicate `cell_deps`: one deposit listed twice as a code dep. The
   consensus rule `ckb_verification::DuplicateDepsVerifier` rejects identical
   packed dependencies, but `ckb-testtool` does not run that verifier, so this
   form was demonstrable in the harness.
2. The mainnet valid form: `DuplicateDepsVerifier` hashes the packed `CellDep`,
   which contains both `out_point` and `dep_type`; a **dependency group** is a
   different `CellDep` for the same cell. Anybody can create the group cell
   (its data is just an `OutPointVec`), so the transaction carried:

   ```text
   cell_dep #1: { out_point: deposit, dep_type: Code }
   cell_dep #2: { out_point: group_cell, dep_type: DepGroup }   // expands to deposit
   ```

   The consensus check saw two distinct dependencies, while ckb-vm expanded the
   group and handed the deposit to `Source::CellDep` twice.
3. End to end, with `config.yes_threshold = 3 x VOTE_AMOUNT` and a single
   deposit of `VOTE_AMOUNT`, the inflated vote was accepted, a counting cell
   certified it, and the proposal was finalized with a third of the stake the
   system demanded. The same construction let a challenger win with a third of
   the "NO" votes the finalized `total_yes` required.

**Impact.** Stake weighting - the only Sybil resistance of the design - was
defeated: one small DAO deposit could carry arbitrary weight.

### Fix (applied)

Two complementary checks in `contracts/vote-type-script/src/main.rs`, both
reporting the new `Error::DuplicatedCellDep = 68`
(`crates/ckb-vote-common/src/error.rs`).

1. **`ensure_unique_cell_deps()`** loads the packed transaction and rejects it
   when two `cell_deps` carry the same `OutPoint`:

   ```rust
   let transaction = load_transaction().map_err(|_| Error::SyscallError)?;
   for cell_dep in transaction.raw().cell_deps().into_iter() {
       out_points.push(cell_dep.out_point().as_slice().try_into()...);
   }
   out_points.sort_unstable();
   if out_points.windows(2).any(|pair| pair[0] == pair[1]) {
       return Err(Error::DuplicatedCellDep);
   }
   ```

   This is the literal rule of `docs/vote-type-script-spec.md`
   ("the script should check that no duplicated OutPoint appears in
   `cell_dep`"). It catches the harness-only form above and any same
   out-point/different `dep_type` combination.

2. **`CellFingerprint` over the counted deposits** closes the dependency-group
   path. ckb-vm exposes no syscall for the out-point of a *resolved* cell dep:
   `load_input_out_point` returns `IndexOutOfBound` for `Source::CellDep`
   (`ckb-script/src/syscalls/load_input.rs`), and `CellField` has no `OutPoint`
   variant. A group's expansion therefore cannot be mapped back to out-points
   from inside the script. What the script *can* observe is the content of each
   resolved dependency, so two counted DAO deposits that agree on their lock
   hash, type hash, capacity and data hash are rejected:

   ```rust
   if CellFingerprint::any_duplicate(&mut deposits) {
       return Err(Error::DuplicatedCellDep);
   }
   ```

   A dependency group handing the same deposit to the script twice produces
   exactly such an indistinguishable pair, while a duplicate packed out-point
   is already caught by check 1.

**Trade-off and limits.** The fingerprint is conservative: a voter who
legitimately owns two DAO deposits with the same lock and the same capacity
(DAO deposit data is empty, so those two fields are the whole fingerprint)
cannot use both in one vote. Merging or splitting one of the deposits - an
operation the design already contemplates - restores the vote. The check only
runs on the deposits a vote counts, so it never affects code cells or the
config/proposal references.

**Binary size.** The vote type script grew from 88,976 to 124,920 bytes
(+36 KB, mostly `load_transaction` and molecule parsing). It is still far below
the 400 KB warning threshold of `AGENTS.md`.

**Tests.** Three regressions in `tests/src/vote_tests.rs`, sharing a
`DuplicateDep` knob on the vote plan:

* `test_vote_duplicate_cell_dep_is_rejected` - the same code dependency twice.
* `test_vote_duplicate_through_a_dependency_group_is_rejected` - once as a code
  dependency, once through a group (the mainnet valid form).
* `test_vote_two_dependency_groups_for_one_deposit_are_rejected` - two groups
  expanding to the same deposit; neither the packed out-points nor the group
  cells repeat.

Each declares an amount that matches the inflated sum, so the duplicate rule is
the only check that can fail.

---

## F3 - The challenge bond is not paid to the challenger (fixed)

**Rule broken.** `docs/proposal-type-script-spec.md`, "Updating to be
challenged": *"When a challenge succeeds, the finalized proposal cell is
consumed, and the challenger receives all assets in the proposal cell as an
incentive. The receiver's lock script should be one of lock script used in
counting cells."*

**Code (before).** `contracts/proposal-type-script/src/main.rs:250-278` (the
`PROPOSAL_STATUS_FINALIZED` branch of `settle`) never inspected the outputs:

```rust
let tally = collect_counting_cells(script, &config, status::DIRECTION_NO)?;
// TODO: challenge rules
if tally.count > 0 && tally.total_amount >= u64_of(proposal.total_yes()) {
    return Ok(());
}
```

`settle` is the `1 in / 0 out` branch, so the proposal cell's whole capacity
(the bond) was available to whatever outputs the transaction declared.

**Exploit.** The challenger pays to build a "NO" counting cell, but the counting
cell is a public on-chain object and the finalized proposal cell is locked by
the `always success` lock, so any third party could submit the same challenge
and route the bond to a lock of their own. The honest challenger was simply
front-run and lost the cost of the certificate.

**Impact.** The incentive that is supposed to pay for challenges could be stolen
by an observer; rationally, nobody challenges, which is equivalent to the
challenge phase not existing.

### Fix (applied)

`contracts/proposal-type-script/src/main.rs`:

* `Tally` now carries `lock_hashes: Vec<[u8; 32]>` - `collect_counting_cells`
  records the lock script hash of every counting cell it aggregates, from
  either `Source::Input` or `Source::CellDep`.
* `challenge_reward_present(&tally)` is true when some `Source::Output` has a
  lock hash equal to one of those counting cells' lock hashes:

  ```rust
  fn challenge_reward_present(tally: &Tally) -> Result<bool, Error> {
      Ok(QueryIter::new(load_cell_lock_hash, Source::Output)
          .any(|lock_hash| tally.lock_hashes.contains(&lock_hash)))
  }
  ```

* The challenge-success path requires that reward output and otherwise fails
  with the new `Error::ChallengeRewardMissing = 56`
  (`crates/ckb-vote-common/src/error.rs`). The stale `// TODO: challenge rules`
  marker is gone.

The counting cells are the challenger's certificates and are controlled by
their creator, so their lock script is the identity allowed to collect the
incentive. The check follows the spec sentence exactly (lock script only; there
is no additional capacity requirement, so a challenge that pays a matching lock
less than the full bond is still accepted).

**Binary size.** The proposal type script grew from 117,304 to 118,768 bytes
(+1.4 KB).

**Note.** The honest path of `tests/src/proposal_tests.rs`
(`test_challenge_proposal`) already pays the counting cell's own lock, so the
suite covers the positive case; no new test was added for the negative one.

---

## F4 - A proposal picks the config cell that governs it (by design)

**Reviewed behaviour, not a vulnerability.** `docs/design.md`, "Config Cell":
*"The ckb-blake160-hash of the config type script should be set in the args of
the proposal type script. All related config fields should be read from this
config cell."* Because the pointer is a hash, a proposal can name **any** config
cell, and `contracts/config-type-script/src/main.rs:67-74` lets anybody mint one
(the `(0, 1)` branch only performs the Type ID check, and the type script does
not constrain the lock). So a proposal backed by a private config with
`yes_threshold = 1`, `minimal_proposal_capacity = 1`, `vote_duration = 1` and
`challenge_time = 1` does finalize on a single vote, while the same vote against
the official config is rejected with `YesThresholdNotMet`. This is real script
behaviour and it was reproduced by the red-team suite.

**Why it is not a bug.** The proposal type script is deliberately
config-agnostic. The canonical config is pinned at the only place where the
system can part with assets: the **treasury cell**.
`docs/proposal-type-script-spec.md`, "Receiving Assets", states the contract
explicitly:

> The treasury cell checks the proposal cell for the following:
> 1. `code_hash`
> 2. `hash_type`
> 3. the first 20 bytes of the config id
> 4. the proposal cell's `status` is "passed"

The four scripts supply exactly what those checks need, so a treasury cell can
enforce them:

* the config id is the leading `CONFIG_ID_LEN` (20) bytes of the proposal
  `args`, which `contracts/proposal-type-script/src/main.rs:70-76` reads and
  `docs/proposal-type-script-spec.md`, "Script", defines as
  `blake160(config type script) || Type ID`;
* `code_hash`/`hash_type` identify the proposal type script itself;
* `status` lives in the proposal cell data and is `2` ("passed") only on the
  branch `settle` accepts for a grant
  (`contracts/proposal-type-script/src/main.rs:236-240`).

Once the treasury applies those four checks, the private-config proposal
described above is refused however cheaply it was finalized: the attacker's
config can govern only cells the attacker already controls, and it never
reaches the treasury. No change to the four scripts is needed.

**Note on scope.** The treasury itself is out of scope of
`docs/proposal-type-script-spec.md` and of this review, so the config-id check
is an obligation on that implementation, not a line of code in `contracts/`.
The division is intentional: the four scripts validate votes and counting, while
the treasury validates that the proposal it funds is the deployment's proposal
under the deployment's config. A treasury that skipped check 3 would fund a
private-config proposal, but that would be a bug in the treasury, not in the
scripts reviewed here. The earlier draft of this report listed the config
pointer as an open scripting gap; it is not one.

---

## F5 - A vote can be withdrawn while the system is halted (open)

**Rule broken.** `docs/config-type-script-spec.md`, "Cell Data":
*"The `emergent_halt` is read by all type scripts ... When set to `1`, all
scripts fail."*

**Code.** `contracts/vote-type-script/src/main.rs:77-88`

```rust
let outputs = QueryIter::new(load_cell_type_hash, Source::GroupOutput).count();
if outputs == 0 {
    // Withdrawing a vote ...
    return Ok(());
}
```

The withdrawal path returns before `config::ensure_running`
(`main.rs:125`) is ever reached, so the halt flag is not consulted.

**Impact.** Low. Letting users withdraw during a halt is arguably friendly, and
the flag still stops proposals, votes and counting. It is nevertheless a
divergence from the documented "all scripts fail", and it means a halt cannot be
used to freeze the vote supply while an incident is handled.

**Fix (suggested).** Load and check the config before the early return, or amend
the config spec to state that withdrawals stay live while halted.

---

## Additional observations

These are divergences or weaknesses worth tracking. They are read from the code
and are not separately reproduced.

1. **`finalized -> passed` does not preserve the bond.**
   `contracts/proposal-type-script/src/main.rs:154-166` checks the elapsed
   `challenge_time` and that `origin_block_number` is stable, but - unlike
   `finalize` (`main.rs:186-192`) - it does not require
   `input_capacity == output_capacity`. The rule *"The input capacity must equal
   the output capacity of the proposal cells. The bond serves as the
   challenger's incentive and must not be drained."*
   (`docs/proposal-type-script-spec.md`, "Updating to be finalized") is only
   enforced on `open -> finalized`. By the time the passed transition is legal
   the challenge window is over, so the practical impact is small; the check
   should still be symmetric.
2. **The same deposit can back a "YES" and a "NO" vote.** Nothing in the vote
   script ties a deposit to a single direction (or to a single vote), so one
   stake can be counted on both sides of the same proposal and cancel itself.
   The design only prevents "vote, withdraw, re-vote" through the "deposit older
   than the proposal" rule; it never states that a deposit may vote in one
   direction only. If the intent is "one deposit, one direction, one proposal",
   the vote script would have to burn or lock the deposit (for example by
   consuming it, or by recording it in a nullifier cell). The F2 fix does not
   address this: both votes are separate transactions with a single reference
   each.
3. **A challenge has no upper time bound.** The `PROPOSAL_STATUS_FINALIZED`
   branch of `settle` (`main.rs:250-278`) ignores the input `since` for the
   challenge itself, so a finalized proposal remains challengeable after
   `config.challenge_time` has elapsed, until the initiator manages to pass it.
   This favours challengers and contradicts the picture in
   `docs/design.md` ("While waiting for the finalized proposal cell to turn
   into a passed proposal cell..."), but it is not exploitable against the
   system.
4. **`finalize` accepts `total_yes` equal to `config.yes_threshold`** while
   `docs/proposal-type-script-spec.md` ("The vote amount should exceed the
   minimum requirement") and its next sentence ("If the sum is less than
   `config.yes_threshold`, it fails") can be read as a strict comparison. The
   code follows the `less than` wording (`>=` passes); the other sentence should
   be aligned.
5. **`config.vote_window` is not related to `config.vote_duration`.** With
   `vote_window > vote_duration` the initiator can delay finalization to collect
   votes for up to `vote_window` blocks, which extends the intended voting
   period. With `vote_window = 0` neither side can ever count a vote. A config
   sanity check (for example `0 < vote_window <= vote_duration`) would make the
   system harder to misconfigure.
6. **A counting cell can be created by anyone, for any proposal, with any
   range.** This is intended ("The counting cells are controlled by their
   creators"), but the type script does not constrain the lock of a counting
   cell, so a careless creator can leave their certificates spendable by
   everyone (griefing the finalize transaction). Worth a note in the spec.
7. **The F3 check binds the reward to the counting cell's lock, not to the
   full bond.** `challenge_reward_present` accepts any output with a matching
   lock, so the challenger can be paid less than the proposal cell's capacity
   (the rest is free to go elsewhere). The spec sentence only constrains the
   lock script; a stricter rule would require the matching output(s) to hold at
   least the consumed capacity.
8. **`CellFingerprint` relies on the cell content, not on identity.** As
   explained under F2, ckb-vm cannot report the out-point of a resolved cell
   dep, so the vote script reconstructs identity from content. The trade-off is
   documented there; a future VM syscall (`CellField::OutPoint` for cell deps)
   would let the script use the exact rule instead.

## What was probed and found sound

* **Type ID enforcement.** `create` uses `check_type_id(CONFIG_ID_LEN,
  TYPE_ID_LEN)` with the right offsets for the proposal and `(0, TYPE_ID_LEN)`
  for the config; the `(0, 1)` dispatch prevents the transfer branch of
  `validate_type_id` from being reached.
* **Strict molecule decoding.** Every payload goes through
  `from_slice` (not `from_compatible_slice`), and the schema in
  `crates/ckb-vote-types/molecules/types.mol` matches the specifications field
  by field (`status`/`description`/... for proposals, `start_hash`/`end_hash`/
  `direction`/`vote_amount` for counting).
* **Arithmetic.** All sums use `checked_add` (`AmountOverflow`), and the window
  subtraction uses `checked_sub`, so malformed values cannot wrap.
* **Counting-cell validation.** Direction, `start_hash <= end_hash`,
  lock-in-range, per-cell uniqueness of voter locks, vote window, and the
  equality `sum(vote_amount) == declared` are all enforced at creation, and
  counting cells are immutable (only `(0, 1)` and `(*, 0)` are accepted).
* **Finalize validation.** Status transition table, immutability of
  `description`/`requested_amount`/`recipient_lock_hash`, bond preservation,
  `always success` output lock, `total_yes == sum`, `>= yes_threshold`, and
  disjoint counting ranges - all present. The counting cells are matched by code
  hash **and** by `args == blake160(proposal type script)`.
* **Vote validation.** Direction, non-zero amount, DAO type script by
  `(code_hash, hash_type)`, deposit lock == vote lock, deposit strictly older
  than the proposal, voter lock unlocked by an input, amount equality, no
  repeated deposit, and one vote cell per proposal per transaction.
* **Config validation.** Args length, Type ID, burn rejection, payload decode
  and range checks on `emergent_halt` and the `hash_type` fields.
* **Config selection.** The proposal, vote and counting scripts locate the
  config by `blake160(config type script)`, a hash carried in their `args`, so a
  transaction cannot substitute a config *cell* for a given id
  (`crates/ckb-vote-common/src/config.rs:81-104`). Which id is canonical is
  pinned downstream by the treasury cell, as `docs/proposal-type-script-spec.md`
  requires; see [F4](#f4---a-proposal-picks-the-config-cell-that-governs-it-by-design).
* **`since` handling.** Every block count is compared against a *relative*,
  block-number-metric `since` (`crates/ckb-vote-common/src/since.rs`), and a
  missing/invalid `since` cannot be smuggled in as `0`.
* **Veto.** The veto is matched on the 32 byte lock hash from the config, so it
  cannot be forged without the administrator's lock.

## Harness caveats

`ckb-testtool`'s `Context::verify_tx` runs only `OutputsDataVerifier` plus the
script verifier; it does **not** run `NonContextualTransactionVerifier`
(tx version, size, duplicate deps), `SinceVerifier`, or the capacity verifier.
Two consequences for this report:

* the plain duplicate `cell_dep` case is a harness-level demonstration because
  the node's `DuplicateDepsVerifier` would already reject it; the
  dependency-group case was the mainnet valid form of F2 and is now refused by
  the vote script itself;
* `since` values in the tests are validated by the scripts, not by the node's
  maturity verifier, which is sufficient here because the scripts read the
  `since` field directly and never rely on the node having enforced it.

## Verification

```text
make build && make test
# 88 passed; 0 failed
```

The F2 regressions are in `tests/src/vote_tests.rs`:

```text
test vote_tests::test_vote_duplicate_cell_dep_is_rejected ... ok
test vote_tests::test_vote_duplicate_through_a_dependency_group_is_rejected ... ok
test vote_tests::test_vote_two_dependency_groups_for_one_deposit_are_rejected ... ok
```
