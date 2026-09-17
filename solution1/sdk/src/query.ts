/**
 * Cell discovery and decoding.
 *
 * Two searches are used throughout:
 * - the config cell is the singleton whose type script has the configured
 *   config `code_hash` / `hash_type`;
 * - every other cell is found by its type script, with a prefix search on the
 *   `args` so that all proposals, votes or counting cells of a deployment can
 *   be listed at once.
 */

import { ccc } from "@ckb-ccc/shell";
import type { DeploymentConfig } from "./config.js";
import {
  decodeCounting,
  decodeProposalCellData,
  decodeVote,
  decodeVotingConfig,
  type CountingData,
  type ProposalCellData,
  type VoteData,
  type VotingConfig,
} from "./codec.js";
import { configId, scriptFromDeployment, scriptId } from "./utils.js";

/** The config cell, its type script and its decoded payload. */
export interface ConfigCellInfo {
  cell: ccc.Cell;
  typeScript: ccc.Script;
  /** `blake160(config type script)`, the leading proposal args. */
  id: ccc.Hex;
  data: VotingConfig;
}

/** A proposal / finalized / passed proposal cell. */
export interface ProposalCellInfo {
  cell: ccc.Cell;
  typeScript: ccc.Script;
  data: ProposalCellData;
}

/** A vote cell. */
export interface VoteCellInfo {
  cell: ccc.Cell;
  typeScript: ccc.Script;
  data: VoteData;
}

/** A counting cell. */
export interface CountingCellInfo {
  cell: ccc.Cell;
  typeScript: ccc.Script;
  data: CountingData;
}

/** Finds the live config cell of a deployment. */
export async function findConfigCell(
  client: ccc.Client,
  config: DeploymentConfig,
): Promise<ccc.Cell | undefined> {
  if (config.configCell) {
    const cell = await client.getCellLive(config.configCell, true, true);
    if (cell) {
      return cell;
    }
    // The config cell was updated since the config file was written, so its
    // recorded out point is spent; fall back to searching by type script.
  }

  const configuredArgs = config.scripts.config.args;
  if (configuredArgs != null && configuredArgs !== "0x") {
    return client.findSingletonCellByType(
      scriptFromDeployment(config.scripts.config),
    );
  }

  // The config cell is the only cell of the deployment whose type script uses
  // the config code hash, so a prefix search on the empty args finds it.
  for await (const cell of client.findCells(
    {
      script: scriptFromDeployment(config.scripts.config, "0x"),
      scriptType: "type",
      scriptSearchMode: "prefix",
      withData: true,
    },
    undefined,
    1,
  )) {
    return cell;
  }
  return undefined;
}

/** Finds the config cell and decodes it, or throws. */
export async function loadConfigCell(
  client: ccc.Client,
  config: DeploymentConfig,
): Promise<ConfigCellInfo> {
  const cell = await findConfigCell(client, config);
  if (!cell) {
    throw new Error(
      "config cell not found: check scripts.config code hash/hash type, set " +
        "configCell in the deployment config, or make sure the node has an indexer",
    );
  }
  const typeScript = cell.cellOutput.type;
  if (
    !typeScript ||
    typeScript.codeHash !== ccc.hexFrom(config.scripts.config.codeHash) ||
    typeScript.hashType !== config.scripts.config.hashType
  ) {
    throw new Error(
      "the discovered config cell does not carry the config type script",
    );
  }
  return {
    cell,
    typeScript,
    id: scriptId(typeScript),
    data: decodeVotingConfig(cell.outputData),
  };
}

/** Reads a `VotingConfig` from a config cell payload. */
export function readVotingConfig(cell: ccc.Cell): VotingConfig {
  return decodeVotingConfig(cell.outputData);
}

/** Rejects a cell whose type script is not the deployed one. */
function assertScriptMatches(
  typeScript: ccc.Script,
  deployment: { codeHash: ccc.HexLike; hashType: ccc.HashType },
  label: string,
): void {
  if (
    typeScript.codeHash !== ccc.hexFrom(deployment.codeHash) ||
    typeScript.hashType !== deployment.hashType
  ) {
    throw new Error(`the cell is not a ${label} cell of this deployment`);
  }
}

/**
 * `blake160(config type script)`, from the deployment config when it is known
 * and from the config cell on chain otherwise.
 */
export async function resolveConfigId(
  client: ccc.Client,
  config: DeploymentConfig,
): Promise<ccc.Hex> {
  if (
    config.scripts.config.args != null &&
    config.scripts.config.args !== "0x"
  ) {
    return configId(config);
  }
  return (await loadConfigCell(client, config)).id;
}

/** Lists the proposal cells of a deployment. */
export async function* findProposalCells(
  client: ccc.Client,
  config: DeploymentConfig,
  filter?: { configId?: ccc.Hex; status?: number },
): AsyncGenerator<ProposalCellInfo> {
  const id = filter?.configId ?? (await resolveConfigId(client, config));
  const search = scriptFromDeployment(config.scripts.proposal, id);
  for await (const cell of client.findCells({
    script: search,
    scriptType: "type",
    scriptSearchMode: "prefix",
    withData: true,
  })) {
    const typeScript = cell.cellOutput.type;
    if (!typeScript) {
      continue;
    }
    let data: ProposalCellData;
    try {
      data = decodeProposalCellData(cell.outputData);
    } catch {
      continue;
    }
    if (filter?.status !== undefined && data.status !== filter.status) {
      continue;
    }
    yield { cell, typeScript, data };
  }
}

/** Reads one live proposal cell, or throws. */
export async function getProposalCell(
  client: ccc.Client,
  config: DeploymentConfig,
  outPoint: ccc.OutPointLike,
): Promise<ProposalCellInfo> {
  const cell = await client.getCellLive(outPoint, true, true);
  if (!cell) {
    throw new Error(
      `proposal cell ${outPoint.txHash}:${outPoint.index} is not live`,
    );
  }
  const typeScript = cell.cellOutput.type;
  if (!typeScript) {
    throw new Error("the cell is not a proposal cell: it has no type script");
  }
  assertScriptMatches(typeScript, config.scripts.proposal, "proposal");
  return { cell, typeScript, data: decodeProposalCellData(cell.outputData) };
}

/** Lists the vote cells of a deployment, optionally of one proposal. */
export async function* findVoteCells(
  client: ccc.Client,
  config: DeploymentConfig,
  filter?: { proposalId?: ccc.Hex; direction?: number },
): AsyncGenerator<VoteCellInfo> {
  const search = scriptFromDeployment(config.scripts.vote, filter?.proposalId);
  const prefix = filter?.proposalId === undefined;
  for await (const cell of client.findCells({
    script: search,
    scriptType: "type",
    scriptSearchMode: prefix ? "prefix" : "exact",
    withData: true,
  })) {
    const typeScript = cell.cellOutput.type;
    if (!typeScript) {
      continue;
    }
    let data: VoteData;
    try {
      data = decodeVote(cell.outputData);
    } catch {
      continue;
    }
    if (
      filter?.direction !== undefined &&
      data.direction !== filter.direction
    ) {
      continue;
    }
    yield { cell, typeScript, data };
  }
}

/** Reads one live vote cell, or throws. */
export async function getVoteCell(
  client: ccc.Client,
  config: DeploymentConfig,
  outPoint: ccc.OutPointLike,
): Promise<VoteCellInfo> {
  const cell = await client.getCellLive(outPoint, true, true);
  if (!cell) {
    throw new Error(
      `vote cell ${outPoint.txHash}:${outPoint.index} is not live`,
    );
  }
  const typeScript = cell.cellOutput.type;
  if (!typeScript) {
    throw new Error("the cell is not a vote cell: it has no type script");
  }
  assertScriptMatches(typeScript, config.scripts.vote, "vote");
  return { cell, typeScript, data: decodeVote(cell.outputData) };
}

/** Lists the counting cells of a deployment, optionally of one proposal. */
export async function* findCountingCells(
  client: ccc.Client,
  config: DeploymentConfig,
  filter?: { proposalId?: ccc.Hex; direction?: number },
): AsyncGenerator<CountingCellInfo> {
  const search = scriptFromDeployment(
    config.scripts.counting,
    filter?.proposalId,
  );
  const prefix = filter?.proposalId === undefined;
  for await (const cell of client.findCells({
    script: search,
    scriptType: "type",
    scriptSearchMode: prefix ? "prefix" : "exact",
    withData: true,
  })) {
    const typeScript = cell.cellOutput.type;
    if (!typeScript) {
      continue;
    }
    let data: CountingData;
    try {
      data = decodeCounting(cell.outputData);
    } catch {
      continue;
    }
    if (
      filter?.direction !== undefined &&
      data.direction !== filter.direction
    ) {
      continue;
    }
    yield { cell, typeScript, data };
  }
}

/** Reads one live counting cell, or throws. */
export async function getCountingCell(
  client: ccc.Client,
  config: DeploymentConfig,
  outPoint: ccc.OutPointLike,
): Promise<CountingCellInfo> {
  const cell = await client.getCellLive(outPoint, true, true);
  if (!cell) {
    throw new Error(
      `counting cell ${outPoint.txHash}:${outPoint.index} is not live`,
    );
  }
  const typeScript = cell.cellOutput.type;
  if (!typeScript) {
    throw new Error("the cell is not a counting cell: it has no type script");
  }
  assertScriptMatches(typeScript, config.scripts.counting, "counting");
  return { cell, typeScript, data: decodeCounting(cell.outputData) };
}

/** Every deposited DAO cell of `lock`, as a vote's backing deposits. */
export async function findDaoDeposits(
  client: ccc.Client,
  lock: ccc.Script,
): Promise<ccc.Cell[]> {
  const daoType = await ccc.Script.fromKnownScript(
    client,
    ccc.KnownScript.NervosDao,
    "0x",
  );
  const deposits: ccc.Cell[] = [];
  for await (const cell of client.findCellsByLock(lock, daoType, true)) {
    if (await cell.isNervosDao(client, "deposited")) {
      deposits.push(cell);
    }
  }
  return deposits;
}
