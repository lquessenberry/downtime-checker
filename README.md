# Downtime Checker

Downtime checks whether public websites answer, then prints each result on one line.

## How it works

1. Open Downtime from the desktop icon, the application menu, or `python3 downtime.py`.
2. Pick a numbered search. `0` quits. On a submenu, `0` or `b` goes back.
3. For each place, the checker pings the website name. If ping stays silent, it tries TCP port 443, then port 80.
4. A place is UP when ping or either port answers. Otherwise it is DOWN.
5. Each result prints as soon as that place finishes: UP or DOWN, the name, the address, and the location.
6. Down places are listed again in a short block. The full results are then grouped by country, then by state. The country name is drawn large when `figlet` is installed. Blank lines separate countries.
7. The footer shows how many places were checked, how many are online, how many are offline, and which countries were in that search.

Catalog files store a sample IP next to each site. That IP is not what gets pinged. The checker uses the website name, because addresses change.

Location is where the address answers from, often a content network rather than the office. Lookups use ipwho.is and are saved in `locations.json` next to the program.

## Menu

1. Search everything
2. World governments
3. United States (opens a second menu limited to United States sites)
4. Banks and stock exchanges
5. Tech only (company sites and individual services such as Microsoft 365, Azure, Xbox, Google Drive, and AWS)
6. Utilities only
7. Education
8. Medical
9. Stock exchanges
10. Transportation
11. Stores
12. Communications (TV, phone, radio, cell, and internet)
13. Military (defense ministries and armed forces sites)
14. Shipping
15. Food
16. Weather
17. Choose a country (world government sites; United States opens the United States menu)
18. Add a place (a name plus an IP or web address, saved for later searches)

## Requirements

Python 3 and `ping`. Optional: `figlet` for large country names, and `qterminal` for the desktop launcher. Without `qterminal`, the launcher opens in the default terminal.

## Install

Python 3 must already be installed. The installer does not use the network and does not need root.

From a clone of this repository:

```bash
bash install.sh
```

That copies the program to `~/bin/downtime`, puts a Downtime icon on the Desktop, and adds it to the application menu. If a Pentesting folder is already on the Desktop, the launcher is placed there too.

An offline archive is `Downtime Checker.tar.gz`. The steps to install it from a terminal are in `INSTALL.txt`.

## Run without installing

```bash
python3 downtime.py
```

## Live visualizer (Node)

A globe dashboard that runs the same catalogs, ping + TCP 443/80 checks, and location cache as the Python CLI.

```bash
cd visualizer
node server.mjs
```

Open http://127.0.0.1:4173 — pick a mission, watch nodes light up as they answer.

## Rust and WebAssembly

A Cargo workspace under `rust/` checks the same catalog files, with the same UP/DOWN rule: ping the website name, and if ping stays silent try TCP port 443, then port 80. The sample IP in a catalog row is not what gets probed. Python and Node are unchanged.

The workspace needs a current stable Rust (1.85 or newer). From `rust/`, `rust-toolchain.toml` asks rustup for stable, rustfmt, clippy, and the `wasm32-unknown-unknown` target.

### Build and run

```bash
cd rust
cargo test --workspace
cargo build -p downtime-wasm --target wasm32-unknown-unknown
cargo run -p downtime-cli -- --root .. check weather
cargo run -p downtime-server -- --root ..
```

The CLI accepts the same search ids as the globe (`weather`, `shipping`, `everything`, `us-weather`, …) and the Python menu numbers (`16` is weather). `--no-lookup` skips ipwho.is. `--json` prints one object instead of the text report. `downtime layers` lists the data layers. `downtime menu` is the numbered menu.

The server listens on `127.0.0.1:4173` (override with `--port` or `PORT`) and speaks the same routes as `visualizer/server.mjs`: `/api/catalog`, `/api/state`, `/api/events`, `/api/scan`, `/api/stop`, plus the files in `visualizer/public`. Open http://127.0.0.1:4173 and the existing globe works against the Rust server. Do not run it at the same time as `node server.mjs` on that port.

Optional JS glue for the wasm crate:

```bash
cd rust
ver=$(cargo metadata --format-version 1 | python3 -c 'import json,sys; print(next(p["version"] for p in json.load(sys.stdin)["packages"] if p["name"]=="wasm-bindgen"))')
cargo install wasm-bindgen-cli --version "$ver"
cargo build -p downtime-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/downtime_wasm.wasm
```

`rust/scripts/compare-weather.sh` times the weather catalog against `python3 downtime.py`. The Rust timing uses `--no-lookup`. Python still looks up locations, so the two numbers are not a pure probe comparison.

### What runs where

| Piece | Where it runs |
| --- | --- |
| Catalog parse, search counts, country/state grouping | `downtime-core`, including `no_std` + `alloc` |
| UP/DOWN decision (ping, then 443, then 80) | `downtime-core::CheckMachine`. The driver supplies the answers |
| ICMP and TCP | Native CLI and server only. ICMP is the system `ping` binary (Linux `-W` seconds, macOS `-W` milliseconds). If ping is missing or not permitted, the check falls through to TCP |
| ipwho.is and `locations.json` | Native CLI and server |
| Browser | `downtime-wasm`: `parse_catalog`, `places`, `aggregate`, `classify_answers`, `layer_catalog`. No ICMP, no raw TCP |

Embedded later means a board-specific driver that feeds `CheckMachine`. The core crate does not open sockets. Check it with `cargo check -p downtime-core --no-default-features`.

### Layout

- `downtime-core` — catalogs, result types, the check state machine, grouping, and the layer trait.
- `downtime-native` — async DNS, ping, and TCP, plus the location cache and ipwho.is.
- `downtime-cli` — the `downtime` binary.
- `downtime-server` — the `downtime-server` binary and the SSE loop.
- `downtime-wasm` — wasm-bindgen exports.

`DataLayer` is the plug-in for a new feed. `ReachabilityLayer` is the one that runs. Register another implementation and the CLI's `layers` list will pick it up once it is added to `layer_registry`.

### Stubbed on purpose

These layers are named and return no observations yet:

- power outages
- traffic
- live cameras
- ADS-B
- GPS jamming
- historical sites

Also still thin: the server does not reload a scan's worker count from the globe, and the wasm build does not ship a generated JS package in the repo (the `cargo build --target wasm32-unknown-unknown` artifact is the contract). CI runs `cargo fmt`, clippy, `cargo test`, the `no_std` check, and the wasm build.
