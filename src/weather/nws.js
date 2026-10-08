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
     ?mock=1      fixtures under ./fixtures, laid out by API path
     ?mock=alert  fixtures plus an active Wind Advisory at every point
     ?mock=down   every call fails with NwsError("unavailable")
   Until LIVE is true the page always reads fixtures. */

const LIVE = false;

/* TODO(live NWS): implement liveLoad(url), flip LIVE, keep everything else.
   Input   an absolute https://api.weather.gov URL built by the getters below.
   Output  the parsed JSON body (GeoJSON).
   Request headers  Accept: application/geo+json. Try User-Agent
     "Sideline team site (+https://byminyona.com/sideline)"; browsers drop it
     silently, so never make success depend on it. No API key exists or is sent.
   Errors, always thrown as NwsError so the page can pick its state:
     404 on /points, or a gridpoint forecast that has no periods yet
       -> NwsError("notYet"). The page shows "forecast opens about a week before".
     5xx, or the known "Unexpected Problem" 500 from gridpoint forecasts
       -> retry, then NwsError("unavailable").
     no response within 8 s (AbortController) -> retry, then NwsError("timeout").
     anything else (4xx, bad JSON) -> NwsError("unavailable"), no retry.
   Retry   two more attempts at 1 s then 3 s, for 5xx and timeouts only.
     The page's "Try again" button calls the getters afresh.
   Caching per point
     /points/{lat},{lon} barely changes. Keep it in localStorage under
       "nws:points:{lat},{lon}" for 24 h.
     forecast, forecast/hourly and alerts: in memory for the page's life, keyed
       by URL, plus sessionStorage for 10 min so a refresh during a game is
       instant. Two fields on one grid cell share the forecast entry.
     Share the in-flight promise so concurrent getters make one request per URL.
     Never cache a failure. */
async function liveLoad(url) {
  throw new NwsError("unavailable", "Live NWS fetch is not wired yet: " + url);
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
