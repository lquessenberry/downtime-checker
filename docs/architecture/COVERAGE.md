# SigMap coverage (repo review)

Generated **2026-11-23** with SigMap **v8.88.0** on `feat/rustle-leaves` (`b4701fe` plus this map).
Regenerate: `scripts/gsa-cycle/sigmap.sh`.

This is **index coverage** (which source files SigMap extracted signatures from), not test/line coverage.

## Snapshot

| Gate | Value | Notes |
| --- | --- | --- |
| Health | **100/100 (A)** | `sigmap --health` |
| CI `--min-coverage 50` | **59% pass** | `{"pass":true,"coverage":59,"threshold":50}` |
| CI `--min-coverage 80` (config `coverageTarget`) | **59% fail** | Markdown/docs and files outside `srcDirs` pull this down. Not a product fail. |
| Files under `srcDirs` | **93%** (86 / 92) | Six files sit outside roots (repo-root `.sh` / `rust/` helpers) |
| Indexed in scope | **126 / 215** considered files | 89 not indexed (vendor, data, ignore rules, binary) |
| Wiki | **131 files · 7 modules · ~16.6k sig tokens** | `docs/architecture/WIKI.md` |
| Symbols found | **1,202** | generate run |
| Token budget | **15,041 / 24,000** (93.9% reduction from 246,575) | not over budget |
| Language extractors | **9 / 38** (23.7%) | Rust/JS/Python/PHP/HTML/CSS/TOML/shell/markdown used; the rest unused |

## Context-file inclusion (budgeted map)

`sigmap --report` scores **87 (B)**: 75 of 86 in-scope files made the generated context; **11 dropped** by token budget.

| Module | Included | Total | % |
| --- | --- | --- | --- |
| `visualizer` | 15 | 15 | 100 |
| `rust/crates/downtime-wasm` | 1 | 1 | 100 |
| `globalstatus-wasm` | 1 | 1 | 100 |
| `scripts` | 26 | 29 | 90 |
| `rust/crates/downtime-core` | 7 | 8 | 88 |
| `rust/crates/globe-native` | 14 | 16 | 88 |
| `rust/crates/rustle` | 4 | 5 | 80 |
| `rust/crates/downtime-native` | 3 | 4 | 75 |
| `globalstatus` | 3 | 4 | 75 |
| `rust/crates/downtime-server` | 1 | 2 | 50 |
| `rust/crates/downtime-cli` | 0 | 1 | 0 |
| `docs` | 0 | 0 | — (wiki indexes markdown; report counts code files) |

Dropped from the budgeted context (still in the wiki/index): `downtime-cli`, extra `downtime-server` / `globe-native` / `rustle` / `downtime-native` / `downtime-core` / `globalstatus` files, and 3 scripts.

## Wiki modules (current tree)

| Module | Files | Sig tokens | What to open first |
| --- | --- | --- | --- |
| `rust` | 49 | ~6227 | QuietEarth `globe-native`, Rustle `leaf.rs` / `grove.rs` |
| `scripts` | 27 | ~2797 | `globe_plan.py`, globe-re tests |
| `docs` | 20 | ~2777 | rust-native, MAP-ASSETS, evidence packs |
| `visualizer` | 21 | ~2527 | `catalogs.mjs`, `hpdb.mjs`, `app.js` |
| `.github` | 5 | ~1344 | rust / release / overlay workflows |
| `globalstatus` | 6 | ~633 | Cesium JS + `router.php` leftover |
| `globalstatus-wasm` | 3 | ~311 | QuietEarth `index.html`, HUD `globe.js` |

Hubs (widest blast radius): `visualizer/lib/datapack.mjs` (9 importers), then catalogs/hpdb. Rust entry: `downtime-core/src/lib.rs`, `globe-native/src/lib.rs`, `rustle/src/lib.rs`. **7 dependency cycles** in the JS/Python graph.

## Extractor gaps (not missing product code)

`sigmap --analyze` found symbols in 122 files. These have **0 signatures** (re-export crates, thin bins, or empty stubs):

- `rust/crates/downtime-core/src/lib.rs`
- `rust/crates/downtime-native/src/lib.rs`
- `rust/crates/downtime-cli/src/main.rs`
- `rust/crates/downtime-server/src/main.rs`
- `rust/crates/globe-native/src/main.rs`, `engine/mod.rs`
- `rust/crates/rustle/src/main.rs`
- `globalstatus/sw.js`
- `scripts/gsa_php_router.php`
- `scripts/globe-re/__init__.py`, `templates/ghidra_headless.py`

PHP `router.php` and Cesium `cesium.js` **are** indexed (capped at 25 sigs/file). Vendored Cesium under `globalstatus/vendor` is excluded on purpose.

## How to read this

- **59% CI** is “indexed files / files SigMap considered in the repo.” Docs and ignored vendor drag it. Raise `srcDirs` or ignore more markdown if you want the gate nearer 80.
- **93% source-root** is “product trees we asked it to watch.”
- **87 B inclusion** is “what fits in 24k tokens for an agent.” QuietEarth + Rustle are in; `downtime-cli` is the crate that missed the budget.
- Health **A** means the map is fresh and the generate strategy is consistent.

```bash
scripts/gsa-cycle/sigmap.sh
npx sigmap --ci --json --min-coverage 50
npx sigmap --analyze
npx sigmap wiki --out docs/architecture/WIKI.md
```
