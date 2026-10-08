// Behavior of the live NWS client. Stub fetch. No network.
import assert from "node:assert/strict";
import { mock } from "node:test";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear()
  };
}

globalThis.location = { search: "" };
globalThis.sessionStorage = memoryStorage();

const { getPoint, getHourly, getDaily, getAlerts, NwsError, source } = await import("../src/weather/nws.js");

const POINT_URL = "https://api.weather.gov/points/12.3457,-98.7654";
const HOURLY_URL = "https://api.weather.gov/gridpoints/TST/4,5/forecast/hourly";
const DAILY_URL = "https://api.weather.gov/gridpoints/TST/4,5/forecast";
const ALERTS_URL = "https://api.weather.gov/alerts/active?point=12.3457,-98.7654";

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

function pointBody(office, city) {
  return {
    properties: {
      gridId: office,
      gridX: 4,
      gridY: 5,
      timeZone: "America/New_York",
      relativeLocation: { properties: { city, state: "OH" } },
      forecastHourly: HOURLY_URL,
      forecast: DAILY_URL
    }
  };
}

function periods(temp, extra) {
  return {
    properties: {
      periods: [{
        startTime: "2026-10-10T09:00:00-04:00",
        temperature: temp,
        probabilityOfPrecipitation: { value: 20 },
        windSpeed: "10 mph",
        windDirection: "NW",
        icon: "https://api.weather.gov/icons/land/day/sct?size=small",
        shortForecast: "Partly Cloudy",
        isDaytime: true,
        name: "Saturday",
        detailedForecast: "Partly cloudy, with a high near 70.",
        ...extra
      }]
    }
  };
}

const alertBody = {
  features: [{
    properties: {
      id: "urn:alert:1",
      event: "Wind Advisory",
      headline: "Wind Advisory until Friday",
      severity: "Moderate",
      ends: "2026-10-09T18:00:00-04:00",
      instruction: "Secure loose objects."
    }
  }]
};

const HOUR = {
  date: "2026-10-10",
  hour: 9,
  tempF: 70,
  rainPct: 20,
  windMph: 10,
  windDir: "NW",
  sky: "partly",
  text: "Partly Cloudy"
};

function install(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init || {});
}

const lines = [];
const pass = (name, detail) => lines.push(name + ": " + detail);

assert.equal(source, "live");

install((url, init) => {
  assert.equal(init.headers.Accept, "application/geo+json", "Accept");
  if (url === POINT_URL) return jsonResponse(200, pointBody("TST", "Sampleton"));
  if (url === HOURLY_URL) return jsonResponse(200, periods(70));
  if (url === DAILY_URL) return jsonResponse(200, periods(70));
  if (url === ALERTS_URL) return jsonResponse(200, alertBody);
  return jsonResponse(404, {});
});

const point = await getPoint(12.34567, -98.76543);
assert.deepEqual(point, {
  lat: 12.34567,
  lon: -98.76543,
  office: "TST",
  gridX: 4,
  gridY: 5,
  timeZone: "America/New_York",
  place: "Sampleton, OH",
  hourlyUrl: HOURLY_URL,
  dailyUrl: DAILY_URL
});
assert.deepEqual(await getHourly(point), [HOUR]);
assert.deepEqual(await getDaily(point), [{
  date: "2026-10-10",
  name: "Saturday",
  isDaytime: true,
  tempF: 70,
  rainPct: 20,
  windMph: 10,
  windDir: "NW",
  sky: "partly",
  text: "Partly Cloudy",
  detail: "Partly cloudy, with a high near 70."
}]);
assert.deepEqual(await getAlerts(point), [{
  id: "urn:alert:1",
  event: "Wind Advisory",
  headline: "Wind Advisory until Friday",
  severity: "Moderate",
  ends: "2026-10-09T18:00:00-04:00",
  instruction: "Secure loose objects."
}]);
pass("success", "TST 4,5 Sampleton, OH 70F partly cloudy, one wind advisory");

install((url) => {
  if (url === POINT_URL) return jsonResponse(200, pointBody("XXX", "Nope"));
  return jsonResponse(500, { title: "Unexpected Problem" });
});
const cached = await getPoint(12.34567, -98.76543);
assert.equal(cached.office, "TST");
assert.equal(cached.place, "Sampleton, OH");
pass("cache hit", "second points read kept TST / Sampleton, OH");

sessionStorage.clear();
install((url) => {
  assert.equal(url, "https://api.weather.gov/points/40.0000,-74.0000");
  return jsonResponse(404, {});
});
await assert.rejects(getPoint(40, -74), err => err instanceof NwsError && err.kind === "notYet");
install(() => jsonResponse(404, {}));
const gridPoint = {
  lat: 40, lon: -74,
  hourlyUrl: "https://api.weather.gov/gridpoints/PHI/1,1/forecast/hourly"
};
await assert.rejects(getHourly(gridPoint), err => err instanceof NwsError && err.kind === "notYet");
pass("404", "points and gridpoints 404 are notYet");

sessionStorage.clear();
let forecastTries = 0;
install((url) => {
  assert.equal(url, "https://api.weather.gov/gridpoints/TST/10,10/forecast/hourly");
  forecastTries += 1;
  if (forecastTries === 1) return jsonResponse(500, { title: "Unexpected Problem", status: 500 });
  return jsonResponse(200, periods(64));
});
const retried = await getHourly({
  hourlyUrl: "https://api.weather.gov/gridpoints/TST/10,10/forecast/hourly"
});
assert.equal(retried[0].tempF, 64);
assert.equal(retried[0].text, "Partly Cloudy");
assert.equal(forecastTries, 2);
pass("500 then success", "hourly temp 64 after one Unexpected Problem");

sessionStorage.clear();
let sharedCalls = 0;
const shared = "https://api.weather.gov/gridpoints/TST/4,5/forecast/hourly";
const other = "https://api.weather.gov/gridpoints/OTH/3,4/forecast/hourly";
install((url) => {
  if (url === shared) {
    sharedCalls += 1;
    return jsonResponse(200, periods(sharedCalls === 1 ? 61 : 50));
  }
  if (url === other) return jsonResponse(200, periods(99));
  return jsonResponse(404, {});
});
const [left, right, far] = await Promise.all([
  getHourly({ hourlyUrl: shared }),
  getHourly({ hourlyUrl: shared }),
  getHourly({ hourlyUrl: other })
]);
assert.equal(left[0].tempF, 61);
assert.equal(right[0].tempF, 61);
assert.equal(far[0].tempF, 99);
assert.equal(sharedCalls, 1);
pass("gridpoint dedupe", "two fields on TST/4,5 both read 61F from one request; OTH stayed 99F");

sessionStorage.clear();
mock.timers.enable({ apis: ["setTimeout"] });
try {
  let timeoutCalls = 0;
  install((url, init) => new Promise((resolve, reject) => {
    timeoutCalls += 1;
    const abort = () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (init.signal.aborted) abort();
    else init.signal.addEventListener("abort", abort, { once: true });
  }));
  const timed = getHourly({
    hourlyUrl: "https://api.weather.gov/gridpoints/TST/1,2/forecast/hourly"
  }).then(() => {
    throw new Error("timeout case resolved");
  }, err => err);
  for (const ms of [8000, 1000, 8000, 3000, 8000]) {
    mock.timers.tick(ms);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }
  const err = await timed;
  assert.ok(err instanceof NwsError, "timeout throws NwsError");
  assert.equal(err.kind, "timeout");
  assert.equal(timeoutCalls, 3);
  pass("timeout", "aborted at 8s, retried twice, kind timeout");
} finally {
  mock.timers.reset();
}

globalThis.location = { search: "?mock=down" };
const down = await import("../src/weather/nws.js?case=down");
assert.equal(down.source, "fixtures");
await assert.rejects(down.getPoint(12.3457, -98.7654), err => err instanceof down.NwsError && err.kind === "unavailable");

globalThis.location = { search: "?mock=1" };
const sample = await import("../src/weather/nws.js?case=sample");
assert.equal(sample.source, "fixtures");

globalThis.location = { search: "?mock=alert" };
const alerted = await import("../src/weather/nws.js?case=alert");
assert.equal(alerted.source, "fixtures");
pass("mock", "?mock=1, ?mock=alert and ?mock=down stay on fixtures");

install(() => { throw new TypeError("Failed to fetch"); });
sessionStorage.clear();
await assert.rejects(
  getPoint(41.0001, -81.0001),
  err => err instanceof NwsError && err.kind === "unavailable"
);
pass("offline", "Failed to fetch is unavailable");

console.log(lines.join("\n"));
