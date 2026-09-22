/**
 * The proposal-cell card, shared by the `For Proposal Initiator` and
 * `For Challenger` pages.
 *
 * The card renders the cell payload (`ProposalCellData`), the tallies, the
 * stage strip, the countdown and whichever operations the page passes in as
 * `actions`, so the two pages show the same element with different buttons.
 */

import { ProposalStatus } from "./api.js";
import { countdown, hashChip, icon, statusBadge, tallyBar } from "./ui.js";
import { el, formatBlock, formatCkb, percent } from "./util.js";

/** A key/value row of `.kv` elements. */
export function buildKv(key, value) {
  const row = document.createElement("div");
  row.className = "kv";
  row.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: key }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: value }),
  );
  return row;
}

/** `created → voting → finalized → passed`, with the current stage highlighted. */
export function stageStrip(view) {
  const strip = document.createElement("div");
  strip.className = "timeline";
  const stages = [
    { label: "created", done: true, current: false },
    {
      label: "voting",
      done: view.voteExpired,
      current: view.status === ProposalStatus.Open && !view.voteExpired,
    },
    {
      label: "finalized",
      done: view.status !== ProposalStatus.Open,
      current: view.status === ProposalStatus.Finalized,
    },
    {
      label: "settled",
      done: view.status === ProposalStatus.Passed || view.challenged,
      current: view.status === ProposalStatus.Passed || view.challenged,
    },
  ];
  stages.forEach((stage, index) => {
    const node = document.createElement("span");
    node.className = `stage${stage.done ? " is-done" : ""}${stage.current ? " is-current" : ""}`;
    node.append(icon(stage.done ? "check" : "circle-dot", { size: 13 }));
    node.append(document.createTextNode(stage.label));
    strip.append(node);
    if (index < stages.length - 1) {
      const sep = document.createElement("span");
      sep.className = "stage__sep";
      sep.append(icon("chevron-right", { size: 13 }));
      strip.append(sep);
    }
  });
  return strip;
}

/** The `ProposalCellData` fields, as the initiator / challenger sees them. */
export function infoGrid(view) {
  const grid = document.createElement("div");
  grid.className = "proposal__meta";

  const rows = [buildKv("requested_amount", `${formatCkb(view.requestedAmount)} CKB`)];

  const recipient = document.createElement("div");
  recipient.className = "kv";
  recipient.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: "recipient_lock_hash" }),
  );
  const wrap = document.createElement("span");
  wrap.className = "kv__v";
  wrap.append(hashChip(view.recipientLockHash, { head: 10, tail: 6 }));
  recipient.append(wrap);
  rows.push(recipient);

  rows.push(
    buildKv(
      "origin_block_number",
      view.originBlockNumber ? formatBlock(view.originBlockNumber) : "0 · filled on finalize",
    ),
  );
  rows.push(buildKv("bond / capacity", `${formatCkb(view.bond)} CKB`));

  const cellId = document.createElement("div");
  cellId.className = "kv";
  cellId.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: "cell out point" }),
  );
  const outWrap = document.createElement("span");
  outWrap.className = "kv__v";
  outWrap.append(hashChip(`${view.outPoint.txHash}:${view.outPoint.index}`, { head: 12, tail: 6 }));
  cellId.append(outWrap);
  rows.push(cellId);

  grid.append(...rows);
  return grid;
}

/**
 * The countdown a cell should show, depending on its status.
 * `overrides` lets a page name the moment that matters to it.
 */
export function cellCountdown(view, overrides = {}) {
  const texts = {
    votingOpen: "voting open",
    voteElapsed: "vote duration elapsed · finalize now",
    challengeElapsed: "challenge time elapsed · pass now",
    challengeOver: "challenge over",
    passed: "passed · grant claimable",
    challenged: "challenged · bond paid out",
    ...overrides,
  };

  if (view.challenged) {
    return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: texts.challenged });
  }
  if (view.status === ProposalStatus.Open) {
    if (view.voteExpired) {
      return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: texts.voteElapsed });
    }
    return countdown({ blocks: view.remainingBlocks, syncedAt: view.syncedAt, readyText: texts.votingOpen });
  }
  if (view.status === ProposalStatus.Finalized) {
    if (view.challengeExpired) {
      return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: texts.challengeElapsed });
    }
    return countdown({
      blocks: view.challengeRemainingBlocks,
      syncedAt: view.syncedAt,
      readyText: texts.challengeOver,
    });
  }
  return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: texts.passed });
}

/** One `{ label, note?, action?, disabled?, title?, onClick }` entry of an action bar. */
export function actionItem(spec) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${spec.className ?? ""}`.trim();
  if (spec.action) button.dataset.action = spec.action;
  button.append(icon(spec.icon, { size: 15 }), document.createTextNode(spec.label));
  if (spec.disabled) {
    button.disabled = true;
    if (spec.title) button.title = spec.title;
  } else if (spec.onClick) {
    button.addEventListener("click", () => spec.onClick(button));
  }
  if (!spec.note) return button;

  const wrap = document.createElement("span");
  wrap.className = "stack";
  wrap.style.gap = "5px";
  wrap.append(button, el("span", { class: "dim", style: "font-size:11.5px", text: spec.note }));
  return wrap;
}

/** Renders a list of action items into the standard action bar. */
export function actionBar(items) {
  const bar = document.createElement("div");
  bar.className = "proposal__actions";
  bar.append(...items);
  return bar;
}

/**
 * Builds a proposal-cell card.
 *
 * @param {object} view `api.proposalView` result
 * @param {{
 *   idPrefix?: string,
 *   badges?: (view) => Node[]|null,
 *   tally?: (view, tally: HTMLElement) => void,
 *   actions?: (view) => Node[],
 *   countdownText?: Record<string, string>
 * }} [options]
 */
export function proposalCard(view, options = {}) {
  const { idPrefix = "cell", badges, tally: buildTally, actions, countdownText } = options;

  const card = document.createElement("article");
  card.className = "card proposal";
  card.id = `${idPrefix}-${view.id}`;

  const head = document.createElement("div");
  head.className = "proposal__head";
  const titleWrap = document.createElement("div");
  titleWrap.style.minWidth = "0";
  const badgeRow = document.createElement("div");
  badgeRow.className = "row row--wrap";
  badgeRow.append(...(badges?.(view) ?? [statusBadge(view), bondBadge(view)]));

  const title = document.createElement("h3");
  title.className = "proposal__title";
  title.style.marginTop = "10px";
  title.textContent = view.description;

  const idRow = document.createElement("div");
  idRow.className = "proposal__id";
  idRow.append(
    Object.assign(document.createElement("span"), { className: "dim", textContent: "type script args" }),
    hashChip(view.typeScript.args, { head: 14, tail: 8 }),
  );
  titleWrap.append(badgeRow, title, idRow);

  const amount = document.createElement("div");
  amount.className = "proposal__amount";
  amount.append(
    Object.assign(document.createElement("div"), { className: "label", textContent: "requested" }),
    Object.assign(document.createElement("div"), { className: "value-lg", textContent: formatCkb(view.requestedAmount) }),
    Object.assign(document.createElement("div"), { className: "unit", textContent: "CKB" }),
  );
  head.append(titleWrap, amount);

  const body = document.createElement("div");
  body.className = "proposal__body";
  const tally = document.createElement("div");
  tally.className = "tally";
  if (buildTally) {
    buildTally(view, tally);
  } else {
    tally.append(defaultTally(view));
  }
  body.append(tally, infoGrid(view));

  const footer = document.createElement("div");
  footer.className = "row row--wrap";
  footer.append(cellCountdown(view, countdownText));

  card.append(head, body, stageStrip(view), footer);
  if (actions) card.append(actionBar(actions(view)));
  return card;
}

/** `bond X CKB` / `grant ready` — the default companion badge. */
export function bondBadge(view) {
  return Object.assign(document.createElement("span"), {
    className: "badge",
    textContent: view.status === ProposalStatus.Passed ? "grant ready" : `bond ${formatCkb(view.bond)} CKB`,
  });
}

/** The default YES / NO tally with the `yes_threshold` progress underneath. */
export function defaultTally(view) {
  const frag = document.createDocumentFragment();
  frag.append(
    tallyBar({ label: "YES counted", amount: view.yes, total: view.total, tone: "yes" }),
    tallyBar({ label: "NO counted", amount: view.no, total: view.total, tone: "no" }),
    thresholdBlock(view.yes, view.threshold, "yes_threshold"),
  );
  return frag;
}

/** `label` + a state word and a progress bar towards `threshold`. */
export function thresholdBlock(amount, threshold, label, stateText) {
  const wrap = document.createElement("div");
  wrap.className = "quorum";
  const reached = amount >= threshold;
  const head = document.createElement("div");
  head.className = "quorum__head";
  head.append(Object.assign(document.createElement("span"), { textContent: label }));
  head.append(
    Object.assign(document.createElement("span"), {
      className: `quorum__state quorum__state--${reached ? "ok" : "pending"}`,
      textContent:
        stateText ??
        (reached ? "reached" : `short by ${formatCkb(threshold - amount)} CKB`),
    }),
  );
  const bar = document.createElement("div");
  bar.className = "bar bar--threshold";
  const fill = document.createElement("div");
  fill.className = "bar__fill";
  fill.dataset.width = String(percent(amount, threshold));
  bar.append(fill);
  wrap.append(head, bar);
  return wrap;
}
