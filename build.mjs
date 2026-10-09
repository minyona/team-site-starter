import fs from "node:fs";
import path from "node:path";
import { validate } from "./lib/validate.mjs";
import { privacyOf, stripTeam } from "./lib/privacy.mjs";
import { crestPng } from "./lib/png.mjs";

const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");
const teamPath = path.join(srcDir, "team.json");
const schemaPath = path.join(root, "team.schema.json");

function die(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

let team;
let schema;
try {
  team = JSON.parse(fs.readFileSync(teamPath, "utf8"));
} catch (err) {
  die([`src/team.json: ${err.message}`]);
}
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (err) {
  die([`team.schema.json: ${err.message}`]);
}

const errors = validate(team, schema);
if (errors.length) {
  die([
    `src/team.json failed team.schema.json (${errors.length} problem${errors.length === 1 ? "" : "s"})`,
    ...errors.slice(0, 40).map((e) => `  ${e.path}: ${e.reason}`)
  ]);
}

const flags = privacyOf(team);
const shipped = stripTeam(team);
const payload = JSON.stringify(shipped).replace(/</g, "\\u003c");

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(srcDir, distDir, { recursive: true });
fs.rmSync(path.join(distDir, "team.json"), { force: true });
fs.cpSync(path.join(srcDir, "weather"), path.join(distDir, "weather"), { recursive: true });

let html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
const robots = flags.hideFromSearch ? "noindex, nofollow" : "index, follow";
if (/<meta\s+name="robots"/i.test(html)) {
  html = html.replace(/<meta\s+name="robots"[^>]*>/i, `<meta name="robots" content="${robots}" />`);
} else {
  html = html.replace("</head>", `  <meta name="robots" content="${robots}" />\n</head>`);
}
if (!/rel="apple-touch-icon"/i.test(html)) {
  html = html.replace(
    '<link rel="icon" href="assets/logo.svg" type="image/svg+xml" />',
    '<link rel="icon" href="assets/logo.svg" type="image/svg+xml" />\n<link rel="apple-touch-icon" href="assets/apple-touch-icon.png" />'
  );
}
const hook = `<script>window.SIDELINE_TEAM = ${payload};</script>\n`;
if (!html.includes('src="app.js"')) die(["src/index.html: missing app.js script"]);
html = html.replace('<script src="app.js"></script>', hook + '<script src="app.js"></script>');
fs.writeFileSync(path.join(distDir, "index.html"), html);

const weatherPage = path.join(distDir, "weather", "index.html");
let weatherHtml = fs.readFileSync(weatherPage, "utf8");
const weatherTag = '<script type="module" src="weather.js"></script>';
if (!weatherHtml.includes(weatherTag)) die(["src/weather/index.html: missing weather.js script"]);
weatherHtml = weatherHtml.replace(weatherTag, hook + weatherTag);
fs.writeFileSync(weatherPage, weatherHtml);

const manifestPath = path.join(distDir, "manifest.webmanifest");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const icons = Array.isArray(manifest.icons) ? manifest.icons.filter((icon) => icon.type === "image/svg+xml") : [];
icons.push(
  { src: "assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "assets/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" }
);
manifest.icons = icons;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const theme = team.theme || {};
fs.writeFileSync(path.join(distDir, "assets/apple-touch-icon.png"), crestPng(180, theme));
fs.writeFileSync(path.join(distDir, "assets/icon-192.png"), crestPng(192, theme));
fs.writeFileSync(path.join(distDir, "assets/icon-512.png"), crestPng(512, theme));

const robotsTxt = flags.hideFromSearch
  ? "User-agent: *\nDisallow: /\n"
  : "User-agent: *\nAllow: /\n";
fs.writeFileSync(path.join(distDir, "robots.txt"), robotsTxt);

const headerLines = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer"
];
if (flags.hideFromSearch) headerLines.push("  X-Robots-Tag: noindex, nofollow");
headerLines.push(
  "",
  "/index.html",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "",
  "/manifest.webmanifest",
  "  Content-Type: application/manifest+json",
  "  Cache-Control: public, max-age=0, must-revalidate",
  ""
);
fs.writeFileSync(path.join(distDir, "_headers"), headerLines.join("\n"));

const nameNote = flags.rosterDisplay === "jerseyNumbers"
  ? "player names removed"
  : flags.allowFullNames ? "full player names kept" : "player last names reduced to initials";
const guardNote = flags.showParentContacts ? "guardian contacts kept" : "guardian contacts removed";
console.log("built dist/");
console.log(`privacy: ${nameNote}; ${guardNote}`);
console.log(flags.hideFromSearch
  ? "search: hidden via meta robots, robots.txt, and _headers"
  : "search: visible (hideFromSearch is false)");
console.log("icons: assets/apple-touch-icon.png (180), assets/icon-192.png, assets/icon-512.png");
console.log("weather: inlined team data into dist/weather/index.html");
