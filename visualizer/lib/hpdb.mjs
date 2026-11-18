import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISPLAY_CAP = 4000;

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

export function findHpdbPath() {
  const explicit = process.env.BT885_HPDB;
  if (explicit && existsSync(explicit)) return explicit;
  const dirs = [
    process.env.BT885_HPDB_DIR,
    path.join(os.homedir(), "Downloads", "BT885_radio_database"),
    path.join(HERE, "data"),
    path.join(HERE, "..", "data"),
    path.join(HERE, "..", "..", "data"),
  ].filter(Boolean);
  for (const dir of dirs) {
    const found = latestHpdbIn(dir);
    if (found) return found;
  }
  return null;
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
      if (current.mhz.length < 3) {
        const mhz = mhzFromRaw(cols[5]);
        if (mhz != null) current.mhz.push(mhz);
      }
    } else if (kind === "T-Freq" && current.mode === "Trunk site") {
      current.n += 1;
      if (current.mhz.length < 3) {
        const mhz = mhzFromRaw(cols[5]);
        if (mhz != null) current.mhz.push(mhz);
      }
    }
  }
  return { groups, dateModified };
}

export async function loadRadioOverlay() {
  const file = findHpdbPath();
  if (!file) {
    throw new Error("HPDB not found. Set BT885_HPDB to MasterHpdb_*.gz or BT885_HPDB_DIR to the folder that holds it.");
  }
  const cache = `${file}.radio-overlay.json`;
  const srcStat = statSync(file);
  if (existsSync(cache)) {
    try {
      const cached = JSON.parse(readFileSync(cache, "utf8"));
      if (cached.version === 2 && cached.sourceMtimeMs === srcStat.mtimeMs && Array.isArray(cached.points)) {
        return cached;
      }
    } catch {
      /* rebuild */
    }
  }
  const { groups, dateModified } = await parseHpdb(file);
  const points = gridSample(groups, DISPLAY_CAP).map(compact);
  const payload = {
    version: 2,
    source: path.basename(file),
    sourcePath: file,
    sourceMtimeMs: srcStat.mtimeMs,
    updated: dateModified || null,
    count: groups.length,
    points,
  };
  try {
    writeFileSync(cache, JSON.stringify(payload));
  } catch {
    /* cache is optional */
  }
  return payload;
}
