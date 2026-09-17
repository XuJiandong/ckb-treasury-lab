/**
 * The query commands.
 */

import { Command } from "commander";
import { proposalStatusName, parseProposalStatus } from "../../constants.js";
import {
  findCountingCells,
  findProposalCells,
  findVoteCells,
  loadConfigCell,
} from "../../query.js";
import { scriptId } from "../../utils.js";
import {
  act,
  addCommonOptions,
  ckb,
  clientOf,
  configOf,
  formatOutPoint,
  outPointOf,
  output,
} from "../shared.js";

export function registerQueryCommands(program: Command): void {
  addCommonOptions(program.command("list-proposals"))
    .description("list the proposal, finalized and passed cells")
    .option("--status <open|finalized|passed>", "only this status")
    .action(
      act(async (options) => {
        const client = clientOf(options);
        const config = configOf(options);
        const info = await loadConfigCell(client, config);
        const rows: unknown[] = [];
        for await (const proposal of findProposalCells(client, config, {
          configId: info.id,
          status:
            options.status === undefined
              ? undefined
              : parseProposalStatus(options.status),
        })) {
          rows.push({
            outPoint: formatOutPoint(proposal.cell.outPoint),
            status: proposalStatusName(proposal.data.status),
            description: proposal.data.description,
            requestedAmount: proposal.data.requestedAmount.toString(),
            totalYes: proposal.data.totalYes.toString(),
            originBlockNumber: proposal.data.originBlockNumber.toString(),
            capacity: proposal.cell.cellOutput.capacity.toString(),
            recipientLockHash: proposal.data.recipientLockHash,
          });
        }
        output(
          options,
          rows,
          rows
            .map((row) => {
              const r = row as Record<string, string>;
              return (
                `${r.outPoint}  ${r.status.padEnd(9)}  ` +
                `yes=${r.totalYes}  requested=${ckb(BigInt(r.requestedAmount))} CKB  ` +
                `${JSON.stringify(r.description)}`
              );
            })
            .join("\n") || "no proposal found",
        );
      }),
    );

  addCommonOptions(program.command("list-votes"))
    .description("list the vote cells")
    .option("--proposal <outPoint>", "only the votes of this proposal")
    .option("--direction <yes|no>", "only this direction")
    .action(
      act(async (options) => {
        const client = clientOf(options);
        const config = configOf(options);
        let proposalId: `0x${string}` | undefined;
        if (options.proposal) {
          const proposal = await client.getCellLive(
            outPointOf(options.proposal),
            true,
            true,
          );
          const typeScript = proposal?.cellOutput.type;
          if (!typeScript) {
            throw new Error("the proposal cell has no type script");
          }
          proposalId = scriptId(typeScript);
        }
        const rows: unknown[] = [];
        for await (const vote of findVoteCells(client, config, {
          proposalId,
          direction:
            options.direction === undefined
              ? undefined
              : options.direction === "yes"
                ? 1
                : 0,
        })) {
          rows.push({
            outPoint: formatOutPoint(vote.cell.outPoint),
            proposalId: vote.typeScript.args,
            direction: vote.data.direction === 1 ? "yes" : "no",
            amount: vote.data.voteAmount.toString(),
            lock: vote.cell.cellOutput.lock.args,
            capacity: vote.cell.cellOutput.capacity.toString(),
          });
        }
        output(
          options,
          rows,
          rows
            .map((row) => {
              const r = row as Record<string, string>;
              return (
                `${r.outPoint}  ${r.direction.padEnd(3)}  ` +
                `${r.amount} shannons (${ckb(BigInt(r.amount))} CKB)  ` +
                `proposal=${r.proposalId}`
              );
            })
            .join("\n") || "no vote found",
        );
      }),
    );

  addCommonOptions(program.command("list-counting"))
    .description("list the counting cells")
    .option("--proposal <outPoint>", "only the counting cells of this proposal")
    .option("--direction <yes|no>", "only this direction")
    .action(
      act(async (options) => {
        const client = clientOf(options);
        const config = configOf(options);
        let proposalId: `0x${string}` | undefined;
        if (options.proposal) {
          const proposal = await client.getCellLive(
            outPointOf(options.proposal),
            true,
            true,
          );
          const typeScript = proposal?.cellOutput.type;
          if (!typeScript) {
            throw new Error("the proposal cell has no type script");
          }
          proposalId = scriptId(typeScript);
        }
        const rows: unknown[] = [];
        for await (const counting of findCountingCells(client, config, {
          proposalId,
          direction:
            options.direction === undefined
              ? undefined
              : options.direction === "yes"
                ? 1
                : 0,
        })) {
          rows.push({
            outPoint: formatOutPoint(counting.cell.outPoint),
            proposalId: counting.typeScript.args,
            direction: counting.data.direction === 1 ? "yes" : "no",
            range: [counting.data.startHash, counting.data.endHash],
            amount: counting.data.voteAmount.toString(),
            capacity: counting.cell.cellOutput.capacity.toString(),
          });
        }
        output(
          options,
          rows,
          rows
            .map((row) => {
              const r = row as unknown as {
                outPoint: string;
                direction: string;
                range: number[];
                amount: string;
                proposalId: string;
              };
              return (
                `${r.outPoint}  ${r.direction.padEnd(3)}  ` +
                `[${r.range[0]}, ${r.range[1]}]  ` +
                `${r.amount} shannons (${ckb(BigInt(r.amount))} CKB)  ` +
                `proposal=${r.proposalId}`
              );
            })
            .join("\n") || "no counting cell found",
        );
      }),
    );
}
