/**
 * Hashing, Type ID, script and cell helpers shared by every operation.
 */

import { ccc } from "@ckb-ccc/shell";
import type { DeploymentConfig, ScriptDeployment } from "./config.js";
import { CONFIG_ID_LEN, TYPE_ID_LEN, PROPOSAL_ID_LEN } from "./constants.js";

/** ckb-hash: blake2b-256 with the `ckb-default-hash` personalization. */
export function ckbHash(...data: ccc.BytesLike[]): ccc.Hex {
  return ccc.hashCkb(...data);
}

/** ckb-blake160-hash: the leading 20 bytes of the ckb-hash. */
export function blake160(...data: ccc.BytesLike[]): ccc.Hex {
  return ccc.hashCkb(...data).slice(0, 2 + 2 * 20) as ccc.Hex;
}

/** The ckb-blake160-hash of a serialized script, as stored in `args`. */
export function scriptId(script: ccc.Script): ccc.Hex {
  return blake160(script.toBytes());
}

/** The ckb-hash of a serialized script, used as a cell's script hash. */
export function scriptHash(script: ccc.Script): ccc.Hex {
  return ckbHash(script.toBytes());
}

/**
 * The Type ID rule (RFC 0022):
 * `blake160(CellInput[0] || output_index as u64 LE)`.
 *
 * The index is the position of the cell in the transaction outputs.
 */
export function typeId(
  firstInput: ccc.CellInput,
  outputIndex: number,
): ccc.Hex {
  const index = new Uint8Array(8);
  new DataView(index.buffer).setBigUint64(0, BigInt(outputIndex), true);
  return blake160(firstInput.toBytes(), index);
}

/** Builds a script from its deployment, with optional `args` override. */
export function scriptFromDeployment(
  deployment: ScriptDeployment,
  args?: ccc.HexLike,
): ccc.Script {
  return ccc.Script.from({
    codeHash: deployment.codeHash,
    hashType: deployment.hashType,
    args: args ?? deployment.args ?? "0x",
  });
}

/** Builds the cell dep that provides a deployed script's code. */
export function cellDepFromDeployment(
  deployment: ScriptDeployment,
): ccc.CellDep {
  return ccc.CellDep.from({
    outPoint: {
      txHash: deployment.cellDep.txHash,
      index: deployment.cellDep.index,
    },
    depType: deployment.cellDep.depType ?? "code",
  });
}

/** The config type script. Its `args` is the config Type ID. */
export function configTypeScript(config: DeploymentConfig): ccc.Script {
  const script = scriptFromDeployment(config.scripts.config);
  if (script.args === "0x") {
    throw new Error(
      "config.scripts.config.args is not configured; it is the Type ID of the " +
        "config cell printed by `create-config`",
    );
  }
  return script;
}

/** `blake160(config type script)`, the leading 20 bytes of the proposal args. */
export function configId(config: DeploymentConfig): ccc.Hex {
  return scriptId(configTypeScript(config));
}

/** The `always success` lock used by a finalized proposal cell. */
export function alwaysSuccessScript(config: DeploymentConfig): ccc.Script {
  return scriptFromDeployment(config.scripts.alwaysSuccess);
}

/**
 * Builds a proposal type script.
 *
 * Its args are `blake160(config type script) || Type ID` (40 bytes); the
 * `typeId` is derived from the creating transaction (see {@link typeId}).
 */
export function proposalTypeScript(
  config: DeploymentConfig,
  proposalArgs: ccc.HexLike,
): ccc.Script {
  const args = ccc.hexFrom(proposalArgs);
  if (ccc.bytesFrom(args).byteLength !== CONFIG_ID_LEN + TYPE_ID_LEN) {
    throw new Error(
      `proposal args must be ${CONFIG_ID_LEN + TYPE_ID_LEN} bytes, got ${args}`,
    );
  }
  return scriptFromDeployment(config.scripts.proposal, args);
}

/** The vote type script for `proposalId` (`blake160(proposal type script)`). */
export function voteTypeScript(
  config: DeploymentConfig,
  proposalId: ccc.HexLike,
): ccc.Script {
  return scriptFromDeployment(
    config.scripts.vote,
    assertLength(proposalId, PROPOSAL_ID_LEN, "proposal id"),
  );
}

/** The counting type script for `proposalId`. */
export function countingTypeScript(
  config: DeploymentConfig,
  proposalId: ccc.HexLike,
): ccc.Script {
  return scriptFromDeployment(
    config.scripts.counting,
    assertLength(proposalId, PROPOSAL_ID_LEN, "proposal id"),
  );
}

/** Asserts that a hex value has exactly `byteLength` bytes. */
export function assertLength(
  value: ccc.HexLike,
  byteLength: number,
  label: string,
): ccc.Hex {
  const hex = ccc.hexFrom(value);
  if (ccc.bytesFrom(hex).byteLength !== byteLength) {
    throw new Error(`${label} must be ${byteLength} bytes, got ${hex}`);
  }
  return hex;
}

/** The 2 byte prefix of a lock script hash, read as a big endian `u16`. */
export function lockPrefix(lock: ccc.Script): number {
  const hash = ccc.bytesFrom(scriptHash(lock));
  return (hash[0] << 8) | hash[1];
}

/** Reads the first 2 bytes of a 32 byte lock hash as a big endian `u16`. */
export function hashPrefix(lockHash: ccc.HexLike): number {
  const hash = ccc.bytesFrom(lockHash);
  return (hash[0] << 8) | hash[1];
}

/** Parses `0x`-prefixed hex into a non-negative integer. */
export function parseU16(value: string | number, label: string): number {
  const n = typeof value === "number" ? value : Number(BigInt(value));
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`${label} must be an integer in [0, 65535], got ${value}`);
  }
  return n;
}

/** A relative `since` with the block number metric (RFC 0017). */
export function relativeSince(blocks: bigint | number): ccc.Since {
  return new ccc.Since("relative", "blockNumber", BigInt(blocks));
}

/** Resolves an address string or a lock script to a lock script. */
export async function resolveLock(
  client: ccc.Client,
  value: string | ccc.ScriptLike,
): Promise<ccc.Script> {
  if (
    typeof value === "string" &&
    (value.startsWith("ckt1") || value.startsWith("ckb1"))
  ) {
    return (await ccc.Address.fromString(value, client)).script;
  }
  return ccc.Script.from(value as ccc.ScriptLike);
}

/** The lock script the signer recommends, used as the default identity. */
export async function signerLock(signer: ccc.Signer): Promise<ccc.Script> {
  return (await signer.getRecommendedAddressObj()).script;
}

/** Formats an out point for error messages and CLI output. */
export function formatOutPoint(outPoint: ccc.OutPointLike): string {
  const op = ccc.OutPoint.from(outPoint);
  return `${op.txHash}:${op.index}`;
}

/** Parses a `txHash:index` string. */
export function parseOutPoint(
  value: string,
  label = "out point",
): ccc.OutPoint {
  const match = /^(0x[0-9a-fA-F]{64}):(\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`${label} must look like 0x<txHash>:<index>, got ${value}`);
  }
  return ccc.OutPoint.from({ txHash: match[1], index: Number(match[2]) });
}

/** Requires a live cell, or throws. */
export async function requireLiveCell(
  client: ccc.Client,
  outPoint: ccc.OutPointLike,
): Promise<ccc.Cell> {
  const cell = await client.getCellLive(outPoint, true, true);
  if (!cell) {
    throw new Error(`cell ${formatOutPoint(outPoint)} is not live`);
  }
  return cell;
}

/**
 * Requires the header of the block that created a cell.
 *
 * A transaction that is still in the pool has no block yet, which happens when
 * a transaction is built right after the one that created its input: the lookup
 * is retried for a while before giving up.
 */
export async function requireCellHeader(
  client: ccc.Client,
  outPoint: ccc.OutPointLike,
  { attempts = 10, intervalMs = 1500 } = {},
): Promise<ccc.ClientBlockHeader> {
  for (let attempt = 0; ; attempt++) {
    const result = await client.getCellWithHeader(outPoint);
    if (result?.header) {
      return result.header;
    }
    if (attempt >= attempts) {
      throw new Error(
        `cannot resolve the block that created ${formatOutPoint(outPoint)}; ` +
          `is the transaction still in the pool?`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Adds the headers of the blocks that created `outPoints` to `tx.header_deps`.
 *
 * The voting scripts read the creating block of a cell through
 * `load_header(..., Source::CellDep)`, which only succeeds when that header is
 * listed in the transaction. Duplicates are skipped.
 */
export async function addHeaderDeps(
  tx: ccc.Transaction,
  client: ccc.Client,
  outPoints: ccc.OutPointLike[],
): Promise<ccc.ClientBlockHeader[]> {
  const headers: ccc.ClientBlockHeader[] = [];
  const seen = new Set<string>(tx.headerDeps.map((hash) => hash.toLowerCase()));
  for (const outPoint of outPoints) {
    const header = await requireCellHeader(client, outPoint);
    headers.push(header);
    const hash = header.hash.toLowerCase();
    if (!seen.has(hash)) {
      seen.add(hash);
      tx.headerDeps.push(header.hash);
    }
  }
  return headers;
}

/**
 * Adds cell deps, skipping out points that are already listed.
 *
 * CKB rejects a transaction that writes the same packed `CellDep` down twice
 * (`DuplicateDepsVerifier`, RFC 0022), so duplicates are removed here instead
 * of building a transaction that cannot be accepted.
 */
export function addUniqueCellDeps(
  tx: ccc.Transaction,
  deps: ccc.CellDepLike[],
): void {
  const seen = new Set(
    tx.cellDeps.map((dep) => `${dep.outPoint.txHash}:${dep.outPoint.index}`),
  );
  for (const depLike of deps) {
    const dep = ccc.CellDep.from(depLike);
    const key = `${dep.outPoint.txHash}:${dep.outPoint.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tx.cellDeps.push(dep);
  }
}

/**
 * Moves the dependencies on `outPoints` in front of every other dependency.
 *
 * The vote script counts a DAO deposit only when it is written down before the
 * first dependency group (`end_of_dao_deposit`, see
 * `docs/vote-type-script-spec.md`): the VM expands a group in place, so the
 * members it adds would otherwise push a deposit out of the counted range. The
 * signer appends its own lock dependency - a dep group on a public chain - while
 * the fee is completed, which is why the reordering happens right before the
 * transaction is signed.
 */
export function prioritizeCellDeps(
  tx: ccc.Transaction,
  outPoints: ccc.OutPointLike[],
): void {
  const prioritizedKeys = new Set(
    outPoints.map((outPoint) => formatOutPoint(outPoint).toLowerCase()),
  );
  const prioritized: ccc.CellDep[] = [];
  const rest: ccc.CellDep[] = [];
  for (const dep of tx.cellDeps) {
    const key = formatOutPoint(dep.outPoint).toLowerCase();
    (prioritizedKeys.has(key) ? prioritized : rest).push(dep);
  }
  tx.cellDeps.splice(0, tx.cellDeps.length, ...prioritized, ...rest);
}

/** Waits until the chain tip reaches `blockNumber`. */
export async function waitForBlockNumber(
  client: ccc.Client,
  blockNumber: bigint | number,
  intervalMs = 3000,
): Promise<void> {
  const target = BigInt(blockNumber);
  for (;;) {
    const tip = await client.getTip();
    if (tip >= target) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
