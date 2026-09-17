/**
 * The vote commands.
 */

import { Command } from "commander";
import { castVote, withdrawVote } from "../../vote.js";
import {
  act,
  addSignerOptions,
  ckb,
  configOf,
  formatOutPoint,
  outPointOf,
  output,
  signerOf,
} from "../shared.js";

export function registerVoteCommands(program: Command): void {
  addSignerOptions(program.command("vote"))
    .description("cast a vote backed by the signer's DAO deposits")
    .requiredOption("--proposal <outPoint>", "the open proposal cell")
    .requiredOption("--direction <yes|no>", '"yes" or "no"')
    .option(
      "--deposit <outPoint...>",
      "DAO deposits backing the vote; defaults to every eligible deposit",
    )
    .option("--lock <address>", "the voter's lock")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const result = await castVote(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          direction: options.direction,
          deposits: options.deposit
            ? options.deposit.map((value: string) =>
                outPointOf(value, "deposit"),
              )
            : undefined,
          lock: options.lock,
        });
        output(
          options,
          result,
          [
            `Vote (${options.direction}) cast.`,
            `  tx hash:   ${result.txHash}`,
            `  vote cell: ${formatOutPoint(result.voteCell)}`,
            `  amount:    ${result.voteAmount} shannons (${ckb(result.voteAmount)} CKB)`,
            `  deposits:  ${result.deposits.length}`,
            ...(result.skipped.length > 0
              ? [
                  `  skipped:   ${result.skipped.length} deposit(s) newer than the proposal`,
                ]
              : []),
          ].join("\n"),
        );
      }),
    );

  addSignerOptions(program.command("withdraw-vote"))
    .description("consume a vote cell and recycle its capacity")
    .requiredOption("--vote <outPoint>", "the vote cell")
    .option("--lock <address>", "lock receiving the capacity")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await withdrawVote(signer, config, {
          voteOutPoint: outPointOf(options.vote, "vote cell"),
          lock: options.lock,
        });
        output(options, { txHash }, `Vote withdrawn.\n  tx hash: ${txHash}`);
      }),
    );
}
