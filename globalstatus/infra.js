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
 *   EMERGENCY SERVICES  built by scripts/build_emergency_services.py
 *     USA POLICE DEPARTMENTS  USGS National Structures Dataset, law enforcement (police
 *                   stations), via Esri U.S. Federal Datasets (CC BY 4.0), minus sheriff's offices
 *     USA SHERIFF DEPARTMENTS the same USGS file, only the sheriff's offices
 *     USA FIRE DEPARTMENTS    USGS The National Map, Fire Stations / EMS Stations
 *                   (public domain)
 *                   County names from Census boundaries.
 *                   /infra/<police|sheriff|fire>/overview.json  one per 0.35-degree cell
 *                   /infra/<police|sheriff|fire>/<tile>.json    every station, 2-degree tiles,
 *                   fetched only when zoomed in over that tile
 *                   Cards are on-screen text only: no links off globalstatus.app.
 *     USA HOSPITALS & TRAUMA CENTERS  HIFLD Next Hospitals v1.1.0 (public domain, open
 *                   hospitals only) joined with CMS Care Compare (Oct 2026) for emergency
 *                   services, star rating and CMS type. Built by scripts/build_hospitals.py
 *                   /infra/hospitals/overview.json  every trauma center + one other hospital
 *                   per 0.35-degree cell; /infra/hospitals/<tile>.json every hospital,
 *                   2-degree tiles. Trauma centers are larger pins colored by level.
 *                   Phones are plain text; WEBSITE and SOURCE URLs are never shipped.
 *
 * Drawn with Cesium PointPrimitiveCollections (tens of thousands of points stay
 * cheap on phones). Nothing is fetched until a layer is switched on.
 */
(function (root) {
  const KEYS = ["airports", "bases", "celltowers", "powerplants", "police", "sheriff", "fire", "hospitals"];
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
  // EMERGENCY SERVICES: every station appears below this camera height; above it, the overview.
  const STATION_V = "20261125d";
  const STATION_NEAR_HEIGHT = 900 * 1000;
  const STATION_MAX_TILES = 40;
  const STATION_KEEP_TILES = 90;

  const META = {
    airports: {
      label: "GLOBAL AIRPORTS",
      credit: 'Airports: <a href="https://ourairports.com/" target="_blank" rel="noreferrer">OurAirports</a> (public domain)',
      caption: "Large and medium airports. Zoom in to see small airports and seaplane bases. Closed airports and heliports are left out.",
    },
    bases: {
      label: "GLOBAL MILITARY BASES",
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
    police: {
      label: "USA POLICE DEPARTMENTS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Police stations: USGS National Structures Dataset (The National Map), via Esri U.S. Federal Datasets (CC BY 4.0). Counties: U.S. Census Bureau",
      caption: "City and town police departments, state police and highway patrol, campus and tribal police stations in the US and territories. Sheriff's offices are in USA SHERIFF DEPARTMENTS. The type is read from the station name. Zoom in to see every station. The USGS file has no phone numbers.",
    },
    sheriff: {
      label: "USA SHERIFF DEPARTMENTS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Sheriff's offices: USGS National Structures Dataset (The National Map), via Esri U.S. Federal Datasets (CC BY 4.0). Counties: U.S. Census Bureau",
      caption: "County sheriff's offices and their substations in the US, from the USGS law enforcement structures file (stations whose name says sheriff). Office locations only. Zoom in to see every office. The USGS file has no phone numbers.",
    },
    fire: {
      label: "USA FIRE DEPARTMENTS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Fire and EMS stations: USGS The National Map, Structures (public domain). Counties: U.S. Census Bureau",
      caption: "Fire stations, volunteer fire companies and EMS stations in the US and territories. The type is read from the station name. Zoom in to see every station. The USGS file has no phone numbers.",
    },
    hospitals: {
      label: "USA HOSPITALS & TRAUMA CENTERS",
      // Plain text on purpose: nothing in this layer links off globalstatus.app.
      credit: "Hospitals: HIFLD Next Hospitals v1.1.0 (public domain), CMS Care Compare Oct 2026",
      caption: "Open hospitals in the US and territories. Trauma centers are larger pins colored by their highest adult level; a magenta ring marks a pediatric trauma designation. Other hospitals are small pink pins, faded where CMS lists no emergency department. Trauma levels are cleaned from the state-reported HIFLD text; Montana, Wyoming and South Dakota use their own designations. Every trauma center shows at any distance; zoom in to see every hospital.",
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
  // USA POLICE DEPARTMENTS: blue with a white ring, so it never reads as another layer.
  const POLICE_TYPES = ["Police department", "Sheriff's office", "State police or highway patrol", "Campus police", "Tribal police", "Marshal", "Constable", "Public safety department", "Law enforcement"];
  const POLICE_STYLE = { color: "#2f6bff", outline: "#ffffff", size: 7, far: true };
  // USA SHERIFF DEPARTMENTS: gold with a dark navy ring.
  const SHERIFF_TYPES = ["Sheriff's office", "Sheriff's substation or district office"];
  const SHERIFF_STYLE = { color: "#ffc233", outline: "#1b2350", size: 8, far: true };
  const SHERIFF_SUB_STYLE = { color: "#ffc233", outline: "#1b2350", size: 6, far: true };
  // USA FIRE DEPARTMENTS: red with a white ring; EMS-only stations white with a red ring.
  const FIRE_TYPES = ["Fire station", "Volunteer fire company", "Fire and EMS station", "EMS or ambulance station", "Wildland fire station", "Emergency services station"];
  const FIRE_STYLE = { color: "#e8261c", outline: "#ffffff", size: 7, far: true };
  const EMS_STYLE = { color: "#ffffff", outline: "#e8261c", size: 7, far: true };
  // USA HOSPITALS & TRAUMA CENTERS: trauma class (build script CLASSES order) sets color and size.
  const HOSP_CLASSES = ["Not a trauma center", "Level I", "Level II", "Level III", "Level IV", "Level V", "Pediatric", "State-specific"];
  const HOSP_COLORS = ["#ff9ec7", "#ff2d2d", "#ff8c1a", "#ffd400", "#2fd36b", "#2fd36b", "#d65cff", "#22b8cf"];
  const HOSP_SIZES = [6, 13, 12, 11, 10, 10, 11, 10];
  const HOSP_PED_RING = "#d65cff";
  const hospStyles = {};
  function hospStyle(row) {
    const cls = row[2] || 0;
    const noEr = cls === 0 && row[11] === 0;
    const ped = row[18] === 1 && cls !== 6;
    const key = `${cls}:${noEr ? 1 : 0}:${ped ? 1 : 0}`;
    if (hospStyles[key]) return hospStyles[key];
    let style;
    if (cls === 0) style = noEr
      ? { color: "rgba(255,158,199,0.45)", outline: "rgba(255,255,255,0.35)", outlineWidth: 1, size: 5, far: true }
      : { color: HOSP_COLORS[0], outline: "#ffffff", outlineWidth: 1, size: 6, far: true };
    else style = { color: HOSP_COLORS[cls], outline: ped || cls === 6 ? (cls === 6 ? "#ffffff" : HOSP_PED_RING) : OUTLINE, outlineWidth: ped ? 3 : 1.5, size: HOSP_SIZES[cls], far: true };
    return (hospStyles[key] = style);
  }
  const STATION = {
    police: { url: "/infra/police/", types: POLICE_TYPES, style: () => POLICE_STYLE, noun: "stations", fallback: "Police station", source: "USGS National Structures Dataset, via Esri U.S. Federal Datasets (CC BY 4.0)" },
    sheriff: { url: "/infra/sheriff/", types: SHERIFF_TYPES, style: (t) => (t === 1 ? SHERIFF_SUB_STYLE : SHERIFF_STYLE), noun: "offices", fallback: "Sheriff's office", source: "USGS National Structures Dataset, via Esri U.S. Federal Datasets (CC BY 4.0)" },
    fire: { url: "/infra/fire/", types: FIRE_TYPES, style: (t) => (t === 3 ? EMS_STYLE : FIRE_STYLE), noun: "stations", fallback: "Fire station", source: "USGS The National Map, Structures (public domain)" },
    hospitals: { url: "/infra/hospitals/", types: HOSP_CLASSES, style: (t, row) => hospStyle(row), noun: "hospitals", fallback: "Hospital", source: "HIFLD Next Hospitals v1.1.0 (public domain), CMS Care Compare Oct 2026" },
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
  const plant = { ov: null, near: null, index: null, indexLoading: null, tiles: new Map(), nearShown: false, nearCount: 0, total: 0, sources: [] };
  const stations = {};
  for (const key of Object.keys(STATION)) stations[key] = { ov: null, near: null, index: null, indexLoading: null, tiles: new Map(), nearShown: false, nearCount: 0, total: 0, newest: 0 };
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
      outlineColor: style.cssOutline || (style.cssOutline = Cesium.Color.fromCssColorString(style.outline || OUTLINE)),
      outlineWidth: style.outlineWidth != null ? style.outlineWidth : (style.outline ? 1.5 : 1),
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
    if (STATION[key] && stations[key].total) return fmt(stations[key].total);
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
        if (s.ready && STATION[key]) {
          const sl = stations[key];
          if (key === "police") bits.push(`<span class="pp-key" style="--pp:${POLICE_STYLE.color};box-shadow:0 0 0 1px ${POLICE_STYLE.outline}"></span>Police, state, campus, tribal`);
          else if (key === "sheriff") bits.push(`<span class="pp-key" style="--pp:${SHERIFF_STYLE.color};box-shadow:0 0 0 1px ${SHERIFF_STYLE.outline}"></span>Sheriff's office (smaller: substation)`);
          else if (key === "hospitals") bits.push(hospLegend(sl));
          else bits.push(`<span class="pp-key" style="--pp:${FIRE_STYLE.color}"></span>Fire <span class="pp-key" style="--pp:${EMS_STYLE.color};box-shadow:0 0 0 1px ${EMS_STYLE.outline}"></span>EMS only`);
          const noun = STATION[key].noun;
          bits.push(sl.nearShown
            ? `${fmt(sl.nearCount)} ${noun} loaded around this view, of ${fmt(sl.total)} in all`
            : `${fmt(s.count)} of ${fmt(sl.total)} ${noun} shown at this distance. Zoom in to see every one`);
          if (sl.newest) bits.push(`Newest record ${esc(ymd(sl.newest))}`);
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

  function hospLegend(sl) {
    const c = (sl.counts && sl.counts.byClass) || {};
    const n = (label) => (c[label] != null ? ` ${fmt(c[label])}` : "");
    const key = (i, label, extra) => `<span class="pp-key hosp-key" style="--pp:${HOSP_COLORS[i]}${extra || ""}"></span>${esc(label)}${n(HOSP_CLASSES[i])}`;
    const parts = [
      key(1, "Level I"), key(2, "Level II"), key(3, "Level III"),
      `<span class="pp-key hosp-key" style="--pp:${HOSP_COLORS[4]}"></span>Level IV${n("Level IV")} / V${n("Level V")}`,
      key(6, "Pediatric only"), key(7, "State-specific"),
      `<span class="pp-key hosp-key" style="--pp:transparent;box-shadow:0 0 0 2px ${HOSP_PED_RING} inset"></span>ring = pediatric designation${sl.counts ? ` (${fmt(sl.counts.pediatric)})` : ""}`,
      `<span class="pp-key" style="--pp:${HOSP_COLORS[0]};box-shadow:0 0 0 1px #fff"></span>Other hospital${n(HOSP_CLASSES[0])} (faded: no emergency department listed by CMS)`,
    ];
    let text = parts.join(" ");
    if (sl.counts) text += ` · ${fmt(sl.counts.trauma)} trauma centers of ${fmt(sl.counts.total)} open hospitals · CMS details for ${fmt(sl.counts.cmsMatched)}`;
    return text;
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

  // ---------- USA POLICE DEPARTMENTS ----------
  function ymd(n) {
    const t = String(n || "");
    if (t.length !== 8) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[Number(t.slice(4, 6)) - 1]} ${Number(t.slice(6, 8))}, ${t.slice(0, 4)}`;
  }

  function addStationRows(key, coll, body, tileKey) {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const styleFor = STATION[key].style;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      addPoint(coll, row[0], row[1], styleFor(row[2], row), { __infra: key, row, body, tile: tileKey });
    }
    return rows.length;
  }

  async function loadStations(key) {
    const sl = stations[key];
    const body = await getJsonRetry(`${STATION[key].url}overview.json?v=${STATION_V}`);
    sl.ov = newCollection();
    sl.near = newCollection();
    st[key].count = addStationRows(key, sl.ov, body, "overview");
    sl.total = Number(body.total) || 0;
    sl.newest = Number(body.newest) || 0;
    sl.counts = body.counts || null;
    st[key].built = body.built || "";
    st[key].ready = true;
  }

  async function ensureStationIndex(key) {
    const sl = stations[key];
    if (sl.index) return sl.index;
    if (!sl.indexLoading) {
      sl.indexLoading = getJsonRetry(`${STATION[key].url}index.json?v=${STATION_V}`).then((body) => {
        sl.index = body;
        return body;
      }).finally(() => { sl.indexLoading = null; });
    }
    return sl.indexLoading;
  }

  function loadStationTile(key, tile) {
    const sl = stations[key];
    if (sl.tiles.has(tile)) return sl.tiles.get(tile);
    const job = getJsonRetry(`${STATION[key].url}${tile}.json?v=${STATION_V}`).then((body) => {
      if (!sl.near || !sl.tiles.has(tile)) return 0;
      const n = addStationRows(key, sl.near, body, tile);
      sl.nearCount += n;
      cullSoon();
      return n;
    }).catch((error) => {
      sl.tiles.delete(tile);
      throw error;
    });
    sl.tiles.set(tile, job);
    return job;
  }

  async function updateStations(key) {
    const sl = stations[key];
    if (!st[key].on || !st[key].ready || !sl.near) return;
    const near = cameraHeight() < STATION_NEAR_HEIGHT;
    sl.nearShown = near;
    sl.near.show = near && !hidden(key);
    // Close in, the tiles hold every station: hide the overview once they are in, so
    // nothing is drawn twice.
    sl.ov.show = shown(key) && (!near || sl.nearCount === 0);
    cullSoon();
    if (near) {
      try {
        const index = await ensureStationIndex(key);
        if (!st[key].on) return;
        const deg = Number(index.tile_deg) || 2;
        const inView = tileKeysInView(deg).filter((t) => index.tiles && index.tiles[t]);
        if (sl.tiles.size + inView.filter((t) => !sl.tiles.has(t)).length > STATION_KEEP_TILES) {
          sl.near.removeAll();
          sl.tiles.clear();
          sl.nearCount = 0;
        }
        const want = inView.filter((t) => !sl.tiles.has(t)).slice(0, STATION_MAX_TILES);
        await Promise.all(want.map((t) => loadStationTile(key, t)));
        if (st[key].on && sl.nearShown) sl.ov.show = shown(key) && sl.nearCount === 0;
        if (want.length) cullSoon();
      } catch (error) {
        st[key].error = `${META[key].label}: ${error && error.message ? error.message : String(error)}`;
      }
    }
    render(key);
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
    return [air.major, air.small, mil.coll, cell.ov, cell.near, plant.ov, plant.near, ...Object.values(stations).flatMap((sl) => [sl.ov, sl.near])].filter((coll) => coll && coll.show);
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
    if (STATION[id.__infra]) {
      const body = id.body || {};
      const def = STATION[id.__infra];
      const typeLabel = def.types[row[2]] || def.types[def.types.length - 1];
      if (id.__infra === "hospitals") {
        const pick = (list, i) => (Array.isArray(list) && list[i]) || "";
        const raw = pick(body.trauma, row[10]).split("\t");
        const cls = row[2] || 0;
        return {
          infra: true, layer: "hospitals", kind: cls ? `TRAUMA CENTER · ${(raw[0] || HOSP_CLASSES[cls]).toUpperCase()}` : "HOSPITAL",
          name: row[3] || "Hospital", lat: row[0], lon: row[1], cls,
          address: row[4] || "", place: pick(body.places, row[5]), zip: row[6] || "", county: pick(body.counties, row[7]), updated: row[8] || 0,
          type: pick(body.types, row[9]), traumaClean: raw[0] || "", traumaRaw: raw[1] || "", er: row[11], beds: row[12], helipad: row[13],
          stars: row[14], owner: pick(body.owners, row[15]), phone: row[16] || "", cmsType: pick(body.cmsTypes, row[17]), pediatric: row[18] === 1,
        };
      }
      return {
        infra: true, layer: id.__infra, kind: typeLabel.toUpperCase(),
        name: row[3] || def.fallback, lat: row[0], lon: row[1], typeLabel,
        address: row[4] || "", place: (body.places && body.places[row[5]]) || "", zip: row[6] || "",
        county: (body.counties && body.counties[row[7]]) || "", updated: row[8] || 0,
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

  function hospitalPopupHtml(item) {
    // On-screen facts only: no links, the phone is plain text, and no website or source URL.
    const lines = [];
    lines.push(`Type: ${item.type || "Not listed"}${item.cmsType && item.cmsType.toLowerCase().replace(/s$/, "") !== String(item.type).toLowerCase() ? ` (CMS: ${item.cmsType})` : ""}`);
    if (item.cls) {
      lines.push(`Trauma level: ${item.traumaClean || HOSP_CLASSES[item.cls]}`);
      if (item.traumaRaw && item.traumaRaw.toLowerCase() !== String(item.traumaClean).toLowerCase()) lines.push(`As listed: ${item.traumaRaw}`);
    } else lines.push("Trauma level: Not a designated trauma center in this data");
    lines.push(`Emergency services: ${item.er === 1 ? "Yes" : item.er === 0 ? "No" : "Not listed (no CMS match)"}`);
    lines.push(`Beds: ${item.beds >= 0 ? fmt(item.beds) : "Not listed"}`);
    lines.push(`Helipad: ${item.helipad === 1 ? "Yes" : item.helipad === 0 ? "No" : "Not listed"}`);
    lines.push(`CMS overall star rating: ${item.stars > 0 ? `${item.stars} of 5` : item.stars === 0 ? "Not rated" : "Not listed (no CMS match)"}`);
    if (item.owner) lines.push(`Ownership: ${item.owner}`);
    if (item.address) lines.push(`Address: ${item.address}`);
    lines.push([item.place, item.zip].filter(Boolean).join(" "));
    if (item.county) lines.push(`County: ${item.county}`);
    lines.push(`Phone: ${item.phone || "Not listed"}`);
    if (item.updated) lines.push(`Source record dated: ${ymd(item.updated)}`);
    let html = lines.filter(Boolean).map((line) => `<br>${esc(line)}`).join("");
    html += '<br><i class="infra-caption">Trauma levels are state-reported and may be out of date. Call 911 in an emergency.</i>';
    html += `<br>Source: ${esc(STATION.hospitals.source)}`;
    return html;
  }

  function stationPopupHtml(item) {
    const lines = [];
    if (item.address) lines.push(item.address);
    lines.push([item.place, item.zip].filter(Boolean).join(" "));
    lines.push(`Type: ${item.typeLabel}`);
    if (item.county) lines.push(`County: ${item.county}`);
    lines.push("Phone: not listed in the USGS file");
    if (item.updated) lines.push(`Record updated: ${ymd(item.updated)}`);
    let html = lines.filter(Boolean).map((line) => `<br>${esc(line)}`).join("");
    html += '<br><i class="infra-caption">Type is read from the station name. Call 911 in an emergency.</i>';
    html += `<br>Source: ${esc(STATION[item.layer].source)}`;
    return html;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item; // the nearby list is not the open popup
    if (item.layer === "celltowers") return cellPopupHtml(item);
    if (item.layer === "powerplants") return plantPopupHtml(item);
    if (item.layer === "hospitals") return hospitalPopupHtml(item);
    if (STATION[item.layer]) return stationPopupHtml(item);
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
    if (STATION[key]) {
      const sl = stations[key];
      if (sl.ov) sl.ov.show = shown(key) && (!sl.nearShown || sl.nearCount === 0);
      if (sl.near) sl.near.show = shown(key) && sl.nearShown;
    }
    if (!s.on) hidePopupFor(key);
    if (s.on && !s.ready && !s.loading) {
      s.error = "";
      const loader = { airports: loadAirports, celltowers: loadCellTowers, powerplants: loadPowerPlants, police: () => loadStations("police"), sheriff: () => loadStations("sheriff"), fire: () => loadStations("fire"), hospitals: () => loadStations("hospitals") }[key] || loadBases;
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
          } else if (STATION[key]) {
            stations[key].ov.show = shown(key);
            updateStations(key);
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
    } else if (s.on && STATION[key]) {
      updateStations(key);
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
        for (const key of Object.keys(STATION)) if (st[key].on) updateStations(key);
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
