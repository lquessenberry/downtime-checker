const state = {
  results: [],
  running: false,
  total: 0,
  done: 0,
  up: 0,
  down: 0,
  startedAt: 0,
  heading: "AWAITING TASKING",
  filter: "all",
  selected: null,
  viewer: null,
  points: new Map(),
  arcs: new Map(),
  origin: null,
  outageSource: null,
  hungerSource: null,
  streamSource: null,
  conflictSource: null,
  highlightSource: null,
  countryIndex: null,
  scanSource: null,
  outagePoints: [],
  outageMeta: null,
  hungerPoints: [],
  hungerMeta: null,
  streamPoints: [],
  streamOpenId: "",
  conflicts: [],
  conflictsReady: false,
  live: {
    jamming: { source: null, points: [] },
    aircraft: { source: null, points: [] },
    ships: { source: null, points: [] },
    mesh: { source: null, points: [] },
    disease: { source: null, points: [] },
    animal: { source: null, points: [] },
    amfm: { source: null, points: [] },
    designations: { source: null, points: [] },
    violence: { source: null, points: [] },
    nuke: { source: null, points: [] },
    quakes: { source: null, points: [] },
    streets3d: { source: null, points: [] },
  },
  layers: {
    outages: false,
    hunger: false,
    stream: false,
    jamming: false,
    aircraft: false,
    ships: false,
    conflicts: false,
    mesh: false,
    disease: false,
    animal: false,
    amfm: false,
    designations: false,
    violence: false,
    nuke: false,
    quakes: false,
    streets3d: false,
  },
  nuke: { shots: [], yieldIdx: 0, airburst: true },
  openKind: "",
  openId: "",
  feedMode: "outages",
  airFilter: "all",
  aircraftFeed: [],
  militaryPoints: null,
  shipFilter: "underway",
  amfmReady: false,
  trafficPane: "air",
  scanWanted: false,
  scanLive: false,
  replayGen: 0,
};

const COLORS = {
  up: Cesium.Color.fromCssColorString("#3dff9a"),
  down: Cesium.Color.fromCssColorString("#ff4d4d"),
  pending: Cesium.Color.fromCssColorString("#ffb020"),
};

// Same hub the canvas globe draws its search lines from.
const ORIGIN = { lat: 35.84, lon: -90.7 };
const IMAGERY_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const STREET_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer";
const TERRAIN_URL = "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";
const ESRI_CREDIT = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
// One imagery layer at a time. Street map is the startup map on desktop and mobile.
// Natural Earth II stays the offline fallback when that street service fails.
const BASEMAPS = {
  natural: { kind: "natural" },
  plain: { kind: "none" },
  osm: {
    kind: "xyz",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap",
    maximumLevel: 19,
  },
  streets: {
    kind: "xyz",
    url: `${STREET_URL}/tile/{z}/{y}/{x}`,
    credit: "Esri",
    maximumLevel: 19,
  },
  satellite: {
    kind: "xyz",
    url: `${IMAGERY_URL}/tile/{z}/{y}/{x}`,
    credit: ESRI_CREDIT,
    maximumLevel: 19,
  },
  sentinel: {
    kind: "xyz",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg",
    credit: "Sentinel-2 cloudless by EOX",
    maximumLevel: 14,
  },
  marble: {
    kind: "xyz",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    credit: "NASA Blue Marble",
    maximumLevel: 8,
  },
  night: {
    kind: "xyz",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
    credit: "NASA Earth at Night",
    maximumLevel: 8,
  },
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

async function boot() {
  const [catalog] = await Promise.all([
    fetch("/api/catalog").then((response) => response.json()),
    startGlobe(),
  ]);
  renderSearches(catalog);
  fillCountries(catalog.countries);
  hookUi();
  tickClock();
  Promise.allSettled([
    loadOutages(),
    loadHunger(),
    loadStreams(),
    loadConflicts(),
    pollLiveFeeds(),
  ]).then((results) => {
    const failed = results.find((result) => result.status === "rejected");
    if (failed) statusLive(failed.reason?.message || String(failed.reason));
    else statusLive();
  });
  setInterval(() => {
    if (state.layers.aircraft || state.layers.jamming) pollLiveFeeds();
  }, 180000);
  setInterval(() => {
    loadOutages().catch((error) => statusLive(error.message || String(error)));
  }, 180000);
}

function phoneLayout() {
  return window.matchMedia("(max-width: 800px)").matches;
}

function tuneQuality(basemapId) {
  const viewer = state.viewer;
  if (!viewer) return;
  const sharp = basemapId === "satellite" || basemapId === "sentinel" || basemapId === "streets" || basemapId === "osm";
  viewer.scene.globe.maximumScreenSpaceError = sharp ? 2 : 4;
  const dpr = window.devicePixelRatio || 1;
  const cap = sharp ? (phoneLayout() ? 1.25 : 2) : (phoneLayout() ? 1 : 1.5);
  // Pixel ratio is devicePixelRatio times resolutionScale only when this is false.
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = Math.min(dpr, cap) / dpr;
  if (phoneLayout()) viewer.scene.globe.tileCacheSize = 50;
}

async function imageryProvider(id) {
  const spec = BASEMAPS[id] || BASEMAPS.natural;
  if (spec.kind === "natural") {
    return Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    );
  }
  if (spec.kind !== "xyz") return null;
  return new Cesium.UrlTemplateImageryProvider({
    url: spec.url,
    credit: spec.credit,
    maximumLevel: spec.maximumLevel,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });
}

let basemapToken = 0;
let terrainToken = 0;

async function applyBasemap(id) {
  const viewer = state.viewer;
  if (!viewer || !BASEMAPS[id]) return;
  const token = ++basemapToken;
  const layers = viewer.imageryLayers;
  try {
    const provider = BASEMAPS[id].kind === "none" ? null : await imageryProvider(id);
    if (token !== basemapToken || state.viewer !== viewer) return;
    layers.removeAll();
    if (!provider) {
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#143044");
      viewer.scene.globe.showGroundAtmosphere = false;
    } else {
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#10202c");
      viewer.scene.globe.showGroundAtmosphere = true;
      layers.addImageryProvider(provider);
    }
  } catch (error) {
    if (token !== basemapToken) return;
    console.warn(error);
    layers.removeAll();
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#143044");
    viewer.scene.globe.showGroundAtmosphere = false;
    if (id !== "natural") {
      setStatus("MAP UNAVAILABLE · USING NATURAL EARTH");
      applyBasemap("natural");
      return;
    }
    setStatus("MAP UNAVAILABLE · PLAIN GLOBE");
    id = "plain";
  }
  state.basemap = id;
  tuneQuality(id);
  const select = document.getElementById("basemap");
  if (select && select.value !== id) select.value = id;
}

async function applyTerrain(id) {
  const viewer = state.viewer;
  if (!viewer) return;
  const token = ++terrainToken;
  if (id === "elevation") {
    try {
      const provider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(TERRAIN_URL);
      if (token !== terrainToken || state.viewer !== viewer) return;
      viewer.terrainProvider = provider;
      viewer.scene.globe.depthTestAgainstTerrain = true;
    } catch (error) {
      if (token !== terrainToken) return;
      console.warn(error);
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      viewer.scene.globe.depthTestAgainstTerrain = false;
      const select = document.getElementById("terrain");
      if (select) select.value = "ellipsoid";
      setStatus("ELEVATION UNAVAILABLE · USING THE SIMPLE GLOBE");
      return;
    }
  } else if (token === terrainToken) {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    viewer.scene.globe.depthTestAgainstTerrain = false;
  }
  const select = document.getElementById("terrain");
  if (select && select.value !== id) select.value = id;
}

function setSceneMode(mode) {
  const scene = state.viewer && state.viewer.scene;
  if (!scene) return;
  const target = mode === "2d" ? Cesium.SceneMode.SCENE2D : Cesium.SceneMode.SCENE3D;
  if (scene.mode !== target && scene.mode !== Cesium.SceneMode.MORPHING) {
    if (mode === "2d") scene.morphTo2D(0.5);
    else scene.morphTo3D(0.5);
  }
  document.getElementById("mode-3d").classList.toggle("on", mode !== "2d");
  document.getElementById("mode-3d").setAttribute("aria-pressed", mode !== "2d" ? "true" : "false");
  document.getElementById("mode-2d").classList.toggle("on", mode === "2d");
  document.getElementById("mode-2d").setAttribute("aria-pressed", mode === "2d" ? "true" : "false");
}

function setViewOpen(open) {
  const panel = document.getElementById("view-settings");
  const reopen = document.getElementById("open-view");
  if (panel) panel.classList.toggle("is-closed", !open);
  if (reopen) reopen.hidden = open;
}

function setPanel(which) {
  const rail = document.querySelector(".rail");
  const feed = document.querySelector(".feed-col");
  const backdrop = document.getElementById("panel-backdrop");
  const openMenu = which === "menu";
  const openList = which === "list";
  rail.classList.toggle("is-open", openMenu);
  feed.classList.toggle("is-open", openList);
  backdrop.hidden = !(openMenu || openList);
}

async function startGlobe() {
  let startupMap = "osm";
  let imagery;
  try {
    imagery = await imageryProvider(startupMap);
  } catch (error) {
    startupMap = "natural";
    imagery = await imageryProvider(startupMap);
  }
  const viewer = new Cesium.Viewer("cesium", {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: true,
    baseLayer: new Cesium.ImageryLayer(imagery),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    skyBox: false,
    orderIndependentTranslucency: false,
    useBrowserRecommendedResolution: false,
    contextOptions: {
      webgl: { antialias: !phoneLayout() },
    },
  });
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 1;
  controller.maximumZoomDistance = 40000000;
  viewer.scene.globe.maximumScreenSpaceError = 4;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#070b10");
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#10202c");
  viewer.scene.globe.enableLighting = false;
  state.viewer = viewer;
  state.basemap = startupMap;
  tuneQuality(startupMap);
  const basemapSelect = document.getElementById("basemap");
  if (basemapSelect) basemapSelect.value = startupMap;
  state.outageSource = new Cesium.CustomDataSource("outages");
  state.hungerSource = new Cesium.CustomDataSource("hunger");
  state.streamSource = new Cesium.CustomDataSource("hpdb-streams");
  state.conflictSource = new Cesium.CustomDataSource("conflicts");
  state.scanSource = new Cesium.CustomDataSource("scan");
  state.scanSource.show = true;
  viewer.dataSources.add(state.outageSource);
  viewer.dataSources.add(state.hungerSource);
  viewer.dataSources.add(state.streamSource);
  viewer.dataSources.add(state.conflictSource);
  viewer.dataSources.add(state.scanSource);
  for (const key of ["jamming", "aircraft", "ships", "mesh", "disease", "animal", "amfm", "designations", "violence", "nuke", "quakes", "streets3d"]) {
    state.live[key].source = new Cesium.CustomDataSource(key);
    viewer.dataSources.add(state.live[key].source);
  }
  viewer.scene.preRender.addEventListener(cullAircraftHorizon);
  viewer.scene.preRender.addEventListener(keepFlatMapIntact);
  viewer.camera.moveEnd.addEventListener(() => {
    if (state.layers.ships) scheduleShips();
  });
  setInterval(() => {
    if (state.layers.ships) loadShips();
  }, 45000);
  setInterval(() => {
    if (state.layers.mesh) loadMesh();
  }, 60000);
  setInterval(() => {
    if (state.layers.disease) loadDisease();
  }, 180000);
  setInterval(() => {
    if (state.layers.animal) loadAnimal();
  }, 600000);
  setInterval(() => {
    if (state.layers.quakes && !document.hidden) loadQuakes();
  }, (window.GsaQuakes && window.GsaQuakes.POLL_MS) || 300000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.layers.quakes) scheduleQuakes();
  });
  for (const key of Object.keys(state.layers)) setLayer(key, state.layers[key]);
  viewer.camera.setView({
    destination: Cesium.Rectangle.fromDegrees(-168, -48, 150, 72),
  });
  ensureOrigin();
  // A second handler, so Cesium can still select a pin. Empty ground is not a pin.
  // Cesium then inserts a temporary imagery entity; that is not a layer pin either.
  const popupClicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  popupClicks.setInputAction((click) => {
    if (state.layers.nuke && placeNukeAt(click.position)) return;
    if (pickedMapPin(click.position)) return;
    closeMapPopups();
    if (viewer.selectedEntity) viewer.selectedEntity = undefined;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  bindNukeHud();
  viewer.camera.moveEnd.addEventListener(() => {
    if (state.layers.streets3d) scheduleStreets3d();
  });
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity || !isMapPin(entity)) {
      closeMapPopups();
      if (entity && viewer.selectedEntity === entity) viewer.selectedEntity = undefined;
      return;
    }
    if (entity._outage) {
      openOutage(entity._outage, { fly: false });
      return;
    }
    if (entity._hunger) {
      openHunger(entity._hunger, { fly: false });
      return;
    }
    if (entity._pin) {
      openPin(entity._pin);
      return;
    }
    if (entity._stream) {
      openStream(entity._stream, { fly: false });
      return;
    }
    if (entity._live) {
      showLive(entity._live);
      return;
    }
    if (entity._resultIndex == null) return;
    const result = state.results[entity._resultIndex];
    if (result) showSelected(result);
  });
}

function renderSearches(catalog) {
  const global = catalog.searches.filter((item) => item.group === "global");
  const unitedStates = catalog.searches.filter((item) => item.group === "us");
  const grid = document.createElement("div");
  grid.className = "grid-status";
  const caption = document.createElement("span");
  caption.textContent = "WORLD GRID STATUS";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "grid-status-toggle";
  toggle.id = "grid-status";
  toggle.textContent = "Choose a test";
  toggle.dataset.scanId = "";
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  const scan = document.createElement("button");
  scan.type = "button";
  scan.id = "btn-grid-scan";
  scan.className = "grid-scan";
  scan.textContent = "LOCK & SCAN";
  const menu = document.createElement("div");
  menu.className = "grid-menu";
  menu.hidden = true;

  function closeMenus() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  function addChoice(parent, item, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = item.id;
    button.textContent = label || item.label;
    button.addEventListener("click", () => {
      closeMenus();
      toggle.textContent = button.textContent;
      toggle.dataset.scanId = item.id;
    });
    parent.append(button);
    return button;
  }

  for (const item of global) {
    if (item.id === "united-states") continue;
    addChoice(menu, item);
  }

  toggle.addEventListener("click", () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
  scan.addEventListener("click", () => {
    const id = toggle.dataset.scanId;
    if (!id) {
      setStatus("CHOOSE A TEST");
      return;
    }
    closeMenus();
    if (phoneLayout()) setPanel("");
    startScan(id);
  });
  document.addEventListener("click", (event) => {
    if (grid.contains(event.target)) return;
    closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
  grid.append(caption, toggle, scan, menu);
  fillUsTests(unitedStates);
  document.querySelector(".country-pick").before(grid);
}

function fillUsTests(tests) {
  const select = document.getElementById("us-test");
  if (!select) return;
  const all = tests.find((item) => item.id === "us-everything");
  const rest = tests.filter((item) => item.id !== "us-everything");
  const options = [`<option value="">Choose a test</option>`];
  if (all) options.push(`<option value="${esc(all.id)}">All of the United States</option>`);
  for (const item of rest) options.push(`<option value="${esc(item.id)}">${esc(item.label)}</option>`);
  select.innerHTML = options.join("");
}

function syncUsTests() {
  const country = document.getElementById("country");
  const tests = document.getElementById("us-test");
  if (!country || !tests) return;
  const show = country.value === "United States";
  tests.hidden = !show;
  if (!show) tests.value = "";
}

function fillCountries(list) {
  const select = document.getElementById("country");
  const options = [`<option value="">Choose a Country</option>`];
  for (const name of list) options.push(`<option value="${esc(name)}">${esc(name)}</option>`);
  select.innerHTML = options.join("");
  syncUsTests();
}

function hookUi() {
  document.getElementById("btn-stop").addEventListener("click", () => {
    state.replayGen += 1;
    state.running = false;
    document.getElementById("btn-stop").hidden = true;
    setStatus("SCAN ABORTED");
    updateHud();
  });
  document.getElementById("btn-reset").addEventListener("click", resetMap);
  document.getElementById("reset-mobile").addEventListener("click", resetMap);
  document.getElementById("close-view").addEventListener("click", () => setViewOpen(false));
  document.getElementById("open-view").addEventListener("click", () => setViewOpen(true));
  document.getElementById("open-grid-results").addEventListener("click", () => setGridResultsOpen(true));
  document.getElementById("close-grid-results").addEventListener("click", () => setGridResultsOpen(false));
  hookInstall();
  document.getElementById("country").addEventListener("change", syncUsTests);
  document.getElementById("btn-country").addEventListener("click", () => {
    const country = document.getElementById("country").value;
    if (!country) {
      setStatus("CHOOSE A COUNTRY");
      return;
    }
    if (country === "United States") {
      const id = document.getElementById("us-test").value;
      if (!id) {
        setStatus("CHOOSE A TEST");
        return;
      }
      if (phoneLayout()) setPanel("");
      startScan(id);
      return;
    }
    if (phoneLayout()) setPanel("");
    startScan("country", country);
  });
  document.getElementById("sdr-back").addEventListener("click", closePin);
  document.getElementById("outage-filter").addEventListener("input", renderOutageList);
  document.getElementById("outage-close").addEventListener("click", hideOutageCard);
  document.getElementById("hunger-filter").addEventListener("input", renderHungerList);
  document.getElementById("hunger-close").addEventListener("click", hideHungerCard);
  document.getElementById("stream-filter").addEventListener("input", renderStreamList);
  document.getElementById("conflict-filter").addEventListener("input", renderConflictList);
  document.getElementById("cc-close").addEventListener("click", closeConflict);
  document.getElementById("cc-photo").addEventListener("error", () => {
    document.getElementById("cc-photo").hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePin();
      closeAircraft();
      closeConflict();
      hideHungerCard();
      setPanel("");
    }
  });
  document.getElementById("ac-close").addEventListener("click", closeAircraft);
  document.getElementById("mode-3d").addEventListener("click", () => setSceneMode("3d"));
  document.getElementById("mode-2d").addEventListener("click", () => setSceneMode("2d"));
  document.getElementById("basemap").addEventListener("change", (event) => {
    applyBasemap(event.target.value);
  });
  document.getElementById("terrain").addEventListener("change", (event) => {
    applyTerrain(event.target.value);
  });
  document.getElementById("close-menu").addEventListener("click", () => setPanel(""));
  document.getElementById("close-list").addEventListener("click", () => setPanel(""));
  document.getElementById("open-menu").addEventListener("click", () => {
    const open = document.querySelector(".rail").classList.contains("is-open");
    setPanel(open ? "" : "menu");
  });
  document.getElementById("open-list").addEventListener("click", () => {
    const open = document.querySelector(".feed-col").classList.contains("is-open");
    setPanel(open ? "" : "list");
  });
  document.getElementById("panel-backdrop").addEventListener("click", () => setPanel(""));
  window.addEventListener("resize", () => {
    tuneQuality(state.basemap || "natural");
    if (!phoneLayout()) {
      setGridResultsOpen(false);
      const help = document.getElementById("install-help");
      if (help) help.hidden = true;
    } else syncGridResultsButton();
    syncInstallButton();
  });
  for (const button of document.querySelectorAll("[data-layer-toggle]")) {
    button.addEventListener("click", () => {
      const layer = button.dataset.layerToggle;
      setLayer(layer, !state.layers[layer]);
    });
  }
  for (const button of document.querySelectorAll("[data-feed]")) {
    button.addEventListener("click", () => setFeedMode(button.dataset.feed));
  }
  for (const chip of document.querySelectorAll("[data-filter]")) {
    chip.addEventListener("click", () => {
      for (const other of document.querySelectorAll("[data-filter]")) other.classList.remove("on");
      chip.classList.add("on");
      state.filter = chip.dataset.filter;
      renderFeed();
    });
  }
  for (const button of document.querySelectorAll("[data-air-filter]")) {
    button.addEventListener("click", () => setAirFilter(button.dataset.airFilter, true));
  }
  for (const button of document.querySelectorAll("[data-ship-filter]")) {
    button.addEventListener("click", () => setShipFilter(button.dataset.shipFilter, true));
  }
  for (const button of document.querySelectorAll("[data-traffic-pane]")) {
    button.addEventListener("click", () => {
      state.trafficPane = button.dataset.trafficPane === "ships" ? "ships" : "air";
      syncTrafficBars();
    });
  }
}

async function startScan(id, country) {
  if (state.running) return;
  state.scanWanted = true;
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, country: country || "" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    state.scanWanted = false;
    state.scanLive = false;
    setStatus(body.error || "SCAN REFUSED");
    return;
  }
  if (body.pending || !body.state || !(body.state.results || []).some(Boolean)) {
    setStatus(body.error || "GRID PASS NOT READY YET");
    return;
  }
  replayScan(body.state);
}

function replayScan(snap) {
  const results = (snap.results || []).filter(Boolean);
  const gen = ++state.replayGen;
  clearPoints();
  state.results = [];
  state.running = true;
  state.scanLive = true;
  state.total = results.length;
  state.done = 0;
  state.up = 0;
  state.down = 0;
  state.startedAt = Date.now();
  state.heading = snap.heading || "GRID";
  state.selected = null;
  document.getElementById("heading").textContent = state.heading.toUpperCase();
  document.getElementById("btn-stop").hidden = false;
  if (state.scanSource) state.scanSource.show = true;
  setFeedMode("returns");
  document.getElementById("link-dot").className = "pulse-dot live";
  document.getElementById("selected").hidden = true;
  setStatus(`TASKING ${results.length} NODES · ${state.heading.toUpperCase()}`);
  renderFeed();
  updateHud();
  syncGridResultsButton();
  const n = results.length;
  const span = Math.min(12000, Math.max(2800, n * 6));
  const t0 = performance.now();
  let i = 0;
  function step() {
    if (gen !== state.replayGen) return;
    const elapsed = performance.now() - t0;
    const target = Math.min(n, Math.max(i + 1, Math.floor((elapsed / span) * n)));
    while (i < target) {
      const result = results[i];
      result.index = result.index ?? i;
      state.results[result.index] = result;
      upsertPoint(result);
      if (result.status === "up") state.up += 1;
      else state.down += 1;
      i += 1;
    }
    state.done = i;
    updateHud();
    syncGridResultsButton();
    if (i < n) {
      requestAnimationFrame(step);
      return;
    }
    state.running = false;
    document.getElementById("btn-stop").hidden = true;
    document.getElementById("link-dot").className = state.down ? "pulse-dot hot" : "pulse-dot live";
    const ms = performance.now() - t0;
    setStatus(`COMPLETE · ${state.up} UP · ${state.down} DOWN · ${(ms / 1000).toFixed(1)}s`);
    renderFeed();
    updateHud();
    syncGridResultsButton();
  }
  requestAnimationFrame(step);
}

function connectEvents() {
  // Kept for debugging a live runner pass. Lock & Scan replays scan-cache (#34).
  const stream = new EventSource("/api/events");
  stream.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "hello") {
      if (state.scanLive) applySnapshot(event.state);
      return;
    }
    if (event.type === "scan-start") {
      if (!state.scanWanted) return;
      state.scanLive = true;
      clearPoints();
      state.results = [];
      state.running = true;
      state.total = event.total;
      state.done = 0;
      state.up = 0;
      state.down = 0;
      state.startedAt = Date.now();
      state.heading = event.heading;
      state.selected = null;
      document.getElementById("heading").textContent = event.heading.toUpperCase();
      document.getElementById("btn-stop").hidden = false;
      if (state.scanSource) state.scanSource.show = true;
      setFeedMode("returns");
      document.getElementById("link-dot").className = "pulse-dot live";
      document.getElementById("selected").hidden = true;
      setStatus(`TASKING ${event.total} NODES · ${event.heading.toUpperCase()}`);
      renderFeed();
      updateHud();
      syncGridResultsButton();
    }
    if (!state.scanLive) return;
    if (event.type === "result") {
      state.results[event.result.index] = event.result;
      state.done = event.done;
      state.up = event.up;
      state.down = event.down;
      upsertPoint(event.result);
      prependFeed(event.result);
      updateHud();
      syncGridResultsButton();
    }
    if (event.type === "location") {
      state.results[event.result.index] = event.result;
      upsertPoint(event.result);
      if (state.selected?.address === event.result.address) showSelected(event.result);
    }
    if (event.type === "locating") setStatus(`RESOLVING ${event.count} COORDINATES`);
    if (event.type === "scan-done") {
      state.running = false;
      document.getElementById("btn-stop").hidden = true;
      document.getElementById("link-dot").className = event.down ? "pulse-dot hot" : "pulse-dot live";
      setStatus(`COMPLETE · ${event.up} UP · ${event.down} DOWN · ${(event.ms / 1000).toFixed(1)}s`);
      updateHud();
      syncGridResultsButton();
    }
    if (event.type === "scan-stop") {
      state.running = false;
      document.getElementById("btn-stop").hidden = true;
      setStatus("SCAN ABORTED");
      updateHud();
      syncGridResultsButton();
    }
    if (event.type === "error") setStatus(event.message);
  };
  stream.onerror = () => setStatus("EVENT STREAM DROPPED · RECONNECTING");
}

function applySnapshot(snap) {
  clearPoints();
  state.results = snap.results || [];
  state.running = Boolean(snap.running);
  state.total = snap.total || 0;
  state.done = snap.done || 0;
  state.up = snap.up || 0;
  state.down = snap.down || 0;
  state.heading = snap.heading || state.heading;
  document.getElementById("heading").textContent = (state.heading || "AWAITING TASKING").toUpperCase();
  document.getElementById("btn-stop").hidden = !snap.running;
  for (const result of state.results) {
    if (result) upsertPoint(result);
  }
  renderFeed();
  updateHud();
  syncGridResultsButton();
}

function clearPoints() {
  if (!state.viewer) return;
  if (state.scanSource) state.scanSource.entities.removeAll();
  state.points.clear();
  state.arcs.clear();
  ensureOrigin();
}

function ensureOrigin() {
  if (!state.viewer || state.origin) return;
  state.origin = state.viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat, 0),
    point: {
      pixelSize: 8,
      color: Cesium.Color.fromCssColorString("#7ef6ff"),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

function arcPositions(lat, lon) {
  const start = Cesium.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat, 0);
  const end = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const distance = Cesium.Cartesian3.distance(start, end);
  if (distance < 1500) return null;
  const height = Math.min(Math.max(distance * 0.18, 25000), 900000);
  const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
  const steps = 40;
  const positions = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cart = new Cesium.Cartesian3();
    Cesium.Cartesian3.lerp(start, end, t, cart);
    Cesium.Cartesian3.normalize(cart, cart);
    Cesium.Cartesian3.multiplyByScalar(cart, radius + Math.sin(t * Math.PI) * height, cart);
    positions.push(cart);
  }
  return positions;
}

function arcMaterial(color) {
  return new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.28, color });
}

function upsertArc(result) {
  if (!state.viewer || !state.scanSource || result.lat == null || result.lon == null) return;
  state.scanSource.show = true;
  const positions = arcPositions(result.lat, result.lon);
  if (!positions) return;
  const color = COLORS[result.status] || COLORS.pending;
  const material = arcMaterial(color);
  let entity = state.arcs.get(result.index);
  if (!entity) {
    entity = state.scanSource.entities.add({
      polyline: {
        positions,
        width: 4,
        material,
        depthFailMaterial: arcMaterial(color),
        arcType: Cesium.ArcType.NONE,
      },
    });
    state.arcs.set(result.index, entity);
    return;
  }
  entity.polyline.positions = positions;
  entity.polyline.material = material;
  entity.polyline.depthFailMaterial = arcMaterial(color);
}

function upsertPoint(result) {
  if (!state.viewer || !state.scanSource || result.lat == null || result.lon == null) return;
  const color = COLORS[result.status] || COLORS.pending;
  const pixelSize = result.status === "down" ? 16 : 12;
  let entity = state.points.get(result.index);
  const position = Cesium.Cartesian3.fromDegrees(result.lon, result.lat, 0);
  if (!entity) {
    entity = state.scanSource.entities.add({
      position,
      point: markerPoint(color, pixelSize),
    });
    entity._resultIndex = result.index;
    state.points.set(result.index, entity);
    upsertArc(result);
    return;
  }
  entity.position = position;
  entity.point.pixelSize = pixelSize;
  entity.point.color = color;
  upsertArc(result);
}

function visibleResults() {
  return state.results.filter((result) => result && (state.filter === "all" || result.status === state.filter));
}

function prependFeed(result) {
  if (state.filter !== "all" && result.status !== state.filter) return;
  const feed = document.getElementById("feed");
  feed.prepend(rowEl(result));
  while (feed.children.length > 400) feed.lastChild.remove();
}

function renderFeed() {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";
  const items = visibleResults().slice().reverse().slice(0, 400);
  for (const result of items) feed.append(rowEl(result));
}

function rowEl(result) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <div class="badge ${esc(result.status)}">${esc(result.status.toUpperCase())}</div>
    <div>
      <div class="name">${esc(result.name)}</div>
      <div class="host">${esc(result.address)}${result.method && result.method !== "none" ? " · " + esc(result.method) : ""}</div>
    </div>
    <div>${result.ms || 0}ms</div>`;
  row.addEventListener("click", () => focusResult(result));
  return row;
}

function focusResult(result) {
  showSelected(result);
  if (phoneLayout()) setGridResultsOpen(false);
  const entity = state.points.get(result.index);
  if (!entity || !state.viewer) return;
  state.viewer.selectedEntity = entity;
  state.viewer.flyTo(entity, { duration: 0.8 });
}

function showSelected(result) {
  state.selected = result;
  const box = document.getElementById("selected");
  box.hidden = false;
  box.innerHTML = `<b>${esc(result.status.toUpperCase())}</b> ${esc(result.name)}<br>${esc(result.address)}${result.ip ? " · " + esc(result.ip) : ""}<br>${esc(result.location || result.country || "location pending")}<br>${result.ms || 0}ms · ${esc(result.method || "—")}`;
}

function updateHud() {
  document.getElementById("stat-done").textContent = state.done;
  document.getElementById("stat-total").textContent = `/ ${state.total}`;
  document.getElementById("stat-up").textContent = state.up;
  document.getElementById("stat-down").textContent = state.down;
  document.getElementById("stat-pct").textContent = state.done ? `${Math.round((state.up / state.done) * 100)}%` : "—";
  document.getElementById("progress").style.width = state.total ? `${(state.done / state.total) * 100}%` : "0%";
  setCount("scan", state.results.filter(Boolean).length);
}

function setStatus(text) {
  const track = document.getElementById("status-track");
  if (track) track.textContent = text;
  else document.getElementById("status-line").textContent = text;
}

function tickClock() {
  document.getElementById("clock").textContent = new Date().toISOString().slice(11, 19) + "Z";
  setTimeout(tickClock, 1000);
}

function setFeedMode(mode) {
  const allowed = ["outages", "hunger", "stream", "conflicts", "returns"];
  state.feedMode = allowed.includes(mode) ? mode : "outages";
  for (const name of allowed) {
    const pane = document.getElementById(`${name}-pane`);
    if (!pane) continue;
    const heldOpen = name === "returns" && gridSheetOpen();
    pane.hidden = state.feedMode !== name && !heldOpen;
  }
  for (const button of document.querySelectorAll("[data-feed]")) {
    button.classList.toggle("on", button.dataset.feed === state.feedMode);
  }
  const title = document.getElementById("feed-title");
  if (state.feedMode === "outages") title.textContent = `POWER OUTAGES ${state.outagePoints.length}`;
  else if (state.feedMode === "hunger") title.textContent = `WORLD HUNGER ${state.hungerPoints.length}`;
  else if (state.feedMode === "stream") title.textContent = `SCANNERS ${state.streamPoints.length}`;
  else if (state.feedMode === "conflicts") title.textContent = `CONFLICT TRACKER ${state.conflicts.length}`;
  else title.textContent = "LIVE RETURNS";
}

function sourceFor(layer) {
  if (layer === "outages") return state.outageSource;
  if (layer === "hunger") return state.hungerSource;
  if (layer === "conflicts") return state.conflictSource;
  if (layer === "stream") return state.streamSource;
  if (layer === "scan") return state.scanSource;
  if (state.live[layer]?.source) return state.live[layer].source;
  return null;
}

function setCount(key, value) {
  const text = String(value);
  for (const el of document.querySelectorAll(`[data-count="${key}"]`)) el.textContent = text;
}

function resetMap() {
  fetch("/api/stop", { method: "POST" });
  state.running = false;
  state.scanWanted = false;
  state.scanLive = false;
  state.results = [];
  state.total = 0;
  state.done = 0;
  state.up = 0;
  state.down = 0;
  state.selected = null;
  state.heading = "AWAITING TASKING";
  const stop = document.getElementById("btn-stop");
  if (stop) stop.hidden = true;
  const heading = document.getElementById("heading");
  if (heading) heading.textContent = "AWAITING TASKING";
  const grid = document.getElementById("grid-status");
  if (grid) {
    grid.textContent = "Choose a test";
    grid.dataset.scanId = "";
  }
  const country = document.getElementById("country");
  if (country) country.value = "";
  const usTests = document.getElementById("us-test");
  if (usTests) {
    usTests.value = "";
    usTests.hidden = true;
  }
  const selected = document.getElementById("selected");
  if (selected) selected.hidden = true;
  clearPoints();
  if (state.origin && state.viewer) {
    state.viewer.entities.remove(state.origin);
    state.origin = null;
  }
  if (state.viewer) state.viewer.selectedEntity = undefined;
  for (const key of Object.keys(state.layers)) setLayer(key, false);
  closeAircraft();
  closeConflict();
  hideOutageCard();
  hideHungerCard();
  closePin();
  state.trafficPane = "air";
  setAirFilter("all", false);
  setShipFilter("underway", false);
  renderFeed();
  updateHud();
  setGridResultsOpen(false);
  setStatus("MAP RESET · LAYERS OFF");
}

function gridSheetOpen() {
  const panel = document.getElementById("grid-results");
  return Boolean(panel && !panel.hidden);
}

function hasGridResults() {
  return state.running || state.results.some(Boolean);
}

function placeReturnsPane(open) {
  const pane = document.getElementById("returns-pane");
  if (!pane) return;
  if (open) {
    document.getElementById("grid-results-body").append(pane);
    pane.hidden = false;
    return;
  }
  document.querySelector(".feed-col").append(pane);
  pane.hidden = state.feedMode !== "returns";
}

function setGridResultsOpen(open) {
  const panel = document.getElementById("grid-results");
  const button = document.getElementById("open-grid-results");
  if (!panel || !button) return;
  if (!phoneLayout()) open = false;
  if (open) {
    placeReturnsPane(true);
    panel.hidden = false;
    button.hidden = true;
    setPanel("");
    return;
  }
  placeReturnsPane(false);
  panel.hidden = true;
  button.hidden = !(phoneLayout() && hasGridResults());
}

function syncGridResultsButton() {
  if (gridSheetOpen()) return;
  const button = document.getElementById("open-grid-results");
  if (!button) return;
  button.hidden = !(phoneLayout() && hasGridResults());
}

let installPrompt = null;

function appIsInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function syncInstallButton() {
  const button = document.getElementById("install-app");
  if (!button) return;
  button.hidden = !phoneLayout() || appIsInstalled();
}

function hookInstall() {
  const button = document.getElementById("install-app");
  const help = document.getElementById("install-help");
  const close = document.getElementById("install-help-close");
  if (!button) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    syncInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    button.hidden = true;
    if (help) help.hidden = true;
  });
  button.addEventListener("click", async () => {
    if (!phoneLayout()) return;
    if (installPrompt) {
      try {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        return;
      } catch (error) {
        installPrompt = null;
      }
    }
    if (help) help.hidden = false;
  });
  if (close && help) close.addEventListener("click", () => { help.hidden = true; });
  if (phoneLayout() && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  syncInstallButton();
}

function setLayer(layer, on) {
  if (!Object.prototype.hasOwnProperty.call(state.layers, layer)) return;
  state.layers[layer] = Boolean(on);
  const source = sourceFor(layer);
  if (source) source.show = state.layers[layer];
  if (layer === "conflicts" && !state.layers.conflicts) closeConflict();
  if (layer === "outages" && !state.layers.outages) hideOutageCard();
  if (layer === "hunger" && !state.layers.hunger) hideHungerCard();
  for (const button of document.querySelectorAll(`[data-layer-toggle="${layer}"]`)) {
    button.classList.toggle("on", state.layers[layer]);
    button.setAttribute("aria-pressed", state.layers[layer] ? "true" : "false");
  }
  const host = document.getElementById("cesium");
  if (host) {
    host.dataset.visibleLayers = Object.keys(state.layers).filter((key) => state.layers[key]).join(" ");
  }
  if (layer === "aircraft" || layer === "ships") {
    if (state.layers.aircraft && state.layers.ships && state.layers[layer]) {
      state.trafficPane = layer === "ships" ? "ships" : "air";
    }
    syncTrafficBars();
  }
  if (layer === "ships" && state.layers.ships) scheduleShips();
  if ((layer === "aircraft" || layer === "jamming") && state.layers[layer]) pollLiveFeeds();
  if (layer === "mesh" && state.layers.mesh) scheduleMesh();
  if (layer === "disease" && state.layers.disease) scheduleDisease();
  if (layer === "animal" && state.layers.animal) scheduleAnimal();
  if (layer === "designations") {
    if (state.layers.designations) {
      loadDesignations().catch((error) => statusLive(error.message || String(error)));
    }
  }
  if (layer === "violence") {
    if (state.layers.violence) {
      loadViolence().catch((error) => statusLive(error.message || String(error)));
    }
  }
  if (layer === "nuke") {
    const hud = document.getElementById("nuke-hud");
    if (hud) hud.hidden = !state.layers.nuke;
    if (state.layers.nuke) {
      applyTerrain("elevation");
      syncNukeHud();
    }
  }
  if (layer === "streets3d") {
    if (state.layers.streets3d) {
      applyTerrain("elevation");
      loadStreets3d().catch((error) => statusLive(error.message || String(error)));
    } else if (state.live.streets3d.source) {
      state.live.streets3d.source.entities.removeAll();
    }
  }
  if (layer === "quakes" && state.layers.quakes) scheduleQuakes();
  if (layer === "amfm") {
    if (state.layers.amfm) {
      loadAmfm().catch((error) => statusLive(error.message || String(error)));
    } else {
      const selected = state.viewer && state.viewer.selectedEntity;
      if (selected && selected._live && selected._live.layer === "amfm") {
        state.viewer.selectedEntity = undefined;
        const box = document.getElementById("selected");
        if (box) box.hidden = true;
      }
    }
  }
  if (layer === "outages" && state.layers.outages && !state.outageMeta) {
    loadOutages().catch((error) => statusLive(error.message || String(error)));
  }
  if (layer === "hunger" && state.layers.hunger && !state.hungerMeta) {
    loadHunger().catch((error) => statusLive(error.message || String(error)));
  }
  syncMobilePick(layer);
}

const LAYER_LABEL = {
  outages: "POWER OUTAGES",
  stream: "SCANNERS",
  jamming: "JAMMED GPS SIGNALS",
  aircraft: "LIVE AIR TRAFFIC",
  ships: "MARITIME TRAFFIC",
  conflicts: "CONFLICT TRACKER",
  hunger: "WORLD HUNGER",
  mesh: "MESH NODES",
  disease: "DISEASE OUTBREAK",
  animal: "ANIMAL DISEASE OUTBREAK",
  amfm: "AM FM TOWERS",
  designations: "DESIGNATIONS",
  violence: "ATTRIBUTED VIOLENCE",
  nuke: "NUCLEAR",
  quakes: "QUAKES",
  streets3d: "STREETS 3D",
};

function syncMobilePick(just) {
  const line = document.getElementById("mobile-pick");
  if (!line) return;
  const order = ["outages", "stream", "jamming", "aircraft", "ships", "conflicts", "hunger", "mesh", "disease", "animal", "amfm", "designations", "violence", "nuke", "quakes", "streets3d"];
  const on = order.filter((key) => state.layers[key]);
  if (just && state.layers[just]) {
    const rest = on.filter((key) => key !== just);
    on.length = 0;
    on.push(just, ...rest);
  }
  if (!on.length) {
    line.hidden = true;
    line.textContent = "";
    return;
  }
  line.hidden = false;
  line.textContent = on.map((key) => LAYER_LABEL[key] || key).join(" · ");
}

function syncTrafficBars() {
  const airOn = Boolean(state.layers.aircraft);
  const shipOn = Boolean(state.layers.ships);
  const pane = state.trafficPane === "ships" ? "ships" : "air";
  const switcher = document.querySelector(".traffic-switch");
  if (switcher) switcher.hidden = !(airOn && shipOn);
  const airBar = document.querySelector(".air-filters");
  const shipBar = document.querySelector(".ship-filters");
  if (airBar) airBar.classList.toggle("is-open", airOn && (!shipOn || pane === "air"));
  if (shipBar) shipBar.classList.toggle("is-open", shipOn && (!airOn || pane === "ships"));
  const shipCreditLine = document.querySelector(".ship-credit");
  if (shipCreditLine) shipCreditLine.hidden = !shipOn;
  for (const button of document.querySelectorAll("[data-traffic-pane]")) {
    const on = button.dataset.trafficPane === pane;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function layerStatus(error) {
  statusLive(error);
}

function outageCustomers(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function outagePlace(point) {
  const place = `${point.name || ""}, ${point.state || ""}`.replace(/^,\s*|,\s*$/g, "");
  if (point.country && point.country !== "United States") return `${place} · ${point.country}`;
  return place;
}

function outageColor(customers) {
  const n = Number(customers) || 0;
  if (n >= 5000) return "#8b1e12";
  if (n >= 1000) return "#c43212";
  if (n >= 250) return "#e25b12";
  if (n >= 50) return "#f08a24";
  return "#f6c27a";
}

async function loadOutages() {
  const response = await fetch("/api/outages");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Power outages failed");
  state.outagePoints = Array.isArray(body.points) ? body.points : [];
  state.outageMeta = body;
  setCount("outages", state.outagePoints.length);
  placeOutageMarkers();
  const credit = document.getElementById("outage-credit");
  if (credit) {
    const when = body.updated ? ` · ${String(body.updated).replace("T", " ").slice(0, 16)}Z` : "";
    const stale = body.stale ? "Cached. " : "";
    const note = body.note || "US counties from utilities that report to DOE/ORNL ODIN.";
    credit.textContent = `${stale}${outageCustomers(body.customers)} customers across ${state.outagePoints.length} pins. ${note}${when}`;
  }
  renderOutageList();
  layerStatus(body.stale ? "OUTAGES CACHED" : "");
}

function placeOutageMarkers() {
  const source = state.outageSource;
  if (!state.viewer || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers.outages);
  for (const point of state.outagePoints) {
    if (point.lat == null || point.lon == null) continue;
    const entity = source.entities.add({
      name: outagePlace(point),
      position: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 0),
      point: markerPoint(outageColor(point.customers)),
    });
    entity._outage = point;
  }
  const host = document.getElementById("cesium");
  if (host) host.dataset.outages = String(source.entities.values.length);
}

async function loadConflicts() {
  const response = await fetch("/api/conflicts");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Conflict tracker failed");
  state.conflicts = Array.isArray(body.conflicts) ? body.conflicts : [];
  state.conflictsReady = true;
  setCount("conflicts", state.conflicts.length);
  const credit = document.getElementById("conflict-credit");
  if (credit) {
    credit.textContent = `${body.stale ? "cached · " : ""}cfr.org/global-conflict-tracker`;
    credit.title = body.credit || "";
  }
  placeConflictMarkers();
  const host = document.getElementById("cesium");
  if (host && state.conflictSource) host.dataset.conflicts = String(state.conflictSource.entities.values.length);
  renderConflictList();
  layerStatus(body.stale ? "CONFLICT TRACKER CACHED" : "");
}

// Aircraft pictures use this screen size. It does not change with zoom.
const PIN_SIZE = 48;
// Same circle as the Conflict Tracker markers.
const MARKER_SIZE = 18;
const MARKER_OUTLINE = "#2A2E3C";

function markerPoint(color, pixelSize = MARKER_SIZE) {
  return {
    pixelSize,
    color: typeof color === "string" ? Cesium.Color.fromCssColorString(color) : color,
    outlineColor: Cesium.Color.fromCssColorString(MARKER_OUTLINE),
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function placeMarkers(source, layer, items, color) {
  if (!state.viewer || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers[layer]);
  const stacks = new Map();
  for (const item of items) {
    if (item.lat == null || item.lon == null) continue;
    let lat = Number(item.lat);
    let lon = Number(item.lon);
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const n = stacks.get(key) || 0;
    stacks.set(key, n + 1);
    if (n > 0) {
      const angle = n * 2.399963;
      const radius = 0.02 * Math.sqrt(n);
      lat += Math.sin(angle) * radius;
      lon += (Math.cos(angle) * radius) / Math.max(0.2, Math.cos(lat * Math.PI / 180));
    }
    const entity = source.entities.add({
      name: item.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: markerPoint(color),
    });
    entity._pin = item;
  }
}

function renderOutageList() {
  const list = document.getElementById("outage-list");
  if (!list) return;
  const query = (document.getElementById("outage-filter").value || "").trim().toLowerCase();
  const points = state.outagePoints
    .filter((point) => {
      if (!query) return true;
      const hay = `${point.name} ${point.state} ${point.country || ""} ${(point.utilities || []).join(" ")} ${point.source || ""}`.toLowerCase();
      return hay.includes(query);
    })
    .slice()
    .sort((a, b) => (b.customers || 0) - (a.customers || 0) || String(a.name).localeCompare(String(b.name)));
  list.innerHTML = "";
  for (const point of points) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    if (state.openKind === "outage" && point.id === state.openId) row.classList.add("on");
    const utils = (point.utilities || []).slice(0, 2).join(", ");
    row.innerHTML = `<div class="name">${esc(outagePlace(point))}</div><div class="host">${outageCustomers(point.customers)} customers${utils ? " · " + esc(utils) : ""}</div>`;
    row.addEventListener("click", () => openOutage(point, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "outages") {
    document.getElementById("feed-title").textContent = `POWER OUTAGES ${points.length}`;
  }
}

function findOutageEntity(id) {
  if (!state.outageSource) return null;
  for (const entity of state.outageSource.entities.values) {
    if (entity._outage && entity._outage.id === id) return entity;
  }
  return null;
}

function hideOutageCard() {
  const card = document.getElementById("outage-card");
  if (card) card.hidden = true;
  if (state.openKind === "outage") {
    state.openKind = "";
    state.openId = "";
    renderOutageList();
  }
}

function openOutage(point, options = {}) {
  if (!point) return;
  if (state.openKind === "conflict") closeConflict();
  closeAircraft();
  closePin();
  hideHungerCard();
  state.openKind = "outage";
  state.openId = point.id;
  if (state.layers.outages === false) setLayer("outages", true);
  setFeedMode("outages");
  const selected = document.getElementById("selected");
  if (selected) selected.hidden = true;
  const card = document.getElementById("outage-card");
  const title = document.getElementById("outage-title");
  const body = document.getElementById("outage-body");
  if (card && title && body) {
    const utils = (point.utilities || []).join(", ");
    const sourceName = point.source || "DOE/ORNL ODIN";
    title.textContent = outagePlace(point);
    body.textContent = `${outageCustomers(point.customers)} customers out${utils ? " · " + utils : ""}${sourceName !== utils ? " · " + sourceName : ""}`;
    card.hidden = false;
  }
  renderOutageList();
  const entity = findOutageEntity(point.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 420000),
      duration: 0.9,
    });
  }
}

const HUNGER_COLORS = {
  "#fff1ef": true,
  "#ffd7ca": true,
  "#ffaa8e": true,
  "#ff7648": true,
  "#af4729": true,
  "#7f321b": true,
};

function hungerColor(point) {
  const color = String(point.color || "").toLowerCase();
  return HUNGER_COLORS[color] ? color : "#ff7648";
}

function hungerRate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.endsWith("%") ? text : `${text}%`;
}

async function loadHunger() {
  const response = await fetch("/api/hunger");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "World hunger failed");
  state.hungerPoints = Array.isArray(body.points) ? body.points : [];
  state.hungerMeta = body;
  setCount("hunger", state.hungerPoints.length);
  placeHungerMarkers();
  const credit = document.getElementById("hunger-credit");
  if (credit) {
    const note = body.note || "Prevalence of undernourishment from the FAO Hunger Map.";
    credit.innerHTML = `${state.hungerPoints.length} countries. <a href="https://www.fao.org/interactive/hunger-map/en/" target="_blank" rel="noopener noreferrer">FAO Hunger Map</a>. ${esc(note)}`;
  }
  renderHungerList();
  layerStatus(body.stale ? "WORLD HUNGER CACHED" : "");
}

function placeHungerMarkers() {
  const source = state.hungerSource;
  if (!state.viewer || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers.hunger);
  for (const point of state.hungerPoints) {
    if (point.lat == null || point.lon == null) continue;
    const entity = source.entities.add({
      name: point.name,
      position: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 0),
      point: markerPoint(hungerColor(point)),
    });
    entity._hunger = point;
  }
  const host = document.getElementById("cesium");
  if (host) host.dataset.hunger = String(source.entities.values.length);
}

function renderHungerList() {
  const list = document.getElementById("hunger-list");
  if (!list) return;
  const query = (document.getElementById("hunger-filter").value || "").trim().toLowerCase();
  const points = state.hungerPoints
    .filter((point) => {
      if (!query) return true;
      return `${point.name} ${point.region || ""} ${point.id || ""}`.toLowerCase().includes(query);
    })
    .slice()
    .sort((a, b) => (b.pouValue || 0) - (a.pouValue || 0) || String(a.name).localeCompare(String(b.name)));
  list.innerHTML = "";
  for (const point of points) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    if (state.openKind === "hunger" && point.id === state.openId) row.classList.add("on");
    const region = point.region ? ` · ${esc(point.region)}` : "";
    row.innerHTML = `<div class="name">${esc(point.name)}</div><div class="host">${esc(hungerRate(point.pou))} undernourished${region}</div>`;
    row.addEventListener("click", () => openHunger(point, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "hunger") {
    document.getElementById("feed-title").textContent = `WORLD HUNGER ${points.length}`;
  }
}

function findHungerEntity(id) {
  if (!state.hungerSource) return null;
  for (const entity of state.hungerSource.entities.values) {
    if (entity._hunger && entity._hunger.id === id) return entity;
  }
  return null;
}

function hideHungerCard() {
  const card = document.getElementById("hunger-card");
  if (card) card.hidden = true;
  if (state.openKind === "hunger") {
    state.openKind = "";
    state.openId = "";
    renderHungerList();
  }
}

function openHunger(point, options = {}) {
  if (!point) return;
  if (state.openKind === "conflict") closeConflict();
  closeAircraft();
  closePin();
  hideOutageCard();
  state.openKind = "hunger";
  state.openId = point.id;
  if (state.layers.hunger === false) setLayer("hunger", true);
  setFeedMode("hunger");
  const selected = document.getElementById("selected");
  if (selected) selected.hidden = true;
  const card = document.getElementById("hunger-card");
  const title = document.getElementById("hunger-title");
  const body = document.getElementById("hunger-body");
  if (card && title && body) {
    const fies = point.fies ? ` Moderate or severe food insecurity ${hungerRate(point.fies)}.` : "";
    const region = point.region ? ` · ${point.region}` : "";
    title.textContent = point.name;
    body.textContent = `${hungerRate(point.pou)} of people undernourished${region}. The ${point.year || "latest"} figure is a 3-year average.${fies}`;
    card.hidden = false;
  }
  renderHungerList();
  const entity = findHungerEntity(point.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 2200000),
      duration: 0.9,
    });
  }
}

function renderConflictList() {
  const list = document.getElementById("conflict-list");
  if (!list) return;
  const query = (document.getElementById("conflict-filter").value || "").trim().toLowerCase();
  const conflicts = state.conflicts.filter((conflict) => {
    if (!query) return true;
    return `${conflict.name} ${conflict.region} ${conflict.status} ${conflict.types} ${conflict.description}`.toLowerCase().includes(query);
  });
  list.innerHTML = "";
  for (const conflict of conflicts) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    row.dataset.lat = String(conflict.lat);
    row.dataset.lon = String(conflict.lon);
    row.dataset.url = conflict.url;
    if (state.openKind === "conflict" && conflict.id === state.openId) row.classList.add("on");
    const status = String(conflict.status || "").toLowerCase().replace(/\s+/g, "-");
    row.innerHTML = `<div class="name">${esc(conflict.name)}</div><div class="host"><span class="st-${esc(status)}">${esc(conflict.status || "")}</span>${conflict.region ? " · " + esc(conflict.region) : ""}${conflict.types ? " · " + esc(conflict.types) : ""}</div>`;
    row.addEventListener("click", () => openConflict(conflict, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "conflicts") {
    document.getElementById("feed-title").textContent = `CONFLICT TRACKER ${conflicts.length}`;
  }
}

const CONFLICT_COLOR = {
  Worsening: "#D65B29",
  Improving: "#39BC85",
  Unchanging: "#648FC7",
  Developing: "#979595",
};
const CONFLICT_OUTLINE = "#2A2E3C";
const CONFLICT_SELECTED = "#ffffff";

function placeConflictMarkers() {
  const source = state.conflictSource;
  if (!state.viewer || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers.conflicts);
  const selected = state.openKind === "conflict" ? state.openId : "";
  const used = {};
  let points = 0;
  for (const item of state.conflicts) {
    if (item.lat == null || item.lon == null) continue;
    const on = item.id === selected;
    const color = on ? CONFLICT_SELECTED : (CONFLICT_COLOR[item.status] || CONFLICT_COLOR.Developing);
    used[color] = (used[color] || 0) + 1;
    points += 1;
    const entity = source.entities.add({
      name: item.name,
      position: Cesium.Cartesian3.fromDegrees(Number(item.lon), Number(item.lat), 0),
      point: markerPoint(color, on ? 20 : MARKER_SIZE),
    });
    entity._pin = item;
  }
  const host = document.getElementById("cesium");
  if (host) {
    host.dataset.marker = selected ? CONFLICT_SELECTED : "";
    host.dataset.conflictStyle = points ? "point" : "";
    host.dataset.conflictColors = Object.entries(used).map(([color, count]) => `${color}:${count}`).join(" ");
  }
}

let highlightRequest = 0;

async function highlightCountries(codes) {
  const request = ++highlightRequest;
  const viewer = state.viewer;
  const host = document.getElementById("cesium");
  if (!viewer) return;
  if (state.highlightSource) {
    viewer.dataSources.remove(state.highlightSource, true);
    state.highlightSource = null;
  }
  const wanted = (codes || []).map((code) => String(code || "").toUpperCase()).filter(Boolean);
  if (!wanted.length) {
    if (host) host.dataset.highlight = "";
    return;
  }
  if (!state.countryIndex) {
    try {
      const data = await fetch("/geo/countries.geojson").then((response) => response.json());
      state.countryIndex = new Map();
      for (const feature of data.features || []) {
        const iso = String(feature.properties?.iso || "").toUpperCase();
        if (iso) state.countryIndex.set(iso, feature);
      }
    } catch (error) {
      console.warn(error);
      return;
    }
  }
  if (request !== highlightRequest) return;
  const features = wanted.map((code) => state.countryIndex.get(code)).filter(Boolean);
  if (host) host.dataset.highlight = features.map((feature) => feature.properties.iso).join(",");
  if (!features.length) return;
  try {
    const dataSource = await Cesium.GeoJsonDataSource.load(
      { type: "FeatureCollection", features },
      {
        stroke: Cesium.Color.fromCssColorString("#8F3602"),
        fill: Cesium.Color.fromCssColorString("#FFCAA7").withAlpha(0.72),
        strokeWidth: 2,
        clampToGround: true,
      },
    );
    if (request !== highlightRequest) return;
    state.highlightSource = dataSource;
    viewer.dataSources.add(dataSource);
  } catch (error) {
    console.warn(error);
  }
}

function renderConflictCard(conflict) {
  const card = document.getElementById("conflict-card");
  card.hidden = false;
  document.getElementById("cc-title").textContent = conflict.name || "";
  document.getElementById("cc-type").textContent = conflict.types || "";
  document.getElementById("cc-impact").textContent = conflict.impact || "";
  const status = document.getElementById("cc-status");
  status.textContent = conflict.status || "";
  const tone = String(conflict.status || "").toLowerCase().replace(/\s+/g, "-");
  status.className = `cc-status cc-${tone}`;
  document.getElementById("cc-desc").textContent = conflict.description || "";
  const more = document.getElementById("cc-more");
  more.href = conflict.url || "https://www.cfr.org/global-conflict-tracker";
  const photo = document.getElementById("cc-photo");
  const src = String(conflict.image || "");
  if (src.startsWith("https://")) {
    photo.alt = conflict.imageAlt || conflict.name || "";
    photo.hidden = false;
    photo.src = src;
  } else {
    photo.hidden = true;
    photo.removeAttribute("src");
    photo.alt = "";
  }
  const host = document.getElementById("cesium");
  if (host) host.dataset.conflictOpen = conflict.slug || "";
}

function openConflict(conflict, options = {}) {
  if (!conflict) return;
  // Selecting the pin fires this again. Returning keeps that from looping.
  if (state.openKind === "conflict" && state.openId === conflict.id) return;
  hideOutageCard();
  hideHungerCard();
  closeAircraft();
  const listen = document.getElementById("sdr-listen");
  if (listen) listen.hidden = true;
  const selected = document.getElementById("selected");
  if (selected) selected.hidden = true;
  state.openKind = "conflict";
  state.openId = conflict.id;
  if (state.layers.conflicts === false) setLayer("conflicts", true);
  setFeedMode("conflicts");
  renderConflictCard(conflict);
  placeConflictMarkers();
  highlightCountries(conflict.countries || []);
  renderConflictList();
  const entity = findPin("conflict", conflict.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer && Number.isFinite(Number(conflict.lat)) && Number.isFinite(Number(conflict.lon))) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(Number(conflict.lon), Number(conflict.lat), 2200000),
      duration: 0.9,
    });
  }
}

function closeConflict() {
  const card = document.getElementById("conflict-card");
  if (card) card.hidden = true;
  const host = document.getElementById("cesium");
  if (host) host.dataset.conflictOpen = "";
  const wasOpen = state.openKind === "conflict";
  if (wasOpen) {
    state.openKind = "";
    state.openId = "";
  }
  highlightCountries([]);
  if (wasOpen) placeConflictMarkers();
  renderConflictList();
}

function findPin(kind, id) {
  const source = sourceFor(kind === "conflict" ? "conflicts" : kind);
  if (!source) return null;
  for (const entity of source.entities.values) {
    if (entity._pin && entity._pin.kind === kind && entity._pin.id === id) return entity;
  }
  return null;
}

function openPin(pin, options = {}) {
  if (!pin || !pin.url) return;
  if (pin.kind === "conflict") {
    openConflict(pin, options);
    return;
  }
  if (state.openKind === "conflict") closeConflict();
  state.openKind = pin.kind;
  state.openId = pin.id;
  const layer = pin.kind === "conflict" ? "conflicts" : pin.kind;
  if (state.layers[layer] === false) setLayer(layer, true);
  document.getElementById("sdr-title").textContent = pin.name;
  document.getElementById("sdr-meta").textContent = pin.meta || "";
  const frame = document.getElementById("sdr-frame");
  frame.title = pin.name;
  showListenFrame(pin.url);
  document.getElementById("sdr-listen").hidden = false;
  renderConflictList();
  renderStreamList();
  const entity = findPin(pin.kind, pin.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer && Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lon))) {
    const height = pin.kind === "sdr" ? 280000 : 800000;
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, height),
      duration: 0.9,
    });
  }
}

function listenInFrame(url) {
  // These receivers are http and bind the stream to the browser's own address.
  // A secure page is not allowed to draw that inside the map.
  return location.protocol !== "https:" || /^https:\/\//i.test(url || "");
}

function showListenFrame(url) {
  const frame = document.getElementById("sdr-frame");
  const direct = document.getElementById("sdr-direct");
  const pop = document.getElementById("sdr-pop");
  const go = document.getElementById("sdr-listen-now");
  const framed = listenInFrame(url);
  if (pop) {
    pop.href = url || "#";
    pop.textContent = framed ? "OPEN IN WINDOW" : "LISTEN";
  }
  if (go) go.href = url || "#";
  if (direct) direct.hidden = framed;
  if (!frame) return;
  frame.hidden = !framed;
  if (!framed) {
    frame.src = "about:blank";
    frame.dataset.url = "";
    return;
  }
  if (frame.dataset.url !== url) {
    frame.dataset.url = url;
    frame.src = url;
  }
}

function closePin() {
  hideHungerCard();
  const frame = document.getElementById("sdr-frame");
  frame.src = "about:blank";
  frame.dataset.url = "";
  frame.hidden = false;
  const direct = document.getElementById("sdr-direct");
  if (direct) direct.hidden = true;
  const pop = document.getElementById("sdr-pop");
  if (pop) pop.textContent = "OPEN IN WINDOW";
  state.openKind = "";
  state.openId = "";
  document.getElementById("sdr-listen").hidden = true;
  renderConflictList();
  renderStreamList();
}

async function loadStreams() {
  const response = await fetch("/api/streams");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Stream overlay failed");
  state.streamPoints = Array.isArray(body.points) ? body.points : [];
  setCount("stream", state.streamPoints.length);
  placeStreamPins(state.streamPoints);
  renderStreamList();
}

function placeStreamPins(points) {
  if (!state.viewer || !state.streamSource) return;
  state.streamSource.entities.removeAll();
  state.streamSource.show = Boolean(state.layers.stream);
  const groups = new Map();
  for (const site of points) {
    if (site.lat == null || site.lon == null) continue;
    const key = `${Number(site.lat).toFixed(2)}|${Number(site.lon).toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(site);
  }
  for (const group of groups.values()) {
    group.forEach((site, index) => {
    const angle = (index / Math.max(group.length, 1)) * Math.PI * 2;
    const radius = group.length === 1 ? 0 : 0.035 * Math.sqrt(index + 1);
    const lat = Number(site.lat) + Math.sin(angle) * radius;
    const lon = Number(site.lon) + (Math.cos(angle) * radius) / Math.max(0.2, Math.cos(Number(site.lat) * Math.PI / 180));
    const entity = state.streamSource.entities.add({
      name: site.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: markerPoint(site.online === false ? "#c084fc59" : "#c084fc"),
    });
    entity._stream = site;
    });
  }
}

function renderStreamList() {
  const list = document.getElementById("stream-list");
  if (!list) return;
  const query = (document.getElementById("stream-filter").value || "").trim().toLowerCase();
  const sites = state.streamPoints
    .filter((site) => {
      if (!query) return true;
      const hay = `${site.name} ${site.county || ""} ${site.city || ""} ${site.state || ""} ${site.source || ""} ${site.description || ""}`.toLowerCase();
      return hay.includes(query);
    })
    .slice()
    .sort((a, b) => (b.listeners || 0) - (a.listeners || 0) || a.name.localeCompare(b.name))
    .slice(0, 500);
  list.innerHTML = "";
  for (const site of sites) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stream-row";
    if (site.id === state.streamOpenId) row.classList.add("on");
    const where = [site.city, site.county, site.state, site.source].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ");
    row.innerHTML = `<div class="name">${esc(site.name)}</div><div class="host">${esc(where)}${site.listeners ? " · " + site.listeners + " listening" : ""}</div>`;
    row.addEventListener("click", () => openStream(site, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "stream") {
    document.getElementById("feed-title").textContent = `SCANNERS ${state.streamPoints.length}`;
  }
}

function findStreamEntity(id) {
  if (!state.streamSource) return null;
  for (const entity of state.streamSource.entities.values) {
    if (entity._stream && entity._stream.id === id) return entity;
  }
  return null;
}

function openStream(site, options = {}) {
  if (!site || !site.url) return;
  if (state.openKind === "conflict") closeConflict();
  state.streamOpenId = site.id;
  setFeedMode("stream");
  const box = document.getElementById("selected");
  box.hidden = false;
  const where = [site.city, site.county, site.state, site.source].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ");
  const coords = Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lon))
    ? `${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)}`
    : "";
  box.innerHTML = `<b>SCANNER</b> ${esc(site.name)}<br>OpenMHz${where ? " · " + esc(where) : ""}${coords ? "<br>" + coords : ""}`;
  renderStreamList();
  const entity = findStreamEntity(site.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer && coords) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(Number(site.lon), Number(site.lat), 180000),
      duration: 0.9,
    });
  }
  const panel = document.getElementById("sdr-listen");
  document.getElementById("sdr-title").textContent = site.name;
  document.getElementById("sdr-meta").textContent = ["OpenMHz", site.city, site.county, site.state].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ");
  const frame = document.getElementById("sdr-frame");
  frame.title = site.name;
  showListenFrame(site.url);
  panel.hidden = false;
}

const ALT_HUE = [[0, 20], [2000, 32.5], [4000, 43], [6000, 54], [8000, 72], [9000, 85], [11000, 140], [40000, 300], [51000, 360]];
const ALT_LIGHT = [[0, 53], [20, 50], [32, 54], [40, 52], [46, 51], [50, 46], [60, 43], [80, 41], [100, 41], [120, 41], [140, 41], [160, 40], [180, 40], [190, 44], [198, 50], [200, 58], [220, 58], [240, 58], [255, 55], [266, 55], [270, 58], [280, 58], [290, 47], [300, 43], [310, 48], [320, 48], [340, 52], [360, 53]];
const aircraftIconCache = new Map();

function lerpStops(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const span = stops[i][0] - stops[i - 1][0];
      const t = span ? (value - stops[i - 1][0]) / span : 0;
      return stops[i - 1][1] + t * (stops[i][1] - stops[i - 1][1]);
    }
  }
  return stops[stops.length - 1][1];
}

function altitudeColor(alt) {
  if (alt === "ground") return "hsl(220, 0%, 30%)";
  if (!Number.isFinite(Number(alt))) return "hsl(0, 0%, 75%)";
  const hue = lerpStops(ALT_HUE, Number(alt));
  const light = lerpStops(ALT_LIGHT, hue);
  return `hsl(${hue.toFixed(1)}, 88%, ${light.toFixed(1)}%)`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Missing ${url}`));
    image.src = url;
  });
}

async function loadAdsbIcons() {
  if (state.adsbIcons) return state.adsbIcons;
  const [meta, image] = await Promise.all([
    fetch("/icons/adsb-shapes.json").then((response) => response.json()),
    loadImage("/icons/adsb-sprites.png"),
  ]);
  state.adsbIcons = { meta, image };
  return state.adsbIcons;
}

function spriteIndex(point) {
  const meta = state.adsbIcons.meta;
  const type = String(point.t || "").toUpperCase();
  if (type && meta.types[type]) return meta.types[type][0];
  const category = String(point.category || "").toUpperCase();
  if (category && meta.categories[category]) return meta.categories[category][0];
  return meta.unknown;
}

function aircraftIcon(point) {
  const index = spriteIndex(point);
  const cached = aircraftIconCache.get(index);
  if (cached) return cached;
  const { image, meta } = state.adsbIcons;
  const column = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, column * meta.cell, row * meta.cell, meta.cell, meta.cell, 1, 1, size - 2, size - 2);
  const frame = ctx.getImageData(0, 0, size, size);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    // Cells are a white shape and a black edge on a clear background.
    // A unique colored PNG per aircraft overflows the map texture and
    // draws a black square. Keep one white shape per sprite and tint it.
    const alpha = px[i + 3];
    const lum = px[i];
    if (alpha < 16 || lum < 48) {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
      continue;
    }
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = alpha;
  }
  ctx.putImageData(frame, 0, 0);
  const url = canvas.toDataURL("image/png");
  aircraftIconCache.set(index, url);
  return url;
}

const LIVE_STYLE = {
  jamming: { color: "#ff7a3a", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "JAMMED GPS SIGNALS" },
  aircraft: { color: "#7ec8ff", outline: "#082033", size: () => 5, kind: "ADS-B" },
  ships: { color: "#3dffd0", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "MARITIME" },
  mesh: { color: "#8fe04a", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "MESH NODES" },
  disease: { color: "#ff4d6a", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "DISEASE OUTBREAK" },
  animal: { color: "#e2b340", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "ANIMAL DISEASE OUTBREAK" },
  amfm: { color: "#7aa2ff", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "AM FM TOWERS" },
  designations: { color: "#f0c14a", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "DESIGNATION" },
  violence: { color: "#c44b4b", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "ATTRIBUTED VIOLENCE" },
  nuke: { color: "#7cff6b", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "NUCLEAR" },
  quakes: { color: "#f08a24", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "QUAKES" },
  streets3d: { color: "#c4a574", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "STREETS 3D" },
};

function aircraftOnGround(point) {
  return point.alt === "ground" || Number(point.alt) <= 0;
}

function aircraftMatches(point) {
  const filter = state.airFilter || "all";
  if (filter === "all") return true;
  if (filter === "mil") return Boolean(point.mil);
  const category = String(point.category || "").toUpperCase();
  if (filter === "airliner") return category === "A3" || category === "A5";
  if (filter === "heli") return category === "A7";
  if (filter === "ground") return aircraftOnGround(point);
  return true;
}

function aircraftVisibleCount(points) {
  let count = 0;
  for (const point of points || []) {
    if (point.lat == null || point.lon == null) continue;
    if (aircraftMatches(point)) count += 1;
  }
  return count;
}

function setAirFilter(filter, turnOn) {
  state.airFilter = filter || "all";
  for (const button of document.querySelectorAll("[data-air-filter]")) {
    const on = button.dataset.airFilter === state.airFilter;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (turnOn && !state.layers.aircraft) setLayer("aircraft", true);
  if (state.airFilter === "mil") {
    if (state.militaryPoints) publishAircraft(state.militaryPoints);
    refreshMilitary().catch((error) => statusLive(error.message || String(error)));
    return;
  }
  publishAircraft(state.aircraftFeed || []);
  if (turnOn && !state.running) statusLive();
}

function publishAircraft(points) {
  state.live.aircraft.points = points || [];
  const total = state.live.aircraft.points.length;
  setCount("aircraft", state.airFilter === "all" ? total : aircraftVisibleCount(state.live.aircraft.points));
  placeLiveLayer("aircraft", state.live.aircraft.points);
}

const SHIP_TILES = "https://ais.openwaters.io/v1/vessels/tiles";
const SHIP_DRAW_CAP = 3200;
let shipLoadToken = 0;
let shipMoveTimer = 0;

function shipSpeed(point) {
  const speed = Number(point.sog);
  return Number.isFinite(speed) ? speed : 0;
}

function shipTypeBucket(point) {
  const code = Number(point.type);
  if (!Number.isFinite(code)) return "other";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  if (code >= 60 && code <= 69) return "passenger";
  if (code === 30) return "fishing";
  return "other";
}

function shipTypeLabel(point) {
  const names = {
    cargo: "Cargo",
    tanker: "Tanker",
    passenger: "Passenger",
    fishing: "Fishing",
    other: "Vessel",
  };
  return names[shipTypeBucket(point)] || "Vessel";
}

function shipMatches(point) {
  const filter = state.shipFilter || "underway";
  const speed = shipSpeed(point);
  if (filter === "all") return true;
  if (filter === "stopped") return speed < 1;
  if (filter === "underway") return speed >= 1;
  if (filter === "fast") return speed >= 15;
  if (filter === "cargo" || filter === "tanker" || filter === "passenger" || filter === "fishing") {
    return shipTypeBucket(point) === filter;
  }
  return true;
}

function shipDrawList(points) {
  const matched = [];
  for (const point of points || []) {
    if (point.lat == null || point.lon == null) continue;
    if (shipMatches(point)) matched.push(point);
  }
  if (matched.length <= SHIP_DRAW_CAP) return { matched: matched.length, draw: matched };
  const step = Math.ceil(matched.length / SHIP_DRAW_CAP);
  const draw = [];
  for (let i = 0; i < matched.length && draw.length < SHIP_DRAW_CAP; i += step) draw.push(matched[i]);
  return { matched: matched.length, draw };
}

function readVarint(buf, index) {
  let shift = 0;
  let value = 0;
  let i = index;
  while (i < buf.length) {
    const byte = buf[i];
    i += 1;
    value += (byte & 0x7f) * (2 ** shift);
    if (byte < 128) return [value, i];
    shift += 7;
    if (shift > 35) break;
  }
  return [value, i];
}

function zigzag(value) {
  return (value & 1) ? -((value + 1) / 2) : value / 2;
}

function parseFields(buf) {
  const fields = [];
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = readVarint(buf, i);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let value;
      [value, i] = readVarint(buf, i);
      fields.push([field, value]);
    } else if (wire === 5) {
      const value = new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true);
      i += 4;
      fields.push([field, value]);
    } else if (wire === 1) {
      const value = new DataView(buf.buffer, buf.byteOffset + i, 8).getFloat64(0, true);
      i += 8;
      fields.push([field, value]);
    } else if (wire === 2) {
      let length;
      [length, i] = readVarint(buf, i);
      fields.push([field, buf.subarray(i, i + length)]);
      i += length;
    } else {
      break;
    }
  }
  return fields;
}

function shipValue(raw) {
  for (const [field, value] of parseFields(raw)) {
    if (field === 1) return new TextDecoder().decode(value);
    if (field === 6) return zigzag(value);
    if (field === 2 || field === 3 || field === 4 || field === 5 || field === 7) return value;
  }
  return null;
}

function unpackVarints(value) {
  if (typeof value === "number") return [value];
  const out = [];
  let i = 0;
  while (i < value.length) {
    let number;
    [number, i] = readVarint(value, i);
    out.push(number);
  }
  return out;
}

function tileLonLat(z, x, y, px, py, extent) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / extent) / n))) * (180 / Math.PI);
  return [lon, lat];
}

function decodeShipTile(buf, tile) {
  const points = [];
  for (const [field, value] of parseFields(buf)) {
    if (field !== 3) continue;
    const layer = parseFields(value);
    let name = "";
    let extent = 4096;
    const keys = [];
    const values = [];
    const features = [];
    for (const [layerField, layerValue] of layer) {
      if (layerField === 1) name = new TextDecoder().decode(layerValue);
      else if (layerField === 3) keys.push(new TextDecoder().decode(layerValue));
      else if (layerField === 4) values.push(shipValue(layerValue));
      else if (layerField === 5 && typeof layerValue === "number") extent = layerValue;
      else if (layerField === 2) features.push(layerValue);
    }
    if (name !== "vessels") continue;
    for (const raw of features) {
      const feature = parseFields(raw);
      let tags = [];
      let geom = [];
      for (const [featureField, featureValue] of feature) {
        if (featureField === 2) tags = unpackVarints(featureValue);
        else if (featureField === 4) geom = unpackVarints(featureValue);
      }
      const props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const key = keys[tags[i]];
        const prop = values[tags[i + 1]];
        if (key != null) props[key] = prop;
      }
      if (props.kind && props.kind !== "vessel") continue;
      let cursorX = 0;
      let cursorY = 0;
      let px = null;
      let py = null;
      let g = 0;
      while (g < geom.length) {
        const command = geom[g];
        g += 1;
        const op = command & 7;
        const count = command >> 3;
        if (op === 1 || op === 2) {
          for (let n = 0; n < count && g + 1 < geom.length; n += 1) {
            cursorX += zigzag(geom[g]);
            cursorY += zigzag(geom[g + 1]);
            g += 2;
            if (op === 1) {
              px = cursorX;
              py = cursorY;
            }
          }
        } else if (op !== 7) {
          break;
        }
      }
      if (px == null || py == null) continue;
      const [lon, lat] = tileLonLat(tile.z, tile.x, tile.y, px, py, extent);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) continue;
      const mmsi = props.mmsi == null ? "" : String(props.mmsi);
      points.push({
        lat,
        lon,
        name: props.name || mmsi || "VESSEL",
        sog: Number(props.sog) || 0,
        cog: Number.isFinite(Number(props.cog)) ? Number(props.cog) : Number(props.heading) || 0,
        type: Number(props.type),
        source: props.source || "",
        mmsi,
      });
    }
  }
  return points;
}

function shipTilesForView(viewer) {
  const world = [];
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) world.push({ z: 2, x, y });
  }
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return world;
  let west = Cesium.Math.toDegrees(rect.west);
  let east = Cesium.Math.toDegrees(rect.east);
  let south = Math.max(-85, Cesium.Math.toDegrees(rect.south));
  let north = Math.min(85, Cesium.Math.toDegrees(rect.north));
  let lonSpan = east - west;
  if (lonSpan <= 0) lonSpan += 360;
  const latSpan = Math.max(0.2, north - south);
  if (lonSpan > 150 || latSpan > 100) return world;
  let z = 2;
  for (let tryZ = 6; tryZ >= 2; tryZ -= 1) {
    const tileDeg = 360 / (2 ** tryZ);
    const nx = Math.ceil(lonSpan / tileDeg) + 1;
    const ny = Math.ceil(latSpan / tileDeg) + 1;
    if (nx * ny <= 16) {
      z = tryZ;
      break;
    }
  }
  const n = 2 ** z;
  const yFor = (lat) => {
    const rad = lat * Math.PI / 180;
    const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    return Math.max(0, Math.min(n - 1, Math.floor((1 - merc / Math.PI) / 2 * n)));
  };
  const tiles = [];
  const seen = new Set();
  const x0 = Math.floor(((west + 180) / 360) * n);
  const x1 = Math.floor(((west + lonSpan + 180) / 360) * n);
  const y0 = yFor(north);
  const y1 = yFor(south);
  for (let x = x0; x <= x1; x += 1) {
    const wrapped = ((x % n) + n) % n;
    for (let y = y0; y <= y1; y += 1) {
      const key = `${wrapped},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ z, x: wrapped, y });
      if (tiles.length >= 16) return tiles;
    }
  }
  return tiles.length ? tiles : world;
}

function mergeShipPoints(groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const point of group) {
      const key = point.mmsi || `${point.lat.toFixed(3)},${point.lon.toFixed(3)}`;
      if (!byId.has(key)) byId.set(key, point);
    }
  }
  return [...byId.values()];
}

function shipCredit(points) {
  const sources = new Set((points || []).map((point) => point.source));
  const parts = ['Positions from <a href="https://openwaters.io/ais/#license" target="_blank" rel="noreferrer">Open Waters AIS</a>'];
  if (sources.has("kystverket") || sources.has("barentswatch")) {
    parts.push("Contains data under the Norwegian licence for Open Government data (NLOD) distributed by the Norwegian Coastal Administration.");
  }
  if (sources.has("barentswatch")) parts.push("Data delivered by BarentsWatch.");
  if (sources.has("digitraffic")) parts.push("Source: Fintraffic / digitraffic.fi, license CC BY 4.0.");
  if (sources.has("aishub")) parts.push("AISHub.");
  if (sources.has("aisstream")) parts.push("aisstream.io.");
  return parts.join(" ");
}

function publishShips(points) {
  state.live.ships.points = points;
  placeLiveLayer("ships", points);
  setCount("ships", shipDrawList(points).draw.length);
  const credit = document.querySelector(".ship-credit");
  if (credit) credit.innerHTML = `<span class="ship-credit-track">${shipCredit(points)}</span>`;
  if (!state.running) statusLive();
}

function scheduleShips() {
  clearTimeout(shipMoveTimer);
  shipMoveTimer = setTimeout(loadShips, 600);
}

async function loadShips() {
  const viewer = state.viewer;
  if (!viewer || !state.layers.ships) return;
  const token = ++shipLoadToken;
  const tiles = shipTilesForView(viewer);
  try {
    const settled = await Promise.allSettled(tiles.map(async (tile) => {
      const response = await fetch(`${SHIP_TILES}/${tile.z}/${tile.x}/${tile.y}`);
      if (!response.ok) throw new Error(String(response.status));
      return decodeShipTile(new Uint8Array(await response.arrayBuffer()), tile);
    }));
    if (token !== shipLoadToken || !state.layers.ships) return;
    const groups = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
    if (!groups.length) {
      if (!state.live.ships.points.length) setStatus("MARITIME FEED UNAVAILABLE");
      return;
    }
    publishShips(mergeShipPoints(groups));
  } catch (error) {
    if (token !== shipLoadToken) return;
    if (!state.live.ships.points.length) setStatus("MARITIME FEED UNAVAILABLE");
  }
}

let meshTimer = 0;
let meshToken = 0;

function scheduleMesh() {
  clearTimeout(meshTimer);
  meshTimer = setTimeout(loadMesh, 400);
}

async function loadMesh() {
  if (!state.layers.mesh) return;
  const token = ++meshToken;
  try {
    const response = await fetch("/api/mesh");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Mesh Nodes failed");
    if (token !== meshToken || !state.layers.mesh) return;
    const points = Array.isArray(body.points) ? body.points : [];
    state.live.mesh.points = points;
    placeLiveLayer("mesh", points);
    setCount("mesh", points.length);
  } catch (error) {
    if (token !== meshToken) return;
    setCount("mesh", state.live.mesh.points.length || "—");
  }
}

let diseaseTimer = 0;
let diseaseToken = 0;

function scheduleDisease() {
  clearTimeout(diseaseTimer);
  diseaseTimer = setTimeout(loadDisease, 400);
}

async function loadDisease() {
  if (!state.layers.disease) return;
  const token = ++diseaseToken;
  try {
    const response = await fetch("/api/disease");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Disease Outbreak failed");
    if (token !== diseaseToken || !state.layers.disease) return;
    const points = Array.isArray(body.points) ? body.points : [];
    state.live.disease.points = points;
    placeLiveLayer("disease", points);
    setCount("disease", points.length);
    if (!state.running) statusLive();
  } catch (error) {
    if (token !== diseaseToken) return;
    setCount("disease", state.live.disease.points.length || "—");
    if (!state.running) statusLive(error.message || String(error));
  }
}

let animalTimer = 0;
let animalToken = 0;

function scheduleAnimal() {
  clearTimeout(animalTimer);
  animalTimer = setTimeout(loadAnimal, 400);
}

async function loadAnimal() {
  if (!state.layers.animal) return;
  const token = ++animalToken;
  try {
    const response = await fetch("/api/animal");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Animal Disease Outbreak failed");
    if (token !== animalToken || !state.layers.animal) return;
    const points = Array.isArray(body.points) ? body.points : [];
    state.live.animal.points = points;
    placeLiveLayer("animal", points);
    setCount("animal", points.length);
    if (!state.running) statusLive();
  } catch (error) {
    if (token !== animalToken) return;
    setCount("animal", state.live.animal.points.length || "—");
    if (!state.running) statusLive(error.message || String(error));
  }
}

function shipVisibleCount(points) {
  let count = 0;
  for (const point of points || []) {
    if (point.lat == null || point.lon == null) continue;
    if (shipMatches(point)) count += 1;
  }
  return count;
}

function setShipFilter(filter, turnOn) {
  state.shipFilter = filter || "underway";
  for (const button of document.querySelectorAll("[data-ship-filter]")) {
    const on = button.dataset.shipFilter === state.shipFilter;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (turnOn && !state.layers.ships) setLayer("ships", true);
  const points = state.live.ships.points || [];
  placeLiveLayer("ships", points);
  setCount("ships", shipDrawList(points).draw.length);
  if (turnOn && !state.running) statusLive();
}

function aircraftStyle(point) {
  if (point.emergency || point.squawk === "7700") {
    return { color: "#ff5c5c", outline: "#3a0810", size: 10, kind: "ADS-B EMERG" };
  }
  if (point.squawk === "7600" || point.squawk === "7500") {
    return { color: "#ffb020", outline: "#3a2808", size: 9, kind: "ADS-B SQK" };
  }
  if (point.mil) {
    return { color: "#d4e06a", outline: "#2a3008", size: 7, kind: "ADS-B MIL" };
  }
  return { color: "#7ec8ff", outline: "#082033", size: 5, kind: "ADS-B" };
}

let militaryToken = 0;

async function refreshMilitary() {
  const token = ++militaryToken;
  try {
    await loadAdsbIcons();
  } catch (error) {
    if (!state.adsbIcons) state.adsbIcons = null;
  }
  const response = await fetch("/api/mil");
  const body = await response.json();
  if (token !== militaryToken) return;
  const points = Array.isArray(body.points) ? body.points : [];
  if (points.length) state.militaryPoints = points;
  if (state.airFilter !== "mil") return;
  publishAircraft(state.militaryPoints || (state.aircraftFeed || []).filter((point) => point.mil));
}

async function pollLiveFeeds() {
  try {
    await loadAdsbIcons();
  } catch (error) {
    state.adsbIcons = null;
  }
  const data = await fetch("/api/feeds").then((response) => response.json());
  const jam = data.jamming || {};
  state.live.jamming.points = jam.points || [];
  setCount("jamming", jam.count ?? state.live.jamming.points.length);
  placeLiveLayer("jamming", state.live.jamming.points);
  state.aircraftFeed = (data.aircraft && data.aircraft.points) || [];
  if (state.airFilter === "mil") await refreshMilitary();
  else publishAircraft(state.aircraftFeed);
  statusLive();
}

function keepFlatMapIntact() {
  const viewer = state.viewer;
  if (!viewer || viewer.scene.mode !== Cesium.SceneMode.SCENE2D) return;
  const z = viewer.camera.position.z;
  const frustum = viewer.camera.frustum;
  if (!(z > 1) || !frustum) return;
  // Markers report a bounding sphere as wide as the Earth. On the flat
  // map that splits drawing into horizontal strips. Android draws those
  // strips out of line once you zoom in. One tight depth window keeps
  // the map in a single strip. The ground sits at this camera height,
  // and aircraft are only a few kilometers above it.
  const near = Math.max(1, z - 80000);
  const far = z + 200000;
  if (frustum.near !== near) frustum.near = near;
  if (frustum.far !== far) frustum.far = far;
}

function cullAircraftHorizon() {
  const viewer = state.viewer;
  if (!viewer) return;
  const sources = [
    state.live.jamming.source,
    state.live.aircraft.source,
    state.live.ships.source,
    state.live.mesh.source,
    state.live.disease.source,
    state.live.animal.source,
    state.live.amfm.source,
    state.live.designations.source,
    state.live.violence.source,
    state.live.nuke.source,
    state.live.streets3d.source,
    state.outageSource,
    state.hungerSource,
  ];
  const scene = viewer.scene;
  // Depth-testing these icons at globe distance eats them. Leaving the
  // depth test off draws far-side icons through the earth, so they look
  // stuck on the front when the globe turns. Hide the jammed GPS signals,
  // aircraft, ships, power outages, and world hunger the ellipsoid blocks.
  if (scene.mode !== Cesium.SceneMode.SCENE3D) {
    for (const source of sources) {
      if (!source) continue;
      const entities = source.entities.values;
      for (let i = 0; i < entities.length; i += 1) entities[i].show = true;
    }
    return;
  }
  const occluder = state.aircraftOccluder
    || (state.aircraftOccluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84));
  occluder.cameraPosition = scene.camera.positionWC;
  const time = viewer.clock.currentTime;
  for (const source of sources) {
    if (!source || !source.show) continue;
    const entities = source.entities.values;
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const position = entity.position && entity.position.getValue(time);
      entity.show = Boolean(position) && occluder.isPointVisible(position);
    }
  }
}

function amfmStations(point) {
  return Array.isArray(point && point.stations) ? point.stations : [];
}

function amfmVisibleCount(points) {
  let count = 0;
  for (const point of points || []) count += amfmStations(point).length;
  return count;
}

function publishAmfm() {
  const points = state.live.amfm.points || [];
  setCount("amfm", amfmVisibleCount(points));
  placeLiveLayer("amfm", points);
}

let amfmLoading = null;

async function loadAmfm() {
  if (state.amfmReady) {
    publishAmfm();
    return;
  }
  if (amfmLoading) return amfmLoading;
  amfmLoading = (async () => {
    const response = await fetch("/api/amfm");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "AM FM towers failed");
    const places = Array.isArray(body.places) ? body.places : [];
    state.live.amfm.points = places
      .filter((place) => place.lat != null && place.lon != null)
      .map((place) => ({
        name: place.city || place.name || "",
        country: place.country || "",
        lat: Number(place.lat),
        lon: Number(place.lon),
        stations: Array.isArray(place.stations) ? place.stations : [],
      }));
    state.amfmReady = true;
    publishAmfm();
    statusLive();
  })();
  try {
    await amfmLoading;
  } finally {
    amfmLoading = null;
  }
}

function designationColor(point) {
  if (point.designator_kind === "ngo") return "#c084fc";
  if (point.person) return "#e8a54b";
  return "#f0c14a";
}

function designationSize(point) {
  const precision = String(point.precision || "");
  if (precision === "street") return MARKER_SIZE;
  if (precision === "city" || precision === "county") return 14;
  if (precision === "state") return 12;
  return 10;
}

function mapPackedPoints(body, extra) {
  return (Array.isArray(body.points) ? body.points : [])
    .filter((point) => point.lat != null && point.lon != null)
    .map((point) => extra(point));
}

let designationsLoading = null;

async function loadDesignations() {
  if (state.live.designations.points.length) {
    setCount("designations", state.live.designations.points.length);
    placeLiveLayer("designations", state.live.designations.points);
    return;
  }
  if (designationsLoading) return designationsLoading;
  designationsLoading = (async () => {
    const response = await fetch("/api/designations");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Designations failed");
    state.live.designations.points = mapPackedPoints(body, (point) => ({
      ...point,
      color: designationColor(point),
      size: designationSize(point),
      kind: point.person ? "LISTED PERSON" : "DESIGNATION",
      url: point.url,
    }));
    setCount("designations", state.live.designations.points.length);
    placeLiveLayer("designations", state.live.designations.points);
    statusLive();
  })();
  try {
    await designationsLoading;
  } finally {
    designationsLoading = null;
  }
}

let violenceLoading = null;

async function loadViolence() {
  if (state.live.violence.points.length) {
    setCount("violence", state.live.violence.points.length);
    placeLiveLayer("violence", state.live.violence.points);
    return;
  }
  if (violenceLoading) return violenceLoading;
  violenceLoading = (async () => {
    const response = await fetch("/api/violence");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Violence overlay failed");
    state.live.violence.points = mapPackedPoints(body, (point) => ({
      ...point,
      color: "#c44b4b",
      size: 12,
      kind: "UCDP EVENT",
      url: point.url || "https://ucdp.uu.se/",
    }));
    setCount("violence", state.live.violence.points.length);
    placeLiveLayer("violence", state.live.violence.points);
    statusLive();
  })();
  try {
    await violenceLoading;
  } finally {
    violenceLoading = null;
  }
}

let quakesLoading = null;

function scheduleQuakes() {
  loadQuakes().catch((error) => statusLive(error.message || String(error)));
}

async function loadQuakes() {
  if (!window.GsaQuakes) return;
  if (document.hidden) return;
  if (quakesLoading) return quakesLoading;
  quakesLoading = (async () => {
    const result = await window.GsaQuakes.fetchFeed();
    state.live.quakes.points = result.points || [];
    setCount("quakes", state.live.quakes.points.length);
    placeLiveLayer("quakes", state.live.quakes.points);
    statusLive();
  })();
  try {
    await quakesLoading;
  } finally {
    quakesLoading = null;
  }
}

function placeLiveLayer(key, points) {
  const layer = state.live[key];
  if (!layer?.source) return;
  layer.source.entities.removeAll();
  layer.source.show = Boolean(state.layers[key]);
  const base = LIVE_STYLE[key];
  const drawPoints = key === "ships" ? shipDrawList(points).draw : points;
  for (const point of drawPoints) {
    if (point.lat == null || point.lon == null) continue;
    if (key === "aircraft" && !aircraftMatches(point)) continue;
    if (key === "ships" && !shipMatches(point)) continue;
    if (key === "amfm" && !amfmStations(point).length) continue;
    const height = key === "aircraft" ? Number(point.altM) || 0 : 0;
    const entityOptions = {
      name: point.name,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, height),
    };
    let kind = base.kind;
    if (key === "aircraft" && state.adsbIcons) {
      entityOptions.billboard = {
        image: aircraftIcon(point),
        color: Cesium.Color.fromCssColorString(altitudeColor(point.alt)),
        rotation: -Cesium.Math.toRadians(Number(point.track) || 0),
        width: PIN_SIZE,
        height: PIN_SIZE,
        sizeInMeters: false,
        scale: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        alignedAxis: Cesium.Cartesian3.ZERO,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      };
      kind = "ADS-B";
    } else {
      const style = key === "aircraft" ? aircraftStyle(point) : {
        color: point.color || base.color,
        outline: base.outline,
        size: point.size || MARKER_SIZE,
        kind: point.kind || base.kind,
      };
      kind = style.kind;
      entityOptions.point = key === "aircraft"
        ? {
          pixelSize: style.size,
          color: Cesium.Color.fromCssColorString(style.color),
          outlineColor: Cesium.Color.fromCssColorString(style.outline),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
        : markerPoint(style.color, style.size);
    }
    const entity = layer.source.entities.add(entityOptions);
    entity._live = { ...point, kind, layer: key };
  }
  if (key === "aircraft") hideFilteredAircraft(points);
  if (key === "ships") hideFilteredShips();
}

function hideFilteredShips() {
  const selected = state.viewer && state.viewer.selectedEntity;
  if (!selected || !selected._live || selected._live.layer !== "ships") return;
  if (shipMatches(selected._live)) return;
  state.viewer.selectedEntity = undefined;
  const box = document.getElementById("selected");
  if (box) box.hidden = true;
}

function hideFilteredAircraft(points) {
  const card = document.getElementById("aircraft-card");
  if (!card || card.hidden) return;
  const hex = (document.getElementById("ac-hex").textContent || "").trim().toLowerCase();
  if (!hex) return;
  const open = (points || []).find((point) => String(point.hex || "").toLowerCase() === hex);
  if (open && !aircraftMatches(open)) {
    if (state.viewer && state.viewer.selectedEntity && state.viewer.selectedEntity._live && state.viewer.selectedEntity._live.layer === "aircraft") {
      state.viewer.selectedEntity = undefined;
    }
    closeAircraft();
  }
}

let aircraftRequest = 0;

function closeAircraft() {
  aircraftRequest += 1;
  const card = document.getElementById("aircraft-card");
  if (card) card.hidden = true;
}

function pickedMapPin(position) {
  const viewer = state.viewer;
  if (!viewer) return false;
  const picked = viewer.scene.pick(position);
  if (!Cesium.defined(picked)) return false;
  const id = picked.id ?? (picked.primitive && picked.primitive.id);
  return id instanceof Cesium.Entity;
}

function isMapPin(entity) {
  const viewer = state.viewer;
  if (!entity || !viewer) return false;
  if (entity._outage || entity._hunger || entity._pin || entity._stream || entity._live || entity._resultIndex != null) return true;
  const sources = viewer.dataSources;
  for (let i = 0; i < sources.length; i += 1) {
    if (sources.get(i).entities.contains(entity)) return true;
  }
  return viewer.entities.contains(entity);
}

// Pin cards use [data-map-popup]. A later layer closes on empty ground the same way
// when its card has that attribute, or when it reuses one of the close functions below.
function closeMapPopups() {
  const open = Array.from(document.querySelectorAll("[data-map-popup]")).some((popup) => !popup.hidden);
  if (!open && !state.selected && !state.openKind && !state.streamOpenId) return;
  state.streamOpenId = "";
  closeAircraft();
  closeConflict();
  hideOutageCard();
  closePin();
  state.selected = null;
  const box = document.getElementById("selected");
  if (box) box.hidden = true;
  for (const popup of document.querySelectorAll("[data-map-popup]")) popup.hidden = true;
}

function showLive(item) {
  if (item.layer === "aircraft") {
    openAircraft(item);
    return;
  }
  const box = document.getElementById("selected");
  box.hidden = false;
  let extra = "";
  if (item.layer === "quakes") {
    const mag = item.mag != null ? `Magnitude ${item.mag}` : "";
    const bits = [mag, item.place, item.timeText].filter(Boolean).map((part) => esc(String(part)));
    extra = bits.length ? `<br>${bits.join("<br>")}` : "";
    if (item.url) extra += `<br><a href="${esc(item.url)}" target="_blank" rel="noreferrer">USGS event</a>`;
  }
  else if (item.url) extra = `<br><a href="${esc(item.url)}" target="_blank" rel="noreferrer">CFR briefing</a>`;
  else if (item.pct != null) extra = `<br>${item.pct}% bad NACp · ${item.bad || 0} degraded`;
  else if (item.layer === "mesh") {
    const bits = [item.short, item.hw, item.role].filter(Boolean).map((part) => esc(part));
    extra = bits.length ? `<br>${bits.join(" · ")}` : "";
    extra += `<br><a href="https://meshmap.net/#${encodeURIComponent(item.id || "")}" target="_blank" rel="noreferrer">meshmap.net</a>`;
  }
  else if (item.layer === "disease") {
    const bits = [item.place, item.date, item.summary].filter(Boolean).map((part) => esc(part));
    extra = bits.length ? `<br>${bits.join("<br>")}` : "";
    extra += `<br><a href="https://www.healthmap.org/en/" target="_blank" rel="noreferrer">healthmap.org</a>`;
  }
  else if (item.layer === "animal") {
    const bits = [item.place, item.when, item.note].filter(Boolean).map((part) => esc(part));
    extra = bits.length ? `<br>${bits.join("<br>")}` : "";
    extra += `<br><a href="https://app.gideononline.com/updates/outbreaks" target="_blank" rel="noreferrer">gideononline.com</a>`;
  }
  else if (item.layer === "amfm") {
    const names = amfmStations(item).map((station) => esc(station.name));
    const shown = names.slice(0, 12);
    extra = item.country ? `<br>${esc(item.country)}` : "";
    if (shown.length) extra += `<br>${shown.join("<br>")}`;
    if (names.length > shown.length) extra += `<br>and ${names.length - shown.length} more`;
  }
  else if (item.layer === "designations") {
    const bits = [
      item.designator,
      item.legal_status,
      item.claim_type,
      item.precision,
      item.address,
    ].filter(Boolean).map((part) => esc(part));
    extra = bits.length ? `<br>${bits.join("<br>")}` : "";
    if (item.url) extra += `<br><a href="${esc(item.url)}" target="_blank" rel="noreferrer">source list</a>`;
  }
  else if (item.layer === "violence") {
    const bits = [item.year, item.deaths != null ? `${item.deaths} deaths` : "", item.address]
      .filter(Boolean).map((part) => esc(String(part)));
    extra = bits.length ? `<br>${bits.join(" · ")}` : "";
    extra += `<br><a href="https://ucdp.uu.se/" target="_blank" rel="noreferrer">ucdp.uu.se</a>`;
  }
  else if (item.sog != null) extra = `<br>${esc(shipTypeLabel(item))} · ${esc(item.sog)} kn`;
  box.innerHTML = `<b>${esc(item.kind)}</b> ${esc(item.name)}<br>${Number(item.lat).toFixed(2)}, ${Number(item.lon).toFixed(2)}${extra}`;
}

function aircraftFact(label, value) {
  if (value == null || value === "") return "";
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function aircraftNumber(value, digits, suffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const text = digits == null ? String(Math.round(number)) : number.toFixed(digits);
  return `${text}${suffix || ""}`;
}

function renderAircraft(item, detail) {
  const live = detail?.live || {};
  const flight = String(live.flight || item.name || "AIRCRAFT").trim();
  const hex = String(live.hex || item.hex || "").toLowerCase();
  document.getElementById("ac-flight").textContent = flight;
  document.getElementById("ac-hex").textContent = hex.toUpperCase();
  const link = document.getElementById("ac-link");
  link.href = hex ? `https://adsb.lol/?icao=${hex}` : "https://adsb.lol/";
  const photo = document.getElementById("ac-photo");
  const credit = document.getElementById("ac-credit");
  const src = detail?.photo?.src || "";
  if (src.startsWith("https://")) {
    photo.src = src;
    photo.hidden = false;
    credit.hidden = false;
    credit.textContent = detail.photo.photographer ? `Image © ${detail.photo.photographer}` : "Image";
  } else {
    photo.hidden = true;
    photo.removeAttribute("src");
    credit.hidden = true;
    credit.textContent = "";
  }
  const type = live.t || item.t || "";
  const desc = detail?.typeInfo?.desc || "";
  const route = detail?.route?.iata || detail?.route?.icao || "";
  const facts = [
    aircraftFact("Reg.", live.r || item.r || ""),
    aircraftFact("Type", type),
    desc ? aircraftFact("Type desc.", desc) : "",
    aircraftFact("Squawk", live.squawk || item.squawk || ""),
    aircraftFact("Route", route ? route.replace("-", " - ") : ""),
    `<div class="ac-section">SPATIAL</div>`,
    aircraftFact("Groundspeed", aircraftNumber(live.gs ?? item.gs, 0, " kt")),
    aircraftFact("Baro. alt.", aircraftNumber(live.alt_baro ?? item.alt, 0, " ft")),
    aircraftFact("Geom. alt.", aircraftNumber(live.alt_geom, 0, " ft")),
    aircraftFact("Vert. rate", aircraftNumber(live.baro_rate ?? item.baro_rate, 0, " ft/min")),
    aircraftFact("Track", aircraftNumber(live.track ?? item.track, 1, "°")),
    aircraftFact("Pos.", `${Number(live.lat ?? item.lat).toFixed(3)}, ${Number(live.lon ?? item.lon).toFixed(3)}`),
    `<div class="ac-section">SIGNAL</div>`,
    aircraftFact("Source", live.type || item.src || ""),
    aircraftFact("RSSI", aircraftNumber(live.rssi, 1)),
    aircraftFact("Messages", live.messages == null ? "" : String(live.messages)),
    aircraftFact("Last pos.", aircraftNumber(live.seen_pos ?? item.seen_pos, 1, " s")),
    `<div class="ac-section">FMS SEL</div>`,
    aircraftFact("Sel. alt.", aircraftNumber(live.nav_altitude_mcp, 0, " ft")),
    aircraftFact("Sel. hdg.", aircraftNumber(live.nav_heading, 1, "°")),
  ];
  document.getElementById("ac-facts").innerHTML = facts.filter(Boolean).join("");
}

async function openAircraft(item) {
  if (state.openKind === "conflict") closeConflict();
  hideOutageCard();
  hideHungerCard();
  const request = ++aircraftRequest;
  document.getElementById("aircraft-card").hidden = false;
  document.getElementById("selected").hidden = true;
  renderAircraft(item, null);
  const hex = String(item.hex || "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return;
  const params = new URLSearchParams();
  if (item.name) params.set("callsign", String(item.name).trim());
  if (item.lat != null) params.set("lat", String(item.lat));
  if (item.lon != null) params.set("lon", String(item.lon));
  if (item.t) params.set("type", String(item.t));
  try {
    const detail = await fetch(`/api/aircraft/${hex}?${params}`).then((response) => response.json());
    if (request !== aircraftRequest) return;
    renderAircraft(item, detail);
  } catch (error) {
    if (request === aircraftRequest) renderAircraft(item, null);
  }
}

function statusLive(error) {
  const jam = state.live.jamming.points.length;
  const airPoints = state.live.aircraft.points;
  const airNames = { mil: "MILITARY", airliner: "AIRLINERS", heli: "HELICOPTERS", ground: "GROUND" };
  const air = state.airFilter === "all"
    ? `LIVE AIR TRAFFIC ${airPoints.length}`
    : `LIVE AIR TRAFFIC ${aircraftVisibleCount(airPoints)} ${airNames[state.airFilter] || ""}`.trim();
  const shipPoints = state.live.ships.points;
  const shipNames = {
    underway: "UNDERWAY",
    stopped: "STOPPED",
    fast: "FAST",
    cargo: "CARGO",
    tanker: "TANKER",
    passenger: "PASSENGER",
    fishing: "FISHING",
  };
  const shipPick = shipDrawList(shipPoints);
  const shipLabel = shipNames[state.shipFilter] || "";
  const ships = !state.layers.ships && !shipPoints.length
    ? "MARITIME TRAFFIC"
    : shipPick.matched > shipPick.draw.length
      ? `MARITIME TRAFFIC ${shipPick.draw.length} OF ${shipPick.matched} ${shipLabel}`.trim()
      : `MARITIME TRAFFIC ${shipPick.draw.length} ${shipLabel}`.trim();
  const war = state.conflictsReady ? `CONFLICT TRACKER ${state.conflicts.length}` : "CONFLICT TRACKER …";
  const parts = [
    state.outagePoints.length
      ? `POWER OUTAGES ${state.outagePoints.length} COUNTIES · ${outageCustomers(state.outageMeta && state.outageMeta.customers)}`
      : "POWER OUTAGES",
    `${state.streamPoints.length} SCANNERS`,
    `JAMMED GPS SIGNALS ${jam}`,
    air,
    ships,
    war,
    state.live.disease.points.length
      ? `DISEASE OUTBREAK ${state.live.disease.points.length}`
      : "DISEASE OUTBREAK",
    state.live.animal.points.length
      ? `ANIMAL DISEASE OUTBREAK ${state.live.animal.points.length}`
      : "ANIMAL DISEASE OUTBREAK",
    state.amfmReady
      ? `AM FM TOWERS ${amfmVisibleCount(state.live.amfm.points)}`
      : "AM FM TOWERS",
    state.live.designations.points.length
      ? `DESIGNATIONS ${state.live.designations.points.length}`
      : "DESIGNATIONS",
    state.live.violence.points.length
      ? `ATTRIBUTED VIOLENCE ${state.live.violence.points.length}`
      : "ATTRIBUTED VIOLENCE",
    state.layers.nuke ? `NUCLEAR ${state.nuke.shots.length}` : "NUCLEAR",
    state.live.quakes.points.length
      ? `QUAKES ${state.live.quakes.points.length}`
      : "QUAKES",
    state.layers.streets3d ? `STREETS 3D ${state.live.streets3d.points.length}` : "STREETS 3D",
  ];
  if (error) parts.push(error);
  setStatus(parts.join(" · "));
}

function currentYieldKt() {
  const presets = (window.GsaBlast && window.GsaBlast.KT_PRESETS) || [15, 100, 300, 1000, 5000];
  return presets[state.nuke.yieldIdx] || 15;
}

function bindNukeHud() {
  const yieldEl = document.getElementById("nuke-yield");
  const burst = document.getElementById("nuke-burst");
  if (yieldEl) {
    yieldEl.addEventListener("input", () => {
      state.nuke.yieldIdx = Number(yieldEl.value) || 0;
      syncNukeHud();
    });
  }
  if (burst) {
    burst.addEventListener("click", () => {
      state.nuke.airburst = !state.nuke.airburst;
      burst.textContent = state.nuke.airburst ? "AIR" : "GROUND";
      burst.setAttribute("aria-pressed", state.nuke.airburst ? "true" : "false");
      syncNukeHud();
    });
  }
}

function syncNukeHud() {
  const kt = currentYieldKt();
  const label = document.getElementById("nuke-yield-label");
  if (label) label.textContent = `${kt} kt`;
  const level = (window.GsaBlast && window.GsaBlast.defcon(state.nuke.shots)) || 5;
  const lamp = document.getElementById("defcon-lamp");
  const strong = document.getElementById("defcon-level");
  if (lamp) lamp.dataset.defcon = String(level);
  if (strong) strong.textContent = String(level);
  setCount("nuke", state.nuke.shots.length);
  const last = state.nuke.shots[state.nuke.shots.length - 1];
  const card = document.getElementById("nuke-card");
  if (card) {
    if (last && window.GsaBlast) {
      card.hidden = false;
      card.textContent = window.GsaBlast.card(last);
    } else {
      card.hidden = true;
    }
  }
}

function placeNukeAt(position) {
  const viewer = state.viewer;
  if (!viewer || !window.GsaBlast) return false;
  const cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return false;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  const shot = {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    yieldKt: currentYieldKt(),
    airburst: state.nuke.airburst,
  };
  state.nuke.shots.push(shot);
  drawNukeShot(shot);
  syncNukeHud();
  pingBlastApi(shot);
  statusLive();
  return true;
}

// Rings are computed in the browser (blast.js). The Rust server's /api/blast is
// only a parity check, so it is probed once and never sent the tap location.
// PHP hosting has no such route: one probe 404, then silence.
let blastApiState = "unknown"; // unknown | probing | yes | no

function pingBlastApi(shot) {
  const query = `kt=${encodeURIComponent(shot.yieldKt)}&air=${shot.airburst ? 1 : 0}`;
  if (blastApiState === "no" || blastApiState === "probing") return;
  if (blastApiState === "yes") {
    fetch(`/api/blast?${query}`).catch(() => {});
    return;
  }
  blastApiState = "probing";
  fetch(`/api/blast?${query}`)
    .then((response) => {
      const type = response.headers.get("content-type") || "";
      blastApiState = response.ok && type.includes("json") ? "yes" : "no";
    })
    .catch(() => {
      blastApiState = "no";
    });
}

function drawNukeShot(shot) {
  const source = state.live.nuke.source;
  if (!source) return;
  const rings = window.GsaBlast.rings(shot.yieldKt, shot.airburst);
  const center = Cesium.Cartesian3.fromDegrees(shot.lon, shot.lat);
  const bands = [
    { m: rings.fireballM, color: "#ffdc50", name: "FIREBALL" },
    { m: rings.heavyM, color: "#dc281e", name: "HEAVY" },
    { m: rings.mediumM, color: "#e67828", name: "MEDIUM" },
    { m: rings.lightM, color: "#50b45a", name: "LIGHT" },
    { m: rings.thermalM, color: "#ffa03c", name: "THERMAL" },
  ];
  if (rings.falloutM) bands.push({ m: rings.falloutM, color: "#c8f54c", name: "FALLOUT" });
  source.entities.add({
    position: center,
    point: { pixelSize: 10, color: Cesium.Color.fromCssColorString("#7cff6b"), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
    label: {
      text: `${shot.yieldKt} kt`,
      font: "12px IBM Plex Mono, monospace",
      fillColor: Cesium.Color.fromCssColorString("#9aff8a"),
      pixelOffset: new Cesium.Cartesian2(0, -16),
    },
  });
  for (const band of bands) {
    source.entities.add({
      position: center,
      ellipse: {
        semiMinorAxis: band.m,
        semiMajorAxis: band.m,
        material: Cesium.Color.fromCssColorString(band.color).withAlpha(0.12),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(band.color).withAlpha(0.85),
        height: 0,
      },
      name: band.name,
    });
  }
  source.show = true;
}

// OSM Buildings: one z15 tile around the camera. Debounced, cached per tile,
// and skipped when the camera stays on the tile already drawn, so panning does
// not hammer the free anonymous endpoint.
const STREETS3D_DEBOUNCE_MS = 600;
const STREETS3D_CACHE_MAX = 32;
const streets3dCache = new Map(); // "z/x/y" -> features (LRU by insertion order)
const streets3dInflight = new Map(); // "z/x/y" -> Promise<features>
let streets3dTimer = null;
let streets3dShownKey = "";

function scheduleStreets3d() {
  if (streets3dTimer) clearTimeout(streets3dTimer);
  streets3dTimer = setTimeout(() => {
    streets3dTimer = null;
    loadStreets3d().catch(() => {});
  }, STREETS3D_DEBOUNCE_MS);
}

function streets3dTileKey(lon, lat, z) {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)));
  return `${z}/${x}/${y}`;
}

async function streets3dFeatures(key) {
  if (streets3dCache.has(key)) {
    const hit = streets3dCache.get(key);
    streets3dCache.delete(key);
    streets3dCache.set(key, hit);
    return hit;
  }
  if (streets3dInflight.has(key)) return streets3dInflight.get(key);
  const request = (async () => {
    const response = await fetch(`https://a.data.osmbuildings.org/0.2/anonymous/tile/${key}.json`);
    if (!response.ok) throw new Error("OSM buildings unavailable");
    const body = await response.json();
    const features = Array.isArray(body.features) ? body.features : [];
    streets3dCache.set(key, features);
    while (streets3dCache.size > STREETS3D_CACHE_MAX) {
      streets3dCache.delete(streets3dCache.keys().next().value);
    }
    return features;
  })();
  streets3dInflight.set(key, request);
  try {
    return await request;
  } finally {
    streets3dInflight.delete(key);
  }
}

async function loadStreets3d() {
  const viewer = state.viewer;
  const source = state.live.streets3d.source;
  if (!viewer || !source) return;
  const height = viewer.camera.positionCartographic.height;
  if (height > 4000) {
    setCount("streets3d", source.entities.values.length);
    return;
  }
  const center = viewer.camera.positionCartographic;
  const key = streets3dTileKey(Cesium.Math.toDegrees(center.longitude), Cesium.Math.toDegrees(center.latitude), 15);
  if (key === streets3dShownKey && source.entities.values.length) return;
  const features = await streets3dFeatures(key);
  if (!state.layers.streets3d) return;
  source.entities.removeAll();
  let count = 0;
  for (const feature of features.slice(0, 400)) {
    const geom = feature.geometry;
    if (!geom || geom.type !== "Polygon" || !geom.coordinates) continue;
    const ring = geom.coordinates[0];
    if (!ring || ring.length < 3) continue;
    const heights = Number(feature.properties && (feature.properties.height || feature.properties.levels * 3)) || 12;
    const hierarchy = ring.map((pair) => Cesium.Cartesian3.fromDegrees(pair[0], pair[1]));
    source.entities.add({
      polygon: {
        hierarchy,
        // Sit on the terrain instead of the ellipsoid so buildings are not buried
        // when elevation terrain is on. Outlines are unsupported on terrain.
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: heights,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        material: Cesium.Color.fromCssColorString("#c4a574").withAlpha(0.85),
      },
    });
    count += 1;
  }
  streets3dShownKey = key;
  state.live.streets3d.points = new Array(count);
  source.show = true;
  setCount("streets3d", count);
}

boot().catch((error) => setStatus(error.message || String(error)));
