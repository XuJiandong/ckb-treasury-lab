/**
 * `For Challenger` page: every finalized proposal cell, plus the three
 * operations a challenger runs on one — check whether it can be challenged,
 * count its "NO" votes into counting cells, and challenge it to take the bond.
 *
 * The cell element itself comes from `proposal-card.js`, so this page renders
 * exactly what the `For Proposal Initiator` page renders.
 */

import * as api from "../api.js";
import { ProposalStatus } from "../api.js";
import { ask, receiptDialog } from "../dialogs.js";
import { animateBars, mountShell } from "../layout.js";
import { CHAIN, CONFIG_CELL } from "../mock-data.js";
import {
  actionItem,
  bondBadge,
  buildKv,
  proposalCard,
  thresholdBlock,
} from "../proposal-card.js";
import { subscribe } from "../state.js";
import { alert, futureRow, icon, metric, statusBadge, toast, withBusy } from "../ui.js";
import { formatBlock, formatCkb, formatInt, percent, shorten, sleep } from "../util.js";

const PAGE = { filter: "all" };

/* --------------------------------------------------------------------------
   Stats
   -------------------------------------------------------------------------- */

function renderStats(views) {
  const open = views.filter((view) => view.challengeOpen);
  const counted = views.filter((view) => view.noCountedCells > 0 && !view.challenged);
  const won = views.filter((view) => view.challenged);
  const reward = won.reduce((sum, view) => sum + view.reward, 0n);
  const nextDeadline = open.reduce(
    (min, view) =>
      min === null || view.challengeRemainingBlocks < min ? view.challengeRemainingBlocks : min,
    null,
  );

  document.getElementById("challenger-stats").replaceChildren(
    metric({
      label: "Challengeable cells",
      value: String(open.filter((view) => view.challengeMet).length),
      foot: `${open.length} finalized cell(s) still alive`,
      tone: "accent",
    }),
    metric({
      label: "NO counting cells",
      value: String(counted.reduce((sum, view) => sum + view.noCountedCells, 0)),
      foot: counted.length ? "certificates ready to consume" : "nothing counted yet",
    }),
    metric({
      label: "Reward in reach",
      value: formatCkb(open.reduce((sum, view) => sum + view.reward, 0n)),
      unit: "CKB",
      foot: nextDeadline === null ? "no cell left to challenge" : `next window ends in ${formatBlock(nextDeadline)} blocks`,
      tone: "no",
    }),
    metric({
      label: "Bonds won",
      value: formatCkb(reward),
      unit: "CKB",
      foot: won.length ? `${won.length} successful challenge(s)` : "no challenge settled yet",
      tone: "yes",
    }),
  );

  const indicator = document.getElementById("challenge-indicator");
  if (CONFIG_CELL.data.emergentHalt === 1) {
    indicator.className = "badge badge--halt";
    indicator.lastChild.textContent = "challenges are halted";
  }
}

/* --------------------------------------------------------------------------
   Card pieces
   -------------------------------------------------------------------------- */

function badges(view) {
  const nodes = [statusBadge(view), bondBadge(view)];
  if (view.challengeMet && !view.challenged) {
    nodes.push(
      Object.assign(document.createElement("span"), {
        className: "badge badge--challenged",
        textContent: "challenge can succeed",
      }),
    );
  }
  return nodes;
}

/**
 * The challenger's tally: certified NO weight against the YES weight the
 * proposal already recorded, which is the comparison the script makes.
 */
function tally(view, host) {
  const pairs = document.createElement("div");
  pairs.className = "challengepairs";
  const row = (label, value, tone) => {
    const line = document.createElement("div");
    line.className = "challengepairs__row";
    line.append(
      Object.assign(document.createElement("span"), { className: "dim", textContent: label }),
      Object.assign(document.createElement("span"), {
        className: `challengepairs__value challengepairs__value--${tone}`,
        textContent: `${formatCkb(value)} CKB`,
      }),
    );
    return line;
  };
  pairs.append(
    row("YES certified in the cell", view.yes, "yes"),
    row("NO votes visible", view.no, "no"),
    row("NO counted by you", view.noCounted, "no"),
    row("Required: total_yes", view.yes, "need"),
  );
  host.append(pairs);
  host.append(
    thresholdBlock(
      view.noCounted,
      view.yes,
      "total_no ≥ total_yes",
      view.noCounted >= view.yes
        ? `met · +${formatCkb(view.noCounted - view.yes)} CKB above`
        : `short by ${formatCkb(view.yes - view.noCounted)} CKB`,
    ),
  );
  host.append(
    Object.assign(document.createElement("div"), {
      className: "bar__legend",
      innerHTML: `<span>${percent(view.noCounted, view.yes).toFixed(1)}% of the YES weight certified</span><span>${formatInt(view.noCountedCells)} counting cell(s)</span>`,
    }),
  );
}

/** The reward cell the challenger receives when the challenge settles. */
function rewardCell(view) {
  const cell = view.challengerCell;
  const node = document.createElement("div");
  node.className = "challengecell";
  const iconWrap = document.createElement("span");
  iconWrap.className = "challengecell__icon";
  iconWrap.append(icon("trophy", { size: 17 }));
  const body = document.createElement("div");
  body.className = "challengecell__body";
  body.append(
    Object.assign(document.createElement("div"), {
      className: "challengecell__title",
      textContent: `Challenger cell · ${formatCkb(view.reward)} CKB`,
    }),
  );
  const meta = document.createElement("div");
  meta.className = "challengecell__meta";
  meta.append(
    Object.assign(document.createElement("span"), {
      textContent: `paid at block ${formatBlock(cell?.blockNumber ?? view.blockNumber)}`,
    }),
    Object.assign(document.createElement("span"), {
      textContent: `${formatCkb(cell?.countedNo ?? view.noCounted)} CKB NO certified`,
    }),
    Object.assign(document.createElement("span"), {
      textContent: `${formatInt(cell?.countingCells ?? view.noCountedCells)} counting cell(s) consumed`,
    }),
    Object.assign(document.createElement("span"), {
      textContent: `tx ${shorten(cell?.txHash ?? view.outPoint.txHash, 12, 6)}`,
    }),
  );
  body.append(meta);
  node.append(iconWrap, body);
  return node;
}

/** The operations a challenger can run, by the state of the finalized cell. */
function challengerActions(view) {
  if (view.challenged) {
    return [
      {
        label: "Reward paid",
        icon: "check-circle",
        className: "btn--ghost",
        action: "reward-paid",
        note: "the bond is already yours",
        disabled: true,
      },
    ].map((spec) => actionItem(spec));
  }

  return [
    {
      label: "Can it be challenged?",
      icon: "gauge",
      action: "check",
      note: "dry run against total_yes",
      onClick: (button) => onCheck(view, button),
    },
    {
      label: "Count NO votes",
      icon: "calculator",
      action: "count-no",
      note: view.noCountedCells
        ? `re-count · ${formatInt(view.noCountedCells)} cell(s) ready`
        : "one counting cell per lock script",
      disabled: !view.challengeOpen,
      title: view.challengeOpen ? undefined : "the challenge window already elapsed",
      onClick: (button) => onCountNo(view, button),
    },
    {
      label: "Challenge",
      icon: "sword",
      className: "btn--no",
      action: "challenge",
      note: view.challengeMet
        ? `takes the ${formatCkb(view.reward)} CKB bond`
        : `needs ${formatCkb(view.noMissing)} CKB more NO`,
      disabled: !view.challengeOpen || !view.challengeMet,
      title: view.challengeOpen
        ? view.challengeMet
          ? undefined
          : "ChallengeNotMet: certify at least as much NO as YES first"
        : "the challenge window already elapsed",
      onClick: (button) => onChallenge(view, button),
    },
  ].map((spec) => actionItem(spec));
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

async function onCheck(view, button) {
  await withBusy(
    button,
    async () => {
      const result = await api.challengeCheck(view.id);
      await ask({
        title: result.challengeable
          ? "This finalized cell can be challenged"
          : "Not enough NO weight yet",
        subtitle: "Pre-check: the proposal script settles when total_no ≥ total_yes",
        iconName: result.challengeable ? "shield-check" : "triangle-alert",
        tone: result.challengeable ? "success" : "warn",
        body: (() => {
          const wrap = document.createElement("div");
          wrap.className = "stack";
          wrap.append(
            alert(
              result.challengeable ? "yes" : "warn",
              result.challengeable
                ? `Collect ${formatCkb(result.availableNo)} CKB of NO votes into counting cells: the challenge already outweighs the ${formatCkb(result.yes)} CKB of YES votes.`
                : `The NO votes this challenger can see are ${formatCkb(result.missingNo)} CKB short of the ${formatCkb(result.yes)} CKB YES weight. Count again once more NO votes exist.`,
            ),
          );
          const rows = document.createElement("div");
          rows.className = "stack";
          rows.append(
            buildKv("YES certified in the cell", `${formatCkb(result.yes)} CKB`),
            buildKv("NO votes visible", `${formatCkb(result.availableNo)} CKB`),
            buildKv("NO already counted", `${formatCkb(result.countedNo)} CKB`),
            buildKv("NO vote cells / distinct locks", `${formatInt(result.noVoteCells)} / ${formatInt(result.distinctLocks)}`),
            buildKv("Reward on success", `${formatCkb(result.reward)} CKB`),
          );
          wrap.append(rows);
          return [wrap];
        })(),
        confirmLabel: "Close",
        cancelLabel: "Dismiss",
      });
    },
    { busyLabel: "Checking…" },
  );
}

async function onCountNo(view, button) {
  await withBusy(
    button,
    async () => {
      const result = await api.countNoVotes(view.id);
      toast({
        kind: result.met ? "success" : "warn",
        title: `${formatInt(result.countingCells)} NO counting cell(s) generated`,
        message: result.met
          ? `${formatCkb(result.countedNo)} CKB certified — the challenge can settle now.`
          : `${formatCkb(result.countedNo)} CKB certified against ${formatCkb(result.yes)} CKB of YES votes.`,
      });
      await receiptDialog({
        title: `${formatInt(result.countingCells)} NO counting cell(s) generated`,
        subtitle: "One cell per lock script, each covering a hash range of its own",
        tone: result.met ? "success" : "warn",
        iconName: result.met ? "check-circle" : "calculator",
        rows: [
          ["Direction", "0 · NO"],
          ["Counting cells", formatInt(result.countingCells)],
          ["Hash ranges", result.ranges.map((c) => `[${c.start}, ${c.end}]`).join(" ")],
          ["Certified NO", `${formatCkb(result.countedNo)} CKB`],
          ["YES to outweigh", `${formatCkb(result.yes)} CKB`],
          ["Result", result.met ? "total_no ≥ total_yes" : "still short"],
          ["Lock", "your wallet lock script"],
        ],
        extra: futureRow(
          "Pick which NO counting cells to consume — unusable or overlapping ranges can be left out",
        ),
      });
      render();
    },
    { busyLabel: "Counting…" },
  );
}

async function onChallenge(view, button) {
  const ok = await ask({
    title: "Challenge this proposal?",
    subtitle: "NO counting cells + finalized proposal cell → your challenger cell",
    iconName: "sword",
    tone: "no",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "no",
          `Certifying ${formatCkb(view.noCounted)} CKB of NO votes against ${formatCkb(view.yes)} CKB of YES votes settles the proposal: it can never be passed, and the bond is yours.`,
          { iconName: "shield" },
        ),
        buildKv("Counting cells consumed", formatInt(view.noCountedCells)),
        buildKv("Reward (bond of the cell)", `${formatCkb(view.reward)} CKB`),
        buildKv(
          "Reward lock",
          api.wallet() ? shorten(api.wallet().lock.args, 12, 6) : "connect a wallet",
        ),
      );
      return [wrap];
    })(),
    confirmLabel: "Challenge",
    confirmClass: "btn--danger",
  });
  if (!ok) return;

  await withBusy(
    button,
    async () => {
      const cell = await api.challenge(view.id);
      toast({
        kind: "success",
        title: "Proposal challenged",
        message: `${formatCkb(cell.capacity)} CKB bond paid to your lock script.`,
      });
      await receiptDialog({
        title: "Challenge settled",
        subtitle: "The proposal cell and its NO counting cells were consumed",
        tone: "success",
        iconName: "trophy",
        rows: [
          ["Proposal", view.description.slice(0, 52) + "…"],
          ["NO certified", `${formatCkb(cell.countedNo)} CKB`],
          ["Counting cells consumed", formatInt(cell.countingCells)],
          ["Challenger cell", `${formatCkb(cell.capacity)} CKB`],
          ["Out point", `${shorten(cell.txHash, 14, 8)}:${cell.index}`],
          ["Settled at block", formatBlock(cell.blockNumber)],
        ],
      });
      render();
    },
    { busyLabel: "Challenging…" },
  );
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function applyFilter(views) {
  switch (PAGE.filter) {
    case "challengeable":
      return views.filter((view) => view.challengeOpen && view.challengeMet && !view.challenged);
    case "counted":
      return views.filter((view) => view.noCountedCells > 0 && !view.challenged);
    case "won":
      return views.filter((view) => view.challenged);
    default:
      return views;
  }
}

function render() {
  const views = api.challengerView();
  renderStats(views);

  document.getElementById("count-all").textContent = String(views.length);
  document.getElementById("count-challengeable").textContent = String(
    views.filter((view) => view.challengeOpen && view.challengeMet && !view.challenged).length,
  );
  document.getElementById("count-counted").textContent = String(
    views.filter((view) => view.noCountedCells > 0 && !view.challenged).length,
  );
  document.getElementById("count-won").textContent = String(
    views.filter((view) => view.challenged).length,
  );

  const filtered = applyFilter(views);
  document.getElementById("challenger-count").textContent = `(${filtered.length})`;

  const list = document.getElementById("challenger-list");
  if (!filtered.length) {
    list.replaceChildren(emptyState(views.length));
    return;
  }

  list.replaceChildren(
    ...filtered.map((view) =>
      proposalCard(view, {
        idPrefix: "challenge",
        badges,
        tally,
        actions: challengerActions,
        countdownText: {
          challengeElapsed: "challenge window closed · the initiator can pass it",
          challengeOver: "challenge window open",
        },
      }),
    ),
  );

  // The challenger's own reward cell follows the card it belongs to.
  for (const view of filtered) {
    if (!view.challenged || !view.challengerCell) continue;
    const card = document.getElementById(`challenge-${view.id}`);
    card?.querySelector(".proposal__actions")?.before(rewardCell(view));
  }
  animateBars(list);
}

function emptyState(total) {
  const node = document.createElement("div");
  node.className = "empty";
  const iconWrap = document.createElement("div");
  iconWrap.className = "empty__icon";
  iconWrap.append(icon("shield", { size: 24 }));
  node.append(
    iconWrap,
    Object.assign(document.createElement("h3"), {
      textContent: total ? "Nothing matches this filter" : "No finalized proposal cell",
      style: "font-size:17px",
    }),
    Object.assign(document.createElement("p"), {
      className: "muted",
      style: "max-width:54ch;font-size:13.5px",
      textContent: total
        ? "Switch back to “All finalized” to see every cell under challenge."
        : "A finalized proposal cell appears here as soon as its initiator finalizes a proposal that passed yes_threshold.",
    }),
  );
  return node;
}

export function initChallenger() {
  mountShell();

  document.getElementById("challenger-block-badge").textContent = `block ${formatBlock(CHAIN.blockNumber)}`;

  const list = document.getElementById("challenger-list");
  const skeleton = document.createElement("div");
  skeleton.className = "loading-block";
  skeleton.append(
    Object.assign(document.createElement("span"), { className: "spinner" }),
    Object.assign(document.createElement("span"), { textContent: "Scanning finalized proposal cells…" }),
  );
  list.replaceChildren(skeleton);

  for (const chip of document.querySelectorAll("#challenger-filters .chip")) {
    chip.addEventListener("click", () => {
      PAGE.filter = chip.dataset.filter;
      for (const other of document.querySelectorAll("#challenger-filters .chip")) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      render();
    });
  }

  subscribe(render);
  document.addEventListener("wallet:changed", render);

  const load = async () => {
    await sleep(700);
    render();
  };
  void load();
}
