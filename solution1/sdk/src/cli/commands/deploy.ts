/**
 * `deploy`: publish the five contract binaries and generate a deployment
 * config for them.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { SCRIPT_KEYS, type ScriptKey } from "../../config.js";
import { deployScripts, type ContractBinaries } from "../../deploy.js";
import { deriveKnownScripts } from "../../devnet.js";
import { buildClient } from "../../client.js";
import {
  act,
  addCommonOptions,
  addSignerOptions,
  bootstrapOf,
  bootstrapSignerOf,
  formatOutPoint,
  output,
} from "../shared.js";

/** File name of each compiled contract in `build/release`. */
const BINARY_FILES: Record<ScriptKey, string> = {
  config: "config-type-script",
  proposal: "proposal-type-script",
  vote: "vote-type-script",
  counting: "counting-type-script",
  alwaysSuccess: "always-success",
};

export function registerDeployCommand(program: Command): void {
  addCommonOptions(program.command("devnet-scripts"))
    .description("derive the devnet known-script overrides from block 0")
    .option("--out <path>", "write a bootstrap config here")
    .action(
      act(async (options) => {
        const bootstrap = bootstrapOf(options);
        const knownScripts = await deriveKnownScripts(buildClient(bootstrap));
        const found = Object.entries(knownScripts);
        if (found.length === 0) {
          throw new Error(
            "no genesis system script was found: is this a devnet with a " +
              "standard chain spec?",
          );
        }
        const config = { rpcUrl: bootstrap.rpcUrl, knownScripts };
        if (options.out) {
          mkdirSync(dirname(options.out), { recursive: true });
          writeFileSync(options.out, `${JSON.stringify(config, null, 2)}\n`);
        }
        output(
          options,
          config,
          [
            `Found ${found.length} genesis system script(s).`,
            ...found.map(([name, info]) => {
              const deps = (info?.cellDeps ?? [])
                .map(
                  ({ cellDep }) =>
                    `${cellDep.outPoint.txHash}:${cellDep.outPoint.index}`,
                )
                .join(", ");
              return `  ${name.padEnd(20)} ${info?.codeHash} ${deps}`;
            }),
            ...(options.out
              ? ["", `Bootstrap config written to ${options.out}.`]
              : []),
          ].join("\n"),
        );
      }),
    );

  addSignerOptions(program.command("deploy"))
    .description("publish the contract binaries and write a deployment config")
    .option(
      "--binaries-dir <dir>",
      "directory holding the compiled binaries",
      "../build/release",
    )
    .option(
      "--out <path>",
      "where to write the generated deployment config",
      "../deployment/devnet.json",
    )
    .option("--lock <address>", "lock of the code cells")
    .option("--no-write", "only print the config, write nothing")
    .action(
      act(async (options) => {
        const bootstrap = bootstrapOf(options);
        const signer = bootstrapSignerOf(options);

        const binaries = {} as ContractBinaries;
        for (const key of SCRIPT_KEYS) {
          const path = join(options.binariesDir, BINARY_FILES[key]);
          binaries[key] = new Uint8Array(readFileSync(path));
        }

        const result = await deployScripts(signer, binaries, {
          lock: options.lock,
          feeRate:
            bootstrap.feeRate === undefined
              ? undefined
              : BigInt(bootstrap.feeRate),
        });

        const config = {
          rpcUrl: bootstrap.rpcUrl,
          feeRate: Number(bootstrap.feeRate ?? 1500),
          scripts: result.scripts,
          ...(bootstrap.knownScripts
            ? { knownScripts: bootstrap.knownScripts }
            : {}),
        };

        if (options.write !== false) {
          mkdirSync(dirname(options.out), { recursive: true });
          writeFileSync(options.out, `${JSON.stringify(config, null, 2)}\n`);
        }

        output(
          options,
          { txHash: result.txHash, config },
          [
            "Contracts deployed.",
            `  tx hash: ${result.txHash}`,
            ...SCRIPT_KEYS.map(
              (key) =>
                `  ${key.padEnd(13)} code hash ${result.scripts[key].codeHash}  ` +
                `cell ${formatOutPoint(result.scripts[key].cellDep)}`,
            ),
            ...(options.write !== false
              ? [
                  "",
                  `Deployment config written to ${options.out}.`,
                  "Next: ckb-vote create-config --config " +
                    `${options.out} --write ${options.out} ...`,
                ]
              : []),
          ].join("\n"),
        );
      }),
    );
}
