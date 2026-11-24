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
 *
 * After each snapshot, a shrink guard keeps the previous file when the new
 * one is invalid, empty, or has lost more than 50% of its records (byte size
 * is used only when there is no record count).
 * The same rule is applied again in CI by scripts/static_data_guard.mjs
 * before a PR is opened.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packDir, snapshot } from "../visualizer/lib/datapack.mjs";
import { inspectFile, shrinkReason } from "./static_data_guard.mjs";

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

function rememberPacks(names) {
  const prev = new Map();
  for (const name of names) {
    const spec = COPY[name];
    if (!spec) continue;
    const file = path.join(packDir(), spec.file);
    prev.set(spec.file, { spec, file, inspect: inspectFile(file, spec.list) });
  }
  const packManifest = path.join(packDir(), "pack.json");
  prev.set("pack.json", {
    spec: { file: "pack.json", list: null, meta: true },
    file: packManifest,
    inspect: inspectFile(packManifest, null),
  });
  return prev;
}

function restoreShrunkenPacks(prevByFile) {
  for (const [key, saved] of prevByFile) {
    const next = inspectFile(saved.file, saved.spec.list);
    const reason = shrinkReason(saved.inspect, next, { meta: !!saved.spec.meta });
    if (!reason) continue;
    if (saved.inspect && saved.inspect.exists && saved.inspect.raw != null) {
      writeFileSync(saved.file, saved.inspect.raw);
      console.warn(`keep existing ${saved.file}; ${reason}`);
    } else {
      console.warn(`skip ${key}; ${reason} (no previous pack to restore)`);
    }
  }
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
  const next = inspectFile(src, spec.list);
  const prev = inspectFile(dest, spec.list);
  const reason = shrinkReason(prev, next);
  if (reason) {
    if (prev.exists) {
      console.warn(`keep existing api/${spec.file}; ${reason}`);
      return;
    }
    console.warn(`skip api/${spec.file}; ${reason}`);
    return;
  }
  mkdirSync(API, { recursive: true });
  copyFileSync(src, dest);
  console.log(`api ${spec.file} (${next.records})`);
}

const datasets = expand(process.env.DATASETS || process.argv[2] || "overlays");
console.log(`refresh ${datasets.join(",")}`);
const previous = rememberPacks(datasets);
await snapshot(datasets);
restoreShrunkenPacks(previous);
for (const name of datasets) copyIfGood(name);
