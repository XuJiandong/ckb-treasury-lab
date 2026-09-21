/**
 * Publishing the voting contracts. Used for e2e tests and other testing only.
 * Use ckb-cli to deploy these binaries for testnet or production use.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/shell";
import {
  SCRIPT_KEYS,
  type ScriptDeployment,
  type ScriptKey,
} from "./config.js";
import { ckbHash, resolveLock, signerLock } from "./utils.js";

/** The compiled binaries of the five scripts. */
export type ContractBinaries = Record<ScriptKey, ccc.BytesLike>;

/** File name of each compiled contract in `build/release`. */
export const CONTRACT_BINARY_FILES: Record<ScriptKey, string> = {
  config: "config-type-script",
  proposal: "proposal-type-script",
  vote: "vote-type-script",
  counting: "counting-type-script",
  alwaysSuccess: "always-success",
};

/** Reads the five compiled binaries from a `build/release`-style directory. */
export function readContractBinaries(directory: string): ContractBinaries {
  const binaries = {} as ContractBinaries;
  for (const key of SCRIPT_KEYS) {
    binaries[key] = new Uint8Array(
      readFileSync(join(directory, CONTRACT_BINARY_FILES[key])),
    );
  }
  return binaries;
}

/** The result of {@link deployScripts}. */
export interface DeployScriptsResult {
  txHash: ccc.Hex;
  /** The `scripts` section of a deployment config. */
  scripts: Record<ScriptKey, ScriptDeployment>;
}

/** Options of {@link deployScripts}. */
export interface DeployScriptsParams {
  /** Lock of the code cells; defaults to the signer's lock. */
  lock?: string | ccc.ScriptLike;
  /** Fee rate in shannons per KB; defaults to 1500. */
  feeRate?: bigint | number;
}

/**
 * Publishes the five contracts in one transaction.
 *
 * The outputs keep the order of {@link SCRIPT_KEYS}, so the code cell of each
 * script is `outputs[i]` of the returned transaction: the change cell that the
 * fee completion appends comes last.
 */
export async function deployScripts(
  signer: ccc.Signer,
  binaries: ContractBinaries,
  params: DeployScriptsParams = {},
): Promise<DeployScriptsResult> {
  const client = signer.client;
  const lock = params.lock
    ? await resolveLock(client, params.lock)
    : await signerLock(signer);

  const datas = SCRIPT_KEYS.map((key) => ccc.hexFrom(binaries[key]));
  const tx = ccc.Transaction.from({
    outputs: datas.map((data) =>
      ccc.CellOutput.from({ capacity: 0n, lock }, data),
    ),
    outputsData: datas,
  });

  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, BigInt(params.feeRate ?? 1500));
  const txHash = await signer.sendTransaction(tx);

  const scripts = {} as Record<ScriptKey, ScriptDeployment>;
  SCRIPT_KEYS.forEach((key, index) => {
    scripts[key] = {
      codeHash: ckbHash(datas[index]),
      hashType: "data2",
      args: "0x",
      cellDep: { txHash, index, depType: "code" },
    };
  });

  return { txHash, scripts };
}
