/**
 * Mock on-chain data for the UI mockup.
 *
 * Field names and shapes mirror the real molecule tables decoded by
 * `sdk/src/codec.ts` (`VotingConfig`, `ProposalCellData`, `Vote`), so swapping
 * this module for the SDK is a drop-in change.
 */

import { CKB, BLOCK_SECONDS } from "./util.js";

/** Chain snapshot the mockup pretends to be looking at. */
export const CHAIN = {
  network: "devnet",
  rpc: "http://127.0.0.1:8114",
  blockNumber: 8421946n,
  /** `Date.now()` of the snapshot; the UI ages the countdown from here. */
  syncedAt: Date.now(),
  blockSeconds: BLOCK_SECONDS,
};

/** `table VotingConfig` of the config cell (docs/config-type-script-spec.md). */
export const CONFIG_CELL = {
  outPoint: {
    txHash:
      "0x7a1f3d2c9b6e4a08f5c7d1e29b3a6f840c5e17d9a2b48f630c9d5e1a7b3f2048",
    index: 0,
  },
  capacity: 500n * CKB,
  typeScript: {
    codeHash:
      "0x0d2db1b0a5b8d4b0c1e3f4a5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293",
    hashType: "type",
    args: "0x5d7b0f2c4a1e9368bc25d7e04f8a13c6b9e27d41",
  },
  id: "0x5d7b0f2c4a1e9368bc25d7e04f8a13c6b9e27d41",
  data: {
    emergentHalt: 0,
    voteCodeHash:
      "0x9c1e4f7a2d5b8c0e3f61728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d",
    voteHashType: 1,
    countingCodeHash:
      "0x3b7d9f1a4c6e820b5d7f90123456789abcdef0123456789abcdef0123456789a",
    countingHashType: 1,
    alwaysSuccessCodeHash:
      "0x2f8a5c1e7b9d3f6024a6c8e0b1d3f507192b3d5e7f90a1c2b4d6e8f0a2c4e60",
    alwaysSuccessHashType: 1,
    yesThreshold: 10000n * CKB,
    minimalProposalCapacity: 1000n * CKB,
    voteDuration: 1800n,
    voteWindow: 1200n,
    challengeTime: 900n,
    vetoLockScriptHash:
      "0x8e2c6a0f4b8d1e5a9c3f70b2d6e8a1c4f50719b3d5e7f90a2c4b6d8e0f2a4c60",
  },
};

/** Type scripts of the four cells, for the "cells & locks" panel. */
export const TYPE_SCRIPTS = {
  proposal: {
    codeHash:
      "0x4d7f9b1c3e5a70829b1d3f5a7c9e0b2d4f6172839405a6b7c8d9e0f1a2b3c4d",
    hashType: "type",
    args: `${CONFIG_CELL.id}${"a91c4e7b2d5f803691b4c7e2a5d8f0136b9c2e47"}`,
  },
  vote: {
    codeHash: CONFIG_CELL.data.voteCodeHash,
    hashType: "type",
    args: "0xc3f81a2d69b40e57f2a9c6d31e8b5407af92c6d8",
  },
  counting: {
    codeHash: CONFIG_CELL.data.countingCodeHash,
    hashType: "type",
    args: "0xc3f81a2d69b40e57f2a9c6d31e8b5407af92c6d8",
  },
  alwaysSuccess: {
    codeHash: CONFIG_CELL.data.alwaysSuccessCodeHash,
    hashType: "type",
    args: "0x",
  },
};

/** Lock script of the connected wallet. */
export const WALLET_LOCK = {
  codeHash:
    "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
  hashType: "type",
  args: "0x27c1a4f0b8e93d26507c1db4a6f8290e13c5d7b4",
};

export const MOCK_WALLET = {
  name: "CKB Wallet",
  address:
    "ckb1qzda0cr08m85hc8jlnfp3zerx8q3wu4f0hl2q0th2vgz0zgqf8q0qmv8tp",
  shortAddress: "ckb1qzda0cr08m85hc8jln…q0qmv8tp",
  lock: WALLET_LOCK,
};

/** The voter's whole DAO deposit: a vote always uses it in full. */
export const MOCK_DAO = {
  depositCount: 3,
  votePower: 8245050000000n + 12345678n,
  oldestDepositBlock: 8390031n,
};

/** The initiator's bond wallet. */
export const MOCK_BOND_BALANCE = 12640n * CKB;

const B = CHAIN.blockNumber;

/**
 * Proposal cells. `status` follows `constants.ts`:
 * 0 = open ("proposal"), 1 = finalized, 2 = passed.
 *
 * `originBlockNumber` is stored 0 for open cells on chain (it is only filled in
 * when the cell is finalized); the mockup carries `createdAtBlock` so the UI can
 * still show a voting deadline for them.
 */
export const SEED_PROPOSALS = [
  {
    id: "p1",
    status: 0,
    description:
      "Fund a public RPC gateway for the Nervos community — 12 months of hosting, monitoring and on-call rotation for a rate-limited public node in Singapore and Frankfurt.",
    requestedAmount: 180000n * CKB,
    recipientLockHash: "0x4b8e1d27c05a93f6b2184e7d0a3c596f82e1b740",
    recipientAddress:
      "ckb1qzda0cr08m85hc8jlnfp3zerx8q3wu4f0hl2q0th2vgz0zgqf8q0qmv8tp",
    totalYes: 143920n * CKB,
    totalNo: 31980n * CKB,
    originBlockNumber: 0n,
    createdAtBlock: B - 1982n,
    bond: 5000n * CKB,
    capacity: 5000n * CKB,
    outPoint: {
      txHash:
        "0x1c4a7f0d92b5e836c1f07a4d2e9b5c8073146a2d9f4b7e1c05a8d3f62970b4e1",
      index: 0,
    },
    votes: [
      {
        txHash:
          "0x5f2b8d1c4a7e9036b1d5f8a2c6e0b4d719283a4c5e6f708192a3b4c5d6e7f809",
        index: 0,
        direction: 1,
        voteAmount: 24500n * CKB,
        blockNumber: B - 1780n,
      },
      {
        txHash:
          "0x9a3c6e0f2b5d8a1c4e7f0b3d6a9c2e5f8012345678abcdef90a1b2c3d4e5f601",
        index: 0,
        direction: 1,
        voteAmount: 41200n * CKB,
        blockNumber: B - 1740n,
      },
      {
        txHash:
          "0x3c6f9012a3b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e",
        index: 1,
        direction: 1,
        voteAmount: 63220n * CKB,
        blockNumber: B - 1698n,
      },
      {
        txHash:
          "0x6f8091a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f",
        index: 0,
        direction: 1,
        voteAmount: 15000n * CKB,
        blockNumber: B - 1660n,
      },
      {
        txHash:
          "0xb3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2",
        index: 0,
        direction: 0,
        voteAmount: 31980n * CKB,
        blockNumber: B - 1610n,
      },
    ],
  },
  {
    id: "p2",
    status: 0,
    description:
      "Retroactive grant for the ckb-debugger maintenance done in Q3: keeps the RISC-V debugger working with the latest toolchain and adds step-back support.",
    requestedAmount: 45000n * CKB,
    recipientLockHash: "0x8d2f5a1c94e70b36f528c1d47a9e03625b8c1f4d",
    recipientAddress:
      "ckb1qrgqep8saj8agswr30pls73sk9sy57t4f0hl2q0th2vgz0zgqf8q5m9jw2c",
    totalYes: 38600n * CKB,
    totalNo: 42300n * CKB,
    originBlockNumber: 0n,
    createdAtBlock: B - 205n,
    bond: 3000n * CKB,
    capacity: 3000n * CKB,
    outPoint: {
      txHash:
        "0x7e0b3d6a9c2f5e814b7d0a3c6e9f2b5d8012345678abcdef91a2b3c4d5e6f702",
      index: 1,
    },
    votes: [
      {
        txHash:
          "0xc1e4a7d0b3f62985c1e4a7d0b3f62985c1e4a7d0b3f62985c1e4a7d0b3f62985",
        index: 0,
        direction: 0,
        voteAmount: 28900n * CKB,
        blockNumber: B - 121n,
      },
    ],
  },
  {
    id: "p3",
    status: 0,
    description:
      "Localize the wallet onboarding flow into Japanese and Korean, including the documentation site, so that new DAO owners can deposit and vote without leaving their language.",
    requestedAmount: 26000n * CKB,
    recipientLockHash: "0xf3a9c6d201b58e47a0c3f6912d5b8e0472c9a135",
    recipientAddress:
      "ckb1qzda0cr08m85hc8jlnfp3zerx8q3wu4f0hl2q0th2vgz0zgqf8q0qmv8tp",
    totalYes: 5100n * CKB,
    totalNo: 980n * CKB,
    originBlockNumber: 0n,
    createdAtBlock: B - 47n,
    bond: 1500n * CKB,
    capacity: 1500n * CKB,
    outPoint: {
      txHash:
        "0x2d5f8a1c4e70b3d6f9012a3b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4d5e6f8",
      index: 0,
    },
    votes: [],
  },
  {
    id: "p4",
    status: 1,
    description:
      "Developer documentation refresh: rewrite the script debugging guide, publish three annotated sample contracts and record two walkthrough videos.",
    requestedAmount: 72000n * CKB,
    recipientLockHash: "0x6a1d8e4b2f07c93a5e1b8d4f7a0c36295d8e1b4f",
    recipientAddress:
      "ckb1qrgqep8saj8agswr30pls73sk9sy57t4f0hl2q0th2vgz0zgqf8q5m9jw2c",
    totalYes: 63850n * CKB,
    totalNo: 12400n * CKB,
    originBlockNumber: B - 1450n,
    createdAtBlock: B - 6010n,
    bond: 5000n * CKB,
    capacity: 5000n * CKB,
    outPoint: {
      txHash:
        "0x8b1e4d7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f6295",
      index: 0,
    },
    votes: [],
  },
  {
    id: "p5",
    status: 2,
    description:
      "Q2 2024 treasury report: an independent review of grants paid out, milestones delivered and the remaining treasury runway, published as an open dataset.",
    requestedAmount: 18000n * CKB,
    recipientLockHash: "0x2c7f0a3d6b9e1f4a8c2e5b7d0f3916245a8c1e7b",
    recipientAddress:
      "ckb1qzda0cr08m85hc8jlnfp3zerx8q3wu4f0hl2q0th2vgz0zgqf8q0qmv8tp",
    totalYes: 29400n * CKB,
    totalNo: 6100n * CKB,
    originBlockNumber: B - 21000n,
    createdAtBlock: B - 22900n,
    bond: 2000n * CKB,
    capacity: 2000n * CKB,
    outPoint: {
      txHash:
        "0x4e7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f62958b1e",
      index: 0,
    },
    votes: [],
  },
  {
    id: "p6",
    status: 0,
    description:
      "Print 500 hardware wallet sleeves with a QR code pointing at the DAO deposit tutorial, to be handed out at the next community meetup.",
    requestedAmount: 8000n * CKB,
    recipientLockHash: "0x9b4e7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c",
    recipientAddress:
      "ckb1qrgqep8saj8agswr30pls73sk9sy57t4f0hl2q0th2vgz0zgqf8q5m9jw2c",
    totalYes: 0n,
    totalNo: 0n,
    originBlockNumber: 0n,
    createdAtBlock: B - 2400n,
    bond: 2000n * CKB,
    capacity: 2000n * CKB,
    outPoint: {
      txHash:
        "0x0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f62958b1e4d7a0c3f62958b1e4d7a",
      index: 2,
    },
    votes: [],
  },
];

/** The proposal type script of one proposal: shared prefix + its Type ID. */
export function proposalTypeScript(id) {
  let seed = "";
  for (let i = 0; seed.length < 40; i += 1) {
    const code = id.charCodeAt(i % id.length) * (i + 7);
    seed += (code % 256).toString(16).padStart(2, "0");
  }
  return {
    codeHash: TYPE_SCRIPTS.proposal.codeHash,
    hashType: "type",
    args: `${CONFIG_CELL.id}${seed.slice(0, 40)}`,
  };
}

/** Seeds for `localStorage`, so a reset restores exactly this state. */
export function seedState() {
  return {
    version: 5,
    wallet: null,
    proposals: SEED_PROPOSALS.map((proposal) => ({
      ...proposal,
      outPoint: { ...proposal.outPoint },
      typeScript: proposalTypeScript(proposal.id),
      votes: proposal.votes.map((vote) => ({ ...vote })),
    })),
  };
}
