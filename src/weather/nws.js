/* National Weather Service boundary. The page imports only the four getters,
   NwsError and source, and only ever sees the parsed records below, never NWS GeoJSON.

   Records
     Point  { lat, lon, office, gridX, gridY, timeZone, place, hourlyUrl, dailyUrl }
     Hour   { date, hour, tempF, rainPct, windMph, windDir, sky, text }
     Period { date, name, isDaytime, tempF, rainPct, windMph, windDir, sky, text, detail }
     Alert  { id, event, headline, severity, ends, instruction }
   date is "YYYY-MM-DD" and hour is 0-23, both read from the offset NWS puts on
   startTime, so they are already field-local. Alert.ends keeps the NWS offset
   for the same reason. sky is a key of SKY below.

   Data source
     live         https://api.weather.gov when LIVE is true and no ?mock
     ?mock=1      fixtures under ./fixtures, laid out by API path
     ?mock=alert  fixtures plus an active Wind Advisory at every point
     ?mock=down   every call fails with NwsError("unavailable")
   source is "live" only for a real fetch, so the sample label stays on fixtures.

   Live cache, in sessionStorage, never a failure
     points 24 h, gridpoint forecasts 30 min, alerts 5 min, keyed by URL.
     One in-flight promise per URL, so two fields on the same grid cell share it.
     5xx and timeouts try twice more, after 1 s then 3 s. */

const LIVE = true;

const USER_AGENT = "Sideline team site (+https://byminyona.com/sideline)";
const TIMEOUT_MS = 8000;
const RETRY_AFTER_MS = [1000, 3000];
const RESOURCE = [
  { ttl: 24 * 60 * 60 * 1000, miss: "notYet", test: path => path.startsWith("/points/") },
  { ttl: 5 * 60 * 1000, miss: "unavailable", test: path => path.startsWith("/alerts/") },
  { ttl: 30 * 60 * 1000, miss: "notYet", test: path => path.startsWith("/gridpoints/") }
];

const inflight = new Map();

function resourceFor(url) {
  const path = new URL(url).pathname;
  return RESOURCE.find(row => row.test(path)) || RESOURCE[2];
}

function readCache(url) {
  try {
    const raw = sessionStorage.getItem("nws:" + url);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec.exp !== "number" || Date.now() >= rec.exp) {
      sessionStorage.removeItem("nws:" + url);
      return null;
    }
    return rec.body;
  } catch {
    return null;
  }
}

function writeCache(url, body) {
  try {
    sessionStorage.setItem("nws:" + url, JSON.stringify({
      exp: Date.now() + resourceFor(url).ttl,
      body
    }));
  } catch {
    /* quota, or storage blocked in a private window */
  }
}

function retryable(kind, message) {
  const err = new NwsError(kind, message);
  err.retryable = true;
  return err;
}

function settle(err) {
  if (!(err instanceof NwsError) || !err.retryable) return err;
  return new NwsError(err.kind === "timeout" ? "timeout" : "unavailable", err.message);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function nwsHeaders() {
  // Browsers drop a script-set User-Agent. NWS still gets the browser's own.
  return { Accept: "application/geo+json", "User-Agent": USER_AGENT };
}

async function fetchOnce(url) {
  if (globalThis.navigator && navigator.onLine === false) throw new NwsError("unavailable", "Offline");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: nwsHeaders(), signal: ctrl.signal });
    if (res.status === 404) throw new NwsError(resourceFor(url).miss, "NWS HTTP 404");
    if (res.status >= 500) throw retryable("unavailable", "NWS HTTP " + res.status);
    if (!res.ok) throw new NwsError("unavailable", "NWS HTTP " + res.status);
    try {
      return await res.json();
    } catch {
      throw new NwsError("unavailable", "NWS returned unreadable JSON");
    }
  } catch (err) {
    if (err instanceof NwsError) throw err;
    if (err && err.name === "AbortError") throw retryable("timeout", "NWS timed out");
    throw new NwsError("unavailable", (err && err.message) || "Offline");
  } finally {
    clearTimeout(timer);
  }
}

async function loadFresh(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(RETRY_AFTER_MS[attempt - 1]);
    try {
      const body = await fetchOnce(url);
      writeCache(url, body);
      return body;
    } catch (err) {
      last = err;
      if (!(err instanceof NwsError) || !err.retryable || attempt === 2) throw settle(err);
    }
  }
  throw settle(last);
}

function liveLoad(url) {
  const cached = readCache(url);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = loadFresh(url).finally(() => {
    if (inflight.get(url) === task) inflight.delete(url);
  });
  inflight.set(url, task);
  return task;
}

export class NwsError extends Error {
  /** kind: "notYet" | "unavailable" | "timeout" */
  constructor(kind, message) {
    super(message || kind);
    this.name = "NwsError";
    this.kind = kind;
  }
}

const API = "https://api.weather.gov";
const MOCK = new URLSearchParams(location.search).get("mock");
const FIXTURES = new URL("./fixtures/", import.meta.url);

async function fixtureLoad(url) {
  if (MOCK === "down") throw new NwsError("unavailable", "Simulated outage (?mock=down)");
  const u = new URL(url);
  const isAlerts = u.pathname === "/alerts/active";
  const path = isAlerts
    ? (MOCK === "alert" ? "alerts/wind-advisory" : "alerts/active/" + u.searchParams.get("point"))
    : u.pathname.slice(1);
  const res = await fetch(new URL(path + ".json", FIXTURES));
  if (res.status === 404) throw new NwsError("notYet", "No fixture for " + url);
  if (!res.ok) throw new NwsError("unavailable", "Fixture HTTP " + res.status);
  return res.json();
}

/** "live" | "fixtures". The page labels fixture data as a sample forecast. */
export const source = LIVE && !MOCK ? "live" : "fixtures";

const load = url => (source === "live" ? liveLoad(url) : fixtureLoad(url));

/* NWS icon URLs name the condition, e.g. .../land/day/rain_showers,40?size=small
   or .../land/day/tsra,30/sct,10. The first code wins. */
const SKY = {
  sun: ["skc", "few", "hot"],
  partly: ["sct", "wind_skc", "wind_few", "wind_sct"],
  cloudy: ["bkn", "ovc", "wind_bkn", "wind_ovc", "haze", "smoke", "dust"],
  rain: ["rain", "rain_showers", "rain_showers_hi", "fzra", "rain_fzra"],
  storm: ["tsra", "tsra_sct", "tsra_hi", "tornado", "hurricane", "tropical_storm"],
  snow: ["snow", "rain_snow", "rain_sleet", "snow_sleet", "sleet", "snow_fzra", "blizzard", "cold"],
  fog: ["fog"]
};
const SKY_BY_CODE = Object.fromEntries(Object.entries(SKY).flatMap(([k, codes]) => codes.map(c => [c, k])));

function skyOf(icon) {
  const m = /\/icons\/land\/(?:day|night)\/([a-z_]+)/.exec(icon || "");
  return (m && SKY_BY_CODE[m[1]]) || "cloudy";
}

const mph = s => Math.max(0, ...String(s || "").match(/\d+/g)?.map(Number) || [0]);
const localDate = iso => iso.slice(0, 10);
const localHour = iso => Number(iso.slice(11, 13));

function periodsOf(body) {
  const periods = body && body.properties && body.properties.periods;
  if (!periods || !periods.length) throw new NwsError("notYet", "Forecast has no periods yet");
  return periods;
}

const coord = n => Number(n).toFixed(4);

/** @returns {Promise<Point>} */
export async function getPoint(lat, lon) {
  const body = await load(`${API}/points/${coord(lat)},${coord(lon)}`);
  const p = body.properties;
  const rel = p.relativeLocation && p.relativeLocation.properties;
  return {
    lat, lon,
    office: p.gridId, gridX: p.gridX, gridY: p.gridY,
    timeZone: p.timeZone,
    place: rel ? `${rel.city}, ${rel.state}` : "",
    hourlyUrl: p.forecastHourly,
    dailyUrl: p.forecast
  };
}

/** @returns {Promise<Hour[]>} */
export async function getHourly(point) {
  return periodsOf(await load(point.hourlyUrl)).map(x => ({
    date: localDate(x.startTime),
    hour: localHour(x.startTime),
    tempF: x.temperature,
    rainPct: (x.probabilityOfPrecipitation && x.probabilityOfPrecipitation.value) || 0,
    windMph: mph(x.windSpeed),
    windDir: x.windDirection || "",
    sky: skyOf(x.icon),
    text: x.shortForecast || ""
  }));
}

/** @returns {Promise<Period[]>} */
export async function getDaily(point) {
  return periodsOf(await load(point.dailyUrl)).map(x => ({
    date: localDate(x.startTime),
    name: x.name,
    isDaytime: x.isDaytime,
    tempF: x.temperature,
    rainPct: (x.probabilityOfPrecipitation && x.probabilityOfPrecipitation.value) || 0,
    windMph: mph(x.windSpeed),
    windDir: x.windDirection || "",
    sky: skyOf(x.icon),
    text: x.shortForecast || "",
    detail: x.detailedForecast || ""
  }));
}

/** @returns {Promise<Alert[]>} */
export async function getAlerts(point) {
  const body = await load(`${API}/alerts/active?point=${coord(point.lat)},${coord(point.lon)}`);
  return (body.features || []).map(f => f.properties).map(a => ({
    id: a.id,
    event: a.event,
    headline: a.headline || a.event,
    severity: a.severity,
    ends: a.ends || a.expires || "",
    instruction: a.instruction || ""
  }));
}
