/**
 * Devnet bootstrapping.
 *
 * A devnet's genesis is generated locally, so its system-script cell deps (and
 * even the genesis transaction hash) differ from the public chains and from
 * another devnet. They can however be read back from block 0, which is what
 * {@link deriveKnownScripts} does: it finds the dep group cells of the
 * secp256k1 locks and the DAO code cell, and turns them into the `knownScripts`
 * overrides CCC needs to sign transactions and to build DAO cells.
 */

import { ccc } from "@ckb-ccc/shell";
import type { BootstrapConfig } from "./config.js";
import { SYSTEM_SCRIPT_CODE_HASHES } from "./constants.js";
import { ckbHash } from "./utils.js";

const OutPointCodec = ccc.mol.struct({
  txHash: ccc.mol.Byte32,
  index: ccc.mol.Uint32,
});

/** A `cell_deps` dependency group cell payload. */
const OutPointVecCodec = ccc.mol.vector(OutPointCodec);

type KnownScriptOverrides = NonNullable<BootstrapConfig["knownScripts"]>;

interface GenesisOutput {
  txHash: ccc.Hex;
  index: number;
  data: ccc.Hex;
  type?: ccc.Script;
}

/** Reads the genesis outputs of a devnet. */
async function genesisOutputs(client: ccc.Client): Promise<GenesisOutput[]> {
  const block = await client.getBlockByNumber(0);
  if (!block) {
    throw new Error("cannot read block 0 from the node");
  }
  const outputs: GenesisOutput[] = [];
  for (const tx of block.transactions) {
    const txHash = tx.hash();
    tx.outputs.forEach((output, index) => {
      outputs.push({
        txHash,
        index,
        data: tx.outputsData[index] ?? "0x",
        type: output.type,
      });
    });
  }
  return outputs;
}

/**
 * Derives the known-script overrides of the node's devnet.
 *
 * Returns the three scripts the voting system touches: the secp256k1 lock that
 * signs the transactions (through its dependency group), the multisig lock and
 * the Nervos DAO type script that backs a vote.
 */
export async function deriveKnownScripts(
  client: ccc.Client,
): Promise<KnownScriptOverrides> {
  const outputs = await genesisOutputs(client);
  const byOutPoint = new Map(
    outputs.map((output) => [
      `${output.txHash.toLowerCase()}:${output.index}`,
      output,
    ]),
  );
  const overrides: KnownScriptOverrides = {};

  const record = (
    name: keyof typeof SYSTEM_SCRIPT_CODE_HASHES,
    codeHash: string,
    cellDeps: Array<{
      outPoint: { txHash: ccc.Hex; index: number };
      depType: "code" | "depGroup";
    }>,
  ) => {
    overrides[ccc.KnownScript[name]] = {
      codeHash: ccc.hexFrom(codeHash),
      hashType: "type",
      cellDeps: cellDeps.map((cellDep) => ({ cellDep })),
    };
  };

  const codeHashOf = (output: GenesisOutput): string | undefined =>
    output.type ? ckbHash(output.type.toBytes()) : undefined;

  // Dependency groups: a cell whose data is an `OutPointVec` naming the data
  // cell and the code cell of a lock.
  //
  // The standard form - one `dep_group` dependency on the group cell - is what
  // a public chain uses, and the vote script now handles it: it stops scanning
  // `cell_deps` at the first dependency group (`end_of_dao_deposit`), and the
  // SDK keeps the voter's DAO deposits in front of that group
  // (`prioritizeCellDeps`).
  for (const output of outputs) {
    let members: Array<{ txHash: ccc.Hex; index: number }>;
    try {
      members = OutPointVecCodec.decode(output.data) as Array<{
        txHash: ccc.Hex;
        index: number;
      }>;
    } catch {
      continue;
    }
    const group = {
      outPoint: { txHash: output.txHash, index: output.index },
      depType: "depGroup" as const,
    };
    for (const member of members) {
      const target = byOutPoint.get(
        `${ccc.hexFrom(member.txHash).toLowerCase()}:${member.index}`,
      );
      const codeHash = target && codeHashOf(target);
      if (!codeHash) {
        continue;
      }
      for (const name of ["Secp256k1Blake160", "Secp256k1Multisig"] as const) {
        if (
          codeHash === SYSTEM_SCRIPT_CODE_HASHES[name] &&
          !overrides[ccc.KnownScript[name]]
        ) {
          record(name, codeHash, [group]);
        }
      }
    }
  }

  // Plain code cells: the DAO code cell is referenced directly.
  for (const output of outputs) {
    const codeHash = codeHashOf(output);
    if (
      codeHash === SYSTEM_SCRIPT_CODE_HASHES.NervosDao &&
      !overrides[ccc.KnownScript.NervosDao]
    ) {
      record("NervosDao", codeHash, [
        {
          outPoint: { txHash: output.txHash, index: output.index },
          depType: "code",
        },
      ]);
    }
  }

  return overrides;
}
