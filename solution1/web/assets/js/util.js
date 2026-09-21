/**
 * Small shared helpers. No dependencies, no framework.
 */

/** Shannons in one CKB. */
export const CKB = 100000000n;

/** Assumed block interval of the UI requirements. */
export const BLOCK_SECONDS = 8;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Random lowercase hex of `bytes` bytes, prefixed with 0x. */
export function randomHex(bytes = 32) {
  const view = new Uint8Array(bytes);
  crypto.getRandomValues(view);
  return (
    "0x" +
    Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

/** Formats shannons as a CKB amount, trimming trailing zeros. */
export function formatCkb(shannons, maxDecimals = 2) {
  const value = typeof shannons === "bigint" ? shannons : BigInt(shannons);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / CKB;
  const frac = abs % CKB;
  let text = whole.toLocaleString("en-US");
  if (frac > 0n && maxDecimals > 0) {
    const decimals = frac
      .toString()
      .padStart(8, "0")
      .slice(0, maxDecimals)
      .replace(/0+$/, "");
    if (decimals) text += `.${decimals}`;
  }
  return (negative ? "-" : "") + text;
}

/** Formats shannons as a plain CKB number with 2 decimals (tables, deltas). */
export function formatCkb2(shannons) {
  return formatCkb(shannons, 2);
}

export function formatBlock(block) {
  return Number(block).toLocaleString("en-US");
}

/** Groups any integer-like value with thousands separators. */
export function formatInt(value) {
  return Number(value).toLocaleString("en-US");
}

/** `12,345` -> `1,234,567` style duration, used for the second estimate. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s === 0) return "now";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return parts.join(" ");
}

/** `0x1234…cdef` */
export function shorten(hex, head = 10, tail = 8) {
  const text = String(hex);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** Groups a long hash into readable 4 character chunks. */
export function chunkHash(hex, size = 4) {
  return String(hex).replace(new RegExp(`(.{${size}})`, "g"), "$1 ").trim();
}

export function formatTimestamp(ms) {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Shannons -> `12.3456789` CKB style text used in form hints. */
export function ckbToShannons(text) {
  const cleaned = String(text).trim().replace(/,/g, "");
  if (!/^\d*(\.\d{0,8})?$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    return null;
  }
  const [whole, frac = ""] = cleaned.split(".");
  return BigInt(whole || "0") * CKB + BigInt((frac + "00000000").slice(0, 8));
}

/** Percentage of `part` in `total`, clamped to 0..100. */
export function percent(part, total) {
  const p = typeof part === "bigint" ? part : BigInt(part);
  const t = typeof total === "bigint" ? total : BigInt(total);
  if (t <= 0n) return 0;
  return Math.min(100, Math.max(0, Number((p * 10000n) / t) / 100));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Copies text and briefly flags the triggering element. */
export async function copyText(text, trigger) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (trigger) {
    trigger.classList.add("is-copied");
    setTimeout(() => trigger.classList.remove("is-copied"), 1200);
  }
  return true;
}

/** Pins a `#hash` target below the sticky header. */
export function anchorScroll(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const top =
    target.getBoundingClientRect().top + window.scrollY - (68 + 14);
  window.scrollTo({ top, behavior: "smooth" });
}
