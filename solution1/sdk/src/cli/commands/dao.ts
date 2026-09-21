/**
 * `dao-deposit`: create a Nervos DAO deposit cell.
 *
 * A vote is backed by the signer's DAO deposits, so this is the step that funds
 * a vote on a fresh devnet. It only needs a bootstrap config (the RPC endpoint
 * and the devnet's known scripts), not the voting scripts.
 */

import { Command } from "commander";
import { depositDao } from "../../dao.js";
import {
  act,
  addSignerOptions,
  bootstrapOf,
  bootstrapSignerOf,
  ckb,
  formatOutPoint,
  output,
  shannons,
} from "../shared.js";

export function registerDaoCommands(program: Command): void {
  addSignerOptions(program.command("dao-deposit"))
    .description("create a Nervos DAO deposit cell backing a vote")
    .requiredOption("--amount <ckb>", "amount to deposit, in CKB")
    .option("--lock <address>", "lock of the deposit")
    .action(
      act(async (options) => {
        const signer = bootstrapSignerOf(options);
        const config = bootstrapOf(options);
        const result = await depositDao(signer, config, {
          amount: shannons(options.amount),
          lock: options.lock,
        });
        output(
          options,
          result,
          [
            "DAO deposit created.",
            `  tx hash:      ${result.txHash}`,
            `  deposit cell: ${formatOutPoint(result.depositCell)}`,
            `  amount:       ${result.amount} shannons (${ckb(result.amount)} CKB)`,
            `  dao cell dep: ${formatOutPoint(result.cellDep.outPoint)}`,
          ].join("\n"),
        );
      }),
    );
}
