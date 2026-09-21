/**
 * `For Proposal Initiator` page: the create form plus every proposal,
 * finalized and passed cell that belongs to the connected address, each with
 * the operation it currently allows.
 */

import * as api from "../api.js";
import { ProposalStatus } from "../api.js";
import { ask, receiptDialog } from "../dialogs.js";
import { animateBars, mountShell } from "../layout.js";
import { CHAIN, CONFIG_CELL, MOCK_BOND_BALANCE } from "../mock-data.js";
import { subscribe } from "../state.js";
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
import { ckbToShannons, el, formatBlock, formatCkb, formatInt, percent, shorten, sleep } from "../util.js";

const PAGE = { filter: "all" };

/* --------------------------------------------------------------------------
   Stats
   -------------------------------------------------------------------------- */

function renderStats(views) {
  const open = views.filter((view) => view.status === ProposalStatus.Open);
  const finalized = views.filter((view) => view.status === ProposalStatus.Finalized);
  const passed = views.filter((view) => view.status === ProposalStatus.Passed);
  const bonded = views.reduce((sum, view) => sum + BigInt(view.bond), 0n);

  document.getElementById("initiator-stats").replaceChildren(
    metric({
      label: "Proposal cells",
      value: String(open.length),
      foot: `${open.filter((view) => !view.voteExpired).length} still inside the voting window`,
      tone: "accent",
    }),
    metric({
      label: "Finalized",
      value: String(finalized.length),
      foot: "challenge phase running or elapsed",
      tone: "no",
    }),
    metric({
      label: "Passed",
      value: String(passed.length),
      foot: "grant can be claimed by the recipient",
      tone: "yes",
    }),
    metric({
      label: "Bonded in cells",
      value: formatCkb(bonded),
      unit: "CKB",
      foot: `available in wallet: ${formatCkb(MOCK_BOND_BALANCE)} CKB`,
    }),
  );
  document.getElementById("initiator-lock-badge").textContent = api.wallet()
    ? `lock ${shorten(api.wallet().lock.args, 12, 6)}`
    : "no wallet connected";
}

/* --------------------------------------------------------------------------
   Proposal card
   -------------------------------------------------------------------------- */

function stageStrip(view) {
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
      label: "passed",
      done: view.status === ProposalStatus.Passed,
      current: false,
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

function infoGrid(view) {
  const grid = document.createElement("div");
  grid.className = "proposal__meta";

  const rows = [];
  rows.push(buildKv("requested_amount", `${formatCkb(view.requestedAmount)} CKB`));

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

  rows.push(buildKv("origin_block_number", view.originBlockNumber ? formatBlock(view.originBlockNumber) : "0 · filled on finalize"));
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

function buildKv(key, value) {
  const row = document.createElement("div");
  row.className = "kv";
  row.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: key }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: value }),
  );
  return row;
}

/** The countdown a cell should show, depending on its status. */
function cellCountdown(view) {
  if (view.status === ProposalStatus.Open) {
    if (view.voteExpired) {
      return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: "vote duration elapsed · finalize now" });
    }
    return countdown({ blocks: view.remainingBlocks, syncedAt: view.syncedAt, readyText: "voting open" });
  }
  if (view.status === ProposalStatus.Finalized) {
    if (view.challengeExpired) {
      return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: "challenge time elapsed · pass now" });
    }
    return countdown({ blocks: view.challengeRemainingBlocks, syncedAt: view.syncedAt, readyText: "challenge over" });
  }
  return countdown({ blocks: 0, syncedAt: view.syncedAt, done: true, readyText: "passed · grant claimable" });
}

function actionBar(view) {
  const bar = document.createElement("div");
  bar.className = "proposal__actions";

  const add = (label, iconName, className, handler, { disabled = false, title, note, action } = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${className}`;
    if (action) button.dataset.action = action;
    button.append(icon(iconName, { size: 15 }), document.createTextNode(label));
    if (disabled) {
      button.disabled = true;
      if (title) button.title = title;
    } else {
      button.addEventListener("click", () => handler(button));
    }
    if (note) {
      const wrap = document.createElement("span");
      wrap.className = "stack";
      wrap.style.gap = "5px";
      wrap.append(
        button,
        el("span", { class: "dim", style: "font-size:11.5px", text: note }),
      );
      bar.append(wrap);
      return;
    }
    bar.append(button);
  };

  add("Can it pass?", "gauge", "", (button) => onCheck(view, button), {
    note: "dry run against yes_threshold",
    action: "check",
  });

  if (view.status === ProposalStatus.Open) {
    add("Count votes", "calculator", "btn--primary", (button) => onCount(view, button), {
      disabled: !view.voteExpired,
      title: view.voteExpired
        ? undefined
        : `available in ${formatBlock(view.remainingBlocks)} blocks`,
      note: "creates counting cells",
      action: "count",
    });
    add("Finalize", "file-check", "", (button) => onFinalize(view, button), {
      disabled: !view.voteExpired,
      title: view.voteExpired ? undefined : "wait for the vote duration to elapse",
      note: view.thresholdReached
        ? "consumes proposal + counting cells"
        : `needs ${formatCkb(view.missingYes)} CKB more yes`,
      action: "finalize",
    });
    if (view.voteExpired && !view.thresholdReached) {
      add("Recycle bond", "rotate-ccw", "btn--ghost", () => onRecycle(view), {
        note: "the proposal did not reach the threshold",
        action: "recycle",
      });
    }
  } else if (view.status === ProposalStatus.Finalized) {
    add("Pass", "trophy", "btn--yes", (button) => onPass(view, button), {
      disabled: !view.challengeExpired,
      title: view.challengeExpired ? undefined : "wait for the challenge time to elapse",
      note: "always-success lock → initiator lock",
      action: "pass",
    });
    add("Challenge info", "shield", "btn--ghost", () => onChallengeInfo(view), {
      note: "anyone may challenge with NO votes",
      action: "challenge-info",
    });
  } else {
    add("Claim grant", "send", "btn--primary", (button) => onClaim(view, button), {
      note: "passed cell + treasury provider",
      action: "claim",
    });
  }
  return bar;
}

function proposalCard(view) {
  const card = document.createElement("article");
  card.className = "card proposal";
  card.id = `cell-${view.id}`;

  const head = document.createElement("div");
  head.className = "proposal__head";
  const titleWrap = document.createElement("div");
  titleWrap.style.minWidth = "0";
  const badges = document.createElement("div");
  badges.className = "row row--wrap";
  badges.append(statusBadge(view));
  badges.append(
    Object.assign(document.createElement("span"), {
      className: "badge",
      textContent: view.status === ProposalStatus.Passed ? "grant ready" : `bond ${formatCkb(view.bond)} CKB`,
    }),
  );
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
  titleWrap.append(badges, title, idRow);

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
  tally.append(
    tallyBar({ label: "YES counted", amount: view.yes, total: view.total || 1n, tone: "yes" }),
    tallyBar({ label: "NO counted", amount: view.no, total: view.total || 1n, tone: "no" }),
  );
  const quorum = document.createElement("div");
  quorum.className = "quorum";
  const qHead = document.createElement("div");
  qHead.className = "quorum__head";
  qHead.append(
    Object.assign(document.createElement("span"), { textContent: "yes_threshold" }),
    Object.assign(document.createElement("span"), {
      className: `quorum__state quorum__state--${view.thresholdReached ? "ok" : "pending"}`,
      textContent: view.thresholdReached
        ? "reached"
        : `short by ${formatCkb(view.missingYes)} CKB`,
    }),
  );
  const qBar = document.createElement("div");
  qBar.className = "bar bar--threshold";
  const qFill = document.createElement("div");
  qFill.className = "bar__fill";
  qFill.dataset.width = String(percent(view.yes, view.threshold));
  qBar.append(qFill);
  quorum.append(qHead, qBar);
  tally.append(quorum);
  body.append(tally, infoGrid(view));

  const strip = stageStrip(view);
  const footer = document.createElement("div");
  footer.className = "row row--wrap";
  footer.append(cellCountdown(view));
  card.append(head, body, strip, footer, actionBar(view));
  return card;
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

async function onCheck(view, button) {
  await withBusy(
    button,
    async () => {
      const result = await api.precheck(view.id);
      await ask({
        title: result.passable ? "This proposal can pass" : "This proposal cannot pass yet",
        subtitle: "Pre-check: the initiator script is dry-run against the config cell",
        iconName: result.passable ? "check-circle" : "triangle-alert",
        tone: result.passable ? "success" : "warn",
        body: (() => {
          const wrap = document.createElement("div");
          wrap.className = "stack";
          wrap.append(
            alert(
              result.passable ? "yes" : "warn",
              result.passable
                ? "The counted YES votes already cover yes_threshold, so counting and finalizing are worth doing."
                : `Count again after more votes: ${formatCkb(result.missingYes)} CKB of YES votes are still missing.`,
            ),
          );
          const rows = document.createElement("div");
          rows.className = "stack";
          rows.append(
            buildKv("YES counted", `${formatCkb(result.yes)} CKB`),
            buildKv("NO counted", `${formatCkb(result.no)} CKB`),
            buildKv("yes_threshold", `${formatCkb(result.threshold)} CKB`),
            buildKv("vote cells seen", formatInt(result.countedVotes)),
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

async function onCount(view, button) {
  await withBusy(
    button,
    async () => {
      const result = await api.countVotes(view.id);
      toast({
        kind: "success",
        title: `${formatInt(result.countingCells)} counting cell${result.countingCells === 1 ? "" : "s"} generated`,
        message: `YES ${formatCkb(result.yes)} CKB · NO ${formatCkb(result.no)} CKB collected into hash chunks`,
      });
      await receiptDialog({
        title: `${formatInt(result.countingCells)} counting cell(s) generated`,
        subtitle: "Each cell covers one hash range and sums the vote cells inside it",
        rows: [
          ["Counting cells", formatInt(result.countingCells)],
          ["Hash ranges", result.chunks.map((c) => `[${c.start}, ${c.end}]`).join(" ")],
          ["Collected YES", `${formatCkb(result.yes)} CKB`],
          ["Collected NO", `${formatCkb(result.no)} CKB`],
          ["Lock", "initiator's lock script"],
        ],
        extra: futureRow(
          "Pick which counting cells to use — some may be unusable (dust attack filter)",
        ),
      });
      render();
    },
    { busyLabel: "Counting…" },
  );
}

async function onFinalize(view, button) {
  if (!view.thresholdReached) {
    toast({
      kind: "error",
      title: "Cannot finalize yet",
      message: `The script would fail: ${formatCkb(view.missingYes)} CKB of YES votes are missing.`,
    });
    return;
  }
  const ok = await ask({
    title: "Finalize this proposal?",
    subtitle: "Proposal cell + counting cells → finalized proposal cell",
    iconName: "file-check",
    tone: "warn",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "warn",
          "The output cell is locked by the always-success lock script, so anyone can challenge the result during the challenge phase.",
          { iconName: "shield" },
        ),
        buildKv("YES counted", `${formatCkb(view.yes)} CKB`),
        buildKv("Bond kept in the cell", `${formatCkb(view.bond)} CKB`),
      );
      return [wrap];
    })(),
    confirmLabel: "Finalize",
    confirmClass: "btn--danger",
  });
  if (!ok) return;
  await withBusy(
    button,
    async () => {
      await api.finalizeProposal(view.id);
      toast({
        kind: "success",
        title: "Proposal finalized",
        message: "The proposal cell and its counting cells were consumed.",
      });
      render();
    },
    { busyLabel: "Finalizing…" },
  );
}

async function onPass(view, button) {
  const ok = await ask({
    title: "Pass this proposal?",
    subtitle: "Finalized proposal cell → passed proposal cell",
    iconName: "trophy",
    tone: "success",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "yes",
          "The challenge time elapsed without a successful challenge, so the grant becomes claimable by the recipient.",
        ),
        buildKv("Status change", "finalized (1) → passed (2)"),
      );
      return [wrap];
    })(),
    confirmLabel: "Pass proposal",
  });
  if (!ok) return;
  await withBusy(
    button,
    async () => {
      await api.passProposal(view.id);
      toast({ kind: "success", title: "Proposal passed", message: "The grant can now be claimed." });
      render();
    },
    { busyLabel: "Passing…" },
  );
}

async function onClaim(view, button) {
  await withBusy(
    button,
    async () => {
      await sleep(900);
      await receiptDialog({
        title: "Grant claimed",
        subtitle: "Passed proposal cell + treasury provider → recipient cell",
        rows: [
          ["Granted", `${formatCkb(view.requestedAmount)} CKB`],
          ["Recipient lock hash", view.recipientLockHash],
          ["Proposal cell consumed", `${shorten(view.outPoint.txHash, 12, 6)}:${view.outPoint.index}`],
        ],
      });
    },
    { busyLabel: "Building…" },
  );
}

function onRecycle(view) {
  void ask({
    title: "Recycle this proposal?",
    subtitle: "The proposal cell is consumed and its bond returns to your wallet",
    iconName: "rotate-ccw",
    tone: "warn",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "warn",
          "The vote duration elapsed without reaching yes_threshold, so the proposal can never pass. Recycling frees the bond.",
          { iconName: "triangle-alert" },
        ),
        buildKv("Bond returned", `${formatCkb(view.bond)} CKB`),
        buildKv("Counting cells", "must be consumed as well"),
      );
      return [wrap];
    })(),
    confirmLabel: "Recycle",
    confirmClass: "btn--danger",
  });
}

function onChallengeInfo(view) {
  void ask({
    title: "This cell can be challenged",
    subtitle: "Anybody may collect NO votes and consume the finalized cell",
    iconName: "shield",
    body: (() => {
      const wrap = document.createElement("div");
      wrap.className = "stack";
      wrap.append(
        alert(
          "accent",
          "The finalized cell is locked by the always-success lock script: a challenger does not need the initiator's signature. If the challenge succeeds, the challenger takes the bond.",
        ),
        alert(
          "warn",
          "Veto lock script hash in the config cell can also stop this proposal before it passes.",
          { iconName: "lock" },
        ),
      );
      return [wrap];
    })(),
    confirmLabel: "Understood",
    cancelLabel: "Dismiss",
  });
}

/* --------------------------------------------------------------------------
   Create form
   -------------------------------------------------------------------------- */

function setupForm() {
  const form = document.getElementById("create-form");
  const description = document.getElementById("create-description");
  const amount = document.getElementById("create-amount");
  const recipient = document.getElementById("create-recipient");
  const preview = document.getElementById("create-preview");

  const showError = (id, message) => {
    const node = document.getElementById(id);
    node.textContent = message ?? "";
    node.classList.toggle("hidden", !message);
  };

  const previewRow = (key, value) =>
    buildKv(key, value);

  const renderPreview = () => {
    const shannons = ckbToShannons(amount.value);
    const bond = CONFIG_CELL.data.minimalProposalCapacity;
    preview.replaceChildren(
      previewRow("status", "0 · proposal (voting open)"),
      previewRow("total_yes", "0 CKB"),
      previewRow("origin_block_number", "0 · filled when finalized"),
      previewRow("description bytes", `${new TextEncoder().encode(description.value).length} bytes`),
      previewRow("requested_amount", shannons === null ? "—" : `${formatCkb(shannons)} CKB`),
      previewRow("cell lock", "your wallet lock script"),
      previewRow("bond / capacity", `${formatCkb(bond)} CKB`),
      previewRow("vote duration", `${formatInt(CONFIG_CELL.data.voteDuration)} blocks`),
    );
  };

  description.addEventListener("input", () => {
    document.getElementById("description-count").textContent = String(
      new TextEncoder().encode(description.value).length,
    );
    showError("description-error", null);
    renderPreview();
  });
  amount.addEventListener("input", () => {
    const shannons = ckbToShannons(amount.value);
    if (amount.value.trim() && shannons === null) {
      showError("amount-error", "Enter a CKB amount with at most 8 decimals.");
    } else {
      showError("amount-error", null);
    }
    renderPreview();
  });
  recipient.addEventListener("input", () => {
    showError("recipient-error", null);
    renderPreview();
  });

  document.getElementById("create-reset").addEventListener("click", () => {
    form.reset();
    document.getElementById("description-count").textContent = "0";
    for (const id of ["description-error", "amount-error", "recipient-error"]) showError(id, null);
    renderPreview();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const shannons = ckbToShannons(amount.value);
    let valid = true;

    if (description.value.trim().length < 12) {
      showError("description-error", "Describe the proposal in at least 12 characters.");
      valid = false;
    }
    if (shannons === null || shannons <= 0n) {
      showError("amount-error", "Enter the requested amount in CKB.");
      valid = false;
    } else if (shannons < CONFIG_CELL.data.minimalProposalCapacity) {
      showError(
        "amount-error",
        `The bond must at least cover minimal_proposal_capacity (${formatCkb(CONFIG_CELL.data.minimalProposalCapacity)} CKB).`,
      );
      valid = false;
    }
    if (recipient.value.trim().length < 8) {
      showError("recipient-error", "Paste a CKB address or a 20 byte lock hash.");
      valid = false;
    }
    if (!valid) return;

    const submit = document.getElementById("create-submit");
    await withBusy(
      submit,
      async () => {
        const proposal = await api.createProposal({
          description: description.value,
          requestedAmount: shannons,
          recipient: recipient.value.trim(),
        });
        toast({
          kind: "success",
          title: "Proposal cell created",
          message: `Voting is open for ${formatInt(CONFIG_CELL.data.voteDuration)} blocks.`,
        });
        form.reset();
        document.getElementById("description-count").textContent = "0";
        renderPreview();
        render();
        document
          .getElementById(`cell-${proposal.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      { busyLabel: "Signing…" },
    );
  });

  renderPreview();
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function render() {
  const views = api.initiatorViews();
  renderStats(views);

  document.getElementById("count-all").textContent = String(views.length);
  document.getElementById("count-open").textContent = String(
    views.filter((view) => view.status === ProposalStatus.Open).length,
  );
  document.getElementById("count-finalized").textContent = String(
    views.filter((view) => view.status === ProposalStatus.Finalized).length,
  );
  document.getElementById("count-passed").textContent = String(
    views.filter((view) => view.status === ProposalStatus.Passed).length,
  );

  const filtered =
    PAGE.filter === "all"
      ? views
      : views.filter((view) => String(view.status) === PAGE.filter);
  document.getElementById("initiator-count").textContent = `(${filtered.length})`;

  const list = document.getElementById("initiator-list");
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const iconWrap = document.createElement("div");
    iconWrap.className = "empty__icon";
    iconWrap.append(icon("layers", { size: 24 }));
    empty.append(
      iconWrap,
      Object.assign(document.createElement("h3"), { textContent: "No cell in this state", style: "font-size:17px" }),
      Object.assign(document.createElement("p"), {
        className: "muted",
        style: "max-width:52ch;font-size:13.5px",
        textContent: "Create a proposal above, or pick another status filter.",
      }),
    );
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...filtered.map(proposalCard));
  animateBars(list);
}

export function initInitiator() {
  mountShell();
  setupForm();

  document.getElementById("initiator-block-badge").textContent = `block ${formatBlock(CHAIN.blockNumber)}`;

  for (const chip of document.querySelectorAll("#initiator-filters .chip")) {
    chip.addEventListener("click", () => {
      PAGE.filter = chip.dataset.filter;
      for (const other of document.querySelectorAll("#initiator-filters .chip")) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      render();
    });
  }

  subscribe(render);
  document.addEventListener("wallet:changed", render);

  const sleeper = async () => {
    await sleep(650);
    render();
  };
  void sleeper();
  render();

  if (CONFIG_CELL.data.emergentHalt === 1) {
    document.querySelector("main").prepend(
      alert("no", "emergent_halt is 1: every operation below would be rejected by the scripts."),
    );
  }
}
