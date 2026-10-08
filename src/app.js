"use strict";

/* ===================== DATA BOUNDARY =====================
   A build step can inline the data as window.SIDELINE_TEAM before this script.
   Without it the page fetches team.json next to index.html. */
async function loadTeam() {
  const raw = window.SIDELINE_TEAM || await fetch("team.json", { cache: "no-cache" }).then(r => {
    if (!r.ok) throw new Error("team.json: HTTP " + r.status);
    return r.json();
  });
  return normalize(raw);
}

const TAB_IDS = ["tournaments", "roster", "team", "gear", "snacks", "info"];

function normalize(raw) {
  const privacy = Object.assign(
    { allowFullNames: false, rosterDisplay: "names", showParentContacts: false },
    raw.privacy
  );
  const footer = Object.assign({ showSidelineCredit: true }, raw.footer);
  const seen = new Set();
  const tabs = (raw.tabs || TAB_IDS.map(id => ({ id, enabled: true })))
    .filter(t => t.enabled && TAB_IDS.includes(t.id) && !seen.has(t.id) && seen.add(t.id))
    .slice(0, 6);
  return Object.assign({}, raw, {
    privacy, footer, tabs,
    team: Object.assign({ shortName: raw.team.name }, raw.team),
    tournaments: raw.tournaments || [],
    roster: raw.roster || [],
    staff: raw.staff || [],
    pathway: raw.pathway || [],
    kits: raw.kits || {},
    links: raw.links || [],
    guide: raw.guide || []
  });
}

/* ===================== HELPERS ===================== */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const safeUrl = u => /^(https?:\/\/|mailto:|tel:|\/|\.\/|[\w-]+\/)/i.test(String(u || "")) ? esc(u) : "";
const telHref = p => "tel:" + String(p).replace(/[^0-9+]/g, "");
const day = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/* ?today=YYYY-MM-DD pins the clock so screenshots and checks are repeatable. */
const TODAY = (() => {
  const q = new URLSearchParams(location.search).get("today");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return day(q);
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate());
})();
const daysUntil = d => Math.round((d - TODAY) / 86400000);

const mapsQuery = q => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
const fieldMapUrl = f => mapsQuery(f.lat + "," + f.lon);

function dateRange(t) {
  const a = day(t.start), b = day(t.end);
  if (a.getMonth() === b.getMonth()) return `${MON[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${a.getFullYear()}`;
  return `${MON[a.getMonth()]} ${a.getDate()} – ${MON[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

const SVG = (body, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  pin: SVG('<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  hotel: SVG('<path d="M3 20V8l9-4 9 4v12"/><path d="M3 20h18M9 20v-5h6v5"/>'),
  globe: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'),
  ext: SVG('<path d="M7 17L17 7M9 7h8v8"/>'),
  search: SVG('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>'),
  bed: SVG('<path d="M3 18V7M3 12h18v6M21 18v-3M3 12V8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4"/>'),
  info: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/>'),
  phone: SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>'),
  mail: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  bag: SVG('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'),
  chev: SVG('<path d="M6 9l6 6 6-6"/>'),
  medal: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 2h6l3 15-9-3z" fill="#b3261e"/><path d="M22 2h6l-3 12-9 3z" fill="#8b1a16"/><circle cx="20" cy="26" r="12.5" fill="var(--medal-face)" stroke="var(--medal-deep)" stroke-width="1.4"/><circle cx="20" cy="26" r="9.6" fill="none" stroke="var(--medal-mid)" stroke-width="1.2"/><path d="M20 17.8l2.15 4.35 4.8.7-3.48 3.38.82 4.78L20 28.7l-4.29 2.31.82-4.78-3.48-3.38 4.8-.7z" fill="var(--medal-deep)"/></svg>`
};

const btn = (href, icon, label, cls = "ghost") => {
  const u = safeUrl(href);
  return u ? `<a class="btn ${cls}" href="${u}" target="_blank" rel="noopener">${icon}${esc(label)}</a>` : "";
};

/* ===================== PRIVACY ===================== */
function playerLabel(p, privacy) {
  if (privacy.rosterDisplay === "jerseyNumbers") return "Player #" + p.jersey;
  if (privacy.allowFullNames) return [p.firstName, p.lastName].filter(Boolean).join(" ");
  return p.firstName + (p.lastName ? " " + p.lastName[0].toUpperCase() + "." : "");
}

/* A guardian is introduced by jersey number and, at most, the child's first
   name and last initial, whatever allowFullNames says. */
function guardianChildRef(p, privacy) {
  if (privacy.rosterDisplay === "jerseyNumbers") return "#" + p.jersey;
  return "#" + p.jersey + " · " + playerLabel(p, Object.assign({}, privacy, { allowFullNames: false }));
}

/* ===================== HERO + NEXT UP ===================== */
function renderHero(t) {
  const th = t.theme;
  return `${th.headerPhoto ? `<img class="hero-photo" src="${safeUrl(th.headerPhoto)}" alt="${esc(th.headerPhotoAlt || "")}" fetchpriority="high" />` : ""}
    <div class="hero-copy">
      ${th.logo ? `<img class="hero-logo" src="${safeUrl(th.logo)}" alt="${esc(t.team.club || t.team.name)} logo" />` : ""}
      <div class="hero-text">
        <h1>${esc(t.team.name)}</h1>
        ${t.team.tagline ? `<div class="sub">${esc(t.team.tagline)}</div>` : ""}
        ${(t.team.pills || []).length ? `<div class="pill-row">${t.team.pills.map(p => `<span class="tagpill">${esc(p)}</span>`).join("")}</div>` : ""}
      </div>
    </div>`;
}

function renderMinibar(t) {
  return `${t.theme.logo ? `<img src="${safeUrl(t.theme.logo)}" alt="" />` : ""}<span>${esc(t.team.shortName)}</span>`;
}

function countdown(du, ongoing) {
  if (du > 1) return `<div class="countdown"><span class="num">${du}</span><span class="lbl">days away</span></div>`;
  if (du === 1) return `<div class="countdown"><span class="num">1</span><span class="lbl">day away</span></div>`;
  if (du === 0) return `<div class="countdown today"><span class="num">Today</span><span class="lbl">kickoff!</span></div>`;
  return ongoing ? `<div class="countdown today"><span class="num">Now</span><span class="lbl">in progress</span></div>` : "";
}

function nextTournament(list) {
  return list.filter(x => daysUntil(day(x.end)) >= 0).sort((a, b) => day(a.start) - day(b.start))[0];
}

function renderNextUp(t) {
  const n = nextTournament(t.tournaments);
  if (!n) return "";
  const where = n.fields && n.fields.length ? n.fields.map(f => f.name).join(" · ") : "Venue TBA";
  return `<a class="nextup" href="#tournaments" data-goto="${esc(n.id)}">
    <div class="kicker">⚽ Next tournament</div>
    <h2>${esc(n.name)}</h2>
    <div class="meta">${esc(dateRange(n))}${n.state ? " · " + esc(n.state) : ""}</div>
    <div class="meta venue-line">${IC.pin}${esc(where)}</div>
    ${countdown(daysUntil(day(n.start)), true)}
  </a>`;
}

/* ===================== TOURNAMENTS ===================== */
const STATUS = {
  local: { cls: "local", text: "🏠 Local · no hotel" },
  stayToPlay: { cls: "stay", text: "🏨 Stay-to-play" },
  tba: { cls: "tbd", text: "Details TBA" }
};
const MEDALS = {
  gold: { badge: "🥇 Gold", kicker: "Champions", line: "First place · Gold" },
  silver: { badge: "🥈 Silver", kicker: "Finalists", line: "Second place · Silver" },
  bronze: { badge: "🥉 Bronze", kicker: "On the podium", line: "Third place · Bronze" }
};

function dayBadge(x, isNext) {
  const du = daysUntil(day(x.start)), past = daysUntil(day(x.end)) < 0;
  if (x.result && MEDALS[x.result]) return `<span class="badge medal">${MEDALS[x.result].badge}</span>`;
  if (isNext) return `<span class="badge next">Next up</span>`;
  if (past) return `<span class="badge done">✓ Done</span>`;
  if (du >= 0 && du <= 60) return `<span class="badge days">in ${du} days</span>`;
  return "";
}

function dinnerBlock(dn) {
  if (!dn) return "";
  const line = (k, v) => v ? `<div class="dline"><span>${k}:</span> ${esc(v)}</div>` : "";
  return `<div class="callout dinner">
    <b>${esc(dn.title || "Team dinner")}</b>
    <div class="dlines">${line("When", dn.when)}${line("Place", dn.place)}${line("Address", dn.address)}</div>
    ${dn.note ? `<div class="dnote">${esc(dn.note)}</div>` : ""}
  </div>`;
}

function detailsBlock(x, past) {
  const notes = (x.notes || []).map(n => `<div class="callout">${esc(n)}</div>`).join("");
  const links = (x.links || []).map(l => btn(l.url, IC.ext, l.label)).join("");
  if (!x.checkIn && !x.parking && !notes && !links) return "";
  const where = (x.fields || []).map(f => esc(f.name) + (f.address ? " · " + esc(f.address) : "")).join("<br/>");
  return `<div class="expand" id="more-${esc(x.id)}"><div class="expand-in">
    <div class="hotel-h">${IC.info}${past ? "Event info" : "Before you go"}</div>
    ${where ? `<div class="hotel-addr where">${where}</div>` : ""}
    ${x.checkIn ? `<div class="callout"><b>Check in</b>${esc(x.checkIn)}</div>` : ""}
    ${x.parking ? `<div class="callout"><b>Parking</b>${esc(x.parking)}</div>` : ""}
    ${notes}
    ${links ? `<div class="actions">${links}</div>` : ""}
  </div></div>`;
}

function hotelBlock(x) {
  const h = x.hotel;
  if (!h) return "";
  const isHost = h.kind === "host", soldOut = !!h.soldOut;
  const others = (h.others || []).map(o => `<li>
      <span class="dot"></span>
      <div class="hotel-opt">
        <div class="hotel-opt-name">${esc(o.name)}</div>
        ${o.address ? `<div class="hotel-addr">${esc(o.address)}</div>` : ""}
        ${o.note ? `<div class="hotel-note">${esc(o.note)}</div>` : ""}
        <div class="actions">${btn(o.bookingUrl, IC.bed, "Book room", soldOut ? "primary" : "ghost")}${btn(mapsQuery(o.name + " " + (o.address || "")), IC.pin, "Map")}</div>
      </div>
    </li>`).join("");
  const acts = [
    btn(mapsQuery(h.name + " " + (h.address || "")), IC.pin, isHost ? "Map host hotel" : "Map"),
    soldOut ? "" : btn(h.bookingUrl, IC.bed, "Book room", "primary"),
    btn(h.infoUrl, IC.globe, isHost ? "Hotel info" : "All tournament hotels")
  ].join("");
  return `<div class="expand" id="hotel-${esc(x.id)}"><div class="expand-in">
    <div class="hotel-h">${IC.hotel}Where to stay</div>
    <div class="hotel-host${soldOut ? " soldout" : ""}">${esc(h.name)} <span class="tagline">${isHost ? "HOST HOTEL" : "TEAM BLOCK"}</span>${soldOut ? `<span class="tagline out">SOLD OUT</span>` : ""}</div>
    ${h.address ? `<div class="hotel-addr">${esc(h.address)}</div>` : ""}
    ${soldOut && h.soldOutNote ? `<div class="callout">${esc(h.soldOutNote)}</div>` : ""}
    ${h.note ? `<div class="callout">${esc(h.note)}</div>` : ""}
    <div class="actions">${acts}</div>
    ${others ? `<div class="hotel-h sub-h">${soldOut ? "Where to book instead" : "Other options nearby"}</div><ul class="hotel-list">${others}</ul>` : ""}
  </div></div>`;
}

function tournamentCard(x, isNext) {
  const a = day(x.start), b = day(x.end), past = daysUntil(b) < 0;
  const medal = x.result && MEDALS[x.result];
  const fields = x.fields || [];
  const status = STATUS[x.status] || STATUS.tba;
  const details = detailsBlock(x, past), hotel = hotelBlock(x);
  const dayLabel = a.getDate() + (b.getDate() !== a.getDate() ? "–" + b.getDate() : "");
  const acts = [
    ...fields.map(f => btn(fieldMapUrl(f), IC.pin, fields.length > 1 ? "Map " + f.name : "Map")),
    btn(x.fieldMap, IC.ext, "Field map"),
    x.signup ? btn(x.signup.url, IC.ext, x.signup.label) : "",
    x.dinner && x.dinner.address ? btn(mapsQuery(x.dinner.place + " " + x.dinner.address), IC.pin, x.dinner.title || "Team dinner") : "",
    details ? `<button class="btn ghost" type="button" data-toggle="more-${esc(x.id)}" aria-expanded="false">${IC.info}Details</button>` : "",
    hotel ? `<button class="btn ghost" type="button" data-toggle="hotel-${esc(x.id)}" aria-expanded="false">${IC.hotel}Hotels</button>` : "",
    x.website ? btn(x.website, IC.globe, "Website") : btn("https://www.google.com/search?q=" + encodeURIComponent(x.name + " soccer tournament " + a.getFullYear()), IC.search, "Find info")
  ].join("");
  const boxCls = medal ? " medal" : past ? " past" : "";
  return `<article class="card tcard-wrap${medal ? " medal-card medal-" + x.result : ""}" id="t-${esc(x.id)}">
    ${medal ? `<div class="medal-banner">${IC.medal}<div class="medal-copy"><div class="medal-kicker">${medal.kicker}</div><div class="medal-line">${medal.line}</div></div></div>` : ""}
    <div class="tcard">
      <div class="datebox${boxCls}"><span class="mon">${MON[a.getMonth()]}</span><span class="day">${dayLabel}</span><span class="yr">${a.getFullYear()}</span></div>
      <div class="body">
        <h3>${esc(x.name)}</h3>
        <div class="loc">${IC.pin}${esc(x.state || "")}${x.tag ? `<span class="tag">· ${esc(x.tag)}</span>` : ""}</div>
        ${fields.map(f => `<div class="venue">${esc(f.name)}</div>`).join("")}
        <div class="badges"><span class="badge ${status.cls}">${status.text}</span>${dayBadge(x, isNext)}</div>
        <div class="actions">${acts}</div>
        ${dinnerBlock(x.dinner)}
        ${details}
        ${hotel}
      </div>
    </div>
  </article>`;
}

function renderTournaments(t) {
  const next = nextTournament(t.tournaments);
  const byStart = (p, q) => day(p.start) - day(q.start);
  const upcoming = t.tournaments.filter(x => daysUntil(day(x.end)) >= 0).sort(byStart);
  const done = t.tournaments.filter(x => daysUntil(day(x.end)) < 0).sort((p, q) => byStart(q, p));
  if (!upcoming.length && !done.length) return `<div class="empty card">No tournaments yet. Check back soon.</div>`;
  return `${upcoming.length ? `<div class="section-label">Tournament Travel</div>${upcoming.map(x => tournamentCard(x, next && x.id === next.id)).join("")}` : ""}
    ${done.length ? `<div class="section-label">Completed</div>${done.map(x => tournamentCard(x, false)).join("")}` : ""}`;
}

/* ===================== ROSTER ===================== */
function renderRoster(t) {
  const pv = t.privacy;
  const players = [...t.roster].sort((a, b) => a.jersey - b.jersey);
  const cards = players.map(p => {
    const label = playerLabel(p, pv);
    return `<div class="card pcard" data-search="${esc(label.toLowerCase() + " #" + p.jersey)}">
      <div class="jersey">${p.jersey}</div>
      <div><div class="pname">${esc(label)}</div><div class="pmeta">#${p.jersey}</div></div>
    </div>`;
  }).join("");
  const contacts = pv.showParentContacts ? players.flatMap(p => (p.guardians || []).map(g => ({ g, p }))) : [];
  const contactCards = contacts.map(({ g, p }) => `<div class="card gcard">
      <div class="gname">${esc(g.name)}</div>
      <div class="gmeta">Family of ${esc(guardianChildRef(p, pv))}</div>
      <div class="actions">
        ${g.phone ? `<a class="btn ghost" href="${telHref(g.phone)}">${IC.phone}${esc(g.phone)}</a>` : ""}
        ${g.email ? `<a class="btn ghost" href="mailto:${esc(g.email)}">${IC.mail}Email</a>` : ""}
      </div>
    </div>`).join("");
  return `<div class="section-label">Players</div>
    <div class="searchwrap">${IC.search}<input id="rosterSearch" type="search" placeholder="Search player or number…" autocomplete="off" aria-label="Search roster" /></div>
    <div class="pgrid" id="rosterList">${cards}</div>
    <div class="noresults" id="noResults" hidden>No matches. Try another name or number.</div>
    ${contactCards ? `<div class="section-label">Parent &amp; Guardian Contacts</div><div class="pgrid" id="guardianList">${contactCards}</div>` : ""}`;
}

/* ===================== TEAM ===================== */
const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

function renderTeam(t) {
  const staff = t.staff.map(s => `<div class="card coach">
      <div class="coach-top">
        <div class="av">${esc(initials(s.name))}</div>
        <div><div class="cr">${esc(s.role)}</div><div class="cn">${esc(s.name)}</div></div>
        <div class="ca">
          ${s.phone ? `<a class="iconbtn call" href="${telHref(s.phone)}" aria-label="Call ${esc(s.name)}">${IC.phone}</a>` : ""}
          ${s.email ? `<a class="iconbtn mail" href="mailto:${esc(s.email)}" aria-label="Email ${esc(s.name)}">${IC.mail}</a>` : ""}
        </div>
      </div>
      ${s.phone || s.email ? `<div class="cmeta">${s.phone ? `<a href="${telHref(s.phone)}">${esc(s.phone)}</a>` : ""}${s.email ? `<span>${esc(s.email)}</span>` : ""}</div>` : ""}
    </div>`).join("");
  const details = (t.team.details || []).map(d => `<div class="inforow"><span class="k">${esc(d.label)}</span><span class="v">${esc(d.value)}</span></div>`).join("");
  const path = t.pathway.map(s => `<div class="step${s.current ? " cur" : ""}">
      <div class="marker"><i></i></div>
      <div class="stxt"><div class="t">${esc(s.title)}${s.current ? '<span class="nowtag">You are here</span>' : ""}</div>${s.detail ? `<div class="d">${esc(s.detail)}</div>` : ""}</div>
    </div>`).join("");
  return `${staff ? `<div class="section-label">Coaches &amp; Staff</div><div class="staff-grid">${staff}</div>` : ""}
    ${details ? `<div class="section-label">Team Details</div><div class="card">${details}</div>` : ""}
    ${path ? `<div class="section-label">Pathway</div><div class="card pathway">${path}</div>` : ""}`;
}

/* ===================== GEAR ===================== */
function kitSvg(shirt, shorts, socks, stroke) {
  return `<svg viewBox="0 0 104 60" height="52" aria-hidden="true">`
    + `<g transform="translate(-4,4) scale(0.82)"><path d="M22 8l-14 7 4 10 6-2v27h28V23l6 2 4-10-14-7-3 4a7 7 0 0 1-10 0z" fill="${shirt}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></g>`
    + `<path d="M44 14 h34 v8 l-3 20 h-10 l-4 -14 -4 14 h-10 l-3 -20 z" fill="${shorts}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>`
    + `<g fill="${socks}" stroke="${stroke}" stroke-width="1.3"><rect x="86" y="30" width="6.5" height="22" rx="3.2"/><rect x="94" y="30" width="6.5" height="22" rx="3.2"/></g>`
    + `</svg>`;
}
function bagSvg(c, st) {
  return `<svg viewBox="0 0 64 64" height="52" aria-hidden="true"><path d="M25 18 a7 6 0 0 1 14 0" fill="none" stroke="${st}" stroke-width="2.4" stroke-linecap="round"/><rect x="13" y="16" width="38" height="40" rx="10" fill="${c}" stroke="${st}" stroke-width="1.5"/><path d="M13 32 q19 -12 38 0" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.4"/><rect x="22" y="36" width="20" height="15" rx="4" fill="rgba(255,255,255,.14)" stroke="${st}" stroke-width="1.1"/><line x1="32" y1="38.5" x2="32" y2="49" stroke="rgba(255,255,255,.35)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}
const KIT_DRAW = {
  kit: k => kitSvg(esc(k.shirt), esc(k.shorts || k.shirt), esc(k.socks || k.shirt), esc(k.stroke || "rgba(0,0,0,.14)")),
  backpack: k => bagSvg(esc(k.shirt), esc(k.stroke || "rgba(0,0,0,.28)"))
};

function renderGear(t) {
  const k = t.kits;
  const uniforms = (k.uniforms || []).map(u => `<div class="kit"><div class="shirt">${(KIT_DRAW[u.type] || KIT_DRAW.kit)(u)}</div><div class="kn">${esc(u.name)}</div>${u.label ? `<div class="kt">${esc(u.label)}</div>` : ""}</div>`).join("");
  const tr = k.training;
  const order = k.order;
  return `${uniforms ? `<div class="section-label">Uniforms &amp; Kits</div><div class="card"><div class="kits">${uniforms}</div></div>` : ""}
    ${tr ? `<div class="section-label">Training Attire</div><div class="card"><div class="attire">
      <div class="kit"><div class="shirt">${KIT_DRAW.kit({ shirt: tr.shirt, shorts: tr.shorts, socks: tr.socks })}</div></div>
      <ul class="dotlist">${(tr.items || []).map(i => `<li>${esc(i)}</li>`).join("")}</ul>
    </div></div>` : ""}
    ${order ? `<div class="section-label">Where to Order</div><div class="card">
      ${order.supplier ? `<div class="inforow"><span class="k">Supplier</span><span class="v">${esc(order.supplier)}</span></div>` : ""}
      ${(order.details || []).map(d => `<div class="inforow"><span class="k">${esc(d.label)}</span><span class="v">${esc(d.value)}</span></div>`).join("")}
      ${order.url ? `<div class="card-pad">${btn(order.url, IC.bag, order.buttonLabel || "Order gear", "primary full")}${order.note ? `<div class="fine">${esc(order.note)}</div>` : ""}</div>` : ""}
    </div>` : ""}
    ${!uniforms && !tr && !order ? `<div class="empty card">Gear details coming soon.</div>` : ""}`;
}

/* ===================== SNACKS ===================== */
const SNACK_ICON = SVG('<path d="M12 7.5c-1.6-1.5-4.4-1.6-6 .4-2.2 2.7-1.2 8 1.5 10.9 1 1.1 2.3 1.4 3.4.8a2.4 2.4 0 0 1 2.2 0c1.1.6 2.4.3 3.4-.8 2.7-2.9 3.7-8.2 1.5-10.9-1.6-2-4.4-1.9-6-.4z"/><path d="M12 7.5V5"/><path d="M12 5c.5-1.8 2-2.8 4-2.6-.2 2-1.6 3.1-4 2.6z"/>');

function renderSnacks(t) {
  const s = t.snacks;
  if (!s || !s.url) return `<div class="section-label">Game Day Snacks</div><div class="empty card">The snack sign-up is not posted yet.</div>`;
  return `<div class="section-label">Game Day Snacks</div>
    ${s.intro ? `<p class="lede">${esc(s.intro)}</p>` : ""}
    <div class="card snack-card">
      <div class="snack-art">${SNACK_ICON}</div>
      ${btn(s.url, SNACK_ICON, s.buttonLabel || "Sign up", "primary")}
      ${s.note ? `<div class="fine">${esc(s.note)}</div>` : ""}
    </div>`;
}

/* ===================== INFO ===================== */
function answerBlock(b) {
  if (typeof b === "string") return `<p>${esc(b)}</p>`;
  if (b.list) return `<ul class="dotlist">${b.list.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (b.tip) return `<div class="tip">${esc(b.tip)}</div>`;
  return "";
}

function renderInfo(t) {
  const sections = t.guide.map(g => `<div class="section-label">${esc(g.section)}</div>
    ${g.intro ? `<p class="lede">${esc(g.intro)}</p>` : ""}
    ${g.items.map(it => `<details class="qa"${it.open ? " open" : ""}>
      <summary>${esc(it.q)}<span class="chev">${IC.chev}</span></summary>
      <div class="ans">${it.a.map(answerBlock).join("")}</div>
    </details>`).join("")}`).join("");
  const links = t.links.map(l => {
    const u = safeUrl(l.url);
    return u ? `<a class="linkrow" href="${u}" target="_blank" rel="noopener"><span><b>${esc(l.label)}</b>${l.description ? `<small>${esc(l.description)}</small>` : ""}</span>${IC.ext}</a>` : "";
  }).join("");
  return `${sections}${links ? `<div class="section-label">Team Links</div><div class="card">${links}</div>` : ""}
    ${!sections && !links ? `<div class="empty card">The family guide is coming soon.</div>` : ""}`;
}

/* ===================== FOOTER ===================== */
function renderFooter(t) {
  const f = t.footer;
  const credit = f.showSidelineCredit
    ? `<div class="credit">${safeUrl(f.sidelineCreditUrl) ? `<a href="${safeUrl(f.sidelineCreditUrl)}" target="_blank" rel="noopener">Made with Sideline</a>` : "Made with Sideline"}</div>`
    : "";
  if (!f.text && !credit) return "";
  return `<footer class="footer">${f.text ? `<div>${esc(f.text)}</div>` : ""}${credit}</footer>`;
}

/* ===================== TABS ===================== */
const TABS = {
  tournaments: { label: "Tournaments", render: renderTournaments, icon: SVG('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/><path d="M12 14v3M9 20h6M10 17h4l1 3H9z"/>') },
  roster: { label: "Roster", render: renderRoster, icon: SVG('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.5a4.8 4.8 0 0 1 5 4.5"/>') },
  team: { label: "Team", render: renderTeam, icon: SVG('<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9.5 12l1.8 1.8L15 10"/>') },
  gear: { label: "Gear", render: renderGear, icon: SVG('<path d="M8 3l4 2 4-2 4 3-3 3v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9L4 6z"/>') },
  snacks: { label: "Snacks", render: renderSnacks, icon: SNACK_ICON },
  info: { label: "Info", render: renderInfo, icon: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/>') }
};

/* ===================== MOUNT ===================== */
function applyTheme(th) {
  const root = document.documentElement.style;
  [["--primary", th.primary], ["--accent", th.accent || th.primary], ["--dark", th.dark], ["--paper", th.paper]]
    .forEach(([k, v]) => v && root.setProperty(k, v));
  document.querySelector('meta[name="theme-color"]').setAttribute("content", th.dark);
}

function showView(id) {
  document.body.dataset.view = id;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + id));
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.view === id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  window.scrollTo({ top: 0 });
  if (location.hash !== "#" + id) history.replaceState(null, "", location.pathname + location.search + "#" + id);
}

function wire(t) {
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

  document.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => {
    const open = document.getElementById(b.dataset.toggle).classList.toggle("open");
    b.setAttribute("aria-expanded", open);
  }));

  const goto = document.querySelector("[data-goto]");
  if (goto) goto.addEventListener("click", e => {
    e.preventDefault();
    if (!t.tabs.some(x => x.id === "tournaments")) return;
    showView("tournaments");
    document.getElementById("t-" + goto.dataset.goto).scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const search = document.getElementById("rosterSearch");
  if (search) search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll("#rosterList .pcard").forEach(c => {
      const hit = !q || c.dataset.search.includes(q);
      c.hidden = !hit; shown += hit;
    });
    document.getElementById("noResults").hidden = shown > 0;
  });

  const bar = document.getElementById("minibar"), hero = document.getElementById("hero");
  let tick = false;
  const apply = () => {
    tick = false;
    const b = hero.getBoundingClientRect().bottom, shown = bar.classList.contains("show");
    if (!shown && b <= 0) bar.classList.add("show");
    else if (shown && b > 24) bar.classList.remove("show");
  };
  window.addEventListener("scroll", () => { if (!tick) { tick = true; requestAnimationFrame(apply); } }, { passive: true });
  apply();
}

function mount(t) {
  applyTheme(t.theme);
  document.title = t.team.name;
  document.getElementById("hero").innerHTML = renderHero(t);
  document.getElementById("minibar").innerHTML = renderMinibar(t);
  document.getElementById("nextupHost").innerHTML = renderNextUp(t);
  document.getElementById("tabbar").innerHTML = t.tabs.map(x => {
    const tab = TABS[x.id];
    return `<button class="tab" type="button" role="tab" data-view="${x.id}" aria-selected="false">${tab.icon}<span>${esc(x.label || tab.label)}</span></button>`;
  }).join("");
  document.body.classList.toggle("single-tab", t.tabs.length < 2);
  document.getElementById("main").innerHTML =
    t.tabs.map(x => `<section class="view" id="view-${x.id}" role="tabpanel">${TABS[x.id].render(t)}</section>`).join("")
    + renderFooter(t);
  wire(t);
  const want = location.hash.replace("#", "");
  showView(t.tabs.some(x => x.id === want) ? want : (t.tabs[0] || {}).id);
}

loadTeam().then(mount).catch(err => {
  document.getElementById("main").innerHTML = `<div class="empty card">This team page could not load its data.<br/><small>${esc(err.message)}</small></div>`;
});
