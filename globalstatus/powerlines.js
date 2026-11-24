/* Global Status · USA POWER LINES (saved static files, not a live feed).
 *
 * Source: HIFLD U.S. Electric Power Transmission Lines (archive, Sep 30, 2024),
 * public U.S. government data. Built by scripts/build_power_lines.py into
 *   /infra/power-lines/overview.json      230 kV and up + DC, shown at every zoom
 *   /infra/power-lines/<row>_<col>.json   under 230 kV + unknown voltage, 5-degree
 *                                         tiles, loaded when zoomed in
 *   <name>.info.json                      card text, loaded on the first click
 *
 * Lines are batched Cesium GroundPolylinePrimitives (one per file), draped on the
 * globe or Elevation terrain, so the globe hides the far side and the lines turn
 * with it; no horizon cull needed.
 * Clicking a line fills the shared #selected card (close X, scrolls) with on-screen
 * text only. There are no links that leave globalstatus.app.
 */
(function (root) {
  const KEY = "powerlines";
  const V = "20261124n";
  const BASE = "/infra/power-lines/";
  // Lines under 230 kV appear below this camera height (metres above the ellipsoid).
  const DETAIL_MAX_HEIGHT = 900000;
  const MAX_TILES = 12;
  // Class codes from the build script.
  const CLASSES = [
    { label: "UNDER 100 KV", color: "#4fa3ff", width: 1.4 },
    { label: "100-161 KV", color: "#35d08a", width: 1.6 },
    { label: "220-287 KV", color: "#ffd24a", width: 2.0 },
    { label: "345 KV", color: "#ff9a3c", width: 2.4 },
    { label: "500 KV", color: "#ff4f4f", width: 2.8 },
    { label: "735 KV AND ABOVE", color: "#ff4fd8", width: 3.2 },
    { label: "DC", color: "#b48cff", width: 2.8 },
    { label: "VOLTAGE NOT LISTED", color: "#a7b0ba", width: 1.4 },
  ];
  const CAPTION = "High-voltage transmission lines from a saved copy of the HIFLD archive (Sep 30, 2024), not a live feed. Lines built since then are not shown. 230 kV and up at every zoom; zoom in for smaller lines.";

  let ctx = null;
  const st = { on: false, ready: false, error: "", count: null, detailShown: false, detailCount: 0 };
  let index = null;
  let indexLoading = null;
  let overview = null; // { primitive, count }
  const tiles = new Map(); // key -> Promise<{ primitive, count }>
  const infos = new Map(); // file -> Promise<info>
  let meta = { types: [], statuses: [], source: "" };
  let lastShown = null;
  let moveHooked = false;
  const classCache = new Map(); // file -> class code per line, from the shape file

  function C() { return root.Cesium; }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function hidden() { return Boolean(root.gsProbeHidden && root.gsProbeHidden(KEY)); }
  function shown() { return st.on && !hidden(); }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }

  async function getJson(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { cache: "default" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        try { return JSON.parse(text); } catch (err) { throw new Error("the server sent a page instead of data"); }
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw lastError;
  }

  // ---------- notes and counts ----------
  function countText() {
    if (!shown()) return "—";
    if (st.count == null) return "…";
    return st.detailShown && st.detailCount ? `${fmt(st.count)} + ${fmt(st.detailCount)}` : fmt(st.count);
  }

  function render() {
    const note = document.querySelector(`[data-power-note="${KEY}"]`);
    if (note) {
      note.hidden = !shown();
      if (shown()) {
        const bits = [esc(CAPTION)];
        const legend = CLASSES.map((c) => `<span class="pl-key" style="--pl:${c.color}"></span>${esc(c.label)}`).join(" ");
        bits.push(legend);
        if (st.ready) {
          bits.push(st.detailShown
            ? `${fmt(st.count)} major lines + ${fmt(st.detailCount)} smaller lines loaded nearby`
            : `${fmt(st.count)} major lines`);
        }
        if (!st.ready && !st.error) bits.push("Loading…");
        if (st.error) bits.push(`<span class="sw-err">${esc(st.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(KEY, countText());
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    const host = document.getElementById("cesium");
    if (host) {
      host.dataset.powerlines = String(overview ? overview.count : 0);
      host.dataset.powerlinesDetail = String(st.detailShown ? st.detailCount : 0);
    }
  }

  // ---------- drawing ----------
  function decode(flat, q) {
    const Cesium = C();
    const out = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      out.push(x / q, y / q);
    }
    return Cesium.Cartesian3.fromDegreesArray(out);
  }

  function buildPrimitive(body, file) {
    const Cesium = C();
    const v = viewer();
    const q = Number(body.q) || 1000;
    const rows = Array.isArray(body.lines) ? body.lines : [];
    classCache.set(file, rows.map((row) => row[0]));
    const colors = CLASSES.map((c) => Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(c.color)));
    const instances = [];
    rows.forEach((row, i) => {
      const cls = CLASSES[row[0]] ? row[0] : 7;
      const parts = Array.isArray(row[1]) ? row[1] : [];
      for (const part of parts) {
        if (!Array.isArray(part) || part.length < 4) continue;
        instances.push(new Cesium.GeometryInstance({
          // Ground polylines drape on the plain globe and on Elevation terrain, so
          // mountains never bury them; the globe still hides the far side.
          geometry: new Cesium.GroundPolylineGeometry({
            positions: decode(part, q),
            width: CLASSES[cls].width,
            arcType: Cesium.ArcType.GEODESIC,
          }),
          attributes: { color: colors[cls] },
          id: { __power: file, i },
        }));
      }
    });
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
      asynchronous: true,
      releaseGeometryInstances: true,
      allowPicking: true,
    });
    primitive.show = false;
    v.scene.primitives.add(primitive);
    return { primitive, count: rows.length };
  }

  async function ensureIndex() {
    if (index) return index;
    if (!indexLoading) {
      indexLoading = getJson(`${BASE}index.json?v=${V}`).then((body) => {
        index = body;
        return body;
      }).finally(() => { indexLoading = null; });
    }
    return indexLoading;
  }

  async function loadOverview() {
    const body = await getJson(`${BASE}overview.json?v=${V}`);
    if (!viewer()) return;
    overview = buildPrimitive(body, "overview");
    st.count = overview.count;
    st.ready = true;
  }

  function cameraHeight() {
    const v = viewer();
    const carto = v && v.camera.positionCartographic;
    return carto ? carto.height : Infinity;
  }

  function tileKeysInView(deg) {
    const v = viewer();
    const Cesium = C();
    const rect = v.camera.computeViewRectangle(v.scene.globe.ellipsoid);
    let west; let south; let east; let north;
    if (rect) {
      west = Cesium.Math.toDegrees(rect.west);
      south = Cesium.Math.toDegrees(rect.south);
      east = Cesium.Math.toDegrees(rect.east);
      north = Cesium.Math.toDegrees(rect.north);
    } else {
      const c = v.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(c.latitude);
      const lon = Cesium.Math.toDegrees(c.longitude);
      west = lon - 8; east = lon + 8; south = lat - 6; north = lat + 6;
    }
    // One tile of margin: a line is filed under the tile of its first point.
    south = Math.max(-90, south - deg);
    north = Math.min(90, north + deg);
    const center = v.camera.positionCartographic;
    const clat = Cesium.Math.toDegrees(center.latitude);
    const clon = Cesium.Math.toDegrees(center.longitude);
    const keys = [];
    const ncol = 360 / deg;
    const cols = [];
    const pushCols = (w, e) => {
      for (let c = Math.floor((w + 180) / deg); c <= Math.min(Math.floor((e + 180) / deg), ncol - 1); c += 1) cols.push(((c % ncol) + ncol) % ncol);
    };
    if (east >= west) pushCols(west - deg, east + deg);
    else { pushCols(west - deg, 180); pushCols(-180, east + deg); }
    for (let r = Math.floor((south + 90) / deg); r <= Math.min(Math.floor((north + 90) / deg), 180 / deg - 1); r += 1) {
      for (const c of cols) keys.push(`${r}_${c}`);
    }
    // Nearest tiles first, so the cap keeps the ones under the camera.
    const dist = (key) => {
      const [r, c] = key.split("_").map(Number);
      const lat = r * deg - 90 + deg / 2;
      const lon = c * deg - 180 + deg / 2;
      let dl = Math.abs(lon - clon);
      if (dl > 180) dl = 360 - dl;
      return (lat - clat) ** 2 + dl ** 2;
    };
    return keys.sort((a, b) => dist(a) - dist(b));
  }

  function loadTile(key) {
    if (tiles.has(key)) return tiles.get(key);
    const job = getJson(`${BASE}${key}.json?v=${V}`).then((body) => buildPrimitive(body, key)).catch((error) => {
      tiles.delete(key);
      throw error;
    });
    tiles.set(key, job);
    return job;
  }

  function applyShow() {
    const on = shown();
    if (overview) overview.primitive.show = on;
    let count = 0;
    const want = new Set(st.wantTiles || []);
    for (const [key, job] of tiles) {
      job.then((tile) => {
        tile.primitive.show = on && st.detailShown && want.has(key);
      }).catch(() => {});
    }
    for (const key of want) {
      if (index && index.tiles && index.tiles[key]) count += index.tiles[key];
    }
    st.detailCount = count;
  }

  let updating = false;
  let again = false;
  async function updateDetail() {
    if (!st.on || !st.ready || !viewer()) return;
    if (updating) { again = true; return; }
    updating = true;
    try {
      const near = cameraHeight() < DETAIL_MAX_HEIGHT;
      st.detailShown = near;
      if (near) {
        const idx = await ensureIndex();
        const deg = Number(idx.tile_deg) || 5;
        const keys = tileKeysInView(deg).filter((key) => idx.tiles && idx.tiles[key]).slice(0, MAX_TILES);
        st.wantTiles = keys;
        applyShow();
        render();
        await Promise.all(keys.map((key) => loadTile(key)));
      } else {
        st.wantTiles = [];
      }
      applyShow();
    } catch (error) {
      st.error = `Smaller lines: ${error && error.message ? error.message : String(error)}`;
    } finally {
      updating = false;
    }
    render();
    if (again) { again = false; updateDetail(); }
  }

  function hookCamera() {
    if (moveHooked) return;
    const v = viewer();
    if (!v) return;
    moveHooked = true;
    v.camera.moveEnd.addEventListener(() => { if (st.on) updateDetail(); });
  }

  // ---------- picking and cards ----------
  function pick(position) {
    const v = viewer();
    if (!v || !shown()) return null;
    // A few pixels of slack so thin lines are tappable on a phone.
    const picked = v.scene.pick(position, 9, 9);
    const id = picked && picked.id;
    if (!id || !id.__power) return null;
    const Cesium = C();
    let lat = null;
    let lon = null;
    const ground = v.camera.pickEllipsoid(position, v.scene.globe.ellipsoid);
    if (ground) {
      const carto = Cesium.Cartographic.fromCartesian(ground);
      lat = Cesium.Math.toDegrees(carto.latitude);
      lon = Cesium.Math.toDegrees(carto.longitude);
    }
    return { file: id.__power, i: id.i, lat, lon };
  }

  function loadInfo(file) {
    if (infos.has(file)) return infos.get(file);
    const job = getJson(`${BASE}${file}.info.json?v=${V}`).then((body) => {
      if (body.types) meta = body;
      return body;
    }).catch((error) => {
      infos.delete(file);
      throw error;
    });
    infos.set(file, job);
    return job;
  }

  async function itemFor(hit) {
    if (!meta.types.length) await loadInfo("overview");
    const info = await loadInfo(hit.file);
    const row = (info.rows || [])[hit.i] || [];
    const owners = info.owners || [];
    // row: voltage, owner index, substation 1, substation 2, type, status, inferred
    const cls = CLASSES[classOf(hit)] || CLASSES[7];
    const volt = row[0];
    const kind = volt ? `${fmt(volt)} KV POWER LINE` : (cls.label === "DC" ? "DC POWER LINE" : "POWER LINE");
    const a = row[2] || "";
    const b = row[3] || "";
    // "Tap point", "Riser", and "Dead end" stand in for unnamed ends in the source.
    const generic = (text) => !text || text === "Tap point" || text === "Riser" || text === "Dead end";
    const named = [a, b].filter((text) => !generic(text));
    const name = named.length === 2 ? `${a} to ${b}` : named.length === 1 ? named[0] : "Transmission line";
    return {
      power: true,
      layer: KEY,
      kind,
      name,
      lat: hit.lat,
      lon: hit.lon,
      voltage: volt,
      voltClass: cls.label,
      owner: owners[row[1]] || "",
      sub1: a,
      sub2: b,
      type: (meta.types || [])[row[4]] || "",
      status: (meta.statuses || [])[row[5]] || "",
      inferred: row[6] === 1,
    };
  }

  function classOf(hit) {
    const rows = classCache.get(hit.file);
    return rows ? rows[hit.i] : 7;
  }

  async function open(hit, showLive) {
    try {
      const item = await itemFor(hit);
      if (!shown()) return;
      showLive(item);
    } catch (error) {
      st.error = `Line details: ${error && error.message ? error.message : String(error)}`;
      render();
    }
  }

  function fact(label, value) {
    if (value == null || value === "") return "";
    return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const voltage = item.voltage ? `${fmt(item.voltage)} kV` : "Not listed";
    const facts = [
      fact("Voltage", voltage),
      fact("Class", item.voltClass),
      fact("Owner", item.owner || "Not listed"),
      fact("From", item.sub1 || "Not listed"),
      fact("To", item.sub2 || "Not listed"),
      fact("Type", item.type),
      fact("Status", item.status),
      item.inferred ? fact("Voltage note", "Voltage inferred by the data source") : "",
    ].join("");
    // On-screen text only: no links or buttons that leave globalstatus.app.
    return `<dl class="nearby-facts">${facts}</dl>Source: ${esc(meta.source || "HIFLD U.S. Electric Power Transmission Lines (archive, Sep 30, 2024)")}`;
  }

  function hidePopup() {
    if (!lastShown) return;
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  // ---------- switching ----------
  async function setActive(key, on) {
    if (key !== KEY) return;
    st.on = Boolean(on);
    hookCamera();
    if (!st.on) {
      hidePopup();
      applyShow();
      render();
      return;
    }
    if (!st.ready) {
      st.error = "";
      render();
      try {
        if (!st.loading) st.loading = loadOverview().finally(() => { st.loading = null; });
        await st.loading;
      } catch (error) {
        st.error = `USA POWER LINES: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
        render();
        return;
      }
    }
    applyShow();
    render();
    updateDetail();
  }

  function statusParts() {
    return shown() ? [st.count == null ? "USA POWER LINES" : `USA POWER LINES ${countText()}`] : [];
  }

  function init(options) {
    ctx = options;
    render();
  }

  root.GsaPowerLines = {
    KEYS: [KEY],
    init,
    setActive,
    pick,
    open,
    popupHtml,
    statusParts,
    state: st,
    labels: { [KEY]: "USA POWER LINES" },
  };
})(typeof window !== "undefined" ? window : globalThis);
