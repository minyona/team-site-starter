import { createHash } from "node:crypto";

export const FORBIDDEN_WORD_SHA256 = ["b40aa392184735c3ea4e3f53ea9110216570493f876159d35bd5782f7b3745e7"];

const HASH_LINE = /^[0-9a-f]{64}$/i;

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function denylistHashes(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    out.push(HASH_LINE.test(line) ? line.toLowerCase() : sha256Hex(line.toLowerCase()));
  }
  return out;
}

export function containsForbiddenToken(text, hashes) {
  for (const token of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (hashes.has(sha256Hex(token))) return true;
  }
  return false;
}

export function privacyOf(team) {
  const p = team?.privacy || {};
  return {
    allowFullNames: p.allowFullNames ?? false,
    rosterDisplay: p.rosterDisplay ?? "names",
    showParentContacts: p.showParentContacts ?? false,
    hideFromSearch: team?.hideFromSearch ?? true
  };
}

const BIRTH_KEY = /^(birthYear|birthDate|dateOfBirth|dob|born|birthday)$/i;

export function stripTeam(team) {
  const copy = structuredClone(team);
  const flags = privacyOf(copy);
  for (const player of copy.roster || []) {
    if (flags.rosterDisplay === "jerseyNumbers") {
      delete player.firstName;
      delete player.lastName;
    } else if (!flags.allowFullNames && typeof player.lastName === "string" && player.lastName.length > 0) {
      player.lastName = player.lastName[0].toUpperCase();
    }
    if (!flags.showParentContacts) delete player.guardians;
  }
  return copy;
}

function walk(node, path, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    visit(key, value, here);
    walk(value, here, visit);
  }
}

export function scanTeam(team, pathLabel, { published }) {
  const flags = privacyOf(team);
  const findings = [];
  const fail = (path, reason) => findings.push({ path: pathLabel ? `${pathLabel}: ${path}` : path, reason });
  const players = Array.isArray(team?.roster) ? team.roster : [];

  players.forEach((player, i) => {
    const base = `roster[${i}]`;
    walk(player, base, (key, value, here) => {
      if (BIRTH_KEY.test(key)) fail(here, `birth data is not allowed on a player (${key})`);
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) fail(here, "date near a player record");
      if (typeof value === "number" && key !== "jersey" && value >= 1900 && value <= 2100) {
        fail(here, "birth year near a player record");
      }
      if (key === "phone" || key === "email") {
        const inGuardian = here.includes(".guardians[");
        if (!inGuardian || published) fail(here, `${key} inside a player object`);
      }
    });

    if (published && flags.rosterDisplay === "jerseyNumbers" && ("firstName" in player || "lastName" in player)) {
      fail(base, "names must be removed when rosterDisplay is jerseyNumbers");
    }
    if (published && flags.allowFullNames === false && flags.rosterDisplay !== "jerseyNumbers") {
      if (typeof player.lastName === "string" && player.lastName.length > 1) {
        fail(`${base}.lastName`, `full last name "${player.lastName}" shipped while allowFullNames is false`);
      }
    }
    if (published && flags.showParentContacts === false && player.guardians) {
      fail(`${base}.guardians`, "guardians must be removed when showParentContacts is false");
    }
  });

  return findings;
}

export function sourceSecrets(team) {
  const flags = privacyOf(team);
  const names = [];
  const contacts = [];
  for (const player of team.roster || []) {
    if (flags.allowFullNames === false && typeof player.lastName === "string" && player.lastName.length > 1) {
      names.push(player.lastName);
    }
    if (flags.showParentContacts === false) {
      for (const g of player.guardians || []) {
        if (g.name) contacts.push(g.name);
        if (g.phone) contacts.push(g.phone);
        if (g.email) contacts.push(g.email);
      }
    }
  }
  return { names, contacts };
}
