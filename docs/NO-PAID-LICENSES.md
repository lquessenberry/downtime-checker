# No paid licenses

We do not buy Mapbox, Cesium ion, Esri, Maxar, GIDEON REST, ACLED keys, or AISStream to ship a feature. We do not license, embed, or port NUKEMAP or NukeSim. If a capability is not free (public domain, CC BY, ODbL, government feed, or our own code), **we build our own** and **later cycles perfect it**.

RUCKUS fails a cycle that adds a required paid token.

## Recreate vs keep

| Feature we want | Paid / restricted | Free / ours | Perfect in |
| --- | --- | --- | --- |
| Blast rings, DEFCON HUD | Third-party maps (NUKEMAP, NukeSim) are not used or ported | Global Status nuclear simulator and calculator (Will Casey and Lee), inspired by NUKEMAP by Alex Wellerstein; `downtime-core::blast` cube-root (Glasstone-scale) | 7, 9, 10, 16 |
| Globe engine | Cesium ion, Mapbox GL JS v2+ | Vendored Cesium Apache-2.0 `Source/` now; wgpu `globe-native` is the product | 10, 18 |
| Terrain | Esri Terrain3D, Cesium World Terrain | Mapzen/Nextzen Terrarium, SRTM, Copernicus DEM, NASA | 11, 16 |
| Streets / 3D buildings | Cesium OSM Buildings (ion), Google Photorealistic | OSM tiles + OSM Buildings GeoJSON (CC BY-SA) | 12, 18 |
| Satellite / streets 2D | Esri World Imagery / Street Map, EOX 2018–2025 CC BY-NC-SA | OSM, NASA Blue Marble / GIBS, EOX **2016 CC BY**, Natural Earth | 14 |
| AIR | ADS-B Exchange bulk, paid adsb.lol key | adsb.lol unkeyed + cache; own 1090 feeder (`adsb.im`) | 13, 18 |
| AIS | AISStream key, commercial marine maps | Finnish Digitraffic REST | keep |
| Violence events | ACLED API key | UCDP GED public CSV | 14 |
| Animal outbreaks | GIDEON licensed REST | GIDEON **public** events JSON; WOAH HTML later | keep |
| Designation dumps | SPLC no bulk redistribution | Government lists; SPLC local-only | 14 |
| RAG / embeddings | Closed model APIs | MiniLM ONNX + Qwen GGUF from Hugging Face; FTS5 BM25 always | 17 |
| PHP host | Rapira is free; we still do not pay Zend shops | tokio `downtime-server` | 8 |

Esri URLs already in `cesium.js` (`World_Imagery`, `World_Street_Map`, `Terrain3D`) are **defaults to retire**. Cycle 11 and 14 switch the shipped globe to OSM + Terrarium + NASA. Esri stays a manual override only if the operator already has rights; the app never requires it.

## Perfecting (same features, later cycles)

A first Rust/JS slice is not the finished product. Cycles **9, 16, 18** re-enter blast, terrain, and streets:

- Blast: lock 1 kt / 15 kt / 1 Mt radii to published Glasstone tables; ground-burst fallout ellipse; clamp rings to DEM.
- Terrain: Terrarium PNG → heightmap mesh in `globe-native`; exaggeration that does not tear on Android.
- Streets 3D: more than one OSM Buildings tile; wall color by height; drop tiles when the camera rises.

No new paid dataset is an acceptable shortcut for those passes.
