/* Global Status · COMMUNITY FEED category (GS-59)
 *
 * A viewer for the opt-in Share Live Feed (GS-58). Reads GET /api/community/feed
 * (points already tagged source=contributor) and does not talk to USB, a worker
 * or the microphone.
 *
 * In the LAYERS picker and the sidebar this category sits between SDR & MESH and
 * GRID TESTER. When only these switches are on, the globe shows contributor data
 * only. When a matching regular layer is also on, those targets are gap-filled
 * there and this category skips any id the regular layer already has, so nothing
 * is drawn twice.
 *
 * Pin cards reuse the shared #selected card (scrolls, × close, no links).
 * Original code for Global Status App.
 */
(function (root) {
  "use strict";
  const V = "20261128n";
  const COLOR = "#c084fc";
  const POLL_MS = 20000;
  const LAYERS = [
    { key: "adsb", name: "COMMUNITY ADS-B AIRCRAFT", regular: "aircraft", sw: "#38bdf8", desc: "1090 MHz ADS-B aircraft shared from users' devices" },
    { key: "uat", name: "COMMUNITY UAT AIRCRAFT", regular: "aircraft", sw: "#7dd3fc", desc: "978 MHz UAT aircraft shared from users' devices" },
    { key: "ais", name: "COMMUNITY AIS VESSELS", regular: "ships", sw: "#a5b4fc", desc: "Marine AIS vessels shared from users' devices" },
    { key: "mesh", name: "COMMUNITY MESH NODES", regular: "mesh", sw: "#c4b5fd", desc: "Meshtastic, MeshCore and LoRa nodes shared from users' devices" },
    { key: "aprs", name: "COMMUNITY APRS STATIONS", regular: "", sw: "#fbbf24", desc: "APRS station positions shared from users' devices" },
    { key: "sonde", name: "COMMUNITY WEATHER BALLOONS", regular: "", sw: "#f0abfc", desc: "Radiosonde balloons shared from users' devices" },
    { key: "acars", name: "COMMUNITY ACARS / VDL2", regular: "", sw: "#fda4af", desc: "ACARS and VDL2 aircraft positions only, no message text" },
    { key: "hd", name: "COMMUNITY HD RADIO TOWERS", regular: "amfm", sw: "#f9a8d4", desc: "HD Radio towers shared from users' devices" },
  ];
  const BYKEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
  const REGULAR = { adsb: "aircraft", uat: "aircraft", ais: "ships", mesh: "mesh", hd: "amfm" };

  const st = {
    layers: Object.fromEntries(LAYERS.map((l) => [l.key, false])),
    source: null,
    points: [],
    testPoints: null,
    timer: 0,
    at: 0,
    viewerFn: null,
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function regularOn(key) {
    const layer = REGULAR[key];
    if (!layer) return false;
    const btn = document.querySelector('[data-layer-toggle="' + layer + '"]');
    return Boolean(btn && btn.getAttribute("aria-pressed") === "true");
  }
  function takenKeys(key) {
    const layer = REGULAR[key];
    if (!layer || !regularOn(key) || typeof root.gsLiveIdentityKeys !== "function") return new Set();
    return root.gsLiveIdentityKeys(layer) || new Set();
  }
  function pointTaken(p, taken) {
    if (!taken || !taken.size) return false;
    const k = p.k;
    if (k === "adsb" || k === "uat" || k === "acars") {
      return taken.has(String(p.id || "").toLowerCase()) || taken.has(String(p.id || "").toUpperCase());
    }
    if (k === "ais") return taken.has(String(p.id || ""));
    if (k === "hd") {
      const id = String(p.id || "").toUpperCase();
      const name = String(p.name || "").toLowerCase();
      return taken.has(id) || (name && taken.has(name));
    }
    if (k === "mesh") {
      const id = String(p.id || "").toLowerCase();
      if (taken.has(id) || taken.has(id.replace(/^!/, "")) || taken.has("!" + id.replace(/^!/, ""))) return true;
      const hex = id.replace(/^!/, "");
      if (/^[0-9a-f]{8}$/.test(hex) && taken.has(String(parseInt(hex, 16)))) return true;
    }
    return false;
  }
  function visibleOf(key, points) {
    if (!st.layers[key]) return [];
    const taken = takenKeys(key);
    return points.filter((p) => p.k === key && !pointTaken(p, taken));
  }
  function labelOf(p) {
    if (p.call) return String(p.call);
    if (p.k === "adsb" || p.k === "uat") return String(p.id || "").toUpperCase();
    return String(p.name || p.id || "");
  }

  function pickerHtml() {
    const rows = LAYERS.map((l) =>
      `<button type="button" class="welcome-xl gsc-layer" data-welcome-cf="${l.key}" aria-pressed="false" title="${esc(l.desc)}">` +
      `<span class="welcome-layer-name">${esc(l.name)}</span><em class="welcome-xl-count" data-cf-count="${l.key}">—</em>` +
      `<span class="switch" aria-hidden="true"></span></button>`).join("");
    return rows +
      `<p class="gsr-note gsc-note" data-cf-ui>When this is the only category on, the map shows only live data people opted to share. Turn on LIVE AIR TRAFFIC, GLOBAL MARITIME TRAFFIC, GLOBAL MESH NODES or GLOBAL AM FM TOWERS as well and missing targets are added there too.</p>` +
      `<p class="gsr-note gsc-note" data-cf-ui>Pagers, tire sensors, Bluetooth, meters, radio GPS units and audio are never shared or shown here.</p>`;
  }
  function railHtml() {
    const rows = LAYERS.map((l) =>
      `<button type="button" class="layer gsc-rail-layer" data-cf-toggle="${l.key}" aria-pressed="false" title="${esc(l.desc)}">` +
      `<span class="layer-name"><span class="swatch" style="background:${l.sw}"></span> ${esc(l.name)}</span>` +
      `<span class="layer-meta"><em data-cf-count="${l.key}">—</em><span class="switch" aria-hidden="true"></span></span></button>`).join("");
    return rows + `<p class="sw-note gsr-note gsc-note" data-cf-ui>Contributor-only view of the live share feed.</p>`;
  }
  function buildRail() {
    const g = document.getElementById("group-community");
    if (g && !g.querySelector("[data-cf-toggle]")) g.insertAdjacentHTML("beforeend", railHtml());
  }

  function setText(sel, text) {
    for (const n of document.querySelectorAll(sel)) if (n.textContent !== text) n.textContent = text;
  }
  function render() {
    for (const l of LAYERS) {
      const on = Boolean(st.layers[l.key]);
      const n = visibleOf(l.key, st.points).length;
      const label = on ? String(n) : "—";
      for (const b of document.querySelectorAll(`[data-welcome-cf="${l.key}"], [data-cf-toggle="${l.key}"]`)) {
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      setText(`[data-cf-count="${l.key}"]`, label);
    }
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    if (root.GsaWelcome && root.GsaWelcome.syncCategoryIcons) root.GsaWelcome.syncCategoryIcons();
  }

  function asLive(p) {
    return {
      ...p,
      name: p.name || labelOf(p),
      hex: (p.k === "adsb" || p.k === "uat" || (p.k === "acars" && /^[0-9a-f]{6}$/i.test(p.id || ""))) ? String(p.id).toLowerCase() : undefined,
      mmsi: p.k === "ais" ? String(p.id) : undefined,
      community: true,
      source: "contributor",
      communityView: true,
      kind: "COMMUNITY SDR",
      layer: "community:" + p.k,
      k: p.k,
      // Never pass the blurred receiver coordinate through to the card as a pin.
      rx: undefined,
    };
  }

  function ensureSource() {
    const viewer = st.viewerFn && st.viewerFn();
    const Cs = root.Cesium;
    if (!viewer || !Cs || st.source) return st.source;
    st.source = new Cs.CustomDataSource("community-feed");
    viewer.dataSources.add(st.source);
    return st.source;
  }
  function draw() {
    const src = ensureSource();
    if (!src) { render(); return; }
    const Cs = root.Cesium;
    src.entities.removeAll();
    const anyOn = LAYERS.some((l) => st.layers[l.key]);
    src.show = anyOn;
    if (!anyOn) { render(); return; }
    for (const l of LAYERS) {
      for (const p of visibleOf(l.key, st.points)) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        const live = asLive(p);
        const entity = src.entities.add({
          name: live.name,
          position: Cs.Cartesian3.fromDegrees(p.lon, p.lat, Number(p.altM) || 0),
          point: {
            pixelSize: 10,
            color: Cs.Color.fromCssColorString(COLOR),
            outlineColor: Cs.Color.fromCssColorString("#0f172a"),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: String(labelOf(p)).slice(0, 18),
            font: "11px sans-serif",
            fillColor: Cs.Color.fromCssColorString("#e2e8f0"),
            outlineColor: Cs.Color.fromCssColorString("#0f172a"),
            outlineWidth: 3,
            style: Cs.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cs.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        entity._live = live;
      }
    }
    render();
  }

  async function poll() {
    const keys = LAYERS.filter((l) => st.layers[l.key]).map((l) => l.key);
    if (!keys.length) { st.points = st.testPoints || []; draw(); return; }
    if (st.testPoints) { st.points = st.testPoints; draw(); return; }
    try {
      const res = await fetch("/api/community/feed?k=" + keys.join(","));
      const body = await res.json();
      const pts = Array.isArray(body.points) ? body.points : [];
      st.points = pts.filter((p) => p && p.source === "contributor" && BYKEY[p.k]);
      st.at = Date.now();
    } catch (e) {
      st.at = Date.now();
    }
    draw();
  }
  function startPoll() {
    if (!st.timer) st.timer = setInterval(poll, POLL_MS);
  }
  function stopPollIfIdle() {
    if (LAYERS.some((l) => st.layers[l.key])) return;
    if (st.timer) { clearInterval(st.timer); st.timer = 0; }
    st.points = st.testPoints || [];
    draw();
  }
  function setLayer(key, on) {
    if (!BYKEY[key]) return;
    st.layers[key] = Boolean(on);
    if (LAYERS.some((l) => st.layers[l.key])) {
      startPoll();
      poll();
    } else {
      stopPollIfIdle();
    }
  }

  function onClick(event) {
    const b = event.target.closest("[data-welcome-cf], [data-cf-toggle]");
    if (!b) return;
    const key = b.dataset.welcomeCf || b.dataset.cfToggle;
    if (!key || !BYKEY[key]) return;
    event.preventDefault();
    setLayer(key, !st.layers[key]);
  }

  function init(opts) {
    st.viewerFn = opts && opts.viewer;
    buildRail();
    document.addEventListener("click", onClick);
    ensureSource();
    render();
  }
  function clearAll() {
    for (const l of LAYERS) st.layers[l.key] = false;
    stopPollIfIdle();
  }
  function syncRegular() {
    if (LAYERS.some((l) => st.layers[l.key])) draw();
  }

  root.GsaCommunity = {
    init, pickerHtml, railHtml, render, clearAll, syncRegular, setLayer,
    isOn: (k) => Boolean(st.layers[k]),
    version: V,
  };
  root.__gsCommunityInject = function (points) {
    st.testPoints = Array.isArray(points) ? points : null;
    if (st.testPoints) st.points = st.testPoints;
    draw();
  };
})(window);
