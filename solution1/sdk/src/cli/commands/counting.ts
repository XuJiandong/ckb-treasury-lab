/**
 * The counting cell commands.
 */

import { Command } from "commander";
import { consumeCountingCell, createCountingCell } from "../../counting.js";
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

export function registerCountingCommands(program: Command): void {
  addSignerOptions(program.command("create-counting"))
    .description("create a counting cell aggregating vote cells")
    .requiredOption("--proposal <outPoint>", "the proposal the votes belong to")
    .requiredOption("--direction <yes|no>", '"yes" collects, "no" challenges')
    .requiredOption("--start-hash <u16>", "lower bound of the hash range")
    .requiredOption("--end-hash <u16>", "upper bound of the hash range")
    .option(
      "--vote <outPoint...>",
      "vote cells to aggregate; defaults to every matching vote cell",
    )
    .option("--lock <address>", "lock of the counting cell")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const result = await createCountingCell(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          direction: options.direction,
          startHash: options.startHash,
          endHash: options.endHash,
          voteOutPoints: options.vote
            ? options.vote.map((value: string) =>
                outPointOf(value, "vote cell"),
              )
            : undefined,
          lock: options.lock,
        });
        output(
          options,
          result,
          [
            `Counting cell created (${options.direction}).`,
            `  tx hash:       ${result.txHash}`,
            `  counting cell: ${formatOutPoint(result.countingCell)}`,
            `  amount:        ${result.voteAmount} shannons (${ckb(result.voteAmount)} CKB)`,
            `  vote cells:    ${result.voteCells.length}`,
            ...(result.skippedDuplicates.length > 0
              ? [
                  `  skipped:       ${result.skippedDuplicates.length} duplicate voter(s)`,
                ]
              : []),
          ].join("\n"),
        );
      }),
    );

  addSignerOptions(program.command("consume-counting"))
    .description("consume a counting cell and recycle its capacity")
    .requiredOption("--counting <outPoint>", "the counting cell")
    .option("--lock <address>", "lock receiving the capacity")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await consumeCountingCell(signer, config, {
          countingOutPoint: outPointOf(options.counting, "counting cell"),
          lock: options.lock,
        });
        output(
          options,
          { txHash },
          `Counting cell consumed.\n  tx hash: ${txHash}`,
        );
      }),
    );
}
