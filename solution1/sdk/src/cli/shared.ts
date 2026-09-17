/**
 * Shared helpers of the `ckb-vote` CLI.
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { ccc } from "@ckb-ccc/shell";
import { buildClient } from "../client.js";
import {
  loadBootstrapConfig,
  loadConfig,
  type BootstrapConfig,
  type DeploymentConfig,
} from "../config.js";
import { formatOutPoint, parseOutPoint } from "../utils.js";

/** Options every command accepts. */
export interface CommonOptions {
  config?: string;
  rpcUrl?: string;
  json?: boolean;
}

/** Options of a command that sends a transaction. */
export interface SignerOptions extends CommonOptions {
  privateKey?: string;
  privateKeyFile?: string;
}

/** Adds `--config`, `--rpc-url` and `--json`. */
export function addCommonOptions(command: Command): Command {
  return command
    .option("-c, --config <path>", "deployment config JSON")
    .option("--rpc-url <url>", "CKB RPC endpoint, overrides the config")
    .option("--json", "print machine-readable JSON");
}

/** Adds the common options plus the private key options. */
export function addSignerOptions(command: Command): Command {
  return addCommonOptions(command)
    .option("-k, --private-key <hex>", "32 byte private key")
    .option(
      "--private-key-file <path>",
      "file holding the 32 byte private key",
    );
}

/** Loads the deployment config, applying `--rpc-url`. */
export function configOf(options: CommonOptions): DeploymentConfig {
  const config = loadConfig(options.config);
  return options.rpcUrl ? { ...config, rpcUrl: options.rpcUrl } : config;
}

/** Reads the private key option, normalising the `0x` prefix. */
export function privateKeyOf(options: SignerOptions): string {
  let key = options.privateKey;
  if (!key && options.privateKeyFile) {
    key = readFileSync(options.privateKeyFile, "utf8").trim();
  }
  if (!key) {
    throw new Error("provide --private-key or --private-key-file");
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

/** Builds a signer from the private key options. */
export function signerOf(options: SignerOptions): ccc.SignerCkbPrivateKey {
  return new ccc.SignerCkbPrivateKey(
    buildClient(configOf(options)),
    privateKeyOf(options),
  );
}

/** Loads the bootstrap config (the voting scripts may not exist yet). */
export function bootstrapOf(options: CommonOptions): BootstrapConfig {
  const bootstrap = loadBootstrapConfig(options.config);
  return options.rpcUrl ? { ...bootstrap, rpcUrl: options.rpcUrl } : bootstrap;
}

/** Builds a signer before the voting scripts are deployed. */
export function bootstrapSignerOf(
  options: SignerOptions,
): ccc.SignerCkbPrivateKey {
  return new ccc.SignerCkbPrivateKey(
    buildClient(bootstrapOf(options)),
    privateKeyOf(options),
  );
}

/** Builds a read-only client. */
export function clientOf(options: CommonOptions): ccc.ClientPublicTestnet {
  return buildClient(configOf(options));
}

/** Prints a result as JSON or as the provided text summary. */
export function output(
  options: CommonOptions,
  value: unknown,
  text: string,
): void {
  if (options.json) {
    console.log(
      JSON.stringify(
        value,
        (_key, item) => (typeof item === "bigint" ? item.toString() : item),
        2,
      ),
    );
  } else {
    console.log(text);
  }
}

/** Wraps an action so a failure prints a single line and exits with 1. */
export function act<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  };
}

/** Parses `0x<txHash>:<index>`, or a bare tx hash as output 0. */
export function outPointOf(value: string, label = "out point"): ccc.OutPoint {
  if (!value.includes(":")) {
    return parseOutPoint(`${value}:0`, label);
  }
  return parseOutPoint(value, label);
}

/** Parses a list of out points. */
export function outPointsOf(values: string[] | undefined): ccc.OutPoint[] {
  return (values ?? []).map((value) => outPointOf(value));
}

/** Converts a CKB amount to shannons. */
export function shannons(value: string | number | bigint): bigint {
  return ccc.fixedPointFrom(value.toString());
}

/** Converts shannons to a CKB string. */
export function ckb(value: bigint): string {
  return ccc.fixedPointToString(value);
}

/** Formats the amount of a cell or of a result. */
export function formatCkb(value: bigint): string {
  return `${value} shannons (${ckb(value)} CKB)`;
}

export { formatOutPoint };
