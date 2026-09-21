/**
 * `For Voter` page: the live proposals, the tallies, and the vote / withdraw
 * actions of the connected DAO owner.
 */

import * as api from "../api.js";
import { Direction, ProposalStatus } from "../api.js";
import { ask, receiptDialog, voteDialog } from "../dialogs.js";
import { animateBars, mountShell } from "../layout.js";
import { CHAIN, CONFIG_CELL, MOCK_DAO } from "../mock-data.js";
import { getState, subscribe } from "../state.js";
import {
  alert,
  countdown,
  futureRow,
  hashChip,
  icon,
  metric,
  statusBadge,
  tallyBar,
  toast,
  withBusy,
} from "../ui.js";
import { formatBlock, formatCkb, formatTimestamp, percent, shorten, sleep } from "../util.js";

const PAGE = {
  filter: "all",
  query: "",
};

/* --------------------------------------------------------------------------
   Stats
   -------------------------------------------------------------------------- */

function renderStats(views) {
  const host = document.getElementById("voter-stats");
  const voted = views.filter((view) => view.hasVoted);
  const nextDeadline = views.reduce(
    (min, view) => (min === null || view.remainingBlocks < min ? view.remainingBlocks : min),
    null,
  );
  const totalYes = views.reduce((sum, view) => sum + view.yes, 0n);
  const totalNo = views.reduce((sum, view) => sum + view.no, 0n);
  const closed = api.allViews().filter(
    (view) => view.status === ProposalStatus.Open && view.voteExpired,
  ).length;

  host.replaceChildren(
    metric({
      label: "Your DAO deposit",
      value: formatCkb(MOCK_DAO.votePower),
      unit: "CKB",
      foot: `${MOCK_DAO.depositCount} deposit cells · spent in full by a vote`,
      tone: "accent",
    }),
    metric({
      label: "Live proposals",
      value: String(views.length),
      foot: nextDeadline === null ? "none in the voting window" : `next deadline in ${formatBlock(nextDeadline)} blocks`,
    }),
    metric({
      label: "Your votes",
      value: `${voted.length}/${views.length}`,
      foot: voted.length ? "vote cells you can still withdraw" : "you have not voted yet",
      tone: voted.length ? "yes" : undefined,
    }),
    metric({
      label: "Yes / No",
      value: `${percent(totalYes, totalYes + totalNo || 1n).toFixed(1)}%`,
      foot: closed
        ? `${formatCkb(totalNo)} CKB against · ${closed} proposal(s) out of window`
        : `${formatCkb(totalNo)} CKB against`,
      tone: "yes",
    }),
  );
}

/* --------------------------------------------------------------------------
   Proposal cards
   -------------------------------------------------------------------------- */

function quorum(view) {
  const wrap = document.createElement("div");
  wrap.className = "quorum";
  const head = document.createElement("div");
  head.className = "quorum__head";
  head.append(
    Object.assign(document.createElement("span"), { textContent: "yes_threshold" }),
  );
  const state = document.createElement("span");
  state.className = `quorum__state quorum__state--${view.thresholdReached ? "ok" : "pending"}`;
  state.textContent = view.thresholdReached
    ? `reached · +${formatCkb(view.yes - view.threshold)} CKB above`
    : `short by ${formatCkb(view.missingYes)} CKB`;
  head.append(state);

  const bar = document.createElement("div");
  bar.className = "bar bar--threshold";
  const fill = document.createElement("div");
  fill.className = "bar__fill";
  fill.dataset.width = String(percent(view.yes, view.threshold));
  bar.append(fill);
  const legend = document.createElement("div");
  legend.className = "bar__legend";
  legend.append(
    Object.assign(document.createElement("span"), { textContent: `${formatCkb(view.yes)} CKB yes` }),
    Object.assign(document.createElement("span"), { textContent: `${formatCkb(view.threshold)} CKB required` }),
  );
  wrap.append(head, bar, legend);
  return wrap;
}

function metaGrid(view) {
  const grid = document.createElement("div");
  grid.className = "proposal__meta";

  const rows = [
    ["Requested", `${formatCkb(view.requestedAmount)} CKB`],
    ["Recipient lock hash", null],
    ["Vote ends", `block ${formatBlock(view.voteEnds)}`],
    ["Status", null],
  ];

  const requested = document.createElement("div");
  requested.className = "kv";
  requested.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: rows[0][0] }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: rows[0][1] }),
  );

  const recipient = document.createElement("div");
  recipient.className = "kv";
  recipient.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: "Recipient lock hash" }),
  );
  const recipientWrap = document.createElement("span");
  recipientWrap.className = "kv__v";
  recipientWrap.append(hashChip(view.recipientLockHash, { head: 10, tail: 6 }));
  recipient.append(recipientWrap);

  const ends = document.createElement("div");
  ends.className = "kv";
  ends.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: "Vote ends" }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: `block ${formatBlock(view.voteEnds)}` }),
  );

  const origin = document.createElement("div");
  origin.className = "kv";
  origin.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: "Created at block" }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: formatBlock(view.createdAtBlock) }),
  );

  grid.append(requested, recipient, ends, origin);
  return grid;
}

function voteCell(view) {
  const yes = view.myVote.direction === Direction.Yes;
  const node = document.createElement("div");
  node.className = `votecell votecell--${yes ? "yes" : "no"}`;
  const iconWrap = document.createElement("span");
  iconWrap.className = "votecell__icon";
  iconWrap.append(icon(yes ? "check" : "x", { size: 17 }));
  const body = document.createElement("div");
  body.className = "votecell__body";
  body.append(
    Object.assign(document.createElement("div"), {
      className: "votecell__title",
      textContent: `Your vote cell · ${yes ? "YES" : "NO"}`,
    }),
  );
  const meta = document.createElement("div");
  meta.className = "votecell__meta";
  meta.append(
    Object.assign(document.createElement("span"), {
      textContent: `${formatCkb(view.myVote.voteAmount)} CKB`,
    }),
    Object.assign(document.createElement("span"), {
      textContent: `cast at block ${formatBlock(view.myVote.blockNumber)}`,
    }),
    Object.assign(document.createElement("span"), {
      textContent: `tx ${shorten(view.myVote.txHash, 12, 6)}`,
    }),
  );
  body.append(meta);
  const withdraw = document.createElement("button");
  withdraw.type = "button";
  withdraw.className = "btn btn--danger btn--sm";
  withdraw.append(icon("rotate-ccw", { size: 14 }), document.createTextNode("Withdraw vote"));
  withdraw.addEventListener("click", () => onWithdraw(view, withdraw));

  node.append(iconWrap, body, withdraw);
  return node;
}

function proposalCard(view) {
  const card = document.createElement("article");
  card.className = "card proposal";
  card.id = `proposal-${view.id}`;

  /* head */
  const head = document.createElement("div");
  head.className = "proposal__head";
  const titleWrap = document.createElement("div");
  titleWrap.style.minWidth = "0";
  const badges = document.createElement("div");
  badges.className = "row row--wrap";
  badges.append(statusBadge(view));
  if (view.hasVoted) {
    badges.append(
      Object.assign(document.createElement("span"), {
        className: "badge badge--passed",
        textContent: "you voted",
      }),
    );
  }
  const title = document.createElement("h3");
  title.className = "proposal__title";
  title.style.marginTop = "10px";
  title.textContent = view.description;
  const idRow = document.createElement("div");
  idRow.className = "proposal__id";
  idRow.append(
    Object.assign(document.createElement("span"), { className: "dim", textContent: "proposal id" }),
    hashChip(view.typeScript.args, { head: 14, tail: 8 }),
    Object.assign(document.createElement("span"), { className: "dim", textContent: "·" }),
    Object.assign(document.createElement("span"), { className: "dim", textContent: `bond ${formatCkb(view.bond)} CKB` }),
  );
  titleWrap.append(badges, title, idRow);

  const amount = document.createElement("div");
  amount.className = "proposal__amount";
  amount.append(
    Object.assign(document.createElement("div"), { className: "label", textContent: "requested" }),
    Object.assign(document.createElement("div"), { className: "value-lg", textContent: formatCkb(view.requestedAmount) }),
    Object.assign(document.createElement("div"), { className: "unit", textContent: "CKB" }),
  );
  head.append(titleWrap, amount);

  /* body */
  const body = document.createElement("div");
  body.className = "proposal__body";
  const tally = document.createElement("div");
  tally.className = "tally";
  tally.append(
    tallyBar({ label: "YES", amount: view.yes, total: view.total || 1n, tone: "yes" }),
    tallyBar({ label: "NO", amount: view.no, total: view.total || 1n, tone: "no" }),
    quorum(view),
  );
  body.append(tally, metaGrid(view));

  /* actions */
  const actions = document.createElement("div");
  actions.className = "proposal__actions";
  actions.append(
    countdown({
      blocks: view.remainingBlocks,
      syncedAt: view.syncedAt,
      readyText: "voting window closed",
    }),
  );
  const notice = document.createElement("span");
  notice.className = "dim";
  notice.style.fontSize = "12.5px";
  notice.textContent = "vote uses the entire DAO deposit";
  actions.append(notice);

  if (view.hasVoted) {
    actions.append(voteCell(view));
    card.append(head, body, actions);
    return card;
  }

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const vote = document.createElement("button");
  vote.type = "button";
  vote.className = "btn btn--primary";
  vote.append(icon("vote", { size: 16 }), document.createTextNode("Vote"));
  vote.addEventListener("click", () => onVote(view, vote));
  actions.append(spacer, vote);
  card.append(head, body, actions);
  return card;
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

async function onVote(view, button) {
  const connected = api.wallet();
  if (!connected) {
    document.dispatchEvent(new CustomEvent("wallet:connect"));
    return;
  }
  const answer = await voteDialog({
    proposal: view,
    amountLabel: formatCkb(MOCK_DAO.votePower),
    blockNumber: BigInt(view.blockNumber),
    daoDeposits: MOCK_DAO.depositCount,
    future: futureRow("Vote with part of a DAO deposit instead of the whole one"),
  });
  if (!answer) return;
  const direction = answer === "yes" ? Direction.Yes : Direction.No;
  await withBusy(
    button,
    async () => {
      const vote = await api.castVote(view.id, direction);
      toast({
        kind: direction === Direction.Yes ? "success" : "warn",
        title: `Vote cast: ${answer.toUpperCase()}`,
        message: `${formatCkb(vote.voteAmount)} CKB recorded at block ${formatBlock(vote.blockNumber)}`,
      });
      render();
    },
    { busyLabel: "Signing…" },
  );
}

async function onWithdraw(view, button) {
  const ok = await ask({
    title: "Withdraw this vote?",
    subtitle: "The vote cell is consumed and your DAO deposit becomes spendable again",
    iconName: "rotate-ccw",
    tone: "warn",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "warn",
          `A vote cannot be changed: withdrawing frees ${formatCkb(view.myVote.voteAmount)} CKB of deposit and removes the vote from the tally.`,
          { iconName: "triangle-alert" },
        ),
      );
      return [wrap];
    })(),
    confirmLabel: "Withdraw",
    confirmClass: "btn--danger",
  });
  if (!ok) return;
  await withBusy(
    button,
    async () => {
      const removed = await api.withdrawVote(view.id);
      if (!removed) return;
      await receiptDialog({
        title: "Vote withdrawn",
        subtitle: "The deposit is unlocked in your wallet again",
        rows: [
          ["Proposal", view.description.slice(0, 48) + "…"],
          ["Deposit returned", `${formatCkb(removed.voteAmount)} CKB`],
          ["Vote cell", `${shorten(removed.txHash, 14, 8)}:${removed.index}`],
          ["Consumed at", formatTimestamp(Date.now())],
        ],
      });
      render();
    },
    { busyLabel: "Signing…" },
  );
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function skeleton() {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  for (let i = 0; i < 2; i += 1) {
    const block = document.createElement("div");
    block.className = "skeleton";
    const widths = ["38%", "92%", "74%", "100%", "58%"];
    const lines = widths.map((width, index) => {
      const line = document.createElement("div");
      line.className = "skeleton__line";
      line.style.width = width;
      line.style.marginTop = index === 0 ? "0" : "12px";
      line.style.height = index === 0 ? "18px" : "12px";
      return line;
    });
    block.append(...lines);
    wrap.append(block);
  }
  return wrap;
}

function applyFilter(views) {
  let list = views;
  if (PAGE.filter === "voted") list = list.filter((view) => view.hasVoted);
  if (PAGE.filter === "ending") list = list.filter((view) => view.remainingBlocks <= 200n);
  const query = PAGE.query.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (view) =>
        view.description.toLowerCase().includes(query) ||
        view.recipientLockHash.toLowerCase().includes(query),
    );
  }
  return list;
}

function renderFilters(views) {
  document.getElementById("count-all").textContent = String(views.length);
  document.getElementById("count-voted").textContent = String(
    views.filter((view) => view.hasVoted).length,
  );
  document.getElementById("count-ending").textContent = String(
    views.filter((view) => view.remainingBlocks <= 200n).length,
  );
}

function render() {
  const views = api.votableViews();
  renderStats(views);
  renderFilters(views);

  const list = document.getElementById("voter-list");
  const filtered = applyFilter(views);
  const outOfWindow = api
    .allViews()
    .filter((view) => view.status === ProposalStatus.Open && view.voteExpired).length;
  document.getElementById("proposal-count").textContent = `(${filtered.length})`;
  document.getElementById("voter-footnote").textContent =
    outOfWindow > 0
      ? `${outOfWindow} proposal cell(s) are out of their voting window and hidden here: the initiator finalizes them next.`
      : "Outdated proposals are hidden: once the vote duration elapsed the cell is finalized by its initiator and disappears from this page.";

  if (!views.length) {
    list.replaceChildren(
      emptyState(
        "No proposal is inside its voting window",
        "New proposals appear here as soon as their proposal cell is created, and disappear when the vote duration elapses.",
      ),
    );
    return;
  }
  if (!filtered.length) {
    list.replaceChildren(
      emptyState("Nothing matches this filter", "Try another filter or clear the search field."),
    );
    return;
  }

  list.replaceChildren(...filtered.map(proposalCard));
  animateBars(list);
}

function emptyState(title, text) {
  const node = document.createElement("div");
  node.className = "empty";
  const iconWrap = document.createElement("div");
  iconWrap.className = "empty__icon";
  iconWrap.append(icon("vote", { size: 24 }));
  node.append(
    iconWrap,
    Object.assign(document.createElement("h3"), { textContent: title, style: "font-size:17px" }),
    Object.assign(document.createElement("p"), {
      className: "muted",
      textContent: text,
      style: "max-width:52ch;font-size:13.5px",
    }),
  );
  return node;
}

/* --------------------------------------------------------------------------
   Page init
   -------------------------------------------------------------------------- */

export function initVoter() {
  mountShell();

  document.getElementById("voter-block-badge").textContent = `block ${formatBlock(CHAIN.blockNumber)}`;

  const list = document.getElementById("voter-list");
  list.replaceChildren(skeleton());

  const config = CONFIG_CELL.data;
  if (config.emergentHalt === 1) {
    const indicator = document.getElementById("live-indicator");
    indicator.className = "badge badge--halt";
    indicator.lastChild.textContent = "voting is halted";
    document.querySelector("main").prepend(
      alert("no", "emergent_halt is 1 — every script fails, so no vote can be cast or counted."),
    );
  }

  document.getElementById("proposal-search").addEventListener(
    "input",
    (event) => {
      PAGE.query = event.target.value;
      render();
    },
  );

  for (const chip of document.querySelectorAll("#voter-filters .chip")) {
    chip.addEventListener("click", () => {
      PAGE.filter = chip.dataset.filter;
      for (const other of document.querySelectorAll("#voter-filters .chip")) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      render();
    });
  }

  subscribe(render);
  document.addEventListener("wallet:changed", render);

  // Proposals are "read" from the indexer; the delay shows the loading state.
  const refresh = async () => {
    await sleep(720);
    render();
  };
  void refresh();

  if (!getState().wallet) {
    list.prepend(
      alert(
        "accent",
        "Connect a wallet to vote: your CKB address becomes the voter lock script of the vote cell. You can read every proposal without connecting.",
        { iconName: "wallet" },
      ),
    );
  }
}
