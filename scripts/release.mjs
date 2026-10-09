import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = {
  version: "0.1.0",
  product: "sideline",
  exclude: [".cursor", ".git", "node_modules", "dist"]
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileName = `${release.product}-v${release.version}.zip`;
const outPath = path.join(root, fileName);
const prefix = `${release.product}-v${release.version}/`;

const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (status.status !== 0) {
  console.error(status.stderr || "git status failed");
  process.exit(status.status || 1);
}
if (status.stdout.trim()) {
  console.error("Commit or stash changes before packing. The zip is the committed tree, not the working copy.");
  process.exit(1);
}

const packed = spawnSync("git", [
  "archive",
  "--format=zip",
  `--prefix=${prefix}`,
  `--output=${outPath}`,
  "HEAD",
  "--",
  ".",
  ...release.exclude.map((name) => `:(exclude)${name}`),
  `:(exclude)${fileName}`
], { cwd: root, encoding: "utf8" });

if (packed.status !== 0) {
  console.error(packed.stderr || packed.stdout || "git archive failed");
  process.exit(packed.status || 1);
}

const size = fs.statSync(outPath).size;
console.log(`${outPath} ${size} bytes`);
