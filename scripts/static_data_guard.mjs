#!/usr/bin/env node
/**
 * Shrink / validity guard for static data refreshes.
 *
 * A pack is rejected if it is missing, empty, invalid JSON, or has lost
 * more than 50% of its records versus the previous version. Byte size is
 * used only when there is no record count (pretty-printed JSON rewritten
 * as minified can drop more than 50% of its bytes with the same records).
 * pack.json is only checked for valid, non-empty JSON (it is a tiny
 * manifest and its size fluctuates with the dataset list).
 *
 * Used by scripts/refresh_static_data.mjs (before keeping a write) and
 * as a CLI by .github/workflows/refresh-static-data.yml (restores the
 * committed copy of any rejected file before the bot opens a PR).
 *
 * Usage: node scripts/static_data_guard.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SHRINK_RATIO = 0.5;

export const PACK_FILES = [
  { file: "visualizer/data/websdr.json", list: "stations" },
  { file: "visualizer/data/gpsjam.json", list: "zones" },
  { file: "visualizer/data/conflicts.json", list: "conflicts" },
  { file: "visualizer/data/streams.json", list: "points" },
  { file: "visualizer/data/radio.json", list: "points" },
  { file: "visualizer/data/catalog.json", list: "searches" },
  { file: "visualizer/data/pack.json", list: null, meta: true },
  { file: "globalstatus/api/websdr.json", list: "stations" },
  { file: "globalstatus/api/gpsjam.json", list: "zones" },
  { file: "globalstatus/api/conflicts.json", list: "conflicts" },
  { file: "globalstatus/api/streams.json", list: "points" },
  { file: "globalstatus/api/radio.json", list: "points" },
  { file: "globalstatus/api/catalog.json", list: "searches" },
];

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function inspectRaw(raw, listKey) {
  const text = raw == null ? "" : String(raw);
  const bytes = Buffer.byteLength(text);
  if (!text.trim()) {
    return { exists: true, valid: false, bytes, records: 0, raw: text, data: null, error: "empty" };
  }
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object") {
      return {
        exists: true,
        valid: false,
        bytes,
        records: 0,
        raw: text,
        data: null,
        error: "JSON is not an object",
      };
    }
    const records = listKey ? (Array.isArray(data[listKey]) ? data[listKey].length : 0) : null;
    return { exists: true, valid: true, bytes, records, raw: text, data, error: null };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      bytes,
      records: 0,
      raw: text,
      data: null,
      error: `invalid JSON (${err.message})`,
    };
  }
}

export function inspectFile(file, listKey) {
  if (!file || !existsSync(file)) {
    return { exists: false, valid: false, bytes: 0, records: 0, raw: null, data: null, error: "missing" };
  }
  return inspectRaw(readFileSync(file, "utf8"), listKey);
}

/**
 * Return a reason to keep `prev` (or skip `next`), or null if `next` is fine.
 *
 * Record counts are the primary signal. Pretty-printed JSON rewritten as
 * minified can lose well over 50% of its bytes without losing any records
 * (that was the 2,920-line diff on run 45431314641). Byte size is only
 * used when there is no record count to compare.
 */
export function shrinkReason(prev, next, { meta = false } = {}) {
  if (!next || !next.exists) return "new snapshot is missing";
  if (!next.valid) return `new snapshot is ${next.error}`;
  if (meta) return null;
  if (!prev || !prev.exists || !prev.valid) return null;
  if (typeof prev.records === "number" && prev.records > 0) {
    if ((next.records ?? 0) < prev.records * SHRINK_RATIO) {
      return `new snapshot shrank from ${prev.records} to ${next.records ?? 0} records (over 50%)`;
    }
    return null;
  }
  if (prev.bytes > 0 && next.bytes < prev.bytes * SHRINK_RATIO) {
    return `new snapshot shrank from ${prev.bytes} to ${next.bytes} bytes (over 50%)`;
  }
  return null;
}

function inspectHead(root, rel, listKey) {
  try {
    const raw = execFileSync("git", ["show", `HEAD:${rel}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return inspectRaw(raw, listKey);
  } catch {
    return null;
  }
}

function isChanged(root, rel) {
  const out = execFileSync("git", ["status", "--porcelain", "--", rel], {
    cwd: root,
    encoding: "utf8",
  });
  return out.trim().length > 0;
}

export function restoreFromHead(root, rel) {
  execFileSync("git", ["checkout", "HEAD", "--", rel], { cwd: root });
}

export function runGuard(root = repoRoot()) {
  let skipped = 0;
  let kept = 0;
  for (const spec of PACK_FILES) {
    if (!isChanged(root, spec.file)) continue;
    const abs = path.join(root, spec.file);
    const next = inspectFile(abs, spec.list);
    const prev = inspectHead(root, spec.file, spec.list);
    const reason = shrinkReason(prev, next, { meta: !!spec.meta });
    if (reason) {
      if (prev && prev.exists) {
        restoreFromHead(root, spec.file);
        console.warn(`skipped ${spec.file}: ${reason} (restored committed copy)`);
      } else if (existsSync(abs)) {
        unlinkSync(abs);
        console.warn(`skipped ${spec.file}: ${reason} (removed uncommitted file)`);
      } else {
        console.warn(`skipped ${spec.file}: ${reason}`);
      }
      skipped += 1;
    } else {
      console.log(`ok ${spec.file}: ${next.bytes} bytes, ${next.records ?? "n/a"} records`);
      kept += 1;
    }
  }
  console.log(`shrink guard: kept ${kept}, skipped ${skipped}`);
  return { kept, skipped };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runGuard();
