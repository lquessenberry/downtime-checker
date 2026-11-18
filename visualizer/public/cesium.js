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
  sdrPin: null,
  sdrStations: [],
  sdrOpenId: "",
  radioSource: null,
  radioPoints: [],
  radioOpenId: "",
  radioCount: 0,
  streamSource: null,
  streamPoints: [],
  streamOpenId: "",
  live: {
    jamming: { source: null, points: [] },
    aircraft: { source: null, points: [] },
    ships: { source: null, points: [] },
    conflicts: { source: null, points: [] },
  },
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
  Promise.allSettled([loadWebsdr(), loadRadio(), loadStreams(), pollLiveFeeds()]).then((results) => {
    const failed = results.find((result) => result.status === "rejected");
    if (failed) setStatus(failed.reason?.message || String(failed.reason));
    else statusLive();
  });
  setInterval(pollLiveFeeds, 8000);
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
  state.radioSource = new Cesium.CustomDataSource("uniden-radio");
  state.streamSource = new Cesium.CustomDataSource("hpdb-streams");
  viewer.dataSources.add(state.sdrSource);
  viewer.dataSources.add(state.radioSource);
  viewer.dataSources.add(state.streamSource);
  for (const key of ["jamming", "aircraft", "ships", "conflicts"]) {
    state.live[key].source = new Cesium.CustomDataSource(key);
    viewer.dataSources.add(state.live[key].source);
  }
  state.sdrPin = new Cesium.PinBuilder().fromColor(Cesium.Color.fromCssColorString("#35d0ff"), 48);
  viewer.camera.setView({
    destination: Cesium.Rectangle.fromDegrees(-168, -48, 150, 72),
  });
  ensureOrigin();
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity) return;
    if (entity._sdr) {
      openSdr(entity._sdr);
      return;
    }
    if (entity._radio) {
      openRadio(entity._radio, { fly: false });
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
  const nav = document.getElementById("searches");
  const fly = document.createElement("button");
  fly.type = "button";
  fly.id = "btn-sdr-all";
  fly.innerHTML = `<span>WEBSDR PINS</span><span class="count" id="sdr-count">…</span>`;
  fly.addEventListener("click", () => {
    closeSdr();
    setFeedMode("sdr");
    if (state.viewer && state.sdrSource) state.viewer.flyTo(state.sdrSource, { duration: 1.1 });
  });
  nav.append(fly);
  const radioFly = document.createElement("button");
  radioFly.type = "button";
  radioFly.id = "btn-radio-all";
  radioFly.innerHTML = `<span>UNIDEN RADIO</span><span class="count" id="radio-count">…</span>`;
  radioFly.addEventListener("click", () => {
    closeSdr();
    setFeedMode("radio");
    if (!state.viewer) return;
    state.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(-126, 24, -66, 50),
      duration: 1.2,
    });
  });
  nav.append(radioFly);
  const streamFly = document.createElement("button");
  streamFly.type = "button";
  streamFly.id = "btn-stream-all";
  streamFly.innerHTML = `<span>LIVE STREAMS</span><span class="count" id="stream-count">…</span>`;
  streamFly.addEventListener("click", () => {
    closeSdr();
    setFeedMode("stream");
    if (!state.viewer) return;
    state.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(-126, 24, -66, 50),
      duration: 1.2,
    });
  });
  nav.append(streamFly);
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
  document.getElementById("sdr-back").addEventListener("click", closeSdr);
  document.getElementById("sdr-filter").addEventListener("input", renderSdrList);
  document.getElementById("radio-filter").addEventListener("input", renderRadioList);
  document.getElementById("stream-filter").addEventListener("input", renderStreamList);
  for (const button of document.querySelectorAll("[data-live]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.live;
      const layer = state.live[key];
      if (!layer?.source) return;
      layer.source.show = !layer.source.show;
      button.classList.toggle("on", layer.source.show);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSdr();
  });
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
  state.feedMode = ["returns", "radio", "stream"].includes(mode) ? mode : "sdr";
  document.getElementById("sdr-pane").hidden = state.feedMode !== "sdr";
  document.getElementById("radio-pane").hidden = state.feedMode !== "radio";
  document.getElementById("stream-pane").hidden = state.feedMode !== "stream";
  document.getElementById("returns-pane").hidden = state.feedMode !== "returns";
  for (const button of document.querySelectorAll("[data-feed]")) {
    button.classList.toggle("on", button.dataset.feed === state.feedMode);
  }
  if (state.feedMode === "sdr") {
    document.getElementById("feed-title").textContent = `WEBSDR ${state.sdrStations.length}`;
  } else if (state.feedMode === "radio") {
    document.getElementById("feed-title").textContent = `RADIO ${state.radioCount || state.radioPoints.length}`;
  } else if (state.feedMode === "stream") {
    document.getElementById("feed-title").textContent = `STREAM ${state.streamPoints.length}`;
  } else {
    document.getElementById("feed-title").textContent = "LIVE RETURNS";
  }
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

async function loadWebsdr() {
  const response = await fetch("/api/websdr");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "WebSDR list failed");
  state.sdrStations = Array.isArray(body.stations) ? body.stations : [];
  const count = document.getElementById("sdr-count");
  if (count) count.textContent = String(state.sdrStations.length);
  placeSdrPins(state.sdrStations);
  renderSdrList();
  const cached = body.stale ? " · CACHED LIST" : "";
  setStatus(`${state.sdrStations.length} WEBSDR PINS${cached} · CLICK A PIN TO LISTEN · websdr.org`);
}

function placeSdrPins(stations) {
  if (!state.viewer || !state.sdrSource) return;
  state.sdrSource.entities.removeAll();
  const stacks = new Map();
  for (const station of stations) {
    if (station.lat == null || station.lon == null) continue;
    const key = `${Number(station.lat).toFixed(4)},${Number(station.lon).toFixed(4)}`;
    const stack = stacks.get(key) || 0;
    stacks.set(key, stack + 1);
    const shift = stack * 26;
    const entity = state.sdrSource.entities.add({
      name: station.name,
      position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
      billboard: {
        image: state.sdrPin,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(shift, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(4e5, 1, 1.2e7, 0.62),
      },
      label: {
        text: wrapName(station.name),
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
        pixelOffset: new Cesium.Cartesian2(shift, -52),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 7e6, 0.45),
      },
    });
    entity._sdr = station;
  }
  const host = document.getElementById("cesium");
  if (host) host.dataset.pins = String(state.sdrSource.entities.values.length);
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
    if (station.id === state.sdrOpenId) row.classList.add("on");
    const band = station.bands && station.bands.length ? station.bands[0] : "";
    row.innerHTML = `<div class="name">${esc(station.name)}</div><div class="host">${esc(station.qth || "")}${band ? " · " + esc(band) : ""} · ${station.users || 0} listening</div>`;
    row.addEventListener("click", () => openSdr(station, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "sdr") {
    document.getElementById("feed-title").textContent = `WEBSDR ${stations.length}`;
  }
}

function findSdrEntity(id) {
  if (!state.sdrSource) return null;
  for (const entity of state.sdrSource.entities.values) {
    if (entity._sdr && entity._sdr.id === id) return entity;
  }
  return null;
}

function openSdr(station, options = {}) {
  if (!station || !station.url) return;
  state.sdrOpenId = station.id;
  const panel = document.getElementById("sdr-listen");
  document.getElementById("sdr-title").textContent = station.name;
  const where = [station.qth, station.users ? `${station.users} listening` : "", ...(station.bands || [])]
    .filter(Boolean)
    .join(" · ");
  document.getElementById("sdr-meta").textContent = where;
  const pop = document.getElementById("sdr-pop");
  pop.href = station.url;
  const frame = document.getElementById("sdr-frame");
  if (frame.dataset.url !== station.url) {
    frame.dataset.url = station.url;
    frame.src = station.url;
  }
  panel.hidden = false;
  renderSdrList();
  const entity = findSdrEntity(station.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 280000),
      duration: 0.9,
    });
  }
}

function closeSdr() {
  const frame = document.getElementById("sdr-frame");
  frame.src = "about:blank";
  frame.dataset.url = "";
  state.sdrOpenId = "";
  document.getElementById("sdr-listen").hidden = true;
  renderSdrList();
}

async function loadRadio() {
  const response = await fetch("/api/radio");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Uniden radio overlay failed");
  state.radioPoints = Array.isArray(body.points) ? body.points : [];
  state.radioCount = Number(body.count) || state.radioPoints.length;
  const count = document.getElementById("radio-count");
  if (count) count.textContent = String(state.radioCount);
  placeRadioPins(state.radioPoints);
  renderRadioList();
  const stamp = body.updated ? ` · ${body.updated}` : "";
  setStatus(`${state.radioCount} UNIDEN SITES${stamp} · ${state.radioPoints.length} ON GLOBE · ${body.source || "HPDB"}`);
}

function placeRadioPins(points) {
  if (!state.viewer || !state.radioSource) return;
  state.radioSource.entities.removeAll();
  const gold = Cesium.Color.fromCssColorString("#f5c542");
  const outline = Cesium.Color.fromCssColorString("#2a1c04");
  for (const site of points) {
    if (site.lat == null || site.lon == null) continue;
    const entity = state.radioSource.entities.add({
      name: site.name,
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0),
      point: {
        pixelSize: site.n > 20 ? 8 : 5,
        color: gold,
        outlineColor: outline,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.2, 8e6, 0.45),
      },
    });
    entity._radio = site;
  }
}

function renderRadioList() {
  const list = document.getElementById("radio-list");
  if (!list) return;
  const query = (document.getElementById("radio-filter").value || "").trim().toLowerCase();
  const sites = state.radioPoints
    .filter((site) => {
      if (!query) return true;
      const hay = `${site.name} ${site.mode} ${(site.mhz || []).join(" ")}`.toLowerCase();
      return hay.includes(query);
    })
    .slice()
    .sort((a, b) => (b.n || 0) - (a.n || 0) || a.name.localeCompare(b.name))
    .slice(0, 500);
  list.innerHTML = "";
  for (const site of sites) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "radio-row";
    if (site.id === state.radioOpenId) row.classList.add("on");
    const mhz = (site.mhz || []).map((m) => `${m} MHz`).join(" · ");
    row.innerHTML = `<div class="name">${esc(site.name)}</div><div class="host">${esc(site.mode || "HPDB")} · ${site.n || 0} freqs${mhz ? " · " + esc(mhz) : ""}</div>`;
    row.addEventListener("click", () => openRadio(site, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "radio") {
    document.getElementById("feed-title").textContent = `RADIO ${state.radioCount || state.radioPoints.length}`;
  }
}

function findRadioEntity(id) {
  if (!state.radioSource) return null;
  for (const entity of state.radioSource.entities.values) {
    if (entity._radio && entity._radio.id === id) return entity;
  }
  return null;
}

async function loadStreams() {
  const response = await fetch("/api/streams");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Stream overlay failed");
  state.streamPoints = Array.isArray(body.points) ? body.points : [];
  const count = document.getElementById("stream-count");
  if (count) count.textContent = String(state.streamPoints.length);
  placeStreamPins(state.streamPoints);
  renderStreamList();
}

function placeStreamPins(points) {
  if (!state.viewer || !state.streamSource) return;
  state.streamSource.entities.removeAll();
  const color = Cesium.Color.fromCssColorString("#c084fc");
  const outline = Cesium.Color.fromCssColorString("#2a1038");
  for (const site of points) {
    if (site.lat == null || site.lon == null) continue;
    const entity = state.streamSource.entities.add({
      name: site.name,
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0),
      point: {
        pixelSize: site.online === false ? 6 : 8,
        color: site.online === false ? color.withAlpha(0.35) : color,
        outlineColor: outline,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.25, 8e6, 0.5),
      },
    });
    entity._stream = site;
  }
}

function renderStreamList() {
  const list = document.getElementById("stream-list");
  if (!list) return;
  const query = (document.getElementById("stream-filter").value || "").trim().toLowerCase();
  const sites = state.streamPoints
    .filter((site) => {
      if (!query) return true;
      const hay = `${site.name} ${site.county} ${site.state} ${site.source} ${site.hpdbName || ""}`.toLowerCase();
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
    const where = [site.county, site.state, site.source].filter(Boolean).join(" · ");
    row.innerHTML = `<div class="name">${esc(site.name)}</div><div class="host">${esc(where)}${site.listeners ? " · " + site.listeners + " listening" : ""}${site.hpdbName ? " · HPDB " + esc(site.hpdbName) : ""}</div>`;
    row.addEventListener("click", () => openStream(site, { fly: true }));
    list.append(row);
  }
  if (state.feedMode === "stream") {
    document.getElementById("feed-title").textContent = `STREAM ${state.streamPoints.length}`;
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
  state.streamOpenId = site.id;
  setFeedMode("stream");
  const box = document.getElementById("selected");
  box.hidden = false;
  const match = site.hpdbName ? ` · HPDB ${site.hpdbName}` : "";
  box.innerHTML = `<b>STREAM</b> ${esc(site.name)}<br>${esc(site.source || "")} · ${esc(site.county || "")} ${esc(site.state || "")}${match}<br>${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`;
  renderStreamList();
  const entity = findStreamEntity(site.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 180000),
      duration: 0.9,
    });
  }
  const panel = document.getElementById("sdr-listen");
  document.getElementById("sdr-title").textContent = site.name;
  document.getElementById("sdr-meta").textContent = [site.county, site.state, site.source, site.hpdbName].filter(Boolean).join(" · ");
  const pop = document.getElementById("sdr-pop");
  pop.href = site.url;
  const frame = document.getElementById("sdr-frame");
  if (frame.dataset.url !== site.url) {
    frame.dataset.url = site.url;
    frame.src = site.url;
  }
  panel.hidden = false;
}

function openRadio(site, options = {}) {
  if (!site) return;
  closeSdr();
  state.radioOpenId = site.id;
  setFeedMode("radio");
  const mhz = (site.mhz || []).map((m) => `${m} MHz`).join(" · ");
  const box = document.getElementById("selected");
  box.hidden = false;
  box.innerHTML = `<b>RADIO</b> ${esc(site.name)}<br>${esc(site.mode || "HPDB")} · ${site.n || 0} freqs<br>${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}${mhz ? "<br>" + esc(mhz) : ""}`;
  renderRadioList();
  const entity = findRadioEntity(site.id);
  if (entity && state.viewer && state.viewer.selectedEntity !== entity) {
    state.viewer.selectedEntity = entity;
  }
  if (options.fly && state.viewer) {
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 180000),
      duration: 0.9,
    });
  }
}

const LIVE_STYLE = {
  jamming: { color: "#ff7a3a", outline: "#3a1508", size: (p) => (p.pct > 80 ? 9 : 6), kind: "GPS JAM" },
  aircraft: { color: "#7ec8ff", outline: "#082033", size: () => 5, kind: "ADS-B" },
  ships: { color: "#3dffd0", outline: "#083028", size: () => 5, kind: "AIS" },
  conflicts: { color: "#ff3b6b", outline: "#3a0814", size: () => 11, kind: "CFR WAR" },
};

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

async function pollLiveFeeds() {
  const data = await fetch("/api/feeds").then((response) => response.json());
  for (const key of ["jamming", "aircraft", "ships", "conflicts"]) {
    const layer = data[key] || {};
    state.live[key].points = layer.points || [];
    const n = document.getElementById(`n-${key}`);
    if (n) n.textContent = String(layer.count ?? state.live[key].points.length);
    placeLiveLayer(key, state.live[key].points);
  }
  statusLive();
}

function placeLiveLayer(key, points) {
  const layer = state.live[key];
  if (!layer?.source) return;
  const shown = layer.source.show;
  layer.source.entities.removeAll();
  layer.source.show = shown;
  const base = LIVE_STYLE[key];
  for (const point of points) {
    if (point.lat == null || point.lon == null) continue;
    const style = key === "aircraft" ? aircraftStyle(point) : {
      color: base.color,
      outline: base.outline,
      size: base.size(point),
      kind: base.kind,
    };
    const height = key === "aircraft" ? Number(point.altM) || 0 : 0;
    const entity = layer.source.entities.add({
      name: point.name,
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, height),
      point: {
        pixelSize: style.size,
        color: Cesium.Color.fromCssColorString(style.color),
        outlineColor: Cesium.Color.fromCssColorString(style.outline),
        outlineWidth: 1,
        disableDepthTestDistance: key === "aircraft" ? 0 : Number.POSITIVE_INFINITY,
      },
    });
    entity._live = { ...point, kind: style.kind, layer: key };
  }
}

function showLive(item) {
  const box = document.getElementById("selected");
  box.hidden = false;
  let extra = "";
  if (item.url) extra = `<br><a href="${esc(item.url)}" target="_blank" rel="noreferrer">CFR briefing</a>`;
  else if (item.pct != null) extra = `<br>${item.pct}% bad NACp · ${item.bad || 0} degraded`;
  else if (item.layer === "aircraft") {
    const bits = [];
    if (item.hex) bits.push(item.hex);
    if (item.t) bits.push(item.t);
    if (item.r) bits.push(item.r);
    if (item.squawk) bits.push(`sqk ${item.squawk}`);
    extra = bits.length ? `<br>${esc(bits.join(" · "))}` : "";
    extra += `<br>alt ${esc(item.alt ?? "—")} ft · ${esc(item.gs ?? "—")} kt · hdg ${esc(item.track || 0)}`;
    const flags = ["mil", "ladd", "pia", "emergency"].filter((k) => item[k]);
    if (flags.length) extra += `<br>${esc(flags.join(" · "))}`;
  } else if (item.sog != null) extra = `<br>sog ${esc(item.sog)} kn`;
  box.innerHTML = `<b>${esc(item.kind)}</b> ${esc(item.name)}<br>${Number(item.lat).toFixed(2)}, ${Number(item.lon).toFixed(2)}${extra}`;
}

function statusLive() {
  const jam = document.getElementById("n-jamming")?.textContent || "0";
  const air = document.getElementById("n-aircraft")?.textContent || "0";
  const ais = document.getElementById("n-ships")?.textContent || "0";
  const war = document.getElementById("n-conflicts")?.textContent || "0";
  setStatus(
    `${state.sdrStations.length} WEBSDR · ${state.radioCount || 0} RADIO · ${state.streamPoints.length} STREAMS · JAM ${jam} · AIR ${air} · AIS ${ais} · WAR ${war}`,
  );
}

boot().catch((error) => setStatus(error.message || String(error)));
