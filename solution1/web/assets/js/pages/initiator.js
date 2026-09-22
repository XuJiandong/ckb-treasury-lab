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
import { actionBar, actionItem, buildKv, proposalCard } from "../proposal-card.js";
import { subscribe } from "../state.js";
import { alert, futureRow, icon, metric, toast, withBusy } from "../ui.js";
import { ckbToShannons, formatBlock, formatCkb, formatInt, shorten, sleep } from "../util.js";

const PAGE = { filter: "all" };

/* --------------------------------------------------------------------------
   Stats
   -------------------------------------------------------------------------- */

function renderStats(views) {
  const open = views.filter((view) => view.status === ProposalStatus.Open && !view.challenged);
  const finalized = views.filter((view) => view.status === ProposalStatus.Finalized && !view.challenged);
  const passed = views.filter((view) => view.status === ProposalStatus.Passed && !view.challenged);
  const bonded = views.reduce(
    (sum, view) => (view.challenged ? sum : sum + BigInt(view.bond)),
    0n,
  );

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
   Actions
   -------------------------------------------------------------------------- */

/** The operations an initiator can run on one cell, by its current status. */
function initiatorActions(view) {
  const items = [
    {
      label: "Can it pass?",
      icon: "gauge",
      action: "check",
      note: "dry run against yes_threshold",
      onClick: (button) => onCheck(view, button),
    },
  ];

  if (view.status === ProposalStatus.Open) {
    items.push(
      {
        label: "Count votes",
        icon: "calculator",
        className: "btn--primary",
        action: "count",
        note: "creates counting cells",
        disabled: !view.voteExpired,
        title: view.voteExpired ? undefined : `available in ${formatBlock(view.remainingBlocks)} blocks`,
        onClick: (button) => onCount(view, button),
      },
      {
        label: "Finalize",
        icon: "file-check",
        action: "finalize",
        note: view.thresholdReached
          ? "consumes proposal + counting cells"
          : `needs ${formatCkb(view.missingYes)} CKB more yes`,
        disabled: !view.voteExpired,
        title: view.voteExpired ? undefined : "wait for the vote duration to elapse",
        onClick: (button) => onFinalize(view, button),
      },
    );
    if (view.voteExpired && !view.thresholdReached) {
      items.push({
        label: "Recycle bond",
        icon: "rotate-ccw",
        className: "btn--ghost",
        action: "recycle",
        note: "the proposal did not reach the threshold",
        onClick: () => onRecycle(view),
      });
    }
  } else if (view.status === ProposalStatus.Finalized) {
    items.push(
      {
        label: "Pass",
        icon: "trophy",
        className: "btn--yes",
        action: "pass",
        note: "always-success lock → initiator lock",
        disabled: !view.challengeExpired,
        title: view.challengeExpired ? undefined : "wait for the challenge time to elapse",
        onClick: (button) => onPass(view, button),
      },
      {
        label: "Challenge info",
        icon: "shield",
        className: "btn--ghost",
        action: "challenge-info",
        note: "anyone may challenge with NO votes",
        onClick: () => onChallengeInfo(view),
      },
    );
  } else {
    items.push({
      label: "Claim grant",
      icon: "send",
      className: "btn--primary",
      action: "claim",
      note: "passed cell + treasury provider",
      onClick: (button) => onClaim(view, button),
    });
  }
  return items.map((spec) => actionItem(spec));
}

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

  list.replaceChildren(...filtered.map((view) => proposalCard(view, { actions: initiatorActions })));
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
