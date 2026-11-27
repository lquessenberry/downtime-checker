# Global Status asset kit

Hand-authored SVG masters (and PNGs rasterized with `rsvg-convert`) for the Global Status web app, PWA, store listings, and the future Rust-native / F-Droid / desktop builds.

License: same as the repo (MIT OR Apache-2.0). The wordmarks outline IBM Plex Sans Condensed and IBM Plex Mono at build time; those typefaces are SIL Open Font License and are **not** shipped in this folder. NUKEMAP is an inspiration credit only — nothing here is NUKEMAP or calculator source.

Canonical tree: `globalstatus/assets/<set>/`. Rebuild from `globalstatus/assets/src/` (see `src/README.md`).

## Sets

### 0. Brand kit (tokens, logo, mark, avatar)

Supporting files from the earlier WOR-5 kit, now in-tree so everything else can share one mark and palette.

| What | Where | Notes |
| --- | --- | --- |
| Design tokens (W3C DTCG) | `tokens/tokens.json` | Night `#070b10`, signal `#7ec8ff`, pulse `#3dff9a`, alarm `#ff4d4d`, amber `#ffb020`, plus layer and nuke-ring colors |
| Built tokens | `tokens/dist/tokens.css`, `tokens.ts`, `tokens.rs`, `tokens.flat.json` | CSS / TypeScript / Rust (`Color32` behind `egui`) |
| Contrast report | `tokens/contrast-report.md` | WCAG checks for the pairings |
| Logo lockups | `logo/` | Mark, horizontal, stacked, wordmark; dark / light / mono; SVG + PNG |
| WORLDSTATUS avatar | `brand/avatar/` | Square and circle, 512 and 1024 |

The app mark is the original globe-and-ring favicon with the `?` replaced by a green status pulse.

### 1. App icons (55 files)

Masters: `icons/icon-master.svg` (rounded), `icons/icon-small.svg` (16–32 px, heavier strokes), `icons/icon-fullbleed.svg`, `icons/pwa/icon-maskable.svg`.

| File / folder | Size | Used by |
| --- | --- | --- |
| `icons/favicon.svg`, `favicon.ico`, `favicon-32.png` | 32 (ICO also 16) | Browser tab. **Wired** to `/favicon.svg`, `/favicon.ico`, `/favicon-32.png`, `/favicon.png` (256) |
| `icons/png/icon-16.png` … `icon-1024.png` | 16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024 | Size ladder; 192 / 512 **wired** as PWA `any` icons |
| `icons/pwa/icon-maskable-192.png`, `icon-maskable-512.png` | 192, 512 | **Wired** in `manifest.webmanifest` (`purpose: maskable`) |
| `icons/pwa/apple-touch-icon.png` | 180 | **Wired** as `/apple-touch-icon.png` |
| `icons/android/` | Adaptive FG/BG/mono SVG + 432 px PNG, mipmap mdpi–xxxhdpi, `mipmap-anydpi-v26` XML, Play 512 | Ready for `packaging/android` on `rust/native-core` (see checklist) |
| `icons/desktop/GlobalStatus.icns` | macOS iconset 16–1024 | Ready for `packaging/icons` |
| `icons/desktop/globalstatus.ico` | Windows 16–256 | Ready for `packaging/icons` |
| `icons/desktop/Square44x44Logo.png` etc. | 44, 150, 310 | Windows tiles |
| `icons/desktop/appimage-256.png`, `appimage-512.png` | 256, 512 | AppImage / Linux `.desktop` |
| `icons/fdroid/icon-512.png` | 512 | F-Droid / Play icon |

### 2. Per-layer map markers (54 layers, 13 groups)

Colors follow the **live CSS swatches** in `globalstatus/cesium.css` so a later wiring pass matches the layer rail. Catalog: `markers/markers.json`.

| Kind | Count | Files |
| --- | --- | --- |
| Layer badges | 54 | `markers/svg/<id>.svg` and `markers/png/<id>-32.png`, `<id>-64.png` |
| Map-pin variants | 34 | `markers/svg/<id>-pin.svg` and `markers/png/<id>-pin-64.png` for point / simulator layers |
| Group marks | 13 | `markers/svg/groups/<id>.svg` and `markers/png/groups/<id>-64.png` (rounded square) |

Layers: nuke simulator, aircraft, ships, airports, TFRs, delays, ISS, satellites, aurora, day/night, radar, NWS alerts, hurricanes, quakes, volcanoes, tsunami, wildfires, disasters, rivers, coastal, USA/UK/Canada/Australia power outages, USA/global internet outages, streams, AM/FM, cell towers, power lines, power plants, mesh, jamming, ham/WebSDR, police, sheriff, fire, hospitals, conflicts, bases, designations (opt-in), disease, animal disease, hunger, air quality, USA/world firearms, CCW, four militia scopes, UFO, bigfoot.

`designations` and `radio` are not in the current layer rail yet; the glyphs are ready for that toggle. Lee approved every set — including firearms, militia, designations, and ham/radio — for all surfaces, store listings included. Layer-rail and Cesium wiring for these glyphs is still a follow-up so the current swatches stay stable until that pass.

### 3. Splash / loading (13 files)

The live boot sequence still uses `start-satellite.mp4`. These are static fallbacks.

| File | Size | Used by |
| --- | --- | --- |
| `splash/boot-poster-1280x720.svg` + `.png` | 1280×720 | **Wired** as the `<video poster>` on the boot splash |
| `splash/splash-landscape-1920x1080.svg` + `.png` | 1920×1080 | Desktop / Android landscape splash |
| `splash/splash-portrait-1080x1920.svg` + `.png` | 1080×1920 | Android / generic portrait splash |
| `splash/splash-portrait-1290x2796.svg` + `.png` | 1290×2796 | iPhone 14/15/16 Pro Max class |
| `splash/loading-mark.svg` + 128/256 PNG | 128 canvas | In-app spinner |
| `splash/loading-mark-ring.svg` + 128 PNG | 128 | Same, with a static pulse ring (motion left to CSS) |

Other iOS `apple-touch-startup-image` sizes are left as a checklist so we do not ship a stretched poster at the wrong aspect.

### 4. Store and social graphics (20 files)

| File | Size | Used by |
| --- | --- | --- |
| `store/og-image-1200x630.svg` + `.png` | 1200×630 | **Wired** as `/og-image.png` and Open Graph / Twitter tags |
| `store/github-social-1280x640.svg` + `.png` | 1280×640 | GitHub social preview (must be uploaded in repo settings) |
| `store/social-card-1080x1080.svg` + `.png` | 1080×1080 | Square social |
| `store/readme-banner-1280x320.svg` + `.png` | 1280×320 | README / docs banner |
| `store/feature-graphic-1024x500.svg` + `.png` | 1024×500 | F-Droid / Play feature graphic |
| `store/notagline/` | same sizes | Tagline-free variants of the banner, GitHub card, and feature graphic |
| `store/frames/frame-landscape-1920x1080` | 1920×1080 | Empty bezel for a future store screenshot |
| `store/frames/frame-portrait-1080x1920` | 1080×1920 | Same, 9:16 |

### 5. UI empty states and badges (46 files)

| File | Size | Used by |
| --- | --- | --- |
| `ui/empty/empty-layer`, `empty-search`, `offline`, `locating`, `no-permission` | 512×512 SVG + PNG | Empty / error states. **Not wired** |
| `ui/badges/status-{up,down,pending,stale,unknown}` | pill SVG + PNG | Status chips |
| `ui/badges/dot-*` | 24×24 | Compact status dots |
| `ui/badges/severity-{extreme,severe,moderate,minor,info}` | pills | Severity |
| `ui/badges/badge-opt-in`, `badge-link-only`, `badge-caveat` | pills | For opt-in layers (designations, crime, registries) |

### Review sheets

`preview/sheet-01-icons.png`, `sheet-02-markers.png`, `sheet-03-splash-store.png`, `sheet-04-ui.png`, `sheet-05-favicons.png`, plus the earlier logo, icon-family, and map-conventions sheets.

The nuclear-effects convention sheet uses the public effects-radius check values (1 MT airburst). It is a color legend, not calculator source. NUKEMAP is inspiration only.

## What this PR already wires (low-risk)

- `/favicon.svg`, `/favicon.ico`, `/favicon-32.png`, `/favicon.png` — new mark (pulse, no `?`)
- `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`
- `/icon-maskable-192.png`, `/icon-maskable-512.png` and the matching `manifest.webmanifest` entries, plus a short description
- `/og-image.png` and Open Graph / Twitter meta tags, plus a `<meta name="description">`
- Boot-splash `<video poster="/assets/splash/boot-poster-1280x720.png">`
- Icon query strings bumped to `?v=20261127a`

## Grid favicon markers

The scheduled World Grid pass (`poll-runner.php grid` → `run_scheduled_scan` in `router.php`) now refreshes favicons for **up** hosts after the probe finishes, using whatever remains of the 8-minute grid deadline.

| Item | Value |
| --- | --- |
| Lookup order | `https://{host}/favicon.ico`, then `<link rel=icon>` from the homepage head, then the set-1 mark (`/icons/grid-fallback-32.png` and `-64.png`) |
| Cache | `globalstatus/data/favicons/{hash}.png` and `{hash}-32.png` (content-hash of the 64 px PNG). Index: `data/favicon-index.json` |
| TTL | 14 days for a good icon; 24 hours before retrying a fallback/error |
| Conditional GET | `ETag` / `If-Modified-Since` when we already have a source URL |
| Limits | 200 hosts per pass, 8 at a time, 3 s timeout / 2 s connect, 256 KB body cap, 64 KB homepage cap, max 3 redirects |
| SSRF | Public DNS hostnames only; localhost, private, and link-local IPs blocked; `javascript:` / `file:` / `data:` dropped |
| Public URL | `/api/favicons/{hash}.png` (and `-32.png`) with `ETag` and `Cache-Control: public, max-age=604800, stale-while-revalidate=86400`. Unknown hashes serve the set-1 fallback. |
| Globe | Cesium billboards use the cached 64 px icon with a set-5 status ring (up / down / pending). The feed and selected card show the 32/64 px icon too. Down hosts keep a previously cached icon or the fallback; they are not fetched this pass. |

The live cache is gitignored and is not published by FTP. On GoDaddy the PHP router serves the files (Apache blocks `/data/`). On FrankenPHP, `/api/*` already falls through to `router.php`, so this works without a Caddy change; a later `file_server` shortcut can be added in the poller merge the same way other snapshot caches are served.

Tests: `php scripts/gsa-favicon-test.php` (fixtures only, no live network).

## Wiring checklist (left for review)

Do **not** do these without a look at the contact sheets:

1. Swap the layer-rail CSS swatches or Cesium billboards for `markers/` glyphs. Keep `icons/adsb-sprites.png` / `adsb-shapes.json` — those are a special sprite sheet. All glyphs, including firearms, militia, designations, and ham/radio, are approved for that pass.
2. Replace the older visualizer icons (`visualizer/public/icons/bomb.png`, `ham-radio.png`, `satellite.png`) with the new conflicts / radio / satellite badges (approved to show everywhere).
3. When `rust/native-core` is merged onto this branch, copy:
   - `icons/android/mipmap/**` and the adaptive XML → `packaging/android/res/`
   - `icons/android/ic_launcher_{foreground,background,monochrome}-432.png` → the xxxhdpi adaptive layers
   - `icons/desktop/GlobalStatus.icns`, `globalstatus.ico`, `appimage-*.png` → `packaging/icons/`
   - `icons/fdroid/icon-512.png` → `fastlane/metadata/android/en-US/images/icon.png`
   - `store/feature-graphic-1024x500.png` → `fastlane/metadata/android/en-US/images/featureGraphic.png`
   - `store/readme-banner-1280x320.png` and `store/github-social-1280x640.png` → `docs/assets/`
   - Linux `.desktop` `Icon=` to the AppImage PNG
4. Add `apple-touch-startup-image` links for each iPhone / iPad size, or use a single CSS splash in the PWA.
5. Drop store screenshots into `store/frames/` and add them to F-Droid metadata.
6. Optionally import `tokens/dist/tokens.css` into `cesium.css` once the token vs CSS color questions below are settled.
7. Upload `store/github-social-1280x640.png` as the GitHub repository social preview (Settings → General → Social preview). That cannot be done from a file in the tree alone.

## Decisions for Lee or Will

Settled 27 Nov 2026 (America/Chicago): every icon, including firearms, militia, designations, and ham/radio, is approved for all surfaces and for store listings.

Still open:

- **Tagline.** Marketing art uses “The state of the world, by the numbers.” Tagline-free variants live in `store/notagline/` if you would rather ship without it.
- **Marker colors vs tokens.** Markers follow the live CSS swatches. Three notable mismatches with the WOR-5 tokens: disease is `#ff4d6a` in CSS and `#b78bff` in tokens; hunger is `#af4729` vs token food `#d9b44a`; conflicts are `#d65b29` vs token `#ff5a5f`. Pick one source of truth before wiring markers into the globe.
- **Boot video vs static splash.** The video stays; the new poster only covers the first paint and no-video cases. A later pass can switch reduced-motion users to the static splash.
- **Visualizer icon swap** and **layer-rail wiring** are approved, but not done in this PR (see the checklist).

## Rebuild

See `src/README.md`. Generated SVGs with wordmarks are already outlined, so a rebuild is only needed when you change a generator or token.
