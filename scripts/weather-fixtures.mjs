// Writes NWS-shaped fixtures for one tournament's fields into src/weather/fixtures.
// Usage: node scripts/weather-fixtures.mjs [tournamentId]
// The weather is invented. Responses follow the shapes api.weather.gov returns.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src/weather/fixtures");
const team = JSON.parse(readFileSync(join(root, "src/team.json"), "utf8"));
const id = process.argv[2] || "lakeshore-invitational-2026";
const t = team.tournaments.find(x => x.id === id);
if (!t) throw new Error("No tournament " + id);

const API = "https://api.weather.gov";
const OFFSET = "-04:00";
const TZ = "America/Detroit";
const ISSUED = "2026-10-22T10:00:00" + OFFSET;
const HOURS = 156;

const GRID = [
  { office: "LKS", x: 41, y: 52, city: "Lakeshore", zone: "MIZ057", county: "MIC081" },
  { office: "LKS", x: 47, y: 51, city: "Pinecrest", zone: "MIZ057", county: "MIC081" }
];

const pad = n => String(n).padStart(2, "0");
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00:00${OFFSET}`;
}
const issuedMs = Date.UTC(2026, 9, 22, 10);
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/* Saturday a cold front brings afternoon showers on a SW wind.
   Sunday is clear, cool and gusty from the NW. The other days are mild filler. */
function weatherAt(dayIndex, hour, fieldIndex) {
  const diurnal = Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const day = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][dayIndex];
  const base = { Thu: 56, Fri: 59, Sat: 54, Sun: 47, Mon: 50, Tue: 53, Wed: 55 }[day];
  const swing = { Thu: 8, Fri: 9, Sat: 6, Sun: 6, Mon: 7, Tue: 8, Wed: 8 }[day];
  let temp = base + swing * diurnal + fieldIndex;
  let pop = { Thu: 5, Fri: 10, Sat: 15, Sun: 5, Mon: 10, Tue: 20, Wed: 15 }[day];
  let wind = 6 + 4 * Math.max(0, diurnal);
  let dir = day === "Sun" ? "NW" : "SW";
  let cloud = { Thu: 1, Fri: 2, Sat: 2, Sun: 0, Mon: 1, Tue: 3, Wed: 2 }[day];
  if (day === "Sat") {
    pop = hour < 11 ? 10 + hour : Math.min(70, 20 + (hour - 11) * 12);
    if (hour >= 15) temp -= Math.min(hour - 14, 5) * 2;
    wind = 9 + Math.max(0, Math.min(hour, 18) - 9) * 1.3;
    cloud = hour < 11 ? 2 : 3;
    pop -= fieldIndex * 6;
  }
  if (day === "Sun") {
    wind = 13 + 7 * Math.max(0, diurnal);
    pop = 3;
    cloud = hour < 10 ? 1 : 0;
  }
  return { temp: Math.round(temp), pop: Math.max(0, Math.round(pop / 5) * 5), wind: Math.round(wind), dir, cloud };
}

const CLOUD_CODE = ["skc", "few", "sct", "bkn", "ovc"];
const CLOUD_TEXT = { day: ["Sunny", "Mostly Sunny", "Partly Sunny", "Mostly Cloudy", "Cloudy"], night: ["Clear", "Mostly Clear", "Partly Cloudy", "Mostly Cloudy", "Cloudy"] };

function sky(w, isDay) {
  const tod = isDay ? "day" : "night";
  if (w.pop >= 55) return { code: `rain_showers,${w.pop}`, text: "Rain Showers Likely", tod };
  if (w.pop >= 30) return { code: `rain_showers,${w.pop}`, text: "Chance Rain Showers", tod };
  const c = w.wind >= 18 ? "wind_" + CLOUD_CODE[w.cloud] : CLOUD_CODE[w.cloud];
  return { code: c, text: CLOUD_TEXT[tod][w.cloud], tod };
}
const icon = (s, size) => `${API}/icons/land/${s.tod}/${s.code}?size=${size}`;
const atTimeOfDay = (url, isDay) => url.replace(/\/(day|night)\//, isDay ? "/day/" : "/night/");
const percent = v => ({ unitCode: "wmoUnit:percent", value: v });

function hourly(fieldIndex) {
  const periods = [];
  for (let i = 0; i < HOURS; i++) {
    const ms = issuedMs + i * 3600e3;
    const d = new Date(ms);
    const dayIndex = d.getUTCDate() - 22;
    const hour = d.getUTCHours();
    const w = weatherAt(dayIndex, hour, fieldIndex);
    const isDay = hour >= 7 && hour < 19;
    const s = sky(w, isDay);
    periods.push({
      number: i + 1,
      name: "",
      startTime: stamp(ms),
      endTime: stamp(ms + 3600e3),
      isDaytime: isDay,
      temperature: w.temp,
      temperatureUnit: "F",
      temperatureTrend: "",
      probabilityOfPrecipitation: percent(w.pop),
      dewpoint: { unitCode: "wmoUnit:degC", value: Math.round(((w.temp - 32) * 5) / 9 - 4) },
      relativeHumidity: percent(60 + (w.pop >> 2)),
      windSpeed: `${w.wind} mph`,
      windDirection: w.dir,
      icon: icon(s, "small"),
      shortForecast: s.text,
      detailedForecast: ""
    });
  }
  return periods;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function daily(hours) {
  const periods = [];
  const wall = iso => Date.parse(iso.slice(0, 19) + "Z");
  let start = Date.UTC(2026, 9, 22, 10);
  for (let n = 0; n < 14; n++) {
    const d = new Date(start);
    const isDay = d.getUTCHours() >= 6 && d.getUTCHours() < 18;
    const end = isDay ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 6);
    const span = hours.filter(h => wall(h.startTime) >= start && wall(h.startTime) < end);
    const temps = span.map(h => h.temperature);
    const temp = isDay ? Math.max(...temps) : Math.min(...temps);
    const pop = Math.max(...span.map(h => h.probabilityOfPrecipitation.value));
    const winds = span.map(h => parseInt(h.windSpeed, 10));
    const lo = Math.min(...winds), hi = Math.max(...winds);
    const wettest = span.reduce((a, b) => (b.probabilityOfPrecipitation.value > a.probabilityOfPrecipitation.value ? b : a));
    const mid = pop >= 30 ? wettest : span[Math.floor(span.length / 2)];
    const name = n === 0 ? "Today" : n === 1 ? "Tonight" : DAY_NAMES[d.getUTCDay()] + (isDay ? "" : " Night");
    const windText = lo === hi ? `${hi} mph` : `${lo} to ${hi} mph`;
    const detail = `${mid.shortForecast}, with a ${isDay ? "high" : "low"} near ${temp}. ${mid.windDirection} wind ${windText}.`
      + (pop >= 20 ? ` Chance of precipitation is ${pop}%.` : "");
    periods.push({
      number: n + 1,
      name,
      startTime: stamp(start),
      endTime: stamp(end),
      isDaytime: isDay,
      temperature: temp,
      temperatureUnit: "F",
      temperatureTrend: "",
      probabilityOfPrecipitation: percent(pop),
      windSpeed: windText,
      windDirection: mid.windDirection,
      icon: atTimeOfDay(mid.icon, isDay).replace("size=small", "size=medium"),
      shortForecast: mid.shortForecast,
      detailedForecast: detail
    });
    start = end;
  }
  return periods;
}

const gridUrl = g => `${API}/gridpoints/${g.office}/${g.x},${g.y}`;

function point(f, g) {
  const ll = `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
  return {
    "@context": ["https://geojson.org/geojson-ld/geojson-context.jsonld", { "@version": "1.1" }],
    id: `${API}/points/${ll}`,
    type: "Feature",
    geometry: { type: "Point", coordinates: [f.lon, f.lat] },
    properties: {
      "@id": `${API}/points/${ll}`,
      "@type": "wx:Point",
      cwa: g.office,
      forecastOffice: `${API}/offices/${g.office}`,
      gridId: g.office,
      gridX: g.x,
      gridY: g.y,
      forecast: `${gridUrl(g)}/forecast`,
      forecastHourly: `${gridUrl(g)}/forecast/hourly`,
      forecastGridData: gridUrl(g),
      observationStations: `${gridUrl(g)}/stations`,
      relativeLocation: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lon + 0.01, f.lat + 0.01] },
        properties: { city: g.city, state: "MI", distance: { unitCode: "wmoUnit:m", value: 1840 }, bearing: { unitCode: "wmoUnit:degree_(angle)", value: 210 } }
      },
      forecastZone: `${API}/zones/forecast/${g.zone}`,
      county: `${API}/zones/county/${g.county}`,
      timeZone: TZ,
      radarStation: "K" + g.office
    }
  };
}

function forecast(g, periods) {
  return {
    "@context": ["https://geojson.org/geojson-ld/geojson-context.jsonld", { "@version": "1.1" }],
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-85.75, 42.93], [-85.72, 42.93], [-85.72, 42.95], [-85.75, 42.95], [-85.75, 42.93]]] },
    properties: {
      units: "us",
      forecastGenerator: periods.length > 14 ? "HourlyForecastGenerator" : "BaselineForecastGenerator",
      generatedAt: "2026-10-22T14:12:08+00:00",
      updateTime: "2026-10-22T13:47:31+00:00",
      validTimes: "2026-10-22T08:00:00+00:00/P7DT17H",
      elevation: { unitCode: "wmoUnit:m", value: 189 },
      periods
    }
  };
}

const noAlerts = ll => ({
  "@context": { "@version": "1.1" },
  type: "FeatureCollection",
  features: [],
  title: `Current watches, warnings, and advisories for ${ll}`,
  updated: "2026-10-22T14:00:00+00:00"
});

const windAdvisory = {
  "@context": { "@version": "1.1" },
  type: "FeatureCollection",
  features: [{
    id: `${API}/alerts/urn:oid:2.49.0.1.840.0.fixture-wind-advisory.001.1`,
    type: "Feature",
    geometry: null,
    properties: {
      id: "urn:oid:2.49.0.1.840.0.fixture-wind-advisory.001.1",
      areaDesc: "Lakeshore County",
      sent: "2026-10-24T04:12:00-04:00",
      effective: "2026-10-24T04:12:00-04:00",
      onset: "2026-10-24T12:00:00-04:00",
      expires: "2026-10-24T20:00:00-04:00",
      ends: "2026-10-24T20:00:00-04:00",
      status: "Actual",
      messageType: "Alert",
      category: "Met",
      severity: "Moderate",
      certainty: "Likely",
      urgency: "Expected",
      event: "Wind Advisory",
      sender: "w-nws.webmaster@noaa.gov",
      senderName: "NWS Lakeshore MI",
      headline: "Wind Advisory issued October 24 at 4:12AM EDT until October 24 at 8:00PM EDT by NWS Lakeshore MI",
      description: "* WHAT...Southwest winds 20 to 30 mph with gusts up to 45 mph expected.\n\n* WHERE...Lakeshore County.\n\n* WHEN...From noon today to 8 PM EDT this evening.\n\n* IMPACTS...Gusty winds will blow around unsecured objects. Tree limbs could be blown down.",
      instruction: "Secure outdoor objects such as canopies and tents. Use extra caution when driving, especially if operating a high profile vehicle.",
      response: "Execute",
      parameters: { NWSheadline: ["WIND ADVISORY IN EFFECT FROM NOON TODAY TO 8 PM EDT THIS EVENING"] }
    }
  }],
  title: "Current watches, warnings, and advisories",
  updated: "2026-10-24T08:15:00+00:00"
};

rmSync(out, { recursive: true, force: true });
const write = (rel, body) => {
  const file = join(out, rel + ".json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body, null, 1) + "\n");
};

t.fields.forEach((f, i) => {
  const g = GRID[i % GRID.length];
  const ll = `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
  const hours = hourly(i);
  write(`points/${ll}`, point(f, g));
  write(`gridpoints/${g.office}/${g.x},${g.y}/forecast/hourly`, forecast(g, hours));
  write(`gridpoints/${g.office}/${g.x},${g.y}/forecast`, forecast(g, daily(hours)));
  write(`alerts/active/${ll}`, noAlerts(ll));
});
write("alerts/wind-advisory", windAdvisory);
console.log(`fixtures for ${t.id}: ${t.fields.length} fields, issued ${ISSUED}`);
