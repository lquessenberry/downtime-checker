/* Global Status · SDR category + SDR Workbench (Phase 1 + Phase 2, receive only)
 *
 * - SDR category in the LAYERS picker (welcome.js) and the sidebar (#group-sdr): a device
 *   connection bar, thirteen uniform full-width map layer switches and a compare note.
 * - SDR Workbench popup: Tuner & Waterfall, Spectrum / Looking Glass, Pagers, Devices, Bluetooth,
 *   Voice & Ham, Trains / Cell / TV, Capture, Log.
 * - There is no transmit code anywhere in the SDR category.
 * - One radio hears one band at a time: switching a map layer on tunes the radio to it; the
 *   other band layers keep their pins and show PAUSED until the radio is tuned back.
 * Nothing runs until the user clicks Connect SDR: no USB calls, no Web Worker, no AudioContext,
 * no location prompt.
 * Connect Mesh (mesh-device.js, loaded on the first click) reads a real Meshtastic or MeshCore
 * radio over USB or Bluetooth. While one is connected it is the only source for LOCAL MESH
 * NODES; SDR over-the-air mesh decodes are skipped and the SDR keeps every other band.
 * Pin cards use the shared #selected card and are plain text only (no links).
 * Original code for Global Status App.
 */
(function (root) {
  "use strict";
  const V = "20261128mesh2";
  const D = () => root.GsaSdrDriver;
  const L = () => root.GsaSdrLayers;

  const LAYERS = [
    { key: "adsb", name: "LOCAL ADS-B AIRCRAFT", tune: 1090e6, mode: "AM", ttl: 120e3, sw: "#38bdf8", desc: "1090 MHz Mode-S / ADS-B from aircraft your antenna hears" },
    { key: "ais", name: "LOCAL AIS VESSELS", tune: 162.0e6, mode: "NFM", ttl: 30 * 60e3, sw: "#a5b4fc", desc: "Marine AIS on 161.975 and 162.025 MHz" },
    { key: "aprs", name: "LOCAL APRS STATIONS", tune: 144.39e6, mode: "NFM", ttl: 60 * 60e3, sw: "#fbbf24", bands: ["aprs", "ft8"], desc: "2 m APRS packet positions (144.390 MHz; 144.800 MHz in Europe) plus FT8 / JS8 grid spots when tuned to an FT8 or JS8 frequency" },
    { key: "sonde", name: "LOCAL WEATHER BALLOONS", tune: 403.0e6, mode: "NFM", ttl: 30 * 60e3, sw: "#f0abfc", desc: "Radiosondes (RS41 and DFM) on 400-406 MHz with temperature, humidity and predicted landing" },
    { key: "mesh", name: "LOCAL MESH NODES", tune: 906.875e6, mode: "NFM", ttl: 2 * 3600e3, sw: "#c4b5fd", desc: "Meshtastic, MeshCore and LoRa nodes your antenna hears (906.875 / 915 / 868 MHz presets)" },
    { key: "uat", name: "LOCAL UAT AIRCRAFT", tune: 978e6, mode: "AM", ttl: 120e3, sw: "#7dd3fc", desc: "978 MHz UAT aircraft plus FIS-B ground towers and airport weather" },
    { key: "acars", name: "LOCAL ACARS / VDL2", tune: 131.55e6, mode: "AM", ttl: 30 * 60e3, sw: "#fda4af", bands: ["acars", "vdl2"], desc: "Aircraft ACARS (131.550 MHz) and VDL2 (136.975 MHz): positions, ground stations and messages" },
    { key: "dispatch", name: "LOCAL RADIO GPS UNITS", tune: 460.0e6, mode: "NFM", ttl: 30 * 60e3, sw: "#fb923c", desc: "GPS reports from P25, DMR, NXDN and TETRA radios (location data only)" },
    { key: "meter", name: "LOCAL UTILITY METERS", tune: 912.6e6, mode: "AM", ttl: 60 * 60e3, sw: "#fcd34d", desc: "ERT smart meters (910-920 MHz); meters do not send their location, so pins are placed approximately near your receiver" },
    { key: "hd", name: "LOCAL HD RADIO TOWERS", tune: 100.1e6, mode: "WFM", ttl: 6 * 3600e3, sw: "#f9a8d4", bands: ["fm"], desc: "FM stations carrying HD Radio digital sidebands, with tower location when the station sends it" },
    { key: "sat", name: "AMATEUR SATELLITES (DOPPLER)", tune: 0, ttl: 10 * 60e3, sw: "#93c5fd", desc: "Amateur radio satellites overhead with Doppler-corrected downlink frequencies (works without a radio)" },
    { key: "lte", name: "LTE ALERT AREAS", tune: 751e6, mode: "NFM", ttl: 3 * 3600e3, sw: "#f87171", desc: "Wireless Emergency Alert and ETWS areas plus LTE cells your antenna hears" },
    { key: "range", name: "RECEIVER RANGE / LIVE SIGNAL", tune: 0, sw: "#7dd3fc", desc: "Range rings around your receiver and the farthest signal decoded" },
  ];
  const BYKEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
  const MAPKEYS = LAYERS.filter((l) => l.key !== "range").map((l) => l.key);
  const PRESETS = [
    { id: "fm", label: "FM", hz: 100.1e6, mode: "WFM" },
    { id: "air", label: "Airband", hz: 121.5e6, mode: "AM" },
    { id: "aprs", label: "2m APRS", hz: 144.39e6, mode: "NFM" },
    { id: "ais", label: "Marine AIS", hz: 162.0e6, mode: "NFM" },
    { id: "70cm", label: "70cm", hz: 446.0e6, mode: "NFM" },
    { id: "sonde", label: "403 Sondes", hz: 403.0e6, mode: "NFM" },
    { id: "ism", label: "433 ISM", hz: 433.92e6, mode: "AM" },
    { id: "pager", label: "Pagers 929", hz: 929.6125e6, mode: "NFM" },
    { id: "adsb", label: "1090 ADS-B", hz: 1090e6, mode: "AM" },
    { id: "mesh", label: "Mesh 906.875", hz: 906.875e6, mode: "NFM" },
    { id: "uat", label: "UAT 978", hz: 978e6, mode: "AM" },
    { id: "acars", label: "ACARS 131.55", hz: 131.55e6, mode: "AM" },
    { id: "dispatch", label: "Dispatch", hz: 460.0e6, mode: "NFM" },
    { id: "sats", label: "Satellites", hz: 145.8e6, mode: "NFM" },
    { id: "cb", label: "CB 27.185", hz: 27.185e6, mode: "AM" },
    { id: "gmrs", label: "GMRS/FRS", hz: 462.5625e6, mode: "NFM" },
    { id: "murs", label: "MURS", hz: 151.82e6, mode: "NFM" },
    { id: "atsc", label: "ATSC TV", hz: 470.309441e6, mode: "NFM" },
    { id: "ble", label: "BLE 2402", hz: 2402e6, mode: "NFM" },
  ];
  const MODES = ["WFM", "NFM", "AM", "USB", "LSB"];
  const SHIPTYPES = [[20, 29, "Wing in ground"], [30, 30, "Fishing"], [31, 32, "Towing"], [33, 33, "Dredging"], [34, 34, "Diving"], [35, 35, "Military"], [36, 36, "Sailing"], [37, 37, "Pleasure craft"], [40, 49, "High speed craft"], [50, 50, "Pilot"], [51, 51, "Search and rescue"], [52, 52, "Tug"], [53, 53, "Port tender"], [55, 55, "Law enforcement"], [58, 58, "Medical"], [60, 69, "Passenger"], [70, 79, "Cargo"], [80, 89, "Tanker"], [90, 99, "Other"]];
  const APRS_SYMBOLS = { "/>": "Car", "/#": "Digipeater", "/_": "Weather station", "/-": "House", "/k": "Truck", "/[": "Person", "/O": "Balloon", "/Y": "Sailboat", "/s": "Boat", "/v": "Van", "/j": "Jeep", "/'": "Small aircraft", "/^": "Aircraft", "/u": "Truck", "/b": "Bicycle", "/r": "Repeater", "/&": "Gateway" };

  // ------------------------------------------------------------------ state
  const st = {
    dev: null, connecting: false, worker: null, audio: null, audioNext: 0,
    tuned: 100.1e6, tunerHz: 100.1e6, center: 0, rate: 0, mode: "WFM", gain: 62, squelch: -60, muted: true, scan: false,
    layers: Object.fromEntries(LAYERS.map((l) => [l.key, false])), order: [],
    targets: Object.fromEntries(MAPKEYS.map((k) => [k, new Map()])),
    ble: [], trains: [], cells: [], alerts: [], acarsMsgs: [], bursts: [], act: [], actFloor: -100, atsc: {}, hdSide: null,
    sweep: null, zspan: [], satTrack: null, satInfo: null, airports: null, airportsLoading: false,
    pagers: [], devices: [], log: [], health: null, cap: { on: false, bytes: 0, secs: 0 }, level: -120,
    wb: null, wbOpen: false, tab: "tuner", rx: null, awaitingPin: false, message: "", msgKind: "", biasArmed: false,
    portapackSerial: false, step: 12500, fftRow: null, wfFloor: -95, stats: { workers: 0, usbCalls: 0, audioCtx: 0 },
    lastCardId: "", support: null, sim: false, queue: Promise.resolve(),
    share: { on: false, armed: false, timer: 0, busy: false, sent: 0, lastAt: 0, lastCount: 0, note: "", wait: 0 },
    mesh: { dev: null, sess: null, connecting: false, choosing: false, message: "", msgKind: "", info: {}, lora: null, channels: [], messages: [], nodes: new Map(), myId: "", sim: null, ready: false, otaSkipped: 0, filter: "" },
  };

  const SHARE_OFF_NOTE = "Off. Turn on to share the aircraft, ships, mesh nodes, APRS stations, weather balloons, ACARS positions and HD Radio towers your radio decodes live with everyone on the site (COMMUNITY FEED and the matching regular layers). Pagers, tire sensors, Bluetooth, meters, radio GPS units, mesh messages and audio are never shared. Your receiver location is blurred to about 25 km.";
  const URLISH = /(https?:\/\/|www\.)\S*|tel:\S*|mailto:\S*/gi;
  function plain(v) { return String(v == null ? "" : v).replace(/<[^>]*>/g, " ").replace(URLISH, "").replace(/\s+/g, " ").trim(); }
  function esc(v) { return plain(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const mhz = (hz) => (hz / 1e6).toFixed(hz >= 1e9 ? 3 : 4);
  function bandOf(hz) { // keep in step with sdr-dsp.worker.js
    const m = hz / 1e6, near = (f, t) => Math.abs(m - f) <= t;
    if (near(1090, 1.2)) return "adsb";
    if (near(978, 1.2)) return "uat";
    if (m >= 161.9 && m <= 162.1) return "ais";
    if (near(144.39, 0.02) || near(144.8, 0.02)) return "aprs";
    if ([1.84, 3.573, 7.074, 10.136, 14.074, 18.1, 21.074, 24.915, 28.074, 50.313, 3.578, 7.078, 14.078, 21.078, 28.078].some((f) => near(f, 0.004))) return "ft8";
    if (m >= 400 && m <= 406.1) return "sonde";
    if (near(457.9375, 0.006) || near(452.9375, 0.006)) return "train";
    if ([151.82, 151.88, 151.94, 154.57, 154.6].some((f) => near(f, 0.006))) return "voice";
    if ((m >= 152 && m <= 159) || (m >= 929 && m <= 932) || (m >= 466 && m <= 466.3)) return "pager";
    if (m >= 129 && m <= 132) return "acars";
    if (m >= 136.6 && m < 137) return "vdl2";
    if ((m >= 137 && m <= 138) || (m >= 145.8 && m <= 146) || (m >= 435 && m <= 438)) return "sat";
    if (near(908.42, 0.05) || near(868.42, 0.05) || near(916, 0.05)) return "zwave";
    if (near(906.875, 0.3) || near(915, 0.15) || (m >= 868 && m <= 870) || near(910.525, 0.05)) return "mesh";
    if (m >= 910 && m <= 920) return "meter";
    if (m >= 2400 && m <= 2483.5) return "ble";
    if ((m >= 617 && m <= 652) || (m >= 729 && m <= 756) || (m >= 869 && m <= 894) || (m >= 1805 && m <= 1880) || (m >= 1930 && m <= 1995) || (m >= 2110 && m <= 2200)) return "lte";
    if ((m >= 470 && m <= 608) || (m >= 174 && m <= 216)) return "atsc";
    if (near(433.92, 0.15) || near(315, 0.15) || near(345, 0.15) || near(319.5, 0.15)) return "tpms";
    if ((m >= 26.96 && m <= 27.41) || (m >= 462.55 && m <= 462.73) || (m >= 467.55 && m <= 467.73) || (m >= 144 && m <= 148) || (m >= 420 && m <= 450) || (m >= 28 && m <= 29.7) || (m >= 50 && m <= 54)) return "voice";
    if ((m >= 450 && m <= 470) || (m >= 851 && m <= 869) || (m >= 380 && m <= 400) || (m >= 769 && m <= 775) || (m >= 806 && m <= 824) || (m >= 159 && m <= 174)) return "dispatch";
    if (m >= 87.5 && m <= 108.1) return "fm";
    return "other";
  }
  const isHackrf = () => Boolean(st.dev) && (st.dev.kind === "hackrf" || (st.dev.sim && st.dev.version !== "R828D"));
  const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function addLog(text) { st.log.unshift({ t: nowTime(), text: plain(text) }); if (st.log.length > 200) st.log.length = 200; if (st.wbOpen && st.tab === "log") renderLog(); }
  function support() { return st.support || (st.support = D() ? D().support() : { ok: false, reason: "SDR driver missing." }); }
  function receiver() {
    if (st.rx) return st.rx;
    const o = root.GsaOrigin && root.GsaOrigin.get ? root.GsaOrigin.get() : null; // already-known position only, never prompts
    return o && Number.isFinite(o.lat) ? { lat: o.lat, lon: o.lon, name: o.label || "Your location" } : null;
  }

  // ------------------------------------------------------------------ markup (picker + sidebar)
  function barHtml(where) {
    return `<div class="gsr-bar" data-sdr-ui data-sdr-bar="${where}">` +
      `<div class="gsr-bar-head"><span class="gsr-dot" data-sdr-dot aria-hidden="true"></span><strong data-sdr-status>NO SDR CONNECTED</strong></div>` +
      `<p class="gsr-bar-sum" data-sdr-summary>Plug a HackRF, PortaPack or RTL-SDR into this device, then connect.</p>` +
      `<div class="gsr-bar-head"><span class="gsr-dot" data-mesh-dot aria-hidden="true"></span><strong data-mesh-status>NO MESH RADIO CONNECTED</strong></div>` +
      `<p class="gsr-bar-sum" data-mesh-summary>Plug in or pair a Meshtastic or MeshCore radio (USB or Bluetooth), then connect.</p>` +
      `<p class="gsr-bar-sum gsr-mesh-source" data-mesh-source>Mesh source: none yet</p>` +
      `<div class="gsr-bar-actions">` +
      `<button type="button" class="gsr-btn gsr-primary" data-sdr-act="connect">CONNECT SDR</button>` +
      `<button type="button" class="gsr-btn gsr-primary" data-sdr-act="mesh-connect">CONNECT MESH</button>` +
      `<div class="gsr-wide gsr-mesh-choose" data-mesh-choose hidden><button type="button" class="gsr-btn" data-sdr-act="mesh-usb">USB CABLE</button><button type="button" class="gsr-btn" data-sdr-act="mesh-ble">BLUETOOTH</button></div>` +
      `<button type="button" class="gsr-btn" data-sdr-act="bias" aria-pressed="false">BIAS-T OFF</button>` +
      `<button type="button" class="gsr-btn" data-sdr-act="mesh-tab">MESH RADIO</button>` +
      `<button type="button" class="gsr-btn gsr-wide" data-sdr-act="workbench">OPEN SDR WORKBENCH</button>` +
      `<button type="button" class="gsr-btn gsr-wide gsr-share" data-sdr-act="share" aria-pressed="false">SHARE LIVE FEED: OFF</button>` +
      `</div>` +
      `<p class="gsr-bar-note gsr-share-note" data-sdr-sharenote>${esc(SHARE_OFF_NOTE)}</p>` +
      `<p class="gsr-bar-warn" data-sdr-biasnote>Bias-T stays off. It sends DC power up the antenna cable (3.3 V HackRF / 4.5 V RTL-SDR Blog); only use it with a powered LNA or active antenna.</p>` +
      `<p class="gsr-bar-msg" data-sdr-msg hidden></p>` +
      `<p class="gsr-bar-msg" data-mesh-msg hidden></p>` +
      `</div>`;
  }
  function pickerHtml() {
    const rows = LAYERS.map((l) =>
      `<button type="button" class="welcome-xl gsr-layer" data-welcome-sdr="${l.key}" aria-pressed="false" title="${esc(l.desc)}">` +
      `<span class="welcome-layer-name">${esc(l.name)}</span><em class="welcome-xl-count" data-sdr-count="${l.key}">—</em>` +
      `<span class="switch" aria-hidden="true"></span></button>`).join("");
    return barHtml("picker") + rows +
      `<p class="gsr-note" data-sdr-ui data-sdr-bandnote>One radio hears one band at a time. The layer you switch on last is tuned; the others keep their pins and show PAUSED.</p>` +
      `<p class="gsr-note gsr-compare" data-sdr-ui>Keep LIVE AIR TRAFFIC, GLOBAL MARITIME TRAFFIC and GLOBAL MESH NODES on as well to compare what the internet reports with what your own antenna hears.</p>`;
  }
  function railHtml() {
    const rows = LAYERS.map((l) =>
      `<button type="button" class="layer gsr-rail-layer" data-sdr-toggle="${l.key}" aria-pressed="false" title="${esc(l.desc)}">` +
      `<span class="layer-name"><span class="swatch" style="background:${l.sw}"></span> ${esc(l.name)}</span>` +
      `<span class="layer-meta"><em data-sdr-count="${l.key}">—</em><span class="switch" aria-hidden="true"></span></span></button>`).join("");
    return barHtml("rail") + rows + `<p class="sw-note gsr-note" data-sdr-ui data-sdr-bandnote></p>`;
  }
  function buildRail() {
    const g = document.getElementById("group-sdr");
    if (g && !g.querySelector("[data-sdr-bar]")) g.insertAdjacentHTML("beforeend", railHtml());
  }

  // ------------------------------------------------------------------ render
  function setText(sel, text) { for (const n of document.querySelectorAll(sel)) if (n.textContent !== text) n.textContent = text; }
  // One radio, one band: a layer is live when the radio is tuned to one of its bands.
  function isLive(key) {
    const l = BYKEY[key];
    if (!l) return false;
    if (key === "sat") return Boolean(st.layers.sat);
    if (key === "mesh" && st.mesh.dev) return true; // the mesh radio is the mesh source
    if (!st.dev || !l.tune) return false;
    return (l.bands || [bandOf(l.tune)]).includes(bandOf(st.tuned));
  }
  function countText(key) {
    if (!st.layers[key]) return "—";
    if (key === "range") return receiver() ? "ON" : "TAP MAP";
    if (key === "sat") return st.satInfo ? String(visibleTargets("sat").filter((t) => t.visible).length || visibleTargets("sat").length) : "LOADING";
    if (key === "mesh" && st.mesh.dev) return String(visibleTargets("mesh").length);
    if (!st.dev) return "NO RADIO";
    if (!isLive(key)) return "PAUSED";
    return String(visibleTargets(key).length);
  }
  function render() {
    const sup = support();
    const live = Boolean(st.dev);
    for (const dot of document.querySelectorAll("[data-sdr-dot]")) { dot.classList.toggle("is-live", live); dot.classList.toggle("is-busy", st.connecting); }
    setText("[data-sdr-status]", st.connecting ? "CONNECTING…" : live ? (st.dev.name || "RADIO").toUpperCase() : sup.ok ? "NO SDR CONNECTED" : "USB SDRS NOT AVAILABLE HERE");
    let sum;
    if (!sup.ok) sum = sup.reason;
    else if (live) sum = `${mhz(st.tuned)} MHz · ${(st.rate / 1e6).toFixed(2)} MS/s · ${st.dev.gainText || "gain " + st.gain + "%"}${st.dev.biasT ? " · BIAS-T ON" : ""}`;
    else sum = "Plug a HackRF, PortaPack or RTL-SDR into this device, then connect.";
    setText("[data-sdr-summary]", sum);
    for (const b of document.querySelectorAll('[data-sdr-act="connect"]')) {
      b.disabled = !sup.ok || st.connecting;
      b.textContent = st.portapackSerial ? "SWITCH PORTAPACK" : live ? "DISCONNECT" : "CONNECT SDR";
      b.classList.toggle("gsr-primary", !live);
    }
    for (const b of document.querySelectorAll('[data-sdr-act="bias"]')) {
      const on = Boolean(st.dev && st.dev.biasT);
      b.disabled = !live;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = on ? "BIAS-T ON" : st.biasArmed ? "CONFIRM BIAS-T" : "BIAS-T OFF";
      b.classList.toggle("gsr-warn", on || st.biasArmed);
    }
    const volts = st.dev ? st.dev.biasVolts : "3.3 V HackRF / 4.5 V RTL-SDR Blog";
    setText("[data-sdr-biasnote]", st.biasArmed
      ? `Bias-T will send ${volts} DC up the antenna cable. Only use it with a powered LNA or active antenna. Tap CONFIRM BIAS-T to turn it on.`
      : st.dev && st.dev.biasT ? `Bias-T is ON (${volts} on the antenna port). Tap again to turn it off.`
        : "Bias-T stays off. It sends DC power up the antenna cable (3.3 V HackRF / 4.5 V RTL-SDR Blog); only use it with a powered LNA or active antenna.");
    for (const b of document.querySelectorAll('[data-sdr-act="share"]')) {
      b.setAttribute("aria-pressed", st.share.on ? "true" : "false");
      b.textContent = st.share.on ? "SHARE LIVE FEED: ON" : st.share.armed ? "CONFIRM SHARE LIVE FEED" : "SHARE LIVE FEED: OFF";
      b.classList.toggle("is-on", st.share.on);
      b.classList.toggle("gsr-warn", st.share.armed);
    }
    setText("[data-sdr-sharenote]", shareNote());
    for (const n of document.querySelectorAll("[data-sdr-msg]")) { n.hidden = !st.message; n.textContent = st.message; n.classList.toggle("is-error", st.msgKind === "error"); }
    for (const l of LAYERS) {
      const on = st.layers[l.key];
      for (const b of document.querySelectorAll(`[data-welcome-sdr="${l.key}"], [data-sdr-toggle="${l.key}"]`)) {
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.classList.toggle("on", on);
        b.classList.toggle("is-paused", on && l.tune > 0 && Boolean(st.dev) && !isLive(l.key));
      }
      setText(`[data-sdr-count="${l.key}"]`, countText(l.key));
    }
    setText("[data-sdr-bandnote]", bandNote());
    renderMeshBar();
    if (root.gsSyncLayerGroups) root.gsSyncLayerGroups();
    renderWorkbenchHead();
  }
  function bandNote() {
    const on = LAYERS.filter((l) => l.tune && st.layers[l.key] && !(l.key === "mesh" && st.mesh.dev));
    if (!st.dev) return on.length ? "Connect a radio and the layer you switched on last is tuned first." : "One radio hears one band at a time. The layer you switch on last is tuned; the others keep their pins and show PAUSED.";
    const live = on.filter((l) => isLive(l.key)).map((l) => l.name);
    const paused = on.filter((l) => !isLive(l.key)).map((l) => l.name);
    let s = `Tuned to ${mhz(st.tuned)} MHz${live.length ? " · " + live.join(", ") + " live" : ""}.`;
    if (paused.length) s += ` Paused, pins kept: ${paused.join(", ")}.`;
    return s;
  }

  // ------------------------------------------------------------------ radio + worker
  function serial(fn) { const p = st.queue.then(fn, fn); st.queue = p.catch(() => {}); return p; }
  function ensureWorker() {
    if (st.worker) return st.worker;
    st.worker = new Worker("/sdr-dsp.worker.js?v=" + V);
    st.stats.workers += 1;
    st.worker.onmessage = (ev) => onWorker(ev.data || {});
    st.worker.onerror = (e) => addLog("DSP worker error: " + (e.message || "unknown"));
    return st.worker;
  }
  function config(extra) {
    if (!st.worker) return;
    const rx = receiver();
    st.worker.postMessage(Object.assign({ t: "config", rate: st.rate, center: st.center, tuned: st.tuned, device: st.dev ? st.dev.kind : "", mode: st.mode, audioOn: !st.muted, squelch: st.squelch, volume: 0.8, ref: rx ? { lat: rx.lat, lon: rx.lon } : null }, extra || {}));
  }
  function setMessage(text, kind) { st.message = text || ""; st.msgKind = kind || ""; render(); }

  async function connectClick() {
    if (st.connecting) return;
    if (st.dev) { await disconnect(); return; }
    const sup = support();
    if (!sup.ok) return;
    if (st.portapackSerial) { await portapackSerial(); return; }
    st.connecting = true; setMessage("");
    let drv;
    try { st.stats.usbCalls += 1; drv = await D().request(); }
    catch (e) { st.connecting = false; setMessage(D().friendlyError(e), /No radio was picked/.test(D().friendlyError(e)) ? "" : "error"); return; }
    if (drv && drv.portapack) { await portapackSwitch(drv.dev); return; }
    await useDevice(drv);
  }
  async function portapackSwitch(dev) {
    setMessage("PortaPack found. Switching it to HackRF mode…");
    try { await D().portapackSwitchUsb(dev); }
    catch (e) {
      st.connecting = false;
      if (support().serial) { st.portapackSerial = true; setMessage("Tap SWITCH PORTAPACK and pick the PortaPack serial port to put it in HackRF mode."); }
      else setMessage("On the PortaPack, open the HackRF mode app, then tap Connect SDR and pick HackRF One.", "error");
      return;
    }
    await afterPortapack();
  }
  async function portapackSerial() {
    st.connecting = true; render();
    try { await D().portapackSwitchSerial(); st.portapackSerial = false; await afterPortapack(); }
    catch (e) { st.connecting = false; st.portapackSerial = false; setMessage("Couldn't reach the PortaPack. On it, open HackRF mode, then tap Connect SDR and pick HackRF One.", "error"); }
  }
  async function afterPortapack() {
    addLog("PortaPack sent the hackrf command; waiting for HackRF mode");
    const hr = await D().waitForHackrf(8000).catch(() => null);
    if (hr) { try { await useDevice(await D().openDevice(hr)); return; } catch (e) { /* fall through */ } }
    st.connecting = false;
    setMessage("PortaPack switched to HackRF mode. Tap Connect SDR again and pick HackRF One (if the screen did not change, open HackRF mode on the PortaPack).");
  }
  async function useDevice(drv) {
    st.dev = drv; st.connecting = false; st.biasArmed = false;
    st.message = "";
    ensureWorker();
    if (!drv.sim && root.navigator.usb && !st.usbWatch) {
      st.usbWatch = true;
      root.navigator.usb.addEventListener("disconnect", (ev) => { if (st.dev && st.dev.dev === ev.device) { addLog("Radio unplugged"); disconnect(true); } });
    }
    addLog(`Connected ${drv.name}${drv.version ? " (" + drv.version + ")" : ""}${drv.tuner ? " · tuner " + drv.tuner : ""}`);
    try {
      await serial(() => drv.setBiasT(false));
      await serial(() => drv.setGain(st.gain));
      const focus = focusLayer();
      await tune(focus ? focus.tune : st.tunerHz, { mode: focus ? focus.mode : st.mode, quiet: true });
      await serial(() => drv.start((buf) => onSamples(buf), (n, err) => onDrop(n, err)));
      if (drv.sim) st.worker.postMessage({ t: "sim", on: true, rx: receiver() });
    } catch (e) { addLog("Start failed: " + D().friendlyError(e, drv.kind)); setMessage(D().friendlyError(e, drv.kind), "error"); await disconnect(true); return; }
    render();
  }
  function onSamples(buf) { if (st.worker) st.worker.postMessage({ t: "iq", buf, fmt: st.dev ? st.dev.fmt : "s8" }, [buf]); }
  function onDrop(n, err) { if (st.worker) st.worker.postMessage({ t: "drop", n }); if (err) { addLog("USB stream stopped: " + D().friendlyError(err)); disconnect(true); } }
  async function disconnect(silent) {
    const d = st.dev;
    st.dev = null; st.connecting = false; st.scan = false; st.biasArmed = false;
    if (st.worker) st.worker.postMessage({ t: "sim", on: false });
    if (d) { try { await d.close(); } catch (e) { /* already gone */ } if (!silent) addLog("Disconnected " + d.name); }
    render();
    renderWorkbench();
  }

  async function tune(hz, opts) {
    opts = opts || {};
    if (!opts.keepTrack) st.satTrack = null;
    if (st.sweep && st.sweep.on && !opts.fromSweep) st.sweep.on = false;
    const dev = st.dev;
    const band = bandOf(hz);
    if (dev) hz = Math.max(dev.minHz, Math.min(dev.maxHz, hz));
    if (band === "ble" && dev && !isHackrf()) { addLog("Bluetooth LE needs a HackRF (2.4 GHz); this radio stops at " + mhz(dev.maxHz) + " MHz."); setMessage("Requires HackRF (2.4 GHz) for Bluetooth LE."); renderWorkbench(); return; }
    const rtl = Boolean(dev) && !isHackrf();
    const plan = { adsb: [2.0e6, 0], uat: [2083334, 0], mesh: [2.0e6, 300e3], ble: [4.0e6, 1e6], lte: [rtl ? 1.92e6 : 3.84e6, 0] }[band] || [2.4e6, 300e3];
    const rate = plan[0], center = hz - plan[1];
    if (opts.mode) st.mode = opts.mode;
    const prevBand = bandOf(st.tuned);
    st.tuned = hz;
    if (!opts.fromLayer) st.tunerHz = hz;
    if (dev) {
      try {
        await serial(async () => { if (st.rate !== rate) await dev.setSampleRate(rate); await dev.setFrequency(center); });
      } catch (e) { addLog("Tune failed: " + D().friendlyError(e, dev.kind)); }
    }
    st.rate = rate; st.center = center;
    config();
    if (!opts.quiet || prevBand !== band) addLog(`Tuned ${mhz(hz)} MHz (${band.toUpperCase()}) · ${st.mode}`);
    render();
    renderTuner();
  }
  function focusLayer() {
    for (let i = st.order.length - 1; i >= 0; i -= 1) { const l = BYKEY[st.order[i]]; if (l && l.tune && st.layers[l.key] && !(l.key === "mesh" && st.mesh.dev)) return l; }
    return null;
  }

  // ------------------------------------------------------------------ layer switches
  function setLayer(key, on) {
    const l = BYKEY[key];
    if (!l) return;
    st.layers[key] = Boolean(on);
    st.order = st.order.filter((k) => k !== key);
    if (on) st.order.push(key);
    if (root.GsaWelcome && root.GsaWelcome.stopSpin) root.GsaWelcome.stopSpin();
    if (key === "range") {
      L().show("range", on);
      if (on && !receiver()) armPin(); else st.awaitingPin = false;
      drawRange();
      render();
      return;
    }
    L().show(key, on);
    if (key === "sat") { if (on) startSats(); else stopSats(); hideCardFor(key); render(); return; }
    if (on) { redraw(key); if (key === "mesh") meshFeedAll(); if (st.dev && !(key === "mesh" && st.mesh.dev)) tune(l.tune, { mode: l.mode, fromLayer: true }); }
    else {
      L().clear(key); st.targets[key].clear();
      const next = focusLayer();
      if (st.dev && !(key === "mesh" && st.mesh.dev) && (l.bands || [bandOf(l.tune)]).includes(bandOf(st.tuned))) tune(next ? next.tune : st.tunerHz, { mode: next ? next.mode : undefined, fromLayer: Boolean(next) });
    }
    hideCardFor(key);
    drawRange();
    render();
  }
  function hideCardFor(key) {
    if (!st.layers[key] && st.lastCardKind === key) { const box = document.getElementById("selected"); if (box) box.hidden = true; st.lastCardId = ""; }
  }
  function clearAll() {
    for (const l of LAYERS) if (st.layers[l.key]) setLayer(l.key, false);
    for (const k of Object.keys(st.targets)) { st.targets[k].clear(); L() && L().clear(k); }
    st.order = []; st.awaitingPin = false;
    drawRange();
    render();
  }

  // Receiver pin: use the position the site already knows; otherwise the next globe tap.
  let pinHandler = null;
  function armPin() {
    st.awaitingPin = true;
    setMessage("Tap the globe where your antenna is to place the receiver.");
    const v = viewerFn && viewerFn();
    if (!v || pinHandler) return;
    pinHandler = new root.Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    pinHandler.setInputAction((click) => {
      if (!st.awaitingPin) return;
      const cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
      if (!cart) return;
      const c = root.Cesium.Cartographic.fromCartesian(cart);
      setReceiver({ lat: root.Cesium.Math.toDegrees(c.latitude), lon: root.Cesium.Math.toDegrees(c.longitude), name: "Receiver pin" });
    }, root.Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  function setReceiver(rx) {
    st.rx = rx; st.awaitingPin = false;
    if (st.message.startsWith("Tap the globe")) st.message = "";
    config();
    drawRange();
    render();
  }
  function drawRange() {
    if (!L()) return;
    if (!st.layers.range) { L().setRange(null); return; }
    const rx = receiver();
    let far = 0;
    if (rx) for (const k of MAPKEYS) for (const t of visibleTargets(k)) { if (k === "sat" || k === "meter" || t.fixed) continue; if (!isLive(k)) continue; const d = L().distanceKm(rx, t); if (d < 600) far = Math.max(far, d); }
    st.liveKm = far;
    L().setRange(rx, far);
  }

  // ------------------------------------------------------------------ worker messages
  function onWorker(m) {
    switch (m.t) {
      case "fft": st.fftRow = m.db; drawSpectrum(m); onSweepFft(m); break;
      case "level": st.level = m.db; pushZspan(m.db); break;
      case "audio": playAudio(m); break;
      case "adsb": onAdsb(m.msg); break;
      case "ais": onAis(m.msg); break;
      case "aprs": onAprs(m.msg); break;
      case "sonde": onSonde(m.msg); break;
      case "pager": onPager(m.msg); break;
      case "device": onDevice(m.msg); break;
      case "mesh": onMesh(m.msg); break;
      case "uat": onUat(m.msg); break;
      case "fisb": onFisb(m.msg); break;
      case "acars": onAcars(m.msg); break;
      case "dispatch": onDispatch(m.msg); break;
      case "meter": onMeter(m.msg); break;
      case "hd": onHd(m.msg); break;
      case "hdside": onHdSide(m.msg); break;
      case "lte": onLte(m.msg); break;
      case "ft8": onFt8(m.msg); break;
      case "ble": onBle(m.msg); break;
      case "eot": onEot(m.msg); break;
      case "burst": st.bursts.unshift({ t: nowTime(), at: Date.now(), runs: m.runs || [], label: plain(m.label), rssi: m.rssi, freq: st.tuned }); if (st.bursts.length > 30) st.bursts.length = 30; if (st.wbOpen && st.tab === "spectrum") renderSpectrumTab(); break;
      case "act": st.act = m.list || []; st.actFloor = m.floor; if (st.wbOpen && st.tab === "spectrum") renderSpectrumTab(); break;
      case "atsc": if (m.msg && m.msg.on) { st.atsc[m.msg.channel || mhz(m.msg.freq)] = Object.assign({ t: nowTime(), at: Date.now() }, m.msg); if (st.wbOpen && st.tab === "trains") renderTrains(); } break;
      case "health": st.health = m.h; if (st.wbOpen && st.tab === "log") renderLog(); break;
      case "cap": st.cap = { on: m.on, bytes: m.bytes, secs: m.secs }; if (st.wbOpen && st.tab === "capture") renderCapture(); break;
      case "capdata": saveCapture(m); break;
      case "log": addLog(m.text); break;
      case "decoded": if (testWaiters[m.id]) { testWaiters[m.id](m.out); delete testWaiters[m.id]; } break;
      default: break;
    }
  }
  function visibleTargets(key) {
    const map = st.targets[key];
    if (!map) return [];
    const ttl = BYKEY[key].ttl, now = Date.now();
    const out = [];
    for (const t of map.values()) if (now - t.seen <= (t.ttl || ttl) && Number.isFinite(t.lat)) out.push(t);
    return out;
  }
  let drawQueued = false;
  const dirtyKinds = new Set();
  function scheduleDraw(kind) {
    dirtyKinds.add(kind);
    if (drawQueued) return;
    drawQueued = true;
    setTimeout(() => {
      drawQueued = false;
      for (const k of dirtyKinds) redraw(k);
      dirtyKinds.clear();
      drawRange();
      render();
      refreshCard();
    }, 250);
  }
  function redraw(key) {
    if (!L() || !st.layers[key]) return;
    const now = Date.now(), ttl = BYKEY[key].ttl;
    for (const [id, t] of st.targets[key]) {
      if (now - t.seen > (t.ttl || ttl)) { st.targets[key].delete(id); L().removeItem(key, id); continue; }
      if (Number.isFinite(t.lat)) L().upsert(key, t);
    }
  }
  function touch(key, id, init) {
    const map = st.targets[key];
    let t = map.get(id);
    if (!t) { t = Object.assign({ id, first: Date.now(), packets: 0, track: [] }, init); map.set(id, t); if (map.size > 600) map.delete(map.keys().next().value); }
    t.seen = Date.now(); t.packets += 1;
    return t;
  }
  function pushTrack(t, max) {
    const last = t.track[t.track.length - 1];
    if (!last || Math.abs(last[0] - t.lon) + Math.abs(last[1] - t.lat) > 0.002) { t.track.push([t.lon, t.lat]); if (t.track.length > (max || 60)) t.track.shift(); }
  }
  function accepts(key) { return st.layers[key] || st.wbOpen; }
  function onAdsb(m) {
    if (!m || !m.icao || !accepts("adsb")) return;
    const t = touch("adsb", m.icao, { icao: m.icao });
    if (m.callsign) t.callsign = m.callsign;
    if (Number.isFinite(m.alt)) t.alt = m.alt;
    if (Number.isFinite(m.speed)) t.speed = m.speed;
    if (Number.isFinite(m.heading)) t.heading = m.heading;
    if (Number.isFinite(m.vrate)) t.vrate = m.vrate;
    if (Number.isFinite(m.rssi)) t.rssi = m.rssi;
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; t.cpr = m.cpr; pushTrack(t); }
    t.name = t.callsign || m.icao;
    t.label = t.callsign || m.icao;
    scheduleDraw("adsb");
  }
  function shipType(n) { for (const [a, b, s] of SHIPTYPES) if (n >= a && n <= b) return s; return n ? "Type " + n : ""; }
  function onAis(m) {
    if (!m || !m.mmsi || !accepts("ais")) return;
    const t = touch("ais", m.mmsi, { mmsi: m.mmsi });
    for (const k of ["sog", "cog", "heading", "callsign", "dest", "status", "channel"]) if (m[k] != null && m[k] !== "") t[k] = m[k];
    if (m.name) t.shipName = m.name;
    if (m.shiptype != null) t.shiptype = m.shiptype;
    if (m.classB) t.cls = "B"; else if (m.aton) t.cls = "AtoN"; else if (m.base) t.cls = "Base station"; else if (m.type <= 3 || m.type === 5) t.cls = "A";
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t, 40); }
    if (m.aton) t.icon = "aton";
    t.name = t.shipName || "MMSI " + m.mmsi;
    t.label = t.shipName || m.mmsi;
    scheduleDraw("ais");
  }
  function onAprs(m) {
    if (!m || !m.call || !accepts("aprs")) return;
    const t = touch("aprs", m.call, { call: m.call });
    for (const k of ["symbol", "comment", "status", "format", "speedKn", "course"]) if (m[k] != null && m[k] !== "") t[k] = m[k];
    if (m.path) t.digis = m.path; // digipeater path text (item.path is the map polyline in sdr-layers.js)
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t, 30); }
    t.name = m.call; t.label = m.call;
    scheduleDraw("aprs");
  }
  // Simple landing prediction: rise at the measured rate to a 30 km burst, then descend on a
  // parachute (5 m/s at the ground, faster high up), drifting with the last measured wind.
  function predict(t) {
    if (!Number.isFinite(t.alt) || !Number.isFinite(t.vE)) return;
    const burstAlt = Math.max(30000, t.alt + 50);
    const vE = t.vE, vN = t.vN;
    let lat = t.lat, lon = t.lon, alt = t.alt;
    const step = (secs) => { const d = L().destination({ lat, lon }, (Math.hypot(vE, vN) * secs) / 1000, (Math.atan2(vE, vN) * 180) / Math.PI); lat = d.lat; lon = d.lon; };
    if (t.vU > 0.5) {
      const up = (burstAlt - alt) / t.vU;
      step(up); alt = burstAlt;
      t.burst = { lat, lon, alt: burstAlt };
    } else t.burst = null;
    let secs = 0;
    while (alt > 0 && secs < 4 * 3600) { const rate = 5 * Math.sqrt(Math.max(1, Math.exp(alt / 7200))); const dt = 30; step(dt * 0.6); alt -= rate * dt; secs += dt; }
    t.landing = { lat, lon };
    t.landMin = Math.round(((t.vU > 0.5 ? (burstAlt - t.alt) / t.vU : 0) + secs) / 60);
  }
  function onSonde(m) {
    if (!m || !m.serial || !accepts("sonde")) return;
    const t = touch("sonde", m.serial, { serial: m.serial, path: [] });
    for (const k of ["alt", "vE", "vN", "vU", "sats", "battery", "frame", "type", "tempC", "rh", "ptu"]) if (m[k] != null) t[k] = m[k];
    if (Number.isFinite(m.lat)) {
      t.lat = m.lat; t.lon = m.lon;
      const last = t.path[t.path.length - 1];
      if (!last || Math.abs(last[0] - m.lon) + Math.abs(last[1] - m.lat) > 0.0005) { t.path.push([m.lon, m.lat, m.alt]); if (t.path.length > 400) t.path.shift(); }
      if (!t.predAt || Date.now() - t.predAt > 5000) { t.predAt = Date.now(); predict(t); }
    }
    t.icon = "sonde";
    t.name = m.serial; t.label = m.serial + (Number.isFinite(t.alt) ? " · " + Math.round(t.alt) + " m" : "");
    scheduleDraw("sonde");
  }
  function onPager(m) {
    const key = m.capcode + "|" + m.text;
    const prev = st.pagers.find((p) => p.key === key && Date.now() - p.at < 20000);
    if (prev) { prev.repeats += 1; return; }
    st.pagers.unshift({ key, at: Date.now(), t: nowTime(), freq: st.tuned, proto: m.proto, baud: m.baud, capcode: m.capcode, func: m.func, kind: m.kind, text: plain(m.text), repeats: 1 });
    if (st.pagers.length > 300) st.pagers.length = 300;
    if (st.wbOpen && st.tab === "pagers") renderPagers();
    badge("pagers", st.pagers.length);
  }
  function onDevice(m) {
    let d = st.devices.find((x) => x.kind === m.kind && x.id === m.id);
    if (!d) { d = { kind: m.kind, id: m.id, first: nowTime(), count: 0 }; st.devices.unshift(d); if (st.devices.length > 200) st.devices.pop(); }
    Object.assign(d, { kpa: m.kpa, tempC: m.tempC, humidity: m.humidity, fmt: m.fmt, detail: m.detail, rssi: m.rssi, last: nowTime(), at: Date.now(), freq: st.tuned });
    d.count += 1;
    if (st.wbOpen && st.tab === "devices") renderDevices();
    badge("devices", st.devices.length);
  }
  // ---- Phase 2 handlers
  function onMesh(m) {
    if (!m || !m.id || !accepts("mesh")) return;
    if (st.mesh.dev) { st.mesh.otaSkipped += 1; return; } // the connected mesh radio is authoritative
    const t = touch("mesh", m.id, { nodeId: m.id });
    for (const k of ["proto", "longName", "shortName", "hw", "portName", "snr", "rssi", "hops", "sf", "bw", "preset", "encrypted", "nodeType", "channel", "cfoHz", "alt"]) if (m[k] != null && m[k] !== "") t[k] = m[k];
    if (m.to) t.to = m.to;
    if (Number.isFinite(m.lat) && (m.lat || m.lon)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t, 40); }
    t.icon = "mesh"; t.src = "sdr";
    t.name = t.longName || t.shortName || m.id;
    t.label = t.shortName || t.longName || m.id;
    scheduleDraw("mesh");
  }
  function onUat(m) {
    if (!m || !m.icao || !accepts("uat")) return;
    const t = touch("uat", "ac-" + m.icao, { icao: m.icao });
    for (const k of ["callsign", "alt", "altType", "speed", "heading", "vrate", "addrType", "ground", "nic", "emitter"]) if (m[k] != null && m[k] !== "") t[k] = m[k];
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t); }
    t.icon = "uat"; t.uatKind = "aircraft";
    t.name = t.callsign || m.icao; t.label = t.callsign || m.icao;
    scheduleDraw("uat");
  }
  function onFisb(m) {
    if (!m || !m.ground || !accepts("uat")) return;
    const g = m.ground;
    const t = touch("uat", "gs-" + g.lat.toFixed(3) + "," + g.lon.toFixed(3), { uatKind: "tower", fixed: true, ttl: 30 * 60e3 });
    Object.assign(t, { lat: g.lat, lon: g.lon, slot: g.slot, site: g.site, icon: "tower", name: "FIS-B ground station", label: "FIS-B" });
    t.products = (t.products || 0) + m.texts.length;
    for (const x of m.texts) metarPin(x);
    scheduleDraw("uat");
  }
  function loadAirports() {
    if (st.airports || st.airportsLoading) return;
    st.airportsLoading = true;
    fetch("/geo/us-airports.json").then((r) => (r.ok ? r.json() : null)).then((j) => { st.airports = (j && j.airports) || {}; st.airportsLoading = false; for (const x of st.pendingWx || []) metarPin(x); st.pendingWx = []; }).catch(() => { st.airportsLoading = false; });
  }
  function metarPin(x) {
    const mm = /^(?:METAR|SPECI|TAF)?\s*(K?[A-Z0-9]{3,4})\s/.exec(x.text);
    if (!mm) return;
    if (!st.airports) { (st.pendingWx = st.pendingWx || []).push(x); if (st.pendingWx.length > 40) st.pendingWx.shift(); loadAirports(); return; }
    const icao = mm[1], faa = icao.length === 4 && icao[0] === "K" ? icao.slice(1) : icao, a = st.airports[faa] || st.airports[icao];
    if (!a) return;
    const t = touch("uat", "wx-" + icao, { uatKind: "metar", fixed: true, ttl: 90 * 60e3 });
    Object.assign(t, { lat: a[3], lon: a[4], icao, airport: a[0], city: a[1] + (a[2] ? ", " + a[2] : ""), metar: plain(x.text), wxTime: x.time, icon: "metar", name: icao + " weather", label: icao });
    scheduleDraw("uat");
  }
  function onAcars(m) {
    if (!m) return;
    if (m.text || m.label) { st.acarsMsgs.unshift({ t: nowTime(), proto: m.proto, freq: m.freq || st.tuned, flight: plain(m.flight || m.reg || m.src || ""), label: plain(m.label || ""), text: plain(m.text || "") }); if (st.acarsMsgs.length > 150) st.acarsMsgs.length = 150; }
    if (!accepts("acars")) return;
    if (m.gsLat != null) {
      const t = touch("acars", "gs-" + m.src, { fixed: true, ttl: 2 * 3600e3 });
      Object.assign(t, { lat: m.gsLat, lon: m.gsLon, gsName: m.gsName, addr: m.src, icon: "gs", acarsKind: "ground", name: (m.gsName || "VDL2") + " ground station", label: m.gsName || m.src, proto: "VDL2", freq: m.freq });
      scheduleDraw("acars");
      return;
    }
    const id = m.flight || m.reg || m.src;
    if (!id) return;
    const t = touch("acars", "ac-" + id, { acarsKind: "aircraft" });
    for (const k of ["flight", "reg", "label", "proto", "freq", "alt", "msn"]) if (m[k] != null && m[k] !== "") t[k] = m[k];
    t.msgs = [{ t: nowTime(), label: plain(m.label), text: plain(m.text) }].concat(t.msgs || []).slice(0, 5);
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t, 30); }
    t.icon = "acars"; t.name = t.flight || t.reg || id; t.label = t.flight || t.reg || id;
    scheduleDraw("acars");
  }
  function onDispatch(m) {
    if (!m || !accepts("dispatch")) return;
    const id = m.proto + "-" + (m.radioId || "?");
    const t = touch("dispatch", id, { proto: m.proto, radioId: m.radioId });
    for (const k of ["talkgroup", "speed", "heading", "radius", "freq"]) if (m[k] != null) t[k] = m[k];
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; pushTrack(t, 30); }
    t.icon = "dispatch"; t.name = m.proto + " radio " + (m.radioId || ""); t.label = m.proto + " " + (m.radioId || "");
    scheduleDraw("dispatch");
  }
  // Meters never send a position: spread them on a small deterministic ring near the receiver.
  function onMeter(m) {
    if (!m || !m.id) return;
    onDevice({ kind: "Meter", id: m.id, fmt: m.proto, detail: m.kind + " · reading " + m.consumption + (m.tamper ? " · tamper flag" : ""), rssi: m.rssi });
    if (!accepts("meter")) return;
    const t = touch("meter", m.id, { meterId: m.id, fixed: true });
    Object.assign(t, { proto: m.proto, ert: m.ert, meterKind: m.kind, consumption: m.consumption, tamper: m.tamper, rssi: m.rssi });
    const rx = receiver();
    if (rx && !Number.isFinite(t.lat)) { let h = 0; for (const c of String(m.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const p = L().destination(rx, 0.3 + (h % 2200) / 1000, h % 360); t.lat = p.lat; t.lon = p.lon; }
    t.icon = "meter"; t.name = m.kind + " meter " + m.id; t.label = m.kind + " " + String(m.id).slice(-4);
    scheduleDraw("meter");
  }
  function onHd(m) {
    if (!m || !m.call || !accepts("hd")) return;
    const t = touch("hd", m.call, { fixed: true });
    Object.assign(t, { call: m.call, stationName: m.name, freq: m.freq, programs: m.programs, icon: "hd", name: m.call + " · " + m.name, label: m.call + " HD" });
    if (Number.isFinite(m.lat)) { t.lat = m.lat; t.lon = m.lon; }
    if (st.hdSide && Math.abs(st.hdSide.freq - m.freq) < 50e3) t.sidebands = st.hdSide;
    scheduleDraw("hd");
  }
  function onHdSide(m) {
    if (!m) return;
    st.hdSide = Object.assign({ at: Date.now() }, m);
    for (const t of st.targets.hd.values()) if (Math.abs(t.freq - m.freq) < 50e3) t.sidebands = st.hdSide;
  }
  function onLte(m) {
    if (!m) return;
    if (m.kind === "cell") {
      let c = st.cells.find((x) => Math.abs(x.freq - m.freq) < 1e5 && x.nid2 === m.nid2);
      if (!c) { c = { freq: m.freq, nid2: m.nid2, first: nowTime(), count: 0 }; st.cells.unshift(c); if (st.cells.length > 40) st.cells.pop(); }
      Object.assign(c, { score: m.score, last: nowTime(), at: Date.now() }); c.count += 1;
      if (st.wbOpen && st.tab === "trains") renderTrains();
      return;
    }
    const key = m.msgId + "-" + m.serial;
    if (!st.alerts.find((a) => a.key === key)) { st.alerts.unshift({ key, t: nowTime(), category: plain(m.category), text: plain(m.text), freq: m.freq }); if (st.alerts.length > 40) st.alerts.pop(); }
    if (st.wbOpen && st.tab === "trains") renderTrains();
    if (!accepts("lte") || !m.poly || m.poly.length < 3) return;
    const t = touch("lte", key, { fixed: true });
    const lat = m.poly.reduce((a, p) => a + p[0], 0) / m.poly.length, lon = m.poly.reduce((a, p) => a + p[1], 0) / m.poly.length;
    Object.assign(t, { lat, lon, poly: m.poly, category: m.category, text: m.text, msgId: m.msgId, serial: m.serial, freq: m.freq, icon: "lte", name: m.category, label: (m.category || "Alert").split(" (")[0].toUpperCase() });
    scheduleDraw("lte");
  }
  function onFt8(m) {
    if (!m || !m.call || !Number.isFinite(m.lat) || !accepts("aprs")) return;
    const t = touch("aprs", "ft8-" + m.call, { call: m.call, ttl: 30 * 60e3 });
    Object.assign(t, { lat: m.lat, lon: m.lon, grid: m.grid, mode: m.mode, snr: m.snr, ftText: plain(m.text), freq: m.freq, icon: "ft8", name: m.call + " (" + m.mode + ")", label: m.call });
    scheduleDraw("aprs");
  }
  function onBle(m) {
    if (!m || !m.addr) return;
    let d = st.ble.find((x) => x.addr === m.addr);
    if (!d) { d = { addr: m.addr, first: nowTime(), count: 0 }; st.ble.unshift(d); if (st.ble.length > 200) st.ble.pop(); }
    Object.assign(d, { name: plain(m.name || d.name || ""), company: plain(m.company || d.company || ""), tag: plain(m.tag || d.tag || ""), pdu: m.pdu, rssi: m.rssi, txPower: m.txPower, chan: m.chan, last: nowTime(), at: Date.now() });
    d.count += 1;
    if (st.wbOpen && st.tab === "ble") renderBle();
    badge("ble", st.ble.length);
  }
  function onEot(m) {
    if (!m) return;
    let d = st.trains.find((x) => x.unit === m.unit && x.kind === m.kind);
    if (!d) { d = { unit: m.unit, kind: m.kind, first: nowTime(), count: 0 }; st.trains.unshift(d); if (st.trains.length > 100) st.trains.pop(); }
    Object.assign(d, { psi: m.psi, charge: m.charge, battery: m.battery, motion: m.motion, markerLight: m.markerLight, valve: m.valve, last: nowTime(), at: Date.now(), freq: st.tuned });
    d.count += 1;
    if (st.wbOpen && st.tab === "trains") renderTrains();
    badge("trains", st.trains.length + st.alerts.length);
  }
  // ---- satellites (lazy: the script and orbit data load only when the layer is switched on)
  let satsScript = null;
  function startSats() {
    const go = () => root.GsaSdrSats.start(receiver, onSats, (e) => { addLog("Satellites: " + (e && e.message)); st.satInfo = { error: true }; render(); });
    if (root.GsaSdrSats) { go(); return; }
    if (satsScript) return;
    satsScript = document.createElement("script");
    satsScript.src = "/sdr-sats.js?v=" + V; satsScript.async = true;
    satsScript.onload = () => { if (st.layers.sat) go(); };
    satsScript.onerror = () => { satsScript = null; addLog("Satellites: could not load sdr-sats.js"); };
    document.head.appendChild(satsScript);
  }
  function stopSats() { if (root.GsaSdrSats) root.GsaSdrSats.stop(); st.satTrack = null; if (L()) L().clear("sat"); st.targets.sat.clear(); st.satInfo = null; }
  function onSats(list) {
    if (!st.layers.sat) return;
    st.satInfo = root.GsaSdrSats.info();
    const rx = receiver();
    for (const r of list) {
      if (!Number.isFinite(r.lat)) continue;
      const t = st.targets.sat.get(r.id) || { id: r.id, first: Date.now(), packets: 0 };
      Object.assign(t, { seen: Date.now(), lat: r.lat, lon: r.lon, altKm: r.altKm, norad: r.norad, satName: r.name, epoch: r.epoch, downlink: r.downlink, service: r.service, az: r.az, el: r.el, rangeKm: r.rangeKm, rangeRate: r.rangeRate, doppler: r.doppler, visible: rx ? r.visible : false, track: r.track, icon: "sat", name: r.name, label: r.name.replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 18) });
      st.targets.sat.set(r.id, t);
      L().upsert("sat", t);
    }
    if (st.satTrack && st.dev) { const s2 = list.find((x) => x.id === st.satTrack); if (s2 && s2.downlink && Number.isFinite(s2.doppler)) { const f = Math.round(s2.downlink * 1e6 + s2.doppler); if (Math.abs(f - st.tuned) > 150) tune(f, { quiet: true, keepTrack: true }); } }
    if (st.wbOpen && st.tab === "voice") renderVoice();
    render(); refreshCard();
  }
  function badge(tab, n) { for (const b of document.querySelectorAll(`[data-gsr-badge="${tab}"]`)) b.textContent = n ? String(n) : ""; }

  // ------------------------------------------------------------------ pin card
  function rows(list) {
    const r = list.filter((x) => x[1] !== undefined && x[1] !== null && x[1] !== "" && !(typeof x[1] === "number" && !Number.isFinite(x[1])));
    return r.length ? `<dl class="nearby-facts gsr-facts">${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
  }
  const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + " s ago" : Math.round(s / 60) + " min ago"; };
  function rangeText(t) { const rx = receiver(); return rx && Number.isFinite(t.lat) ? Math.round(L().distanceKm(rx, t)) + " km from receiver" : ""; }
  function popupHtml(item) {
    const kind = item && item.sdrKind;
    const t = kind && st.targets[kind] && st.targets[kind].get(item.id) ? st.targets[kind].get(item.id) : item;
    const src = `<span data-sdr-card="${esc(item.id)}" hidden></span><p class="gsr-src">Heard by your own SDR${st.dev ? " · " + esc(st.dev.name) : ""} · ${esc(isLive(kind) ? "live" : "paused, last known")}</p>`;
    if (kind === "adsb") return src + rows([["ICAO", t.icao], ["Callsign", t.callsign], ["Altitude", Number.isFinite(t.alt) ? Math.round(t.alt).toLocaleString() + " ft" : ""], ["Ground speed", Number.isFinite(t.speed) ? Math.round(t.speed) + " kt" : ""], ["Heading", Number.isFinite(t.heading) ? Math.round(t.heading) + "°" : ""], ["Vertical rate", Number.isFinite(t.vrate) ? t.vrate + " ft/min" : ""], ["Position", t.cpr ? "CPR " + t.cpr : ""], ["Signal", Number.isFinite(t.rssi) ? t.rssi + " dBFS" : ""], ["Range", rangeText(t)], ["Messages", t.packets], ["Last heard", ago(t.seen)]]);
    if (kind === "ais") return src + rows([["MMSI", t.mmsi], ["Name", t.shipName], ["Call sign", t.callsign], ["Class", t.cls], ["Ship type", t.shiptype != null ? shipType(t.shiptype) : ""], ["Speed", Number.isFinite(t.sog) ? t.sog.toFixed(1) + " kn" : ""], ["Course", Number.isFinite(t.cog) ? Math.round(t.cog) + "°" : ""], ["Heading", Number.isFinite(t.heading) ? t.heading + "°" : ""], ["Destination", t.dest], ["Channel", t.channel ? "AIS " + t.channel : ""], ["Range", rangeText(t)], ["Messages", t.packets], ["Last heard", ago(t.seen)]]);
    if (kind === "aprs") return src + rows([["Call sign", t.call], ["Station", APRS_SYMBOLS[t.symbol] || (t.symbol ? "Symbol " + t.symbol : "")], ["Comment", t.comment || t.status], ["Format", t.format], ["Speed", Number.isFinite(t.speedKn) ? t.speedKn + " kn" : ""], ["Path", t.digis], ["Range", rangeText(t)], ["Packets", t.packets], ["Last heard", ago(t.seen)]]);
    if (kind === "sonde") return src + rows([["Serial", t.serial], ["Type", t.type || "RS41"], ["Temperature", Number.isFinite(t.tempC) ? t.tempC.toFixed(1) + " °C" : t.ptu === "calibrating" ? "calibrating…" : ""], ["Humidity", Number.isFinite(t.rh) ? t.rh + " %" : ""], ["Altitude", Number.isFinite(t.alt) ? Math.round(t.alt).toLocaleString() + " m" : ""], ["Climb", Number.isFinite(t.vU) ? t.vU.toFixed(1) + " m/s" : ""], ["Wind", Number.isFinite(t.vE) ? Math.hypot(t.vE, t.vN).toFixed(1) + " m/s" : ""], ["Satellites", t.sats], ["Frame", t.frame], ["Predicted burst", t.burst ? t.burst.lat.toFixed(3) + ", " + t.burst.lon.toFixed(3) : ""], ["Predicted landing", t.landing ? t.landing.lat.toFixed(3) + ", " + t.landing.lon.toFixed(3) + (t.landMin ? " in about " + t.landMin + " min" : "") : ""], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]) + `<p class="gsr-src">Landing is a simple estimate from the last measured climb rate and wind.</p>`;
    if (kind === "mesh" && t.src === "device") return meshCardHtml(item, t);
    if (kind === "mesh") return src + rows([["Node", t.nodeId], ["Long name", t.longName], ["Short name", t.shortName], ["Protocol", t.proto], ["Packet", t.portName], ["Hardware", t.hw || t.nodeType], ["Hops", t.hops], ["SNR", Number.isFinite(t.snr) ? t.snr + " dB" : ""], ["Signal", Number.isFinite(t.rssi) ? t.rssi + " dBFS" : ""], ["LoRa", t.sf ? "SF" + t.sf + " · " + t.bw / 1e3 + " kHz" + (t.preset ? " · " + t.preset : "") : ""], ["Encrypted", t.encrypted === true ? "yes (private channel)" : t.encrypted === false ? "no (default key)" : ""], ["Altitude", Number.isFinite(t.alt) && t.alt ? t.alt + " m" : ""], ["Range", rangeText(t)], ["Packets", t.packets], ["Last heard", ago(t.seen)]]);
    if (kind === "uat" && t.uatKind === "tower") return src + rows([["Type", "FIS-B ground station"], ["Position", t.lat.toFixed(3) + ", " + t.lon.toFixed(3)], ["Time slot", t.slot], ["Products heard", t.products], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]);
    if (kind === "uat" && t.uatKind === "metar") return src + rows([["Airport", t.icao + " · " + (t.airport || "")], ["City", t.city], ["Report time", t.wxTime], ["Weather (METAR)", t.metar], ["Source", "FIS-B uplink over 978 MHz"], ["Last heard", ago(t.seen)]]);
    if (kind === "uat") return src + rows([["ICAO", t.icao], ["Callsign", t.callsign], ["Address type", t.addrType], ["Altitude", Number.isFinite(t.alt) ? Math.round(t.alt).toLocaleString() + " ft " + (t.altType || "") : ""], ["Ground speed", Number.isFinite(t.speed) ? t.speed + " kt" : ""], ["Track", Number.isFinite(t.heading) ? t.heading + "°" : ""], ["Vertical rate", Number.isFinite(t.vrate) ? t.vrate + " ft/min" : ""], ["On ground", t.ground ? "yes" : ""], ["Range", rangeText(t)], ["Messages", t.packets], ["Last heard", ago(t.seen)]]);
    if (kind === "acars" && t.acarsKind === "ground") return src + rows([["Ground station", t.gsName], ["Address", t.addr], ["Link", "VDL Mode 2 · " + (t.freq ? mhz(t.freq) + " MHz" : "")], ["Position", "from its XID broadcast (0.1° precision)"], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]);
    if (kind === "acars") return src + rows([["Flight", t.flight], ["Registration", t.reg], ["Link", (t.proto || "ACARS") + (t.freq ? " · " + mhz(t.freq) + " MHz" : "")], ["Altitude", Number.isFinite(t.alt) ? Math.round(t.alt).toLocaleString() + " ft" : ""], ["Range", rangeText(t)], ["Messages", t.packets], ["Last heard", ago(t.seen)]]) + (t.msgs && t.msgs.length ? `<div class="gsr-card-msgs">${t.msgs.map((x) => `<p><time>${esc(x.t)}</time> <b>${esc(x.label)}</b> ${esc(x.text)}</p>`).join("")}</div>` : "");
    if (kind === "dispatch") return src + rows([["Radio", t.proto + " · ID " + (t.radioId || "?")], ["Talkgroup", t.talkgroup], ["Speed", Number.isFinite(t.speed) ? Math.round(t.speed) + " km/h" : ""], ["Heading", Number.isFinite(t.heading) ? Math.round(t.heading) + "°" : ""], ["Accuracy", t.radius ? "± " + t.radius + " m" : ""], ["Frequency", t.freq ? mhz(t.freq) + " MHz" : ""], ["Range", rangeText(t)], ["Reports", t.packets], ["Last heard", ago(t.seen)]]) + `<p class="gsr-src">Location data only. Voice is encrypted or not decoded.</p>`;
    if (kind === "meter") return src + rows([["Meter ID", t.meterId], ["Utility", t.meterKind], ["Protocol", t.proto + " · ERT type " + t.ert], ["Reading", t.consumption], ["Tamper flags", t.tamper ? "set" : "clear"], ["Signal", Number.isFinite(t.rssi) ? t.rssi + " dBFS" : ""], ["Packets", t.packets], ["Last heard", ago(t.seen)]]) + `<p class="gsr-src">Meters do not send their location. This pin is placed approximately near your receiver.</p>`;
    if (kind === "hd") return src + rows([["Station", t.call], ["Name", t.stationName], ["Frequency", t.freq ? mhz(t.freq) + " MHz" : ""], ["Digital programs", t.programs ? "HD1-HD" + t.programs : ""], ["Digital sidebands", t.sidebands ? (t.sidebands.on ? "present (" + t.sidebands.lower + " / " + t.sidebands.upper + " dB over noise)" : "not detected right now") : ""], ["Tower", Number.isFinite(t.lat) ? t.lat.toFixed(4) + ", " + t.lon.toFixed(4) : ""], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]);
    if (kind === "sat") return `<span data-sdr-card="${esc(item.id)}" hidden></span><p class="gsr-src">Orbit from ${esc((st.satInfo && st.satInfo.source) || "CelesTrak")} · position by SGP4 in your browser</p>` + rows([["Satellite", t.satName], ["NORAD", t.norad], ["Altitude", Number.isFinite(t.altKm) ? Math.round(t.altKm) + " km" : ""], ["Downlink", t.downlink ? t.downlink.toFixed(3) + " MHz · " + t.service : "not listed"], ["Doppler now", Number.isFinite(t.doppler) ? (t.doppler >= 0 ? "+" : "") + Math.round(t.doppler) + " Hz" : receiver() ? "" : "place a receiver to see Doppler"], ["Tune to", t.downlink && Number.isFinite(t.doppler) ? ((t.downlink * 1e6 + t.doppler) / 1e6).toFixed(4) + " MHz" : ""], ["Elevation", Number.isFinite(t.el) ? t.el.toFixed(1) + "°" + (t.el > 0 ? " (overhead now)" : " (below horizon)") : ""], ["Azimuth", Number.isFinite(t.az) ? Math.round(t.az) + "°" : ""], ["Distance", Number.isFinite(t.rangeKm) ? Math.round(t.rangeKm).toLocaleString() + " km" : ""], ["Elements epoch", t.epoch]]);
    if (kind === "lte") return src + rows([["Alert", t.category], ["Message", t.text], ["Message ID", t.msgId], ["Serial", t.serial], ["Carrier", t.freq ? mhz(t.freq) + " MHz" : ""], ["Area", t.poly ? t.poly.length + "-point polygon" : ""], ["Last heard", ago(t.seen)]]);
    if (kind === "aprs" && t.icon === "ft8") return src + rows([["Call sign", t.call], ["Mode", t.mode], ["Grid", t.grid + " (pin is the grid square centre)"], ["Message", t.ftText], ["SNR", Number.isFinite(t.snr) ? t.snr + " dB" : ""], ["Dial", t.freq ? mhz(t.freq) + " MHz" : ""], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]);
    if (kind === "range") { const rx = receiver(); return rows([["Receiver", rx ? rx.name : "Not placed"], ["Rings", "50, 100 and 200 km"], ["Farthest live signal", st.liveKm ? Math.round(st.liveKm) + " km" : "none yet"]]); }
    return "";
  }
  function refreshCard() {
    const box = document.getElementById("selected");
    if (!box || box.hidden || !st.lastCardId || !st.lastCardKind) return;
    const body = document.getElementById("selected-body") || box;
    const mark = body.querySelector("[data-sdr-card]");
    if (!mark || mark.getAttribute("data-sdr-card") !== String(st.lastCardId)) return;
    const t = st.targets[st.lastCardKind] && st.targets[st.lastCardKind].get(st.lastCardId);
    if (!t || !root.gsShowLive) return;
    const top = body.scrollTop;
    root.gsShowLive(t);
    body.scrollTop = top;
  }
  function pick(position) {
    const hit = L() ? L().pick(position) : null;
    if (hit) { st.lastCardKind = hit.sdrKind; st.lastCardId = hit.id; } // only a real tap makes a card live-refresh
    return hit;
  }

  // ------------------------------------------------------------------ audio (created on demand)
  function ensureAudio() {
    if (st.audio) return st.audio;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    st.audio = new AC({ latencyHint: "interactive" });
    st.stats.audioCtx += 1;
    st.audioNext = 0;
    return st.audio;
  }
  function playAudio(m) {
    if (st.muted || !st.audio || !m.open) return;
    const ac = st.audio;
    const buf = ac.createBuffer(1, m.pcm.length, m.rate);
    buf.copyToChannel(m.pcm, 0);
    const src = ac.createBufferSource();
    src.buffer = buf; src.connect(ac.destination);
    const now = ac.currentTime;
    if (st.audioNext < now + 0.05 || st.audioNext > now + 0.6) st.audioNext = now + 0.12;
    src.start(st.audioNext);
    st.audioNext += buf.duration;
  }
  function setMuted(on) {
    st.muted = on;
    if (!on) { const ac = ensureAudio(); if (ac && ac.state === "suspended") ac.resume(); }
    config();
    renderTuner();
  }

  // ------------------------------------------------------------------ workbench
  const TABS = [["tuner", "TUNER & WATERFALL"], ["mesh", "MESH RADIO"], ["spectrum", "SPECTRUM & SEARCH"], ["pagers", "PAGERS"], ["devices", "DEVICES"], ["ble", "BLUETOOTH"], ["voice", "VOICE & HAM"], ["trains", "TRAINS · CELL · TV"], ["capture", "CAPTURE"], ["log", "LOG"]];
  function buildWorkbench() {
    if (st.wb) return st.wb;
    const host = document.querySelector(".stage") || document.body;
    const wb = document.createElement("section");
    wb.className = "gsr-wb";
    wb.id = "sdr-workbench";
    wb.setAttribute("role", "dialog");
    wb.setAttribute("aria-label", "SDR Workbench");
    wb.hidden = true;
    wb.innerHTML =
      `<header class="gsr-wb-head"><div class="gsr-wb-title"><strong>SDR WORKBENCH</strong><span data-gsr-head></span></div>` +
      `<button type="button" class="pin-card-close gsr-wb-close" data-gsr="close" aria-label="Close SDR Workbench" title="Close">×</button></header>` +
      `<nav class="gsr-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" data-gsr-tab="${id}" aria-selected="false">${label}<em data-gsr-badge="${id}"></em></button>`).join("")}</nav>` +
      `<div class="gsr-wb-body">` +
      `<div class="gsr-pane" data-gsr-pane="tuner">` +
      `<div class="gsr-tune"><button type="button" class="gsr-btn gsr-step" data-gsr="down" aria-label="Tune down">−</button>` +
      `<label class="gsr-freq"><input data-gsr-freq inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Frequency in MHz"><span>MHz</span></label>` +
      `<button type="button" class="gsr-btn gsr-step" data-gsr="up" aria-label="Tune up">+</button>` +
      `<select data-gsr-step aria-label="Tuning step"><option value="5000">5 kHz</option><option value="12500" selected>12.5 kHz</option><option value="25000">25 kHz</option><option value="100000">100 kHz</option><option value="1000000">1 MHz</option></select></div>` +
      `<div class="gsr-scope"><canvas data-gsr-spec width="1024" height="110" aria-label="Spectrum"></canvas><canvas data-gsr-wf width="1024" height="180" aria-label="Waterfall"></canvas><p class="gsr-scope-msg" data-gsr-scopemsg>Connect a radio to see the spectrum and waterfall.</p><div class="gsr-scale" data-gsr-scale></div></div>` +
      `<div class="gsr-chips" data-gsr-presets>${PRESETS.map((p) => `<button type="button" class="gsr-chip" data-gsr-preset="${p.id}">${esc(p.label)}</button>`).join("")}</div>` +
      `<div class="gsr-seg" data-gsr-modes>${MODES.map((m) => `<button type="button" data-gsr-mode="${m}" aria-pressed="false">${m}</button>`).join("")}</div>` +
      `<div class="gsr-sliders"><label><span>SQUELCH <b data-gsr-sqv></b></span><input type="range" min="-100" max="0" step="1" data-gsr-sq></label>` +
      `<label><span>GAIN <b data-gsr-gv></b></span><input type="range" min="0" max="100" step="1" data-gsr-gain></label></div>` +
      `<div class="gsr-row"><button type="button" class="gsr-btn" data-gsr="mute" aria-pressed="true">AUDIO MUTED</button><button type="button" class="gsr-btn" data-gsr="scan" aria-pressed="false">SCAN</button><span class="gsr-meter"><i data-gsr-meter></i></span><span class="gsr-level" data-gsr-level>—</span></div>` +
      `<p class="gsr-hint" data-gsr-bandhint></p></div>` +
      `<div class="gsr-pane" data-gsr-pane="mesh" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="spectrum" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="pagers" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="devices" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="ble" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="voice" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="trains" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="capture" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="log" hidden></div>` +
      `</div>`;
    host.appendChild(wb);
    st.wb = wb;
    wb.addEventListener("click", onWbClick);
    wb.addEventListener("input", onWbInput);
    wb.addEventListener("change", onWbChange);
    wb.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeWorkbench(); } });
    for (const c of wb.querySelectorAll("[data-gsr-spec], [data-gsr-wf]")) c.addEventListener("click", onScopeClick);
    return wb;
  }
  function openWorkbench(tab) {
    const wb = buildWorkbench();
    st.wbOpen = true; wb.hidden = false;
    document.body.classList.add("sdr-wb-open");
    if (root.GsaWelcome && root.GsaWelcome.stopSpin) root.GsaWelcome.stopSpin();
    showTab(tab || st.tab);
    renderWorkbench();
  }
  function closeWorkbench() { st.wbOpen = false; st.scan = false; if (st.wb) st.wb.hidden = true; document.body.classList.remove("sdr-wb-open"); }
  function showTab(tab) {
    st.tab = tab;
    if (!st.wb) return;
    for (const b of st.wb.querySelectorAll("[data-gsr-tab]")) b.setAttribute("aria-selected", b.dataset.gsrTab === tab ? "true" : "false");
    for (const p of st.wb.querySelectorAll("[data-gsr-pane]")) p.hidden = p.dataset.gsrPane !== tab;
    renderWorkbench();
  }
  function renderWorkbench() {
    if (!st.wb || !st.wbOpen) return;
    renderWorkbenchHead();
    if (st.tab === "tuner") renderTuner();
    else if (st.tab === "mesh") renderMeshTab();
    else if (st.tab === "spectrum") renderSpectrumTab();
    else if (st.tab === "pagers") renderPagers();
    else if (st.tab === "devices") renderDevices();
    else if (st.tab === "ble") renderBle();
    else if (st.tab === "voice") renderVoice();
    else if (st.tab === "trains") renderTrains();
    else if (st.tab === "capture") renderCapture();
    else renderLog();
    badge("pagers", st.pagers.length); badge("devices", st.devices.length); badge("ble", st.ble.length); badge("trains", st.trains.length + st.alerts.length);
    const tb = st.wb.querySelector('[data-gsr-tab="' + st.tab + '"]'); if (tb && tb.scrollIntoView && st.lastTabShown !== st.tab) { st.lastTabShown = st.tab; tb.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function renderWorkbenchHead() {
    if (!st.wb) return;
    const h = st.wb.querySelector("[data-gsr-head]");
    const text = (st.dev ? `${st.dev.name} · ${mhz(st.tuned)} MHz ${st.mode}` : "No SDR connected") + (st.mesh.dev ? ` · Mesh: ${st.mesh.dev.name}` : "");
    if (h.textContent !== text) h.textContent = text;
  }
  function renderTuner() {
    if (!st.wb || !st.wbOpen || st.tab !== "tuner") return;
    const w = st.wb;
    const f = w.querySelector("[data-gsr-freq]");
    if (document.activeElement !== f) f.value = mhz(st.tuned);
    for (const b of w.querySelectorAll("[data-gsr-mode]")) b.setAttribute("aria-pressed", b.dataset.gsrMode === st.mode ? "true" : "false");
    for (const b of w.querySelectorAll("[data-gsr-preset]")) { const p = PRESETS.find((x) => x.id === b.dataset.gsrPreset); b.classList.toggle("on", Boolean(p) && Math.abs(p.hz - st.tuned) < 1); }
    const sq = w.querySelector("[data-gsr-sq]"), g = w.querySelector("[data-gsr-gain]");
    sq.value = st.squelch; g.value = st.gain;
    w.querySelector("[data-gsr-sqv]").textContent = st.squelch <= -100 ? "OPEN" : st.squelch + " dB";
    w.querySelector("[data-gsr-gv]").textContent = st.dev && st.dev.gainText ? st.dev.gainText : st.gain + "%";
    const mute = w.querySelector('[data-gsr="mute"]');
    mute.setAttribute("aria-pressed", st.muted ? "true" : "false");
    mute.textContent = st.muted ? "AUDIO MUTED" : "AUDIO ON";
    const scan = w.querySelector('[data-gsr="scan"]');
    scan.setAttribute("aria-pressed", st.scan ? "true" : "false");
    scan.textContent = st.scan ? "SCANNING…" : "SCAN";
    for (const b of w.querySelectorAll('[data-gsr-pane="tuner"] button, [data-gsr-pane="tuner"] input, [data-gsr-pane="tuner"] select')) b.disabled = !st.dev && !b.matches("[data-gsr-preset], [data-gsr-mode], [data-gsr-freq], [data-gsr-step], [data-gsr=up], [data-gsr=down]");
    w.querySelector("[data-gsr-scopemsg]").hidden = Boolean(st.dev);
    const band = bandOf(st.tuned);
    const hints = { adsb: "1090 MHz: aircraft appear on LOCAL ADS-B AIRCRAFT. Audio is not useful here.", ais: "Marine AIS: vessels appear on LOCAL AIS VESSELS.", aprs: "2 m APRS: stations appear on LOCAL APRS STATIONS.", sonde: "Radiosondes: balloons appear on LOCAL WEATHER BALLOONS with a predicted landing.", pager: "Pager band: POCSAG messages appear in the Pagers tab.", tpms: "ISM band: tire pressure sensors appear in the Devices tab.", fm: "FM broadcast: use WFM and turn audio on. HD Radio stations appear on LOCAL HD RADIO TOWERS.", uat: "978 MHz UAT: aircraft, FIS-B ground stations and airport weather appear on LOCAL UAT AIRCRAFT.", mesh: "LoRa ISM: Meshtastic and MeshCore nodes appear on LOCAL MESH NODES; LoRaWAN headers go to Devices.", meter: "900 MHz ISM: ERT utility meters appear on LOCAL UTILITY METERS and in Devices.", acars: "VHF airband ACARS: messages appear in Log, aircraft on LOCAL ACARS / VDL2.", vdl2: "VDL Mode 2: ground stations and aircraft appear on LOCAL ACARS / VDL2.", sat: "Satellite downlinks: use the Voice & Ham tab to follow a pass with Doppler.", ft8: "FT8 / JS8 dial: spots appear in Voice & Ham and on LOCAL APRS STATIONS. Use USB.", train: "Rail telemetry: end- and head-of-train units appear in Trains · Cell · TV.", voice: "Voice channel: pick NFM or AM, set squelch and turn audio on.", zwave: "Z-Wave: home network frames appear in Devices.", ble: "Bluetooth LE advertising: devices appear in the Bluetooth tab (HackRF only).", lte: "LTE downlink: carriers and wireless alerts appear in Trains · Cell · TV.", atsc: "ATSC TV: stations are found by their pilot in Trains · Cell · TV.", dispatch: "Land mobile radio: DMR/P25/NXDN/TETRA location reports appear on LOCAL RADIO GPS UNITS.", other: "Listening only. Pick a mode and turn audio on." };
    w.querySelector("[data-gsr-bandhint]").textContent = hints[band] || hints.other;
    drawScale();
  }
  function drawScale() {
    const el = st.wb && st.wb.querySelector("[data-gsr-scale]");
    if (!el) return;
    if (!st.dev || !st.rate) { el.textContent = ""; return; }
    const lo = st.center - st.rate / 2, hi = st.center + st.rate / 2;
    const text = `<span>${mhz(lo)}</span><span>${mhz(st.center)}</span><span>${mhz(hi)}</span>`;
    if (el.innerHTML !== text) el.innerHTML = text;
  }
  // Colour map: slate → deep blue → sky → near white.
  const CMAP = (() => {
    const stops = [[0, [11, 17, 23]], [0.35, [22, 33, 48]], [0.6, [30, 64, 120]], [0.82, [56, 189, 248]], [1, [226, 232, 240]]];
    const out = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i += 1) {
      const x = i / 255;
      let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k += 1;
      const [x0, c0] = stops[k], [x1, c1] = stops[k + 1];
      const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
      for (let c = 0; c < 3; c += 1) out[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * t;
    }
    return out;
  })();
  let wfImg = null;
  function drawSpectrum(m) {
    if (!st.wb || !st.wbOpen || st.tab !== "tuner") return;
    const db = m.db, n = db.length;
    let sorted = Array.from(db).sort((a, b) => a - b);
    const floor = sorted[Math.floor(n * 0.3)];
    st.wfFloor = st.wfFloor * 0.9 + floor * 0.1;
    const lo = st.wfFloor - 6, span = 60;
    const spec = st.wb.querySelector("[data-gsr-spec]"), wf = st.wb.querySelector("[data-gsr-wf]");
    const sc = spec.getContext("2d"), W = spec.width, H = spec.height;
    sc.fillStyle = "#0b1117"; sc.fillRect(0, 0, W, H);
    sc.strokeStyle = "rgba(148,163,184,0.16)"; sc.lineWidth = 1;
    for (let y = 0; y < H; y += H / 4) { sc.beginPath(); sc.moveTo(0, y + 0.5); sc.lineTo(W, y + 0.5); sc.stroke(); }
    for (let x = 0; x < W; x += W / 8) { sc.beginPath(); sc.moveTo(x + 0.5, 0); sc.lineTo(x + 0.5, H); sc.stroke(); }
    const tx = ((m.tuned - (m.center - m.rate / 2)) / m.rate) * W;
    const bw = { WFM: 200e3, NFM: 12.5e3, AM: 10e3, USB: 3e3, LSB: 3e3 }[st.mode] || 12.5e3;
    const bwPx = Math.max(2, (bw / m.rate) * W);
    sc.fillStyle = "rgba(56,189,248,0.12)";
    sc.fillRect(st.mode === "LSB" ? tx - bwPx : st.mode === "USB" ? tx : tx - bwPx / 2, 0, bwPx, H);
    sc.beginPath();
    for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * W; const y = H - Math.max(0, Math.min(1, (db[i] - lo) / span)) * H; if (i) sc.lineTo(x, y); else sc.moveTo(x, y); }
    sc.strokeStyle = "#38bdf8"; sc.lineWidth = 1.5; sc.stroke();
    sc.lineTo(W, H); sc.lineTo(0, H); sc.closePath(); sc.fillStyle = "rgba(56,189,248,0.10)"; sc.fill();
    sc.strokeStyle = "#e2e8f0"; sc.lineWidth = 1; sc.beginPath(); sc.moveTo(Math.round(tx) + 0.5, 0); sc.lineTo(Math.round(tx) + 0.5, H); sc.stroke();
    if (st.squelch > -100) { const sy = H - Math.max(0, Math.min(1, (st.squelch - lo) / span)) * H; sc.setLineDash([4, 4]); sc.strokeStyle = "#fbbf24"; sc.beginPath(); sc.moveTo(0, sy); sc.lineTo(W, sy); sc.stroke(); sc.setLineDash([]); }
    const wc = wf.getContext("2d"), WW = wf.width, WH = wf.height;
    wc.drawImage(wf, 0, 0, WW, WH - 1, 0, 1, WW, WH - 1);
    if (!wfImg || wfImg.width !== WW) wfImg = wc.createImageData(WW, 1);
    const px = wfImg.data;
    for (let x = 0; x < WW; x += 1) {
      const v = db[Math.min(n - 1, Math.floor((x / WW) * n))];
      const c = Math.max(0, Math.min(255, Math.round(((v - lo) / span) * 255))) * 3;
      px[x * 4] = CMAP[c]; px[x * 4 + 1] = CMAP[c + 1]; px[x * 4 + 2] = CMAP[c + 2]; px[x * 4 + 3] = 255;
    }
    wc.putImageData(wfImg, 0, 0);
    const lvl = st.wb.querySelector("[data-gsr-level]"), meter = st.wb.querySelector("[data-gsr-meter]");
    if (lvl) lvl.textContent = Number.isFinite(st.level) ? st.level.toFixed(0) + " dBFS" : "—";
    if (meter) meter.style.width = Math.max(0, Math.min(100, ((st.level + 100) / 100) * 100)) + "%";
    drawScale();
  }
  function onScopeClick(e) {
    if (!st.dev || !st.rate) return;
    const r = e.currentTarget.getBoundingClientRect();
    const hz = st.center - st.rate / 2 + ((e.clientX - r.left) / r.width) * st.rate;
    const step = bandOf(hz) === "fm" ? 100e3 : st.step;
    tune(Math.round(hz / step) * step);
  }
  function onWbClick(e) {
    const t = e.target;
    const tab = t.closest("[data-gsr-tab]");
    if (tab) { showTab(tab.dataset.gsrTab); return; }
    const pre = t.closest("[data-gsr-preset]");
    if (pre) { const p = PRESETS.find((x) => x.id === pre.dataset.gsrPreset); st.scan = false; if (p) tune(p.hz, { mode: p.mode }); return; }
    const th = t.closest("[data-gsr-tunehz]");
    if (th) { st.scan = false; tune(Number(th.dataset.gsrTunehz), th.dataset.gsrTmode ? { mode: th.dataset.gsrTmode } : {}); renderWorkbench(); return; }
    const pr = t.closest("[data-gsr-prowl]");
    if (pr) { const gi = Number(pr.dataset.gsrProwl); if (st.scan && st.scanGroup === gi) { st.scan = false; } else { st.scanGroup = gi; st.scanList = VOICE[gi][1].map(([, hz, mode]) => ({ hz, mode })); st.scan = true; if (st.squelch <= -100) st.squelch = -55; config(); scanStep(true); } renderVoice(); return; }
    const sf = t.closest("[data-gsr-sattrack]");
    if (sf) { const id = sf.dataset.gsrSattrack, s2 = st.targets.sat.get(id); if (st.satTrack === id) st.satTrack = null; else if (s2 && s2.downlink) { tune(Math.round(s2.downlink * 1e6 + (s2.doppler || 0)), { mode: /APRS|packet|FM/i.test(s2.service) ? "NFM" : "USB" }); st.satTrack = id; addLog("Following " + s2.satName + " with Doppler correction"); } renderVoice(); return; }
    const swp = t.closest("[data-gsr-swpre]");
    if (swp) { const [a2, b2] = swp.dataset.gsrSwpre.split(",").map(Number); const w = st.wb; w.querySelector("[data-gsr-swlo]").value = a2; w.querySelector("[data-gsr-swhi]").value = b2; startSweep(a2, b2); return; }
    const md = t.closest("[data-gsr-mode]");
    if (md) { st.mode = md.dataset.gsrMode; config(); renderTuner(); renderWorkbenchHead(); return; }
    const act = t.closest("[data-gsr]");
    if (!act) return;
    const a = act.dataset.gsr;
    if (a === "close") closeWorkbench();
    else if (a === "up" || a === "down") tune(st.tuned + (a === "up" ? 1 : -1) * st.step);
    else if (a === "mute") setMuted(!st.muted);
    else if (a === "scan") { st.scan = !st.scan; st.scanList = null; st.scanGroup = null; if (st.scan) scanStep(true); renderTuner(); }
    else if (a === "cap-start" && st.worker) st.worker.postMessage({ t: "cap", cmd: "start" });
    else if (a === "cap-stop" && st.worker) st.worker.postMessage({ t: "cap", cmd: "stop" });
    else if (a === "cap-save" && st.worker) st.worker.postMessage({ t: "cap", cmd: "save" });
    else if (a === "pagers-clear") { st.pagers = []; renderPagers(); badge("pagers", 0); }
    else if (a === "devices-clear") { st.devices = []; renderDevices(); badge("devices", 0); }
    else if (a === "ble-clear") { st.ble = []; renderBle(); badge("ble", 0); }
    else if (a === "sweep") { if (st.sweep && st.sweep.on) stopSweep(); else startSweep(parseFloat(st.wb.querySelector("[data-gsr-swlo]").value), parseFloat(st.wb.querySelector("[data-gsr-swhi]").value)); }
    else if (a === "sweep-peak") { st.sweep = st.sweep || { on: false, lo: 88e6, hi: 108e6, bins: new Float32Array(512).fill(-120), cur: 0, rows: 0, passes: 0 }; st.sweep.peak = !st.sweep.peak; renderSpectrumTab(); }
    else if (a === "tv-scan") { if (st.scan && st.scanGroup === "tv") st.scan = false; else { st.scanGroup = "tv"; st.scanList = ATSC_CH.map(([, hz]) => ({ hz, mode: "NFM" })); st.scan = true; scanStep(true); } renderTrains(); }
    else if (a === "tune-pager") tune(929.6125e6, { mode: "NFM" });
    else if (a === "tune-ism") tune(433.92e6, { mode: "AM" });
    else if (a === "tune-315") tune(315e6, { mode: "AM" });
  }
  function onWbInput(e) {
    const t = e.target;
    if (t.matches("[data-gsr-sq]")) { st.squelch = Number(t.value); config(); renderTuner(); }
    else if (t.matches("[data-gsr-gain]")) { st.gain = Number(t.value); st.wb.querySelector("[data-gsr-gv]").textContent = st.gain + "%"; clearTimeout(st.gainTimer); st.gainTimer = setTimeout(applyGain, 120); }
    else if (t.matches("[data-gsr-pagerfilter]")) { st.pagerFilter = t.value; renderPagers(true); }
  }
  async function applyGain() { if (st.dev) { await serial(() => st.dev.setGain(st.gain)).catch(() => {}); renderTuner(); render(); } }
  function onWbChange(e) {
    const t = e.target;
    if (t.matches("[data-gsr-freq]")) { const v = parseFloat(String(t.value).replace(",", ".")); if (Number.isFinite(v) && v > 0) tune(Math.round(v * 1e6)); else renderTuner(); }
    else if (t.matches("[data-gsr-step]")) st.step = Number(t.value);
  }
  // SCAN: step through the presets (not 1090), holding while the signal is above squelch.
  function scanStep(first) {
    clearTimeout(st.scanTimer);
    if (!st.scan || !st.dev) { st.scan = false; renderTuner(); return; }
    const list = st.scanList || PRESETS.filter((p) => p.id !== "adsb");
    const open = st.squelch > -100 && st.level > st.squelch;
    if (!first && open) { st.scanTimer = setTimeout(() => scanStep(false), 1500); return; }
    let i = list.findIndex((p) => Math.abs(p.hz - st.tuned) < 1);
    const p = list[(i + 1) % list.length];
    tune(p.hz, { mode: p.mode, quiet: true, keepScan: true });
    st.scanTimer = setTimeout(() => scanStep(false), 2500);
  }
  // ---- Phase 2 workbench: spectrum / looking glass / zero-span / bursts / search
  function onSweepFft(m) {
    const sw = st.sweep;
    if (sw && sw.on && st.dev) {
      if (Math.abs(m.center - sw.cur) > 1) return;
      sw.rows += 1;
      if (sw.rows < 2) return; // skip the row that straddles the retune
      const n = m.db.length, lo = m.center - m.rate / 2, keep = 0.8;
      for (let i = Math.floor(n * (1 - keep) / 2); i < Math.ceil(n * (1 + keep) / 2); i += 1) {
        const f = lo + (i / n) * m.rate, b = Math.floor(((f - sw.lo) / (sw.hi - sw.lo)) * sw.bins.length);
        if (b >= 0 && b < sw.bins.length) sw.bins[b] = Math.max(sw.bins[b] * 0.6 + m.db[i] * 0.4, sw.peak ? sw.bins[b] : -200);
      }
      const step = m.rate * keep;
      let next = sw.cur + step;
      if (next - step / 2 > sw.hi) { next = sw.lo + step / 2; sw.passes += 1; }
      sweepTune(next);
      if (st.wbOpen && st.tab === "spectrum") drawSweep();
    }
  }
  function sweepTune(c) {
    const sw = st.sweep; sw.cur = Math.round(c); sw.rows = 0;
    st.center = sw.cur; st.tuned = sw.cur; config();
    serial(() => st.dev.setFrequency(sw.cur)).catch(() => {});
  }
  function startSweep(loMHz, hiMHz) {
    if (!st.dev) return;
    const lo = Math.max(st.dev.minHz, loMHz * 1e6), hi = Math.min(st.dev.maxHz, hiMHz * 1e6);
    if (!(hi > lo)) return;
    st.scan = false;
    st.sweep = { on: true, lo, hi, bins: new Float32Array(512).fill(-120), cur: 0, rows: 0, passes: 0, peak: st.sweep ? st.sweep.peak : false };
    sweepTune(lo + st.rate * 0.4);
    addLog(`Looking Glass sweep ${mhz(lo)}-${mhz(hi)} MHz`);
    renderSpectrumTab();
  }
  function stopSweep() { if (!st.sweep || !st.sweep.on) return; st.sweep.on = false; tune(st.tunerHz || st.tuned, { quiet: true }); addLog("Sweep stopped"); renderSpectrumTab(); }
  function drawSweep() {
    const c = st.wb && st.wb.querySelector("[data-gsr-sweep]"), sw = st.sweep;
    if (!c || !sw) return;
    const g = c.getContext("2d"), W = c.width, H = c.height, b = sw.bins;
    let mn = Infinity, mx = -Infinity; for (const v of b) { if (v > -119) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
    if (!Number.isFinite(mn)) { mn = -100; mx = -40; }
    const span = Math.max(20, mx - mn + 6);
    g.fillStyle = "#0b1117"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(148,163,184,0.16)"; for (let x = 0; x < W; x += W / 10) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    g.beginPath();
    for (let i = 0; i < b.length; i += 1) { const x = (i / (b.length - 1)) * W, y = H - Math.max(0, Math.min(1, (b[i] - mn + 3) / span)) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.strokeStyle = "#38bdf8"; g.lineWidth = 1.5; g.stroke();
    if (sw.on) { const x = ((sw.cur - sw.lo) / (sw.hi - sw.lo)) * W; g.strokeStyle = "#fbbf24"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    const lab = st.wb.querySelector("[data-gsr-sweepscale]");
    if (lab) lab.innerHTML = `<span>${mhz(sw.lo)}</span><span>${sw.on ? "sweeping · pass " + (sw.passes + 1) : "stopped"}</span><span>${mhz(sw.hi)}</span>`;
  }
  function pushZspan(db) {
    if (!Number.isFinite(db)) return;
    st.zspan.push(db); if (st.zspan.length > 400) st.zspan.shift();
    if (st.wbOpen && st.tab === "spectrum") drawZspan();
  }
  function drawZspan() {
    const c = st.wb && st.wb.querySelector("[data-gsr-zspan]");
    if (!c) return;
    const g = c.getContext("2d"), W = c.width, H = c.height, z = st.zspan;
    g.fillStyle = "#0b1117"; g.fillRect(0, 0, W, H);
    if (z.length < 2) return;
    g.beginPath();
    for (let i = 0; i < z.length; i += 1) { const x = W - (z.length - 1 - i) * (W / 400), y = H - Math.max(0, Math.min(1, (z[i] + 100) / 100)) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.strokeStyle = "#a5b4fc"; g.lineWidth = 1.5; g.stroke();
    if (st.squelch > -100) { const y = H - ((st.squelch + 100) / 100) * H; g.setLineDash([4, 4]); g.strokeStyle = "#fbbf24"; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]); }
  }
  function burstBits(runs) {
    const highs = runs.filter((r) => r > 0);
    if (!highs.length) return "";
    const unit = Math.max(1, Math.min(...highs.map(Math.abs)));
    let s = "";
    for (const r of runs) { const k = Math.min(8, Math.max(1, Math.round(Math.abs(r) / unit))); s += (r > 0 ? "1" : "0").repeat(k); if (s.length > 160) break; }
    return s.slice(0, 160);
  }
  function renderSpectrumTab() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="spectrum"]');
    if (!pane || st.tab !== "spectrum") return;
    const sw = st.sweep, on = Boolean(sw && sw.on), dis = st.dev ? "" : "disabled";
    if (!pane.querySelector("[data-gsr-sweep]")) {
      pane.innerHTML =
        `<h4 class="gsr-h">LOOKING GLASS SWEEP</h4>` +
        `<div class="gsr-row gsr-wrap"><label class="gsr-mini">FROM <input class="gsr-input gsr-num" data-gsr-swlo value="88" inputmode="decimal" aria-label="Sweep start MHz"></label><label class="gsr-mini">TO <input class="gsr-input gsr-num" data-gsr-swhi value="108" inputmode="decimal" aria-label="Sweep end MHz"></label><span class="gsr-mini">MHz</span>` +
        `<button type="button" class="gsr-btn" data-gsr="sweep" ${dis}></button><button type="button" class="gsr-btn" data-gsr="sweep-peak" aria-pressed="false">PEAK HOLD</button></div>` +
        `<div class="gsr-chips">${[["FM", 88, 108], ["Air", 118, 137], ["2 m", 144, 148], ["Marine", 156, 163], ["70 cm", 420, 450], ["UHF TV", 470, 608], ["ISM 900", 902, 928], ["LTE 700", 729, 756]].map(([l, a, b]) => `<button type="button" class="gsr-chip" data-gsr-swpre="${a},${b}" ${dis}>${l}</button>`).join("")}</div>` +
        `<div class="gsr-scope gsr-scope-sm"><canvas data-gsr-sweep width="1024" height="120" aria-label="Wideband sweep"></canvas><div class="gsr-scale" data-gsr-sweepscale></div></div>` +
        `<h4 class="gsr-h">ZERO-SPAN (SIGNAL LEVEL OVER TIME)</h4>` +
        `<div class="gsr-scope gsr-scope-sm"><canvas data-gsr-zspan width="1024" height="80" aria-label="Zero span level"></canvas></div>` +
        `<h4 class="gsr-h">SEARCH: ACTIVE CHANNELS</h4><div class="gsr-list" data-gsr-act></div>` +
        `<h4 class="gsr-h">BURSTS TO BITS (OOK / ISM)</h4><div class="gsr-list" data-gsr-bursts></div>` +
        `<p class="gsr-hint">Sweep steps the radio across the range and stitches the spectrum together (receive only). Search lists the strongest carriers in the current window; tap TUNE to listen.</p>`;
    }
    const b = pane.querySelector('[data-gsr="sweep"]');
    b.textContent = on ? "STOP SWEEP" : "START SWEEP"; b.disabled = !st.dev; b.classList.toggle("gsr-warn", on);
    pane.querySelector('[data-gsr="sweep-peak"]').setAttribute("aria-pressed", sw && sw.peak ? "true" : "false");
    for (const c of pane.querySelectorAll("[data-gsr-swpre]")) c.disabled = !st.dev;
    const act = st.act.slice(0, 16);
    pane.querySelector("[data-gsr-act]").innerHTML = act.length
      ? tableHtml(["MHZ", "LEVEL", "SNR", "WIDTH", "BAND", ""], act.map((a) => `<tr><td>${esc(mhz(a.hz))}</td><td>${esc(a.db)} dB</td><td>${esc(a.snr)} dB</td><td>${esc(a.bwHz >= 1e3 ? (a.bwHz / 1e3).toFixed(0) + " kHz" : a.bwHz + " Hz")}</td><td>${esc(bandOf(a.hz).toUpperCase())}</td><td><button type="button" class="gsr-btn gsr-xs" data-gsr-tunehz="${a.hz}">TUNE</button></td></tr>`).join(""))
      : `<p class="gsr-empty">${st.dev ? "No carriers above the noise floor right now." : "Connect a radio to search for active channels."}</p>`;
    pane.querySelector("[data-gsr-bursts]").innerHTML = st.bursts.length
      ? tableHtml(["TIME", "MHZ", "DECODED AS", "PULSES", "BITS (1 = carrier on)"], st.bursts.slice(0, 12).map((x) => `<tr><td>${esc(x.t)}</td><td>${esc(mhz(x.freq))}</td><td>${esc(x.label)}</td><td>${esc(x.runs.length)}</td><td class="gsr-bits">${esc(burstBits(x.runs))}</td></tr>`).join(""))
      : `<p class="gsr-empty">Tune 315 or 433.92 MHz: every OOK burst is shown here as raw bits.</p>`;
    if (sw) drawSweep();
    drawZspan();
  }
  function devReading(d) {
    const out = [];
    if (Number.isFinite(d.kpa)) out.push(d.kpa.toFixed(1) + " kPa / " + (d.kpa * 0.145038).toFixed(1) + " psi");
    if (Number.isFinite(d.tempC)) out.push(d.tempC + " °C");
    if (Number.isFinite(d.humidity)) out.push(d.humidity + " % RH");
    if (d.detail) out.push(d.detail);
    return out.join(" · ") || "—";
  }
  function renderDevices() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="devices"]');
    if (!pane || st.tab !== "devices") return;
    const body = st.devices.slice(0, 150).map((d) => `<tr><td>${esc(d.kind)}</td><td>${esc(d.id || "—")}</td><td>${esc(d.fmt || "")}</td><td class="gsr-msg">${esc(devReading(d))}</td><td>${esc(Number.isFinite(d.rssi) ? d.rssi + " dB" : "")}</td><td>${esc(d.count)}</td><td>${esc(d.last)}</td></tr>`).join("");
    pane.innerHTML = `<div class="gsr-row gsr-wrap"><button type="button" class="gsr-btn" data-gsr="tune-ism">TUNE 433.92</button><button type="button" class="gsr-btn" data-gsr="tune-315">TUNE 315</button><button type="button" class="gsr-btn" data-gsr-tunehz="915000000" data-gsr-tmode="NFM">METERS 915</button><button type="button" class="gsr-btn" data-gsr-tunehz="908420000" data-gsr-tmode="NFM">Z-WAVE 908.42</button><button type="button" class="gsr-btn" data-gsr="devices-clear">CLEAR</button></div>` +
      `<div class="gsr-list">${st.devices.length ? tableHtml(["TYPE", "ID", "FORMAT", "READING", "SIGNAL", "SEEN", "LAST"], body) : `<p class="gsr-empty">${["tpms", "meter", "zwave"].includes(bandOf(st.tuned)) ? "Listening for sensors on " + mhz(st.tuned) + " MHz…" : "Tune 315 MHz (North America) or 433.92 MHz (Europe and Asia) for tire sensors, remotes and weather stations; 915 MHz for utility meters."}</p>`}</div>` +
      `<p class="gsr-hint">Decodes tire pressure sensors (two common formats, CRC checked), EV1527 key fobs and remotes, WH2-style weather sensors, ERT SCM utility meters, Z-Wave and LoRaWAN headers. Anything else appears as an unknown OOK burst in the Spectrum tab.</p>`;
  }
  function renderBle() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="ble"]');
    if (!pane || st.tab !== "ble") return;
    const ok = isHackrf();
    const banner = !st.dev ? `<p class="gsr-banner">Bluetooth LE advertising runs at 2.4 GHz. Connect a HackRF to scan it.</p>` : ok ? "" : `<p class="gsr-banner gsr-banner-warn"><b>Requires HackRF (2.4 GHz)</b> · ${esc(st.dev.name)} tops out at ${esc(mhz(st.dev.maxHz))} MHz.</p>`;
    const dis = ok ? "" : "disabled";
    const body = st.ble.slice(0, 150).map((d) => `<tr><td>${esc(d.addr)}</td><td>${esc(d.name || "—")}</td><td>${esc(d.company || d.tag || "")}</td><td>${esc(d.pdu || "")}</td><td>${esc(Number.isFinite(d.rssi) ? d.rssi + " dB" : "")}</td><td>${esc(d.chan || "")}</td><td>${esc(d.count)}</td><td>${esc(d.last)}</td></tr>`).join("");
    pane.innerHTML = banner +
      `<div class="gsr-row gsr-wrap"><button type="button" class="gsr-btn" data-gsr-tunehz="2402000000" ${dis}>CH 37 · 2402</button><button type="button" class="gsr-btn" data-gsr-tunehz="2426000000" ${dis}>CH 38 · 2426</button><button type="button" class="gsr-btn" data-gsr-tunehz="2480000000" ${dis}>CH 39 · 2480</button><button type="button" class="gsr-btn" data-gsr="ble-clear">CLEAR</button></div>` +
      `<div class="gsr-list">${st.ble.length ? tableHtml(["ADDRESS", "NAME", "MAKER / TYPE", "PDU", "SIGNAL", "CH", "SEEN", "LAST"], body) : `<p class="gsr-empty">${ok && bandOf(st.tuned) === "ble" ? "Listening for advertisements on " + mhz(st.tuned) + " MHz…" : "No Bluetooth advertisements yet."}</p>`}</div>` +
      `<p class="gsr-hint">Passive only: reads public advertising packets (whitening and CRC-24 checked). Many phones rotate random addresses every few minutes. Nothing is ever transmitted or connected.</p>`;
  }
  const VOICE = [
    ["CB", [["Ch 9 · emergency", 27.065e6, "AM"], ["Ch 19 · highway", 27.185e6, "AM"], ["Ch 1", 26.965e6, "AM"], ["Ch 40", 27.405e6, "AM"]]],
    ["GMRS / FRS", [["Ch 1", 462.5625e6, "NFM"], ["Ch 3", 462.6125e6, "NFM"], ["Ch 7", 462.7125e6, "NFM"], ["Ch 15", 462.55e6, "NFM"], ["Ch 20 · 462.675", 462.675e6, "NFM"]]],
    ["MURS", [["151.820", 151.82e6, "NFM"], ["151.880", 151.88e6, "NFM"], ["151.940", 151.94e6, "NFM"], ["154.570", 154.57e6, "NFM"], ["154.600", 154.6e6, "NFM"]]],
    ["Repeaters", [["2 m 146.940", 146.94e6, "NFM"], ["2 m 147.000", 147.0e6, "NFM"], ["70 cm 442.000", 442.0e6, "NFM"], ["70 cm 444.000", 444.0e6, "NFM"]]],
    ["Ham calling", [["2 m 146.520", 146.52e6, "NFM"], ["70 cm 446.000", 446.0e6, "NFM"], ["6 m 50.125", 50.125e6, "USB"], ["10 m 28.400", 28.4e6, "USB"], ["20 m 14.230", 14.23e6, "USB"]]],
    ["FT8 / JS8", [["FT8 14.074", 14.074e6, "USB"], ["FT8 7.074", 7.074e6, "USB"], ["FT8 50.313", 50.313e6, "USB"], ["JS8 14.078", 14.078e6, "USB"], ["JS8 7.078", 7.078e6, "USB"]]],
  ];
  function renderVoice() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="voice"]');
    if (!pane || st.tab !== "voice") return;
    const dis = st.dev ? "" : "disabled";
    const groups = VOICE.map(([g, list], gi) => `<div class="gsr-group"><div class="gsr-group-head"><b>${esc(g)}</b><button type="button" class="gsr-btn gsr-xs" data-gsr-prowl="${gi}" aria-pressed="${st.scan && st.scanGroup === gi ? "true" : "false"}" ${dis}>${st.scan && st.scanGroup === gi ? "STOP" : "PROWL"}</button></div><div class="gsr-chips">${list.map(([l, hz, mode]) => `<button type="button" class="gsr-chip${Math.abs(hz - st.tuned) < 1 ? " on" : ""}" data-gsr-tunehz="${hz}" data-gsr-tmode="${mode}">${esc(l)}</button>`).join("")}</div></div>`).join("");
    const sats = Array.from(st.targets.sat.values()).sort((a, b) => (b.el || -90) - (a.el || -90)).slice(0, 10);
    const satHtml = !st.layers.sat ? `<p class="gsr-empty">Turn on AMATEUR SATELLITES (DOPPLER) to list passes and follow Doppler.</p>`
      : !sats.length ? `<p class="gsr-empty">${st.satInfo && st.satInfo.error ? "Could not load orbit data." : "Loading orbits…"}</p>`
      : tableHtml(["SATELLITE", "ELEV", "AZ", "DOWNLINK", "DOPPLER", ""], sats.map((s) => `<tr><td>${esc(s.satName)}</td><td>${esc(Number.isFinite(s.el) ? s.el.toFixed(0) + "°" : "—")}</td><td>${esc(Number.isFinite(s.az) ? Math.round(s.az) + "°" : "—")}</td><td>${esc(s.downlink ? s.downlink.toFixed(3) : "—")}</td><td>${esc(Number.isFinite(s.doppler) ? (s.doppler >= 0 ? "+" : "") + Math.round(s.doppler) + " Hz" : "—")}</td><td>${s.downlink ? `<button type="button" class="gsr-btn gsr-xs" data-gsr-sattrack="${esc(s.id)}" aria-pressed="${st.satTrack === s.id ? "true" : "false"}" ${dis}>${st.satTrack === s.id ? "FOLLOWING" : "FOLLOW"}</button>` : ""}</td></tr>`).join(""));
    const spots = Array.from(st.targets.aprs.values()).filter((t) => t.icon === "ft8").sort((a, b) => b.seen - a.seen).slice(0, 20);
    pane.innerHTML = `<div class="gsr-groups">${groups}</div>` +
      `<p class="gsr-hint">PROWL steps through a group and holds on any channel above the squelch (set squelch on the Tuner tab). HF bands need a HackRF or an upconverter.</p>` +
      `<h4 class="gsr-h">SATELLITE PASSES</h4><div class="gsr-list">${satHtml}</div>` +
      `<h4 class="gsr-h">FT8 / JS8 SPOTS</h4><div class="gsr-list">${spots.length ? tableHtml(["CALL", "MODE", "GRID", "SNR", "MESSAGE", "LAST"], spots.map((t) => `<tr><td>${esc(t.call)}</td><td>${esc(t.mode)}</td><td>${esc(t.grid)}</td><td>${esc(Number.isFinite(t.snr) ? t.snr : "")}</td><td class="gsr-msg">${esc(t.ftText)}</td><td>${esc(ago(t.seen))}</td></tr>`).join("")) : `<p class="gsr-empty">Tune an FT8 or JS8 dial frequency to collect spots. Spots with a grid square appear on LOCAL APRS STATIONS.</p>`}</div>`;
  }
  const ATSC_CH = Array.from({ length: 23 }, (_, i) => [14 + i, 470e6 + i * 6e6 + 309441]);
  function renderTrains() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="trains"]');
    if (!pane || st.tab !== "trains") return;
    const dis = st.dev ? "" : "disabled";
    const tr = st.trains.slice(0, 60).map((d) => `<tr><td>${esc(d.unit)}</td><td>${esc(d.kind)}</td><td>${esc(d.psi != null ? d.psi + " psi" : "—")}</td><td>${esc(d.motion != null ? (d.motion ? "moving" : "stopped") : "—")}</td><td>${esc(d.markerLight != null ? (d.markerLight ? "on" : "off") : "—")}</td><td>${esc(d.battery || "—")}</td><td>${esc(d.count)}</td><td>${esc(d.last)}</td></tr>`).join("");
    const cells = st.cells.slice(0, 20).map((c) => `<tr><td>${esc(mhz(c.freq))}</td><td>${esc(c.nid2)}</td><td>${esc(c.score >= 1 ? "strong" : c.score >= 0.5 ? "good" : "weak")}</td><td>${esc(c.count)}</td><td>${esc(c.last)}</td></tr>`).join("");
    const alerts = st.alerts.slice(0, 20).map((a) => `<p><time>${esc(a.t)}</time> <b>${esc(a.category)}</b> ${esc(a.text)}</p>`).join("");
    const tv = Object.values(st.atsc).sort((a, b) => a.channel - b.channel).map((a) => `<tr><td>${esc(a.channel)}</td><td>${esc(mhz(a.freq))}</td><td>${esc(a.pilot)} dB</td><td>${esc(a.plateau)} dB</td><td>${esc(a.t)}</td></tr>`).join("");
    pane.innerHTML =
      `<h4 class="gsr-h">TRAINS: END / HEAD OF TRAIN</h4>` +
      `<div class="gsr-row gsr-wrap"><button type="button" class="gsr-btn" data-gsr-tunehz="457937500" data-gsr-tmode="NFM">EOT 457.9375</button><button type="button" class="gsr-btn" data-gsr-tunehz="452937500" data-gsr-tmode="NFM">HOT 452.9375</button><button type="button" class="gsr-btn" data-gsr-tunehz="220500000" data-gsr-tmode="NFM">PTC 220.5 (activity)</button></div>` +
      `<div class="gsr-list">${tr ? tableHtml(["UNIT", "TYPE", "BRAKE PIPE", "MOTION", "MARKER", "BATTERY", "SEEN", "LAST"], tr) : `<p class="gsr-empty">Tune 457.9375 MHz near a rail line to hear end-of-train devices.</p>`}</div>` +
      `<h4 class="gsr-h">CELL: LTE CARRIERS &amp; WIRELESS ALERTS</h4>` +
      `<div class="gsr-row gsr-wrap"><button type="button" class="gsr-btn" data-gsr-tunehz="751000000" ${dis}>BAND 13 · 751</button><button type="button" class="gsr-btn" data-gsr-tunehz="739000000" ${dis}>BAND 12 · 739</button><button type="button" class="gsr-btn" data-gsr-tunehz="634500000" ${dis}>BAND 71 · 634.5</button><button type="button" class="gsr-btn" data-gsr-tunehz="881500000" ${dis}>BAND 5 · 881.5</button></div>` +
      `<div class="gsr-list">${cells ? tableHtml(["MHZ", "PSS ID", "MATCH", "SEEN", "LAST"], cells) : `<p class="gsr-empty">No LTE carriers found yet.</p>`}</div>` +
      `<div class="gsr-log">${alerts || '<p class="gsr-empty">No wireless emergency alerts heard. Alerts with an area appear on LTE ALERT AREAS.</p>'}</div>` +
      `<h4 class="gsr-h">TV: ATSC CHANNELS</h4>` +
      `<div class="gsr-row gsr-wrap"><button type="button" class="gsr-btn" data-gsr="tv-scan" aria-pressed="${st.scan && st.scanGroup === "tv" ? "true" : "false"}" ${dis}>${st.scan && st.scanGroup === "tv" ? "STOP TV SCAN" : "SCAN UHF TV 14-36"}</button></div>` +
      `<div class="gsr-list">${tv ? tableHtml(["CH", "PILOT MHZ", "PILOT", "PLATEAU", "LAST"], tv) : `<p class="gsr-empty">Scan to find ATSC TV stations by their pilot tone.</p>`}</div>` +
      `<p class="gsr-hint">EOT/HOT is decoded (BCH checked). LTE carriers are found by their primary sync signal, and alerts are read from broadcast frames. TV stations are found by their pilot, not demodulated. Receive only.</p>`;
  }
  function renderLog() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="log"]');
    if (!pane || st.tab !== "log") return;
    const h = st.health;
    const pk = h ? h.packets : {};
    const names = [["adsb", "ADS-B"], ["uat", "UAT"], ["fisb", "FIS-B"], ["ais", "AIS"], ["aprs", "APRS"], ["sonde", "Sonde"], ["mesh", "Mesh"], ["lorawan", "LoRaWAN"], ["acars", "ACARS"], ["vdl2", "VDL2"], ["dispatch", "Dispatch"], ["meter", "Meter"], ["pager", "Pager"], ["flex", "FLEX"], ["device", "TPMS/OOK"], ["remote", "Remote"], ["weather", "Weather"], ["zwave", "Z-Wave"], ["ble", "BLE"], ["eot", "EOT"], ["lte", "LTE"], ["hd", "HD"], ["ft8", "FT8/JS8"]];
    const counts = h ? names.filter(([k]) => pk[k]).map(([k, l]) => `${l} ${pk[k]}`).join(" · ") || "none yet" : "—";
    const facts = [["Radio", st.dev ? st.dev.name + (st.dev.version ? " · " + st.dev.version : "") + (st.dev.tuner ? " · " + st.dev.tuner : "") : "Not connected"], ["Tuned", st.dev ? mhz(st.tuned) + " MHz " + st.mode : "—"], ["Band decoder", h ? String(h.band || "").toUpperCase() : "—"], ["Sample rate", h ? (h.rate / 1e6).toFixed(2) + " MS/s" : "—"], ["IQ level (RMS)", h ? h.iqRMS.toFixed(3) + (h.iqRMS > 0.7 ? " (too strong, lower gain)" : h.iqRMS < 0.02 ? " (weak, raise gain)" : "") : "—"], ["USB transfers", h ? h.transfers : "—"], ["Dropped", h ? h.dropped : "—"], ["Bias-T", st.dev && st.dev.biasT ? "ON (" + st.dev.biasVolts + ")" : "Off"], ["Decoded", counts], ["CRC failures", h ? h.crcFail : "—"]];
    const acars = st.acarsMsgs.slice(0, 40).map((x) => `<p><time>${esc(x.t)}</time> <b>${esc(x.proto || "ACARS")} ${esc(x.flight)}</b> ${esc(x.label)} ${esc(x.text)}</p>`).join("");
    pane.innerHTML = rows(facts) + `<h4 class="gsr-h">ACARS / VDL2 MESSAGES</h4><div class="gsr-log">${acars || '<p class="gsr-empty">Tune 131.550 MHz (ACARS) or 136.975 MHz (VDL2).</p>'}</div>` +
      `<h4 class="gsr-h">EVENTS</h4><div class="gsr-log">${st.log.slice(0, 120).map((l) => `<p><time>${esc(l.t)}</time> ${esc(l.text)}</p>`).join("") || '<p class="gsr-empty">Nothing yet.</p>'}</div>`;
  }
  function tableHtml(head, body) { return `<table class="gsr-table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`; }
  function renderPagers(keepFocus) {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="pagers"]');
    if (!pane || st.tab !== "pagers") return;
    const q = String(st.pagerFilter || "").toLowerCase();
    const list = st.pagers.filter((p) => !q || (p.capcode + " " + p.text).toLowerCase().includes(q)).slice(0, 150);
    const body = list.map((p) => `<tr><td>${esc(p.t)}</td><td>${esc(mhz(p.freq))}</td><td>${esc(p.capcode)}</td><td>${esc(p.proto + " " + p.baud)}</td><td class="gsr-msg">${esc(p.text)}${p.repeats > 1 ? ` <em>×${p.repeats}</em>` : ""}</td></tr>`).join("");
    const listHtml = list.length ? tableHtml(["TIME", "MHZ", "CAPCODE", "TYPE", "MESSAGE"], body)
      : `<p class="gsr-empty">${bandOf(st.tuned) === "pager" ? "Listening for POCSAG pages on " + mhz(st.tuned) + " MHz…" : "Tune a pager frequency (152-159 MHz or 929-932 MHz) to decode POCSAG pages."}</p>`;
    if (keepFocus && pane.querySelector("[data-gsr-pagerlist]")) { pane.querySelector("[data-gsr-pagerlist]").innerHTML = listHtml; return; }
    pane.innerHTML = `<div class="gsr-row"><input type="search" class="gsr-input" data-gsr-pagerfilter placeholder="Filter capcode or text" value="${esc(st.pagerFilter || "")}" aria-label="Filter pages"><button type="button" class="gsr-btn" data-gsr="tune-pager">TUNE 929.6125</button><button type="button" class="gsr-btn" data-gsr="pagers-clear">CLEAR</button></div>` +
      `<div class="gsr-list" data-gsr-pagerlist>${listHtml}</div>` +
      `<p class="gsr-hint">POCSAG 512 / 1200 / 2400 baud, numeric and text. Pages stay on this device and are never sent anywhere. Laws on reading pager traffic vary by country; in the US, display-pager content is protected by the ECPA.</p>`;
  }
  function renderCapture() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="capture"]');
    if (!pane || st.tab !== "capture") return;
    const c = st.cap;
    pane.innerHTML = `<div class="gsr-row"><button type="button" class="gsr-btn ${c.on ? "gsr-warn" : "gsr-primary"}" data-gsr="${c.on ? "cap-stop" : "cap-start"}" ${st.dev ? "" : "disabled"}>${c.on ? "STOP CAPTURE" : "START CAPTURE"}</button>` +
      `<button type="button" class="gsr-btn" data-gsr="cap-save" ${c.bytes && !c.on ? "" : "disabled"}>SAVE .C8</button></div>` +
      `<dl class="nearby-facts gsr-facts"><dt>Status</dt><dd>${c.on ? "Recording" : c.bytes ? "Stopped, ready to save" : "Idle"}</dd><dt>Size</dt><dd>${(c.bytes / 1048576).toFixed(1)} MB of 256 MB</dd><dt>Length</dt><dd>${(c.secs || 0).toFixed(1)} s</dd><dt>Center</dt><dd>${st.dev ? mhz(st.center) + " MHz" : "—"}</dd><dt>Sample rate</dt><dd>${st.rate ? (st.rate / 1e6).toFixed(2) + " MS/s" : "—"}</dd></dl>` +
      `<p class="gsr-hint">Records raw IQ as signed 8-bit (.c8) in this browser's memory, then saves it to your device. Nothing is uploaded. Open it later in SDR software (for example as a HackRF capture).</p>`;
  }
  function saveCapture(m) {
    if (!m.bytes) return;
    const blob = new Blob(m.bufs, { type: "application/octet-stream" });
    const name = `globalstatus_${Math.round(m.center)}Hz_${Math.round(m.rate)}sps_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.c8`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = name; a.href = url; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    addLog(`Saved ${name} (${(m.bytes / 1048576).toFixed(1)} MB)`);
    st.cap = { on: false, bytes: 0, secs: 0 };
    renderCapture();
  }
  // ------------------------------------------------------------------ events + init
  async function biasClick() {
    if (!st.dev) return;
    if (st.dev.biasT) { await serial(() => st.dev.setBiasT(false)).catch(() => {}); st.biasArmed = false; addLog("Bias-T off"); render(); return; }
    if (!st.biasArmed) { st.biasArmed = true; render(); clearTimeout(st.biasTimer); st.biasTimer = setTimeout(() => { st.biasArmed = false; render(); }, 8000); return; }
    st.biasArmed = false;
    try { await serial(() => st.dev.setBiasT(true)); addLog(`Bias-T ON (${st.dev.biasVolts} on the antenna port)`); }
    catch (e) { setMessage(D().friendlyError(e, st.dev.kind), "error"); }
    render();
  }
  // ------------------------------------------------------------------ COMMUNITY LIVE SDR FEED (opt-in, GS-58)
  // Off on every page load. When on, every 15 s the public geo targets this radio is hearing
  // live are posted to /api/community/ingest. Everyone sees them on COMMUNITY FEED, and on
  // LIVE AIR TRAFFIC, GLOBAL MARITIME TRAFFIC, GLOBAL MESH NODES and GLOBAL AM FM TOWERS
  // when those feeds do not already have the target.
  // Never shared: pagers, tire sensors, Bluetooth, meters, radio GPS units, alerts, audio, IQ, ACARS text.
  const SHARE_EVERY = 15000;
  const SHARE_RX_GRID = 0.25; // receiver blurred to a ~25 km grid before it leaves the browser
  const SHARE_NEAR_RX_KM = 2; // ground targets this close to the receiver (your own node or station) stay private
  const SHARE_KINDS = ["adsb", "uat", "ais", "mesh", "aprs", "sonde", "acars", "hd"];
  function shareNote() {
    const sh = st.share;
    if (sh.armed) return "Tap CONFIRM to share the aircraft, ships, mesh nodes, APRS stations, weather balloons, ACARS positions and HD Radio towers your radio decodes with everyone on Global Status. Mesh messages are never sent. Nothing else is sent.";
    if (!sh.on) return SHARE_OFF_NOTE;
    if (sh.note) return sh.note;
    if (!st.dev && !st.mesh.dev) return "Sharing is on. Connect an SDR or mesh radio; nothing is sent until it hears something.";
    if (anySim() && !/^(localhost|127\.0\.0\.1)$/.test(root.location.hostname)) return "Sharing is on, but a simulated radio is never shared.";
    if (!sh.lastAt) return "Sharing is on. Waiting for live aircraft, ships, mesh nodes, APRS, balloons, ACARS or HD Radio.";
    const secs = Math.max(0, Math.round((Date.now() - sh.lastAt) / 1000));
    return `SHARING · ${sh.lastCount} target${sh.lastCount === 1 ? "" : "s"} sent ${secs} s ago · ${sh.sent} total. Shown to everyone for 2-5 min, labeled COMMUNITY SDR.`;
  }
  const MESH_SHARE_FRESH = 15 * 60e3;
  function meshOwnPos() { const o = st.mesh.dev && st.mesh.nodes.get(st.mesh.myId); return o && Number.isFinite(o.lat) ? { lat: o.lat, lon: o.lon } : null; }
  function shareRx() { return receiver() || meshOwnPos(); }
  const anySim = () => Boolean((st.dev && st.dev.sim) || (st.mesh.dev && st.mesh.sim));
  function shareItems() {
    const rx = shareRx();
    const meshOwn = meshOwnPos();
    const now = Date.now();
    const out = [];
    for (const k of SHARE_KINDS) {
      if (!isLive(k)) continue;
      for (const t of visibleTargets(k)) {
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
        if (t.src === "device") { if (t.own || t.viaMqtt || !t.heardAt || now - t.heardAt > MESH_SHARE_FRESH) continue; } // heard over the air by the mesh radio recently
        else if (now - t.seen > 60000) continue;
        const air = k === "adsb" || k === "uat";
        if (!air && rx && L().distanceKm(rx, t) < SHARE_NEAR_RX_KM) continue;
        if (!air && meshOwn && L().distanceKm(meshOwn, t) < SHARE_NEAR_RX_KM) continue;
        if (k === "uat" && t.uatKind !== "aircraft") continue;
        if (k === "aprs" && t.icon === "ft8") continue; // grid squares, not positions
        if (k === "ais" && (t.cls === "AtoN" || t.cls === "Base station")) continue;
        if (k === "acars" && t.acarsKind && t.acarsKind !== "aircraft") continue;
        const it = { k, lat: +t.lat.toFixed(5), lon: +t.lon.toFixed(5) };
        if (air) Object.assign(it, { id: t.icao, call: t.callsign || "", alt: t.alt, gs: t.speed, track: t.heading, vrate: t.vrate });
        else if (k === "ais") Object.assign(it, { id: String(t.mmsi), name: t.shipName || "", sog: t.sog, cog: t.cog, type: t.shiptype });
        else if (k === "mesh") Object.assign(it, { id: t.nodeId, name: t.longName || "", short: t.shortName || "", proto: t.proto || "" });
        else if (k === "aprs") Object.assign(it, { id: t.call, sym: t.symbol || "" });
        else if (k === "sonde") Object.assign(it, { id: t.serial, alt: t.alt, type: t.type || "" });
        else if (k === "acars") Object.assign(it, { id: t.icao || t.flight || t.reg || String(t.id || "").replace(/^ac-/, ""), call: t.flight || t.reg || "", alt: t.alt, proto: t.proto || "" });
        else if (k === "hd") Object.assign(it, { id: t.call, name: t.stationName || "", freq: t.freq });
        for (const key of Object.keys(it)) if (it[key] == null || (typeof it[key] === "number" && !Number.isFinite(it[key]))) delete it[key];
        out.push(it);
        if (out.length >= 240) return out;
      }
    }
    return out;
  }
  async function shareTick() {
    const sh = st.share;
    if (!sh.on || sh.busy || !(st.dev || st.mesh.dev) || Date.now() < sh.wait) return;
    if (anySim() && !/^(localhost|127\.0\.0\.1)$/.test(root.location.hostname)) { render(); return; }
    const items = shareItems();
    if (!items.length) { render(); return; }
    const rx = shareRx();
    const body = { v: 1, items };
    if (rx) body.rx = { lat: Math.round(rx.lat / SHARE_RX_GRID) * SHARE_RX_GRID, lon: Math.round(rx.lon / SHARE_RX_GRID) * SHARE_RX_GRID };
    sh.busy = true;
    try {
      const res = await fetch("/api/community/ingest", { method: "POST", headers: { "Content-Type": "application/json", "X-GSA-Community": "1" }, body: JSON.stringify(body), credentials: "omit" });
      const out = await res.json().catch(() => ({}));
      if (res.ok) { sh.note = ""; sh.lastAt = Date.now(); sh.lastCount = out.accepted || 0; sh.sent += out.accepted || 0; }
      else if (res.status === 429) { sh.wait = Date.now() + (out.retrySec || 30) * 1000; sh.note = "Sharing paused for a moment (rate limit). It resumes on its own."; }
      else sh.note = "The site did not accept this batch. Sharing keeps trying.";
    } catch (e) { sh.note = "Can't reach Global Status right now. Sharing keeps trying."; }
    sh.busy = false;
    render();
  }
  function shareClick() {
    const sh = st.share;
    if (sh.on) { sh.on = false; sh.note = ""; clearInterval(sh.timer); sh.timer = 0; addLog("Stopped sharing the live feed"); render(); return; }
    if (!sh.armed) { sh.armed = true; render(); clearTimeout(sh.armTimer); sh.armTimer = setTimeout(() => { sh.armed = false; render(); }, 10000); return; }
    sh.armed = false; sh.on = true; sh.note = "";
    addLog("Sharing the live feed with Global Status (public geo targets only)");
    clearInterval(sh.timer);
    sh.timer = setInterval(shareTick, SHARE_EVERY);
    setTimeout(shareTick, 1500);
    render();
  }

  // ------------------------------------------------------------------ CONNECT MESH (real Meshtastic / MeshCore radio)
  // mesh-device.js loads on the first Connect Mesh click. Read-only: the radio only receives the
  // want_config handshake and a heartbeat (Meshtastic) or read commands (MeshCore).
  // While a mesh radio is connected it is the only source for LOCAL MESH NODES; SDR over-the-air
  // mesh decodes are skipped and the SDR keeps tuning the other bands.
  const MESH_NODE_TTL = 48 * 3600e3;
  const scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { delete scriptCache[src]; reject(new Error("Couldn't load " + src.split("?")[0])); };
      document.head.appendChild(el);
    });
    return scriptCache[src];
  }
  function meshSupport() {
    if (st.mesh.support) return st.mesh.support;
    const nav = root.navigator || {}, secure = root.isSecureContext !== false;
    const serial = Boolean(nav.serial) && secure, ble = Boolean(nav.bluetooth) && secure;
    let reason = "";
    if (!serial && !ble) {
      const ua = String(nav.userAgent || "");
      if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) reason = "iPhone and iPad browsers can't connect to USB or Bluetooth mesh radios. Use Chrome or Edge on a computer, or Chrome on Android.";
      else if (/Firefox\//.test(ua)) reason = "Firefox can't connect to USB or Bluetooth mesh radios. Open Global Status in Chrome, Edge or Opera.";
      else if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) reason = "Safari can't connect to USB or Bluetooth mesh radios. Open Global Status in Chrome, Edge or Opera.";
      else reason = secure ? "This browser can't connect to USB or Bluetooth mesh radios. Use Chrome, Edge or Opera on a computer, or Chrome on Android." : "Mesh radios need a secure page.";
    }
    return (st.mesh.support = { ok: serial || ble, serial, ble, reason });
  }
  function meshMsg(text, kind) { st.mesh.message = text || ""; st.mesh.msgKind = kind || ""; render(); }
  function meshSourceText() {
    if (st.mesh.dev) return `Mesh source: Mesh radio (${st.mesh.dev.proto})` + (st.dev ? ". The SDR keeps every other band." : "");
    if (st.mesh.connecting) return "Mesh source: connecting to your mesh radio…";
    if (st.dev) return "Mesh source: SDR (over the air). Connect a mesh radio for its full node list and messages.";
    return "Mesh source: none yet. Connect a mesh radio, or an SDR for over-the-air mesh.";
  }
  function renderMeshBar() {
    const sup = meshSupport(), m = st.mesh, live = Boolean(m.dev);
    for (const dot of document.querySelectorAll("[data-mesh-dot]")) { dot.classList.toggle("is-live", live); dot.classList.toggle("is-busy", m.connecting); }
    setText("[data-mesh-status]", m.connecting ? "CONNECTING MESH RADIO…" : live ? `${m.dev.proto} · ${m.dev.name}`.toUpperCase() : sup.ok ? "NO MESH RADIO CONNECTED" : "MESH RADIOS NOT AVAILABLE HERE");
    let sum;
    if (!sup.ok) sum = sup.reason;
    else if (live) { const onMap = visibleTargets("mesh").filter((t) => t.src === "device").length; sum = `${onMap} node${onMap === 1 ? "" : "s"} on the map · ${m.nodes.size} in the radio · ${m.messages.length} message${m.messages.length === 1 ? "" : "s"} · ${m.dev.transport === "ble" ? "Bluetooth" : m.dev.transport === "serial" ? "USB" : "Simulated"}`; }
    else sum = "Plug in or pair a Meshtastic or MeshCore radio (USB or Bluetooth), then connect.";
    setText("[data-mesh-summary]", sum);
    setText("[data-mesh-source]", meshSourceText());
    for (const b of document.querySelectorAll('[data-sdr-act="mesh-connect"]')) {
      b.disabled = !sup.ok || m.connecting;
      b.textContent = live ? "DISCONNECT MESH" : m.choosing ? "CANCEL" : "CONNECT MESH";
      b.classList.toggle("gsr-primary", !live);
    }
    for (const c of document.querySelectorAll("[data-mesh-choose]")) c.hidden = !m.choosing || live;
    for (const b of document.querySelectorAll('[data-sdr-act="mesh-usb"]')) b.disabled = !sup.serial || m.connecting;
    for (const b of document.querySelectorAll('[data-sdr-act="mesh-ble"]')) b.disabled = !sup.ble || m.connecting;
    for (const n of document.querySelectorAll("[data-mesh-msg]")) { n.hidden = !m.message; n.textContent = m.message; n.classList.toggle("is-error", m.msgKind === "error"); }
    badge("mesh", m.dev ? m.messages.length : 0);
  }
  function meshConnectClick() {
    const m = st.mesh;
    if (m.connecting) return;
    if (m.dev) { meshDisconnect(); return; }
    const sup = meshSupport();
    if (!sup.ok) { meshMsg(sup.reason, "error"); return; }
    if (sup.serial && sup.ble) { m.choosing = !m.choosing; m.message = ""; render(); if (m.choosing) loadScript("/mesh-device.js?v=" + V).catch(() => {}); return; }
    meshConnect(sup.serial ? "serial" : "ble");
  }
  async function meshConnect(kind, simOpts) {
    const m = st.mesh;
    if (m.connecting || m.dev) return;
    m.choosing = false; m.connecting = true;
    m.nodes = new Map(); m.messages = []; m.channels = []; m.info = {}; m.lora = null; m.myId = ""; m.ready = false; m.otaSkipped = 0;
    meshMsg(kind === "ble" ? "Pick your radio in the Bluetooth list. Meshtastic default PIN is 123456 if it asks." : kind === "serial" ? "Pick your radio's USB port in the list." : "");
    try {
      await loadScript("/mesh-device.js?v=" + V);
      const sess = await root.GsaMeshDevice.connect(kind, { event: onMeshEvent, log: addLog, closed: onMeshClosed }, simOpts);
      m.sess = sess;
      m.sim = simOpts ? simOpts.sim || true : null;
      m.dev = { name: plain(sess.name).slice(0, 40) || "Mesh radio", proto: sess.proto === "meshcore" ? "MeshCore" : "Meshtastic", transport: sess.transport };
      m.message = "";
      meshBecameSource();
    } catch (e) {
      const t = root.GsaMeshDevice ? root.GsaMeshDevice.friendlyError(e) : "Couldn't load the mesh radio code. Check the connection and try again.";
      m.message = /No radio was picked/.test(t) ? "" : t; m.msgKind = "error";
    }
    m.connecting = false;
    render();
  }
  function meshDisconnect() { if (st.mesh.sess) st.mesh.sess.close(""); }
  function meshBecameSource() {
    // the mesh radio replaces SDR over-the-air mesh pins
    for (const [id, t] of st.targets.mesh) if (t.src !== "device") { st.targets.mesh.delete(id); if (L()) L().removeItem("mesh", id); }
    if (!st.layers.mesh) setLayer("mesh", true); else meshFeedAll();
    if (st.dev && bandOf(st.tuned) === "mesh") { const next = focusLayer(); if (next) tune(next.tune, { mode: next.mode, fromLayer: true }); }
    addLog(`Mesh radio connected: ${st.mesh.dev.name} (${st.mesh.dev.proto}). It is now the mesh source${st.dev ? "; the SDR keeps the other bands" : ""}.`);
    render();
  }
  function onMeshClosed(reason) {
    const m = st.mesh;
    if (!m.dev && !m.connecting) return;
    const had = Boolean(m.dev);
    m.dev = null; m.sess = null; m.sim = null;
    for (const [id, t] of st.targets.mesh) if (t.src === "device") { st.targets.mesh.delete(id); if (L()) L().removeItem("mesh", id); }
    hideCardFor("mesh");
    if (had) {
      addLog("Mesh radio disconnected" + (reason ? ": " + reason : ""));
      m.message = reason ? "Mesh radio disconnected. " + plain(reason) : ""; m.msgKind = reason ? "error" : "";
      const f = focusLayer();
      if (st.dev && f && f.key === "mesh") tune(f.tune, { mode: f.mode, fromLayer: true }); // SDR takes mesh back over the air
    }
    if (st.wbOpen && st.tab === "mesh") renderMeshTab();
    render();
  }
  function meshNode(id, patch) {
    if (!id) return null;
    let n = st.mesh.nodes.get(id);
    if (!n) { n = { id }; st.mesh.nodes.set(id, n); if (st.mesh.nodes.size > 1500) st.mesh.nodes.delete(st.mesh.nodes.keys().next().value); }
    for (const k of Object.keys(patch)) { const v = patch[k]; if (v !== undefined && v !== null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) n[k] = typeof v === "string" ? plain(v).slice(0, 60) : v; }
    if (id === st.mesh.myId) n.own = true;
    meshPush(n);
    return n;
  }
  function meshPush(n) {
    if (!st.mesh.dev || !accepts("mesh") || !Number.isFinite(n.lat)) return;
    const age = n.heardAt ? Date.now() - n.heardAt : 0;
    if (age > MESH_NODE_TTL) return;
    const t = touch("mesh", n.id, { nodeId: n.id });
    for (const k of ["longName", "shortName", "hw", "role", "proto", "nodeKind", "alt", "snr", "rssi", "hops", "battery", "voltage", "chUtil", "airUtilTx", "uptime", "tempC", "rh", "pressure", "heardAt", "viaMqtt", "own", "precisionBits", "sats", "lastPort"]) if (n[k] !== undefined) t[k] = n[k];
    t.src = "device"; t.icon = "mesh"; t.nodeId = n.id;
    t.ttl = Math.max(5000, MESH_NODE_TTL - age);
    t.lat = n.lat; t.lon = n.lon; pushTrack(t, 40);
    t.name = n.longName || n.shortName || n.id;
    t.label = (n.own ? "★ " : "") + (n.shortName || n.longName || n.id);
    scheduleDraw("mesh");
  }
  function meshFeedAll() { if (st.mesh.dev) for (const n of st.mesh.nodes.values()) meshPush(n); }
  const secsToMs = (s) => (s && s > 1.5e9 ? Math.min(Date.now(), s * 1000) : undefined);
  function meshMessage(msg) {
    const m = st.mesh;
    const text = plain(msg.text || "").slice(0, 400);
    if (!text) return;
    m.messages.unshift(Object.assign({ at: Date.now(), t: nowTime() }, msg, { text }));
    if (m.messages.length > 300) m.messages.length = 300;
    if (st.wbOpen && st.tab === "mesh") renderMeshTab();
    render();
  }
  const chName = (i) => { const c = st.mesh.channels.find((x) => x.index === i); return c ? c.name : i ? "Channel " + i : "Primary"; };
  const nodeName = (id) => { const n = st.mesh.nodes.get(id); return n ? n.longName || n.shortName || id : id; };
  function onMeshEvent(e) {
    const m = st.mesh, now = Date.now();
    switch (e.type) {
      case "myInfo": m.myId = e.myId; m.info.nodeId = e.myId; m.info.nodedbCount = e.nodedbCount; meshNode(e.myId, { own: true, proto: "Meshtastic" }); break;
      case "metadata": Object.assign(m.info, { firmware: e.firmware, hw: e.hw, role: e.role }); break;
      case "lora": m.lora = e; break;
      case "channel": if (e.role !== "Disabled") { m.channels = m.channels.filter((c) => c.index !== e.index); m.channels.push({ index: e.index, name: plain(e.name) || (e.index === 0 ? "Primary (default)" : "Channel " + e.index), role: e.role, encrypted: e.encrypted }); m.channels.sort((a, b) => a.index - b.index); } break;
      case "node": {
        const u = e.user || {}, p = e.position || {}, d = e.metrics || {};
        meshNode(e.id, { longName: u.longName, shortName: u.shortName, hw: u.hw, role: u.role, proto: "Meshtastic", lat: p.lat, lon: p.lon, alt: p.alt, precisionBits: p.precisionBits, snr: e.snr, hops: e.hops, battery: d.battery, voltage: d.voltage, chUtil: d.chUtil, airUtilTx: d.airUtilTx, uptime: d.uptime, viaMqtt: e.viaMqtt || undefined, heardAt: e.id === m.myId ? now : secsToMs(e.lastHeard) });
        break;
      }
      case "packet": {
        if (!e.fromId || e.from === 0) break;
        const patch = { heardAt: now, snr: e.snr, rssi: e.rssi, hops: e.hops, lastPort: e.portName || (e.encrypted ? "Encrypted" : ""), proto: "Meshtastic" };
        if (e.viaMqtt) patch.viaMqtt = true;
        if (e.position && Number.isFinite(e.position.lat)) Object.assign(patch, { lat: e.position.lat, lon: e.position.lon, alt: e.position.alt, sats: e.position.sats, precisionBits: e.position.precisionBits });
        if (e.user) Object.assign(patch, { longName: e.user.longName, shortName: e.user.shortName, hw: e.user.hw, role: e.user.role });
        if (e.telemetry && e.telemetry.device) { const d = e.telemetry.device; Object.assign(patch, { battery: d.battery, voltage: d.voltage, chUtil: d.chUtil, airUtilTx: d.airUtilTx, uptime: d.uptime }); }
        if (e.telemetry && e.telemetry.env) { const v = e.telemetry.env; Object.assign(patch, { tempC: v.tempC, rh: v.rh, pressure: v.pressure }); }
        meshNode(e.fromId, patch);
        if (e.port === 1 && e.text) meshMessage({ ch: e.broadcast ? chName(e.channel) : "Direct", dm: !e.broadcast, fromId: e.fromId, from: nodeName(e.fromId), snr: e.snr, hops: e.hops, text: e.text });
        break;
      }
      case "configComplete": m.ready = true; addLog(`Mesh radio: ${m.nodes.size} nodes, ${m.channels.length} channels loaded`); break;
      case "rebooted": addLog("Mesh radio restarted"); break;
      case "mcSelf": m.myId = e.id; Object.assign(m.info, { nodeId: e.id, name: e.name, kind: e.kind, freq: e.freqMHz ? e.freqMHz.toFixed(3) + " MHz" : "", lora: e.sf ? `SF${e.sf} · ${e.bwKHz} kHz · CR 4/${e.cr}` : "" }); meshNode(e.id, { own: true, longName: e.name, nodeKind: e.kind, proto: "MeshCore", lat: e.lat, lon: e.lon, heardAt: now }); break;
      case "mcDeviceInfo": Object.assign(m.info, { hw: e.model, firmware: e.version || (e.fwVer ? "v" + e.fwVer : "") }); break;
      case "mcContact": meshNode(e.id, { longName: e.name, nodeKind: e.kind, role: e.kind, proto: "MeshCore", lat: e.lat, lon: e.lon, hops: e.hops, heardAt: secsToMs(e.lastAdvert) || (e.push ? now : undefined) }); break;
      case "mcChannel": m.channels = m.channels.filter((c) => c.index !== e.index); if (e.name) { m.channels.push({ index: e.index, name: plain(e.name), role: e.index === 0 ? "Primary" : "Secondary" }); m.channels.sort((a, b) => a.index - b.index); } break;
      case "mcText": {
        let from = "", fromId = "", text = e.text || "";
        if (e.dm) { fromId = e.fromId; from = nodeName(fromId); }
        else { const mm = /^([^:]{1,32}):\s*([\s\S]*)$/.exec(text); if (mm) { from = mm[1]; text = mm[2]; } }
        if (fromId) meshNode(fromId, { heardAt: now, snr: e.snr });
        meshMessage({ ch: e.dm ? "Direct" : chName(e.channel), dm: e.dm, fromId, from: from || "Unknown", snr: e.snr, hops: e.hops, text });
        break;
      }
      default: break;
    }
    if (m.dev) { if (st.wbOpen && st.tab === "mesh" && e.type !== "packet") renderMeshTab(); }
  }
  function agoLong(ms) { if (!ms) return ""; const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (s < 60) return s + " s ago"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago"; }
  function meshCardHtml(item, t) {
    const d = st.mesh.dev;
    const src = `<span data-sdr-card="${esc(item.id)}" hidden></span><p class="gsr-src">${t.own ? "Your own mesh radio" : "From your mesh radio"}${d ? " · " + esc(d.name) + " · " + esc(d.proto) : ""}</p>`;
    return src + rows([["Node", t.nodeId], ["Long name", t.longName], ["Short name", t.shortName], ["Protocol", t.proto], ["Type", t.nodeKind && t.nodeKind !== t.role ? t.nodeKind : ""], ["Role", t.role], ["Hardware", t.hw], ["Battery", Number.isFinite(t.battery) ? (t.battery > 100 ? "external power" : t.battery + " %") : ""], ["Voltage", Number.isFinite(t.voltage) && t.voltage ? t.voltage.toFixed(2) + " V" : ""], ["Channel use", Number.isFinite(t.chUtil) ? t.chUtil.toFixed(1) + " %" : ""], ["Airtime (TX)", Number.isFinite(t.airUtilTx) ? t.airUtilTx.toFixed(1) + " %" : ""], ["Temperature", Number.isFinite(t.tempC) ? t.tempC.toFixed(1) + " °C" : ""], ["Humidity", Number.isFinite(t.rh) ? Math.round(t.rh) + " %" : ""], ["Pressure", Number.isFinite(t.pressure) ? t.pressure.toFixed(1) + " hPa" : ""], ["Altitude", Number.isFinite(t.alt) && t.alt ? t.alt + " m" : ""], ["Position", Number.isFinite(t.precisionBits) && t.precisionBits > 0 && t.precisionBits < 32 ? "approximate (shared at reduced precision)" : ""], ["Hops away", t.hops], ["SNR", Number.isFinite(t.snr) && !t.own ? t.snr + " dB" : ""], ["Signal", Number.isFinite(t.rssi) && t.rssi && !t.own ? t.rssi + " dBm" : ""], ["Last packet", t.lastPort], ["Heard via", t.viaMqtt ? "internet (MQTT), not over the air" : ""], ["Range", rangeText(t)], ["Last heard", t.own ? "now (connected)" : agoLong(t.heardAt)]]);
  }
  function renderMeshTab() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="mesh"]');
    if (!pane || st.tab !== "mesh") return;
    const m = st.mesh, d = m.dev, sup = meshSupport();
    const btn = `<button type="button" class="gsr-btn ${d ? "" : "gsr-primary"}" data-sdr-act="mesh-connect" ${!sup.ok || m.connecting ? "disabled" : ""}>${d ? "DISCONNECT MESH" : m.connecting ? "CONNECTING…" : "CONNECT MESH"}</button>`;
    let html = `<div class="gsr-row">${btn}</div><p class="gsr-hint gsr-mesh-src">${esc(meshSourceText())}</p>`;
    if (!sup.ok) html += `<p class="gsr-empty">${esc(sup.reason)}</p>`;
    if (m.message) html += `<p class="gsr-hint">${esc(m.message)}</p>`;
    if (!d) {
      html += `<p class="gsr-empty">${st.dev ? "Mesh nodes are coming from your SDR over the air (LOCAL MESH NODES). Connect a Meshtastic or MeshCore radio to read its node list, channels and messages; it then becomes the mesh source." : "Connect a Meshtastic or MeshCore radio by USB cable or Bluetooth to see its nodes on the map, plus its channels and messages here."}</p>`;
      html += `<p class="gsr-hint">Works in Chrome, Edge and Opera on a computer (USB or Bluetooth) and Chrome on Android (Bluetooth). Safari, Firefox and iPhone / iPad browsers can't connect to radios.</p>`;
      pane.innerHTML = html;
      return;
    }
    const lora = m.lora ? [["Region", m.lora.region], ["Preset", m.lora.preset], ["Hop limit", m.lora.hopLimit]] : [["Frequency", m.info.freq], ["LoRa", m.info.lora]];
    html += `<h4 class="gsr-h">RADIO</h4>` + rows([["Radio", d.name], ["Protocol", d.proto], ["Connection", d.transport === "ble" ? "Bluetooth" : d.transport === "serial" ? "USB cable" : "Simulated"], ["Node", m.info.nodeId], ["Name", m.info.name || (m.nodes.get(m.myId) || {}).longName], ["Hardware", m.info.hw], ["Firmware", m.info.firmware], ["Role", m.info.role || m.info.kind]].concat(lora, [["Nodes in radio", m.nodes.size], ["SDR mesh decodes skipped", st.dev ? m.otaSkipped : ""]]));
    const ch = m.channels.map((c) => `<tr><td>${esc(c.index)}</td><td>${esc(c.name)}</td><td>${esc(c.role || "")}</td></tr>`).join("");
    html += `<h4 class="gsr-h">CHANNELS</h4>` + (ch ? `<div class="gsr-list">${tableHtml(["#", "NAME", "ROLE"], ch)}</div>` : `<p class="gsr-empty">Reading channels…</p>`);
    const msgs = m.messages.slice(0, 100).map((x) => `<tr><td>${esc(x.t)}</td><td>${esc(x.ch)}</td><td>${esc(x.from || x.fromId || "")}</td><td class="gsr-msg">${esc(x.text)}</td></tr>`).join("");
    html += `<h4 class="gsr-h">MESSAGES <em>${m.messages.length}</em></h4>` + (msgs ? `<div class="gsr-list">${tableHtml(["TIME", "CHANNEL", "FROM", "MESSAGE"], msgs)}</div>` : `<p class="gsr-empty">No messages since connecting. New channel and direct messages your radio receives appear here.</p>`);
    const list = Array.from(m.nodes.values()).sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0) || (b.heardAt || 0) - (a.heardAt || 0)).slice(0, 150);
    const nb = list.map((n) => `<tr><td>${esc((n.own ? "★ " : "") + (n.longName || n.shortName || n.id))}</td><td>${esc(n.id)}</td><td>${esc(n.hw || n.nodeKind || "")}</td><td>${esc(Number.isFinite(n.battery) ? (n.battery > 100 ? "ext" : n.battery + "%") : "")}</td><td>${esc(Number.isFinite(n.lat) ? "yes" : "no")}</td><td>${esc(n.hops != null ? n.hops : "")}</td><td>${esc(n.own ? "now" : agoLong(n.heardAt))}</td></tr>`).join("");
    html += `<h4 class="gsr-h">NODES <em>${m.nodes.size}</em></h4><div class="gsr-list">${tableHtml(["NAME", "ID", "HARDWARE", "BATTERY", "ON MAP", "HOPS", "HEARD"], nb)}</div>`;
    html += `<p class="gsr-hint">Read only: Global Status never sends messages, changes settings or restarts your radio. Messages stay on this device and are never shared. With SHARE LIVE FEED on, only node positions heard over the air in the last 15 minutes are shared (never your own node or anything within 2 km of it).</p>`;
    const top = pane.scrollTop;
    pane.innerHTML = html;
    pane.scrollTop = top;
  }

  function onDocClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const act = t.closest("[data-sdr-act]");
    if (act) {
      e.preventDefault();
      if (root.GsaWelcome && root.GsaWelcome.stopSpin) root.GsaWelcome.stopSpin();
      const a = act.dataset.sdrAct;
      if (a === "connect") connectClick();
      else if (a === "bias") biasClick();
      else if (a === "share") shareClick();
      else if (a === "mesh-connect") meshConnectClick();
      else if (a === "mesh-usb") meshConnect("serial");
      else if (a === "mesh-ble") meshConnect("ble");
      else if (a === "mesh-tab") openWorkbench("mesh");
      else if (a === "workbench") { if (st.wbOpen) closeWorkbench(); else openWorkbench(); }
      return;
    }
    const sw = t.closest("[data-sdr-toggle], [data-welcome-sdr]");
    if (sw) { e.preventDefault(); const key = sw.dataset.sdrToggle || sw.dataset.welcomeSdr; setLayer(key, !st.layers[key]); }
  }
  let viewerFn = null;
  let started = false;
  function init(opts) {
    if (started) return;
    started = true;
    const v = opts && opts.viewer;
    viewerFn = typeof v === "function" ? v : () => v;
    if (L()) L().init({ viewer: viewerFn });
    buildRail();
    document.addEventListener("click", onDocClick);
    // The welcome picker is built lazily: refresh the SDR rows when its category opens (no USB calls).
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest('[data-welcome-toggle="sdr"]')) setTimeout(render, 0); });
    setInterval(() => { if (!st.dev && !st.mesh.dev) return; for (const k of MAPKEYS) if (k !== "sat" && st.layers[k] && st.targets[k].size) scheduleDraw(k); }, 5000);
    render();
  }

  // ------------------------------------------------------------------ QA hook (only with ?sdrtest=1 or localStorage gs_sdr_dev=1)
  const testWaiters = {};
  let testId = 0;
  function qaEnabled() {
    try { return /[?&]sdrtest=1\b/.test(root.location.search) || root.localStorage.getItem("gs_sdr_dev") === "1"; } catch (e) { return false; }
  }
  if (qaEnabled()) {
    root.__gsSdrTest = {
      connectSim: async (profile) => { if (st.dev) await disconnect(true); await useDevice(new (D().SimDevice)(profile || "hackrf")); return st.dev.name; },
      disconnect: () => disconnect(),
      connectMeshSim: async (proto, lat, lon) => {
        await loadScript("/mesh-device.js?v=" + V); await loadScript("/mesh-sim.js?v=" + V);
        const rx = receiver();
        const sim = root.GsaMeshSim[proto === "meshcore" ? "meshcore" : "meshtastic"]({ lat: Number.isFinite(lat) ? lat : rx ? rx.lat : 29.76, lon: Number.isFinite(lon) ? lon : rx ? rx.lon : -95.37 });
        root.__gsMeshSimState = sim;
        await meshConnect("sim", { stream: sim.stream, transport: "sim", name: proto === "meshcore" ? "Simulated MeshCore radio" : "Simulated Meshtastic radio", sim });
        return st.mesh.dev ? st.mesh.dev.proto : st.mesh.message;
      },
      disconnectMesh: () => meshDisconnect(),
      mesh: () => ({ dev: st.mesh.dev, myId: st.mesh.myId, nodes: st.mesh.nodes.size, onMap: visibleTargets("mesh").filter((t) => t.src === "device").length, sdrMeshOnMap: visibleTargets("mesh").filter((t) => t.src === "sdr").length, messages: st.mesh.messages.map((x) => ({ ch: x.ch, from: x.from, text: x.text })), channels: st.mesh.channels, info: st.mesh.info, lora: st.mesh.lora, otaSkipped: st.mesh.otaSkipped, source: meshSourceText(), meshLive: isLive("mesh"), tuned: st.tuned, simSent: root.__gsMeshSimState ? root.__gsMeshSimState.sent : null }),
      injectSdrMesh: (m) => onMesh(m),
      setReceiver: (lat, lon, name) => setReceiver({ lat, lon, name: name || "Receiver pin" }),
      tune: (mhzValue, mode) => tune(Math.round(mhzValue * 1e6), { mode }),
      setLayer, openWorkbench, closeWorkbench, showTab, setMuted,
      state: () => ({ connected: Boolean(st.dev), name: st.dev ? st.dev.name : "", tuned: st.tuned, center: st.center, rate: st.rate, mode: st.mode, layers: Object.assign({}, st.layers), counts: Object.fromEntries(Object.keys(st.targets).map((k) => [k, st.targets[k].size])), pagers: st.pagers.length, devices: st.devices.length, ble: st.ble.length, trains: st.trains.length, cells: st.cells.length, alerts: st.alerts.length, acars: st.acarsMsgs.length, bursts: st.bursts.length, act: st.act.length, atsc: Object.keys(st.atsc).length, hdSide: st.hdSide, sats: st.targets.sat.size, satSource: st.satInfo && st.satInfo.source, sweep: st.sweep ? { on: st.sweep.on, passes: st.sweep.passes } : null, zspan: st.zspan.length, tab: st.tab, liveKm: st.liveKm || 0, stats: Object.assign({}, st.stats), health: st.health }),
      targets: (k) => Array.from((st.targets[k] || new Map()).values()).map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, alt: t.alt, landing: t.landing || null })),
      pagers: () => st.pagers.map((p) => ({ capcode: p.capcode, text: p.text, baud: p.baud })),
      devices: () => st.devices.map((d) => ({ kind: d.kind, fmt: d.fmt, id: d.id, kpa: d.kpa, tempC: d.tempC, humidity: d.humidity, detail: d.detail })),
      lists: () => ({ ble: st.ble.slice(0, 20), trains: st.trains.slice(0, 20), cells: st.cells.slice(0, 20), alerts: st.alerts.slice(0, 20), acars: st.acarsMsgs.slice(0, 20), pagers: st.pagers.slice(0, 20).map((p) => ({ proto: p.proto, capcode: p.capcode, text: p.text })), atsc: Object.values(st.atsc) }),
      startSweep: (a, b) => startSweep(a, b), stopSweep: () => stopSweep(),
      popup: (k, id) => { const t = st.targets[k] && st.targets[k].get(id); return t ? popupHtml(t) : ""; },
      screenOf: (k, id) => (L() ? L().screenOf(k, id) : null),
      frame: (points, o) => L() && L().frame(points, o),
      share: () => ({ on: st.share.on, sent: st.share.sent, lastCount: st.share.lastCount, note: shareNote(), items: shareItems() }),
      shareNow: () => shareTick(),
    };
    root.__gsSdrInjectTestFrame = (frame) => {
      ensureWorker();
      const id = ++testId;
      return new Promise((resolve) => { testWaiters[id] = resolve; st.worker.postMessage({ t: "decode", id, frame }); setTimeout(() => { if (testWaiters[id]) { delete testWaiters[id]; resolve({ error: "timeout" }); } }, frame && frame.type === "selftest" ? 25000 : 6000); });
    };
  }

  root.GsaSdr = { init, pick, popupHtml, clearAll, pickerHtml, railHtml, render, isOn: (k) => Boolean(st.layers[k]), openWorkbench, closeWorkbench, bandOf };
})(window);
