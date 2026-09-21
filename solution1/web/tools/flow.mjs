/**
 * Drives a small interaction flow in headless Chrome and screenshots it.
 *
 * Usage:
 *   node tools/flow.mjs <url> '<json steps>' [size]
 *
 * Steps: {"click": "sel"} | {"wait": ms} | {"shot": "file.png"} |
 *        {"scroll": px} | {"eval": "js"} | {"fill": ["sel", "text"]}
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, stepsJson, sizeArg] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const [width, height] = (sizeArg ?? "1440x1000").split("x").map(Number);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "flow-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
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
      problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      problems.push(`log: ${msg.params.entry.text}`);
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
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1.5, mobile: false });
  await send("Page.navigate", { url });
  await sleep(2500);

  for (const step of steps) {
    if (step.wait) await sleep(step.wait);
    if (step.eval) {
      const out = await send("Runtime.evaluate", { expression: step.eval, returnByValue: true });
      console.log(`eval ${step.eval} ->`, JSON.stringify(out.result?.value));
    }
    if (step.click) {
      await send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(step.click)})?.click() ?? "missing"`,
      });
    }
    if (step.fill) {
      const [sel, text] = step.fill;
      await send("Runtime.evaluate", {
        expression: `(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return "missing"; n.value = ${JSON.stringify(text)}; n.dispatchEvent(new Event("input", { bubbles: true })); return "ok"; })()`,
      });
    }
    if (step.scroll) {
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${step.scroll})` });
    }
    if (step.shot) {
      await sleep(400);
      const image = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(step.shot, Buffer.from(image.data, "base64"));
      console.log(`shot: ${step.shot}`);
    }
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
