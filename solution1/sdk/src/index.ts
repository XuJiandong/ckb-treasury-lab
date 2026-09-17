/**
 * CKB voting system SDK.
 *
 * A library plus the `ckb-vote` CLI for the four on-chain scripts under
 * `contracts/`: the config cell, the proposal lifecycle, the vote cells and the
 * counting cells. Everything is built on `@ckb-ccc/shell` and runs under Bun.
 *
 * ```ts
 * import { ccc } from "@ckb-ccc/shell";
 * import { loadConfig, buildClient, createProposal } from "@ckb-vote/sdk";
 *
 * const config = loadConfig();
 * const signer = new ccc.SignerCkbPrivateKey(buildClient(config), privateKey);
 * const { proposalCell } = await createProposal(signer, config, {
 *   description: "Fund the docs",
 *   requestedAmount: 1000n * 100_000_000n,
 * });
 * ```
 */

export * from "./client.js";
export * from "./config.js";
export * from "./constants.js";
export * from "./codec.js";
export * from "./utils.js";
export * from "./query.js";
export * from "./deploy.js";
export * from "./devnet.js";
export * from "./config-cell.js";
export * from "./proposal.js";
export * from "./vote.js";
export * from "./counting.js";
