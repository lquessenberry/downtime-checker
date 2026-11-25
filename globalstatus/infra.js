/* Global Status · INFRASTRUCTURE layers (static files in /infra/, no cron).
 *
 *   AIRPORTS        OurAirports (public domain), built by scripts/build_infra_layers.py
 *                   /infra/airports-major.json      large + medium airports
 *                   /infra/airports-small/<tile>.json small airports + seaplane bases,
 *                   15-degree tiles, fetched only when zoomed in over that tile
 *   MILITARY BASES  OpenStreetMap contributors (ODbL), military=base | barracks |
 *                   airfield | naval_base, /infra/military-bases.json
 *
 *   USA CELL TOWERS FCC Antenna Structure Registration (public domain) plus FCC
 *                   cellular license sites (HIFLD Cellular Towers) for carrier names,
 *                   built by scripts/build_cell_towers.py
 *                   /infra/cell-towers/overview.json  thinned set for globe distance
 *                   /infra/cell-towers/<tile>.json    every site, 2-degree tiles,
 *                   fetched only when zoomed in over that tile
 *                   Cards are on-screen text only: no links off globalstatus.app.
 *   GLOBAL POWER PLANTS  WRI Global Power Plant Database v1.3 (CC BY 4.0) outside the
 *                   US; EIA-860M operating generators (grouped by plant) for the US and
 *                   Puerto Rico. Built by scripts/build_power_plants.py
 *                   /infra/power-plants/overview.json  plants of 50 MW and up
 *                   /infra/power-plants/<tile>.json    smaller plants, 10-degree tiles,
 *                   fetched only when zoomed in over that tile
 *                   Cards are on-screen text only: no links off globalstatus.app.
 *
 * Drawn with Cesium PointPrimitiveCollections (tens of thousands of points stay
 * cheap on phones). Nothing is fetched until a layer is switched on.
 */
(function (root) {
  const KEYS = ["airports", "bases", "celltowers", "powerplants"];
  const V = "20261123t";
  const BASE_URL = "/infra/";
  // Small airports appear below this camera height (metres above the ellipsoid).
  const SMALL_MAX_HEIGHT = 1200 * 1000;
  const MAX_TILES = 16;
  const CELL_V = "20261124m";
  const CELL_URL = "/infra/cell-towers/";
  // Every cell site appears below this camera height; above it, the thinned overview.
  const CELL_NEAR_HEIGHT = 450 * 1000;
  const CELL_MAX_TILES = 40;
  // Loaded tiles are dropped and refetched after this many, so panning the whole
  // country does not keep 140,000 points in the per-frame horizon cull.
  const CELL_KEEP_TILES = 90;
  const PLANT_V = "20261124q";
  const PLANT_URL = "/infra/power-plants/";
  // Plants under 50 MW appear below this camera height.
  const PLANT_NEAR_HEIGHT = 2500 * 1000;
  const PLANT_MAX_TILES = 24;

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
    celltowers: {
      label: "USA CELL TOWERS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Cell towers: FCC Antenna Structure Registration and FCC cellular license sites (public records)",
      caption: "Constructed towers, monopoles, poles and masts registered with the FCC, US and territories. Most carry cellular antennas; some are broadcast, utility, railroad or public-safety radio towers. Zoom in to see every site. Carriers are named only where an FCC cellular license lists the site; the FCC tower file does not list tenants, so most towers show the owner only.",
    },
    powerplants: {
      label: "GLOBAL POWER PLANTS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Power plants: World Resources Institute, Global Power Plant Database v1.3 (CC BY 4.0); U.S. Energy Information Administration (EIA-860M, October 2026)",
      caption: "Outside the US: WRI database (last updated 2021). US and Puerto Rico: EIA operating generator inventory, grouped by plant. Colored by main fuel, sized by capacity. Plants of 50 MW and up show at every zoom; zoom in for smaller plants.",
    },
  };

  // FCC ASR structure type codes (build script TYPES order).
  const CELL_TYPES = ["TOWER", "LTOWER", "MTOWER", "GTOWER", "POLE", "UPOLE", "MAST", "BTWR", "BMAST", "BPOLE", "TREE", "2TOWER", "SITE", "TANK", "B", "BANT", "SILO", "OTHER"];
  const CELL_TYPE_LABEL = {
    TOWER: "Tower", LTOWER: "Lattice tower", MTOWER: "Monopole", GTOWER: "Guyed tower",
    POLE: "Pole", UPOLE: "Utility pole or tower", MAST: "Mast", BTWR: "Tower on a building",
    BMAST: "Mast on a building", BPOLE: "Pole on a building", TREE: "Tree-style (stealth) tower",
    "2TOWER": "Two towers", SITE: "Cell site (structure type not listed)", TANK: "Water tank",
    B: "Building", BANT: "Antenna on a building", SILO: "Silo", OTHER: "Other structure",
  };
  const CELL_STYLE = { color: "#3fd0c9", size: 5, far: true };
  // GLOBAL POWER PLANTS: fuel colors (build script FUELS order), size by capacity.
  const PLANT_FUELS = ["coal", "gas", "oil", "nuclear", "hydro", "solar", "wind", "other"];
  const PLANT_FUEL_LABEL = { coal: "Coal", gas: "Gas", oil: "Oil", nuclear: "Nuclear", hydro: "Hydro", solar: "Solar", wind: "Wind", other: "Other" };
  const PLANT_COLORS = { coal: "#6b5544", gas: "#ff8c2a", oil: "#d6403a", nuclear: "#c86bff", hydro: "#2f8fff", solar: "#ffd83a", wind: "#5fe0d0", other: "#9aa79a" };
  const PLANT_SIZES = [[1000, 11], [300, 9], [50, 7], [10, 5], [0, 4]];
  const plantStyles = {};
  function plantStyle(fuel, mw) {
    const name = PLANT_FUELS[fuel] || "other";
    const size = PLANT_SIZES.find(([min]) => mw >= min)[1];
    const key = `${name}:${size}`;
    return plantStyles[key] || (plantStyles[key] = { color: PLANT_COLORS[name], size, far: true });
  }
  const CELL_CARRIER_STYLE = { color: "#ffcf5a", size: 6, far: true };

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
  const plant = { ov: null, near: null, index: null, indexLoading: null, tiles: new Map(), nearShown: false, nearCount: 0, total: 0, sources: [] };
  const cell = { ov: null, near: null, index: null, indexLoading: null, tiles: new Map(), nearShown: false, nearCount: 0, total: 0, source: "", types: CELL_TYPES };
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
      // USA CELL TOWERS: smaller dots from far away so the country is not one solid blob.
      scaleByDistance: style.far ? (style.scale || (style.scale = new Cesium.NearFarScalar(1.5e6, 1.0, 1.2e7, 0.4))) : undefined,
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
    if (key === "celltowers" && cell.total) return fmt(cell.total);
    if (key === "powerplants" && plant.nearShown && plant.nearCount) return `${fmt(s.count)} + ${fmt(plant.nearCount)}`;
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
        if (s.ready && key === "celltowers") {
          bits.push(cell.nearShown
            ? `${fmt(cell.nearCount)} sites loaded around this view, of ${fmt(cell.total)} in all`
            : `${fmt(s.count)} of ${fmt(cell.total)} sites shown at this distance. Zoom in to see every site`);
        }
        if (s.ready && key === "powerplants") {
          bits.push(PLANT_FUELS.map((f) => `<span class="pp-key" style="--pp:${PLANT_COLORS[f]}"></span>${esc(PLANT_FUEL_LABEL[f])}`).join(" "));
          bits.push(plant.nearShown
            ? `${fmt(s.count)} plants of 50 MW and up + ${fmt(plant.nearCount)} smaller plants loaded nearby, of ${fmt(plant.total)} in all`
            : `${fmt(s.count)} plants of 50 MW and up, of ${fmt(plant.total)} in all. Zoom in for smaller plants`);
        }
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

  function tileKeysInView(tileDeg) {
    const v = viewer();
    const Cesium = C();
    const deg = tileDeg || air.tileDeg;
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

  // ---------- USA CELL TOWERS ----------
  function addCellRows(coll, body, tileKey) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const carrier = body.carriers && body.carriers[row[7]];
      addPoint(coll, row[0], row[1], carrier ? CELL_CARRIER_STYLE : CELL_STYLE, { __infra: "celltowers", row, body, tile: tileKey });
    }
    return rows.length;
  }

  async function loadCellTowers() {
    const body = await getJsonRetry(`${CELL_URL}overview.json?v=${CELL_V}`);
    cell.ov = newCollection();
    cell.near = newCollection();
    st.celltowers.count = addCellRows(cell.ov, body, "overview");
    cell.total = Number(body.total) || 0;
    cell.source = body.source || "";
    st.celltowers.built = body.built || "";
    st.celltowers.ready = true;
  }

  async function ensureCellIndex() {
    if (cell.index) return cell.index;
    if (!cell.indexLoading) {
      cell.indexLoading = getJsonRetry(`${CELL_URL}index.json?v=${CELL_V}`).then((body) => {
        cell.index = body;
        return body;
      }).finally(() => { cell.indexLoading = null; });
    }
    return cell.indexLoading;
  }

  function loadCellTile(key) {
    if (cell.tiles.has(key)) return cell.tiles.get(key);
    const job = getJsonRetry(`${CELL_URL}${key}.json?v=${CELL_V}`).then((body) => {
      if (!cell.near || !cell.tiles.has(key)) return 0;
      const n = addCellRows(cell.near, body, key);
      cell.nearCount += n;
      cullSoon();
      return n;
    }).catch((error) => {
      cell.tiles.delete(key);
      throw error;
    });
    cell.tiles.set(key, job);
    return job;
  }

  async function updateCellTowers() {
    if (!st.celltowers.on || !st.celltowers.ready || !cell.near) return;
    const near = cameraHeight() < CELL_NEAR_HEIGHT;
    cell.nearShown = near;
    cell.near.show = near && !hidden("celltowers");
    cullSoon();
    if (near) {
      try {
        const index = await ensureCellIndex();
        if (!st.celltowers.on) return;
        const deg = Number(index.tile_deg) || 2;
        const inView = tileKeysInView(deg).filter((key) => index.tiles && index.tiles[key]);
        if (cell.tiles.size + inView.filter((key) => !cell.tiles.has(key)).length > CELL_KEEP_TILES) {
          cell.near.removeAll();
          cell.tiles.clear();
          cell.nearCount = 0;
        }
        const want = inView.filter((key) => !cell.tiles.has(key)).slice(0, CELL_MAX_TILES);
        await Promise.all(want.map((key) => loadCellTile(key)));
        if (want.length) cullSoon();
      } catch (error) {
        st.celltowers.error = `Cell towers: ${error && error.message ? error.message : String(error)}`;
      }
    }
    render("celltowers");
  }

  // ---------- GLOBAL POWER PLANTS ----------
  function addPlantRows(coll, body) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      addPoint(coll, row[0], row[1], plantStyle(row[2], Number(row[3]) || 0), { __infra: "powerplants", row, body });
    }
    return rows.length;
  }

  async function loadPowerPlants() {
    const body = await getJsonRetry(`${PLANT_URL}overview.json?v=${PLANT_V}`);
    plant.near = newCollection();
    plant.ov = newCollection();
    st.powerplants.count = addPlantRows(plant.ov, body);
    plant.total = Number(body.total) || 0;
    plant.sources = body.sources || [];
    st.powerplants.ready = true;
  }

  async function ensurePlantIndex() {
    if (plant.index) return plant.index;
    if (!plant.indexLoading) {
      plant.indexLoading = getJsonRetry(`${PLANT_URL}index.json?v=${PLANT_V}`).then((body) => {
        plant.index = body;
        return body;
      }).finally(() => { plant.indexLoading = null; });
    }
    return plant.indexLoading;
  }

  function loadPlantTile(key) {
    if (plant.tiles.has(key)) return plant.tiles.get(key);
    const job = getJsonRetry(`${PLANT_URL}${key}.json?v=${PLANT_V}`).then((body) => {
      if (!plant.near || !plant.tiles.has(key)) return 0;
      const n = addPlantRows(plant.near, body);
      plant.nearCount += n;
      cullSoon();
      return n;
    }).catch((error) => {
      plant.tiles.delete(key);
      throw error;
    });
    plant.tiles.set(key, job);
    return job;
  }

  async function updatePowerPlants() {
    if (!st.powerplants.on || !st.powerplants.ready || !plant.near) return;
    const near = cameraHeight() < PLANT_NEAR_HEIGHT;
    plant.nearShown = near;
    plant.near.show = near && !hidden("powerplants");
    cullSoon();
    if (near) {
      try {
        const index = await ensurePlantIndex();
        if (!st.powerplants.on) return;
        const deg = Number(index.tile_deg) || 10;
        const want = tileKeysInView(deg).filter((key) => index.tiles && index.tiles[key] && !plant.tiles.has(key)).slice(0, PLANT_MAX_TILES);
        await Promise.all(want.map((key) => loadPlantTile(key)));
        if (want.length) cullSoon();
      } catch (error) {
        st.powerplants.error = `Smaller plants: ${error && error.message ? error.message : String(error)}`;
      }
    }
    render("powerplants");
  }

  // ---------- horizon culling ----------
  // Points ignore depth so terrain never hides them; hide the far side instead.
  let cullAt = 0;
  let cullDirty = true;
  const lastCam = { x: NaN, y: NaN, z: NaN, dx: NaN };

  function cullSoon() { cullDirty = true; }

  function collections() {
    return [air.major, air.small, mil.coll, cell.ov, cell.near, plant.ov, plant.near].filter((coll) => coll && coll.show);
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
    if (id.__infra === "celltowers") {
      const body = id.body || {};
      const type = CELL_TYPES[row[2]] || "OTHER";
      const owner = (body.owners && body.owners[row[4]]) || "";
      const carriers = (body.carriers && body.carriers[row[7]]) || "";
      return {
        infra: true, layer: "celltowers", kind: "CELL TOWER",
        name: owner || (carriers ? carriers.split(" (")[0] : "") || "FCC cellular license site",
        lat: row[0], lon: row[1], type, typeLabel: CELL_TYPE_LABEL[type] || type, heightM: row[3],
        owner, carriers, asr: row[5] || "", place: (body.places && body.places[row[6]]) || "",
      };
    }
    if (id.__infra === "powerplants") {
      const body = id.body || {};
      const fuel = PLANT_FUELS[row[2]] || "other";
      const eia = row[8] === 1;
      return {
        infra: true, layer: "powerplants", kind: `${PLANT_FUEL_LABEL[fuel].toUpperCase()} POWER PLANT`,
        name: row[4] || "Unnamed power plant", lat: row[0], lon: row[1], fuel, mw: row[3],
        detail: (body.details && body.details[row[9]]) || "", owner: (body.owners && body.owners[row[5]]) || "",
        place: (body.places && body.places[row[6]]) || "", year: row[7] || 0, eia,
      };
    }
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

  function cellPopupHtml(item) {
    // On-screen facts only. No links: the card never takes anyone off globalstatus.app.
    const lines = [];
    if (item.owner) lines.push(`Owner: ${item.owner}`);
    if (item.carriers) lines.push(`Carrier on FCC cellular license: ${item.carriers}`);
    lines.push(`Structure: ${item.typeLabel}`);
    if (item.heightM != null && item.heightM !== "") lines.push(`Height: ${fmt(Math.round(item.heightM * 3.28084))} ft (${fmt(item.heightM)} m) above ground`);
    if (item.place) lines.push(item.place);
    lines.push(`Coordinates: ${Number(item.lat).toFixed(4)}, ${Number(item.lon).toFixed(4)}`);
    lines.push(item.asr ? `FCC antenna structure registration #${item.asr}` : "FCC cellular license site (no tower registration on file)");
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    html += `<br><i class="infra-caption">${esc(item.carriers ? "Other carriers may also use this site." : "The FCC tower file does not list which carriers use a tower.")} FCC records show no GSM / LTE / 5G detail.</i>`;
    return html;
  }

  function plantPopupHtml(item) {
    // On-screen facts only. No links: the card never takes anyone off globalstatus.app.
    const lines = [];
    const fuel = PLANT_FUEL_LABEL[item.fuel] || "Other";
    lines.push(`Fuel: ${item.detail && item.detail.toLowerCase() !== fuel.toLowerCase() ? `${fuel} (${item.detail})` : fuel}`);
    if (item.mw != null && item.mw !== "") lines.push(`Capacity: ${fmt(item.mw)} MW`);
    if (item.owner) lines.push(`${item.eia ? "Operator" : "Owner"}: ${item.owner}`);
    if (item.place) lines.push(item.place);
    if (item.year) lines.push(`${item.eia ? "First unit online" : "Commissioned"}: ${Math.round(item.year)}`);
    lines.push(`Coordinates: ${Number(item.lat).toFixed(4)}, ${Number(item.lon).toFixed(4)}`);
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    html += `<br><i class="infra-caption">Source: ${esc(item.eia ? "U.S. Energy Information Administration (EIA-860M, October 2026)" : "World Resources Institute, Global Power Plant Database (CC BY 4.0)")}</i>`;
    return html;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item; // the nearby list is not the open popup
    if (item.layer === "celltowers") return cellPopupHtml(item);
    if (item.layer === "powerplants") return plantPopupHtml(item);
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
    if (key === "celltowers") {
      if (cell.ov) cell.ov.show = shown(key);
      if (cell.near) cell.near.show = shown(key) && cell.nearShown;
    }
    if (key === "powerplants") {
      if (plant.ov) plant.ov.show = shown(key);
      if (plant.near) plant.near.show = shown(key) && plant.nearShown;
    }
    if (!s.on) hidePopupFor(key);
    if (s.on && !s.ready && !s.loading) {
      s.error = "";
      const loader = { airports: loadAirports, celltowers: loadCellTowers, powerplants: loadPowerPlants }[key] || loadBases;
      s.loading = loader()
        .then(() => {
          if (key === "airports") {
            air.major.show = shown("airports");
            updateSmall();
          } else if (key === "celltowers") {
            cell.ov.show = shown("celltowers");
            updateCellTowers();
          } else if (key === "powerplants") {
            plant.ov.show = shown("powerplants");
            updatePowerPlants();
          } else mil.coll.show = shown("bases");
          cullSoon();
          if (ctx && ctx.statusLive) ctx.statusLive();
        })
        .catch((error) => fail(key, error))
        .finally(() => { s.loading = null; render(key); });
    } else if (s.on && key === "airports") {
      updateSmall();
    } else if (s.on && key === "celltowers") {
      updateCellTowers();
    } else if (s.on && key === "powerplants") {
      updatePowerPlants();
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
        if (st.celltowers.on) updateCellTowers();
        if (st.powerplants.on) updatePowerPlants();
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
