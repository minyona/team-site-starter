import { getPoint, getHourly, getDaily, getAlerts, NwsError, source } from "./nws.js";

/* ===================== DATA BOUNDARY =====================
   Same hook as app.js: a build step may inline window.SIDELINE_TEAM,
   otherwise read team.json from the site root. */
async function loadTeam() {
  return window.SIDELINE_TEAM || fetch("../team.json", { cache: "no-cache" }).then(r => {
    if (!r.ok) throw new Error("team.json: HTTP " + r.status);
    return r.json();
  });
}

/* ===================== CLOCK ===================== */
const params = new URLSearchParams(location.search);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const day = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

/* ?today=YYYY-MM-DD pins the clock, as on the team page. */
const TODAY = (() => {
  const q = params.get("today");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return day(q);
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate());
})();

/* NWS publishes a 7-day forecast, so a weekend further out has nothing to show yet. */
const FORECAST_DAYS = 7;
const FIRST_HOUR = 7, LAST_HOUR = 17;
const PLAY_HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

const toMin = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const clock = min => { const h = Math.floor(min / 60), m = min % 60; return `${(h + 11) % 12 + 1}:${String(m).padStart(2, "0")}`; };
const clockAmPm = min => clock(min) + (min < 720 ? " AM" : " PM");
const hourLabel = h => ((h + 11) % 12 + 1) + (h < 12 ? "a" : "p");
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()}`;
const dateRange = (a, b) => a.getMonth() === b.getMonth()
  ? `${MON[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${a.getFullYear()}`
  : `${shortDate(a)} – ${shortDate(b)}, ${b.getFullYear()}`;
/* Read the wall clock NWS wrote, so the time is the field's, not the phone's. */
const untilLabel = iso => (iso ? `until ${DOW[day(iso.slice(0, 10)).getDay()].slice(0, 3)} ${clockAmPm(toMin(iso.slice(11, 16)))}` : "");

/* ===================== HELPERS ===================== */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const siteRoot = new URL("../", location.href);
const fromSite = p => (/^(https?:|\/)/.test(p) ? p : new URL(p, siteRoot).href);
const nwsPage = f => `https://forecast.weather.gov/MapClick.php?lat=${f.lat}&lon=${f.lon}`;
const keepToday = () => (params.get("today") ? "&today=" + params.get("today") : "") + (params.get("mock") ? "&mock=" + params.get("mock") : "");

/* ===================== WEEKEND MODEL ===================== */
const hasCoords = f => typeof f.lat === "number" && typeof f.lon === "number";

function pickTournament(list) {
  const want = params.get("t");
  if (want) return list.find(x => x.id === want);
  return list
    .filter(x => (x.fields || []).some(hasCoords) && daysBetween(TODAY, day(x.end)) >= 0)
    .sort((a, b) => day(a.start) - day(b.start))[0];
}

function weekendOf(t) {
  const fields = (t.fields || []).filter(hasCoords).map((f, i) => Object.assign({ key: f.id || "field-" + i }, f));
  const dates = [];
  for (let d = day(t.start); d <= day(t.end); d = addDays(d, 1)) dates.push(isoOf(d));
  const games = (t.games || [])
    .map(g => Object.assign({}, g, {
      fieldKey: g.field || (fields.length === 1 ? fields[0].key : undefined),
      min: toMin(g.time),
      arriveMin: g.arrive ? toMin(g.arrive) : undefined
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.min - b.min);
  return { t, fields, dates, games };
}

function stateBeforeFetch(w) {
  if (!w) return { kind: "missing" };
  if (!w.fields.length) return { kind: "noFields", w };
  if (daysBetween(TODAY, day(w.t.end)) < 0) return { kind: "past", w };
  const daysOut = daysBetween(TODAY, day(w.t.start));
  if (daysOut > FORECAST_DAYS) return tooFar(w);
  return { kind: "loading", w };
}

const tooFar = w => ({
  kind: "tooFar", w,
  daysOut: daysBetween(TODAY, day(w.t.start)),
  opensOn: addDays(day(w.t.start), -FORECAST_DAYS)
});

async function fetchWeekend(w) {
  const forecasts = await Promise.all(w.fields.map(async field => {
    const point = await getPoint(field.lat, field.lon);
    const [hours, periods, alerts] = await Promise.all([getHourly(point), getDaily(point), getAlerts(point)]);
    return { field, point, hours, periods, alerts };
  }));
  const alerts = [...new Map(forecasts.flatMap(f => f.alerts).map(a => [a.id, a])).values()];
  return { kind: "ready", w, forecasts, alerts };
}

const SUNNY = { sun: 1, partly: 0.5 };

function dayAt(fc, date) {
  const hours = fc.hours.filter(h => h.date === date && h.hour >= FIRST_HOUR && h.hour <= LAST_HOUR);
  const byHour = new Map(hours.map(h => [h.hour, h]));
  const dayP = fc.periods.find(p => p.date === date && p.isDaytime);
  const night = fc.periods.find(p => p.date === date && !p.isDaytime);
  const src = hours.length ? hours : dayP ? [dayP] : [];
  const temps = src.map(h => h.tempF);
  return {
    date, fc, hours, byHour, dayP, night,
    stats: src.length ? {
      minF: Math.min(...temps),
      maxF: Math.max(...temps),
      maxRain: Math.max(...src.map(h => h.rainPct)),
      maxWind: Math.max(...src.map(h => h.windMph)),
      sunHours: hours.length ? hours.reduce((n, h) => n + (SUNNY[h.sky] || 0), 0) : (dayP ? (SUNNY[dayP.sky] || 0) * 6 : 0)
    } : null
  };
}

const gamesOn = (w, date, fieldKey) => w.games.filter(g => g.date === date && (fieldKey === undefined || g.fieldKey === fieldKey));

/* Fields shown for a day: the ones with games that day, or every field when none are scheduled. */
function fieldsFor(state, date) {
  const busy = state.forecasts.filter(fc => gamesOn(state.w, date, fc.field.key).length);
  return busy.length ? busy : state.forecasts;
}

/* ===================== GEAR HINTS ===================== */
const GEAR = [
  { when: s => s.minF < 40, icon: "coat", text: "Winter coat, hat and gloves" },
  { when: s => s.minF >= 40 && s.minF < 58, icon: "layers", text: "Layers: a hoodie or jacket over the kit" },
  { when: s => s.minF < 50, icon: "blanket", text: "Blanket for the sideline" },
  { when: s => s.maxRain >= 40, icon: "umbrella", text: "Rain jacket, umbrella and dry socks" },
  { when: s => s.maxRain >= 20 && s.maxRain < 40, icon: "umbrella", text: "Pack a rain jacket just in case" },
  { when: s => s.maxWind >= 15, icon: "wind", text: "Windy: windbreaker, stake the canopy" },
  { when: s => s.sunHours >= 3 || s.maxF >= 75, icon: "sun", text: "Sunscreen and a hat" },
  { when: s => s.maxF >= 85, icon: "water", text: "Extra water and shade breaks" }
];
const gearFor = stats => (stats ? GEAR.filter(g => g.when(stats)) : []);

/* ===================== ICONS ===================== */
const svg = (body, vb = "0 0 64 64", cls = "") => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const CLOUD = (fill, stroke, dx = 0, dy = 0) => `<path transform="translate(${dx} ${dy})" d="M19 50a11 11 0 0 1-1.6-21.9A15 15 0 0 1 46 25.5 12.3 12.3 0 0 1 47 50z" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round"/>`;
const SUN = (cx, cy, r) => `<g stroke="#f2a516" stroke-width="3" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
  const rad = a * Math.PI / 180, x1 = cx + Math.cos(rad) * (r + 5), y1 = cy + Math.sin(rad) * (r + 5), x2 = cx + Math.cos(rad) * (r + 10), y2 = cy + Math.sin(rad) * (r + 10);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
}).join("")}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc83d" stroke="#f2a516" stroke-width="2.2"/>`;
const DROPS = `<g stroke="#2f7fe0" stroke-width="3.2" stroke-linecap="round"><line x1="24" y1="49" x2="21" y2="57"/><line x1="34" y1="49" x2="31" y2="57"/><line x1="44" y1="49" x2="41" y2="57"/></g>`;
const SKY_ICON = {
  sun: svg(SUN(32, 32, 13)),
  partly: svg(SUN(23, 22, 10) + CLOUD("#eef2f7", "#a9b6c6", 4, 4)),
  cloudy: svg(CLOUD("#dfe5ee", "#9aa8ba", -6, -6) + CLOUD("#f4f6fa", "#a9b6c6", 3, 2)),
  rain: svg(CLOUD("#d9e1ec", "#8e9db2", 0, -6) + DROPS),
  storm: svg(CLOUD("#b9c4d3", "#7d8ca2", 0, -6) + `<path d="M35 42l-8 11h7l-4 9 11-13h-7l4-7z" fill="#ffc83d" stroke="#e39a0a" stroke-width="1.6" stroke-linejoin="round"/>`),
  snow: svg(CLOUD("#e6ebf2", "#9aa8ba", 0, -6) + `<g fill="#8fb6e8"><circle cx="22" cy="56" r="2.6"/><circle cx="32" cy="59" r="2.6"/><circle cx="42" cy="56" r="2.6"/></g>`),
  fog: svg(CLOUD("#e6ebf2", "#a9b6c6", 0, -8) + `<g stroke="#9aa8ba" stroke-width="3" stroke-linecap="round"><line x1="12" y1="50" x2="52" y2="50"/><line x1="18" y1="57" x2="46" y2="57"/></g>`)
};
const skyIcon = (sky, cls = "") => SKY_ICON[sky].replace('class=""', `class="${cls}"`);

const LINE = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  back: LINE('<path d="M15 18l-6-6 6-6"/>'),
  pin: LINE('<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  drop: LINE('<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>'),
  ball: LINE('<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 2.9-1.5 4.7h-5L8 10.4z"/><path d="M12 3v4.5M21 10l-5 .4M17.5 19.5l-3-4.4M6.5 19.5l3-4.4M3 10l5 .4"/>'),
  ext: LINE('<path d="M7 17L17 7M9 7h8v8"/>'),
  retry: LINE('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  alert: LINE('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17v.1"/>'),
  cal: LINE('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  coat: LINE('<path d="M8 3l4 3 4-3 4 3v14h-5v-7h-6v7H4V6z"/>'),
  layers: LINE('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  blanket: LINE('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M3 14h18"/>'),
  umbrella: LINE('<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6a2 2 0 0 0 4 0"/>'),
  wind: LINE('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>'),
  sun: LINE('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  water: LINE('<path d="M8 3h8l-1 18H9z"/><path d="M8.5 9h7"/>')
};

/* NWS gives the direction the wind blows from. The arrow points where it blows to. */
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const windArrow = dir => {
  const i = COMPASS.indexOf(dir);
  if (i < 0) return "";
  return `<svg class="arrow" viewBox="0 0 12 12" style="transform:rotate(${i * 22.5}deg)" aria-hidden="true"><path d="M6 1v10M2.5 7.5L6 11l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

/* ===================== VIEW PIECES ===================== */
function renderAlerts(alerts) {
  if (!alerts || !alerts.length) return "";
  return `<div class="alerts" role="alert">${alerts.map(a => `<details class="alert">
      <summary>${IC.alert}<span class="alert-t"><b>${esc(a.event)}</b><small>${esc(untilLabel(a.ends))}</small></span></summary>
      <div class="alert-body">${a.instruction ? `<p>${esc(a.instruction)}</p>` : ""}<p class="alert-src">${esc(a.headline)}</p></div>
    </details>`).join("")}</div>`;
}

function renderTop(team, w) {
  const th = team.theme || {};
  const upcoming = (team.tournaments || [])
    .filter(x => (x.fields || []).some(hasCoords) && daysBetween(TODAY, day(x.end)) >= 0)
    .sort((a, b) => day(a.start) - day(b.start));
  const chips = upcoming.length > 1 ? `<nav class="tchips" aria-label="Tournaments">${upcoming.map(x => {
    const a = day(x.start), on = w && x.id === w.t.id;
    return `<a class="tchip${on ? " on" : ""}" href="?t=${encodeURIComponent(x.id)}${keepToday()}"${on ? ' aria-current="page"' : ""}>${esc(x.name)}<small>${esc(shortDate(a))}</small></a>`;
  }).join("")}</nav>` : "";
  const place = w && w.t.state ? " · " + esc(w.t.state) : "";
  return `<header class="top"><div class="top-in">
    <a class="back" href="../#tournaments">${IC.back}${th.logo ? `<img src="${esc(fromSite(th.logo))}" alt="" />` : ""}<span>${esc(team.team.shortName || team.team.name)}</span></a>
    <div class="kicker">Weekend weather</div>
    <h1>${w ? esc(w.t.name) : "Tournament weather"}</h1>
    ${w ? `<div class="meta">${esc(dateRange(day(w.t.start), day(w.t.end)))}${place}</div>` : ""}
    ${chips}
  </div></header>`;
}

function firstGameLine(w, date, fieldKey) {
  const g = gamesOn(w, date, fieldKey)[0];
  return g ? { g, label: clock(g.min) } : null;
}

function focusOf(state) {
  const today = isoOf(TODAY);
  const date = state.w.dates.includes(today) ? today : state.w.dates[0];
  const firstGame = gamesOn(state.w, date)[0];
  const fc = (firstGame && state.forecasts.find(f => f.field.key === firstGame.fieldKey)) || state.forecasts[0];
  return dayAt(fc, date);
}

function renderNow(state) {
  const d = focusOf(state), w = state.w;
  const p = d.dayP || d.hours[0];
  if (!p) return renderSoonCard(tooFar(w));
  const isToday = d.date === isoOf(TODAY);
  const first = firstGameLine(w, d.date, d.fc.field.key);
  const atKick = first && d.byHour.get(Math.floor(first.g.min / 60));
  const gear = gearFor(d.stats);
  return `<section class="now" aria-label="Conditions">
    <div class="now-top">
      <div class="now-kicker">${isToday ? "Today" : "Game day"} · ${DOW[day(d.date).getDay()]}, ${esc(shortDate(day(d.date)))}</div>
      <div class="now-where">${IC.pin}<span>${esc(d.fc.field.name)}</span></div>
    </div>
    <div class="now-main">
      ${skyIcon(p.sky, "now-icon")}
      <div class="now-temp">
        <span class="hi">${p.tempF}°</span>
        ${d.night ? `<span class="lo">Low ${d.night.tempF}°</span>` : ""}
      </div>
    </div>
    <div class="now-text">${esc(p.text)}</div>
    <div class="now-stats">
      <div class="stat rain">${IC.drop}<b>${d.stats.maxRain}%</b><span>Peak rain chance</span></div>
      <div class="stat wind">${windArrow(p.windDir)}<b>${d.stats.maxWind}<small> mph</small></b><span>Peak wind ${esc(p.windDir)}</span></div>
      ${first ? `<div class="stat kick">${IC.ball}<b>${first.label}</b><span>First game${atKick ? ` · ${atKick.tempF}°` : ""}</span></div>`
        : `<div class="stat range"><b>${d.stats.minF}–${d.stats.maxF}°</b><span>7 AM to 5 PM</span></div>`}
    </div>
    ${gear.length ? `<div class="gear"><div class="gear-h">Bring</div><ul>${gear.map(g => `<li>${IC[g.icon]}<span>${esc(g.text)}</span></li>`).join("")}</ul></div>` : ""}
  </section>`;
}

const pct = min => ((min - FIRST_HOUR * 60) / ((LAST_HOUR - FIRST_HOUR + 1) * 60)) * 100;
const inWindow = min => min >= FIRST_HOUR * 60 && min < (LAST_HOUR + 1) * 60;

function renderStrip(d, games) {
  if (!d.hours.length) {
    return `<div class="strip-empty">${IC.cal}<span>Hour-by-hour detail opens about 6 days out. ${d.dayP ? esc(d.dayP.detail) : ""}</span></div>`;
  }
  const shown = games.filter(g => inWindow(g.min));
  const marks = shown.map(g => {
    const at = pct(g.min);
    const band = g.arriveMin !== undefined && g.arriveMin < g.min
      ? `<span class="arrive-band" style="left:${pct(Math.max(g.arriveMin, FIRST_HOUR * 60)).toFixed(2)}%;width:${(at - pct(Math.max(g.arriveMin, FIRST_HOUR * 60))).toFixed(2)}%"></span>` : "";
    const edge = at < 7 ? " start" : at > 93 ? " end" : "";
    return `${band}<span class="kick-stem" style="left:${at.toFixed(2)}%"></span><span class="kick-pill${edge}" style="left:${at.toFixed(2)}%">${IC.ball}${clock(g.min)}</span>`;
  }).join("");
  const kickHours = new Set(shown.map(g => Math.floor(g.min / 60)));
  const cols = PLAY_HOURS.map(h => {
    const x = d.byHour.get(h);
    if (!x) return `<li class="col none"><span class="t">${hourLabel(h)}</span></li>`;
    const rain = x.rainPct;
    return `<li class="col${rain >= 40 ? " wet" : ""}${kickHours.has(h) ? " kick" : ""}">
      <span class="sr">${hourLabel(h)}: ${x.tempF}°, ${rain}% rain, wind ${esc(x.windDir)} ${x.windMph} mph, ${esc(x.text)}.</span>
      <span class="t" aria-hidden="true">${hourLabel(h)}</span>
      ${skyIcon(x.sky, "i")}
      <b class="temp" aria-hidden="true">${x.tempF}°</b>
      <span class="bar" aria-hidden="true"><i style="height:${Math.max(rain, 4)}%"></i></span>
      <span class="rp" aria-hidden="true">${rain}%</span>
      <span class="w" aria-hidden="true">${windArrow(x.windDir)}${x.windMph}</span>
    </li>`;
  }).join("");
  return `<div class="strip">
    <div class="marks" aria-hidden="true">${marks}</div>
    <ol class="cols">${cols}</ol>
  </div>`;
}

function renderGames(d, games) {
  if (!games.length) return "";
  return `<ul class="games">${games.map(g => {
    const x = d.byHour.get(Math.floor(g.min / 60));
    return `<li>
      <span class="gt">${clockAmPm(g.min).replace(" ", "<small>")}</small></span>
      <span class="go"><b>vs ${esc(g.opponent)}</b>${g.arriveMin !== undefined ? `<small><i class="swatch"></i>Arrive ${clockAmPm(g.arriveMin)}</small>` : ""}</span>
      ${x ? `<span class="gw">${skyIcon(x.sky, "gi")}<b>${x.tempF}°</b><span>${IC.drop}${x.rainPct}%</span><span>${windArrow(x.windDir)}${x.windMph}</span></span>` : ""}
    </li>`;
  }).join("")}</ul>`;
}

function renderDay(state, date, isFocus) {
  const fcs = fieldsFor(state, date);
  const lead = dayAt(fcs[0], date);
  const p = lead.dayP;
  const gear = isFocus ? [] : gearFor(lead.stats);
  const multi = state.forecasts.length > 1;
  return `<section class="day">
    <header class="day-h">
      <h2>${DOW[day(date).getDay()]}<small>${esc(shortDate(day(date)))}</small></h2>
      ${p ? `<div class="day-sum">${skyIcon(p.sky, "ds")}<b>${p.tempF}°</b>${lead.night ? `<span class="lo">/ ${lead.night.tempF}°</span>` : ""}<span class="txt">${esc(p.text)}</span></div>` : ""}
    </header>
    ${gear.length ? `<ul class="gear-chips">${gear.map(g => `<li>${IC[g.icon]}${esc(g.text)}</li>`).join("")}</ul>` : ""}
    ${fcs.map(fc => {
      const d = dayAt(fc, date);
      const games = gamesOn(state.w, date, fc.field.key);
      return `<article class="field">
        ${multi || fc.point.place ? `<div class="field-h">${IC.pin}<b>${esc(fc.field.name)}</b>${fc.point.place ? `<span>near ${esc(fc.point.place)}</span>` : ""}</div>` : ""}
        ${renderStrip(d, games)}
        ${renderGames(d, games)}
      </article>`;
    }).join("")}
  </section>`;
}

function renderSchedule(w) {
  if (!w.games.length) return "";
  const byKey = new Map(w.fields.map(f => [f.key, f]));
  return `<section class="schedule"><h2 class="label">Game schedule</h2>${w.dates.map(date => {
    const gs = gamesOn(w, date);
    if (!gs.length) return "";
    return `<div class="sched-day"><h3>${DOW[day(date).getDay()]} <small>${esc(shortDate(day(date)))}</small></h3><ul class="games">${gs.map(g => `<li>
      <span class="gt">${clockAmPm(g.min).replace(" ", "<small>")}</small></span>
      <span class="go"><b>vs ${esc(g.opponent)}</b><small>${g.arriveMin !== undefined ? `<i class="swatch"></i>Arrive ${clockAmPm(g.arriveMin)} · ` : ""}${esc((byKey.get(g.fieldKey) || {}).name || "")}</small></span>
    </li>`).join("")}</ul></div>`;
  }).join("")}</section>`;
}

const nwsLink = (w, cls = "btn ghost") => {
  const f = w.fields[0];
  return f ? `<a class="${cls}" href="${esc(nwsPage(f))}" target="_blank" rel="noopener">${IC.ext}forecast.weather.gov</a>` : "";
};

function renderSoonCard(s) {
  const opensPast = s.opensOn <= TODAY;
  const when = `${DOW[s.opensOn.getDay()]}, ${shortDate(s.opensOn)}`;
  return `<section class="now soon" aria-label="Forecast not open yet">
    <div class="soon-art">${IC.cal}${skyIcon("partly", "soon-sky")}</div>
    <h2>Forecast opens about a week before</h2>
    <p>The National Weather Service forecasts 7 days ahead. ${opensPast ? "This weekend's forecast should appear any time now." : `Check back around <b>${esc(when)}</b>.`}</p>
    ${s.daysOut > 0 ? `<div class="soon-count"><b>${s.daysOut}</b><span>day${s.daysOut === 1 ? "" : "s"} to kickoff</span></div>` : ""}
    <div class="actions">${nwsLink(s.w)}</div>
  </section>`;
}

const LEGEND = `<div class="legend" aria-hidden="true"><span><i class="lg-bar"></i>Rain chance</span><span>${windArrow("S")}Wind toward, mph</span><span><i class="swatch"></i>Arrival window</span><span><i class="lg-kick"></i>Kickoff hour</span></div>`;

/* ===================== VIEWS (one per state kind) ===================== */
const message = (title, body, extra = "") => `<section class="now note"><h2>${title}</h2><p>${body}</p>${extra}</section>`;
const backBtn = `<div class="actions"><a class="btn ghost" href="../#tournaments">${IC.back}Back to tournaments</a></div>`;

const VIEWS = {
  missing: () => message("No upcoming tournament", "Weather shows up here for the next tournament that lists its fields.", backBtn),
  noFields: s => message("Fields not posted yet", `Weather appears once ${esc(s.w.t.name)} lists its fields.`, backBtn) + renderSchedule(s.w),
  past: s => message("This tournament is over", "Weather is only shown for upcoming weekends.", backBtn),
  tooFar: s => `<div class="layout"><div class="lead">${renderSoonCard(s)}</div><div class="rest">${renderSchedule(s.w)}</div></div>`,
  loading: () => `<div class="layout"><div class="lead"><section class="now skeleton" aria-busy="true"><div class="sk sk-a"></div><div class="sk sk-b"></div><div class="sk sk-c"></div></section></div>
    <div class="rest"><div class="sk sk-strip"></div><div class="sk sk-strip"></div></div></div>`,
  error: s => `<div class="layout"><div class="lead">${message("Weather didn't load", "The National Weather Service didn't answer. Try again, or open the official forecast.",
    `<div class="actions"><button class="btn primary" type="button" data-retry>${IC.retry}Try again</button>${nwsLink(s.w)}</div><p class="fine">${esc(s.message)}</p>`)}</div>
    <div class="rest">${renderSchedule(s.w)}</div></div>`,
  ready: s => {
    const focus = focusOf(s).date;
    return `<div class="layout"><div class="lead">${renderNow(s)}</div>
      <div class="rest">${s.w.dates.map(date => renderDay(s, date, date === focus)).join("")}${LEGEND}</div></div>`;
  }
};

/* ===================== MOUNT ===================== */
function applyTheme(th) {
  const root = document.documentElement.style;
  [["--primary", th.primary], ["--accent", th.accent || th.primary], ["--dark", th.dark], ["--paper", th.paper]]
    .forEach(([k, v]) => v && root.setProperty(k, v));
  if (th.dark) document.querySelector('meta[name="theme-color"]').setAttribute("content", th.dark);
}

function renderFooter(state) {
  const sample = source === "fixtures" && state.kind === "ready";
  return `<footer class="foot">
    ${sample ? `<div class="sample">Sample forecast for the demo. Not real weather.</div>` : ""}
    <div>Forecast and alerts from the National Weather Service${state.w && state.w.fields[0] ? ` · <a href="${esc(nwsPage(state.w.fields[0]))}" target="_blank" rel="noopener">forecast.weather.gov</a>` : ""}</div>
  </footer>`;
}

function mount(team) {
  const app = document.getElementById("app");
  const w = (() => { const t = pickTournament(team.tournaments || []); return t ? weekendOf(t) : undefined; })();
  const paint = state => {
    app.innerHTML = renderAlerts(state.alerts) + renderTop(team, state.w) + `<main class="wx ${state.kind}">${VIEWS[state.kind](state)}</main>` + renderFooter(state);
    app.dataset.state = state.kind;
    const retry = app.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", run);
  };
  async function run() {
    const first = stateBeforeFetch(w);
    paint(first);
    if (first.kind !== "loading") return;
    try {
      paint(await fetchWeekend(w));
    } catch (err) {
      paint(err instanceof NwsError && err.kind === "notYet" ? tooFar(w) : { kind: "error", w, message: err.message });
    }
  }
  applyTheme(team.theme || {});
  document.title = (w ? w.t.name + " weather · " : "Weather · ") + (team.team.shortName || team.team.name);
  run();
}

loadTeam().then(mount).catch(err => {
  document.getElementById("app").innerHTML = `<main class="wx"><section class="now note"><h2>This page could not load the team data</h2><p>${esc(err.message)}</p></section></main>`;
});
