/**
 * Promise based modals. Each helper builds a <dialog>, wires the footer
 * buttons and resolves with the user's answer.
 */

import { icon } from "./ui.js";

function shell({ title, subtitle, iconName, tone = "", wide = false, body, footer, onClose }) {
  const dialog = document.createElement("dialog");
  dialog.className = `modal${wide ? " modal--wide" : ""}`;

  const head = document.createElement("div");
  head.className = "modal__head";
  const iconWrap = document.createElement("div");
  iconWrap.className = `modal__icon${tone ? ` modal__icon--${tone}` : ""}`;
  iconWrap.append(icon(iconName, { size: 19 }));
  const titleWrap = document.createElement("div");
  titleWrap.append(
    Object.assign(document.createElement("h3"), { className: "modal__title", textContent: title }),
  );
  if (subtitle) {
    titleWrap.append(
      Object.assign(document.createElement("div"), { className: "modal__sub", textContent: subtitle }),
    );
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost btn--icon modal__close";
  close.setAttribute("aria-label", "Close");
  close.append(icon("x", { size: 15 }));
  head.append(iconWrap, titleWrap, close);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "modal__body";
  if (body) bodyWrap.append(...[].concat(body));

  const foot = document.createElement("div");
  foot.className = "modal__foot";
  if (footer) foot.append(...[].concat(footer));

  dialog.append(head, bodyWrap);
  if (footer) dialog.append(foot);
  document.body.append(dialog);

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    dialog.close();
    dialog.remove();
    onClose?.(value);
  };
  close.addEventListener("click", () => finish(null));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish(null);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) finish(null);
  });
  dialog.showModal();
  return { dialog, finish, bodyWrap, foot };
}

/** A promise based confirm/alert dialog builder. */
function ask({ title, subtitle, iconName = "info", tone = "", body, confirmLabel = "Confirm", confirmClass = "btn--primary", cancelLabel = "Cancel", wide, dismissable = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = cancelLabel;

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = `btn ${confirmClass}`;
    confirm.textContent = confirmLabel;

    const { finish } = shell({
      title,
      subtitle,
      iconName,
      tone,
      wide,
      body,
      footer: dismissable ? [cancel, confirm] : [confirm],
      onClose: (value) => settle(value),
    });

    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
  });
}

/** The wallet picker. Resolves with the wallet id, or null. */
export function connectWalletDialog(wallets) {
  return new Promise((resolve) => {
    const list = document.createElement("div");
    list.className = "walletlist";
    let chosen = null;
    let closeDialog = null;

    for (const wallet of wallets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "walletopt";
      const logo = document.createElement("span");
      logo.className = `walletopt__logo walletopt__logo--${wallet.tone}`;
      logo.textContent = wallet.initial;
      const text = document.createElement("span");
      text.className = "walletopt__text";
      text.append(
        Object.assign(document.createElement("span"), { className: "walletopt__name", textContent: wallet.name }),
        Object.assign(document.createElement("span"), { className: "walletopt__meta", textContent: wallet.meta }),
      );
      const go = document.createElement("span");
      go.className = "walletopt__go";
      go.append(icon("chevron-right", { size: 16 }));
      button.append(logo, text, go);
      button.addEventListener("click", () => {
        chosen = wallet.id;
        closeDialog?.(wallet.id);
      });
      list.append(button);
    }

    const hint = document.createElement("p");
    hint.className = "dim";
    hint.style.marginTop = "14px";
    hint.style.fontSize = "12.5px";
    hint.textContent =
      "Mockup only: no extension is contacted. The connected identity is the lock script of the demo address.";

    const { finish } = shell({
      title: "Connect a wallet",
      subtitle: "Pick the wallet that owns your DAO deposits",
      iconName: "wallet",
      body: [list, hint],
      onClose: (value) => resolve(value ?? chosen),
    });
    closeDialog = finish;
  });
}

/** Vote confirmation. Resolves with "yes" | "no" | null. */
export function voteDialog({ proposal, amountLabel, blockNumber, daoDeposits, future }) {
  const rows = document.createElement("div");
  rows.className = "stack";
  rows.append(
    kvRow("Proposal", proposal.description.slice(0, 74) + (proposal.description.length > 74 ? "…" : "")),
    kvRow("Voting with", `${amountLabel} CKB`),
    kvRow("DAO deposits used", `${daoDeposits} cells · spent in full`),
    kvRow("Current block", blockNumber.toLocaleString("en-US")),
  );
  if (future) rows.append(future);

  const note = document.createElement("p");
  note.className = "dim";
  note.style.fontSize = "12.5px";
  note.style.marginTop = "12px";
  note.textContent =
    "The deposit is locked until you withdraw the vote, which stays possible while the proposal is open.";

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn btn--yes";
    yes.append(icon("check", { size: 15 }), document.createTextNode("Vote YES"));
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn btn--no";
    no.append(icon("x", { size: 15 }), document.createTextNode("Vote NO"));

    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const { finish } = shell({
      title: "Cast your vote",
      subtitle: "One vote cell per proposal — you can withdraw it later",
      iconName: "vote",
      body: [rows, note],
      footer: [spacer, yes, no],
      onClose: (value) => settle(value),
    });

    yes.addEventListener("click", () => finish("yes"));
    no.addEventListener("click", () => finish("no"));
  });
}

function kvRow(key, value) {
  const row = document.createElement("div");
  row.className = "kv";
  row.style.padding = "9px 0";
  row.append(
    Object.assign(document.createElement("span"), { className: "kv__k", textContent: key }),
    Object.assign(document.createElement("span"), { className: "kv__v", textContent: value }),
  );
  return row;
}

/** A generic "this is a mockup" transaction receipt. */
export function receiptDialog({ title, subtitle, rows, extra, tone = "success", iconName = "check-circle" }) {
  const body = document.createElement("div");
  body.className = "stack";
  for (const row of rows) body.append(kvRow(row[0], row[1]));
  if (extra) body.append(extra);
  return ask({
    title,
    subtitle,
    iconName,
    tone,
    body,
    confirmLabel: "Done",
    cancelLabel: "Dismiss",
  });
}

export { ask, shell };
