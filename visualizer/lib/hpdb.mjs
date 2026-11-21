import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { fetchLatestHpdb } from "./hpdb-ftp.mjs";
import { offline, readDataset, writeDataset } from "./datapack.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISPLAY_CAP = 4000;
const FREQ_CAP = 16;
const STALE_MS = Number(process.env.BT885_FTP_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000;
let ensuring = null;

function parseStamp(name) {
  const m = name.match(/(\d{1,2})_(\d{1,2})_(\d{4})/);
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

function latestHpdbIn(dir) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => /^MasterHpdb_.*\.gz$/i.test(name))
    .sort((a, b) => parseStamp(a) - parseStamp(b));
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]);
}

export function hpdbCacheDir() {
  if (process.env.BT885_HPDB_DIR) return process.env.BT885_HPDB_DIR;
  if (process.env.HPDB_CACHE) return process.env.HPDB_CACHE;
  if (process.env.FLY_APP_NAME) return "/tmp/downtime-hpdb";
  return path.join(os.homedir(), ".cache/downtime/hpdb");
}

export function findHpdbPath() {
  const explicit = process.env.BT885_HPDB;
  if (explicit && existsSync(explicit)) return explicit;
  const dirs = [
    process.env.BT885_HPDB_DIR,
    path.join(os.homedir(), "Downloads", "BT885_radio_database"),
    path.join(HERE, "data"),
    path.join(HERE, "..", "data"),
    path.join(HERE, "..", "..", "data"),
    hpdbCacheDir(),
  ].filter(Boolean);
  const seen = new Set();
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const found = latestHpdbIn(dir);
    if (found) return found;
  }
  return null;
}

function ftpEnabled() {
  if (offline()) return false;
  // Uniden's installer login is not committed; set BT885_FTP_USER / BT885_FTP_PASS.
  if (!process.env.BT885_FTP_USER || !process.env.BT885_FTP_PASS) return false;
  const flag = String(process.env.BT885_FTP || "1").trim().toLowerCase();
  return flag !== "0" && flag !== "off" && flag !== "false";
}

function isFresh(file) {
  try {
    return Date.now() - statSync(file).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
}

async function ensureHpdbOnce() {
  const existing = findHpdbPath();
  if (existing && isFresh(existing)) return existing;
  if (!ftpEnabled()) return existing;
  const dir = hpdbCacheDir();
  mkdirSync(dir, { recursive: true });
  try {
    console.log("hpdb ftp: pulling latest MasterHpdb from ftp.uniden.com/BT885");
    const downloaded = await fetchLatestHpdb(dir);
    console.log(`hpdb ftp: ${downloaded}`);
    return downloaded || existing;
  } catch (err) {
    if (existing) {
      console.error("hpdb ftp:", err.message || err);
      return existing;
    }
    throw err;
  }
}

export function ensureHpdb() {
  if (!ensuring) {
    ensuring = ensureHpdbOnce().catch((err) => {
      ensuring = null;
      throw err;
    });
  }
  return ensuring;
}

function latLonFromCols(cols) {
  for (let i = 4; i < cols.length - 1; i += 1) {
    const lat = Number(cols[i]);
    const lon = Number(cols[i + 1]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180 &&
      /[-+]?\d+\.\d+/.test(cols[i]) &&
      /[-+]?\d+\.\d+/.test(cols[i + 1])
    ) {
      return { lat, lon };
    }
  }
  return null;
}

function mhzFromRaw(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mhz = n > 10000 ? n / 1e6 : n;
  if (mhz < 25 || mhz > 1300) return null;
  return Math.round(mhz * 10000) / 10000;
}

function gridSample(points, cap) {
  if (points.length <= cap) return points;
  const cell = 0.35;
  const buckets = new Map();
  for (const p of points) {
    const key = `${Math.round(p.lat / cell)}:${Math.round(p.lon / cell)}`;
    const prev = buckets.get(key);
    if (!prev || (p.n || 0) > (prev.n || 0)) buckets.set(key, p);
  }
  let picked = [...buckets.values()];
  if (picked.length > cap) {
    picked.sort((a, b) => (b.n || 0) - (a.n || 0));
    picked = picked.slice(0, cap);
  } else if (picked.length < cap) {
    const have = new Set(picked.map((p) => `${p.lat}:${p.lon}:${p.name}`));
    const rest = points
      .filter((p) => !have.has(`${p.lat}:${p.lon}:${p.name}`))
      .sort((a, b) => (b.n || 0) - (a.n || 0));
    for (const p of rest) {
      picked.push(p);
      if (picked.length >= cap) break;
    }
  }
  return picked;
}

function compact(point, index) {
  return {
    id: `radio-${index}`,
    lat: point.lat,
    lon: point.lon,
    name: point.name,
    mode: point.mode,
    n: point.n,
    mhz: point.mhz,
  };
}

async function parseHpdb(file) {
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  const groups = [];
  let current = null;
  let dateModified = null;
  for await (const line of rl) {
    if (!line || line[0] === "<") continue;
    const cols = line.split("\t");
    const kind = cols[0];
    if (kind === "DateModified" && !dateModified) {
      dateModified = cols[1] || cols.slice(1).join(" ").trim();
      continue;
    }
    if (kind === "C-Group" || kind === "Site") {
      const loc = latLonFromCols(cols);
      if (!loc) {
        current = null;
        continue;
      }
      const name = (cols[3] || kind).trim() || kind;
      current = {
        lat: loc.lat,
        lon: loc.lon,
        name,
        mode: kind === "Site" ? "Trunk site" : "Conventional",
        n: 0,
        mhz: [],
      };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    if (kind === "C-Freq" && current.mode === "Conventional") {
      current.n += 1;
      if (current.mhz.length < FREQ_CAP) {
        const mhz = mhzFromRaw(cols[5]);
        if (mhz != null) current.mhz.push(mhz);
      }
    } else if (kind === "T-Freq" && current.mode === "Trunk site") {
      current.n += 1;
      if (current.mhz.length < FREQ_CAP) {
        const mhz = mhzFromRaw(cols[5]);
        if (mhz != null) current.mhz.push(mhz);
      }
    }
  }
  return { groups, dateModified };
}

async function parseHpdbIndex(file) {
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  const states = {};
  const counties = {};
  const agencyCounties = new Map();
  const groups = [];
  for await (const line of rl) {
    if (!line || line[0] === "<") continue;
    const cols = line.split("\t");
    const kind = cols[0];
    if (kind === "StateInfo") {
      const id = Number(String(cols[1] || "").split("=")[1]);
      const countryId = Number(String(cols[2] || "").split("=")[1]);
      if (!Number.isFinite(id)) continue;
      states[id] = {
        id,
        countryId: Number.isFinite(countryId) ? countryId : 0,
        name: cols[3] || "",
        abbr: cols[4] || "",
      };
      continue;
    }
    if (kind === "CountyInfo") {
      const id = Number(String(cols[1] || "").split("=")[1]);
      const stateId = Number(String(cols[2] || "").split("=")[1]);
      if (!Number.isFinite(id)) continue;
      counties[id] = { id, stateId, name: cols[3] || "", lat: null, lon: null, n: 0 };
      continue;
    }
    if (kind === "AreaCounty") {
      const agencyId = Number(String(cols[1] || "").split("=")[1]);
      const countyId = Number(String(cols[2] || "").split("=")[1]);
      if (!Number.isFinite(agencyId) || !Number.isFinite(countyId) || countyId <= 0) continue;
      if (!agencyCounties.has(agencyId)) agencyCounties.set(agencyId, new Set());
      agencyCounties.get(agencyId).add(countyId);
      continue;
    }
    if (kind === "C-Group" || kind === "Site") {
      const loc = latLonFromCols(cols);
      if (!loc) continue;
      const agencyId = Number(String(cols[2] || "").split("=")[1]);
      groups.push({
        lat: loc.lat,
        lon: loc.lon,
        name: (cols[3] || kind).trim() || kind,
        mode: kind === "Site" ? "Trunk site" : "Conventional",
        agencyId: Number.isFinite(agencyId) ? agencyId : null,
      });
    }
  }
  const countyGroups = new Map();
  const coords = new Map();
  for (const group of groups) {
    const ids = new Set(agencyCounties.get(group.agencyId) || []);
    if (group.agencyId != null && counties[group.agencyId]) ids.add(group.agencyId);
    for (const countyId of ids) {
      if (!countyGroups.has(countyId)) countyGroups.set(countyId, []);
      countyGroups.get(countyId).push(group);
      const county = counties[countyId];
      if (!county) continue;
      county.n += 1;
      let bucket = coords.get(countyId);
      if (!bucket) {
        bucket = { lats: [], lons: [] };
        coords.set(countyId, bucket);
      }
      bucket.lats.push(group.lat);
      bucket.lons.push(group.lon);
    }
  }
  for (const county of Object.values(counties)) {
    const bucket = coords.get(county.id);
    if (!bucket || !bucket.lats.length) continue;
    county.lat = median(bucket.lats);
    county.lon = median(bucket.lons);
  }
  return {
    states,
    counties,
    countyGroups: Object.fromEntries([...countyGroups.entries()].map(([id, list]) => [id, list])),
    groups,
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

const COUNTRY_META = {
  1: { id: 1, name: "United States", unit: "State" },
  2: { id: 2, name: "Canada", unit: "Province" },
};

export function regionKindFor(state) {
  const abbr = String(state?.abbr || "").toUpperCase();
  const countryId = Number(state?.countryId);
  if (countryId === 2) {
    if (abbr === "QC") return "Region";
    return "Municipality";
  }
  if (abbr === "LA") return "Parish";
  if (abbr === "AK") return "Borough";
  if (abbr === "PR") return "Municipality";
  if (abbr === "DC") return "District";
  return "County";
}

export function regionLabel(name, kind) {
  const n = String(name || "").trim();
  if (!n) return kind || "Region";
  if (!kind) return n;
  if (new RegExp(`\\b${kind}\\b`, "i").test(n)) return n;
  return `${n} ${kind}`;
}

function emptyIndex(error) {
  return {
    version: 3,
    source: null,
    states: {},
    counties: {},
    countyGroups: {},
    groups: [],
    error: error || null,
  };
}

function lookup(map, id) {
  if (!map) return null;
  return map[id] || map[String(id)] || null;
}

function buildRadioTree(index) {
  const states = [];
  const byCountry = {};
  for (const state of Object.values(index.states || {})) {
    if (!state || !state.id) continue;
    const country = COUNTRY_META[state.countryId];
    if (!country) continue;
    const kind = regionKindFor(state);
    let nRegions = 0;
    let lat = 0;
    let lon = 0;
    let weight = 0;
    const seen = new Set();
    for (const county of Object.values(index.counties || {})) {
      if (county.stateId !== state.id || !county.n) continue;
      nRegions += 1;
      const groups = lookup(index.countyGroups, county.id) || [];
      for (const group of groups) seen.add(`${group.name}|${group.lat}|${group.lon}`);
      if (county.lat != null && county.lon != null) {
        lat += county.lat;
        lon += county.lon;
        weight += 1;
      }
    }
    if (!nRegions) continue;
    const nSites = seen.size;
    states.push({
      id: state.id,
      countryId: state.countryId,
      name: state.name,
      abbr: state.abbr,
      unit: country.unit,
      regionKind: kind,
      nRegions,
      nSites,
      lat: weight ? lat / weight : null,
      lon: weight ? lon / weight : null,
      kind: "state",
    });
    if (!byCountry[country.id]) {
      byCountry[country.id] = { ...country, nStates: 0, nRegions: 0, nSites: 0 };
    }
    byCountry[country.id].nStates += 1;
    byCountry[country.id].nRegions += nRegions;
    byCountry[country.id].nSites += nSites;
  }
  states.sort((a, b) => a.name.localeCompare(b.name));
  return {
    source: index.source || null,
    error: index.error || null,
    countries: Object.values(byCountry).sort((a, b) => a.id - b.id),
    states,
  };
}

export async function loadHpdbIndex() {
  let file;
  try {
    file = await ensureHpdb();
  } catch (err) {
    return emptyIndex(err.message || String(err));
  }
  if (!file) {
    return emptyIndex("HPDB not found. Set BT885_HPDB to MasterHpdb_*.gz or BT885_HPDB_DIR, or allow BT885_FTP to pull it from Uniden.");
  }
  const cache = `${file}.hpdb-index.json`;
  const srcStat = statSync(file);
  if (existsSync(cache)) {
    try {
      const cached = JSON.parse(readFileSync(cache, "utf8"));
      if (cached.version === 3 && cached.sourceMtimeMs === srcStat.mtimeMs && cached.groups) {
        return cached;
      }
    } catch {
      /* rebuild */
    }
  }
  const parsed = await parseHpdbIndex(file);
  const payload = {
    version: 3,
    source: path.basename(file),
    sourcePath: file,
    sourceMtimeMs: srcStat.mtimeMs,
    states: parsed.states,
    counties: parsed.counties,
    countyGroups: parsed.countyGroups,
    groups: parsed.groups,
  };
  try {
    writeFileSync(cache, JSON.stringify(payload));
  } catch {
    /* optional */
  }
  return payload;
}

export async function loadRadioTree() {
  const index = await loadHpdbIndex();
  return buildRadioTree(index);
}

export async function loadRadioState(stateId) {
  const id = Number(stateId);
  const index = await loadHpdbIndex();
  const state = lookup(index.states, id);
  if (!Number.isFinite(id) || !state) {
    return { source: index.source || null, error: "state not found", state: null, regions: [] };
  }
  const tree = buildRadioTree(index);
  const summary = tree.states.find((row) => row.id === id) || {
    id: state.id,
    countryId: state.countryId,
    name: state.name,
    abbr: state.abbr,
    unit: COUNTRY_META[state.countryId]?.unit || "State",
    regionKind: regionKindFor(state),
    nRegions: 0,
    nSites: 0,
    lat: null,
    lon: null,
    kind: "state",
  };
  const kind = summary.regionKind;
  const regions = Object.values(index.counties || {})
    .filter((county) => county.stateId === id && county.n && county.lat != null && county.lon != null)
    .map((county) => ({
      id: county.id,
      stateId: id,
      name: county.name,
      label: regionLabel(county.name, kind),
      kind,
      n: county.n,
      lat: county.lat,
      lon: county.lon,
      level: "region",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    source: index.source || null,
    error: index.error || null,
    state: summary,
    regions,
  };
}

export async function loadRadioCounty(countyId) {
  const id = Number(countyId);
  const index = await loadHpdbIndex();
  const county = lookup(index.counties, id);
  if (!Number.isFinite(id) || !county) {
    return { source: index.source || null, error: "region not found", region: null, sites: [] };
  }
  const stateRow = lookup(index.states, county.stateId) || { id: county.stateId, name: "", abbr: "", countryId: 0 };
  const kind = regionKindFor(stateRow);
  const country = COUNTRY_META[stateRow.countryId];
  const groups = lookup(index.countyGroups, id) || [];
  const sites = groups.map((group, i) => ({
    id: `radio-${id}-${i}`,
    countyId: id,
    stateId: county.stateId,
    name: group.name,
    mode: group.mode,
    lat: group.lat,
    lon: group.lon,
    n: 0,
    mhz: [],
    kind: "site",
  }));
  return {
    source: index.source || null,
    error: index.error || null,
    state: {
      id: stateRow.id,
      countryId: stateRow.countryId,
      name: stateRow.name,
      abbr: stateRow.abbr,
      unit: country?.unit || "State",
      regionKind: kind,
      kind: "state",
    },
    region: {
      id: county.id,
      stateId: county.stateId,
      name: county.name,
      label: regionLabel(county.name, kind),
      kind,
      n: county.n || sites.length,
      lat: county.lat,
      lon: county.lon,
      level: "region",
    },
    sites,
  };
}

export async function loadRadioOverlay() {
  let file;
  try {
    file = await ensureHpdb();
  } catch (err) {
    return {
      version: 3,
      source: null,
      count: 0,
      points: [],
      error: err.message || String(err),
    };
  }
  if (!file) {
    const packed = readDataset("radio");
    if (packed?.points?.length) return { ...packed, stale: true };
    return {
      version: 3,
      source: null,
      count: 0,
      points: [],
      error: "HPDB not found. Set BT885_HPDB to MasterHpdb_*.gz or BT885_HPDB_DIR, or allow BT885_FTP to pull it from Uniden.",
    };
  }
  const cache = `${file}.radio-overlay.json`;
  const srcStat = statSync(file);
  if (existsSync(cache)) {
    try {
      const cached = JSON.parse(readFileSync(cache, "utf8"));
      if (cached.version === 3 && cached.sourceMtimeMs === srcStat.mtimeMs && Array.isArray(cached.points)) {
        try { writeDataset("radio", cached); } catch { /* optional */ }
        return cached;
      }
    } catch {
      /* rebuild */
    }
  }
  const { groups, dateModified } = await parseHpdb(file);
  const points = gridSample(groups, DISPLAY_CAP).map(compact);
  const payload = {
    version: 3,
    source: path.basename(file),
    sourcePath: file,
    sourceMtimeMs: srcStat.mtimeMs,
    updated: dateModified || null,
    count: groups.length,
    points,
  };
  try {
    writeFileSync(cache, JSON.stringify(payload));
    writeDataset("radio", payload);
  } catch {
    /* cache is optional */
  }
  return payload;
}
