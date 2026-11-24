/* Global Status · INFRASTRUCTURE layers (static files in /infra/, no cron).
 *
 *   AIRPORTS        OurAirports (public domain), built by scripts/build_infra_layers.py
 *                   /infra/airports-major.json      large + medium airports
 *                   /infra/airports-small/<tile>.json small airports + seaplane bases,
 *                   15-degree tiles, fetched only when zoomed in over that tile
 *   MILITARY BASES  OpenStreetMap contributors (ODbL), military=base | barracks |
 *                   airfield | naval_base, /infra/military-bases.json
 *
 * Drawn with Cesium PointPrimitiveCollections (tens of thousands of points stay
 * cheap on phones). Nothing is fetched until a layer is switched on.
 */
(function (root) {
  const KEYS = ["airports", "bases"];
  const V = "20261123t";
  const BASE_URL = "/infra/";
  // Small airports appear below this camera height (metres above the ellipsoid).
  const SMALL_MAX_HEIGHT = 1200 * 1000;
  const MAX_TILES = 16;

  const META = {
    airports: {
      label: "AIRPORTS",
      credit: 'Airports: <a href="https://ourairports.com/" target="_blank" rel="noreferrer">OurAirports</a> (public domain)',
      caption: "Large and medium airports. Zoom in to see small airports and seaplane bases. Closed airports and heliports are left out.",
    },
    bases: {
      label: "MILITARY BASES",
      credit: 'Military bases: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)',
      caption: "Community-mapped from OpenStreetMap — incomplete; a blank area does not mean no base.",
    },
  };

  const AIRPORT_TYPE = { L: "LARGE AIRPORT", M: "MEDIUM AIRPORT", S: "SMALL AIRPORT", W: "SEAPLANE BASE" };
  const AIRPORT_STYLE = {
    L: { color: "#ffffff", size: 9 },
    M: { color: "#c9dcef", size: 7 },
    S: { color: "#8fa6bf", size: 5 },
    W: { color: "#6fc3e8", size: 5 },
  };
  const BASE_TYPE = { B: "MILITARY BASE", K: "BARRACKS", A: "MILITARY AIRFIELD", N: "NAVAL BASE" };
  const BASE_UNNAMED = { B: "Unnamed military base", K: "Unnamed barracks", A: "Unnamed military airfield", N: "Unnamed naval base" };
  const BASE_STYLE = {
    B: { color: "#c58cff", size: 7 },
    A: { color: "#e0b8ff", size: 7 },
    N: { color: "#9f7bff", size: 7 },
    K: { color: "#a77ad6", size: 5 },
  };
  const OSM_TYPE = { n: "node", w: "way", r: "relation" };
  const OUTLINE = "#1a1d27";

  let ctx = null;
  const st = {};
  for (const key of KEYS) st[key] = { on: false, loading: null, ready: false, error: "", count: null, built: "" };
  const air = { major: null, small: null, countries: {}, index: null, indexLoading: null, tiles: new Map(), smallShown: false, smallCount: 0, tileDeg: 15 };
  const mil = { coll: null, countries: {} };
  let lastShown = null;

  // Address-search area check (nearby.js): hidden while loading, then optionally only
  // the points that pass filters[key] (inside the search circle).
  const filters = {};
  function hidden(key) { return Boolean(root.gsProbeHidden && root.gsProbeHidden(key)); }
  function shown(key) { return st[key].on && !hidden(key); }

  function C() { return root.Cesium; }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function fmt(n) { return Number(n).toLocaleString("en-US"); }

  async function getJson(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      // GoDaddy's firewall sometimes answers with an HTML page instead of the file.
      throw new Error("the server sent a page instead of data");
    }
  }

  async function getJsonRetry(url) {
    try {
      return await getJson(url);
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return getJson(url);
    }
  }

  function newCollection() {
    const v = viewer();
    const Cesium = C();
    const coll = new Cesium.PointPrimitiveCollection();
    coll.show = false;
    v.scene.primitives.add(coll);
    return coll;
  }

  function addPoint(coll, lat, lon, style, id) {
    const Cesium = C();
    coll.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      pixelSize: style.size,
      color: style.cssColor || (style.cssColor = Cesium.Color.fromCssColorString(style.color)),
      outlineColor: style.cssOutline || (style.cssOutline = Cesium.Color.fromCssColorString(OUTLINE)),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      id,
    });
    // A search-circle filter is on (nearby.js): new points start out filtered, so a tile
    // that lands between two culls never shows pins outside the circle.
    const f = id && filters[id.__infra];
    if (f) {
      const p = coll.get(coll.length - 1);
      p.show = f(p.position);
    }
  }

  // ---------- notes, counts, credits ----------
  function countText(key) {
    const s = st[key];
    if (!shown(key)) return "—";
    if (s.count == null) return "…";
    if (key === "airports" && air.smallShown && air.smallCount) return `${fmt(s.count)} + ${fmt(air.smallCount)}`;
    return fmt(s.count);
  }

  function render(key) {
    const s = st[key];
    const note = document.querySelector(`[data-infra-note="${key}"]`);
    if (note) {
      note.hidden = !shown(key);
      if (shown(key)) {
        const bits = [META[key].credit, `<i>${esc(META[key].caption)}</i>`];
        if (s.ready && key === "airports") {
          bits.push(air.smallShown
            ? `Showing ${fmt(air.smallCount)} small airports in view`
            : `${fmt(s.count)} large and medium airports`);
        }
        if (s.ready && key === "bases") bits.push(`${fmt(s.count)} mapped sites (bases, barracks, airfields, naval bases)`);
        if (s.built) bits.push(`Data from ${esc(s.built)}`);
        if (!s.ready && !s.error) bits.push("Loading…");
        if (s.error) bits.push(`<span class="sw-err">${esc(s.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(key, countText(key));
    renderCredit();
    renderGroupCount();
  }

  function renderCredit() {
    const line = document.querySelector(".infra-credit");
    if (!line) return;
    const on = KEYS.filter((key) => shown(key));
    line.hidden = !on.length;
    const track = line.querySelector(".infra-credit-track");
    if (track) track.innerHTML = on.map((key) => META[key].credit).join(" · ");
  }

  function renderGroupCount() {
    // MENU category headers ("N ON") are counted for every group by cesium.js.
    if (typeof window.gsSyncLayerGroups === "function") window.gsSyncLayerGroups();
  }

  function fail(key, error) {
    st[key].error = `${META[key].label}: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
    render(key);
  }

  // ---------- AIRPORTS ----------
  async function loadAirports() {
    const body = await getJsonRetry(`${BASE_URL}airports-major.json?v=${V}`);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    air.countries = body.countries || {};
    air.major = newCollection();
    for (const row of rows) {
      const style = AIRPORT_STYLE[row[2]] || AIRPORT_STYLE.M;
      addPoint(air.major, row[3], row[4], style, { __infra: "airports", row, small: false });
    }
    air.small = newCollection();
    st.airports.count = rows.length;
    st.airports.built = body.built || "";
    st.airports.ready = true;
  }

  function cameraHeight() {
    const v = viewer();
    if (!v) return Infinity;
    const carto = v.camera.positionCartographic;
    return carto ? carto.height : Infinity;
  }

  function tileKeysInView() {
    const v = viewer();
    const Cesium = C();
    const deg = air.tileDeg;
    let rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
    let west, south, east, north;
    if (rect) {
      west = Cesium.Math.toDegrees(rect.west);
      south = Cesium.Math.toDegrees(rect.south);
      east = Cesium.Math.toDegrees(rect.east);
      north = Cesium.Math.toDegrees(rect.north);
    } else {
      const c = v.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(c.latitude);
      const lon = Cesium.Math.toDegrees(c.longitude);
      west = lon - 15; east = lon + 15; south = lat - 12; north = lat + 12;
    }
    south = Math.max(-90, south);
    north = Math.min(90, north);
    const rows = [];
    for (let r = Math.floor((south + 90) / deg); r <= Math.min(Math.floor((north + 90) / deg), 180 / deg - 1); r += 1) rows.push(r);
    const cols = [];
    const ncol = 360 / deg;
    const pushCols = (w, e) => {
      for (let c = Math.floor((w + 180) / deg); c <= Math.min(Math.floor((e + 180) / deg), ncol - 1); c += 1) cols.push(((c % ncol) + ncol) % ncol);
    };
    if (east >= west) pushCols(west, east);
    else { pushCols(west, 180); pushCols(-180, east); }
    const keys = [];
    for (const r of rows) for (const c of cols) keys.push(`${r}_${c}`);
    return keys;
  }

  async function loadTile(key) {
    if (air.tiles.has(key)) return air.tiles.get(key);
    const job = getJsonRetry(`${BASE_URL}airports-small/${key}.json?v=${V}`).then((body) => {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!air.small) return rows;
      for (const row of rows) {
        const style = AIRPORT_STYLE[row[2]] || AIRPORT_STYLE.S;
        addPoint(air.small, row[3], row[4], style, { __infra: "airports", row, small: true });
      }
      air.smallCount += rows.length;
      cullSoon();
      return rows;
    }).catch((error) => {
      air.tiles.delete(key);
      throw error;
    });
    air.tiles.set(key, job);
    return job;
  }

  async function ensureIndex() {
    if (air.index) return air.index;
    if (!air.indexLoading) {
      air.indexLoading = getJsonRetry(`${BASE_URL}airports-small/index.json?v=${V}`).then((body) => {
        air.index = body;
        air.tileDeg = Number(body.tile_deg) || 15;
        return body;
      }).finally(() => { air.indexLoading = null; });
    }
    return air.indexLoading;
  }

  async function updateSmall() {
    if (!st.airports.on || !st.airports.ready || !air.small) return;
    const near = cameraHeight() < SMALL_MAX_HEIGHT;
    air.smallShown = near;
    air.small.show = near && !hidden("airports");
    cullSoon();
    if (near) {
      try {
        const index = await ensureIndex();
        if (!st.airports.on) return;
        const want = tileKeysInView().filter((key) => index.tiles && index.tiles[key] && !air.tiles.has(key)).slice(0, MAX_TILES);
        await Promise.all(want.map((key) => loadTile(key)));
        if (want.length) cullSoon(); // new points: horizon and search-circle filter
      } catch (error) {
        st.airports.error = `Small airports: ${error && error.message ? error.message : String(error)}`;
      }
    }
    render("airports");
  }

  // ---------- MILITARY BASES ----------
  async function loadBases() {
    const body = await getJsonRetry(`${BASE_URL}military-bases.json?v=${V}`);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    mil.countries = body.countries || {};
    mil.coll = newCollection();
    for (const row of rows) {
      const style = BASE_STYLE[row[0]] || BASE_STYLE.B;
      addPoint(mil.coll, row[1], row[2], style, { __infra: "bases", row });
    }
    st.bases.count = rows.length;
    st.bases.built = body.built ? `OSM ${snapshotDate(body.snapshot) || body.built}` : "";
    st.bases.ready = true;
  }

  function snapshotDate(text) {
    const m = /planet-(\d{2})(\d{2})(\d{2})\.osm/.exec(String(text || ""));
    if (!m) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, 20${m[1]}`;
  }

  // ---------- horizon culling ----------
  // Points ignore depth so terrain never hides them; hide the far side instead.
  let cullAt = 0;
  let cullDirty = true;
  const lastCam = { x: NaN, y: NaN, z: NaN, dx: NaN };

  function cullSoon() { cullDirty = true; }

  function collections() {
    return [air.major, air.small, mil.coll].filter((coll) => coll && coll.show);
  }

  function cull() {
    const v = viewer();
    if (!v) return;
    const colls = collections();
    if (!colls.length) return;
    const Cesium = C();
    const cam = v.camera.positionWC;
    const dir = v.camera.directionWC;
    const moved = cam.x !== lastCam.x || cam.y !== lastCam.y || cam.z !== lastCam.z || dir.x !== lastCam.dx;
    if (!moved && !cullDirty) return;
    const now = performance.now();
    if (!cullDirty && now - cullAt < 120) return;
    cullAt = now;
    cullDirty = false;
    lastCam.x = cam.x; lastCam.y = cam.y; lastCam.z = cam.z; lastCam.dx = dir.x;
    const flat = v.scene.mode !== Cesium.SceneMode.SCENE3D;
    const occluder = cull.occluder || (cull.occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84));
    occluder.cameraPosition = cam;
    for (const coll of colls) {
      for (let i = 0, n = coll.length; i < n; i += 1) {
        const p = coll.get(i);
        const f = p.id && filters[p.id.__infra];
        p.show = (flat || occluder.isPointVisible(p.position)) && (!f || f(p.position));
      }
    }
  }

  // ---------- picking and popups ----------
  function pick(position) {
    const v = viewer();
    if (!v || !KEYS.some((key) => st[key].on)) return null;
    const picked = v.scene.pick(position, 11, 11);
    const id = picked && picked.id;
    if (!id || !id.__infra || !st[id.__infra].on) return null;
    return itemFor(id);
  }

  function countryName(map, cc) {
    return String(cc || "").split("/").filter(Boolean).map((code) => map[code] || code).join(" / ");
  }

  function itemFor(id) {
    const row = id.row;
    if (id.__infra === "airports") {
      const small = id.small;
      const ident = row[0];
      const iata = small ? row[8] : row[6];
      const icao = small ? "" : row[7];
      const city = small ? row[6] : row[8];
      const cc = small ? row[7] : row[9];
      return {
        infra: true, layer: "airports", kind: AIRPORT_TYPE[row[2]] || "AIRPORT", name: row[1] || ident,
        lat: row[3], lon: row[4], ident, iata, icao, city, country: countryName(air.countries, cc) || cc, cc, elevFt: row[5], type: row[2],
      };
    }
    const named = row[3] || row[4];
    return {
      infra: true, layer: "bases", kind: BASE_TYPE[row[0]] || "MILITARY SITE",
      name: named ? (row[3] || row[4]) : BASE_UNNAMED[row[0]] || "Unnamed military site",
      nameEn: row[3] && row[4] ? row[4] : "", lat: row[1], lon: row[2],
      osmType: OSM_TYPE[row[5]] || "node", osmId: row[6], country: countryName(mil.countries, row[7]),
    };
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item; // the nearby list is not the open popup
    const lines = [];
    let link = "";
    if (item.layer === "airports") {
      const codes = [item.iata && `IATA ${item.iata}`, item.icao && `ICAO ${item.icao}`, item.ident && item.ident !== item.icao && `ID ${item.ident}`].filter(Boolean);
      if (codes.length) lines.push(codes.join(" · "));
      lines.push([item.city, item.country].filter(Boolean).join(", "));
      if (item.elevFt != null && item.elevFt !== "") lines.push(`Elevation ${fmt(item.elevFt)} ft (${fmt(Math.round(item.elevFt * 0.3048))} m)`);
      link = `<a href="https://ourairports.com/airports/${encodeURIComponent(item.ident)}/" target="_blank" rel="noreferrer">OurAirports page</a>`;
    } else {
      if (item.nameEn) lines.push(item.nameEn);
      if (item.country) lines.push(item.country);
      lines.push(`OSM ${item.osmType} ${item.osmId}`);
      link = `<a href="https://www.openstreetmap.org/${item.osmType}/${encodeURIComponent(item.osmId)}" target="_blank" rel="noreferrer">OpenStreetMap record</a>`;
    }
    let html = lines.filter(Boolean).map((line) => `<br>${esc(line)}`).join("");
    html += `<br>${link}`;
    if (item.layer === "bases") html += `<br><i class="infra-caption">${esc(META.bases.caption)}</i>`;
    else html += '<br><i class="infra-caption">Data: OurAirports (public domain)</i>';
    return html;
  }

  function hidePopupFor(key) {
    if (!lastShown || lastShown.layer !== key) return;
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  // ---------- switching ----------
  function setActive(key, on) {
    if (!st[key]) return;
    const s = st[key];
    s.on = Boolean(on);
    if (key === "airports") {
      if (air.major) air.major.show = shown(key);
      if (air.small) air.small.show = shown(key) && air.smallShown;
    }
    if (key === "bases" && mil.coll) mil.coll.show = shown(key);
    if (!s.on) hidePopupFor(key);
    if (s.on && !s.ready && !s.loading) {
      s.error = "";
      s.loading = (key === "airports" ? loadAirports() : loadBases())
        .then(() => {
          if (key === "airports") {
            air.major.show = shown("airports");
            updateSmall();
          } else mil.coll.show = shown("bases");
          cullSoon();
          if (ctx && ctx.statusLive) ctx.statusLive();
        })
        .catch((error) => fail(key, error))
        .finally(() => { s.loading = null; render(key); });
    } else if (s.on && key === "airports") {
      updateSmall();
    }
    cullSoon();
    render(key);
  }

  function statusParts() {
    return KEYS.filter((key) => shown(key)).map((key) => (st[key].count == null ? META[key].label : `${META[key].label} ${countText(key)}`));
  }

  function init(options) {
    ctx = options;
    const v = viewer();
    if (v) {
      v.scene.preRender.addEventListener(cull);
      v.camera.moveEnd.addEventListener(() => {
        if (st.airports.on) updateSmall();
        cullSoon();
      });
      if (v.scene.morphComplete) v.scene.morphComplete.addEventListener(cullSoon);
    }
    for (const key of KEYS) render(key);
  }

  // fn(cartesian) -> keep this point; null shows every point again.
  function setFilter(key, fn) {
    if (fn) filters[key] = fn;
    else delete filters[key];
    cullSoon();
    try { cull(); } catch (error) { /* the next frame retries */ }
  }

  root.GsaInfra = {
    KEYS,
    setFilter,
    itemFor,
    init,
    setActive,
    pick,
    popupHtml,
    statusParts,
    state: st,
    labels: Object.fromEntries(KEYS.map((key) => [key, META[key].label])),
  };
})(typeof window !== "undefined" ? window : globalThis);
