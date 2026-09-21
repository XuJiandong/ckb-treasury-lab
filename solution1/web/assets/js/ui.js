/**
 * Presentational helpers shared by the three pages: icons, toasts and the
 * small HTML fragments (hashes, badges, tallies, countdowns).
 */

import {
  BLOCK_SECONDS,
  copyText,
  formatBlock,
  formatCkb,
  formatDuration,
  percent,
  shorten,
} from "./util.js";

/* --------------------------------------------------------------------------
   Icons — a trimmed subset of Lucide (ISC), inlined so the mockup has no CDN.
   -------------------------------------------------------------------------- */

const ICONS = {
  "wallet": ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "arrow-right": ["M5 12h14", "m12 5 7 7-7 7"],
  "arrow-down": ["M12 5v14", "m19 12-7 7-7-7"],
  "arrow-up-right": ["M7 7h10v10", "M7 17 17 7"],
  "check": ["M20 6 9 17l-5-5"],
  "check-circle": ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "m22 4-10 10.01-3-3"],
  "x": ["M18 6 6 18", "m6 6 12 12"],
  "x-circle": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m15 9-6 6", "m9 9 6 6"],
  "alert-triangle": ["m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z", "M12 9v4", "M12 17h.01"],
  "info": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 16v-4", "M12 8h.01"],
  "clock": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"],
  "timer": ["M10 2h4", "M12 14v-4", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  "hourglass": ["M5 22h14", "M5 2h14", "M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22", "M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"],
  "blocks": ["M10.5 2 5 5.2v6.6l5.5 3.2 5.5-3.2V5.2L10.5 2Z", "m5 12.2-4.5 2.6v6.4l4.5 2.6 4.5-2.6v-6.4L5 12.2Z", "m20 12.2-4.5 2.6v6.4l4.5 2.6 4.5-2.6v-6.4L20 12.2Z"],
  "cube": ["M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12"],
  "file-text": ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v5h5", "M8 13h8", "M8 17h5"],
  "file-check": ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v5h5", "m9 15 2 2 4-4"],
  "send": ["M14.5 9.5 3 21", "M21 3l-6.5 18a.5.5 0 0 1-.9.1L9.5 14.5 3 10.4a.5.5 0 0 1 .1-.9L21 3Z"],
  "shield-check": ["M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z", "m9 12 2 2 4-4"],
  "shield": ["M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"],
  "lock": ["M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z", "M7 11V7a5 5 0 0 1 10 0v4"],
  "lock-open": ["M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z", "M7 11V7a5 5 0 0 1 9.9-1"],
  "key": ["m15.5 7.5 3 3L22 7l-3-3", "m2 22 5.5-5.5", "M11.4 13.6a5 5 0 1 0-3-3"],
  "user": ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  "users": ["M17 21v-2a4 4 0 0 0-3-3.87", "M9 21v-2a4 4 0 0 1 3-3.87", "M16 3.13a4 4 0 0 1 0 7.75", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
  "plus": ["M12 5v14", "M5 12h14"],
  "minus": ["M5 12h14"],
  "calculator": ["M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M8 6h8", "M8 10h.01", "M12 10h.01", "M16 10h.01", "M8 14h.01", "M12 14h.01", "M16 14h4", "M8 18h.01", "M12 18h.01"],
  "layers": ["m12 2 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  "trophy": ["M6 9H4.5a2.5 2.5 0 0 1 0-5H6", "M18 9h1.5a2.5 2.5 0 0 0 0-5H18", "M4 22h16", "M10 14.7V17c0 .6-.5 1-1 1.4-.9.6-1.5 1.6-1.5 2.6", "M14 14.7V17c0 .6.4 1 .9 1.4 1 .6 1.6 1.6 1.6 2.6", "M18 2H6v7a6 6 0 0 0 12 0V2Z"],
  "vote": ["m9 12 2 2 4-4", "M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"],
  "circle-check": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m9 12 2 2 4-4"],
  "circle-x": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m15 9-6 6", "m9 9 6 6"],
  "circle-dot": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  "circle-slash": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m4.9 4.9 14.2 14.2"],
  "triangle-alert": ["m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z", "M12 9v4", "M12 17h.01"],
  "pause": ["M10 4H6v16h4V4Z", "M18 4h-4v16h4V4Z"],
  "play": ["m6 3 14 9-14 9V3Z"],
  "pause-circle": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M10 15V9", "M14 15V9"],
  "scale": ["m16 16 3-8 3 8c-.9.6-1.9 1-3 1s-2.1-.4-3-1Z", "m2 16 3-8 3 8c-.9.6-1.9 1-3 1s-2.1-.4-3-1Z", "M7 21h10", "M12 3v18", "M3 7h18"],
  "gauge": ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
  "refresh": ["M3 12a9 9 0 0 1 15-6.7L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15 6.7L3 16", "M3 21v-5h5"],
  "rotate-ccw": ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
  "external-link": ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  "copy": ["M8 8m2 0h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"],
  "search": ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m21 21-4.3-4.3"],
  "settings": ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z"],
  "sliders": ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  "flag": ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z", "M4 22v-7"],
  "target": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  "trending-up": ["m22 7-8.5 8.5-5-5L2 17", "M16 7h6v6"],
  "trending-down": ["m22 17-8.5-8.5-5 5L2 7", "M16 17h6v-6"],
  "zap": ["M13 2 3 14h9l-1 8 10-12h-9l1-8Z"],
  "sparkles": ["m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z", "M5 19l.9 2.1L8 22l-2.1.9L5 25l-.9-2.1L2 22l2.1-.9L5 19Z"],
  "sun": ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"],
  "moon": ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"],
  "menu": ["M4 6h16", "M4 12h16", "M4 18h16"],
  "book": ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"],
  "git-compare": ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 8v8", "m9 11 3-3 3 3"],
};

const FILLED = new Set(["zap", "shield", "trophy", "vote", "play", "pause", "flag", "key"]);

/**
 * Builds an inline SVG icon.
 * @param {string} name key of `ICONS`
 * @param {{size?: number, class?: string, stroke?: number, filled?: boolean}} opts
 */
export function icon(name, opts = {}) {
  const paths = ICONS[name] ?? ICONS["circle-dot"];
  const size = opts.size ?? 18;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(opts.stroke ?? 1.7));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (opts.class) svg.setAttribute("class", opts.class);
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    if (opts.filled || FILLED.has(name)) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    }
    svg.append(path);
  }
  return svg;
}

/* --------------------------------------------------------------------------
   Fragment helpers
   -------------------------------------------------------------------------- */

/** A copyable hash / address. */
export function hashChip(value, { head = 12, tail = 8, label } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.title = `Copy ${value}`;
  const text = document.createElement("span");
  text.className = "hash";
  text.textContent = label ?? shorten(value, head, tail);
  button.append(text, icon("copy", { size: 13 }));
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copyText(value, button);
  });
  return button;
}

export function statusBadge(view) {
  const map = {
    0: { cls: "badge--open", text: "open · voting" },
    1: { cls: "badge--finalized", text: "finalized · challenge" },
    2: { cls: "badge--passed", text: "passed · grant ready" },
  };
  const info = map[view.status] ?? map[0];
  const badge = document.createElement("span");
  badge.className = `badge ${info.cls}`;
  badge.innerHTML = `<span class="badge__dot"></span>`;
  badge.append(document.createTextNode(info.text));
  return badge;
}

export function directionBadge(direction) {
  const yes = direction === 1;
  const badge = document.createElement("span");
  badge.className = `badge ${yes ? "badge--passed" : "badge--halt"}`;
  badge.innerHTML = `<span class="badge__dot"></span>`;
  badge.append(document.createTextNode(yes ? "YES" : "NO"));
  return badge;
}

export function metric({ label, value, unit, foot, tone }) {
  const node = document.createElement("div");
  node.className = `metric${tone ? ` metric--${tone}` : ""}`;
  node.append(
    Object.assign(document.createElement("div"), {
      className: "metric__label",
      textContent: label,
    }),
  );
  const valueRow = document.createElement("div");
  valueRow.className = "metric__value";
  valueRow.append(document.createTextNode(value));
  if (unit) {
    const u = document.createElement("span");
    u.className = "unit";
    u.textContent = unit;
    valueRow.append(u);
  }
  node.append(valueRow);
  if (foot) {
    node.append(
      Object.assign(document.createElement("div"), {
        className: "metric__foot",
        textContent: foot,
      }),
    );
  }
  return node;
}

export function kv(key, valueNode) {
  const row = document.createElement("div");
  row.className = "kv";
  const k = document.createElement("span");
  k.className = "kv__k";
  k.textContent = key;
  const v = document.createElement("span");
  v.className = "kv__v";
  if (valueNode instanceof Node) v.append(valueNode);
  else v.textContent = String(valueNode);
  row.append(k, v);
  return row;
}

export function configRow(key, value, { mono = false, wide = false, iconName } = {}) {
  const row = document.createElement("div");
  row.className = `configrow${wide ? " configrow--wide" : ""}`;
  const k = document.createElement("div");
  k.className = "configrow__k";
  k.textContent = key;
  if (iconName) k.prepend(icon(iconName, { size: 13 }));
  const v = document.createElement("div");
  v.className = `configrow__v${mono ? " mono" : ""}`;
  v.textContent = value;
  row.append(k, v);
  return row;
}

export function alert(kind, text, { iconName } = {}) {
  const node = document.createElement("div");
  node.className = `alert alert--${kind}`;
  const iconWrap = document.createElement("span");
  iconWrap.className = "alert__icon";
  iconWrap.append(
    icon(iconName ?? (kind === "accent" ? "info" : kind === "yes" ? "check-circle" : "alert-triangle"), { size: 16 }),
  );
  const body = document.createElement("div");
  body.textContent = text;
  node.append(iconWrap, body);
  return node;
}

/** A disabled row that marks a feature the design defers to a later version. */
export function futureRow(text) {
  const node = document.createElement("label");
  node.className = "futurerow";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.disabled = true;
  const body = document.createElement("span");
  body.className = "futurerow__text";
  body.textContent = text;
  const badge = document.createElement("span");
  badge.className = "badge futurerow__badge";
  badge.textContent = "future";
  node.append(box, body, badge);
  return node;
}

/** A tally bar: label, amount and the share of all votes. */
export function tallyBar({ label, amount, total, tone }) {
  const wrap = document.createElement("div");
  wrap.className = "tally__row";
  const head = document.createElement("div");
  head.className = "tally__head";
  const name = document.createElement("span");
  name.className = `tally__label tally__label--${tone}`;
  name.innerHTML = `<span class="dot"></span>`;
  name.append(document.createTextNode(label));
  const value = document.createElement("span");
  value.className = `tally__amount tally__amount--${tone}`;
  value.textContent = `${formatCkb(amount)} CKB`;
  value.title = `${amount} shannons`;
  head.append(name, value);
  const bar = document.createElement("div");
  bar.className = `bar bar--${tone}`;
  const fill = document.createElement("div");
  fill.className = "bar__fill";
  fill.dataset.width = String(percent(amount, total || 1n));
  bar.append(fill);
  wrap.append(head, bar);
  return wrap;
}

/**
 * A live countdown in blocks and estimated seconds.
 * @param {{blocks: bigint|number, syncedAt: number, done?: boolean, readyText?: string}} spec
 */
export function countdown({ blocks, syncedAt = Date.now(), done = false, readyText = "ready now" }) {
  const node = document.createElement("span");
  const totalBlocks = Math.max(0, Number(blocks));
  const clock = document.createElement("span");
  clock.className = "countdown__blocks";

  const render = () => {
    const elapsed = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));
    const remaining = totalBlocks - Math.floor(elapsed / BLOCK_SECONDS);
    if (done || remaining <= 0) {
      node.className = "countdown countdown--done";
      node.replaceChildren(icon("pause-circle", { size: 14 }));
      node.append(document.createTextNode(readyText));
      return false;
    }
    clock.textContent = `${formatBlock(remaining)} blocks`;
    const seconds = remaining * BLOCK_SECONDS;
    node.className = `countdown${remaining * BLOCK_SECONDS <= 3600 ? " countdown--warn" : ""}`;
    node.replaceChildren(icon("hourglass", { size: 14 }), clock);
    node.append(
      document.createTextNode(` · ~${formatDuration(seconds)} left`),
    );
    return true;
  };

  render();
  const timer = setInterval(() => {
    if (!render()) clearInterval(timer);
  }, 1000);

  const observer = new MutationObserver(() => {
    if (!node.isConnected) {
      clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return node;
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

function toastHost() {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

/**
 * Shows a toast.
 * @param {{title: string, message?: string, kind?: "info"|"success"|"error"|"warn", timeout?: number}} spec
 */
export function toast({ title, message, kind = "info", timeout = 5200 }) {
  const node = document.createElement("div");
  node.className = `toast toast--${kind}`;
  const iconWrap = document.createElement("div");
  iconWrap.className = "toast__icon";
  iconWrap.append(
    icon(
      kind === "success"
        ? "check-circle"
        : kind === "error"
          ? "x-circle"
          : kind === "warn"
            ? "triangle-alert"
            : "info",
      { size: 16 },
    ),
  );
  const body = document.createElement("div");
  body.append(
    Object.assign(document.createElement("div"), { className: "toast__title", textContent: title }),
  );
  if (message) {
    body.append(
      Object.assign(document.createElement("div"), { className: "toast__msg", textContent: message }),
    );
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost btn--icon toast__close";
  close.setAttribute("aria-label", "Dismiss");
  close.append(icon("x", { size: 14 }));
  const dismiss = () => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  };
  close.addEventListener("click", dismiss);
  node.append(iconWrap, body, close);
  toastHost().append(node);
  if (timeout > 0) setTimeout(dismiss, timeout);
  return node;
}

/* --------------------------------------------------------------------------
   Async button state
   -------------------------------------------------------------------------- */

/** Runs `task` with the button in a loading state and reports failures. */
export async function withBusy(button, task, { busyLabel } = {}) {
  if (!button || button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.replaceChildren(
    Object.assign(document.createElement("span"), { className: "spinner" }),
    document.createTextNode(busyLabel ?? "Working…"),
  );
  try {
    return await task();
  } catch (error) {
    toast({ kind: "error", title: "Transaction failed", message: error?.message ?? String(error) });
    return null;
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}
