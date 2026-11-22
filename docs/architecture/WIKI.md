# gsa-rust — Architecture Wiki

_Deterministically generated from signatures + dependency graph by SigMap v8.85.1 — no LLM. Regenerate: `sigmap wiki`._

## Overview
The codebase spans **117 indexed files** across **6 top-level modules**, with ~13168 tokens of extracted signatures.
Context health: **100/100 (A)**.

## Modules
| Module | Files | Sig tokens | Key files |
|--------|-------|------------|-----------|
| `rust` | 43 | ~4825 | `rust/crates/globe-native/Cargo.toml`, `rust/crates/globe-native/.github/context-src.md`, `rust/crates/downtime-core/src/model.rs` |
| `scripts` | 29 | ~3383 | `scripts/refresh_static_data.mjs`, `scripts/globe-re/tests/test_globe_re.py`, `scripts/globe-re/globe_plan.py` |
| `visualizer` | 21 | ~2527 | `visualizer/lib/catalogs.mjs`, `visualizer/lib/hpdb.mjs`, `visualizer/public/app.js` |
| `.github` | 5 | ~1344 | `.github/workflows/release.yml`, `.github/workflows/rust.yml`, `.github/workflows/refresh-static-data.yml` |
| `globalstatus` | 6 | ~633 | `globalstatus/cesium.js`, `globalstatus/router.php`, `globalstatus/cesium.css` |
| `docs` | 13 | ~456 | `docs/MAP-ASSETS.md`, `docs/RELEASING.md`, `docs/rust-native.md` |

The largest module by signature volume is `rust` (43 files, ~4825 tokens) — start there for the core logic.

## Dependency flow
The most depended-on files — changes here have the widest blast radius:

| Hub file | Importers |
|----------|-----------|
| `visualizer/lib/datapack.mjs` | 9 |
| `visualizer/lib/catalogs.mjs` | 3 |
| `visualizer/lib/hpdb.mjs` | 3 |
| `scripts/globe-re/knowledge.py` | 2 |
| `visualizer/lib/conflicts.mjs` | 2 |
| `visualizer/lib/feeds.mjs` | 2 |
| `visualizer/lib/gpsjam.mjs` | 2 |
| `visualizer/lib/streams.mjs` | 2 |

Entry points (imported by nothing, importing the rest):

- `visualizer/server.mjs` → 8 imports
- `rust/crates/downtime-core/src/lib.rs` → 7 imports
- `rust/crates/globe-native/src/lib.rs` → 4 imports
- `rust/crates/downtime-native/src/lib.rs` → 3 imports
- `scripts/globe-re/emit_report.py` → 3 imports
- `visualizer/lib/checker.mjs` → 2 imports
- `scripts/globe-re/emit_rust.py` → 1 imports
- `scripts/globe-re/tests/fixtures/mini-cesium/Source/Scene/Globe.js` → 1 imports

**Dependency cycles:** 7 — untangle these first when refactoring.

## Conventions
In this repo, file naming is predominantly **snake_case** (50%, inconsistent); exports use the **named** style (100%, consistent). New code should match.

## Navigating
- `sigmap ask "<question>"` — ranked, budgeted mini-context for any task
- `sigmap --impact <file>` / `--callers <symbol>` — blast radius before you change something
- `sigmap evidence "<query>"` — machine-consumable Evidence Pack (JSON) for agents/CI
- MCP: `get_architecture_overview`, `get_map`, `get_callee_signatures` for live agent access
