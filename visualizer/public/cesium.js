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
};

const COLORS = {
  up: Cesium.Color.fromCssColorString("#3dff9a"),
  down: Cesium.Color.fromCssColorString("#ff4d4d"),
  pending: Cesium.Color.fromCssColorString("#ffb020"),
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
  connectEvents();
  tickClock();
}

async function startGlobe() {
  const imagery = await Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
  );
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
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#070b10");
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#10202c");
  viewer.scene.globe.enableLighting = false;
  state.viewer = viewer;
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity || entity._resultIndex == null) return;
    const result = state.results[entity._resultIndex];
    if (result) showSelected(result);
  });
}

function renderSearches(catalog) {
  const nav = document.getElementById("searches");
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
  for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
      for (const other of document.querySelectorAll(".chip")) other.classList.remove("on");
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
    return;
  }
  entity.position = position;
  entity.point.pixelSize = result.status === "down" ? 11 : 8;
  entity.point.color = color;
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

boot().catch((error) => setStatus(error.message || String(error)));
