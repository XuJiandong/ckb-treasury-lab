/**
 * Client construction.
 */

import { ccc } from "@ckb-ccc/shell";

/** The part of a deployment config a client needs. */
export interface ClientConfigLike {
  rpcUrl: string;
  knownScripts?: Partial<Record<ccc.KnownScript, ccc.ScriptInfoLike>>;
}

/**
 * Builds a client for a deployment.
 *
 * A devnet has its own genesis outpoints, so the config may override the
 * built-in known scripts; the overrides are merged on top of the defaults so
 * that every other known script stays available.
 */
export function buildClient(config: ClientConfigLike): ccc.ClientPublicTestnet {
  const overrides = config.knownScripts;
  if (!overrides || Object.keys(overrides).length === 0) {
    return new ccc.ClientPublicTestnet({ url: config.rpcUrl });
  }

  // `Client.scripts` is private; the defaults are read from a throwaway
  // instance and merged with the overrides.
  const base = new ccc.ClientPublicTestnet();
  const defaults = (base as unknown as { scripts: object }).scripts;
  return new ccc.ClientPublicTestnet({
    url: config.rpcUrl,
    scripts: { ...defaults, ...overrides },
  });
}

/** Builds a private key signer for a deployment. */
export function buildSigner(
  privateKey: string,
  config: ClientConfigLike,
): ccc.SignerCkbPrivateKey {
  return new ccc.SignerCkbPrivateKey(buildClient(config), privateKey);
}
