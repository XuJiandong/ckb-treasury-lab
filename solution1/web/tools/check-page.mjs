/**
 * Loads a page in headless Chrome, reports console errors and checks that the
 * expected elements rendered. Also used to grab screenshots.
 *
 * Usage:
 *   node tools/check-page.mjs <url> [--shot out.png] [--size 1440x1000]
 *                             [--scroll 1200] [--wait 3000] [--click SELECTOR]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args[0];
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const shot = flag("shot", null);
const [width, height] = flag("size", "1440x1000").split("x").map(Number);
const scroll = Number(flag("scroll", 0));
const wait = Number(flag("wait", 3000));
const click = flag("click", null);
const expect = flag("expect", null);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "check-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const problems = [];

try {
  let target;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(200);
  }
  if (!target) throw new Error("devtools never came up");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      problems.push(`JS exception: ${d.exception?.description ?? d.text} @ ${d.url}:${d.lineNumber + 1}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      problems.push(
        `console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`,
      );
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      problems.push(`log: ${msg.params.entry.text} (${msg.params.entry.url ?? ""})`);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1.5,
    mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(wait);

  if (click) {
    await send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(click)})?.click()`,
    });
    await sleep(1200);
  }

  if (expect) {
    const result = await send("Runtime.evaluate", {
      expression: `document.querySelectorAll(${JSON.stringify(expect)}).length`,
      returnByValue: true,
    });
    if (!result.result.value) problems.push(`expected elements not found: ${expect}`);
    else console.log(`ok: ${result.result.value} × ${expect}`);
  }

  if (scroll) {
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scroll})` });
    await sleep(700);
  }

  if (shot) {
    const image = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(shot, Buffer.from(image.data, "base64"));
    console.log(`shot: ${shot}`);
  }

  ws.close();
} catch (error) {
  problems.push(`harness: ${error.message}`);
} finally {
  chrome.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* Chrome may still be exiting; the temp profile is disposable */
  }
}

if (problems.length) {
  console.log("PROBLEMS:");
  for (const problem of problems) console.log(" -", problem);
  process.exitCode = 1;
} else {
  console.log("clean");
}
