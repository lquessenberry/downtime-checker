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
  sdrSource: null,
  gpsSource: null,
  conflictSource: null,
  sdrStations: [],
  gpsZones: [],
  conflicts: [],
  gpsDate: "",
  gpsReady: false,
  conflictsReady: false,
  layers: { sdr: true, gps: true, conflicts: true },
  openKind: "",
  openId: "",
  feedMode: "sdr",
};

const COLORS = {
  up: Cesium.Color.fromCssColorString("#3dff9a"),
  down: Cesium.Color.fromCssColorString("#ff4d4d"),
  pending: Cesium.Color.fromCssColorString("#ffb020"),
};

// Same hub the canvas globe draws its search lines from.
const ORIGIN = { lat: 35.84, lon: -90.7 };
const IMAGERY_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

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
  connectEvents();
  tickClock();
  loadWebsdr().catch((error) => layerStatus(error.message || String(error)));
  loadGps().catch((error) => layerStatus(error.message || String(error)));
  loadConflicts().catch((error) => layerStatus(error.message || String(error)));
}

function loadImagery() {
  // Esri's own metadata advertises level 23, but many of those tiles are empty
  // and Cesium then stretches a blur. Level 19 is the detail that shows buildings.
  return new Cesium.UrlTemplateImageryProvider({
    url: `${IMAGERY_URL}/tile/{z}/{y}/{x}`,
    credit: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maximumLevel: 19,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });
}

async function startGlobe() {
  const imagery = loadImagery();
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
  });
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 30;
  controller.maximumZoomDistance = 40000000;
  viewer.scene.globe.maximumScreenSpaceError = 1.5;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#070b10");
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#10202c");
  viewer.scene.globe.enableLighting = false;
  state.viewer = viewer;
  state.sdrSource = new Cesium.CustomDataSource("websdr");
  state.gpsSource = new Cesium.CustomDataSource("gpsjam");
  state.conflictSource = new Cesium.CustomDataSource("conflicts");
  viewer.dataSources.add(state.sdrSource);
  viewer.dataSources.add(state.gpsSource);
  viewer.dataSources.add(state.conflictSource);
  viewer.camera.setView({
    destination: Cesium.Rectangle.fromDegrees(-168, -48, 150, 72),
  });
  ensureOrigin();
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity) return;
    if (entity._pin) {
      openPin(entity._pin);
      return;
    }
    if (entity._resultIndex == null) return;
    const result = state.results[entity._resultIndex];
    if (result) showSelected(result);
  });
}

function renderSearches(catalog) {
  const nav = document.getElementById("searches");
  addFlyButton(nav, { id: "btn-sdr-all", label: "WEBSDR PINS", countId: "sdr-count", layer: "sdr", feed: "sdr" });
  addFlyButton(nav, { id: "btn-gps-all", label: "GPS JAM", countId: "gps-count", layer: "gps", feed: "gps" });
  addFlyButton(nav, { id: "btn-conflict-all", label: "CONFLICTS", countId: "conflict-count", layer: "conflicts", feed: "conflicts" });
  const groups = [
    ["GLOBAL", catalog.searches.filter((item) => item.group === "global")],
    ["UNITED STATES", catalog.searches.filter((item) => item.group === "us")],
  ];
  for (const [label, items] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = label;
    nav.append(heading);
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = item.id;
      button.innerHTML = `<span>${esc(item.label)}</span><span class="count">${item.count}</span>`;
      button.addEventListener("click", () => startScan(item.id));
      nav.append(button);
    }
  }
}

function fillCountries(list) {
  const select = document.getElementById("country");
  select.innerHTML = list.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
}

function hookUi() {
  document.getElementById("btn-stop").addEventListener("click", () => {
    fetch("/api/stop", { method: "POST" });
  });
  document.getElementById("btn-country").addEventListener("click", () => {
    const country = document.getElementById("country").value;
    startScan("country", country);
  });
  document.getElementById("sdr-back").addEventListener("click", closePin);
  document.getElementById("sdr-filter").addEventListener("input", renderSdrList);
  document.getElementById("gps-filter").addEventListener("input", renderGpsList);
  document.getElementById("conflict-filter").addEventListener("input", renderConflictList);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePin();
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
}

async function startScan(id, country) {
  if (state.running) return;
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, country: country || "" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    setStatus(body.error || "SCAN REFUSED");
  }
}

function connectEvents() {
  const stream = new EventSource("/api/events");
  stream.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === "hello") applySnapshot(event.state);
    if (event.type === "scan-start") {
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
      setFeedMode("returns");
      document.getElementById("link-dot").className = "pulse-dot live";
      document.getElementById("selected").hidden = true;
      setStatus(`TASKING ${event.total} NODES · ${event.heading.toUpperCase()}`);
      renderFeed();
      updateHud();
    }
    if (event.type === "result") {
      state.results[event.result.index] = event.result;
      state.done = event.done;
      state.up = event.up;
      state.down = event.down;
      upsertPoint(event.result);
      prependFeed(event.result);
      updateHud();
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
    }
    if (event.type === "scan-stop") {
      state.running = false;
      document.getElementById("btn-stop").hidden = true;
      setStatus("SCAN ABORTED");
      updateHud();
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
}

function clearPoints() {
  if (!state.viewer) return;
  state.viewer.entities.removeAll();
  state.points.clear();
  state.arcs.clear();
  state.origin = null;
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

function upsertArc(result) {
  if (!state.viewer || result.lat == null || result.lon == null) return;
  const positions = arcPositions(result.lat, result.lon);
  if (!positions) return;
  const color = COLORS[result.status] || COLORS.pending;
  const material = new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color });
  let entity = state.arcs.get(result.index);
  if (!entity) {
    entity = state.viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material,
        arcType: Cesium.ArcType.NONE,
      },
    });
    state.arcs.set(result.index, entity);
    return;
  }
  entity.polyline.positions = positions;
  entity.polyline.material = material;
}

function upsertPoint(result) {
  if (!state.viewer || result.lat == null || result.lon == null) return;
  const color = COLORS[result.status] || COLORS.pending;
  let entity = state.points.get(result.index);
  const position = Cesium.Cartesian3.fromDegrees(result.lon, result.lat, 0);
  if (!entity) {
    entity = state.viewer.entities.add({
      position,
      point: {
        pixelSize: result.status === "down" ? 11 : 8,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entity._resultIndex = result.index;
    state.points.set(result.index, entity);
    upsertArc(result);
    return;
  }
  entity.position = position;
  entity.point.pixelSize = result.status === "down" ? 11 : 8;
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
}

function setStatus(text) {
  document.getElementById("status-line").textContent = text;
}

function tickClock() {
  document.getElementById("clock").textContent = new Date().toISOString().slice(11, 19) + "Z";
  setTimeout(tickClock, 1000);
}

function setFeedMode(mode) {
  const allowed = ["sdr", "gps", "conflicts", "returns"];
  state.feedMode = allowed.includes(mode) ? mode : "sdr";
  for (const name of allowed) {
    const pane = document.getElementById(`${name}-pane`);
    if (pane) pane.hidden = state.feedMode !== name;
  }
  for (const button of document.querySelectorAll("[data-feed]")) {
    button.classList.toggle("on", button.dataset.feed === state.feedMode);
  }
  const title = document.getElementById("feed-title");
  if (state.feedMode === "sdr") title.textContent = `WEBSDR ${state.sdrStations.length}`;
  else if (state.feedMode === "gps") title.textContent = `GPS ${state.gpsZones.length}`;
  else if (state.feedMode === "conflicts") title.textContent = `CONFLICTS ${state.conflicts.length}`;
  else title.textContent = "LIVE RETURNS";
}

function addFlyButton(nav, { id, label, countId, layer, feed }) {
  const fly = document.createElement("button");
  fly.type = "button";
  fly.id = id;
  fly.innerHTML = `<span>${label}</span><span class="count" id="${countId}">…</span>`;
  fly.addEventListener("click", () => {
    closePin();
    setLayer(layer, true);
    setFeedMode(feed);
    const source = sourceFor(layer);
    if (state.viewer && source && source.entities.values.length) {
      state.viewer.flyTo(source, { duration: 1.1 });
    }
  });
  nav.append(fly);
}

function sourceFor(layer) {
  if (layer === "gps") return state.gpsSource;
  if (layer === "conflicts") return state.conflictSource;
  return state.sdrSource;
}

function setLayer(layer, on) {
  if (!Object.prototype.hasOwnProperty.call(state.layers, layer)) return;
  state.layers[layer] = Boolean(on);
  const source = sourceFor(layer);
  if (source) source.show = state.layers[layer];
  const button = document.querySelector(`[data-layer-toggle="${layer}"]`);
  if (button) {
    button.classList.toggle("on", state.layers[layer]);
    button.setAttribute("aria-pressed", state.layers[layer] ? "true" : "false");
  }
}

function layerStatus(error) {
  const parts = [
    `${state.sdrStations.length} SDR`,
    state.gpsReady ? `${state.gpsZones.length} GPS ${state.gpsDate}`.trim() : "GPS …",
    state.conflictsReady ? `${state.conflicts.length} CONFLICTS` : "CONFLICTS …",
  ];
  if (error) parts.push(error);
  setStatus(`${parts.join(" · ")} · CLICK A PIN TO OPEN`);
}

function wrapName(name) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 34 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function sdrPin(station) {
  return {
    kind: "sdr",
    id: station.id,
    name: station.name,
    url: station.url,
    lat: station.lat,
    lon: station.lon,
    meta: [station.qth, station.users ? `${station.users} listening` : "", ...(station.bands || [])]
      .filter(Boolean)
      .join(" · "),
  };
}

async function loadWebsdr() {
  const response = await fetch("/api/websdr");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "WebSDR list failed");
  state.sdrStations = Array.isArray(body.stations) ? body.stations : [];
  const count = document.getElementById("sdr-count");
  if (count) count.textContent = String(state.sdrStations.length);
  placeMarkers(state.sdrSource, "sdr", state.sdrStations.map(sdrPin), "/icons/ham-radio.png", true);
  const host = document.getElementById("cesium");
  if (host && state.sdrSource) host.dataset.pins = String(state.sdrSource.entities.values.length);
  renderSdrList();
  layerStatus(body.stale ? "SDR CACHED" : "");
}

async function loadGps() {
  const response = await fetch("/api/gpsjam");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "GPS Jam failed");
  state.gpsZones = Array.isArray(body.zones) ? body.zones : [];
  state.gpsDate = body.date || "";
  state.gpsReady = true;
  const count = document.getElementById("gps-count");
  if (count) count.textContent = String(state.gpsZones.length);
  const credit = document.getElementById("gps-credit");
  if (credit) {
    credit.textContent = `${body.date || ""}${body.stale ? " · cached" : ""} · gpsjam.org`;
    credit.title = body.credit || "";
  }
  placeMarkers(state.gpsSource, "gps", state.gpsZones, "/icons/satellite.png", false);
  const host = document.getElementById("cesium");
  if (host && state.gpsSource) host.dataset.gps = String(state.gpsSource.entities.values.length);
  renderGpsList();
  layerStatus(body.stale ? "GPS CACHED" : "");
}

async function loadConflicts() {
  const response = await fetch("/api/conflicts");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Conflict tracker failed");
  state.conflicts = Array.isArray(body.conflicts) ? body.conflicts : [];
  state.conflictsReady = true;
  const count = document.getElementById("conflict-count");
  if (count) count.textContent = String(state.conflicts.length);
  const credit = document.getElementById("conflict-credit");
  if (credit) {
    credit.textContent = `${body.stale ? "cached · " : ""}cfr.org/global-conflict-tracker`;
    credit.title = body.credit || "";
  }
  placeMarkers(state.conflictSource, "conflicts", state.conflicts, "/icons/bomb.png", false);
  const host = document.getElementById("cesium");
  if (host && state.conflictSource) host.dataset.conflicts = String(state.conflictSource.entities.values.length);
  renderConflictList();
  layerStatus(body.stale ? "CONFLICTS CACHED" : "");
}

function placeMarkers(source, layer, items, icon, stack) {
  if (!state.viewer || !source) return;
  source.entities.removeAll();
  source.show = Boolean(state.layers[layer]);
  const stacks = new Map();
  for (const item of items) {
    if (item.lat == null || item.lon == null) continue;
    let shift = 0;
    if (stack) {
      const key = `${Number(item.lat).toFixed(4)},${Number(item.lon).toFixed(4)}`;
      const n = stacks.get(key) || 0;
      stacks.set(key, n + 1);
      shift = n * 28;
    }
    const entity = source.entities.add({
      name: item.name,
      position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
      billboard: {
        image: icon,
        width: 48,
        height: 48,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(shift, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(4e5, 1, 1.2e7, 0.62),
      },
      label: {
        text: item.kind === "gps" ? `${wrapName(item.name)}\n${Math.round(item.pct)}%` : wrapName(item.name),
        font: "12px ui-monospace, monospace",
        fillColor: Cesium.Color.fromCssColorString("#e8f7ff"),
        outlineColor: Cesium.Color.fromCssColorString("#041018"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#102028").withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(shift, -30),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 7e6, 0.45),
      },
    });
    entity._pin = item;
  }
}

function renderSdrList() {
  const list = document.getElementById("sdr-list");
  if (!list) return;
  const query = (document.getElementById("sdr-filter").value || "").trim().toLowerCase();
  const stations = state.sdrStations
    .filter((station) => {
      if (!query) return true;
      const hay = `${station.name} ${station.qth} ${station.url} ${(station.bands || []).join(" ")}`.toLowerCase();
      return hay.includes(query);
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = "";
  for (const station of stations) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    row.dataset.lat = String(station.lat);
    row.dataset.lon = String(station.lon);
    row.dataset.url = station.url;
    if (state.openKind === "sdr" && station.id === state.openId) row.classList.add("on");
    const band = station.bands && station.bands.length ? station.bands[0] : "";
    row.innerHTML = `<div class="name">${esc(station.name)}</div><div class="host">${esc(station.qth || "")}${band ? " · " + esc(band) : ""} · ${station.users || 0} listening</div>`;
    row.addEventListener("click", () => openPin(sdrPin(station), { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "sdr") {
    document.getElementById("feed-title").textContent = `WEBSDR ${stations.length}`;
  }
}

function renderGpsList() {
  const list = document.getElementById("gps-list");
  if (!list) return;
  const query = (document.getElementById("gps-filter").value || "").trim().toLowerCase();
  const zones = state.gpsZones
    .filter((zone) => {
      if (!query) return true;
      return `${zone.name} ${zone.note || ""} ${zone.pct} ${zone.date || ""}`.toLowerCase().includes(query);
    })
    .slice()
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  list.innerHTML = "";
  for (const zone of zones) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sdr-row";
    row.dataset.lat = String(zone.lat);
    row.dataset.lon = String(zone.lon);
    row.dataset.url = zone.url;
    if (state.openKind === "gps" && zone.id === state.openId) row.classList.add("on");
    row.innerHTML = `<div class="name">${esc(zone.name)}</div><div class="host">${esc(zone.pct)}% · ${zone.hexes} hexes · ${zone.bad} aircraft</div>`;
    row.addEventListener("click", () => openPin(zone, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "gps") {
    document.getElementById("feed-title").textContent = `GPS ${zones.length}`;
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
    row.addEventListener("click", () => openPin(conflict, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "conflicts") {
    document.getElementById("feed-title").textContent = `CONFLICTS ${conflicts.length}`;
  }
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
  state.openKind = pin.kind;
  state.openId = pin.id;
  const layer = pin.kind === "conflict" ? "conflicts" : pin.kind;
  if (state.layers[layer] === false) setLayer(layer, true);
  document.getElementById("sdr-title").textContent = pin.name;
  document.getElementById("sdr-meta").textContent = pin.meta || "";
  const pop = document.getElementById("sdr-pop");
  pop.href = pin.url;
  const frame = document.getElementById("sdr-frame");
  frame.title = pin.name;
  if (frame.dataset.url !== pin.url) {
    frame.dataset.url = pin.url;
    frame.src = pin.url;
  }
  document.getElementById("sdr-listen").hidden = false;
  renderSdrList();
  renderGpsList();
  renderConflictList();
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

function closePin() {
  const frame = document.getElementById("sdr-frame");
  frame.src = "about:blank";
  frame.dataset.url = "";
  state.openKind = "";
  state.openId = "";
  document.getElementById("sdr-listen").hidden = true;
  renderSdrList();
  renderGpsList();
  renderConflictList();
}

boot().catch((error) => setStatus(error.message || String(error)));
