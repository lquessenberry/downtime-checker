const UA = { "User-Agent": "downtime-checker/1.0 (globe visualizer)" };

const CFR_COORDS = {
  "al-shabab-somalia": [2.05, 45.32],
  "civil-war-libya": [32.89, 13.19],
  "civil-war-south-sudan": [4.86, 31.57],
  "conflict-between-india-and-pakistan": [34.15, 74.8],
  "conflict-between-turkey-and-armed-kurdish-groups": [37.3, 43.5],
  "conflict-ethiopia": [9.03, 38.74],
  "conflict-syria": [33.51, 36.29],
  "conflict-ukraine": [48.45, 35.0],
  "confrontation-between-united-states-and-iran": [32.0, 53.0],
  "confrontation-over-taiwan": [23.7, 121.0],
  "criminal-violence-mexico": [19.43, -99.13],
  "instability-haiti": [18.54, -72.34],
  "instability-venezuela": [10.48, -66.9],
  "israeli-palestinian-conflict": [31.5, 34.75],
  "nagorno-karabakh-conflict": [39.82, 46.75],
  "north-korea-crisis": [39.04, 125.75],
  "political-instability-iraq": [33.3, 44.4],
  "political-instability-lebanon": [33.85, 35.5],
  "power-struggle-sudan": [15.5, 32.5],
  "rohingya-crisis-myanmar": [20.0, 96.0],
  "territorial-disputes-south-china-sea": [12.0, 114.0],
  "violence-central-african-republic": [4.39, 18.56],
  "violence-democratic-republic-congo": [-1.7, 29.2],
  "violent-extremism-sahel": [15.0, 0.0],
  "violent-instability-northern-triangle": [14.6, -88.0],
  "war-afghanistan": [34.53, 69.17],
  "war-yemen": [15.35, 44.2],
};

function emptyLayer(source = "") {
  return { points: [], count: 0, updated: null, source, error: null, at: 0 };
}

const layers = {
  jamming: emptyLayer("gpsinterference.com"),
  aircraft: emptyLayer("adsb.lol"),
  ships: emptyLayer("digitraffic"),
  conflicts: emptyLayer("cfr.org"),
};

const shipsLive = new Map();
let aisSocket = null;

async function pull(url, headers = {}) {
  const res = await fetch(url, {
    headers: { ...UA, ...headers },
    signal: AbortSignal.timeout(28000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

function titleFromSlug(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sample(list, cap) {
  if (list.length <= cap) return list;
  const out = [];
  const step = list.length / cap;
  for (let i = 0; i < cap; i += 1) out.push(list[Math.floor(i * step)]);
  return out;
}

async function refreshJamming() {
  const res = await pull("https://api.gpsinterference.com/v1/interference/latest");
  const data = await res.json();
  const jammed = [];
  for (const hex of data.hexes || []) {
    if (!hex || hex.c === "g" || !Array.isArray(hex.poly) || hex.poly.length < 3) continue;
    let lat = 0;
    let lon = 0;
    for (const pt of hex.poly) {
      lat += Number(pt[0]);
      lon += Number(pt[1]);
    }
    jammed.push({
      lat: lat / hex.poly.length,
      lon: lon / hex.poly.length,
      band: hex.c,
      bad: Number(hex.b) || 0,
      good: Number(hex.g) || 0,
      pct: Number(hex.p) || 0,
      name: `GPS ${hex.c === "p" ? "severe" : hex.c === "r" ? "heavy" : "degraded"}`,
    });
  }
  jammed.sort((a, b) => b.pct - a.pct);
  const purple = jammed.filter((p) => p.band === "p");
  const red = jammed.filter((p) => p.band === "r");
  const yellow = jammed.filter((p) => p.band === "y");
  const points = [...purple, ...red, ...sample(yellow, 700)].slice(0, 1400);
  layers.jamming = {
    points,
    count: jammed.length,
    updated: data.updated || new Date().toISOString(),
    source: "GPSInterference.com",
    error: null,
    at: Date.now(),
  };
}

async function refreshAircraft() {
  try {
    const res = await pull("https://api.adsb.lol/v2/ladd");
    const data = await res.json();
    const points = [];
    for (const ac of data.ac || []) {
      const lat = Number(ac.lat);
      const lon = Number(ac.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push({
        lat,
        lon,
        name: String(ac.flight || ac.r || ac.hex || "aircraft").trim(),
        alt: ac.alt_baro ?? ac.alt_geom ?? null,
        track: Number(ac.track) || 0,
        gs: ac.gs ?? null,
      });
    }
    layers.aircraft = {
      points: sample(points, 900),
      count: points.length,
      updated: new Date().toISOString(),
      source: "adsb.lol",
      error: null,
      at: Date.now(),
    };
    return;
  } catch (adsbErr) {
    const res = await pull("https://opensky-network.org/api/states/all");
    const data = await res.json();
    const points = [];
    for (const row of data.states || []) {
      const lon = Number(row[5]);
      const lat = Number(row[6]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push({
        lat,
        lon,
        name: String(row[1] || row[0] || "aircraft").trim(),
        alt: row[7],
        track: Number(row[10]) || 0,
        gs: row[9],
      });
    }
    layers.aircraft = {
      points: sample(points, 900),
      count: points.length,
      updated: new Date().toISOString(),
      source: "OpenSky Network",
      error: adsbErr.message,
      at: Date.now(),
    };
  }
}

async function refreshShipsRest() {
  if (process.env.AISSTREAM_API_KEY) return;
  const res = await pull("https://meri.digitraffic.fi/api/ais/v1/locations", {
    Accept: "application/geo+json",
    "Accept-Encoding": "gzip",
  });
  const data = await res.json();
  const points = [];
  for (const feat of data.features || []) {
    const coords = feat.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const props = feat.properties || {};
    points.push({
      lat: coords[1],
      lon: coords[0],
      name: String(props.mmsi || feat.mmsi || "vessel"),
      sog: props.sog,
      cog: props.cog,
    });
  }
  layers.ships = {
    points: sample(points, 900),
    count: points.length,
    updated: data.dataUpdatedTime || new Date().toISOString(),
    source: "Digitraffic AIS (Baltic)",
    error: null,
    at: Date.now(),
  };
}

function flushAisStream() {
  const now = Date.now();
  const points = [];
  for (const [mmsi, ship] of shipsLive) {
    if (now - ship.ts > 12 * 60 * 1000) {
      shipsLive.delete(mmsi);
      continue;
    }
    points.push(ship);
  }
  layers.ships = {
    points: sample(points, 1400),
    count: shipsLive.size,
    updated: new Date().toISOString(),
    source: "aisstream.io",
    error: null,
    at: now,
  };
}

function startAisStream() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key || aisSocket) return;
  try {
    aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream");
  } catch (err) {
    layers.ships.error = err.message;
    return;
  }
  aisSocket.addEventListener("open", () => {
    aisSocket.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport"],
    }));
    layers.ships.source = "aisstream.io";
    layers.ships.error = null;
  });
  aisSocket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      const meta = msg.MetaData || {};
      const lat = Number(meta.latitude);
      const lon = Number(meta.longitude);
      const mmsi = String(meta.MMSI || msg.Message?.PositionReport?.UserID || "");
      if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      shipsLive.set(mmsi, {
        lat,
        lon,
        name: String(meta.ShipName || mmsi).trim(),
        sog: msg.Message?.PositionReport?.Sog,
        cog: msg.Message?.PositionReport?.Cog,
        ts: Date.now(),
      });
    } catch {
      /* ignore malformed frames */
    }
  });
  aisSocket.addEventListener("close", () => {
    aisSocket = null;
    setTimeout(startAisStream, 8000);
  });
  aisSocket.addEventListener("error", () => {
    layers.ships.error = "aisstream socket error";
  });
}

async function refreshConflicts() {
  const res = await pull("https://www.cfr.org/global-conflict-tracker");
  const html = await res.text();
  const slugs = [...html.matchAll(/\/global-conflict-tracker\/conflict\/([a-z0-9-]+)/g)].map((m) => m[1]);
  const unique = [...new Set(slugs.length ? slugs : Object.keys(CFR_COORDS))];
  const points = [];
  for (const slug of unique) {
    const coords = CFR_COORDS[slug];
    if (!coords) continue;
    points.push({
      lat: coords[0],
      lon: coords[1],
      name: titleFromSlug(slug),
      slug,
      url: `https://www.cfr.org/global-conflict-tracker/conflict/${slug}`,
    });
  }
  layers.conflicts = {
    points,
    count: points.length,
    updated: new Date().toISOString(),
    source: "CFR Global Conflict Tracker (theater markers)",
    error: slugs.length ? null : "used bundled slug list",
    at: Date.now(),
  };
}

function guard(name, fn) {
  return fn().catch((err) => {
    layers[name].error = err.message || String(err);
    layers[name].at = Date.now();
    console.error(`feed ${name}:`, err.message || err);
  });
}

export function snapshotFeeds() {
  return {
    jamming: { ...layers.jamming, points: layers.jamming.points },
    aircraft: { ...layers.aircraft, points: layers.aircraft.points },
    ships: { ...layers.ships, points: layers.ships.points },
    conflicts: { ...layers.conflicts, points: layers.conflicts.points },
  };
}

export function startFeeds() {
  startAisStream();
  const run = (name, fn) => guard(name, fn);
  run("jamming", refreshJamming);
  run("aircraft", refreshAircraft);
  run("ships", refreshShipsRest);
  run("conflicts", refreshConflicts);
  setInterval(() => run("jamming", refreshJamming), 20 * 60 * 1000);
  setInterval(() => run("aircraft", refreshAircraft), 30 * 1000);
  setInterval(() => run("ships", refreshShipsRest), 20 * 1000);
  setInterval(() => run("conflicts", refreshConflicts), 6 * 60 * 60 * 1000);
  setInterval(() => {
    if (process.env.AISSTREAM_API_KEY) flushAisStream();
  }, 4000);
}
