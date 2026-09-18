/**
 * Nervos DAO deposits. For testing purpose.
 */

import { ccc } from "@ckb-ccc/shell";
import type { BootstrapConfig } from "./config.js";
import {
  addUniqueCellDeps,
  ckbHash,
  resolveLock,
  signerLock,
} from "./utils.js";

/** The 8 zero bytes that mark a cell as a deposited DAO cell. */
export const DAO_DEPOSIT_DATA = "0x0000000000000000";

/**
 * Index of the DAO code cell in the genesis block.
 *
 * `tx[0] output[2]` holds the DAO binary on every CKB chain (its type script
 * hashes to `SYSTEM_SCRIPT_CODE_HASHES.NervosDao`), so the dependency can be
 * derived from block 0 without ckb-cli.
 */
const DAO_GENESIS_OUTPUT_INDEX = 2;

/** Parameters of {@link depositDao}. */
export interface DepositDaoParams {
  /** Capacity of the deposit cell, in shannons. */
  amount: bigint | number;
  /** Lock of the deposit; defaults to the signer's lock. */
  lock?: string | ccc.ScriptLike;
  /** Fee rate in shannons per KB; defaults to 1500. */
  feeRate?: bigint | number;
}

/** The result of {@link depositDao}. */
export interface DepositDaoResult {
  txHash: ccc.Hex;
  /** The freshly created deposit cell. */
  depositCell: { txHash: ccc.Hex; index: number };
  /** The capacity of the deposit, in shannons. */
  amount: bigint;
  /** The Nervos DAO type script of the deposit. */
  daoTypeScript: ccc.Script;
  /** The DAO code cell that was listed in `cell_deps`. */
  cellDep: ccc.CellDep;
}

/**
 * The `cell_dep` that provides the Nervos DAO type script.
 *
 * It is read from the genesis block (`tx[0] output[2]`) and checked against the
 * node's known-script configuration; the known script is used as a fallback for
 * a chain whose genesis differs.
 */
export async function resolveDaoCellDep(
  client: ccc.Client,
): Promise<ccc.CellDep> {
  const known = await client.getKnownScript(ccc.KnownScript.NervosDao);
  const block = await client.getBlockByNumber(0);
  const transaction = block?.transactions[0];
  const type = transaction?.outputs[DAO_GENESIS_OUTPUT_INDEX]?.type;
  if (transaction && type) {
    const matches =
      ckbHash(type.toBytes()) === ccc.hexFrom(known.codeHash) &&
      type.hashType === known.hashType;
    if (matches) {
      return ccc.CellDep.from({
        outPoint: {
          txHash: transaction.hash(),
          index: DAO_GENESIS_OUTPUT_INDEX,
        },
        depType: "code",
      });
    }
  }

  const dep = known.cellDeps[0]?.cellDep;
  if (!dep) {
    throw new Error(
      "cannot resolve the Nervos DAO code cell: the genesis output " +
        `${DAO_GENESIS_OUTPUT_INDEX} is not the DAO type script and the known ` +
        `scripts list no cell dep for it`,
    );
  }
  return ccc.CellDep.from(dep);
}

/**
 * Creates a Nervos DAO deposit cell.
 *
 * The output holds `amount` shannons locked by `lock` (the signer by default)
 * and carries the DAO type script with the 8 zero bytes that mark it as
 * deposited; the transaction lists the genesis DAO code cell in `cell_deps`.
 */
export async function depositDao(
  signer: ccc.Signer,
  config: BootstrapConfig,
  params: DepositDaoParams,
): Promise<DepositDaoResult> {
  const client = signer.client;
  const amount = BigInt(params.amount);
  if (amount <= 0n) {
    throw new Error("the deposit amount must be positive");
  }

  const lock = params.lock
    ? await resolveLock(client, params.lock)
    : await signerLock(signer);
  const daoTypeScript = await ccc.Script.fromKnownScript(
    client,
    ccc.KnownScript.NervosDao,
    "0x",
  );
  const cellDep = await resolveDaoCellDep(client);

  const output = ccc.CellOutput.from(
    { capacity: amount, lock, type: daoTypeScript },
    DAO_DEPOSIT_DATA,
  );
  if (output.capacity > amount) {
    throw new Error(
      `the deposit of ${amount} shannons is below the minimum capacity of a ` +
        `DAO cell (${output.capacity} shannons)`,
    );
  }

  const tx = ccc.Transaction.from({
    outputs: [output],
    outputsData: [DAO_DEPOSIT_DATA],
  });
  addUniqueCellDeps(tx, [cellDep]);

  // The default cell selection skips cells that carry a type script, so the
  // transaction never spends a DAO deposit to fund another one.
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(
    signer,
    BigInt(params.feeRate ?? config.feeRate ?? 1500),
  );
  const txHash = await signer.sendTransaction(tx);

  return {
    txHash,
    depositCell: { txHash, index: 0 },
    amount: output.capacity,
    daoTypeScript,
    cellDep,
  };
}
