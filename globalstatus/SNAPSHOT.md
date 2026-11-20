# globalstatus.app production snapshot

Pulled from live FTP on 2026-11-20 (second pull, matches Will's evening rundown).

- Site: https://globalstatus.app
- Host: 107.180.116.144 (GoDaddy shared, addon domain `public_html/globalstatus.app`)
- Remote folder after login: `/`
- Footer upload hashes: `cesium.js` sha256 `dbab986d95e5fdb57d70d01225dda47effcc49b894a39c1c09319f7793494022`, `cesium.css` sha256 `aff5387e6225505a9eace9133cc017ac13ea717667ab195afa30afb184275614`
- Phone footer is color dots; names in MENU; maritime AIS credit is a ticker; MESH via `/api/mesh`; PWA `sw.js` / `manifest.webmanifest`
- `index.html` notes this globe started as an offline copy of https://downtime-globe.fly.dev/ (18 Nov 2026), then kept evolving here.

This folder is the production tree. Fly (`downtime-globe`) is staging for the Node visualizer in `visualizer/`.

Do not upload with a church FTP account. A login that shows cathedralbaptist is the wrong folder.

Runtime files `data/*.lock` and `data/stop.flag` are not committed. `.well-known` is left on the server (TLS).
