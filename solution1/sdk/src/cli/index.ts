#!/usr/bin/env bun
/**
 * `ckb-vote`: the CLI of the CKB voting system SDK.
 *
 * Run it with Bun, either after `bun link` or directly:
 *   bun run src/cli/index.ts <command> [options]
 */

import { Command } from "commander";
import { registerConfigCommands } from "./commands/config.js";
import { registerDaoCommands } from "./commands/dao.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerE2eCommand } from "./commands/e2e.js";
import { registerProposalCommands } from "./commands/proposal.js";
import { registerVoteCommands } from "./commands/vote.js";
import { registerCountingCommands } from "./commands/counting.js";
import { registerQueryCommands } from "./commands/query.js";

const program = new Command();

program
  .name("ckb-vote")
  .description("CKB on-chain voting system SDK")
  .version("0.1.0");

registerDeployCommand(program);
registerConfigCommands(program);
registerDaoCommands(program);
registerProposalCommands(program);
registerVoteCommands(program);
registerCountingCommands(program);
registerQueryCommands(program);
registerE2eCommand(program);

await program.parseAsync(process.argv);
