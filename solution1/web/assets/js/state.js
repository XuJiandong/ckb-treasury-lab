/**
 * Persisted mock state: the connected wallet and the proposals/votes.
 *
 * A single `localStorage` key keeps the three pages consistent, and "reset
 * demo data" simply drops it.
 */

import { seedState } from "./mock-data.js";

const KEY = "ckb-vote-mock-v5";

let state = seedState();
const listeners = new Set();

/** `localStorage` cannot hold BigInt, so they travel as `"123n"`. */
function replacer(_key, value) {
  return typeof value === "bigint" ? `${value}n` : value;
}

function reviver(_key, value) {
  return typeof value === "string" && /^-?\d+n$/.test(value)
    ? BigInt(value.slice(0, -1))
    : value;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviver);
    if (!parsed || parsed.version !== 5 || !Array.isArray(parsed.proposals)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const stored = read();
if (stored) state = stored;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state, replacer));
  } catch {
    /* storage disabled: keep the in-memory copy only */
  }
}

export function getState() {
  return state;
}

export function setState(mutator) {
  const next = mutator(state) ?? state;
  state = next;
  persist();
  for (const listener of listeners) listener(state);
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetState() {
  state = seedState();
  persist();
  for (const listener of listeners) listener(state);
}

export function findProposal(id) {
  return state.proposals.find((proposal) => proposal.id === id) ?? null;
}

export function updateProposal(id, mutator) {
  return setState((current) => ({
    ...current,
    proposals: current.proposals.map((proposal) =>
      proposal.id === id ? { ...proposal, ...mutator(proposal) } : proposal,
    ),
  }));
}
