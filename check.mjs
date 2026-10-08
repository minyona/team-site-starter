import fs from "node:fs";
import path from "node:path";
import { containsForbiddenToken, denylistHashes, FORBIDDEN_WORD_SHA256, privacyOf, scanTeam, sourceSecrets } from "./lib/privacy.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const online = args.includes("--online");
const fixtureAt = args.indexOf("--fixture");
const fixture = fixtureAt >= 0 ? args[fixtureAt + 1] : null;

let denyHashes = new Set();

function loadDeny(files) {
  denyHashes = new Set(FORBIDDEN_WORD_SHA256.map((h) => h.toLowerCase()));
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    for (const hash of denylistHashes(fs.readFileSync(file, "utf8"))) denyHashes.add(hash);
  }
}

const results = [];
const pass = (msg) => results.push({ status: "PASS", msg });
const fail = (msg) => results.push({ status: "FAIL", msg });
const skip = (msg) => results.push({ status: "SKIP", msg });

const TEXT_EXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".txt", ".webmanifest", ".svg", ".md"]);
const PHONE = /\b(?:\d{3}[-.]\d{3}[-.]\d{4}|\(\d{3}\)\s*\d{3}[-.]\d{4}|\d{3}-\d{4})\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_KEYS = new Set(["url", "website", "bookingUrl", "infoUrl", "fieldMap", "logo", "headerPhoto", "sidelineCreditUrl", "src", "start_url"]);

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }
  return out;
}

function readText(file) {
  if (!TEXT_EXT.has(path.extname(file).toLowerCase()) && path.basename(file) !== "_headers") return null;
  return fs.readFileSync(file, "utf8");
}

function scanText(file, text) {
  const rel = path.relative(root, file);
  if (containsForbiddenToken(text, denyHashes)) fail(`${rel}: contains a forbidden source-project name`);
  for (const phone of text.match(PHONE) || []) {
    if (!/^555-01\d{2}$/.test(phone)) fail(`${rel}: phone ${phone} is not 555-01xx`);
  }
  for (const email of text.match(EMAIL) || []) {
    if (!email.toLowerCase().endsWith("@example.com")) fail(`${rel}: email ${email} must end in @example.com`);
  }
}

function scanJsonPlayers(file, data, published) {
  const rel = path.relative(root, file);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (Array.isArray(node.roster)) {
      for (const finding of scanTeam(node, rel, { published })) fail(`${finding.path}: ${finding.reason}`);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(data);
}

function extractTeam(html) {
  const marker = "window.SIDELINE_TEAM";
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let quote = "";
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); }
        catch { return { __parseError: true }; }
      }
    }
  }
  return { __parseError: true };
}

function collectUrls(node, out) {
  if (Array.isArray(node)) { node.forEach((item) => collectUrls(item, out)); return; }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && URL_KEYS.has(key)) out.push(value);
    else if (value && typeof value === "object") collectUrls(value, out);
  }
}

function classify(ref) {
  if (!ref || ref.startsWith("#") || ref.startsWith("data:") || ref.startsWith("javascript:")) return "skip";
  if (ref.startsWith("mailto:")) return "mailto";
  if (ref.startsWith("tel:")) return "tel";
  if (/^https?:\/\//i.test(ref)) return "external";
  return "internal";
}

async function headOk(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function checkLinks(distDir, files, extra) {
  const seen = new Set();
  const refs = [];
  const add = (base, ref) => {
    const key = `${base} ${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ base, ref });
  };
  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    const ext = path.extname(file).toLowerCase();
    if (ext === ".html" || ext === ".svg") {
      for (const match of text.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/gi)) add(file, match[1]);
    }
    if (ext === ".css") {
      for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) add(file, match[2]);
    }
  }
  for (const ref of extra) add(path.join(distDir, "index.html"), ref);

  const external = [];
  for (const { base, ref } of refs) {
    const kind = classify(ref);
    const where = `${path.relative(root, base)} → ${ref}`;
    if (kind === "skip") continue;
    if (kind === "mailto") {
      if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(ref)) pass(`mailto ${ref}`);
      else fail(`${where}: malformed mailto link`);
      continue;
    }
    if (kind === "tel") {
      if (/^tel:\+?[0-9]+$/.test(ref)) pass(`tel ${ref}`);
      else fail(`${where}: malformed tel link`);
      continue;
    }
    if (kind === "external") {
      try {
        const u = new URL(ref);
        if (u.protocol !== "http:" && u.protocol !== "https:") fail(`${where}: unsupported URL`);
        else { pass(`external ${ref}`); external.push(ref); }
      } catch {
        fail(`${where}: malformed URL`);
      }
      continue;
    }
    const clean = ref.split("#")[0].split("?")[0];
    if (!clean) { pass(`anchor ${ref}`); continue; }
    const abs = clean.startsWith("/")
      ? path.join(distDir, clean)
      : path.resolve(path.dirname(base), clean);
    const rel = path.relative(distDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) fail(`${where}: resolves outside dist/`);
    else if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) fail(`${where}: missing file`);
    else pass(`asset ${ref}`);
  }
  return external;
}

function tabIds(appJs) {
  const body = appJs.match(/const TABS = \{([\s\S]*?)\n\};/);
  if (!body) return null;
  return new Set([...body[1].matchAll(/^\s{2}([A-Za-z]+):\s*\{/gm)].map((m) => m[1]));
}

async function browserChecks(distDir, tabs) {
  let playwright;
  try { playwright = await import("playwright"); }
  catch { playwright = null; }
  if (!playwright) {
    skip("browser checks, Playwright is not installed. Skipped opening each enabled tab, and horizontal overflow at 320, 375, 390, 768, and 1024. Static HTML checks still ran.");
    return;
  }
  const widths = [320, 375, 390, 768, 1024];
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    skip(`browser checks, Playwright is installed but Chromium did not launch (${err.message}). Skipped opening each enabled tab, and horizontal overflow at 320, 375, 390, 768, and 1024.`);
    return;
  }
  const server = await import("node:http");
  const http = server.default || server;
  const site = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.join(distDir, url === "/" ? "index.html" : url);
    if (!file.startsWith(distDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const port = site.address().port;
  try {
    const page = await browser.newPage();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
      for (const id of tabs) {
        await page.click(`.tab[data-view="${id}"]`);
        const open = await page.evaluate((tab) => {
          const view = document.getElementById("view-" + tab);
          return document.body.dataset.view === tab && !!view && view.classList.contains("active") && view.textContent.trim().length > 0;
        }, id);
        if (open) pass(`tab ${id} opens at ${width}px`);
        else fail(`tab ${id} did not open at ${width}px`);
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return doc.scrollWidth > doc.clientWidth + 1 || document.body.scrollWidth > doc.clientWidth + 1;
        });
        if (overflow) fail(`horizontal overflow at ${width}px on tab ${id}`);
        else pass(`no horizontal overflow at ${width}px on tab ${id}`);
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => site.close(resolve));
  }
}

function scanTree(dir, { published, label }) {
  if (!fs.existsSync(dir)) {
    fail(`${label} is missing`);
    return;
  }
  for (const file of walkFiles(dir)) {
    const text = readText(file);
    if (text == null) continue;
    scanText(file, text);
    if (path.extname(file) === ".json" || path.basename(file) === "team.json") {
      try { scanJsonPlayers(file, JSON.parse(text), published); }
      catch (err) { fail(`${path.relative(root, file)}: ${err.message}`); }
    }
  }
}

async function main() {
  if (fixture) {
    const dir = path.resolve(root, fixture);
    loadDeny([path.join(root, ".sideline-denylist"), path.join(dir, ".sideline-denylist")]);
    console.log(`Sideline check (fixture ${fixture})`);
    scanTree(dir, { published: true, label: fixture });
  } else {
    loadDeny([path.join(root, ".sideline-denylist")]);
    console.log("Sideline check");
    const distDir = path.join(root, "dist");
    const srcDir = path.join(root, "src");
    const indexPath = path.join(distDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      fail("dist/index.html is missing. Run node build.mjs first.");
    } else {
      const html = fs.readFileSync(indexPath, "utf8");
      if (fs.existsSync(path.join(distDir, "team.json"))) fail("dist/team.json must not be shipped");
      else pass("raw team.json is not in dist/");

      const shipped = extractTeam(html);
      if (!shipped) fail("dist/index.html has no window.SIDELINE_TEAM hook");
      else if (shipped.__parseError) fail("window.SIDELINE_TEAM is not valid JSON");
      else {
        pass("window.SIDELINE_TEAM is injected");
        const srcTeam = JSON.parse(fs.readFileSync(path.join(srcDir, "team.json"), "utf8"));
        const flags = privacyOf(srcTeam);
        for (const finding of scanTeam(shipped, "dist/index.html", { published: true })) {
          fail(`${finding.path}: ${finding.reason}`);
        }
        if ((shipped.footer || {}).sidelineCreditUrl === (srcTeam.footer || {}).sidelineCreditUrl) {
          pass("footer.sidelineCreditUrl comes from team.json");
        } else fail("footer.sidelineCreditUrl was not copied from team.json");

        const secrets = sourceSecrets(srcTeam);
        const blob = walkFiles(distDir).map(readText).filter(Boolean).join("\n");
        for (const name of secrets.names) {
          const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
          if (re.test(blob)) fail(`dist/ still contains the full last name ${name}`);
        }
        for (const contact of secrets.contacts) {
          if (blob.includes(contact)) fail(`dist/ still contains guardian contact ${contact}`);
        }
        if (!secrets.names.some((name) => new RegExp(`\\b${name}\\b`).test(blob)) && secrets.names.length) {
          pass("shipped pages have no full player last names");
        }
        if (!secrets.contacts.some((c) => blob.includes(c)) && secrets.contacts.length) {
          pass("shipped pages have no guardian contacts");
        }

        const enabled = (shipped.tabs || []).filter((t) => t.enabled !== false).map((t) => t.id);
        const appJs = fs.readFileSync(path.join(distDir, "app.js"), "utf8");
        const renderers = tabIds(appJs);
        if (!renderers) fail("dist/app.js has no TABS registry");
        else {
          for (const id of enabled) {
            if (renderers.has(id) && appJs.includes("TABS[x.id].render")) pass(`enabled tab ${id} has a renderer`);
            else fail(`enabled tab ${id} has no renderer`);
          }
        }
        if (!html.includes('id="tabbar"') || !html.includes('id="main"')) fail("dist/index.html is missing the tab shell");
        else pass("tab shell is present");

        if (flags.hideFromSearch) {
          if (/name="robots"[^>]*content="noindex,\s*nofollow"|content="noindex,\s*nofollow"[^>]*name="robots"/i.test(html)) {
            pass("meta robots is noindex, nofollow");
          } else fail("meta robots tag is not noindex, nofollow");
          const robots = fs.readFileSync(path.join(distDir, "robots.txt"), "utf8");
          if (/Disallow:\s*\//.test(robots)) pass("robots.txt disallows /");
          else fail("robots.txt does not Disallow: /");
          const headers = fs.readFileSync(path.join(distDir, "_headers"), "utf8");
          if (headers.startsWith("/*\n") && /X-Robots-Tag:\s*noindex,\s*nofollow/.test(headers)) {
            pass("_headers sends X-Robots-Tag: noindex, nofollow on /*");
          } else fail("_headers is missing X-Robots-Tag: noindex, nofollow on /*");
        }

        if (!html.includes('rel="apple-touch-icon"') || !html.includes("assets/apple-touch-icon.png")) {
          fail("apple-touch-icon link is missing");
        } else pass("apple-touch-icon link points at the generated PNG");

        const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.webmanifest"), "utf8"));
        const wanted = ["assets/icon-192.png", "assets/icon-512.png", "assets/apple-touch-icon.png"];
        for (const src of wanted) {
          if ((manifest.icons || []).some((icon) => icon.src === src)) pass(`manifest lists ${src}`);
          else fail(`manifest is missing ${src}`);
        }

        const urls = [];
        collectUrls(shipped, urls);
        collectUrls(manifest, urls);
        const external = checkLinks(distDir, walkFiles(distDir), urls);
        if (online) {
          for (const url of [...new Set(external)]) {
            if (await headOk(url)) pass(`HEAD ${url}`);
            else fail(`HEAD ${url} did not succeed`);
          }
        } else if (external.length) {
          skip("live HEAD checks. Re-run with --online to request each external link.");
        }

        await browserChecks(distDir, enabled);
      }
    }
    scanTree(path.join(root, "src"), { published: false, label: "src" });
    scanTree(distDir, { published: false, label: "dist" });
  }

  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const row of results) {
    counts[row.status] += 1;
    console.log(`${row.status}  ${row.msg}`);
  }
  console.log(`${counts.FAIL} failed, ${counts.SKIP} skipped, ${counts.PASS} passed`);
  process.exit(counts.FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
