const state = {
  results: [],
  running: false,
  total: 0,
  done: 0,
  up: 0,
  down: 0,
  startedAt: 0,
  heading: "",
  filter: "all",
  selected: null,
  viewer: null,
  points: new Map(),
  arcs: new Map(),
  origin: null,
  outageSource: null,
  ukOutSource: null,
  caOutSource: null,
  auOutSource: null,
  hungerSource: null,
  streamSource: null,
  conflictSource: null,
  highlightSource: null,
  countryIndex: null,
  scanSource: null,
  mapReady: false,
  gridTester: false,
  catalogSearches: [],
  outagePoints: [],
  outageMeta: null,
  regionOut: {
    ukout: { api: "/api/outages-uk", points: [], meta: null },
    caout: { api: "/api/outages-ca", points: [], meta: null },
    auout: { api: "/api/outages-au", points: [], meta: null },
  },
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
    effects: { source: null, points: [] },
    quakes: { source: null, points: [] },
    sats: { source: null, points: [] },
    // SPACE & WEATHER (spaceweather.js). radar and aurora draw imagery, not pins.
    iss: { source: null, points: [] },
    volcanoes: { source: null, points: [] },
    disasters: { source: null, points: [] },
    radar: { source: null, points: [] },
    nwsalerts: { source: null, points: [] },
    aurora: { source: null, points: [] },
    hurricanes: { source: null, points: [] },
    wildfires: { source: null, points: [] },
    rivers: { source: null, points: [] },
    coastal: { source: null, points: [] },
    tsunami: { source: null, points: [] },
  },
  layers: {
    outages: false,
    ukout: false,
    caout: false,
    auout: false,
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
    effects: false,
    quakes: false,
    daynight: false,
    sats: false,
    iss: false,
    volcanoes: false,
    disasters: false,
    radar: false,
    nwsalerts: false,
    aurora: false,
    hurricanes: false,
    wildfires: false,
    rivers: false,
    coastal: false,
    tsunami: false,
    // INFRASTRUCTURE (infra.js): static point layers.
    airports: false,
    bases: false,
    // USA CELL TOWERS (infra.js): FCC tower records, point primitives in tiles.
    celltowers: false,
    // GLOBAL POWER PLANTS (infra.js): WRI + EIA plants, point primitives in tiles.
    powerplants: false,
    // EMERGENCY SERVICES (infra.js): USGS police, sheriff and fire / EMS stations, point primitives in tiles.
    police: false,
    sheriff: false,
    fire: false,
    hospitals: false,
    // USA POWER LINES (powerlines.js): HIFLD transmission lines, batched polylines.
    powerlines: false,
    // FIREARMS (firearms.js): saved static pin layers, not a live feed.
    gunsusa: false,
    gunsworld: false,
    // USA CONCEALED CARRY RECIPROCITY (ccw.js): saved state rules, colored by a chosen permit state.
    ccw: false,
    // INTERNET OUTAGES (internet.js): live IODA (Georgia Tech) outage pins.
    inetusa: false,
    inetglobal: false,
    // FAA TFR (tfr.js): live FAA temporary flight restriction areas.
    tfr: false,
    // FLIGHT DELAYS (delays.js): live FAA NAS Status airport delays.
    delays: false,
    // USA AIR QUALITY (airquality.js): live EPA AirNow monitors + NOAA HMS smoke.
    airquality: false,
    // MILITIAS (militias.js): saved static pin layers, not a live feed.
    militianational: false,
    militiastate: false,
    militialocal: false,
    militiainactive: false,
    // PARANORMAL (paranormal.js): UFO reports and Bigfoot sightings.
    ufo: false,
    bigfoot: false,
  },
  openKind: "",
  openId: "",
  openLayer: "",
  feedMode: "outages",
  airFilter: "all",
  aircraftFeed: [],
  militaryPoints: null,
  aircraftUpdated: null,
  aircraftSnapMs: 0,
  aircraftStale: false,
  shipFilter: "underway",
  amfmReady: false,
  trafficPane: "air",
  scanWanted: false,
  scanLive: false,
  replayGen: 0,
  replayTimer: 0,
  scanCheckedAt: 0,
};

// SPACE & WEATHER layer keys (spaceweather.js owns their data and timers).
const SPACE_KEYS = ["iss", "volcanoes", "disasters", "radar", "nwsalerts", "rivers", "coastal", "aurora", "tsunami", "hurricanes", "wildfires"];
// INFRASTRUCTURE layer keys (infra.js draws them as point primitives, not entities).
const INFRA_KEYS = ["airports", "bases", "celltowers", "powerplants", "police", "sheriff", "fire", "hospitals"];
const FIREARMS_KEYS = ["gunsusa", "gunsworld"];
const CCW_KEYS = ["ccw"];
const MILITIAS_KEYS = ["militianational", "militiastate", "militialocal", "militiainactive"];
const INTERNET_KEYS = ["inetusa", "inetglobal"];
const TFR_KEYS = ["tfr"];
const DELAYS_KEYS = ["delays"];
const AIRQUALITY_KEYS = ["airquality"];
const POWERLINES_KEYS = ["powerlines"];
const PARANORMAL_KEYS = ["ufo", "bigfoot"];

const COLORS = {
  up: Cesium.Color.fromCssColorString("#3dff9a"),
  down: Cesium.Color.fromCssColorString("#ff4d4d"),
  pending: Cesium.Color.fromCssColorString("#ffb020"),
};

// Blue hub pin and World Grid scan-line start. There is no default city:
// a pin appears only after a fresh per-visitor lookup (see locateStartup).
let visitorOrigin = null;
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

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.done === "1") return;
  if (!window.__bootLogDone) {
    window.setTimeout(dismissBootSplash, 200);
    return;
  }
  splash.dataset.done = "1";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  splash.classList.add("is-done");
  const remove = () => { if (splash.parentNode) splash.remove(); };
  if (reduce) remove();
  else {
    splash.addEventListener("transitionend", remove, { once: true });
    window.setTimeout(remove, 1000);
  }
}

async function boot() {
  try {
    const [catalog] = await Promise.all([
      fetch("/api/catalog").then((response) => response.json()),
      startGlobe(),
    ]);
    renderSearches(catalog);
    fillCountries(catalog.countries);
    hookUi();
    // LOCK & SCAN replays the server's scheduled pass (#34), so the page no
    // longer holds the /api/events stream open. connectEvents() is kept for
    // debugging a live pass.
    tickClock();
    setInterval(syncCheckedNote, 30000);
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
      if (!document.hidden) pollAircraft().catch((error) => statusLive(error.message || String(error)));
    }, 45000);
    setInterval(() => {
      if (!document.hidden) pollJamming().catch((error) => statusLive(error.message || String(error)));
    }, 60000);
    setInterval(tickAircraft, 1000);
    setInterval(() => {
      if (document.hidden) return;
      loadOutages().catch((error) => statusLive(error.message || String(error)));
      for (const key of ["ukout", "caout", "auout"]) {
        if (state.regionOut[key].meta) {
          loadRegionOutages(key).catch((error) => statusLive(error.message || String(error)));
        }
      }
    }, 600000);
  } catch (error) {
    const log = document.getElementById("boot-log");
    if (log && !log.querySelector("[data-boot-error]")) {
      const row = document.createElement("p");
      row.dataset.bootError = "1";
      row.textContent = "> THE GLOBE DID NOT OPEN. REFRESH THE PAGE.";
      log.appendChild(row);
    }
    throw error;
  }
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
    if (window.GsaSpaceWeather) window.GsaSpaceWeather.reapplyImagery();
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
  if (reopen) {
    reopen.classList.toggle("is-on", open);
    reopen.setAttribute("aria-pressed", open ? "true" : "false");
    reopen.setAttribute("aria-label", open ? "Close view" : "View");
  }
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
  const menuBtn = document.getElementById("open-menu");
  const listBtn = document.getElementById("open-list");
  if (menuBtn) menuBtn.classList.toggle("is-on", openMenu);
  if (listBtn) listBtn.classList.toggle("is-on", openList);
}

async function startGlobe() {
  let startupMap = "streets";
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
    // Address search: Cesium's own Geocoder widget with a Mapbox service (geocoder.js).
    geocoder: window.GsaSearch ? window.GsaSearch.viewerOption() : false,
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
  if (window.GsaSearch) window.GsaSearch.attach(viewer);
  state.basemap = startupMap;
  tuneQuality(startupMap);
  const basemapSelect = document.getElementById("basemap");
  if (basemapSelect) basemapSelect.value = startupMap;
  state.outageSource = new Cesium.CustomDataSource("outages");
  state.ukOutSource = new Cesium.CustomDataSource("ukout");
  state.caOutSource = new Cesium.CustomDataSource("caout");
  state.auOutSource = new Cesium.CustomDataSource("auout");
  state.hungerSource = new Cesium.CustomDataSource("hunger");
  state.streamSource = new Cesium.CustomDataSource("hpdb-streams");
  state.conflictSource = new Cesium.CustomDataSource("conflicts");
  state.scanSource = new Cesium.CustomDataSource("scan");
  state.scanSource.show = true;
  viewer.dataSources.add(state.outageSource);
  viewer.dataSources.add(state.ukOutSource);
  viewer.dataSources.add(state.caOutSource);
  viewer.dataSources.add(state.auOutSource);
  viewer.dataSources.add(state.hungerSource);
  viewer.dataSources.add(state.streamSource);
  viewer.dataSources.add(state.conflictSource);
  viewer.dataSources.add(state.scanSource);
  viewer.camera.changed.addEventListener(refreshPhoneArcs);
  for (const key of ["jamming", "aircraft", "ships", "mesh", "disease", "animal", "amfm", "effects", "quakes", "sats", ...SPACE_KEYS]) {
    state.live[key].source = new Cesium.CustomDataSource(key);
    viewer.dataSources.add(state.live[key].source);
  }
  viewer.scene.preRender.addEventListener(cullAircraftHorizon);
  viewer.scene.preRender.addEventListener(keepFlatMapIntact);
  viewer.scene.preRender.addEventListener(placeCreditBehindGlobe);
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
  // EARTHQUAKES: USGS updates the feed every minute.
  setInterval(() => {
    if (state.layers.quakes && !document.hidden) loadQuakes({ force: true }).catch((error) => statusLive(error.message || String(error)));
  }, (window.GsaQuakes && window.GsaQuakes.POLL_MS) || 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (state.layers.quakes) scheduleQuakes();
    if (state.layers.aircraft) {
      tickAircraft();
      pollAircraft().catch((error) => statusLive(error.message || String(error)));
    }
  });
  if (window.GsaSpaceWeather) {
    window.GsaSpaceWeather.init({
      viewer: () => state.viewer,
      sourceFor: (key) => state.live[key] && state.live[key].source,
      setCount,
      statusLive: () => statusLive(),
      showLive,
    });
  }
  if (window.GsaInfra) {
    window.GsaInfra.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaFirearms) {
    window.GsaFirearms.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaCcw) {
    window.GsaCcw.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaInternet) {
    window.GsaInternet.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaDelays) {
    window.GsaDelays.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaAirQuality) {
    window.GsaAirQuality.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaTfr) {
    window.GsaTfr.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaMilitias) {
    window.GsaMilitias.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaPowerLines) {
    window.GsaPowerLines.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  if (window.GsaParanormal) {
    window.GsaParanormal.init({
      viewer: () => state.viewer,
      setCount,
      statusLive: () => statusLive(),
    });
  }
  for (const key of Object.keys(state.layers)) setLayer(key, state.layers[key]);
  state.mapReady = true;
  viewer.camera.setView({
    destination: Cesium.Rectangle.fromDegrees(-168, -48, 150, 72),
  });
  // First launch view picker (welcome.js): turns on preset layers and flies the camera.
  if (window.GsaWelcome) {
    window.GsaWelcome.init({
      viewer: () => state.viewer,
      setLayer,
      phone: phoneLayout,
      setBasemap: (id) => applyBasemap(id),
      closePanels: () => setPanel(""),
      openGridTester,
      syncGridTester: syncGridTesterButton,
      syncLayers: syncLayersButton,
    });
  }
  initEarthSpin(viewer);
  dismissBootSplash();
  // Do not pin a hardcoded city. Place the blue hub only after a fresh lookup.
  if (window.GsaSearch && window.GsaSearch.locateStartup) {
    window.GsaSearch.locateStartup().then((info) => {
      if (info) setVisitorOrigin(info);
    });
  }
  // A second handler, so Cesium can still select a pin. Empty ground is not a pin.
  // Cesium then inserts a temporary imagery entity; that is not a layer pin either.
  const popupClicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  popupClicks.setInputAction((click) => {
    const infraHit = window.GsaInfra && window.GsaInfra.pick(click.position);
    if (infraHit) {
      if (viewer.selectedEntity) viewer.selectedEntity = undefined;
      closeMapPopups();
      showLive(infraHit);
      return;
    }
    // USA POWER LINES: a line under the tap opens the shared card (details load on first click).
    const powerHit = window.GsaPowerLines && window.GsaPowerLines.pick(click.position);
    if (powerHit) {
      if (viewer.selectedEntity) viewer.selectedEntity = undefined;
      closeMapPopups();
      window.GsaPowerLines.open(powerHit, showLive);
      return;
    }
    const paranormalHit = window.GsaParanormal && window.GsaParanormal.pick(click.position);
    if (paranormalHit) {
      if (viewer.selectedEntity) viewer.selectedEntity = undefined;
      closeMapPopups();
      showLive(paranormalHit);
      return;
    }
    if (pickedMapPin(click.position)) return;
    if (state.layers.effects && window.GsaEffectsRadius && window.GsaEffectsRadius.handleClick(click.position)) return;
    closeMapPopups();
    if (viewer.selectedEntity) viewer.selectedEntity = undefined;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  bindEffectsHud();
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
  fillGridTester(catalog);
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

function syncLayersButton() {
  const arrow = document.getElementById("open-menu");
  if (arrow) {
    arrow.classList.remove("is-on");
    arrow.setAttribute("aria-pressed", "false");
    arrow.setAttribute("aria-label", "Reset map");
  }
  const btn = document.getElementById("open-categories");
  if (!btn) return;
  btn.setAttribute("aria-label", "Layers");
  const on = Boolean(window.GsaWelcome && window.GsaWelcome.isOpen && window.GsaWelcome.isOpen());
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function syncGridTesterButton() {
  const btn = document.getElementById("open-grid-tester");
  if (!btn) return;
  const welcome = document.getElementById("welcome");
  const grid = document.getElementById("grid-tester");
  const overlayOpen = Boolean(welcome && !welcome.hidden);
  const gridOpen = Boolean(grid && !grid.hidden && overlayOpen);
  btn.hidden = !state.gridTester || gridOpen || overlayOpen;
}

function openGridTester() {
  const welcome = document.getElementById("welcome");
  const grid = document.getElementById("grid-tester");
  const home = welcome && welcome.querySelector("[data-welcome-home]");
  if (!welcome || !grid) return;
  if (window.GsaWelcome && window.GsaWelcome.releaseCamera) window.GsaWelcome.releaseCamera();
  if (home) home.hidden = true;
  grid.hidden = false;
  welcome.hidden = false;
  welcome.setAttribute("aria-labelledby", "grid-tester-title");
  document.documentElement.classList.remove("welcome-pending");
  document.body.classList.add("welcome-open");
  state.gridTester = true;
  grid.scrollTop = 0;
  syncGridTesterButton();
}

function fillGridTester(catalog) {
  const list = document.getElementById("grid-tester-list");
  if (!list || !catalog) return;
  state.catalogSearches = catalog.searches || [];
  const icon = '<span class="welcome-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><circle cx="12" cy="6.4" r="3.5"/><path d="M12 3.1v6.6M9.1 5.1h5.8M9.4 7.7h5.2M12 9.9v2M4.2 11.9h15.6M4.2 11.9v1.8M12 11.9v1.8M19.8 11.9v1.8M2.2 18.5h4.6M9.7 18.5h4.6M17.2 18.5h4.6"/><rect x="2.2" y="14.3" width="4.6" height="3.4" rx="0.7"/><rect x="9.7" y="14.3" width="4.6" height="3.4" rx="0.7"/><rect x="17.2" y="14.3" width="4.6" height="3.4" rx="0.7"/></svg></span>';
  const row = (item) => `<button type="button" class="welcome-row" data-grid-test="${esc(item.id)}">${icon}<span class="welcome-text"><strong>${esc(item.label)}</strong></span><span class="welcome-arrow" aria-hidden="true">→</span></button>`;
  const global = state.catalogSearches.filter((item) => item.group === "global");
  const us = state.catalogSearches.filter((item) => item.group === "us");
  list.innerHTML = `<p class="welcome-section">GLOBAL</p>${global.map(row).join("")}<p class="welcome-section">UNITED STATES</p>${us.map(row).join("")}`;
  if (list.dataset.bound === "1") return;
  list.dataset.bound = "1";
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grid-test]");
    if (!button) return;
    for (const el of list.querySelectorAll("[data-grid-test]")) el.classList.toggle("is-primary", el === button);
    startScan(button.dataset.gridTest);
  });
}

function fillCountries(list) {
  const select = document.getElementById("country");
  const options = [`<option value="">Choose a Country</option>`];
  for (const name of list) options.push(`<option value="${esc(name)}">${esc(name)}</option>`);
  select.innerHTML = options.join("");
  syncUsTests();
}

function bindEffectsHud() {
  if (window.GsaEffectsRadius && state.viewer) {
    window.GsaEffectsRadius.bind({
      viewer: state.viewer,
      source: state.live.effects && state.live.effects.source,
      setCount,
      statusLive,
    });
  }
}

// ROTATE EARTH button: a slow continuous spin the visitor turns on and off.
// Any touch, click, drag or wheel on the globe, any camera flight, or the welcome
// picker stops it. Reduced motion is respected by default, but a press of this
// button is an explicit request, so it still spins (at the same gentle pace).
const earthSpin = { on: false, frame: 0, last: 0, viewer: null };

function earthSpinRate(camera) {
  // Degrees per second: one turn a minute from far out, slower as the camera nears the ground.
  const h = camera.positionCartographic ? camera.positionCartographic.height : 2e7;
  return Math.max(0.05, Math.min(6, (6 * h) / 6.0e6));
}

function earthSpinStep(now) {
  if (!earthSpin.on) return;
  const v = earthSpin.viewer;
  const b = document.body.classList;
  if (!v || b.contains("welcome-open") || b.contains("welcome-intro") || b.contains("welcome-spin")) {
    stopEarthSpin();
    return;
  }
  if (earthSpin.last) {
    const dt = Math.min(0.1, (now - earthSpin.last) / 1000);
    const cam = v.camera;
    if (!Cesium.Matrix4.equals(cam.transform, Cesium.Matrix4.IDENTITY)) cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
    cam.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(earthSpinRate(cam) * dt));
    if (v.scene.requestRender) v.scene.requestRender();
  }
  earthSpin.last = now;
  earthSpin.frame = requestAnimationFrame(earthSpinStep);
}

function paintEarthSpin() {
  const btn = document.getElementById("earth-spin");
  if (!btn) return;
  btn.setAttribute("aria-pressed", earthSpin.on ? "true" : "false");
  btn.setAttribute("aria-label", earthSpin.on ? "Stop rotating Earth" : "Rotate Earth");
  btn.title = earthSpin.on ? "Stop rotating Earth" : "Rotate Earth";
}

function startEarthSpin() {
  const v = earthSpin.viewer;
  if (!v || earthSpin.on) return;
  if (window.GsaWelcome && window.GsaWelcome.stopSpin) window.GsaWelcome.stopSpin();
  v.camera.cancelFlight();
  earthSpin.on = true;
  earthSpin.last = 0;
  earthSpin.frame = requestAnimationFrame(earthSpinStep);
  paintEarthSpin();
}

function stopEarthSpin() {
  if (earthSpin.frame) cancelAnimationFrame(earthSpin.frame);
  earthSpin.frame = 0;
  earthSpin.last = 0;
  if (!earthSpin.on) return;
  earthSpin.on = false;
  paintEarthSpin();
}

function initEarthSpin(viewer) {
  earthSpin.viewer = viewer;
  const btn = document.getElementById("earth-spin");
  if (btn) btn.addEventListener("click", () => (earthSpin.on ? stopEarthSpin() : startEarthSpin()));
  const canvas = viewer.scene && viewer.scene.canvas;
  if (canvas) {
    ["pointerdown", "mousedown", "touchstart", "wheel"].forEach((type) => {
      canvas.addEventListener(type, stopEarthSpin, { capture: true, passive: true });
    });
  }
  window.addEventListener("keydown", (event) => {
    if (/^Arrow|^[+\-=wasdqe]$/i.test(event.key) && event.target === document.body) stopEarthSpin();
  });
  // Every flight (presets, search, pins, welcome) goes through camera.flyTo; stop the spin first.
  const cam = viewer.camera;
  const flyTo = cam.flyTo.bind(cam);
  cam.flyTo = (options) => {
    stopEarthSpin();
    return flyTo(options);
  };
  window.GsaEarthSpin = { start: startEarthSpin, stop: stopEarthSpin, isOn: () => earthSpin.on };
}

function hookUi() {
  document.getElementById("btn-stop").addEventListener("click", stopReplay);
  document.getElementById("btn-reset").addEventListener("click", resetMap);
  document.getElementById("reset-mobile").addEventListener("click", resetMap);
  document.getElementById("close-view").addEventListener("click", () => setViewOpen(false));
  document.getElementById("open-view").addEventListener("click", () => {
    const panel = document.getElementById("view-settings");
    setViewOpen(panel.classList.contains("is-closed"));
  });
  const openGrid = document.getElementById("open-grid-tester");
  if (openGrid) openGrid.addEventListener("click", openGridTester);
  document.getElementById("open-grid-results").addEventListener("click", () => setGridResultsOpen(true));
  document.getElementById("close-grid-results").addEventListener("click", () => setGridResultsOpen(false));
  hookServiceWorker();
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
      closeMapPopups();
      setPanel("");
    }
  });
  document.getElementById("selected-close").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMapPopups();
    if (state.viewer && state.viewer.selectedEntity) state.viewer.selectedEntity = undefined;
  });
  document.getElementById("effects-hud-close").addEventListener("click", () => {
    if (window.GsaEffectsRadius && window.GsaEffectsRadius.hideHud) window.GsaEffectsRadius.hideHud();
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
  document.getElementById("open-menu").addEventListener("click", resetMap);
  document.getElementById("open-categories").addEventListener("click", () => {
    setPanel("");
    if (!window.GsaWelcome) return;
    const dock = !phoneLayout();
    const welcome = document.getElementById("welcome");
    const docked = Boolean(welcome && welcome.classList.contains("is-docked"));
    if (window.GsaWelcome.isOpen()) {
      if (dock && !docked) {
        window.GsaWelcome.open({ spin: false, noFocus: true, dock: true });
        return;
      }
      window.GsaWelcome.close();
      return;
    }
    window.GsaWelcome.open({ spin: false, dock: dock });
  });
  document.getElementById("open-list").addEventListener("click", () => {
    const open = document.querySelector(".feed-col").classList.contains("is-open");
    setPanel(open ? "" : "list");
  });
  document.getElementById("panel-backdrop").addEventListener("click", () => setPanel(""));
  window.addEventListener("resize", () => {
    tuneQuality(state.basemap || "natural");
    restyleArcs();
    syncGridTesterButton();
    syncLayersButton();
    if (!phoneLayout()) {
      setGridResultsOpen(false);
    } else syncGridResultsButton();
  });
  setupLegendScroll();
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
  noteScanView(id, country);
  state.scanWanted = true;
  let response;
  let body = {};
  try {
    response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, country: country || "" }),
    });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    response = { ok: false };
  }
  if (!response.ok) {
    state.scanWanted = false;
    state.scanLive = false;
    setStatus(body.error || "SCAN REFUSED");
    return;
  }
  if (body.pending || !body.state || !(body.state.results || []).some(Boolean)) {
    state.scanWanted = false;
    setStatus("GRID PASS IN PROGRESS · TRY AGAIN IN A FEW MINUTES");
    return;
  }
  replayScan(body.state);
}

// Server checks every site on a schedule; the page plays that pass back the
// way a live scan arrives: groups of 20, arcs and dots, counters and feed.
function replayPace(snap) {
  const pace = snap.pace || {};
  const realSize = Math.max(1, Number(pace.batchSize) || 20);
  const realMs = Number(pace.batchMs) || 0;
  // Time for 20 sites on the real pass, held to 660-800 ms so a full World
  // pass (1,344 sites, 68 groups) plays in about 45-55 s.
  const per20 = realMs ? (realMs * 20) / realSize : 760;
  return { size: 20, batchMs: Math.min(800, Math.max(660, per20)) };
}

function checkedAgo(at) {
  if (!at) return "";
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 90) return "CHECKED JUST NOW";
  const min = Math.round(sec / 60);
  if (min < 90) return `CHECKED ${min} MIN AGO`;
  const hr = Math.round(min / 60);
  return `CHECKED ${hr} HR AGO`;
}

function syncCheckedNote() {
  if (state.feedMode !== "returns") return;
  const title = document.getElementById("feed-title");
  if (!title) return;
  const note = !state.running && state.scanCheckedAt ? checkedAgo(state.scanCheckedAt) : "";
  title.textContent = note ? `LIVE RETURNS · ${note}` : "LIVE RETURNS";
  const bar = document.querySelector("#grid-results .grid-results-bar span");
  if (bar) bar.textContent = note ? `GRID RESULTS · ${note}` : "GRID RESULTS";
}

function stopReplay() {
  state.replayGen += 1;
  if (state.replayTimer) clearTimeout(state.replayTimer);
  state.replayTimer = 0;
  if (!state.running) return;
  state.running = false;
  state.scanWanted = false;
  document.getElementById("btn-stop").hidden = true;
  setStatus("SCAN ABORTED");
  renderFeed();
  updateHud();
  syncCheckedNote();
  syncGridResultsButton();
}

function replayScan(snap) {
  const results = (snap.results || []).filter(Boolean);
  const gen = ++state.replayGen;
  if (state.replayTimer) clearTimeout(state.replayTimer);
  // The server sends its own age so a wrong clock on this device doesn't matter.
  const ageSec = Number.isFinite(snap.ageSec) ? snap.ageSec : null;
  state.scanCheckedAt = ageSec === null ? 0 : Date.now() - ageSec * 1000;
  state.scanLive = true;
  clearPoints();
  state.results = [];
  state.running = true;
  state.total = results.length;
  state.done = 0;
  state.up = 0;
  state.down = 0;
  state.startedAt = Date.now();
  state.selected = null;
  paintHeading(snap.heading || "GRID");
  document.getElementById("btn-stop").hidden = false;
  if (state.scanSource) state.scanSource.show = true;
  setFeedMode("returns");
  document.getElementById("link-dot").className = "pulse-dot live";
  document.getElementById("selected").hidden = true;
  setStatus(`TASKING ${results.length} NODES · ${state.heading.toUpperCase()}`);
  renderFeed();
  updateHud();
  syncGridResultsButton();
  const { size, batchMs } = replayPace(snap);
  const groups = Math.ceil(results.length / size);
  // Each group gets a due time on the wall clock (with a +/- 25% wobble, as
  // real groups never finish on a metronome). A slow phone catches up instead
  // of stretching the run.
  const due = [];
  let at = batchMs * 0.6; // short "tasking" beat before the first group
  for (let g = 0; g < groups; g += 1) {
    due.push(at);
    at += batchMs * (0.75 + Math.random() * 0.5);
  }
  const t0 = performance.now();
  let i = 0;
  let g = 0;
  function step() {
    if (gen !== state.replayGen) return;
    const elapsed = performance.now() - t0;
    while (g < groups && due[g] <= elapsed) {
      const end = Math.min(results.length, i + size);
      for (; i < end; i += 1) {
        const result = results[i];
        result.index = result.index ?? i;
        state.results[result.index] = result;
        if (result.status === "up") state.up += 1;
        else state.down += 1;
        state.done = i + 1;
        upsertPoint(result);
        prependFeed(result);
      }
      g += 1;
    }
    updateHud();
    syncGridResultsButton();
    if (g < groups) {
      state.replayTimer = setTimeout(step, Math.max(0, due[g] - (performance.now() - t0)));
      return;
    }
    state.replayTimer = 0;
    state.running = false;
    document.getElementById("btn-stop").hidden = true;
    document.getElementById("link-dot").className = state.down ? "pulse-dot hot" : "pulse-dot live";
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    const note = checkedAgo(state.scanCheckedAt);
    setStatus(`COMPLETE · ${state.up} UP · ${state.down} DOWN · ${sec}s${note ? " · " + note : ""}`);
    updateHud();
    syncCheckedNote();
    syncGridResultsButton();
  }
  state.replayTimer = setTimeout(step, due[0] || 0);
}

function connectEvents() {
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
      state.selected = null;
      paintHeading(event.heading);
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
  paintHeading(snap.heading || state.heading);
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

function originLabel(info) {
  if (!info) return "";
  if (info.approx) return "Approximate, from your internet connection";
  return "Your exact location";
}

function setVisitorOrigin(info) {
  if (!info || !Number.isFinite(info.lat) || !Number.isFinite(info.lon)) return;
  if (Math.abs(info.lat) > 90 || Math.abs(info.lon) > 180 || (info.lat === 0 && info.lon === 0)) return;
  visitorOrigin = {
    lat: info.lat,
    lon: info.lon,
    exact: !info.approx,
    approx: !!info.approx,
    label: originLabel(info),
    name: info.name || "",
    service: info.service || "",
  };
  paintOrigin();
}

function paintOrigin() {
  if (!state.viewer || !visitorOrigin) return;
  const pos = Cesium.Cartesian3.fromDegrees(visitorOrigin.lon, visitorOrigin.lat, 0);
  const label = visitorOrigin.label;
  if (state.origin) {
    state.origin.position = pos;
    state.origin.name = label;
    state.origin.description = label;
    return;
  }
  state.origin = state.viewer.entities.add({
    name: label,
    description: label,
    position: pos,
    _gsaOrigin: true,
    point: {
      pixelSize: 8,
      color: Cesium.Color.fromCssColorString("#7ef6ff"),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

function ensureOrigin() {
  paintOrigin();
}

function arcPositions(lat, lon) {
  if (!visitorOrigin) return null;
  const start = Cesium.Cartesian3.fromDegrees(visitorOrigin.lon, visitorOrigin.lat, 0);
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

function arcStyle(color) {
  // Phone GPUs bake a glowing polyline into the screen. A solid color stays on the globe.
  if (phoneLayout()) return { width: 2.5, material: color, depthFail: color };
  const glow = arcMaterial(color);
  return { width: 4, material: glow, depthFail: arcMaterial(color) };
}

function applyArcStyle(entity) {
  if (!entity || !entity.polyline || !entity._arcColor) return;
  const style = arcStyle(entity._arcColor);
  entity.polyline.width = style.width;
  entity.polyline.material = style.material;
  entity.polyline.depthFailMaterial = style.depthFail;
  if (entity._arcPositions) entity.polyline.positions = entity._arcPositions.slice();
}

function restyleArcs() {
  for (const entity of state.arcs.values()) applyArcStyle(entity);
}

function refreshPhoneArcs() {
  if (!phoneLayout() || !state.arcs.size) return;
  for (const entity of state.arcs.values()) {
    if (!entity._arcPositions || !entity.polyline) continue;
    entity.polyline.positions = entity._arcPositions.slice();
  }
  if (state.viewer && state.viewer.scene.requestRender) state.viewer.scene.requestRender();
}

function upsertArc(result) {
  if (!state.viewer || !state.scanSource || result.lat == null || result.lon == null) return;
  state.scanSource.show = true;
  const positions = arcPositions(result.lat, result.lon);
  if (!positions) return;
  const color = COLORS[result.status] || COLORS.pending;
  const style = arcStyle(color);
  let entity = state.arcs.get(result.index);
  if (!entity) {
    entity = state.scanSource.entities.add({
      polyline: {
        positions: positions.slice(),
        width: style.width,
        material: style.material,
        depthFailMaterial: style.depthFail,
        arcType: Cesium.ArcType.NONE,
      },
    });
    entity._arcPositions = positions;
    entity._arcColor = color;
    state.arcs.set(result.index, entity);
    return;
  }
  entity._arcPositions = positions;
  entity._arcColor = color;
  applyArcStyle(entity);
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

function fillSelected(html) {
  const box = document.getElementById("selected");
  const body = document.getElementById("selected-body");
  if (!box) return;
  box.hidden = false;
  if (body) body.innerHTML = html;
  else box.innerHTML = html;
}

function showSelected(result) {
  state.selected = result;
  fillSelected(`<b>${esc(result.status.toUpperCase())}</b> ${esc(result.name)}<br>${esc(result.address)}${result.ip ? " · " + esc(result.ip) : ""}<br>${esc(result.location || result.country || "location pending")}<br>${result.ms || 0}ms · ${esc(result.method || "—")}`);
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

function paintHeading(text) {
  const heading = document.getElementById("heading");
  const value = String(text || "").trim();
  const idle = !value || value.toUpperCase() === "AWAITING TASKING";
  state.heading = idle ? "" : value;
  if (!heading) return;
  heading.textContent = idle ? "" : state.heading.toUpperCase();
  heading.hidden = idle;
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
  if (state.feedMode === "outages") title.textContent = `POWER OUTAGES ${outageListPoints().length}`;
  else if (state.feedMode === "hunger") title.textContent = `GLOBAL HUNGER ${state.hungerPoints.length}`;
  else if (state.feedMode === "stream") title.textContent = `SCANNERS ${state.streamPoints.length}`;
  else if (state.feedMode === "conflicts") title.textContent = `CONFLICT TRACKER ${state.conflicts.length}`;
  else title.textContent = "LIVE RETURNS";
  syncCheckedNote();
}

function sourceFor(layer) {
  if (layer === "outages") return state.outageSource;
  if (layer === "ukout") return state.ukOutSource;
  if (layer === "caout") return state.caOutSource;
  if (layer === "auout") return state.auOutSource;
  if (layer === "hunger") return state.hungerSource;
  if (layer === "conflicts") return state.conflictSource;
  if (layer === "stream") return state.streamSource;
  if (layer === "scan") return state.scanSource;
  if (state.live[layer]?.source) return state.live[layer].source;
  if (window.GsaCcw && window.GsaCcw.sourceFor) {
    const ccwSource = window.GsaCcw.sourceFor(layer);
    if (ccwSource) return ccwSource;
  }
  if (window.GsaFirearms && window.GsaFirearms.sourceFor) {
    const firearmsSource = window.GsaFirearms.sourceFor(layer);
    if (firearmsSource) return firearmsSource;
  }
  if (window.GsaMilitias && window.GsaMilitias.sourceFor) {
    const militiasSource = window.GsaMilitias.sourceFor(layer);
    if (militiasSource) return militiasSource;
  }
  if (window.GsaInternet && window.GsaInternet.sourceFor) {
    const internetSource = window.GsaInternet.sourceFor(layer);
    if (internetSource) return internetSource;
  }
  if (window.GsaTfr && window.GsaTfr.sourceFor) {
    const tfrSource = window.GsaTfr.sourceFor(layer);
    if (tfrSource) return tfrSource;
  }
  if (window.GsaDelays && window.GsaDelays.sourceFor) {
    const delaysSource = window.GsaDelays.sourceFor(layer);
    if (delaysSource) return delaysSource;
  }
  if (window.GsaAirQuality && window.GsaAirQuality.sourceFor) {
    const aqSource = window.GsaAirQuality.sourceFor(layer);
    if (aqSource) return aqSource;
  }
  return null;
}

function setCount(key, value) {
  const text = String(value);
  for (const el of document.querySelectorAll(`[data-count="${key}"]`)) el.textContent = text;
}

function resetMap() {
  stopEarthSpin();
  // Local view only. The scheduled server pass is never stopped from a page.
  stopReplay();
  state.scanCheckedAt = 0;
  state.running = false;
  state.scanWanted = false;
  state.scanLive = false;
  state.results = [];
  state.total = 0;
  state.done = 0;
  state.up = 0;
  state.down = 0;
  state.selected = null;
  paintHeading("");
  const stop = document.getElementById("btn-stop");
  if (stop) stop.hidden = true;
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
  // Keep the visitor hub pin if we already know this visitor's location.
  // It is not a map layer, and RESET should not fall back to a default city.
  if (state.viewer) state.viewer.selectedEntity = undefined;
  for (const key of Object.keys(state.layers)) setLayer(key, false);
  closeAircraft();
  closeConflict();
  hideOutageCard();
  hideHungerCard();
  closePin();
  if (window.GsaSearch) window.GsaSearch.clear();
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

// PWA: keep the service worker so the existing manifest still works offline
// on phones. The INSTALL MOBILE APP button and its help dialog were removed
// to give the map more vertical room.
function hookServiceWorker() {
  if (phoneLayout() && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

// MENU categories (<details class="layer-group">): each header shows how many
// of its own layers are switched on, e.g. "2 ON". Groups stay as the user
// left them (all start collapsed); only the count changes.
// nearby.js loads layers for an area check with nothing drawn and the switch still
// showing OFF: their keys sit in probeHidden until the check decides.
state.probeHidden = new Set();
function layerShown(key) {
  return Boolean(state.layers[key]) && !state.probeHidden.has(key);
}
window.gsProbeHidden = (key) => state.probeHidden.has(key);

function syncLayerGroups() {
  for (const group of document.querySelectorAll(".rail .layer-group")) {
    const el = group.querySelector(".layer-group-count");
    if (!el) continue;
    const n = group.querySelectorAll('[data-layer-toggle][aria-pressed="true"]').length;
    el.textContent = n ? `${n} ON` : "";
  }
}
window.gsSyncLayerGroups = syncLayerGroups;

function clearLayers() {
  closeMapPopups();
  if (state.viewer && state.viewer.selectedEntity) state.viewer.selectedEntity = undefined;
  for (const key of Object.keys(state.layers)) {
    if (state.layers[key]) setLayer(key, false);
  }
}

const VIEW_US = [-127, 22, -65, 51];
const VIEW_UK = [-9, 49.5, 2.5, 61];
const VIEW_CA = [-141, 41, -52, 72];
const VIEW_AU = [112, -44, 154, -10];
const VIEW_WORLD = [-168, -48, 150, 72];
const VIEW_NUKE = [-128, 18, -62, 54];
const VIEW_NUKE_PHONE = [-132, -8, -60, 56];
const US_LAYERS = new Set([
  "tfr", "delays", "nwsalerts", "rivers", "coastal", "outages", "inetusa", "stream",
  "celltowers", "powerlines", "police", "sheriff", "fire", "hospitals", "airquality",
  "gunsusa", "ccw", "militianational", "militiastate", "militialocal", "militiainactive",
  "bigfoot",
]);

function flyOverview(rect) {
  const viewer = state.viewer;
  if (!viewer || !rect || !window.Cesium) return;
  if (window.GsaWelcome && window.GsaWelcome.releaseCamera) window.GsaWelcome.releaseCamera();
  else viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(rect[0], rect[1], rect[2], rect[3]),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.6,
  });
}

function layerOverview(layer) {
  if (layer === "effects") return phoneLayout() ? VIEW_NUKE_PHONE : VIEW_NUKE;
  if (layer === "ukout") return VIEW_UK;
  if (layer === "caout") return VIEW_CA;
  if (layer === "auout") return VIEW_AU;
  if (US_LAYERS.has(layer)) return VIEW_US;
  return VIEW_WORLD;
}

function flyLayerOverview(layer) {
  flyOverview(layerOverview(layer));
}

function noteScanView(id, country) {
  state.gridTester = true;
  const key = String(id || "");
  const us = key === "united-states" || key.startsWith("us-") || country === "United States";
  flyOverview(us ? VIEW_US : VIEW_WORLD);
  const toggle = document.getElementById("grid-status");
  if (toggle && key && key !== "country") {
    toggle.dataset.scanId = key;
    const item = (state.catalogSearches || []).find((entry) => entry.id === key);
    if (item) toggle.textContent = item.label;
  }
  syncGridTesterButton();
}

function setLayer(layer, on, options) {
  if (!Object.prototype.hasOwnProperty.call(state.layers, layer)) return;
  const wasOn = Boolean(state.layers[layer]);
  const fly = !options || options.fly !== false;
  state.layers[layer] = Boolean(on);
  const source = sourceFor(layer);
  if (source) source.show = state.layers[layer];
  if (layer === "conflicts" && !state.layers.conflicts) closeConflict();
  if ((layer === "outages" || layer === "ukout" || layer === "caout" || layer === "auout") && !state.layers[layer]) {
    if (state.openKind === "outage" && (state.openLayer === layer || (layer === "outages" && !state.openLayer))) hideOutageCard();
  }
  if (layer === "hunger" && !state.layers.hunger) hideHungerCard();
  for (const button of document.querySelectorAll(`[data-layer-toggle="${layer}"]`)) {
    button.classList.toggle("on", layerShown(layer));
    button.setAttribute("aria-pressed", layerShown(layer) ? "true" : "false");
  }
  syncLayerGroups();
  const host = document.getElementById("cesium");
  if (host) {
    host.dataset.visibleLayers = Object.keys(state.layers).filter((key) => layerShown(key)).join(" ");
  }
  if (layer === "aircraft" || layer === "ships") {
    if (state.layers.aircraft && state.layers.ships && state.layers[layer]) {
      state.trafficPane = layer === "ships" ? "ships" : "air";
    }
    syncTrafficBars();
  }
  if (layer === "aircraft" && state.layers.aircraft) {
    tickAircraft();
    if (!state.aircraftFeed.length) pollAircraft().catch((error) => statusLive(error.message || String(error)));
  }
  if (layer === "jamming") {
    const jamCreditLine = document.querySelector(".jam-credit");
    if (jamCreditLine) jamCreditLine.hidden = !layerShown("jamming");
    if (state.layers.jamming && !(state.live.jamming.points || []).length) {
      pollJamming().catch((error) => statusLive(error.message || String(error)));
    }
  }
  if (layer === "ships" && state.layers.ships) scheduleShips();
  if (layer === "mesh" && state.layers.mesh) scheduleMesh();
  if (layer === "disease" && state.layers.disease) scheduleDisease();
  if (layer === "animal" && state.layers.animal) scheduleAnimal();
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
  if (layer === "effects") {
    if (window.GsaEffectsRadius) window.GsaEffectsRadius.setActive(state.layers.effects);
  }
  if (layer === "quakes" && state.layers.quakes) scheduleQuakes();
  if (layer === "daynight") applyDayNight(state.layers.daynight);
  if (layer === "sats") {
    if (state.layers.sats) startSats();
    else stopSats();
  }
  if (SPACE_KEYS.includes(layer) && window.GsaSpaceWeather) {
    window.GsaSpaceWeather.setActive(layer, state.layers[layer]);
  }
  if (INFRA_KEYS.includes(layer) && window.GsaInfra) {
    window.GsaInfra.setActive(layer, state.layers[layer]);
  }
  if (FIREARMS_KEYS.includes(layer) && window.GsaFirearms) {
    window.GsaFirearms.setActive(layer, state.layers[layer]);
  }
  if (CCW_KEYS.includes(layer) && window.GsaCcw) {
    window.GsaCcw.setActive(layer, state.layers[layer]);
  }
  if (MILITIAS_KEYS.includes(layer) && window.GsaMilitias) {
    window.GsaMilitias.setActive(layer, state.layers[layer]);
  }
  if (INTERNET_KEYS.includes(layer) && window.GsaInternet) {
    window.GsaInternet.setActive(layer, state.layers[layer]);
  }
  if (TFR_KEYS.includes(layer) && window.GsaTfr) {
    window.GsaTfr.setActive(layer, state.layers[layer]);
  }
  if (DELAYS_KEYS.includes(layer) && window.GsaDelays) {
    window.GsaDelays.setActive(layer, state.layers[layer]);
  }
  if (AIRQUALITY_KEYS.includes(layer) && window.GsaAirQuality) {
    window.GsaAirQuality.setActive(layer, state.layers[layer]);
  }
  if (POWERLINES_KEYS.includes(layer) && window.GsaPowerLines) {
    window.GsaPowerLines.setActive(layer, state.layers[layer]);
  }
  if (PARANORMAL_KEYS.includes(layer) && window.GsaParanormal) {
    window.GsaParanormal.setActive(layer, state.layers[layer]);
  }
  if ((layer === "quakes" || layer === "sats") && window.GsaSpaceWeather && window.GsaSpaceWeather.renderGroupCount) {
    window.GsaSpaceWeather.renderGroupCount();
  }
  if ((layer === "quakes" || layer === "sats" || SPACE_KEYS.includes(layer)) && !state.layers[layer]) {
    const selected = state.viewer && state.viewer.selectedEntity;
    if (selected && selected._live && selected._live.layer === layer) {
      state.viewer.selectedEntity = undefined;
      const box = document.getElementById("selected");
      if (box) box.hidden = true;
    }
  }
  if (layer === "outages" && state.layers.outages && !state.outageMeta) {
    loadOutages().catch((error) => statusLive(error.message || String(error)));
  }
  if ((layer === "ukout" || layer === "caout" || layer === "auout") && state.layers[layer] && !state.regionOut[layer].meta) {
    loadRegionOutages(layer).catch((error) => statusLive(error.message || String(error)));
  }
  if (layer === "ukout" || layer === "caout" || layer === "auout") paintRegionOutageNote(layer);
  if (layer === "hunger" && state.layers.hunger && !state.hungerMeta) {
    loadHunger().catch((error) => statusLive(error.message || String(error)));
  }
  syncMobilePick(layer);
  if (window.GsaWelcome && window.GsaWelcome.syncSwitches) window.GsaWelcome.syncSwitches();
  if (state.mapReady && fly && state.layers[layer] && !wasOn) flyLayerOverview(layer);
}

const LAYER_LABEL = {
  outages: "POWER OUTAGES",
  ukout: "UNITED KINGDOM POWER OUTAGES",
  caout: "CANADA POWER OUTAGES",
  auout: "AUSTRALIA POWER OUTAGES",
  stream: "SCANNERS",
  jamming: "GLOBAL JAMMED GPS SIGNALS",
  aircraft: "LIVE AIR TRAFFIC",
  ships: "GLOBAL MARITIME TRAFFIC",
  conflicts: "GLOBAL CONFLICT TRACKER",
  hunger: "GLOBAL HUNGER",
  mesh: "GLOBAL MESH NODES",
  disease: "GLOBAL DISEASE OUTBREAK",
  animal: "GLOBAL ANIMAL DISEASE OUTBREAK",
  amfm: "GLOBAL AM FM TOWERS",
  effects: "NUKE SIMULATOR",
  quakes: "GLOBAL EARTHQUAKES",
  daynight: "DAY / NIGHT",
  sats: "SATELLITES",
  iss: "ISS POSITION",
  volcanoes: "VOLCANO ALERTS",
  disasters: "GLOBAL DISASTERS",
  radar: "GLOBAL WEATHER RADAR",
  nwsalerts: "US WEATHER ALERTS",
  aurora: "AURORA / SPACE WEATHER",
  hurricanes: "HURRICANES",
  wildfires: "GLOBAL WILDFIRES",
  rivers: "RIVER GAUGES IN FLOOD (US)",
  coastal: "COASTAL WATER LEVELS (US)",
  tsunami: "TSUNAMI ALERTS",
  airports: "GLOBAL AIRPORTS",
  bases: "GLOBAL MILITARY BASES",
  celltowers: "USA CELL TOWERS",
  powerlines: "USA POWER LINES",
  powerplants: "GLOBAL POWER PLANTS",
  police: "USA POLICE DEPARTMENTS",
  sheriff: "USA SHERIFF DEPARTMENTS",
  fire: "USA FIRE DEPARTMENTS",
  hospitals: "USA HOSPITALS & TRAUMA CENTERS",
  gunsusa: "USA GUN OWNERSHIP",
  gunsworld: "GLOBAL GUN OWNERSHIP",
  ccw: "USA CONCEALED CARRY RECIPROCITY",
  inetusa: "USA INTERNET OUTAGES",
  inetglobal: "GLOBAL INTERNET OUTAGES",
  tfr: "FAA TFR",
  delays: "FLIGHT DELAYS",
  airquality: "USA AIR QUALITY",
  militianational: "NATIONAL GROUPS",
  militiastate: "STATEWIDE GROUPS",
  militialocal: "LOCAL GROUPS",
  militiainactive: "INACTIVE GROUPS",
  ufo: "UFO SIGHTINGS",
  bigfoot: "BIGFOOT SIGHTINGS",
};

function setupLegendScroll() {
  // Phone bottom bar: the layer dots scroll sideways. Fade an edge only when
  // more dots are hidden past it, so the end dots are never dimmed.
  const row = document.querySelector(".hud-bot .legend");
  if (!row) return;
  const sync = () => {
    const max = row.scrollWidth - row.clientWidth;
    row.classList.toggle("fade-l", max > 1 && row.scrollLeft > 1);
    row.classList.toggle("fade-r", max > 1 && row.scrollLeft < max - 1);
  };
  row.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync);
  sync();
}

function syncMobilePick(just) {
  const line = document.getElementById("mobile-pick");
  if (!line) return;
  const order = ["outages", "ukout", "caout", "auout", "inetusa", "inetglobal", "stream", "jamming", "aircraft", "ships", "tfr", "delays", "conflicts", "hunger", "mesh", "disease", "animal", "airquality", "amfm", "effects", "daynight", "iss", "sats", "volcanoes", "disasters", "quakes", "radar", "nwsalerts", "rivers", "coastal", "aurora", "tsunami", "hurricanes", "wildfires", "airports", "bases", "celltowers", "powerlines", "powerplants", "police", "sheriff", "fire", "hospitals", "gunsusa", "gunsworld", "ccw", "militianational", "militiastate", "militialocal", "militiainactive", "ufo", "bigfoot"];
  const on = order.filter((key) => layerShown(key));
  if (just && layerShown(just)) {
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

// Screen disk of the 3D globe, in canvas pixels. Credit text uses it as a mask
// so the line is visible in the space beside the earth and hidden across it.
function globeScreenDisk(viewer) {
  const C = window.Cesium;
  const scene = viewer.scene;
  if (!C || scene.mode !== C.SceneMode.SCENE3D) return null;
  const camera = scene.camera;
  const radius = scene.globe.ellipsoid.maximumRadius;
  const cam = camera.positionWC;
  const dist = C.Cartesian3.magnitude(cam);
  if (!(dist > radius + 1000)) return null;
  const center = C.SceneTransforms.worldToWindowCoordinates(scene, C.Cartesian3.ZERO);
  if (!center) return null;
  const dist2 = dist * dist;
  const side = new C.Cartesian3();
  C.Cartesian3.cross(cam, camera.upWC, side);
  if (C.Cartesian3.magnitudeSquared(side) < 1) C.Cartesian3.cross(cam, camera.rightWC, side);
  if (C.Cartesian3.magnitudeSquared(side) < 1) return null;
  C.Cartesian3.normalize(side, side);
  const along = C.Cartesian3.multiplyByScalar(cam, (radius * radius) / dist2, new C.Cartesian3());
  const perp = (radius / dist) * Math.sqrt(dist2 - radius * radius);
  const limb = C.Cartesian3.add(along, C.Cartesian3.multiplyByScalar(side, perp, new C.Cartesian3()), new C.Cartesian3());
  const edge = C.SceneTransforms.worldToWindowCoordinates(scene, limb);
  if (!edge) return null;
  const px = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (!(px > 2)) return null;
  return { x: center.x, y: center.y, r: px };
}

let creditMaskAt = 0;
function placeCreditBehindGlobe() {
  const now = performance.now();
  if (now - creditMaskAt < 80) return;
  creditMaskAt = now;
  const viewer = state.viewer;
  if (!viewer) return;
  const lines = document.querySelectorAll(".ship-credit, .air-credit, .jam-credit, .sw-credit, .infra-credit");
  let visible = false;
  for (const el of lines) {
    if (!el.hidden) visible = true;
  }
  if (!visible) return;
  const disk = globeScreenDisk(viewer);
  const canvas = viewer.scene.canvas.getBoundingClientRect();
  for (const el of lines) {
    if (el.hidden || el.getClientRects().length === 0 || !disk) {
      el.classList.remove("is-behind-globe");
      el.style.removeProperty("--globe-x");
      el.style.removeProperty("--globe-y");
      el.style.removeProperty("--globe-r");
      continue;
    }
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--globe-x", `${(canvas.left + disk.x - rect.left).toFixed(1)}px`);
    el.style.setProperty("--globe-y", `${(canvas.top + disk.y - rect.top).toFixed(1)}px`);
    el.style.setProperty("--globe-r", `${disk.r.toFixed(1)}px`);
    el.classList.add("is-behind-globe");
  }
}

function syncTrafficBars() {
  const airOn = layerShown("aircraft");
  const shipOn = layerShown("ships");
  const pane = state.trafficPane === "ships" ? "ships" : "air";
  const switcher = document.querySelector(".traffic-switch");
  if (switcher) switcher.hidden = !(airOn && shipOn);
  const airBar = document.querySelector(".air-filters");
  const shipBar = document.querySelector(".ship-filters");
  if (airBar) airBar.classList.toggle("is-open", airOn && (!shipOn || pane === "air"));
  if (shipBar) shipBar.classList.toggle("is-open", shipOn && (!airOn || pane === "ships"));
  const shipCreditLine = document.querySelector(".ship-credit");
  if (shipCreditLine) shipCreditLine.hidden = !shipOn;
  const airCreditLine = document.querySelector(".air-credit");
  if (airCreditLine) airCreditLine.hidden = !airOn;
  const jamCreditLine = document.querySelector(".jam-credit");
  if (jamCreditLine) jamCreditLine.hidden = !layerShown("jamming");
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

function outageListPoints() {
  const rows = state.outagePoints.map((point) => Object.assign({ layer: "outages" }, point));
  for (const key of ["ukout", "caout", "auout"]) {
    const pack = state.regionOut[key];
    if (!pack || !pack.meta || !state.layers[key]) continue;
    for (const point of pack.points) rows.push(Object.assign({ layer: key }, point));
  }
  return rows;
}

function paintRegionOutageNote(key) {
  const note = document.querySelector(`[data-outage-note="${key}"]`);
  const pack = state.regionOut[key];
  if (!note || !pack) return;
  if (!layerShown(key) || !pack.meta) {
    note.hidden = true;
    note.textContent = "";
    return;
  }
  const body = pack.meta;
  const failed = (body.feeds || []).filter((feed) => feed && feed.ok === false).map((feed) => feed.name);
  const bits = [];
  if (body.note) bits.push(body.note);
  if (failed.length) bits.push(`Temporarily unavailable: ${failed.join(", ")}.`);
  if (body.error && !failed.length) bits.push(body.error);
  note.hidden = bits.length === 0;
  note.textContent = bits.join(" ");
}

async function loadOutages() {
  const response = await fetch("/api/outages");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Power outages failed");
  state.outagePoints = (Array.isArray(body.points) ? body.points : []).map((point) => Object.assign({ layer: "outages" }, point));
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
  layerStatus(body.stale ? "OUTAGES CACHED" : (body.error ? "US OUTAGES UNAVAILABLE" : ""));
}

async function loadRegionOutages(key) {
  const pack = state.regionOut[key];
  if (!pack) return;
  const response = await fetch(pack.api);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Power outages failed");
  pack.points = (Array.isArray(body.points) ? body.points : []).map((point) => Object.assign({ layer: key }, point));
  pack.meta = body;
  setCount(key, pack.points.length);
  placeRegionOutageMarkers(key);
  paintRegionOutageNote(key);
  renderOutageList();
  if (body.error) layerStatus(`${LAYER_LABEL[key] || "OUTAGES"} UNAVAILABLE`);
  else if (body.stale) layerStatus("OUTAGES CACHED");
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

function placeRegionOutageMarkers(key) {
  const pack = state.regionOut[key];
  const source = sourceFor(key);
  if (!state.viewer || !pack || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers[key]);
  for (const point of pack.points) {
    if (point.lat == null || point.lon == null) continue;
    const entity = source.entities.add({
      name: outagePlace(point),
      position: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 0),
      point: markerPoint(outageColor(point.customers)),
    });
    entity._outage = point;
  }
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
  const points = outageListPoints()
    .filter((point) => {
      if (!query) return true;
      const hay = `${point.name} ${point.state} ${point.country || ""} ${(point.utilities || []).join(" ")} ${point.source || ""} ${point.detail || ""} ${point.ref || ""}`.toLowerCase();
      return hay.includes(query);
    })
    .slice()
    .sort((a, b) => (b.customers || 0) - (a.customers || 0) || String(a.name).localeCompare(String(b.name)));
  list.innerHTML = "";
  for (const point of points) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    if (state.openKind === "outage" && point.id === state.openId && point.layer === state.openLayer) row.classList.add("on");
    const utils = (point.utilities || []).slice(0, 2).join(", ");
    const count = Number(point.customers) > 0 ? `${outageCustomers(point.customers)} customers` : "Customers not reported";
    row.innerHTML = `<div class="name">${esc(outagePlace(point))}</div><div class="host">${esc(count)}${utils ? " · " + esc(utils) : ""}</div>`;
    row.addEventListener("click", () => openOutage(point, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "outages") {
    document.getElementById("feed-title").textContent = `POWER OUTAGES ${points.length}`;
  }
}

function findOutageEntity(id, layer) {
  const sources = layer ? [sourceFor(layer)] : [state.outageSource, state.ukOutSource, state.caOutSource, state.auOutSource];
  for (const source of sources) {
    if (!source) continue;
    for (const entity of source.entities.values) {
      if (entity._outage && entity._outage.id === id) return entity;
    }
  }
  return null;
}

function hideOutageCard() {
  const card = document.getElementById("outage-card");
  if (card) card.hidden = true;
  if (state.openKind === "outage") {
    state.openKind = "";
    state.openId = "";
    state.openLayer = "";
    renderOutageList();
  }
}

// Outage card text (also listed in the nearby card's pin list). No links leave the site.
function outageText(point) {
  const n = Number(point.customers) || 0;
  const customers = n > 0 ? `${outageCustomers(n)} customers out` : "Customer count not reported";
  const utils = (point.utilities || []).join(", ");
  const sourceName = point.source || "DOE/ORNL ODIN";
  const bits = [customers];
  if (utils && utils !== sourceName) bits.push(utils);
  if (sourceName) bits.push(sourceName);
  if (point.detail) bits.push(point.detail);
  if (point.etr) bits.push(`Estimated restoration ${point.etr}`);
  if (point.ref) bits.push(`Reference ${point.ref}`);
  return bits.join(" · ").replace(/https?:\/\/\S+/gi, "").replace(/\btel:\S+/gi, "");
}

function openOutage(point, options = {}) {
  if (!point) return;
  if (state.openKind === "conflict") closeConflict();
  closeAircraft();
  closePin();
  hideHungerCard();
  const key = point.layer && state.layers[point.layer] !== undefined ? point.layer : "outages";
  state.openKind = "outage";
  state.openId = point.id;
  state.openLayer = key;
  if (state.layers[key] === false) setLayer(key, true, { fly: false });
  setFeedMode("outages");
  const selected = document.getElementById("selected");
  if (selected) selected.hidden = true;
  const card = document.getElementById("outage-card");
  const title = document.getElementById("outage-title");
  const body = document.getElementById("outage-body");
  if (card && title && body) {
    title.textContent = outagePlace(point);
    body.textContent = outageText(point);
    card.hidden = false;
  }
  renderOutageList();
  const entity = findOutageEntity(point.id, key);
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
  if (!response.ok) throw new Error(body.error || "Global hunger failed");
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
  layerStatus(body.stale ? "GLOBAL HUNGER CACHED" : "");
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
    document.getElementById("feed-title").textContent = `GLOBAL HUNGER ${points.length}`;
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

function hungerText(point) {
  const fies = point.fies ? ` Moderate or severe food insecurity ${hungerRate(point.fies)}.` : "";
  const region = point.region ? ` · ${point.region}` : "";
  return `${hungerRate(point.pou)} of people undernourished${region}. The ${point.year || "latest"} figure is a 3-year average.${fies}`;
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
    title.textContent = point.name;
    body.textContent = hungerText(point);
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

function streamHtml(site) {
  const where = [site.city, site.county, site.state, site.source].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ");
  const coords = Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lon))
    ? `${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)}`
    : "";
  return `OpenMHz${where ? " · " + esc(where) : ""}${coords ? "<br>" + coords : ""}`;
}

function openStream(site, options = {}) {
  if (!site || !site.url) return;
  if (state.openKind === "conflict") closeConflict();
  state.streamOpenId = site.id;
  setFeedMode("stream");
  const coords = Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lon))
    ? `${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)}`
    : "";
  fillSelected(`<b>SCANNER</b> ${esc(site.name)}<br>${streamHtml(site)}`);
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
  effects: { color: "#ff8f1f", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "NUKE SIMULATOR" },
  quakes: { color: "#f08a24", outline: MARKER_OUTLINE, size: () => MARKER_SIZE, kind: "EARTHQUAKES" },
  sats: { color: "#7fe0ff", outline: MARKER_OUTLINE, size: () => 6, kind: "SATELLITES" },
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
    const mil = state.militaryPoints || (state.aircraftFeed || []).filter((point) => point.mil);
    publishAircraft(mil);
    refreshMilitary().catch((error) => statusLive(error.message || String(error)));
  } else {
    publishAircraft(state.aircraftFeed || []);
  }
  if (!state.running) statusLive();
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

function aircraftDest(lat, lon, trackDeg, distNm) {
  const radiusNm = 3440.065;
  const d = distNm / radiusNm;
  const lat1 = (Number(lat) * Math.PI) / 180;
  const lon1 = (Number(lon) * Math.PI) / 180;
  const brng = ((Number(trackDeg) || 0) * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

const AIRCRAFT_COAST_MS = 6 * 60 * 1000;

function aircraftCoasted(point, now) {
  const originMs = Number(point.ts) || state.aircraftSnapMs || now;
  const age = Math.max(0, now - originMs);
  const coast = Math.min(age, AIRCRAFT_COAST_MS);
  const gs = Number(point.gs) || 0;
  const ground = aircraftOnGround(point);
  const track = Number(point.track) || 0;
  let altM = Number(point.altM) || 0;
  if (ground || gs < 5 || coast <= 0 || point.lat == null || point.lon == null) {
    return { lat: point.lat, lon: point.lon, altM, track };
  }
  const moved = aircraftDest(point.lat, point.lon, track, gs * (coast / 3600000));
  const rate = Number(point.baro_rate);
  if (Number.isFinite(rate)) {
    altM = Math.max(0, altM + rate * 0.3048 * (coast / 60000));
  }
  return { lat: moved.lat, lon: moved.lon, altM, track };
}

function tickAircraft() {
  if (document.hidden || !state.layers.aircraft) return;
  const source = state.live.aircraft && state.live.aircraft.source;
  if (!source || !window.Cesium) return;
  const now = Date.now();
  const entities = source.entities.values;
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    const item = entity._live;
    if (!item || item.layer !== "aircraft") continue;
    const pos = aircraftCoasted(item, now);
    if (pos.lat == null || pos.lon == null) continue;
    entity.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altM || 0);
    if (entity.billboard) entity.billboard.rotation = -Cesium.Math.toRadians(pos.track || 0);
  }
}

function aircraftAgeLabel() {
  if (!state.aircraftSnapMs) return "";
  const min = Math.max(0, Math.round((Date.now() - state.aircraftSnapMs) / 60000));
  if (state.aircraftStale) return min ? `stale, ${min} min ago` : "stale";
  if (min <= 0) return "just now";
  return `${min} min ago`;
}

function applyAircraftSnapshot(body) {
  const points = Array.isArray(body && body.points) ? body.points : [];
  if (body && body.updated) {
    const parsed = Date.parse(body.updated);
    state.aircraftSnapMs = Number.isFinite(parsed) ? parsed : (Number(body.at) || Date.now());
    state.aircraftUpdated = body.updated;
  } else if (body && body.at) {
    state.aircraftSnapMs = Number(body.at) || Date.now();
  } else if (points.length && points[0].ts) {
    state.aircraftSnapMs = Number(points[0].ts);
  }
  state.aircraftStale = Boolean(body && body.stale);
  state.aircraftFeed = points;
  state.militaryPoints = points.filter((point) => point.mil);
  if (state.airFilter === "mil") publishAircraft(state.militaryPoints);
  else publishAircraft(state.aircraftFeed);
}

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

async function pollJamming() {
  const data = await fetch("/api/feeds").then((response) => response.json());
  const jam = data.jamming || {};
  state.live.jamming.points = jam.points || [];
  setCount("jamming", jam.count ?? state.live.jamming.points.length);
  placeLiveLayer("jamming", state.live.jamming.points);
}

async function pollAircraft() {
  try {
    await loadAdsbIcons();
  } catch (error) {
    state.adsbIcons = null;
  }
  const data = await fetch("/api/aircraft").then((response) => response.json());
  applyAircraftSnapshot(data);
  statusLive();
}

async function pollLiveFeeds() {
  await pollJamming();
  await pollAircraft();
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
    state.live.quakes.source,
    state.live.sats.source,
    state.live.volcanoes.source,
    state.live.disasters.source,
    state.live.nwsalerts.source,
    state.live.hurricanes.source,
    state.live.wildfires.source,
    state.live.rivers.source,
    state.live.coastal.source,
    state.live.tsunami.source,
    state.outageSource,
    state.ukOutSource,
    state.caOutSource,
    state.auOutSource,
    state.hungerSource,
  ];
  // FIREARMS use the same depth-test-off point markers. Without this cull,
  // pins on the far side of the earth show through and look stuck on the
  // screen when the globe is panned or rotated. USA state pins usually
  // looked fine because they sit together on one side of the globe.
  // USA CONCEALED CARRY RECIPROCITY state shapes (each carries its state center).
  if (window.GsaCcw && window.GsaCcw.KEYS) {
    for (const key of window.GsaCcw.KEYS) {
      const ccwSource = window.GsaCcw.sourceFor(key);
      if (ccwSource) sources.push(ccwSource);
    }
  }
  if (window.GsaFirearms && window.GsaFirearms.KEYS) {
    for (const key of window.GsaFirearms.KEYS) {
      const firearmsSource = window.GsaFirearms.sourceFor(key);
      if (firearmsSource) sources.push(firearmsSource);
    }
  }
  if (window.GsaInternet && window.GsaInternet.KEYS) {
    for (const key of window.GsaInternet.KEYS) {
      const internetSource = window.GsaInternet.sourceFor(key);
      if (internetSource) sources.push(internetSource);
    }
  }
  // FLIGHT DELAYS airport pins and code labels.
  if (window.GsaDelays && window.GsaDelays.KEYS) {
    for (const key of window.GsaDelays.KEYS) {
      const delaysSource = window.GsaDelays.sourceFor(key);
      if (delaysSource) sources.push(delaysSource);
    }
  }
  // USA AIR QUALITY monitor pins and smoke plumes (plumes carry their center).
  if (window.GsaAirQuality && window.GsaAirQuality.KEYS) {
    for (const key of window.GsaAirQuality.KEYS) {
      const aqSource = window.GsaAirQuality.sourceFor(key);
      if (aqSource) sources.push(aqSource);
    }
  }
  // FAA TFR center pins (and their flat areas, which carry the same center).
  if (window.GsaTfr && window.GsaTfr.KEYS) {
    for (const key of window.GsaTfr.KEYS) {
      const tfrSource = window.GsaTfr.sourceFor(key);
      if (tfrSource) sources.push(tfrSource);
    }
  }
  if (window.GsaMilitias && window.GsaMilitias.KEYS) {
    for (const key of window.GsaMilitias.KEYS) {
      const militiasSource = window.GsaMilitias.sourceFor(key);
      if (militiasSource) sources.push(militiasSource);
    }
  }
  const scene = viewer.scene;
  // Depth-testing these icons at globe distance eats them. Leaving the
  // depth test off draws far-side icons through the earth, so they look
  // stuck on the front when the globe turns. Hide the jammed GPS signals,
  // aircraft, ships, power outages, world hunger, firearms, and militias pins the
  // ellipsoid blocks.
  if (scene.mode !== Cesium.SceneMode.SCENE3D) {
    for (const source of sources) {
      if (!source) continue;
      const entities = source.entities.values;
      for (let i = 0; i < entities.length; i += 1) entities[i].show = !entities[i]._gsHide;
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
      // _gsHide: nearby.js keeps this pin hidden (outside the search circle, or mid-check).
      entity.show = !entity._gsHide && Boolean(position) && occluder.isPointVisible(position);
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
    let height = key === "aircraft" ? Number(point.altM) || 0 : 0;
    let lon = point.lon;
    let lat = point.lat;
    let track = Number(point.track) || 0;
    if (key === "aircraft") {
      const coasted = aircraftCoasted(point, Date.now());
      lon = coasted.lon;
      lat = coasted.lat;
      height = coasted.altM || 0;
      track = coasted.track || 0;
    }
    const entityOptions = {
      name: point.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    };
    let kind = base.kind;
    if (key === "aircraft" && state.adsbIcons) {
      entityOptions.billboard = {
        image: aircraftIcon(point),
        color: Cesium.Color.fromCssColorString(altitudeColor(point.alt)),
        rotation: -Cesium.Math.toRadians(track),
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
        color: base.color,
        outline: base.outline,
        size: MARKER_SIZE,
        kind: base.kind,
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
        : key === "quakes"
          ? markerPoint(point.color || style.color, point.size || MARKER_SIZE)
          : markerPoint(style.color);
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
  hideHungerCard();
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
  // Write into #selected-body so the shared close button and scroll box stay in place
  // for every current and future layer that uses this card.
  fillSelected(liveHtml(item));
}

// The text of a live pin's info box. opts.list: for the nearby card's pin list (no
// popup bookkeeping in the layer modules).
function liveHtml(item, opts = {}) {
  let extra = "";
  if (item.layer === "aircraft") {
    // Same facts as the aircraft card (renderAircraft), from the live feed row.
    extra = `<dl class="nearby-facts">${[
      aircraftFact("Type", item.t || ""),
      aircraftFact("Reg.", item.r || ""),
      aircraftFact("Squawk", item.squawk || ""),
      aircraftFact("Groundspeed", aircraftNumber(item.gs, 0, " kt")),
      aircraftFact("Baro. alt.", aircraftNumber(item.alt, 0, " ft")),
      aircraftFact("Track", aircraftNumber(item.track, 1, "°")),
      aircraftFact("ICAO", item.hex ? String(item.hex).toUpperCase() : ""),
    ].join("")}</dl>`;
    if (item.hex) extra += `<a href="https://adsb.lol/?icao=${encodeURIComponent(String(item.hex).toLowerCase())}" target="_blank" rel="noreferrer">adsb.lol</a>`;
  }
  else if (item.sw && window.GsaSpaceWeather) {
    extra = window.GsaSpaceWeather.popupHtml(item, opts);
  }
  else if (item.infra && window.GsaInfra) {
    extra = window.GsaInfra.popupHtml(item, opts);
  }
  else if (item.firearms && window.GsaFirearms) {
    extra = window.GsaFirearms.popupHtml(item, opts);
  }
  else if (item.ccw && window.GsaCcw) {
    extra = window.GsaCcw.popupHtml(item, opts);
  }
  else if (item.militias && window.GsaMilitias) {
    extra = window.GsaMilitias.popupHtml(item, opts);
  }
  else if (item.internet && window.GsaInternet) {
    extra = window.GsaInternet.popupHtml(item, opts);
  }
  else if (item.tfr && window.GsaTfr) {
    extra = window.GsaTfr.popupHtml(item, opts);
  }
  else if (item.delays && window.GsaDelays) {
    extra = window.GsaDelays.popupHtml(item, opts);
  }
  else if (item.airquality && window.GsaAirQuality) {
    extra = window.GsaAirQuality.popupHtml(item, opts);
  }
  else if (item.power && window.GsaPowerLines) {
    extra = window.GsaPowerLines.popupHtml(item, opts);
  }
  else if (item.paranormal && window.GsaParanormal) {
    extra = window.GsaParanormal.popupHtml(item, opts);
  }
  else if (item.layer === "quakes") {
    const mag = item.mag != null ? `Magnitude ${Number(item.mag).toFixed(1)}` : "";
    const depth = Number.isFinite(item.depthKm) ? `Depth ${Math.round(item.depthKm)} km` : "";
    const bits = [mag, item.place, item.timeText, depth].filter(Boolean).map((part) => esc(String(part)));
    extra = bits.length ? `<br>${bits.join("<br>")}` : "";
    if (item.url) extra += `<br><a href="${esc(item.url)}" target="_blank" rel="noreferrer">USGS event page</a>`;
  }
  else if (item.layer === "sats") {
    const bits = [
      `NORAD ${item.norad}${item.intl ? ` · ${item.intl}` : ""}`,
      Number.isFinite(item.altKm) ? `Altitude ${Math.round(item.altKm).toLocaleString("en-US")} km (${Math.round(item.altKm * 0.621371).toLocaleString("en-US")} mi)` : "",
      Number.isFinite(item.speedKms) ? `Speed ${item.speedKms.toFixed(2)} km/s` : "",
      item.groupLabel,
      item.docked && item.docked.length ? `Docked here: ${item.docked.join(", ")}` : "",
    ].filter(Boolean).map((part) => esc(String(part)));
    extra = `<br>${bits.join("<br>")}`;
    extra += `<br><a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${encodeURIComponent(item.norad)}" target="_blank" rel="noreferrer">CelesTrak record</a>`;
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
  else if (item.sog != null) extra = `<br>${esc(shipTypeLabel(item))} · ${esc(item.sog)} kn`;
  return `<b>${esc(item.kind)}</b> ${esc(item.name)}<br>${Number(item.lat).toFixed(2)}, ${Number(item.lon).toFixed(2)}${extra}`;
}

// Name + info-box text for any map pin (nearby.js pin list). Same builders as the
// pin cards and the info box; nothing is opened.
function pinInfo(entity) {
  if (!entity) return null;
  if (entity._outage) return { name: outagePlace(entity._outage), html: esc(outageText(entity._outage)) };
  if (entity._hunger) return { name: entity._hunger.name, html: esc(hungerText(entity._hunger)) };
  if (entity._stream) return { name: entity._stream.name, html: streamHtml(entity._stream) };
  if (entity._pin) return { name: entity._pin.name, html: esc(entity._pin.meta || "") + (entity._pin.url ? `${entity._pin.meta ? "<br>" : ""}<a href="${esc(entity._pin.url)}" target="_blank" rel="noreferrer">Source</a>` : "") };
  if (entity._live) {
    const html = liveHtml(entity._live, { list: true });
    // The info box leads with "<b>KIND</b> name<br>"; the list shows the name itself.
    return { name: entity._live.name || entity.name || "", html: html.replace(/^<b>[^<]*<\/b>[^<]*<br>/, "") };
  }
  const d = entity.description && entity.description.getValue ? entity.description.getValue(Cesium.JulianDate.now()) : "";
  return { name: entity.name || "", html: d ? esc(String(d).replace(/<[^>]+>/g, " ")) : "" };
}

// Fly to a pin and open its usual card / info box, as if it were tapped on the map.
function showPinOnMap(entity, lat, lon) {
  const viewer = state.viewer;
  if (!viewer) return;
  if (entity) viewer.selectedEntity = entity;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const h = Math.max(20000, Math.min(viewer.camera.positionCartographic.height, 150000));
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, h), duration: 0.9 });
  }
}
window.gsPinInfo = pinInfo;
window.gsLiveHtml = liveHtml;
window.gsShowPinOnMap = showPinOnMap;
window.gsShowLive = (item) => showLive(item);

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

// EARTHQUAKES · USGS M2.5+ past day (quakes.js, from Lee's PR #95).
let quakesLoading = null;

function scheduleQuakes() {
  loadQuakes().catch((error) => statusLive(error.message || String(error)));
}

async function loadQuakes(opts) {
  if (!window.GsaQuakes) return;
  if (document.hidden) return;
  if (quakesLoading) return quakesLoading;
  quakesLoading = (async () => {
    const result = await window.GsaQuakes.fetchFeed(opts);
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

// DAY / NIGHT · Cesium's own sun lighting, sun, moon, and star background.
// Off restores the site's normal look (no lighting, no sky box, plain dark background).
let dayNightTimer = 0;

function applyDayNight(on) {
  const viewer = state.viewer;
  if (!viewer) return;
  const scene = viewer.scene;
  if (on) {
    if (!state.dayNightSky) state.dayNightSky = Cesium.SkyBox.createEarthSkyBox();
    if (!scene.sun) scene.sun = new Cesium.Sun();
    if (!scene.moon) scene.moon = new Cesium.Moon();
    scene.skyBox = state.dayNightSky;
    scene.skyBox.show = true;
    scene.sun.show = true;
    scene.moon.show = true;
    viewer.clock.currentTime = Cesium.JulianDate.now();
    scene.globe.enableLighting = true;
    if (!dayNightTimer) {
      dayNightTimer = setInterval(() => {
        if (state.viewer) state.viewer.clock.currentTime = Cesium.JulianDate.now();
      }, 60000);
    }
    setCount("daynight", "ON");
  } else {
    scene.globe.enableLighting = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (dayNightTimer) {
      clearInterval(dayNightTimer);
      dayNightTimer = 0;
    }
    setCount("daynight", "—");
  }
  if (scene.requestRender) scene.requestRender();
}

// SATELLITES · CelesTrak orbits, positions worked out in the browser with satellite.js (sats.js).
const SAT_TICK_MS = 1500;
let satTimer = 0;
let satToken = 0;

async function startSats() {
  const viewer = state.viewer;
  const layer = state.live.sats;
  if (!viewer || !window.GsaSats) return;
  const token = ++satToken;
  // Orbits older than the cache window are fetched again when the layer is turned back on.
  if (layer.records && Date.now() - (layer.fetchedAt || 0) > window.GsaSats.CACHE_MS) {
    layer.records = null;
    layer.entitiesBuilt = false;
  }
  if (!layer.records) {
    setCount("sats", "…");
    try {
      const [lib, data] = await Promise.all([window.GsaSats.loadLib(), window.GsaSats.fetchElements()]);
      if (token !== satToken || !state.layers.sats) return;
      layer.lib = lib;
      layer.records = window.GsaSats.buildRecords(lib, data.groups, phoneLayout());
      layer.fetchedAt = data.fetchedAt;
      if (data.errors && data.errors.length) console.warn("SATELLITES:", data.errors.join("; "));
    } catch (error) {
      if (token !== satToken) return;
      setCount("sats", "—");
      statusLive(error.message || String(error));
      return;
    }
  }
  if (!layer.entitiesBuilt) buildSatEntities();
  tickSats();
  if (!satTimer) satTimer = setInterval(tickSats, SAT_TICK_MS);
}

function stopSats() {
  satToken += 1;
  if (satTimer) {
    clearInterval(satTimer);
    satTimer = 0;
  }
}

function buildSatEntities() {
  const layer = state.live.sats;
  const source = layer.source;
  source.entities.removeAll();
  const lib = layer.lib;
  window.GsaSats.propagateAll(lib, layer.records, new Date());
  // Modules and visiting craft docked at a station share its position. Draw one pin
  // (the station, listed first by CelesTrak) and name the docked ones in its popup.
  const hubs = [];
  for (const rec of layer.records) {
    rec.docked = [];
    rec.dockedTo = null;
    if (rec.group !== "stations" || !Number.isFinite(rec.lat)) continue;
    const here = Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, rec.altKm * 1000);
    const hub = hubs.find((item) => Cesium.Cartesian3.distance(item.at, here) < 5000);
    if (hub) {
      rec.dockedTo = hub.rec;
      hub.rec.docked.push(rec.name);
    } else hubs.push({ rec, at: here });
  }
  for (const rec of layer.records) {
    rec.entity = null;
    if (rec.dockedTo) continue;
    rec.layer = "sats";
    rec.kind = "SATELLITES";
    const start = Number.isFinite(rec.lat)
      ? Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, rec.altKm * 1000)
      : Cesium.Cartesian3.ZERO;
    const entity = source.entities.add({
      id: rec.id,
      name: rec.name,
      position: new Cesium.ConstantPositionProperty(start),
      point: {
        pixelSize: rec.size,
        color: Cesium.Color.fromCssColorString(rec.color),
        outlineColor: Cesium.Color.fromCssColorString(MARKER_OUTLINE),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entity._live = rec;
    rec.entity = entity;
  }
  layer.entitiesBuilt = true;
}

function tickSats() {
  const layer = state.live.sats;
  if (!state.layers.sats || !layer.records || document.hidden) return;
  window.GsaSats.propagateAll(layer.lib, layer.records, new Date());
  const shown = [];
  for (const rec of layer.records) {
    if (!rec.entity) continue;
    if (!Number.isFinite(rec.lat)) continue;
    rec.entity.position.setValue(Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, rec.altKm * 1000));
    shown.push(rec);
  }
  const countChanged = layer.points.length !== shown.length;
  layer.points = shown;
  setCount("sats", shown.length);
  if (countChanged) statusLive();
  const selected = state.viewer && state.viewer.selectedEntity;
  const box = document.getElementById("selected");
  if (selected && selected._live && selected._live.layer === "sats" && box && !box.hidden) showLive(selected._live);
}

function statusLive(error) {
  const jam = state.live.jamming.points.length;
  const airPoints = state.live.aircraft.points;
  const airNames = { mil: "MILITARY", airliner: "AIRLINERS", heli: "HELICOPTERS", ground: "GROUND" };
  const airAge = aircraftAgeLabel();
  const air = state.airFilter === "all"
    ? `LIVE AIR TRAFFIC ${airPoints.length}${airAge ? ` · ${airAge}` : ""}`
    : `LIVE AIR TRAFFIC ${aircraftVisibleCount(airPoints)} ${airNames[state.airFilter] || ""}`.trim() + (airAge ? ` · ${airAge}` : "");
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
    ? "GLOBAL MARITIME TRAFFIC"
    : shipPick.matched > shipPick.draw.length
      ? `GLOBAL MARITIME TRAFFIC ${shipPick.draw.length} OF ${shipPick.matched} ${shipLabel}`.trim()
      : `GLOBAL MARITIME TRAFFIC ${shipPick.draw.length} ${shipLabel}`.trim();
  const war = state.conflictsReady ? `GLOBAL CONFLICT TRACKER ${state.conflicts.length}` : "GLOBAL CONFLICT TRACKER …";
  const parts = [
    state.outagePoints.length
      ? `POWER OUTAGES ${state.outagePoints.length} COUNTIES · ${outageCustomers(state.outageMeta && state.outageMeta.customers)}`
      : "POWER OUTAGES",
    `${state.streamPoints.length} SCANNERS`,
    `GLOBAL JAMMED GPS SIGNALS ${jam}`,
    air,
    ships,
    war,
    state.live.disease.points.length
      ? `GLOBAL DISEASE OUTBREAK ${state.live.disease.points.length}`
      : "GLOBAL DISEASE OUTBREAK",
    state.live.animal.points.length
      ? `GLOBAL ANIMAL DISEASE OUTBREAK ${state.live.animal.points.length}`
      : "GLOBAL ANIMAL DISEASE OUTBREAK",
    state.amfmReady
      ? `GLOBAL AM FM TOWERS ${amfmVisibleCount(state.live.amfm.points)}`
      : "GLOBAL AM FM TOWERS",
    state.layers.effects && window.GsaEffectsRadius && window.GsaEffectsRadius.hasResult()
      ? "NUKE SIMULATOR 1"
      : "NUKE SIMULATOR",
    state.live.quakes.points.length
      ? `GLOBAL EARTHQUAKES ${state.live.quakes.points.length}`
      : "GLOBAL EARTHQUAKES",
    state.layers.daynight ? "DAY / NIGHT ON" : "DAY / NIGHT",
    state.live.sats.points.length
      ? `SATELLITES ${state.live.sats.points.length}`
      : "SATELLITES",
  ];
  if (window.GsaSpaceWeather) parts.push(...window.GsaSpaceWeather.statusParts());
  if (window.GsaInfra) parts.push(...window.GsaInfra.statusParts());
  if (window.GsaFirearms) parts.push(...window.GsaFirearms.statusParts());
  if (window.GsaCcw) parts.push(...window.GsaCcw.statusParts());
  if (window.GsaMilitias) parts.push(...window.GsaMilitias.statusParts());
  if (window.GsaInternet) parts.push(...window.GsaInternet.statusParts());
  if (window.GsaTfr) parts.push(...window.GsaTfr.statusParts());
  if (window.GsaDelays) parts.push(...window.GsaDelays.statusParts());
  if (window.GsaAirQuality) parts.push(...window.GsaAirQuality.statusParts());
  if (window.GsaPowerLines) parts.push(...window.GsaPowerLines.statusParts());
  if (error) parts.push(error);
  setStatus(parts.join(" · "));
}

boot().catch((error) => setStatus(error.message || String(error)));

window.GsaOrigin = {
  get: () => (visitorOrigin ? { ...visitorOrigin } : null),
  set: setVisitorOrigin,
};
