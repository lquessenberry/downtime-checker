# QuietEarth

QuietEarth is the **Rust wgpu globe** — the product renderer. It is the same Earth that used to live in `~/Desktop/quietearth` and in Will’s `…/global-status/quietearth` folder, without PHP and without Cesium.

Binary: `cargo run -p downtime-globe-native`  
Window title: **QuietEarth**. Crate: `globe-native`.

## What it is

- Unit sphere, NASA Blue Marble albedo, orbit camera (drag / wheel)
- Free basemaps that **actually stitch onto the sphere**: OSM streets, OpenTopo, GIBS Blue Marble tiles (desktop TLS). Compiled JPEG is the fallback and the polar fill.
- **Rustle** leaves (geolocation, geofence, geoorbital) drawn on the globe; click a leaf to look at it
- First-party blast rings behind a collapsed NUCLEAR panel
- Catalog capital pins from `downtime-core`

## What it is not

- Not Cesium, Mapbox, ion, or Esri.
- Not quietearth.app as a separate product. Global Status App is the app; QuietEarth is the globe engine.
- The old canvas HUD still lives at `/hud.html` on staging.

## Run

```bash
cd rust
cargo run -p downtime-globe-native
cargo run -p downtime-globe-native -- --summary
```

Pick **OpenStreetMap** in the basemap list. Status reads `fetching … z2` then `OpenStreetMap on QuietEarth`. Wheel in (distance down to 1.08 Earth radii).

Android APK still uses compiled Blue Marble only (no INTERNET permission yet).

## Staging (Fly)

https://globalstatus-stage.fly.dev/ is the wasm/WebGPU cut of this crate
(`WebHandle` + downtime-server). Same HUD, Blue Marble, OSM stitch via `/tiles/`.

```bash
fly deploy -c fly.wasm.toml --ha=false -a globalstatus-stage
```
