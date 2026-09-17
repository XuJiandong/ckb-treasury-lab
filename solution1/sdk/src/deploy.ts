/**
 * Publishing the voting contracts.
 *
 * Each binary becomes a plain code cell locked by the deployer, referenced
 * with `hash_type: data1`: the code hash is then the ckb-hash of the binary,
 * which the SDK computes itself, so a deployment needs neither a Type ID
 * script nor any off-chain bookkeeping.
 *
 * `data1` rather than `data` is deliberate: a script whose hash type is `data`
 * runs on VM version 0, and the ckb-std 1.x binaries need version 1 (their
 * allocator assumes the version 1 memory layout). `data1` selects version 1
 * while keeping the same code hash, and it also leaves room for upgrading the
 * code cell later. A deployment that wants a Type ID lineage can still write a
 * `hash_type: type` config by hand.
 */

import { ccc } from "@ckb-ccc/shell";
import {
  SCRIPT_KEYS,
  type ScriptDeployment,
  type ScriptKey,
} from "./config.js";
import { ckbHash, resolveLock, signerLock } from "./utils.js";

/** The compiled binaries of the five scripts. */
export type ContractBinaries = Record<ScriptKey, ccc.BytesLike>;

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
      hashType: "data1",
      args: "0x",
      cellDep: { txHash, index, depType: "code" },
    };
  });

  return { txHash, scripts };
}
