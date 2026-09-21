/**
 * The shell: sticky header, wallet indicator and footer. Rendered into every
 * page so the three files stay consistent.
 */

import * as api from "./api.js";
import { ask } from "./dialogs.js";
import { CONFIG_CELL } from "./mock-data.js";
import { getState, resetState, subscribe } from "./state.js";
import { icon, toast } from "./ui.js";
import { anchorScroll, copyText, formatCkb, shorten } from "./util.js";

const NAV = [
  { id: "welcome", href: "index.html", label: "Welcome" },
  { id: "voter", href: "voter.html", label: "For Voter" },
  { id: "initiator", href: "initiator.html", label: "For Proposal Initiator" },
];

const WALLETS = [
  { id: "joyid", name: "JoyID", meta: "Passkey wallet · no seed phrase", initial: "J", tone: "joy" },
  { id: "unisat", name: "UniSat", meta: "Browser extension", initial: "U", tone: "uni" },
  { id: "okx", name: "OKX Wallet", meta: "Browser extension", initial: "O", tone: "okx" },
  { id: "ccc", name: "CCC Signer", meta: "Any CKB wallet via CCC", initial: "C", tone: "ccc" },
];

function header() {
  const node = document.createElement("header");
  node.className = "shell-header";
  const inner = document.createElement("div");
  inner.className = "shell-header__inner";

  const brand = document.createElement("a");
  brand.className = "brand";
  brand.href = "index.html";
  const mark = document.createElement("span");
  mark.className = "brand__mark";
  mark.append(icon("vote", { size: 18 }));
  const name = document.createElement("span");
  name.className = "brand__name";
  name.textContent = "CKB Voting";
  const tag = document.createElement("span");
  tag.className = "brand__tag";
  tag.textContent = "Treasury grants";
  brand.append(mark, name, tag);

  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.setAttribute("aria-label", "Sections");
  const current = document.body.dataset.page;
  for (const item of NAV) {
    const link = document.createElement("a");
    link.className = "nav__link";
    link.href = item.href;
    link.textContent = item.label;
    if (item.id === current) link.setAttribute("aria-current", "page");
    nav.append(link);
  }

  const actions = document.createElement("div");
  actions.className = "header-actions";

  const net = document.createElement("span");
  net.className = "pill-net";
  net.title = `RPC ${CONFIG_CELL.data.emergentHalt ? "paused" : "connected"} · mock data`;
  const dot = document.createElement("span");
  dot.className = "badge__dot";
  dot.style.color = CONFIG_CELL.data.emergentHalt ? "var(--no)" : "var(--accent)";
  net.append(dot, document.createTextNode("devnet · mock"));

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn btn--ghost btn--icon";
  reset.title = "Reset demo data";
  reset.setAttribute("aria-label", "Reset demo data");
  reset.append(icon("rotate-ccw", { size: 15 }));
  reset.addEventListener("click", async () => {
    const ok = await ask({
      title: "Reset the demo data?",
      subtitle: "Reconnects nothing, restores the seeded proposals and votes",
      iconName: "rotate-ccw",
      tone: "warn",
      body: [
        Object.assign(document.createElement("p"), {
          textContent:
            "Every vote, proposal and wallet connection stored by this mockup is dropped.",
        }),
      ],
      confirmLabel: "Reset",
      confirmClass: "btn--danger",
    });
    if (!ok) return;
    resetState();
    toast({ kind: "info", title: "Demo data reset", message: "Seed proposals restored." });
    document.dispatchEvent(new CustomEvent("mock:reset"));
  });

  const wallet = document.createElement("div");
  wallet.className = "wallet-slot";

  actions.append(net, reset, wallet);

  inner.append(brand, nav, actions);
  node.append(inner);

  const renderWallet = () => {
    const connected = getState().wallet;
    wallet.replaceChildren();

    if (!connected) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--primary";
      button.append(icon("wallet", { size: 16 }), document.createTextNode("Connect Wallet"));
      button.addEventListener("click", () => document.dispatchEvent(new CustomEvent("wallet:connect")));
      wallet.append(button);
      return;
    }

    const details = document.createElement("details");
    details.className = "wallet-menu";
    const summary = document.createElement("summary");
    summary.className = "wallet-pill";
    const avatar = document.createElement("span");
    avatar.className = "wallet-pill__avatar";
    avatar.append(icon("user", { size: 14 }));
    const label = document.createElement("span");
    label.className = "wallet-pill__addr";
    label.textContent = shorten(connected.address, 14, 6);
    label.title = connected.address;
    summary.append(avatar, label, icon("chevron-down", { size: 14 }));

    const menu = document.createElement("div");
    menu.className = "wallet-menu__panel";

    const head = document.createElement("div");
    head.className = "wallet-menu__head";
    head.append(
      Object.assign(document.createElement("div"), { className: "label", textContent: "Connected CKB address" }),
    );
    const addr = document.createElement("button");
    addr.type = "button";
    addr.className = "copy wallet-menu__addr";
    addr.title = "Copy address";
    addr.append(
      Object.assign(document.createElement("span"), { className: "hash", textContent: shorten(connected.address, 20, 10) }),
      icon("copy", { size: 13 }),
    );
    addr.addEventListener("click", () => copyText(connected.address, addr));
    const lock = document.createElement("div");
    lock.className = "wallet-menu__lock";
    lock.append(
      Object.assign(document.createElement("span"), { className: "dim", textContent: "lock args " }),
      Object.assign(document.createElement("span"), { className: "hash", textContent: connected.lock.args }),
    );
    head.append(addr, lock);

    const power = document.createElement("div");
    power.className = "wallet-menu__power";
    power.append(
      Object.assign(document.createElement("span"), { className: "dim", textContent: "DAO voting power" }),
      Object.assign(document.createElement("strong"), {
        textContent: `${formatCkb(api.config.dao().votePower)} CKB`,
      }),
    );

    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.className = "btn btn--ghost btn--sm";
    disconnect.append(icon("lock-open", { size: 14 }), document.createTextNode("Disconnect"));
    disconnect.addEventListener("click", () => {
      api.disconnectWallet();
      details.open = false;
      toast({ kind: "info", title: "Wallet disconnected" });
    });

    menu.append(head, power, disconnect);
    details.append(summary, menu);
    wallet.append(details);
  };

  renderWallet();
  subscribe(renderWallet);
  document.addEventListener("mock:reset", renderWallet);
  document.addEventListener("wallet:changed", renderWallet);

  return node;
}

function footer() {
  const node = document.createElement("footer");
  node.className = "shell-footer";
  const inner = document.createElement("div");
  inner.className = "shell-footer__inner";

  const left = document.createElement("div");
  left.className = "row";
  left.append(
    Object.assign(document.createElement("span"), {
      textContent: "CKB Voting — static UI mockup, no wallet, node or transaction involved.",
    }),
  );

  const right = document.createElement("div");
  right.className = "row row--wrap";
  const legend = [
    ["initiator lock", "locktag--initiator"],
    ["voter lock", "locktag--voter"],
    ["always-success lock", "locktag--always"],
  ];
  for (const [label, tone] of legend) {
    const tag = document.createElement("span");
    tag.className = `locktag ${tone}`;
    tag.textContent = label;
    right.append(tag);
  }
  right.append(
    Object.assign(document.createElement("span"), { className: "dim", textContent: "8 s per block" }),
  );

  inner.append(left, right);
  node.append(inner);
  return node;
}

export function mountShell() {
  const headerSlot = document.querySelector("[data-shell='header']");
  const footerSlot = document.querySelector("[data-shell='footer']");
  headerSlot?.replaceWith(header());
  footerSlot?.replaceWith(footer());

  // Smooth scroll for in-page links.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href^='#']");
    if (!link) return;
    const id = link.getAttribute("href").slice(1);
    if (!id) return;
    event.preventDefault();
    anchorScroll(id);
  });

  // Animate progress bars once they are in the DOM.
  const bars = document.querySelectorAll(".bar__fill[data-width]");
  requestAnimationFrame(() => {
    for (const bar of bars) bar.style.width = `${bar.dataset.width}%`;
  });
}

/** Re-runs the bar animation after a list re-render. */
export function animateBars(root = document) {
  requestAnimationFrame(() => {
    for (const bar of root.querySelectorAll(".bar__fill[data-width]")) {
      bar.style.width = `${bar.dataset.width}%`;
    }
  });
}

export { WALLETS };
