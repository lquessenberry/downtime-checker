/* Global Status · LIVE CAMS category
 *
 * Public road, city, border and volcano cameras from the agencies that run them
 * (live-cams.php caches each list on our server). A layer's list is fetched only
 * when its switch is first turned on. Pins cluster when zoomed out: tap a cluster
 * to zoom in, tap a camera for the shared pin card (#selected: scrolls, × close)
 * with the live video (HLS via hls.js, or the agency's MP4 clip) or a snapshot
 * that refreshes on its own. Cards are plain text: no links of any kind.
 * Original code for Global Status App.
 */
(function (root) {
  "use strict";
  const LAYERS = [
    { key: "ushighways", name: "US HIGHWAYS", color: "#60a5fa", desc: "Caltrans (California), Iowa, Illinois, Missouri and Delaware highway cameras" },
    { key: "uscity", name: "US CITY CAMERAS", color: "#38bdf8", desc: "New York City, Austin and Baton Rouge traffic cameras" },
    { key: "canada", name: "CANADA ROADS", color: "#a5b4fc", desc: "DriveBC highways, Calgary and Toronto city cameras" },
    { key: "uk", name: "UK ROADS (LONDON)", color: "#f9a8d4", desc: "Transport for London JamCams with short video clips" },
    { key: "europe", name: "EUROPE ROADS", color: "#fbbf24", desc: "Spain DGT, Finland road weather cameras and Iceland roads" },
    { key: "asiapac", name: "ASIA & PACIFIC ROADS", color: "#fdba74", desc: "Hong Kong, Singapore and New Zealand highways" },
    { key: "border", name: "BORDER CROSSINGS", color: "#f87171", desc: "US-Mexico (San Ysidro, Otay Mesa, Calexico) and Canada-US (BC) crossings" },
    { key: "volcano", name: "VOLCANO & NATURE", color: "#fb923c", desc: "USGS volcano webcams and NOAA ocean buoy cameras" },
  ];
  const BYKEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
  const KEYS = LAYERS.map((l) => l.key);
  const REFRESH_MS = 45000;
  const CLUSTER_PX = 64; // a cluster covers about this many screen pixels
  const URLISH = /(https?:\/\/|www\.)\S*|tel:\S*/gi;

  const st = {}; // key -> { on, loading, error, cams, sources, token, prims }
  let ctx = null;
  let clusterDirty = true;
  let lastCell = -1;
  let media = null; // { timer, hls, video }

  function S(key) { return st[key] || (st[key] = { on: false, loading: false, error: "", cams: null, sources: [], token: 0, prims: null }); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function plain(v) { return String(v == null ? "" : v).replace(/<[^>]*>/g, " ").replace(URLISH, "").replace(/\s+/g, " ").trim(); }
  function esc(v) { return plain(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function attr(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }

  // ------------------------------------------------------------- sidebar + picker
  function railHtml() {
    return LAYERS.map((l) =>
      `<button type="button" class="layer lc-rail-layer" data-lc-toggle="${l.key}" aria-pressed="false" title="${attr(l.desc)}">` +
      `<span class="layer-name"><span class="swatch" style="background:${l.color}"></span> ${esc(l.name)}</span>` +
      `<span class="layer-meta"><em data-lc-count="${l.key}">—</em><span class="switch" aria-hidden="true"></span></span></button>` +
      `<p class="sw-note lc-note" data-lc-note="${l.key}" hidden></p>`).join("");
  }
  function pickerHtml() {
    return LAYERS.map((l) =>
      `<button type="button" class="welcome-xl lc-layer" data-welcome-lc="${l.key}" aria-pressed="false" title="${attr(l.desc)}">` +
      `<span class="welcome-layer-name">${esc(l.name)}</span><em class="welcome-xl-count" data-lc-count="${l.key}">—</em>` +
      `<span class="switch" aria-hidden="true"></span></button>`).join("") +
      `<p class="gsr-note lc-pnote" data-lc-ui>Public cameras from road agencies, cities and USGS. Lists load when a layer is switched on. Tap a cluster to zoom in, tap a camera to watch it.</p>`;
  }
  function buildRail() {
    const g = document.getElementById("group-livecams");
    if (g && !g.querySelector("[data-lc-toggle]")) g.insertAdjacentHTML("beforeend", railHtml());
    const rail = document.querySelector(".rail .live-overlays");
    if (rail && !rail.dataset.lcBound) {
      rail.dataset.lcBound = "1";
      rail.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-lc-toggle]");
        if (!b) return;
        ev.preventDefault();
        setActive(b.getAttribute("data-lc-toggle"), b.getAttribute("aria-pressed") !== "true");
      });
    }
  }

  function render() {
    for (const l of LAYERS) {
      const s = S(l.key);
      let label = "—";
      if (s.on) label = s.error ? "ERR" : s.loading ? "…" : s.cams ? fmt(s.cams.length) : "ON";
      for (const b of document.querySelectorAll(`[data-welcome-lc="${l.key}"], [data-lc-toggle="${l.key}"]`)) {
        b.classList.toggle("on", s.on);
        b.setAttribute("aria-pressed", s.on ? "true" : "false");
      }
      for (const c of document.querySelectorAll(`[data-lc-count="${l.key}"]`)) if (c.textContent !== label) c.textContent = label;
      for (const n of document.querySelectorAll(`[data-lc-note="${l.key}"]`)) {
        if (!s.on) { n.hidden = true; n.textContent = ""; continue; }
        let t = s.error ? s.error + " " : "";
        if (s.sources && s.sources.length) t += s.sources.map((x) => `${x.credit}: ${x.error ? "not answering" : fmt(x.count)}`).join(" · ");
        else t += l.desc;
        if (n.textContent !== t) n.textContent = plain(t);
        n.hidden = false;
      }
    }
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    if (root.GsaWelcome && root.GsaWelcome.syncCategoryIcons) root.GsaWelcome.syncCategoryIcons();
  }

  // ------------------------------------------------------------- data
  function setActive(key, on) {
    if (!BYKEY[key]) return;
    const s = S(key);
    s.on = Boolean(on);
    s.token += 1;
    if (!s.on) {
      s.loading = false;
      s.error = "";
      removePrims(key);
      if (shown && shown.layerKey === key) hideCard();
      render();
      return;
    }
    if (s.cams) { clusterDirty = true; draw(); render(); return; }
    if (!viewer()) { render(); return; } // init() applies it once the globe exists
    load(key, s.token);
  }

  function load(key, token) {
    const s = S(key);
    s.loading = true;
    s.error = "";
    render();
    fetch("/api/live-cams/" + key, { headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => {
        if (token !== s.token) return;
        const Cesium = root.Cesium;
        const sources = Array.isArray(d.sources) ? d.sources : [];
        s.sources = sources;
        s.cams = (d.cams || []).map((c) => ({
          id: c[0], name: c[1], road: c[2], lat: +c[3], lon: +c[4], img: c[5] || "", vid: c[6] || "", extra: c[7] || "",
          src: sources[c[8]] || {}, layerKey: key,
          pos: Cesium.Cartesian3.fromDegrees(+c[4], +c[3], 0),
        })).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
        s.loading = false;
        if (!s.cams.length) s.error = "No cameras answered right now.";
        clusterDirty = true;
        draw();
        render();
      })
      .catch((e) => {
        if (token !== s.token) return;
        s.loading = false;
        s.error = "Camera list did not load (" + plain(e && e.message ? e.message : e).slice(0, 60) + "). Switch it off and on to try again.";
        render();
      });
  }

  // ------------------------------------------------------------- clustering
  // Grid clustering in degrees. The cell size follows the camera height so a
  // cluster is roughly 50 px across on screen; below ~120 km every camera
  // gets its own pin.
  function cellDeg() {
    const v = viewer();
    if (!v) return 10;
    const h = v.camera.positionCartographic.height;
    if (h < 120000) return 0;
    // Meters per screen pixel on the short side, so phones get larger cells.
    const c = v.scene.canvas;
    const px = Math.max(240, Math.min(c.clientWidth || 800, c.clientHeight || 800));
    const deg = (CLUSTER_PX * h * 1.15) / px / 111000;
    // Snap to powers of 2 so a small zoom does not reshuffle every cluster.
    return Math.pow(2, Math.round(Math.log2(Math.max(0.05, Math.min(deg, 32)))));
  }

  // Grid cells, then merge neighbours whose centres ended up close together
  // across a cell edge, so clusters do not sit on top of each other.
  function clusterCams(cams, cell) {
    const cells = new Map();
    for (const c of cams) {
      const k = Math.floor(c.lat / cell) + ":" + Math.floor(c.lon / cell);
      let g = cells.get(k);
      if (!g) { g = { n: 0, lat: 0, lon: 0, first: c }; cells.set(k, g); }
      g.n += 1; g.lat += c.lat; g.lon += c.lon;
    }
    const list = Array.from(cells.values());
    for (const g of list) { g.cy = g.lat / g.n; g.cx = g.lon / g.n; }
    if (list.length > 1500) return list;
    list.sort((a, b) => b.n - a.n);
    const kept = [];
    const near = cell * 0.9;
    for (const g of list) {
      let into = null;
      for (const k of kept) {
        const dx = (g.cx - k.cx) * Math.cos(k.cy * Math.PI / 180);
        if (Math.abs(g.cy - k.cy) < near && Math.abs(dx) < near) { into = k; break; }
      }
      if (!into) { kept.push(g); continue; }
      into.n += g.n; into.lat += g.lat; into.lon += g.lon;
    }
    for (const g of kept) { g.cy = g.lat / g.n; g.cx = g.lon / g.n; }
    return kept;
  }

  function removePrims(key) {
    const s = S(key);
    const v = viewer();
    if (s.prims && v && !v.isDestroyed()) {
      v.scene.primitives.remove(s.prims.points);
      v.scene.primitives.remove(s.prims.labels);
    }
    s.prims = null;
  }

  function prims(key) {
    const s = S(key);
    if (s.prims) return s.prims;
    const v = viewer();
    const Cesium = root.Cesium;
    s.prims = {
      points: v.scene.primitives.add(new Cesium.PointPrimitiveCollection()),
      labels: v.scene.primitives.add(new Cesium.LabelCollection()),
    };
    return s.prims;
  }

  function draw() {
    const v = viewer();
    if (!v) return;
    const Cesium = root.Cesium;
    const cell = cellDeg();
    lastCell = cell;
    clusterDirty = false;
    const outline = Cesium.Color.fromCssColorString("#0b1218");
    const white = Cesium.Color.fromCssColorString("#f1f5f9");
    for (const key of KEYS) {
      const s = S(key);
      if (!s.on || !s.cams) { if (s.prims) removePrims(key); continue; }
      const p = prims(key);
      p.points.removeAll();
      p.labels.removeAll();
      const color = Cesium.Color.fromCssColorString(BYKEY[key].color);
      if (!cell) {
        for (const c of s.cams) {
          p.points.add({ position: c.pos, color, pixelSize: 9, outlineColor: outline, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY, id: { lc: true, cam: c } });
        }
        continue;
      }
      for (const g of clusterCams(s.cams, cell)) {
        if (g.n === 1) {
          p.points.add({ position: g.first.pos, color, pixelSize: 9, outlineColor: outline, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY, id: { lc: true, cam: g.first } });
          continue;
        }
        const lat = g.cy;
        const lon = g.cx;
        const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        const size = Math.min(34, 15 + Math.log10(g.n) * 7);
        const id = { lc: true, cluster: true, n: g.n, lat, lon, layerKey: key };
        p.points.add({ position: pos, color: color.withAlpha(0.9), pixelSize: size, outlineColor: outline, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY, id });
        p.labels.add({
          position: pos, text: g.n >= 1000 ? (g.n / 1000).toFixed(g.n >= 10000 ? 0 : 1) + "k" : String(g.n),
          font: "600 11px ui-monospace, SFMono-Regular, Menlo, monospace", fillColor: Cesium.Color.fromCssColorString("#0b1218"),
          outlineColor: white, outlineWidth: 0, style: Cesium.LabelStyle.FILL,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, id,
        });
      }
    }
    cullNow();
    if (v.scene.requestRender) v.scene.requestRender();
  }

  // Hide pins on the far side of the globe (pins draw through the globe).
  const lastCam = { x: 0, y: 0, z: 0 };
  function cullNow() {
    const v = viewer();
    if (!v) return;
    const Cesium = root.Cesium;
    const flat = v.scene.mode !== Cesium.SceneMode.SCENE3D;
    const occ = cullNow.occ || (cullNow.occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84));
    occ.cameraPosition = v.camera.positionWC;
    for (const key of KEYS) {
      const p = S(key).prims;
      if (!p) continue;
      for (let i = 0, n = p.points.length; i < n; i += 1) { const q = p.points.get(i); q.show = flat || occ.isPointVisible(q.position); }
      for (let i = 0, n = p.labels.length; i < n; i += 1) { const q = p.labels.get(i); q.show = flat || occ.isPointVisible(q.position); }
    }
  }
  function onFrame() {
    if (!KEYS.some((k) => S(k).prims)) return;
    const v = viewer();
    const c = v.camera.positionWC;
    if (c.x === lastCam.x && c.y === lastCam.y && c.z === lastCam.z && !clusterDirty) return;
    lastCam.x = c.x; lastCam.y = c.y; lastCam.z = c.z;
    cullNow();
  }
  function onMoveEnd() {
    if (!KEYS.some((k) => S(k).on && S(k).cams)) return;
    if (clusterDirty || cellDeg() !== lastCell) draw();
  }

  // ------------------------------------------------------------- picking + card
  let shown = null;
  function pick(position) {
    const v = viewer();
    if (!v || !KEYS.some((k) => S(k).on)) return null;
    const hits = v.scene.drillPick(position, 3, 10, 10) || [];
    for (const h of hits) {
      const id = h && h.id;
      if (id && id.lc && (id.cluster ? S(id.layerKey).on : S(id.cam.layerKey).on)) return id;
    }
    return null;
  }

  // Called by cesium.js. A cluster zooms in; a camera opens the card.
  function open(hit, show) {
    const v = viewer();
    if (hit.cluster) {
      const h = v.camera.positionCartographic.height;
      const Cesium = root.Cesium;
      v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(hit.lon, hit.lat, Math.max(25000, h / 3.2)), duration: 0.8 });
      return;
    }
    const c = hit.cam;
    const item = { livecam: true, layer: "livecams", kind: BYKEY[c.layerKey].name, name: c.name, lat: c.lat, lon: c.lon, cam: c };
    if (typeof show === "function") show(item);
    else fillCard(liveCardFallback(item));
    mount();
  }

  function liveCardFallback(item) {
    return `<b>${esc(item.kind)}</b> ${esc(item.name)}<br>${item.lat.toFixed(2)}, ${item.lon.toFixed(2)}${popupHtml(item)}`;
  }
  function fillCard(html) {
    const box = document.getElementById("selected");
    const body = document.getElementById("selected-body");
    if (!box) return;
    box.hidden = false;
    (body || box).innerHTML = html;
  }

  function snapUrl(c, view) {
    const t = Math.floor(Date.now() / 30000);
    if (c.src && (c.src.img === "resolve" || c.src.img === "proxy")) {
      return "/api/live-cams/img?s=" + encodeURIComponent(c.src.key) + "&id=" + encodeURIComponent(c.id) + "&t=" + t;
    }
    let u = c.img;
    if (view) u = u.replace(/[A-Z0-9]+\.jpg$/, view + ".jpg");
    return u + (u.indexOf("?") === -1 ? "?" : "&") + "t=" + t;
  }

  function popupHtml(item, opts) {
    const c = item.cam;
    if (!(opts && opts.list)) shown = c;
    const parts = [];
    if (c.road) parts.push(`<span class="lc-road">${esc(c.road)}</span>`);
    const views = c.extra ? c.extra.split(",").filter(Boolean) : [];
    let mediaHtml = "";
    const hasVid = Boolean(c.vid);
    const kind = hasVid ? c.vid.slice(0, c.vid.indexOf(":")) : "";
    if (hasVid) {
      mediaHtml += `<div class="lc-media" data-lc-media><video class="lc-video" data-lc-video muted playsinline autoplay ${kind === "mp4" ? "loop" : ""} ${c.img ? `poster="${attr(snapUrl(c))}"` : ""}></video>` +
        `<span class="lc-badge" data-lc-badge>${kind === "mp4" ? "LATEST CLIP" : "LIVE VIDEO"}</span></div>`;
    } else if (c.img) {
      mediaHtml += `<div class="lc-media" data-lc-media><img class="lc-img" data-lc-img alt="${attr("Camera view: " + plain(c.name))}" src="${attr(snapUrl(c))}" decoding="async">` +
        `<span class="lc-badge" data-lc-badge>SNAPSHOT · REFRESHES</span></div>`;
    }
    if (views.length) {
      mediaHtml += `<div class="lc-views">` + [""].concat(views).map((v, i) =>
        `<button type="button" class="lc-view${i === 0 ? " on" : ""}" data-lc-view="${attr(v)}">VIEW ${i + 1}</button>`).join("") + `</div>`;
    }
    parts.push(mediaHtml);
    parts.push(`<span class="lc-status" data-lc-status></span>`);
    parts.push(`<span class="gsx-card-credit lc-credit">${esc(c.src && c.src.credit ? c.src.credit : "")}</span>`);
    return "<br>" + parts.join("");
  }

  function stopMedia() {
    if (!media) return;
    if (media.timer) clearInterval(media.timer);
    if (media.hls) { try { media.hls.destroy(); } catch (e) { /* already gone */ } }
    if (media.video) { try { media.video.pause(); media.video.removeAttribute("src"); media.video.load(); } catch (e) { /* ignore */ } }
    media = null;
  }
  function hideCard() {
    stopMedia();
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    shown = null;
  }

  let hlsLoading = null;
  function loadHls() {
    if (root.Hls) return Promise.resolve(root.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/hls.js/hls.light.min.js?v=1.7.4";
      s.async = true;
      s.onload = () => resolve(root.Hls);
      s.onerror = () => { hlsLoading = null; reject(new Error("player did not load")); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  // Start the video or the snapshot refresh for the card that is open now.
  function mount() {
    stopMedia();
    const c = shown;
    const body = document.getElementById("selected-body");
    if (!c || !body) return;
    const status = body.querySelector("[data-lc-status]");
    const say = (t) => { if (status) status.textContent = t; };
    const img = body.querySelector("[data-lc-img]");
    const video = body.querySelector("[data-lc-video]");
    media = { timer: 0, hls: null, video: video || null, view: "" };
    const mine = media;
    const toSnapshot = (why) => {
      if (mine !== media) return;
      const box = body.querySelector("[data-lc-media]");
      if (!box || !c.img) { say(why + " No snapshot for this camera."); return; }
      if (mine.hls) { try { mine.hls.destroy(); } catch (e) { /* ignore */ } mine.hls = null; }
      box.innerHTML = `<img class="lc-img" data-lc-img alt="${attr("Camera view: " + plain(c.name))}" src="${attr(snapUrl(c))}" decoding="async"><span class="lc-badge">SNAPSHOT · REFRESHES</span>`;
      mine.video = null;
      say(why);
      startSnapTimer(box.querySelector("[data-lc-img]"));
    };
    const startSnapTimer = (im) => {
      if (!im) return;
      im.addEventListener("load", () => { if (mine === media) say("Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })); });
      im.addEventListener("error", () => { if (mine === media) say("This camera is not sending a picture right now."); });
      mine.timer = setInterval(() => {
        const box = document.getElementById("selected");
        if (mine !== media || !box || box.hidden) { stopMedia(); return; }
        const next = new Image();
        next.onload = () => { if (mine === media) im.src = next.src; };
        next.src = snapUrl(c, mine.view);
      }, REFRESH_MS);
    };
    for (const b of body.querySelectorAll("[data-lc-view]")) {
      b.addEventListener("click", () => {
        mine.view = b.getAttribute("data-lc-view");
        for (const o of body.querySelectorAll("[data-lc-view]")) o.classList.toggle("on", o === b);
        const im = body.querySelector("[data-lc-img]");
        if (im) im.src = snapUrl(c, mine.view);
      });
    }
    if (img) { say("Loading picture…"); startSnapTimer(img); return; }
    if (!video) return;
    const kind = c.vid.slice(0, c.vid.indexOf(":"));
    const url = c.vid.slice(c.vid.indexOf(":") + 1);
    const failTimer = setTimeout(() => { if (mine === media && video.readyState < 2) toSnapshot("Video is not answering, showing the latest snapshot."); }, 12000);
    video.addEventListener("playing", () => { clearTimeout(failTimer); say(kind === "mp4" ? "Short clip from the camera, updated every few minutes." : "Live."); }, { once: true });
    video.addEventListener("error", () => { clearTimeout(failTimer); toSnapshot("Video did not play, showing the latest snapshot."); }, { once: true });
    say("Connecting to video…");
    if (kind === "mp4") {
      video.src = url;
      const p = video.play(); if (p && p.catch) p.catch(() => {});
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl") && !root.MediaSource) {
      video.src = url;
      const p = video.play(); if (p && p.catch) p.catch(() => {});
      return;
    }
    loadHls().then((Hls) => {
      if (mine !== media) return;
      if (!Hls || !Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = url; video.play().catch(() => {}); return; }
        toSnapshot("This browser cannot play the live video.");
        return;
      }
      const hls = new Hls({ lowLatencyMode: false, maxBufferLength: 10, backBufferLength: 0, enableWorker: true });
      mine.hls = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data && data.fatal) { clearTimeout(failTimer); toSnapshot("Video stopped, showing the latest snapshot."); }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); });
    }).catch(() => toSnapshot("Video player did not load."));
  }

  function watchCard() {
    const box = document.getElementById("selected");
    if (!box || watchCard.done) return;
    watchCard.done = true;
    new MutationObserver(() => {
      if (box.hidden && media) { stopMedia(); shown = null; }
      else if (media && shown && !document.querySelector("#selected-body [data-lc-media], #selected-body [data-lc-status]")) { stopMedia(); shown = null; }
    }).observe(box, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  }

  function clearAll() { for (const k of KEYS) if (S(k).on) setActive(k, false); }

  function init(options) {
    ctx = options;
    buildRail();
    watchCard();
    const v = viewer();
    if (v && v.scene) {
      v.scene.preRender.addEventListener(onFrame);
      v.camera.moveEnd.addEventListener(onMoveEnd);
    }
    for (const k of KEYS) if (S(k).on && !S(k).cams) load(k, S(k).token);
    render();
  }

  // QA helper: screen position of a visible single camera pin of a layer.
  function visiblePin(key, wantVideo) {
    const v = viewer();
    const p = S(key).prims;
    if (!v || !p) return null;
    const ST = root.Cesium.SceneTransforms;
    const toWin = ST.worldToWindowCoordinates || ST.wgs84ToWindowCoordinates;
    const rect = v.scene.canvas.getBoundingClientRect();
    for (let i = 0; i < p.points.length; i += 1) {
      const q = p.points.get(i);
      if (!q.show || !q.id || q.id.cluster) continue;
      if (wantVideo != null && Boolean(q.id.cam.vid) !== wantVideo) continue;
      const w = toWin(v.scene, q.position);
      if (!w || w.x < 40 || w.y < 80 || w.x > rect.width - 40 || w.y > rect.height - 40) continue;
      return { x: rect.left + w.x, y: rect.top + w.y, name: q.id.cam.name };
    }
    return null;
  }

  if (document.getElementById("group-livecams")) buildRail();
  else document.addEventListener("DOMContentLoaded", buildRail);

  root.GsaLiveCams = {
    KEYS, LAYERS, init, setActive, pick, open, popupHtml, mount, clearAll, render, pickerHtml, visiblePin,
    isOn: (k) => Boolean(st[k] && st[k].on),
    state: st,
    cams: (k) => (S(k).cams || []),
    redraw: () => { clusterDirty = true; draw(); },
    viewer: () => viewer(),
  };
})(window);
