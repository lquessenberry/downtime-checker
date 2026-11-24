/* Global Status · SPACE & WEATHER layers.
 *
 * Browser-direct (all send Access-Control-Allow-Origin: *, checked Nov 23 2026):
 *   ISS          https://api.wheretheiss.at/v1/satellites/25544          every 5 s
 *   VOLCANOES    https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated  every 10 min
 *   DISASTERS    GDACS EVENTS4APP + NASA EONET v3 open events            every 60 min
 *   RADAR        https://api.rainviewer.com/public/weather-maps.json     every 10 min
 *   AURORA       NOAA SWPC ovation_aurora_latest.json + planetary Kp     every 5 min
 * Server cache (the 5-minute aircraft cron fills data/, visitors read /api/space/...):
 *   NWS ALERTS   /api/space/nws        (cron pulls api.weather.gov every 5 min)
 *   HURRICANES   /api/space/hurricanes (cron pulls NHC every 15 min)
 *   WILDFIRES    /api/space/wildfires  (cron pulls NASA FIRMS every 3 h)
 *   RIVERS       /api/space/rivers     (cron pulls NOAA NWPS river gauges every 15 min)
 *   COASTAL      /api/space/coastal    (cron pulls NOAA CO-OPS water levels every 15 min)
 *   TSUNAMI      /api/space/tsunami    (cron pulls tsunami.gov NTWC + PTWC every 5 min)
 * Nothing is fetched until a layer is switched on, and timers stop when it is
 * switched off or the tab is hidden.
 */
(function (root) {
  const KEYS = ["iss", "volcanoes", "disasters", "radar", "nwsalerts", "rivers", "coastal", "aurora", "tsunami", "hurricanes", "wildfires"];

  const META = {
    iss: {
      label: "ISS POSITION",
      poll: 5000,
      credit: 'ISS position: <a href="https://wheretheiss.at/" target="_blank" rel="noreferrer">wheretheiss.at</a>',
    },
    volcanoes: {
      label: "VOLCANO ALERTS",
      poll: 10 * 60 * 1000,
      credit: 'Volcano alerts: <a href="https://www.usgs.gov/programs/VHP" target="_blank" rel="noreferrer">USGS Volcano Hazards Program</a> (US volcanoes)',
    },
    disasters: {
      label: "WORLD DISASTERS",
      poll: 60 * 60 * 1000,
      credit: 'Disasters: <a href="https://www.gdacs.org/" target="_blank" rel="noreferrer">GDACS</a> (EC JRC / UN OCHA) and <a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">NASA EONET</a>',
    },
    radar: {
      label: "WEATHER RADAR",
      poll: 10 * 60 * 1000,
      credit: 'Weather data by <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>',
    },
    nwsalerts: {
      label: "US WEATHER ALERTS",
      poll: 2 * 60 * 1000,
      credit: 'Alerts: <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">NOAA National Weather Service</a>',
    },
    aurora: {
      label: "AURORA / SPACE WEATHER",
      poll: 5 * 60 * 1000,
      credit: 'Aurora forecast and Kp: <a href="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" target="_blank" rel="noreferrer">NOAA SWPC</a> (OVATION)',
    },
    hurricanes: {
      label: "HURRICANES",
      poll: 5 * 60 * 1000,
      credit: 'Storms: <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NOAA National Hurricane Center</a>',
    },
    rivers: {
      label: "RIVER GAUGES IN FLOOD (US)",
      poll: 5 * 60 * 1000,
      credit: 'River gauges: <a href="https://water.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NWS National Water Prediction Service</a>',
      caption: "US NWS forecast gauges only. No dot does not mean no flooding. Official warnings are in US weather alerts.",
    },
    coastal: {
      label: "COASTAL WATER LEVELS (US)",
      poll: 5 * 60 * 1000,
      credit: 'Water levels: <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noreferrer">NOAA CO-OPS</a> Tides and Currents',
      caption: "~290 US coastal, Great Lakes and island stations. Not a global tide map.",
    },
    tsunami: {
      label: "TSUNAMI ALERTS",
      poll: 2 * 60 * 1000,
      credit: 'Tsunami alerts: <a href="https://www.tsunami.gov/" target="_blank" rel="noreferrer">NOAA/NWS Tsunami Warning Centers</a> (NTWC and PTWC)',
    },
    wildfires: {
      label: "WILDFIRES",
      poll: 15 * 60 * 1000,
      credit: 'Fires: <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a> (VIIRS, last 24 h), part of NASA EOSDIS',
    },
  };

  const URLS = {
    iss: "https://api.wheretheiss.at/v1/satellites/25544",
    issPositions: "https://api.wheretheiss.at/v1/satellites/25544/positions",
    volcanoes: "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated",
    gdacs: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP",
    eonet: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30",
    radar: "https://api.rainviewer.com/public/weather-maps.json",
    ovation: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
    kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
    nwsalerts: "/api/space/nws",
    hurricanes: "/api/space/hurricanes",
    wildfires: "/api/space/wildfires",
    rivers: "/api/space/rivers",
    coastal: "/api/space/coastal",
    tsunami: "/api/space/tsunami",
  };

  const OUTLINE = "#2A2E3C";
  let ctx = null;
  const st = {};
  for (const key of KEYS) st[key] = { on: false, timer: 0, token: 0, updated: null, fetchedAt: 0, error: "", empty: "", count: null, extra: "" };

  function C() { return root.Cesium; }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function fmtTime(value) {
    if (value == null || value === "") return "";
    const date = typeof value === "number" ? new Date(value) : new Date(String(value));
    if (!Number.isFinite(date.getTime())) return String(value);
    try {
      return date.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    } catch (err) {
      return date.toISOString();
    }
  }

  function ageText(value) {
    if (!value) return "";
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return "";
    if (ms < 0) return "ahead";
    const min = Math.round(ms / 60000);
    if (min < 1) return "just now";
    if (min < 90) return `${min} min ago`;
    const hours = Math.round(min / 6) / 10;
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  const SPACE_MANIFEST = {
    nwsalerts: "space-nws",
    hurricanes: "space-hurricanes",
    wildfires: "space-wildfires",
    rivers: "space-rivers",
    coastal: "space-coastal",
    tsunami: "space-tsunami",
  };

  async function getJson(url) {
    const key = Object.keys(URLS).find((k) => URLS[k] === url);
    const layer = key && SPACE_MANIFEST[key];
    const man = root.GsaManifest;
    if (layer && man) {
      await man.refresh();
      if (man.unchanged(layer)) {
        const skip = new Error("unchanged");
        skip.unchanged = true;
        throw skip;
      }
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (layer && man) man.remember(layer, body && body.hash);
    return body;
  }

  function source(key) {
    return ctx && ctx.sourceFor ? ctx.sourceFor(key) : null;
  }

  function point(color, size, outline) {
    const Cesium = C();
    return {
      pixelSize: size || 14,
      color: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.fromCssColorString(OUTLINE),
      outlineWidth: outline === false ? 0 : 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }

  function addPin(key, item) {
    const src = source(key);
    if (!src) return null;
    const Cesium = C();
    const entity = src.entities.add({
      name: item.name,
      position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.height || 0),
      point: point(item.color, item.size, item.outline),
    });
    entity._live = { ...item, layer: key, kind: item.kind || META[key].label, sw: true };
    return entity;
  }

  // ---------- notes, counts, credits ----------
  // On, and not just loading hidden for the address-search area check (nearby.js).
  function shown(key) {
    return st[key].on && !(root.gsProbeHidden && root.gsProbeHidden(key));
  }

  function render(key) {
    const s = st[key];
    const vis = shown(key);
    const note = document.querySelector(`[data-sw-note="${key}"]`);
    if (note) {
      note.hidden = !vis;
      if (vis) {
        const bits = [META[key].credit];
        if (META[key].caption) bits.push(`<i>${esc(META[key].caption)}</i>`);
        if (s.updated) bits.push(`Updated ${esc(fmtTime(s.updated))} (${esc(ageText(s.updated))})`);
        else if (!s.error) bits.push("Loading…");
        if (s.extra) bits.push(s.extra);
        if (s.empty) bits.push(`<b>${esc(s.empty)}</b>`);
        if (s.error) bits.push(`<span class="sw-err">${esc(s.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(key, vis ? (s.count == null ? "…" : s.count) : "—");
    renderCredit();
    renderGroupCount();
  }

  function renderCredit() {
    const line = document.querySelector(".sw-credit");
    if (!line) return;
    const on = KEYS.filter((key) => shown(key));
    line.hidden = !on.length;
    const track = line.querySelector(".sw-credit-track");
    if (track) track.innerHTML = on.map((key) => META[key].credit).join(" · ");
  }

  function renderGroupCount() {
    // MENU category headers ("N ON") are counted for every group by cesium.js.
    if (typeof window.gsSyncLayerGroups === "function") window.gsSyncLayerGroups();
  }

  function settle(key, data) {
    const s = st[key];
    Object.assign(s, { error: "", empty: "", extra: "" }, data);
    s.fetchedAt = Date.now();
    render(key);
    if (ctx && ctx.statusLive) ctx.statusLive();
  }

  function fail(key, error) {
    st[key].error = `${META[key].label}: ${error && error.message ? error.message : String(error)}`;
    render(key);
  }

  // ---------- ISS ----------
  const iss = { entity: null, track: [], trackEntity: null };

  async function loadIssTrack(token) {
    const now = Math.floor(Date.now() / 1000);
    const stamps = [];
    for (let i = 10; i >= 1; i -= 1) stamps.push(now - i * 300);
    try {
      const rows = await getJson(`${URLS.issPositions}?timestamps=${stamps.join(",")}&units=kilometers`);
      if (token !== st.iss.token) return;
      iss.track = (Array.isArray(rows) ? rows : []).map((row) => ({ lat: Number(row.latitude), lon: Number(row.longitude), alt: Number(row.altitude), t: Number(row.timestamp) * 1000 }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } catch (err) {
      iss.track = [];
    }
  }

  function issTrackPositions() {
    const Cesium = C();
    const cutoff = Date.now() - 55 * 60 * 1000;
    iss.track = iss.track.filter((p) => p.t >= cutoff);
    return iss.track.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.alt || 420) * 1000));
  }

  async function loadIss(first) {
    const token = st.iss.token;
    if (first) await loadIssTrack(token);
    const body = await getJson(URLS.iss);
    if (token !== st.iss.token || !st.iss.on) return;
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    const altKm = Number(body.altitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("no position");
    const t = Number(body.timestamp) * 1000 || Date.now();
    const last = iss.track[iss.track.length - 1];
    if (!last || t - last.t >= 20000) iss.track.push({ lat, lon, alt: altKm, t });
    const Cesium = C();
    const src = source("iss");
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, altKm * 1000);
    const item = {
      name: "International Space Station",
      kind: "ISS",
      lat, lon,
      lines: [
        `Altitude ${Math.round(altKm)} km (${Math.round(altKm * 0.621371)} mi)`,
        `Speed ${Math.round(Number(body.velocity) || 0).toLocaleString("en-US")} km/h`,
        body.visibility ? `In ${body.visibility === "eclipsed" ? "Earth's shadow" : "sunlight"}` : "",
        `Position at ${fmtTime(t)}`,
      ],
      link: { url: "https://wheretheiss.at/", label: "wheretheiss.at" },
    };
    if (!iss.entity || !src.entities.contains(iss.entity)) {
      src.entities.removeAll();
      iss.trackEntity = src.entities.add({
        name: "ISS ground track (last ~50 min)",
        polyline: {
          positions: new Cesium.CallbackProperty(() => issTrackPositions().concat(iss.entity ? [iss.entity.position.getValue(Cesium.JulianDate.now())] : []), false),
          width: 2,
          arcType: Cesium.ArcType.GEODESIC,
          material: Cesium.Color.fromCssColorString("#7fe7ff").withAlpha(0.85),
        },
      });
      iss.entity = src.entities.add({
        name: item.name,
        position: new Cesium.ConstantPositionProperty(pos),
        // 420 km up: let the globe hide it normally when it is behind the earth.
        point: { ...point("#ffffff", 16), disableDepthTestDistance: undefined },
        label: {
          text: "ISS",
          font: "bold 13px sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#7fe7ff"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
      });
    } else {
      iss.entity.position.setValue(pos);
    }
    iss.entity._live = { ...item, layer: "iss", sw: true };
    settle("iss", { updated: new Date(t).toISOString(), count: "LIVE", extra: `${lat.toFixed(1)}, ${lon.toFixed(1)} · ${Math.round(altKm)} km up` });
    refreshSelected("iss");
  }

  // ---------- volcanoes ----------
  const VOLC_COLOR = { GREEN: "#3dbb5a", YELLOW: "#f6e27a", ORANGE: "#f08a24", RED: "#e0262a" };

  async function loadVolcanoes() {
    const token = st.volcanoes.token;
    const rows = await getJson(URLS.volcanoes);
    if (token !== st.volcanoes.token) return;
    const src = source("volcanoes");
    src.entities.removeAll();
    let newest = null;
    let n = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const lat = Number(row.lat);
      const lon = Number(row.long);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const sent = row.sentUtc ? `${String(row.sentUtc).replace(" ", "T")}Z` : null;
      if (sent && (!newest || sent > newest)) newest = sent;
      const color = String(row.colorCode || "").toUpperCase();
      addPin("volcanoes", {
        name: `${row.vName || "Volcano"} · ${color}/${row.alertLevel || ""}`,
        kind: "VOLCANO",
        lat, lon,
        color: VOLC_COLOR[color] || "#f08a24",
        size: color === "RED" ? 20 : color === "ORANGE" ? 18 : 15,
        lines: [
          `Aviation color ${color || "?"} · Alert level ${row.alertLevel || "?"}`,
          row.colorCodePrev ? `Was ${row.colorCodePrev}/${row.alertLevelPrev || ""}` : "",
          row.noticeSynopsis ? String(row.noticeSynopsis).slice(0, 300) : "",
          sent ? `Notice ${fmtTime(sent)}` : "",
          row.nvewsThreat || "",
        ],
        link: row.noticeUrl ? { url: row.noticeUrl, label: "USGS notice" } : { url: "https://volcanoes.usgs.gov/", label: "USGS volcanoes" },
      });
      n += 1;
    }
    settle("volcanoes", { updated: newest || new Date().toISOString(), count: n, empty: n ? "" : "No US volcanoes above normal right now" });
  }

  // ---------- world disasters ----------
  const GDACS_TYPE = { EQ: "Earthquake", TC: "Tropical cyclone", FL: "Flood", VO: "Volcano", DR: "Drought", WF: "Wildfire", TS: "Tsunami" };
  const GDACS_COLOR = { Red: "#e0262a", Orange: "#f08a24", Green: "#46c46a" };
  const EONET_SKIP = new Set(["seaLakeIce", "waterColor", "manmade"]);
  const EONET_COLOR = { wildfires: "#ff7a2f", severeStorms: "#b27cff", volcanoes: "#e0262a", floods: "#3d8bff", earthquakes: "#f0c14a", landslides: "#a37b4f", drought: "#d6b25e", dustHaze: "#c9b18a", tempExtremes: "#ff4fa0", snow: "#cfe8ff" };

  async function loadDisasters() {
    const token = st.disasters.token;
    const [gd, eo] = await Promise.allSettled([getJson(URLS.gdacs), getJson(URLS.eonet)]);
    if (token !== st.disasters.token) return;
    if (gd.status === "rejected" && eo.status === "rejected") throw new Error("GDACS and EONET did not answer");
    const src = source("disasters");
    src.entities.removeAll();
    let n = 0;
    let newest = null;
    const errors = [];
    if (gd.status === "fulfilled") {
      for (const feat of (gd.value && gd.value.features) || []) {
        const p = feat.properties || {};
        const c = feat.geometry && feat.geometry.type === "Point" ? feat.geometry.coordinates : null;
        if (!c) continue;
        if (p.datemodified && (!newest || `${p.datemodified}Z` > newest)) newest = `${p.datemodified}Z`;
        const level = p.alertlevel || "Green";
        addPin("disasters", {
          name: p.name || p.description || "GDACS event",
          kind: `GDACS ${(GDACS_TYPE[p.eventtype] || p.eventtype || "").toUpperCase()}`,
          lat: Number(c[1]),
          lon: Number(c[0]),
          color: GDACS_COLOR[level] || "#46c46a",
          size: level === "Red" ? 20 : level === "Orange" ? 17 : 13,
          lines: [
            `${level} alert · ${GDACS_TYPE[p.eventtype] || p.eventtype || ""}`,
            p.severitydata && p.severitydata.severitytext ? String(p.severitydata.severitytext).trim() : "",
            p.country || "",
            p.fromdate ? `From ${fmtTime(`${p.fromdate}Z`)}` : "",
          ],
          link: p.url && p.url.report ? { url: p.url.report, label: "GDACS report" } : null,
        });
        n += 1;
      }
    } else errors.push("GDACS did not answer");
    if (eo.status === "fulfilled") {
      for (const ev of (eo.value && eo.value.events) || []) {
        const cat = (ev.categories && ev.categories[0]) || {};
        if (EONET_SKIP.has(cat.id)) continue;
        const geoms = Array.isArray(ev.geometry) ? ev.geometry : [];
        const g = geoms[geoms.length - 1];
        if (!g) continue;
        let lon;
        let lat;
        if (g.type === "Point") [lon, lat] = g.coordinates;
        else if (g.type === "Polygon" && g.coordinates && g.coordinates[0]) {
          const ring = g.coordinates[0];
          lon = ring.reduce((a, p) => a + p[0], 0) / ring.length;
          lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        } else continue;
        if (g.date && (!newest || g.date > newest)) newest = g.date;
        const srcUrl = ev.sources && ev.sources[0] && ev.sources[0].url;
        addPin("disasters", {
          name: ev.title || "EONET event",
          kind: `EONET ${(cat.title || "").toUpperCase()}`,
          lat: Number(lat),
          lon: Number(lon),
          color: EONET_COLOR[cat.id] || "#9fd4e2",
          size: 13,
          lines: [
            cat.title || "",
            g.magnitudeValue != null ? `${g.magnitudeValue} ${g.magnitudeUnit || ""}`.trim() : "",
            g.date ? `Last seen ${fmtTime(g.date)}` : "",
          ],
          link: { url: srcUrl || ev.link || "https://eonet.gsfc.nasa.gov/", label: srcUrl ? "Source" : "NASA EONET" },
        });
        n += 1;
      }
    } else errors.push("EONET did not answer");
    settle("disasters", { updated: newest || new Date().toISOString(), count: n, empty: n ? "" : "No open events", error: errors.join(" · ") });
  }

  // ---------- radar (imagery) ----------
  const imagery = { radar: null, aurora: null };

  function removeImagery(key) {
    const viewer = ctx && ctx.viewer();
    if (imagery[key] && viewer && viewer.imageryLayers.contains(imagery[key])) viewer.imageryLayers.remove(imagery[key], true);
    imagery[key] = null;
  }

  function setImagery(key, provider, alpha) {
    const viewer = ctx && ctx.viewer();
    if (!viewer) return;
    removeImagery(key);
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = alpha;
    layer._swKey = key;
    layer._swProvider = provider;
    imagery[key] = layer;
    viewer.scene.requestRender && viewer.scene.requestRender();
  }

  async function loadRadar() {
    const token = st.radar.token;
    const body = await getJson(URLS.radar);
    if (token !== st.radar.token || !st.radar.on) return;
    const frames = (body && body.radar && body.radar.past) || [];
    const frame = frames[frames.length - 1];
    if (!frame || !body.host) {
      removeImagery("radar");
      settle("radar", { updated: null, count: 0, empty: "RainViewer has no radar frame right now" });
      return;
    }
    const Cesium = C();
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `${body.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      credit: "RainViewer",
      // RainViewer's free tiles stop at zoom 7; Cesium stretches them past that.
      maximumLevel: 7,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
    });
    setImagery("radar", provider, 0.75);
    const t = new Date(frame.time * 1000);
    settle("radar", { updated: t.toISOString(), count: t.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }), extra: "Where radars report (most of N. America, Europe, parts of Asia, Australia, S. America)" });
  }

  // ---------- aurora (imagery from OVATION grid) + Kp ----------
  function auroraColor(v) {
    // 4 % faint green, 20 %+ yellow, 50 %+ red (NOAA's own scale).
    const a = Math.min(0.95, 0.35 + v / 30);
    if (v < 20) return [40, 255, 120, a];
    if (v < 50) return [255, 230, 60, a];
    return [255, 70, 70, a];
  }

  async function loadAurora() {
    const token = st.aurora.token;
    const [ova, kp] = await Promise.allSettled([getJson(URLS.ovation), getJson(URLS.kp)]);
    if (token !== st.aurora.token || !st.aurora.on) return;
    if (ova.status === "rejected") throw new Error("SWPC aurora forecast did not answer");
    const data = ova.value || {};
    const coords = Array.isArray(data.coordinates) ? data.coordinates : [];
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 180;
    const g = canvas.getContext("2d");
    const img = g.createImageData(360, 180);
    let peak = 0;
    for (const c of coords) {
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      const v = Number(c[2]);
      if (!(v >= 4) || lat >= 90) continue;
      if (v > peak) peak = v;
      const x = ((Math.round(lon) + 180) % 360 + 360) % 360;
      const y = 89 - Math.round(lat);
      if (y < 0 || y >= 180) continue;
      const [r, gg, b, a] = auroraColor(v);
      const i = (y * 360 + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    const Cesium = C();
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL("image/png"), {
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      credit: "NOAA SWPC",
    });
    if (token !== st.aurora.token || !st.aurora.on) return;
    setImagery("aurora", provider, 0.8);
    let kpText = "";
    let kpValue = null;
    if (kp.status === "fulfilled" && Array.isArray(kp.value) && kp.value.length) {
      const rows = kp.value;
      const last = rows[rows.length - 1];
      // New SWPC format is objects; older format was arrays with a header row.
      if (last && typeof last === "object" && !Array.isArray(last)) {
        kpValue = Number(last.Kp);
        kpText = `Kp ${kpValue.toFixed(1)} at ${fmtTime(`${last.time_tag}Z`)}`;
      } else if (Array.isArray(last)) {
        kpValue = Number(last[1]);
        kpText = `Kp ${kpValue.toFixed(1)} at ${fmtTime(`${String(last[0]).replace(" ", "T")}Z`)}`;
      }
    }
    const storm = kpValue == null ? "" : kpValue >= 5 ? ` · GEOMAGNETIC STORM (G${Math.min(5, Math.floor(kpValue) - 4)})` : kpValue >= 4 ? " · active" : " · quiet";
    const forecast = data["Forecast Time"] ? `Forecast for ${fmtTime(data["Forecast Time"])}` : "";
    settle("aurora", {
      updated: data["Observation Time"] || new Date().toISOString(),
      count: kpValue == null ? `${Math.round(peak)}%` : `Kp ${kpValue.toFixed(1)}`,
      extra: [kpText + storm, forecast, `Peak chance ${Math.round(peak)}%`].filter(Boolean).map(esc).join(" · "),
      empty: peak < 4 ? "No aurora expected right now" : "",
      error: kp.status === "rejected" ? "Kp index did not answer" : "",
    });
  }

  // ---------- NWS alerts (server cache) ----------
  const SEV_COLOR = { Extreme: "#c0007a", Severe: "#e0262a", Moderate: "#f08a24", Minor: "#f6e27a", Unknown: "#9aa6ad" };

  async function loadNws() {
    const token = st.nwsalerts.token;
    const body = await getJson(URLS.nwsalerts);
    if (token !== st.nwsalerts.token) return;
    const Cesium = C();
    const src = source("nwsalerts");
    src.entities.removeAll();
    const alerts = Array.isArray(body.alerts) ? body.alerts : [];
    const alertLines = (idx) => {
      const a = alerts[idx] || {};
      return `${a.e || "Alert"} (${a.s || "?"})${a.x ? ` until ${fmtTime(a.x)}` : ""}`;
    };
    for (const poly of body.polygons || []) {
      const a = alerts[poly.i];
      if (!a || !Array.isArray(poly.r)) continue;
      const flat = [];
      for (const pt of poly.r) flat.push(pt[1], pt[0]);
      const color = Cesium.Color.fromCssColorString(SEV_COLOR[a.s] || SEV_COLOR.Unknown);
      const lat = poly.r.reduce((s, p) => s + p[0], 0) / poly.r.length;
      const lon = poly.r.reduce((s, p) => s + p[1], 0) / poly.r.length;
      const entity = src.entities.add({
        name: a.e,
        // A position lets the far-side culling in cesium.js keep the polygon.
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
          material: color.withAlpha(0.35),
          outline: true,
          outlineColor: color,
          height: 0,
        },
      });
      entity._live = { layer: "nwsalerts", sw: true, kind: "NWS", name: a.e, lat, lon, lines: [alertLines(poly.i), a.h], link: a.u ? { url: a.u, label: "NWS alert" } : null };
    }
    for (const p of body.points || []) {
      const list = Array.isArray(p.a) ? p.a : [];
      const top = alerts[list[0]] || {};
      addPin("nwsalerts", {
        name: `${top.e || "Alert"} · ${p.n || ""}`,
        kind: "NWS",
        lat: Number(p.lat),
        lon: Number(p.lon),
        color: SEV_COLOR[top.s] || SEV_COLOR.Unknown,
        size: top.s === "Extreme" || top.s === "Severe" ? 10 : 8,
        lines: [p.n || "", ...list.slice(0, 6).map(alertLines), top.h || ""],
        link: top.u ? { url: top.u, label: "NWS alert" } : null,
      });
    }
    const n = Number(body.count) || 0;
    settle("nwsalerts", {
      updated: body.updated || null,
      count: n,
      empty: n ? "" : body.error === "Awaiting poller" ? "Waiting for the first server pull" : "No active US alerts",
      extra: body.unmapped ? `${body.unmapped} alert(s) without a map location` : "",
      error: body.stale && body.error && body.error !== "Awaiting poller" ? `Last pull failed (${body.error}); showing saved alerts` : body.stale && body.ageSec ? "Saved alerts are old" : "",
    });
  }

  // ---------- hurricanes (server cache) ----------
  function stormColor(kt) {
    const v = Number(kt) || 0;
    if (v >= 137) return "#c0007a";
    if (v >= 113) return "#e0262a";
    if (v >= 96) return "#f04a24";
    if (v >= 83) return "#f08a24";
    if (v >= 64) return "#f6c34a";
    if (v >= 34) return "#7fe7ff";
    return "#9fd4e2";
  }

  async function loadHurricanes() {
    const token = st.hurricanes.token;
    const body = await getJson(URLS.hurricanes);
    if (token !== st.hurricanes.token) return;
    const src = source("hurricanes");
    src.entities.removeAll();
    const storms = Array.isArray(body.points) ? body.points : [];
    for (const s of storms) {
      const cls = { HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", STD: "Subtropical Depression", PTC: "Post-tropical Cyclone", PC: "Potential Tropical Cyclone" }[s.cls] || s.cls || "Storm";
      addPin("hurricanes", {
        name: `${cls} ${s.name}`,
        kind: "NHC",
        lat: Number(s.lat),
        lon: Number(s.lon),
        color: stormColor(s.kt),
        size: 22,
        lines: [
          s.kt != null ? `Winds ${s.kt} kt (${Math.round(s.kt * 1.15078)} mph)` : "",
          s.mb != null ? `Pressure ${s.mb} mb` : "",
          s.dir != null && s.mph != null ? `Moving ${s.dir}° at ${s.mph} mph` : "",
          s.at ? `Advisory ${fmtTime(s.at)}` : "",
        ],
        link: { url: s.url || "https://www.nhc.noaa.gov/", label: "NHC advisory" },
      });
    }
    const awaiting = body.error === "Awaiting poller";
    settle("hurricanes", {
      updated: body.updated || null,
      count: storms.length,
      empty: storms.length ? "" : awaiting ? "Waiting for the first server pull" : "No active storms (Atlantic and Pacific, NHC)",
      error: body.stale && !awaiting && body.error ? `Last pull failed (${body.error})` : "",
    });
  }

  // ---------- wildfires (server cache) ----------
  function fireColor(frp) {
    if (frp >= 1000) return "#ff2a1a";
    if (frp >= 200) return "#ff6a1a";
    if (frp >= 50) return "#ff9d2a";
    return "#ffd25a";
  }

  async function loadWildfires() {
    const token = st.wildfires.token;
    const body = await getJson(URLS.wildfires);
    if (token !== st.wildfires.token) return;
    const src = source("wildfires");
    src.entities.removeAll();
    const pts = Array.isArray(body.points) ? body.points : [];
    for (const p of pts) {
      const frp = Number(p.frp) || 0;
      const t = p.t ? `${String(p.t).slice(0, 10)}T${String(p.t).slice(11, 13)}:${String(p.t).slice(13, 15)}:00Z` : "";
      addPin("wildfires", {
        name: `${p.n} fire detection${p.n === 1 ? "" : "s"}`,
        kind: "FIRMS",
        lat: Number(p.lat),
        lon: Number(p.lon),
        color: fireColor(frp),
        size: frp >= 1000 ? 10 : frp >= 200 ? 7 : 5,
        outline: false,
        lines: [
          `Fire radiative power ${Math.round(frp).toLocaleString("en-US")} MW total (max ${Math.round(Number(p.max) || 0)} MW)`,
          t ? `Last pass ${fmtTime(t)}` : "",
          "Grouped in 0.25° cells (about 25 km)",
        ],
        link: { url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${Number(p.lon).toFixed(2)},${Number(p.lat).toFixed(2)},8.0z`, label: "FIRMS map" },
      });
    }
    const awaiting = body.error === "Awaiting poller";
    settle("wildfires", {
      updated: body.updated || null,
      count: pts.length,
      extra: body.count ? `${Number(body.count).toLocaleString("en-US")} detections${pts.length < (body.cells || 0) ? `, strongest ${pts.length.toLocaleString("en-US")} of ${Number(body.cells).toLocaleString("en-US")} areas shown` : ""}${body.sensor ? ` · ${esc(body.sensor)}` : ""}` : "",
      empty: pts.length ? "" : awaiting ? "Waiting for the first server pull" : "No fire detections in the last 24 h",
      error: body.stale && !awaiting && body.error ? `Last pull failed (${body.error}); showing saved fires` : "",
    });
  }

  // ---------- river gauges in flood (server cache, NOAA NWPS) ----------
  const RIVER_COLOR = { action: "#f6e27a", minor: "#f08a24", moderate: "#e0262a", major: "#b04ae0" };
  const RIVER_LABEL = { action: "At action stage", minor: "Minor flooding", moderate: "Moderate flooding", major: "Major flooding" };

  function ft(v, unit) {
    return v == null || v === "" ? "" : `${Number(v).toFixed(2).replace(/\.?0+$/, "")} ${unit || "ft"}`;
  }

  async function loadRivers() {
    const token = st.rivers.token;
    const body = await getJson(URLS.rivers);
    if (token !== st.rivers.token) return;
    const src = source("rivers");
    src.entities.removeAll();
    const pts = Array.isArray(body.points) ? body.points : [];
    for (const g of pts) {
      const u = g.u || "ft";
      const thr = [
        g.a != null ? `action ${ft(g.a, u)}` : "",
        g.mi != null ? `minor ${ft(g.mi, u)}` : "",
        g.mo != null ? `moderate ${ft(g.mo, u)}` : "",
        g.ma != null ? `major ${ft(g.ma, u)}` : "",
      ].filter(Boolean).join(", ");
      addPin("rivers", {
        name: `${g.n || g.id}${g.st ? `, ${g.st}` : ""}`,
        kind: "RIVER GAUGE",
        lat: Number(g.lat),
        lon: Number(g.lon),
        color: RIVER_COLOR[g.s] || "#9aa6ad",
        size: g.s === "major" || g.s === "moderate" ? 12 : g.s === "minor" ? 10 : 8,
        lines: [
          `${RIVER_LABEL[g.s] || g.s}${g.w ? ` · ${g.w}` : ""}`,
          g.obs != null ? `Observed ${ft(g.obs, u)}${g.t ? ` at ${fmtTime(g.t)}` : ""}` : "",
          thr ? `Flood stages: ${thr}` : "",
        ],
        link: { url: `https://water.noaa.gov/gauges/${encodeURIComponent(g.id || "")}`, label: "NWS gauge page" },
      });
    }
    const awaiting = body.error === "Awaiting poller";
    const by = body.byStatus || {};
    settle("rivers", {
      updated: body.updated || null,
      count: pts.length,
      extra: pts.length ? ["major", "moderate", "minor", "action"].filter((k) => by[k]).map((k) => `${by[k]} ${k}`).join(", ") : "",
      empty: pts.length ? "" : awaiting ? "Waiting for the first server pull" : "No NWS forecast gauges at or above action stage",
      error: body.stale && !awaiting && body.error ? `Last pull failed (${body.error}); showing saved gauges` : "",
    });
  }

  // ---------- coastal water levels (server cache, NOAA CO-OPS) ----------
  const COAST_COLOR = { normal: "#3aa6ff", near: "#f6e27a", minor: "#f08a24", moderate: "#e0262a", major: "#b04ae0", none: "#8a949b", stale: "#5e676d" };
  const COAST_LABEL = { normal: "Below flood thresholds", near: "Approaching minor flood (within 0.5 ft or at action)", minor: "Minor coastal flooding", moderate: "Moderate coastal flooding", major: "Major coastal flooding", none: "No flood threshold for this station", stale: "No reading in the last hour" };

  function signedFt(v) {
    if (v == null) return "";
    const n = Number(v);
    return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} ft`;
  }

  async function loadCoastal() {
    const token = st.coastal.token;
    const body = await getJson(URLS.coastal);
    if (token !== st.coastal.token) return;
    const src = source("coastal");
    src.entities.removeAll();
    const pts = Array.isArray(body.points) ? body.points : [];
    for (const p of pts) {
      const dat = p.dat === "IGLD" ? "IGLD 1985" : p.dat;
      const thr = p.thr ? [
        p.thr.a != null ? `action ${p.thr.a.toFixed(2)}` : "",
        p.thr.mi != null ? `minor ${p.thr.mi.toFixed(2)}` : "",
        p.thr.mo != null ? `moderate ${p.thr.mo.toFixed(2)}` : "",
        p.thr.ma != null ? `major ${p.thr.ma.toFixed(2)}` : "",
      ].filter(Boolean).join(", ") : "";
      const hot = p.c === "minor" || p.c === "moderate" || p.c === "major";
      addPin("coastal", {
        name: `${p.n}${p.st ? `, ${p.st}` : ""}`,
        kind: "WATER LEVEL",
        lat: Number(p.lat),
        lon: Number(p.lon),
        color: COAST_COLOR[p.c] || COAST_COLOR.none,
        size: hot ? 12 : p.c === "near" ? 10 : 7,
        lines: [
          COAST_LABEL[p.c] || "",
          `Latest ${Number(p.lvl).toFixed(2)} ft ${dat}${p.t ? ` at ${fmtTime(p.t)}` : ""}`,
          p.mhhw != null ? `${signedFt(p.mhhw)} vs. mean higher high water (MHHW)` : "",
          p.lwd != null ? `${signedFt(p.lwd)} vs. low water datum` : "",
          thr ? `${p.thr.src} flood thresholds (ft ${dat}): ${thr}` : "",
        ],
        link: { url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(p.id)}`, label: "CO-OPS station page" },
      });
    }
    const awaiting = body.error === "Awaiting poller";
    const by = body.byLevel || {};
    const flooding = (by.minor || 0) + (by.moderate || 0) + (by.major || 0);
    settle("coastal", {
      updated: body.updated || null,
      count: pts.length,
      extra: pts.length ? `${flooding} at or above minor flood, ${by.near || 0} approaching` : "",
      empty: pts.length ? "" : awaiting ? "Waiting for the first server pull" : "No CO-OPS water levels in the last pull",
      error: body.stale && !awaiting && body.error ? `Last pull failed (${body.error}); showing saved levels` : "",
    });
  }

  // ---------- tsunami alerts (server cache, NOAA NTWC + PTWC) ----------
  const TSU_COLOR = { Warning: "#e0262a", Advisory: "#f08a24", Threat: "#f08a24", Watch: "#f6e27a" };
  const TSU_LABEL = { Warning: "Tsunami Warning", Advisory: "Tsunami Advisory", Watch: "Tsunami Watch", Threat: "Tsunami Threat Message" };

  async function loadTsunami() {
    const token = st.tsunami.token;
    const body = await getJson(URLS.tsunami);
    if (token !== st.tsunami.token) return;
    const Cesium = C();
    const src = source("tsunami");
    src.entities.removeAll();
    const pts = Array.isArray(body.points) ? body.points : [];
    for (const a of pts) {
      const color = TSU_COLOR[a.cat] || "#f08a24";
      const lines = [
        `${a.center === "PTWC" ? "Pacific Tsunami Warning Center" : "National Tsunami Warning Center"}${a.mag ? ` · magnitude ${a.mag}` : ""}`,
        a.head || "",
        a.areas && a.areas.length ? `Areas: ${a.areas.join("; ")}` : "",
        a.t ? `Issued ${fmtTime(a.t)}` : "",
        a.exp ? `Expires ${fmtTime(a.exp)}` : "",
      ];
      const link = { url: a.url || "https://www.tsunami.gov/", label: "Bulletin at tsunami.gov" };
      for (const ring of a.polys || []) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        const flat = [];
        for (const pt of ring) flat.push(pt[1], pt[0]);
        const lat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const lon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        const c = Cesium.Color.fromCssColorString(color);
        const entity = src.entities.add({
          name: TSU_LABEL[a.cat] || a.cat,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(flat), material: c.withAlpha(0.3), outline: true, outlineColor: c, height: 0 },
        });
        entity._live = { layer: "tsunami", sw: true, kind: "TSUNAMI", name: `${TSU_LABEL[a.cat] || a.cat} · ${a.region}`, lat, lon, lines, link };
      }
      if (a.lat != null && a.lon != null) {
        addPin("tsunami", {
          name: `${TSU_LABEL[a.cat] || a.cat} · ${a.region}`,
          kind: "TSUNAMI",
          lat: Number(a.lat),
          lon: Number(a.lon),
          color,
          size: a.cat === "Warning" ? 20 : 16,
          lines: ["Earthquake epicenter", ...lines],
          link,
        });
      }
    }
    const notes = Array.isArray(body.notes) ? body.notes : [];
    const awaiting = body.error === "Awaiting poller";
    settle("tsunami", {
      updated: body.updated || null,
      count: pts.length,
      extra: [
        pts.length ? pts.map((a) => `<b>${esc(TSU_LABEL[a.cat] || a.cat)}</b>: ${esc(a.region)}`).join("; ") : "",
        notes.length ? `Information only (no danger): ${notes.map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noreferrer">${esc(n.region)}${n.mag ? ` M${esc(String(n.mag).replace(/\(.*$/, ""))}` : ""}</a>`).join("; ")}` : "",
        body.partial ? `<span class="sw-err">${esc(body.partial)}</span>` : "",
      ].filter(Boolean).join(" · "),
      empty: pts.length ? "" : awaiting ? "Waiting for the first server pull" : "No tsunami warnings, advisories or watches (NOAA NTWC/PTWC)",
      error: body.stale && !awaiting && body.error ? `Last pull failed (${body.error}); showing saved alerts` : "",
    });
  }

  const LOADERS = {
    iss: loadIss,
    volcanoes: loadVolcanoes,
    disasters: loadDisasters,
    radar: loadRadar,
    nwsalerts: loadNws,
    aurora: loadAurora,
    hurricanes: loadHurricanes,
    wildfires: loadWildfires,
    rivers: loadRivers,
    coastal: loadCoastal,
    tsunami: loadTsunami,
  };

  function refreshSelected(key) {
    const viewer = ctx && ctx.viewer();
    const selected = viewer && viewer.selectedEntity;
    const box = document.getElementById("selected");
    if (selected && selected._live && selected._live.layer === key && box && !box.hidden && ctx.showLive) ctx.showLive(selected._live);
  }

  function run(key, first) {
    const s = st[key];
    if (!s.on) return;
    if (!first && document.hidden) return;
    Promise.resolve()
      .then(() => LOADERS[key](first))
      .catch((error) => {
        if (error && error.unchanged) return;
        fail(key, error);
      });
  }

  function setActive(key, on) {
    if (!st[key]) return;
    const s = st[key];
    const was = s.on;
    s.on = Boolean(on);
    if (s.on && !was) {
      s.token += 1;
      run(key, true);
      clearInterval(s.timer);
      s.timer = setInterval(() => run(key, false), META[key].poll);
    } else if (!s.on) {
      s.token += 1;
      clearInterval(s.timer);
      s.timer = 0;
      if (key === "radar" || key === "aurora") removeImagery(key);
      if (key === "iss") {
        const src = source("iss");
        if (src) src.entities.removeAll();
        iss.entity = null;
        iss.track = [];
      }
    }
    render(key);
  }

  // applyBasemap() clears every imagery layer; put ours back on top.
  function reapplyImagery() {
    const viewer = ctx && ctx.viewer();
    if (!viewer) return;
    for (const key of ["radar", "aurora"]) {
      const layer = imagery[key];
      if (!layer || !st[key].on) continue;
      if (!viewer.imageryLayers.contains(layer)) {
        const fresh = viewer.imageryLayers.addImageryProvider(layer._swProvider);
        fresh.alpha = layer.alpha;
        fresh._swKey = key;
        fresh._swProvider = layer._swProvider;
        imagery[key] = fresh;
      }
    }
  }

  function popupHtml(item) {
    const lines = (item.lines || []).filter(Boolean).map((line) => esc(line));
    let html = lines.length ? `<br>${lines.join("<br>")}` : "";
    if (item.link && item.link.url) html += `<br><a href="${esc(item.link.url)}" target="_blank" rel="noreferrer">${esc(item.link.label || "Source")}</a>`;
    return html;
  }

  function statusParts() {
    return KEYS.filter((key) => shown(key)).map((key) => {
      const s = st[key];
      return s.count == null ? META[key].label : `${META[key].label} ${s.count}`;
    });
  }

  function onVisible() {
    for (const key of KEYS) if (st[key].on) run(key, false);
  }

  function init(options) {
    ctx = options;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) onVisible();
    });
    // Keep the "x min ago" text honest.
    setInterval(() => {
      for (const key of KEYS) if (st[key].on) render(key);
    }, 30000);
    for (const key of KEYS) render(key);
  }

  root.GsaSpaceWeather = {
    KEYS,
    META,
    URLS,
    init,
    setActive,
    reapplyImagery,
    renderGroupCount,
    popupHtml,
    statusParts,
    state: st,
    labels: Object.fromEntries(KEYS.map((key) => [key, META[key].label])),
  };
})(typeof window !== "undefined" ? window : globalThis);
