#!/usr/bin/env node
/**
 * Fetch static overlay JSON into visualizer/data and copy into globalstatus/api.
 *
 * Usage:
 *   node scripts/refresh_static_data.mjs overlays
 *   DATASETS=streams,radio node scripts/refresh_static_data.mjs
 *
 * Groups: overlays, streams, radio, catalog, all
 * Live AIR / AIS / GPSInterference feeds are not refreshed here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packDir, snapshot } from "../visualizer/lib/datapack.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = path.join(ROOT, "globalstatus", "api");

const GROUPS = {
  overlays: ["websdr", "gpsjam", "conflicts", "catalog"],
  streams: ["streams"],
  radio: ["radio"],
  catalog: ["catalog"],
  all: ["catalog", "websdr", "gpsjam", "conflicts", "streams", "radio"],
};

const COPY = {
  websdr: { file: "websdr.json", list: "stations" },
  gpsjam: { file: "gpsjam.json", list: "zones" },
  conflicts: { file: "conflicts.json", list: "conflicts" },
  streams: { file: "streams.json", list: "points" },
  radio: { file: "radio.json", list: "points" },
  catalog: { file: "catalog.json", list: "searches" },
};

function expand(raw) {
  const parts = String(raw || "overlays")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (GROUPS[part]) out.push(...GROUPS[part]);
    else out.push(part);
  }
  return [...new Set(out)];
}

function listLen(data, key) {
  if (!key) return 1;
  const value = data[key];
  return Array.isArray(value) ? value.length : 0;
}

function copyIfGood(name) {
  const spec = COPY[name];
  if (!spec) return;
  const src = path.join(packDir(), spec.file);
  const dest = path.join(API, spec.file);
  if (!existsSync(src)) {
    console.warn(`skip ${name}: no pack file ${src}`);
    return;
  }
  const next = JSON.parse(readFileSync(src, "utf8"));
  const n = listLen(next, spec.list);
  if (n === 0 && existsSync(dest)) {
    try {
      const prev = JSON.parse(readFileSync(dest, "utf8"));
      if (listLen(prev, spec.list) > 0) {
        console.warn(`keep existing api/${spec.file}; new snapshot is empty`);
        return;
      }
    } catch {
      /* replace unreadable dest */
    }
  }
  mkdirSync(API, { recursive: true });
  copyFileSync(src, dest);
  console.log(`api ${spec.file} (${n})`);
}

const datasets = expand(process.env.DATASETS || process.argv[2] || "overlays");
console.log(`refresh ${datasets.join(",")}`);
await snapshot(datasets);
for (const name of datasets) copyIfGood(name);
