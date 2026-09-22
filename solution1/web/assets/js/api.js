/**
 * Mock of the SDK surface the UI would call.
 *
 * Every function returns the shape `sdk/src/*` returns, but the values come
 * from `mock-data.js` + `localStorage`. Nothing is signed, submitted or read
 * from a node.
 */

import {
  CHAIN,
  CONFIG_CELL,
  MOCK_BOND_BALANCE,
  MOCK_DAO,
  MOCK_WALLET,
  TYPE_SCRIPTS,
  proposalTypeScript,
} from "./mock-data.js";
import { findProposal, getState, setState, updateProposal } from "./state.js";
import { CKB, sleep } from "./util.js";

/**
 * `constants.ts` -> `ProposalStatus`, plus the terminal state this mockup uses
 * for a finalized cell that a challenger already consumed.
 */
export const ProposalStatus = { Open: 0, Finalized: 1, Passed: 2, Challenged: 3 };
/** `constants.ts` -> `Direction`. */
export const Direction = { No: 0, Yes: 1 };

/** A live snapshot: the chain tip and the moment the UI read it. */
function snapshot() {
  return { block: CHAIN.blockNumber, syncedAt: CHAIN.syncedAt };
}

/** Block heights that matter for the countdowns of one proposal. */
export function deadlines(proposal) {
  const config = CONFIG_CELL.data;
  const createdAt = BigInt(proposal.createdAtBlock);
  const createdOnChain = proposal.originBlockNumber
    ? BigInt(proposal.originBlockNumber)
    : createdAt;
  return {
    voteEnds: createdAt + config.voteDuration,
    // On chain this is the relative `since` of the finalized input; the mockup
    // anchors it on the block the finalized cell was produced.
    challengeEnds: createdOnChain + config.challengeTime,
  };
}

/** The view model every page renders from. */
export function proposalView(proposal) {
  const { block, syncedAt } = snapshot();
  const config = CONFIG_CELL.data;
  const { voteEnds, challengeEnds } = deadlines(proposal);

  const yes = BigInt(proposal.totalYes);
  const no = BigInt(proposal.totalNo);
  const total = yes + no;
  const threshold = config.yesThreshold;
  const remaining = voteEnds - block;
  const challengeRemaining = challengeEnds - block;
  const voteActive =
    proposal.status === ProposalStatus.Open && remaining > 0n && !config.emergentHalt;
  const counted = yes >= threshold;

  const myVote = walletVote(proposal);
  const challenge = proposal.challenge ?? null;
  const noCounted = challenge ? BigInt(challenge.countedNo) : 0n;
  const challengeElapsed = challengeRemaining <= 0n;
  // A challenge is settled by consuming the finalized cell, so it is only
  // possible while that cell is still alive.
  const challenged = proposal.status === ProposalStatus.Challenged;
  const challengeOpen =
    proposal.status === ProposalStatus.Finalized &&
    !challenged &&
    !challengeElapsed &&
    !config.emergentHalt;
  // `total_no >= total_yes`, see docs/proposal-type-script-spec.md.
  const challengeMet = noCounted > 0n && noCounted >= yes;

  return {
    ...proposal,
    ref: proposal.outPoint,
    yes,
    no,
    total,
    threshold,
    thresholdReached: counted,
    missingYes: threshold > yes ? threshold - yes : 0n,
    voteEnds,
    challengeEnds,
    remainingBlocks: remaining > 0n ? remaining : 0n,
    voteExpired: remaining <= 0n,
    challengeRemainingBlocks: challengeRemaining > 0n ? challengeRemaining : 0n,
    challengeExpired: challengeRemaining <= 0n,
    voteActive,
    voteWindowOpen: voteActive,
    accepted: counted,
    myVote,
    hasVoted: Boolean(myVote),
    // Challenge view model.
    challenged,
    challengeOpen,
    challenge,
    noCounted,
    noCountedCells: challenge?.countingCells ?? 0,
    noCountedRanges: challenge?.ranges ?? [],
    /** What this challenger still has to certify with NO counting cells. */
    noMissing: challengeMet ? 0n : yes - noCounted,
    challengeMet,
    reward: BigInt(proposal.bond),
    challengerCell: proposal.challengerCell ?? null,
    syncedAt,
    blockNumber: block,
  };
}

export function allViews() {
  return getState().proposals.map(proposalView);
}

/** Proposal cells of the connected initiator, newest first. */
export function initiatorViews() {
  return allViews().sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
}

/**
 * The finalized proposal cells a challenger can act on: every one that is still
 * alive, plus the ones this challenger already settled so the reward shows.
 */
export function challengerView() {
  return allViews()
    .filter(
      (view) =>
        view.status === ProposalStatus.Finalized ||
        view.status === ProposalStatus.Challenged,
    )
    .sort((a, b) => Number(a.challengeRemainingBlocks - b.challengeRemainingBlocks));
}

/** Open proposals whose voting window has not elapsed (the voter page list). */
export function votableViews() {
  return allViews()
    .filter((view) => view.status === ProposalStatus.Open && !view.voteExpired)
    .sort((a, b) => Number(a.remainingBlocks - b.remainingBlocks));
}

export const config = {
  cell() {
    return CONFIG_CELL;
  },
  data() {
    return CONFIG_CELL.data;
  },
  typeScripts() {
    return TYPE_SCRIPTS;
  },
  dao() {
    return MOCK_DAO;
  },
  bondBalance() {
    return MOCK_BOND_BALANCE;
  },
};

export function wallet() {
  return getState().wallet;
}

export function isConnected() {
  return Boolean(getState().wallet);
}

export async function connectWallet(walletId) {
  await sleep(760);
  const wallet = { ...MOCK_WALLET, provider: walletId ?? "ccc" };
  setState((current) => ({ ...current, wallet }));
  return wallet;
}

export function disconnectWallet() {
  setState((current) => ({ ...current, wallet: null }));
}

export function walletVote(proposal) {
  const me = wallet();
  if (!me) return null;
  return (
    proposal.votes.find((vote) => vote.voterLockHash === me.lock.args) ?? null
  );
}

/** `createProposal` — a new open proposal cell locked by the initiator. */
export async function createProposal({ description, requestedAmount, recipient }) {
  await sleep(1200);
  const { block } = snapshot();
  const id = `p-${Date.now().toString(36)}`;
  const proposal = {
    id,
    status: ProposalStatus.Open,
    description: description.trim(),
    requestedAmount: BigInt(requestedAmount),
    recipientLockHash: recipient.startsWith("0x")
      ? recipient
      : "0x" + id.padEnd(40, "0").slice(0, 40),
    recipientAddress: recipient,
    totalYes: 0n,
    totalNo: 0n,
    originBlockNumber: 0n,
    createdAtBlock: block,
    bond: CONFIG_CELL.data.minimalProposalCapacity,
    capacity: CONFIG_CELL.data.minimalProposalCapacity,
    outPoint: {
      txHash:
        "0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      index: 0,
    },
    typeScript: proposalTypeScript(id),
    votes: [],
  };
  setState((current) => ({
    ...current,
    proposals: [proposal, ...current.proposals],
  }));
  return proposal;
}

/**
 * `precheck` — the initiator's "can this pass?" button. On chain this is a dry
 * run of the proposal script; here it is arithmetic against `yes_threshold`.
 */
export async function precheck(proposalId) {
  await sleep(620);
  const view = proposalView(findProposal(proposalId));
  return {
    passable: view.thresholdReached,
    yes: view.yes,
    no: view.no,
    threshold: view.threshold,
    missingYes: view.missingYes,
    countedVotes: view.votes.length,
  };
}

/**
 * `createCounting` — one "YES" counting cell per hash chunk holding votes.
 * Returns how many cells the transaction produced.
 */
export async function countVotes(proposalId) {
  await sleep(1100);
  const proposal = findProposal(proposalId);
  const view = proposalView(proposal);
  const cells = Math.max(1, Math.ceil(proposal.votes.length / 1));
  const chunks = buildHashChunks(proposal.votes.length);
  return {
    countingCells: cells,
    yes: view.yes,
    no: view.no,
    chunks,
  };
}

/** Splits the vote set into hash range chunks the way counting cells do. */
function buildHashChunks(voteCount) {
  const chunks = [];
  let start = 0;
  const size = 1;
  for (let i = 0; i < Math.max(1, voteCount); i += size) {
    chunks.push({ start: start, end: start + 0x0fff });
    start += 0x1000;
  }
  return chunks;
}

/** `finalizeProposal` — proposal + counting cells -> finalized proposal cell. */
export async function finalizeProposal(proposalId) {
  await sleep(1350);
  const { block } = snapshot();
  const yes = proposalView(findProposal(proposalId)).yes;
  updateProposal(proposalId, () => ({
    status: ProposalStatus.Finalized,
    originBlockNumber: block,
    finalizedAtBlock: block,
    totalYes: yes,
  }));
  return findProposal(proposalId);
}

/** `passProposal` — finalized proposal cell -> passed proposal cell. */
export async function passProposal(proposalId) {
  await sleep(1050);
  updateProposal(proposalId, () => ({ status: ProposalStatus.Passed }));
  return findProposal(proposalId);
}

/** `vote` — spends the whole DAO deposit into a vote cell. */
export async function castVote(proposalId, direction) {
  await sleep(1250);
  const me = wallet();
  const { block } = snapshot();
  const amount = MOCK_DAO.votePower;
  const vote = {
    txHash:
      "0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    index: 0,
    direction,
    voteAmount: amount,
    blockNumber: block,
    voterLockHash: me.lock.args,
  };
  updateProposal(proposalId, (proposal) => ({
    votes: [...proposal.votes, vote],
    totalYes:
      direction === Direction.Yes ? BigInt(proposal.totalYes) + amount : proposal.totalYes,
    totalNo:
      direction === Direction.No ? BigInt(proposal.totalNo) + amount : proposal.totalNo,
  }));
  return vote;
}

/** `consumeVote` — withdraws the vote cell and returns the deposit. */
export async function withdrawVote(proposalId) {
  await sleep(980);
  const me = wallet();
  let removed = null;
  updateProposal(proposalId, (proposal) => {
    removed = proposal.votes.find((vote) => vote.voterLockHash === me.lock.args) ?? null;
    const votes = proposal.votes.filter(
      (vote) => vote.voterLockHash !== me.lock.args,
    );
    return {
      votes,
      totalYes:
        removed && removed.direction === Direction.Yes
          ? BigInt(proposal.totalYes) - BigInt(removed.voteAmount)
          : proposal.totalYes,
      totalNo:
        removed && removed.direction === Direction.No
          ? BigInt(proposal.totalNo) - BigInt(removed.voteAmount)
          : proposal.totalNo,
    };
  });
  return removed;
}

/** Formats the mock DAO deposit as the vote amount banner shows it. */
export function votePower() {
  return MOCK_DAO.votePower;
}

/* --------------------------------------------------------------------------
   Challenger operations
   -------------------------------------------------------------------------- */

/** The `NO` vote cells of a proposal, as the counting script would see them. */
function noVoteCells(proposal) {
  return proposal.votes.filter((vote) => vote.direction === Direction.No);
}

/** Requires a finalized, still-alive cell; mirrors the script's checks. */
function assertChallengeable(view) {
  if (view.status !== ProposalStatus.Finalized) {
    throw new Error("the referenced cell is not a finalized proposal cell");
  }
  if (view.challenged) {
    throw new Error("this finalized cell was already consumed by a challenge");
  }
  if (view.challengeExpired) {
    throw new Error("config.challenge_time elapsed: the cell can only be passed now");
  }
  if (CONFIG_CELL.data.emergentHalt === 1) {
    throw new Error("emergent_halt is set: every script fails");
  }
  return view;
}

/**
 * `precheck` for a challenge — the challenger's "can this be challenged?"
 * button. On chain the proposal script settles as soon as
 * `total_no >= total_yes`, so this is the same comparison dry-run locally.
 */
export async function challengeCheck(proposalId) {
  await sleep(640);
  const view = proposalView(findProposal(proposalId));
  const cells = noVoteCells(findProposal(proposalId));
  const available = cells.reduce((sum, vote) => sum + BigInt(vote.voteAmount), 0n);
  const locks = new Set(cells.map((vote) => vote.voterLockHash));
  return {
    challengeable: available >= view.yes && available > 0n,
    alive: view.challengeOpen,
    yes: view.yes,
    availableNo: available,
    countedNo: view.noCounted,
    missingNo: available >= view.yes ? 0n : view.yes - available,
    noVoteCells: cells.length,
    distinctLocks: locks.size,
    countingCellsAlready: view.noCountedCells,
    reward: view.reward,
  };
}

/**
 * `createCounting` with `direction = NO`: the challenger certifies every
 * "no" vote cell it can see, one counting cell per lock script.
 *
 * The result is kept on the proposal so the challenge button knows which
 * counting cells it would consume.
 */
export async function countNoVotes(proposalId) {
  await sleep(1150);
  const proposal = findProposal(proposalId);
  const view = assertChallengeable(proposalView(proposal));
  const cells = noVoteCells(proposal);
  const locks = new Set(cells.map((vote) => vote.voterLockHash));
  const total = cells.reduce((sum, vote) => sum + BigInt(vote.voteAmount), 0n);
  const countingCells = Math.max(1, locks.size);
  const ranges = buildHashChunks(countingCells);
  const { block } = snapshot();

  updateProposal(proposalId, () => ({
    challenge: {
      countedNo: total,
      countingCells,
      ranges,
      lockHashes: [...locks],
      countedAtBlock: block,
    },
  }));

  return {
    countingCells,
    countedNo: total,
    ranges,
    yes: view.yes,
    met: total >= view.yes,
    reward: view.reward,
  };
}

/**
 * `challenge` — consumes the "NO" counting cells plus the finalized proposal
 * cell and pays the bond to a lock script one of those counting cells uses,
 * which is what makes the reward reach the challenger.
 */
export async function challenge(proposalId) {
  await sleep(1400);
  const proposal = findProposal(proposalId);
  const view = assertChallengeable(proposalView(proposal));
  const counted = view.noCounted;
  if (counted <= 0n) {
    throw new Error("no NO counting cell to consume: count the votes first");
  }
  if (counted < view.yes) {
    throw new Error(
      `ChallengeNotMet: ${counted} NO shannons certified against ${view.yes} YES shannons`,
    );
  }
  const me = wallet();
  const { block } = snapshot();
  const challengerCell = {
    txHash:
      "0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    index: 0,
    capacity: view.reward,
    lockArgs: me.lock.args,
    blockNumber: block,
    countedNo: counted,
    countingCells: view.noCountedCells,
  };

  updateProposal(proposalId, () => ({
    status: ProposalStatus.Challenged,
    challengedAtBlock: block,
    challengerCell,
    consumedCountingCells: view.noCountedCells,
  }));

  return challengerCell;
}

export const shannons = CKB;
