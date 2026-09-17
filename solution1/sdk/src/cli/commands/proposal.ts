/**
 * The proposal lifecycle commands.
 */

import { Command } from "commander";
import {
  challengeProposal,
  createProposal,
  finalizeProposal,
  passProposal,
  receiveGrant,
  recycleProposal,
  vetoProposal,
} from "../../proposal.js";
import {
  act,
  addSignerOptions,
  configOf,
  formatOutPoint,
  outPointOf,
  outPointsOf,
  output,
  shannons,
  signerOf,
} from "../shared.js";

export function registerProposalCommands(program: Command): void {
  addSignerOptions(program.command("create-proposal"))
    .description("create a proposal cell and start the vote")
    .requiredOption("--description <text>", "UTF-8 description of the proposal")
    .requiredOption("--requested-amount <ckb>", "grant requested, in CKB")
    .option("--recipient <address>", "recipient of the grant")
    .option("--bond <ckb>", "bond of the proposal cell")
    .option("--lock <address>", "lock controlling the proposal cell")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const proposal = await createProposal(signer, config, {
          description: options.description,
          requestedAmount: shannons(options.requestedAmount),
          recipient: options.recipient,
          capacity: options.bond ? shannons(options.bond) : undefined,
          lock: options.lock,
        });
        output(
          options,
          proposal,
          [
            "Proposal created.",
            `  tx hash:      ${proposal.txHash}`,
            `  proposal:     ${formatOutPoint(proposal.proposalCell)}`,
            `  proposal id:  ${proposal.proposalId}`,
          ].join("\n"),
        );
      }),
    );

  addSignerOptions(program.command("finalize-proposal"))
    .description('finalize an open proposal with its "YES" counting cells')
    .requiredOption(
      "--proposal <outPoint>",
      "the open proposal cell, txHash:index",
    )
    .requiredOption(
      "--counting <outPoint...>",
      '"YES" counting cells certifying the votes',
    )
    .option("--wait", "wait until the vote duration elapsed")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await finalizeProposal(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          countingOutPoints: outPointsOf(options.counting),
          wait: !!options.wait,
        });
        output(
          options,
          { txHash },
          `Proposal finalized.\n  tx hash: ${txHash}`,
        );
      }),
    );

  addSignerOptions(program.command("pass-proposal"))
    .description("turn a finalized proposal into a passed one")
    .requiredOption("--proposal <outPoint>", "the finalized proposal cell")
    .option("--lock <address>", "lock of the passed cell")
    .option("--wait", "wait until the challenge time elapsed")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await passProposal(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          lock: options.lock,
          wait: !!options.wait,
        });
        output(options, { txHash }, `Proposal passed.\n  tx hash: ${txHash}`);
      }),
    );

  addSignerOptions(program.command("challenge-proposal"))
    .description('challenge a finalized proposal with "NO" counting cells')
    .requiredOption("--proposal <outPoint>", "the finalized proposal cell")
    .requiredOption("--counting <outPoint...>", '"NO" counting cells')
    .option("--reward-lock <address>", "lock receiving the bond")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await challengeProposal(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          countingOutPoints: outPointsOf(options.counting),
          rewardLock: options.rewardLock,
        });
        output(
          options,
          { txHash },
          `Proposal challenged, the bond is claimed.\n  tx hash: ${txHash}`,
        );
      }),
    );

  addSignerOptions(program.command("recycle-proposal"))
    .description("recycle the bond of a proposal that did not pass")
    .requiredOption(
      "--proposal <outPoint>",
      "the open or finalized proposal cell",
    )
    .option("--lock <address>", "lock receiving the bond")
    .option("--wait", "wait until the recycling window elapsed")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await recycleProposal(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          lock: options.lock,
          wait: !!options.wait,
        });
        output(options, { txHash }, `Proposal recycled.\n  tx hash: ${txHash}`);
      }),
    );

  addSignerOptions(program.command("veto-proposal"))
    .description("burn a finalized proposal with the administrator's lock")
    .requiredOption("--proposal <outPoint>", "the finalized proposal cell")
    .option("--lock <address>", "the veto lock controlled by the signer")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await vetoProposal(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          lock: options.lock,
        });
        output(options, { txHash }, `Proposal vetoed.\n  tx hash: ${txHash}`);
      }),
    );

  addSignerOptions(program.command("receive-grant"))
    .description("claim the grant of a passed proposal")
    .requiredOption("--proposal <outPoint>", "the passed proposal cell")
    .option("--recipient <address>", "recipient of the grant")
    .option("--amount <ckb>", "amount to deliver, defaults to requested_amount")
    .action(
      act(async (options) => {
        const signer = signerOf(options);
        const config = configOf(options);
        const txHash = await receiveGrant(signer, config, {
          proposalOutPoint: outPointOf(options.proposal),
          recipient: options.recipient,
          amount: options.amount ? shannons(options.amount) : undefined,
        });
        output(options, { txHash }, `Grant received.\n  tx hash: ${txHash}`);
      }),
    );
}
