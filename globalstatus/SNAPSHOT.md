# globalstatus.app production snapshot

Pulled from live FTP on 2026-11-20.

- Site: https://globalstatus.app
- Host: 107.180.116.144 (GoDaddy shared, addon domain `public_html/globalstatus.app`)
- Remote folder after login: `/`
- Newest app files on the server: `index.html`, `cesium.js`, `cesium.css` (19 Nov 2026 16:37)
- `index.html` notes this globe started as an offline copy of https://downtime-globe.fly.dev/ (18 Nov 2026), then kept evolving here.

This folder is the production tree. Fly (`downtime-globe`) is staging for the Node visualizer in `visualizer/`.

Do not upload with a church FTP account. A login that shows cathedralbaptist is the wrong folder.

Runtime files `data/*.lock` and `data/stop.flag` are not committed. `.well-known` is left on the server (TLS).
