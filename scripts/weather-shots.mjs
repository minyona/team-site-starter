// Screenshots and layout checks for /weather/, served from dist/ after node build.mjs.
// Usage: PLAYWRIGHT=<path to playwright> node scripts/weather-shots.mjs [outDir]
// PLAYWRIGHT defaults to "playwright", so a local `npm i playwright` also works.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const { webkit, chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(join(root, "index.html"))) {
  console.error("dist/index.html is missing. Run node build.mjs first.");
  process.exit(1);
}
const out = process.argv[2] || "weather-shots";
mkdirSync(out, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const file = join(root, path);
  try {
    if (!statSync(file).isFile()) throw new Error();
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const LIVE = "/weather/?today=2026-10-24";
const SHOTS = [
  { name: "live", url: LIVE, state: "ready" },
  { name: "live-day-before", url: "/weather/?today=2026-10-23", state: "ready" },
  { name: "too-far", url: "/weather/?t=turkey-shootout-2026&today=2026-10-22", state: "tooFar" },
  { name: "alert", url: LIVE + "&mock=alert", state: "ready", alert: true },
  { name: "error", url: LIVE + "&mock=down", state: "error" }
];

const results = [];
async function shoot(browser, ctxOpts, label, shot, { fullPage = true, firstScreen = false } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !/fonts\.g/.test(m.location().url || "") && errors.push(m.text()));
  page.on("requestfailed", r => !/fonts\.g/.test(r.url()) && errors.push("request failed " + r.url()));
  await page.goto(base + shot.url, { waitUntil: "networkidle" });
  await page.waitForFunction(s => document.getElementById("app").dataset.state === s, shot.state, { timeout: 5000 });
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    alerts: document.querySelectorAll(".alerts .alert").length,
    wide: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && !el.closest(".tchips")).map(el => el.className || el.tagName).slice(0, 5)
  }));
  assert.deepEqual(errors, [], `${label} ${shot.name}: console errors`);
  assert.ok(m.scrollW <= m.clientW && !m.wide.length, `${label} ${shot.name}: horizontal overflow ${m.scrollW} > ${m.clientW} (${m.wide.join(", ")})`);
  assert.equal(m.alerts > 0, !!shot.alert, `${label} ${shot.name}: alert banner presence`);
  const file = join(out, `${label}-${shot.name}.png`);
  await page.screenshot({ path: file, fullPage });
  if (firstScreen) await page.screenshot({ path: join(out, `${label}-${shot.name}-first-screen.png`) });
  results.push(`${label} ${shot.name}: state=${shot.state} width=${m.clientW} scrollWidth=${m.scrollW} alerts=${m.alerts}`);
  await ctx.close();
}

const wk = await webkit.launch();
for (const s of SHOTS) await shoot(wk, { ...devices["iPhone 13"] }, "iphone13", s, { firstScreen: true });
for (const s of SHOTS) await shoot(wk, { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, "w320", s);
await wk.close();

const cr = await chromium.launch();
for (const s of SHOTS) await shoot(cr, { viewport: { width: 1440, height: 1000 } }, "w1440", s, { fullPage: false });

const ctx = await cr.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined });
const page = await ctx.newPage();
await page.goto(base + "/?today=2026-10-22#tournaments", { waitUntil: "networkidle" });
const link = page.locator("#t-lakeshore-invitational-2026 a", { hasText: "Weekend weather" });
assert.equal(await link.getAttribute("href"), "weather/?t=lakeshore-invitational-2026&today=2026-10-22", "team card links to the weather page");
assert.equal(await page.locator("#t-harvest-classic-2026 a", { hasText: "Weekend weather" }).count(), 0, "completed tournaments have no weather button");
await page.locator("#t-lakeshore-invitational-2026").screenshot({ path: join(out, "team-card-weather-button.png") });
await link.click();
await page.waitForFunction(() => document.getElementById("app")?.dataset.state === "ready");
results.push("team card button -> " + new URL(page.url()).search + " state=ready");
await cr.close();
server.close();
console.log(results.join("\n"));
