/**
 * Welcome page: wallet indicator, the two entries, the config cell and the
 * cell/lock map.
 */

import * as api from "../api.js";
import { mountShell } from "../layout.js";
import { CHAIN, MOCK_DAO, TYPE_SCRIPTS } from "../mock-data.js";
import { getState, subscribe } from "../state.js";
import { alert, configRow, icon, toast } from "../ui.js";
import { copyText, formatBlock, formatCkb, formatDuration, formatInt, shorten } from "../util.js";

const CELL_FLOW = [
  {
    name: "Proposal cell",
    meta: "status 0 · voting open",
    lock: ["initiator's lock", "locktag--initiator"],
  },
  {
    name: "Vote cell",
    meta: "vote_amount · direction",
    lock: ["voter's lock", "locktag--voter"],
  },
  {
    name: "Counting cell",
    meta: "hash range · yes or no",
    lock: ["initiator's lock", "locktag--initiator"],
  },
  {
    name: "Finalized proposal cell",
    meta: "status 1 · challenges allowed",
    lock: ["always-success lock", "locktag--always"],
  },
  {
    name: "Passed proposal cell",
    meta: "status 2 · grant can be claimed",
    lock: ["initiator's lock", "locktag--initiator"],
  },
];

const LOCK_ROWS = [
  {
    cell: "Proposal cell",
    lock: "Initiator's lock script",
    tone: "initiator",
    note: "Only the initiator can consume it: count, finalize or recycle the bond.",
  },
  {
    cell: "Vote cell",
    lock: "Voter's lock script",
    tone: "voter",
    note: "Locked by the DAO owner; unlocking it withdraws the vote and the deposit.",
  },
  {
    cell: "Counting cell",
    lock: "Initiator's lock script",
    tone: "initiator",
    note: "Created and consumed by the initiator while collecting votes.",
  },
  {
    cell: "Finalized proposal cell",
    lock: "Always-success lock script",
    tone: "always",
    note: "Nobody needs to sign: this is what makes the challenge phase possible.",
  },
  {
    cell: "Passed proposal cell",
    lock: "Initiator's lock script",
    tone: "initiator",
    note: "Back under the initiator's control to claim the grant from the treasury.",
  },
];

function renderChainmap() {
  const flow = document.getElementById("chainmap-flow");
  const bits = [];
  CELL_FLOW.forEach((cell, index) => {
    const node = document.createElement("div");
    node.className = "chainnode";
    node.append(
      Object.assign(document.createElement("span"), {
        className: "chainnode__num",
        textContent: String(index + 1),
      }),
    );
    const body = document.createElement("div");
    body.className = "chainnode__body";
    body.append(
      Object.assign(document.createElement("div"), { className: "chainnode__name", textContent: cell.name }),
      Object.assign(document.createElement("div"), { className: "chainnode__meta", textContent: cell.meta }),
    );
    const lock = document.createElement("span");
    lock.className = `locktag ${cell.lock[1]} chainnode__lock`;
    lock.textContent = cell.lock[0];
    node.append(body, lock);
    bits.push(node);
    if (index < CELL_FLOW.length - 1) {
      const arrow = document.createElement("div");
      arrow.className = "chainmap__arrow";
      arrow.append(icon("arrow-down", { size: 14 }));
      bits.push(arrow);
    }
  });
  flow.replaceChildren(...bits);
  document.getElementById("chainmap-height").textContent = `block ${formatBlock(CHAIN.blockNumber)}`;
}

function renderConfig() {
  const data = api.config.data();
  const cell = api.config.cell();

  document.getElementById("config-outpoint").textContent = `${shorten(cell.outPoint.txHash, 14, 8)}:${cell.outPoint.index}`;
  document.getElementById("config-capacity").textContent = `capacity ${formatCkb(cell.capacity)} CKB`;
  document.getElementById("config-type-codehash").textContent = shorten(cell.typeScript.codeHash, 18, 10);
  document.getElementById("config-outpoint-copy").addEventListener("click", (event) =>
    copyText(`${cell.outPoint.txHash}:${cell.outPoint.index}`, event.currentTarget),
  );

  const grid = document.getElementById("config-grid");
  const halt = data.emergentHalt === 1;
  const rows = [
    configRow("emergent_halt", halt ? "1 · everything is halted" : "0 · running", {
      iconName: halt ? "triangle-alert" : "shield-check",
    }),
    configRow("yes_threshold", `${formatCkb(data.yesThreshold)} CKB`, { iconName: "target" }),
    configRow("minimal_proposal_capacity", `${formatCkb(data.minimalProposalCapacity)} CKB`, {
      iconName: "cube",
    }),
    configRow("vote_duration", `${formatInt(data.voteDuration)} blocks · ~${formatDuration(Number(data.voteDuration) * 8)}`, {
      iconName: "hourglass",
    }),
    configRow("vote_window", `${formatInt(data.voteWindow)} blocks · ~${formatDuration(Number(data.voteWindow) * 8)}`, {
      iconName: "timer",
    }),
    configRow("challenge_time", `${formatInt(data.challengeTime)} blocks · ~${formatDuration(Number(data.challengeTime) * 8)}`, {
      iconName: "shield",
    }),
    configRow("vote_code_hash", shorten(data.voteCodeHash, 16, 8), { mono: true }),
    configRow("vote_hash_type", `${data.voteHashType} · type`, { mono: true }),
    configRow("counting_code_hash", shorten(data.countingCodeHash, 16, 8), { mono: true }),
    configRow("counting_hash_type", `${data.countingHashType} · type`, { mono: true }),
    configRow("always_success_code_hash", shorten(data.alwaysSuccessCodeHash, 16, 8), { mono: true }),
    configRow("always_success_hash_type", `${data.alwaysSuccessHashType} · type`, { mono: true }),
    configRow("veto_lock_script_hash", shorten(data.vetoLockScriptHash, 16, 8), { mono: true }),
  ];
  const wide = configRow(
    "proposal type args",
    `${TYPE_SCRIPTS.proposal.args.slice(0, 42)} · blake160(config type script) || Type ID`,
    { mono: true, wide: true },
  );
  grid.replaceChildren(...rows, wide);

  document.getElementById("fact-duration").lastChild.textContent =
    ` ${formatInt(data.voteDuration)} block vote duration`;
  document.getElementById("fact-threshold").lastChild.textContent =
    ` ${formatCkb(data.yesThreshold)} CKB yes-threshold`;
  document.getElementById("halt-fact-text").textContent = halt
    ? "emergent halt: ON"
    : "emergent halt: off";
}

function renderLocks() {
  const list = document.getElementById("lock-list");
  list.replaceChildren(
    ...LOCK_ROWS.map((row) => {
      const node = document.createElement("div");
      node.className = "panel";
      const head = document.createElement("div");
      head.className = "row row--wrap";
      head.append(
        Object.assign(document.createElement("strong"), { textContent: row.cell, style: "font-size:13.5px" }),
      );
      const tag = document.createElement("span");
      tag.className = `locktag locktag--${row.tone}`;
      tag.textContent = row.lock;
      head.append(tag);
      const note = document.createElement("p");
      note.className = "muted";
      note.style.fontSize = "12.5px";
      note.style.marginTop = "7px";
      note.textContent = row.note;
      node.append(head, note);
      return node;
    }),
  );
}

function syncEntries() {
  const connected = getState().wallet;
  const hint = document.getElementById("entry-hint");
  hint.textContent = connected
    ? `Connected as ${shorten(connected.address, 16, 8)} · voting power ${formatCkb(MOCK_DAO.votePower)} CKB`
    : "Connect a wallet to continue";
  for (const entry of document.querySelectorAll(".entry")) {
    entry.classList.toggle("is-locked", !connected);
    const note = entry.querySelector("[data-lock-note]");
    if (note) note.classList.toggle("hidden", Boolean(connected));
  }
}

function guardEntries() {
  for (const entry of document.querySelectorAll(".entry")) {
    entry.addEventListener("click", async (event) => {
      if (getState().wallet) return;
      event.preventDefault();
      toast({ kind: "warn", title: "Connect a wallet first", message: "Your CKB address becomes the voter or initiator lock script." });
      document.dispatchEvent(new CustomEvent("wallet:connect"));
    });
  }
}

export function initWelcome() {
  mountShell();
  renderChainmap();
  renderConfig();
  renderLocks();
  syncEntries();
  guardEntries();
  subscribe(syncEntries);
  document.addEventListener("mock:reset", () => {
    syncEntries();
  });

  const config = api.config.data();
  if (config.emergentHalt === 1) {
    document.querySelector("main").prepend(
      alert("no", "emergent_halt is set to 1: every script of this system fails right now."),
    );
  }
}
