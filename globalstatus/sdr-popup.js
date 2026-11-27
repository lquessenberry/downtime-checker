/* Global Status · SDR category + SDR Workbench (Phase 1, receive only)
 *
 * - SDR category in the LAYERS picker (welcome.js) and the sidebar (#group-sdr): a device
 *   connection bar, five uniform full-width map layer switches and a compare note.
 * - SDR Workbench popup: Tuner & Waterfall, Pagers, Devices, Capture, Log.
 * - One radio hears one band at a time: switching a map layer on tunes the radio to it; the
 *   other band layers keep their pins and show PAUSED until the radio is tuned back.
 * Nothing runs until the user clicks Connect SDR: no USB calls, no Web Worker, no AudioContext,
 * no location prompt.
 * Pin cards use the shared #selected card and are plain text only (no links).
 * Original code for Global Status App.
 */
(function (root) {
  "use strict";
  const V = "20261127sdr1";
  const D = () => root.GsaSdrDriver;
  const L = () => root.GsaSdrLayers;

  const LAYERS = [
    { key: "adsb", name: "LOCAL ADS-B AIRCRAFT", tune: 1090e6, mode: "AM", ttl: 120e3, sw: "#38bdf8", desc: "1090 MHz Mode-S / ADS-B from aircraft your antenna hears" },
    { key: "ais", name: "LOCAL AIS VESSELS", tune: 162.0e6, mode: "NFM", ttl: 30 * 60e3, sw: "#a5b4fc", desc: "Marine AIS on 161.975 and 162.025 MHz" },
    { key: "aprs", name: "LOCAL APRS STATIONS", tune: 144.39e6, mode: "NFM", ttl: 60 * 60e3, sw: "#fbbf24", desc: "2 m APRS packet positions (144.390 MHz; 144.800 MHz in Europe)" },
    { key: "sonde", name: "LOCAL WEATHER BALLOONS", tune: 403.0e6, mode: "NFM", ttl: 30 * 60e3, sw: "#f0abfc", desc: "Radiosondes (RS41) on 400-406 MHz with predicted landing" },
    { key: "range", name: "RECEIVER RANGE / LIVE SIGNAL", tune: 0, sw: "#7dd3fc", desc: "Range rings around your receiver and the farthest signal decoded" },
  ];
  const BYKEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));
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
  ];
  const MODES = ["WFM", "NFM", "AM", "USB", "LSB"];
  const SHIPTYPES = [[20, 29, "Wing in ground"], [30, 30, "Fishing"], [31, 32, "Towing"], [33, 33, "Dredging"], [34, 34, "Diving"], [35, 35, "Military"], [36, 36, "Sailing"], [37, 37, "Pleasure craft"], [40, 49, "High speed craft"], [50, 50, "Pilot"], [51, 51, "Search and rescue"], [52, 52, "Tug"], [53, 53, "Port tender"], [55, 55, "Law enforcement"], [58, 58, "Medical"], [60, 69, "Passenger"], [70, 79, "Cargo"], [80, 89, "Tanker"], [90, 99, "Other"]];
  const APRS_SYMBOLS = { "/>": "Car", "/#": "Digipeater", "/_": "Weather station", "/-": "House", "/k": "Truck", "/[": "Person", "/O": "Balloon", "/Y": "Sailboat", "/s": "Boat", "/v": "Van", "/j": "Jeep", "/'": "Small aircraft", "/^": "Aircraft", "/u": "Truck", "/b": "Bicycle", "/r": "Repeater", "/&": "Gateway" };

  // ------------------------------------------------------------------ state
  const st = {
    dev: null, connecting: false, worker: null, audio: null, audioNext: 0,
    tuned: 100.1e6, tunerHz: 100.1e6, center: 0, rate: 0, mode: "WFM", gain: 62, squelch: -60, muted: true, scan: false,
    layers: { adsb: false, ais: false, aprs: false, sonde: false, range: false }, order: [],
    targets: { adsb: new Map(), ais: new Map(), aprs: new Map(), sonde: new Map() },
    pagers: [], devices: [], log: [], health: null, cap: { on: false, bytes: 0, secs: 0 }, level: -120,
    wb: null, wbOpen: false, tab: "tuner", rx: null, awaitingPin: false, message: "", msgKind: "", biasArmed: false,
    portapackSerial: false, step: 12500, fftRow: null, wfFloor: -95, stats: { workers: 0, usbCalls: 0, audioCtx: 0 },
    lastCardId: "", support: null, sim: false, queue: Promise.resolve(),
  };

  const URLISH = /(https?:\/\/|www\.)\S*|tel:\S*|mailto:\S*/gi;
  function plain(v) { return String(v == null ? "" : v).replace(/<[^>]*>/g, " ").replace(URLISH, "").replace(/\s+/g, " ").trim(); }
  function esc(v) { return plain(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const mhz = (hz) => (hz / 1e6).toFixed(hz >= 1e9 ? 3 : 4);
  function bandOf(hz) {
    const m = hz / 1e6;
    if (Math.abs(m - 1090) < 1.2) return "adsb";
    if (m >= 161.9 && m <= 162.1) return "ais";
    if (Math.abs(m - 144.39) < 0.02 || Math.abs(m - 144.8) < 0.02) return "aprs";
    if (m >= 400 && m <= 406.1) return "sonde";
    if ((m >= 152 && m <= 159) || (m >= 929 && m <= 932) || (m >= 466 && m <= 466.3)) return "pager";
    if (Math.abs(m - 433.92) < 0.15 || Math.abs(m - 315) < 0.15) return "tpms";
    if (m >= 87.5 && m <= 108.1) return "fm";
    return "other";
  }
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
      `<div class="gsr-bar-head"><span class="gsr-dot" data-sdr-dot aria-hidden="true"></span><strong data-sdr-status>NO RADIO CONNECTED</strong></div>` +
      `<p class="gsr-bar-sum" data-sdr-summary>Plug a HackRF, PortaPack or RTL-SDR into this device, then connect.</p>` +
      `<div class="gsr-bar-actions">` +
      `<button type="button" class="gsr-btn gsr-primary" data-sdr-act="connect">CONNECT SDR</button>` +
      `<button type="button" class="gsr-btn" data-sdr-act="bias" aria-pressed="false">BIAS-T OFF</button>` +
      `<button type="button" class="gsr-btn gsr-wide" data-sdr-act="workbench">OPEN SDR WORKBENCH</button>` +
      `</div>` +
      `<p class="gsr-bar-warn" data-sdr-biasnote>Bias-T stays off. It sends DC power up the antenna cable (3.3 V HackRF / 4.5 V RTL-SDR Blog); only use it with a powered LNA or active antenna.</p>` +
      `<p class="gsr-bar-msg" data-sdr-msg hidden></p>` +
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
  function isLive(key) {
    const l = BYKEY[key];
    if (!st.dev || !l.tune) return false;
    return bandOf(st.tuned) === bandOf(l.tune);
  }
  function countText(key) {
    if (!st.layers[key]) return "—";
    if (key === "range") return receiver() ? "ON" : "TAP MAP";
    if (!st.dev) return "NO RADIO";
    if (!isLive(key)) return "PAUSED";
    return String(visibleTargets(key).length);
  }
  function render() {
    const sup = support();
    const live = Boolean(st.dev);
    for (const dot of document.querySelectorAll("[data-sdr-dot]")) { dot.classList.toggle("is-live", live); dot.classList.toggle("is-busy", st.connecting); }
    setText("[data-sdr-status]", st.connecting ? "CONNECTING…" : live ? (st.dev.name || "RADIO").toUpperCase() : sup.ok ? "NO RADIO CONNECTED" : "USB RADIOS NOT AVAILABLE HERE");
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
    if (root.gsSyncLayerGroups) root.gsSyncLayerGroups();
    renderWorkbenchHead();
  }
  function bandNote() {
    const on = LAYERS.filter((l) => l.tune && st.layers[l.key]);
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
    const dev = st.dev;
    const band = bandOf(hz);
    if (dev) hz = Math.max(dev.minHz, Math.min(dev.maxHz, hz));
    const rate = band === "adsb" ? 2.0e6 : 2.4e6;
    const center = band === "adsb" ? hz : hz - 300e3;
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
    for (let i = st.order.length - 1; i >= 0; i -= 1) { const l = BYKEY[st.order[i]]; if (l && l.tune && st.layers[l.key]) return l; }
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
    if (on) { redraw(key); if (st.dev) tune(l.tune, { mode: l.mode, fromLayer: true }); }
    else {
      L().clear(key); st.targets[key].clear();
      const next = focusLayer();
      if (st.dev && bandOf(st.tuned) === bandOf(l.tune)) tune(next ? next.tune : st.tunerHz, { mode: next ? next.mode : undefined, fromLayer: Boolean(next) });
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
    if (rx) for (const k of ["adsb", "ais", "aprs", "sonde"]) for (const t of visibleTargets(k)) { if (!isLive(k)) continue; const d = L().distanceKm(rx, t); if (d < 600) far = Math.max(far, d); }
    st.liveKm = far;
    L().setRange(rx, far);
  }

  // ------------------------------------------------------------------ worker messages
  function onWorker(m) {
    switch (m.t) {
      case "fft": st.fftRow = m.db; drawSpectrum(m); break;
      case "level": st.level = m.db; break;
      case "audio": playAudio(m); break;
      case "adsb": onAdsb(m.msg); break;
      case "ais": onAis(m.msg); break;
      case "aprs": onAprs(m.msg); break;
      case "sonde": onSonde(m.msg); break;
      case "pager": onPager(m.msg); break;
      case "device": onDevice(m.msg); break;
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
    for (const t of map.values()) if (now - t.seen <= ttl && Number.isFinite(t.lat)) out.push(t);
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
      if (now - t.seen > ttl) { st.targets[key].delete(id); L().removeItem(key, id); continue; }
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
    for (const k of ["alt", "vE", "vN", "vU", "sats", "battery", "frame", "type"]) if (m[k] != null) t[k] = m[k];
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
    Object.assign(d, { kpa: m.kpa, tempC: m.tempC, rssi: m.rssi, last: nowTime(), at: Date.now(), freq: st.tuned });
    d.count += 1;
    if (st.wbOpen && st.tab === "devices") renderDevices();
    badge("devices", st.devices.length);
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
    if (kind === "sonde") return src + rows([["Serial", t.serial], ["Type", t.type || "RS41"], ["Altitude", Number.isFinite(t.alt) ? Math.round(t.alt).toLocaleString() + " m" : ""], ["Climb", Number.isFinite(t.vU) ? t.vU.toFixed(1) + " m/s" : ""], ["Wind", Number.isFinite(t.vE) ? Math.hypot(t.vE, t.vN).toFixed(1) + " m/s" : ""], ["Satellites", t.sats], ["Frame", t.frame], ["Predicted burst", t.burst ? t.burst.lat.toFixed(3) + ", " + t.burst.lon.toFixed(3) : ""], ["Predicted landing", t.landing ? t.landing.lat.toFixed(3) + ", " + t.landing.lon.toFixed(3) + (t.landMin ? " in about " + t.landMin + " min" : "") : ""], ["Range", rangeText(t)], ["Last heard", ago(t.seen)]]) + `<p class="gsr-src">Landing is a simple estimate from the last measured climb rate and wind.</p>`;
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
  const TABS = [["tuner", "TUNER & WATERFALL"], ["pagers", "PAGERS"], ["devices", "DEVICES"], ["capture", "CAPTURE"], ["log", "LOG"]];
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
      `<div class="gsr-pane" data-gsr-pane="pagers" hidden></div>` +
      `<div class="gsr-pane" data-gsr-pane="devices" hidden></div>` +
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
    else if (st.tab === "pagers") renderPagers();
    else if (st.tab === "devices") renderDevices();
    else if (st.tab === "capture") renderCapture();
    else renderLog();
    badge("pagers", st.pagers.length); badge("devices", st.devices.length);
  }
  function renderWorkbenchHead() {
    if (!st.wb) return;
    const h = st.wb.querySelector("[data-gsr-head]");
    const text = st.dev ? `${st.dev.name} · ${mhz(st.tuned)} MHz ${st.mode}` : "No radio connected";
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
    const hints = { adsb: "1090 MHz: aircraft appear on LOCAL ADS-B AIRCRAFT. Audio is not useful here.", ais: "Marine AIS: vessels appear on LOCAL AIS VESSELS.", aprs: "2 m APRS: stations appear on LOCAL APRS STATIONS.", sonde: "Radiosondes: balloons appear on LOCAL WEATHER BALLOONS with a predicted landing.", pager: "Pager band: POCSAG messages appear in the Pagers tab.", tpms: "ISM band: tire pressure sensors appear in the Devices tab.", fm: "FM broadcast: use WFM and turn audio on.", other: "Listening only. Pick a mode and turn audio on." };
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
    const md = t.closest("[data-gsr-mode]");
    if (md) { st.mode = md.dataset.gsrMode; config(); renderTuner(); renderWorkbenchHead(); return; }
    const act = t.closest("[data-gsr]");
    if (!act) return;
    const a = act.dataset.gsr;
    if (a === "close") closeWorkbench();
    else if (a === "up" || a === "down") tune(st.tuned + (a === "up" ? 1 : -1) * st.step);
    else if (a === "mute") setMuted(!st.muted);
    else if (a === "scan") { st.scan = !st.scan; if (st.scan) scanStep(true); renderTuner(); }
    else if (a === "cap-start" && st.worker) st.worker.postMessage({ t: "cap", cmd: "start" });
    else if (a === "cap-stop" && st.worker) st.worker.postMessage({ t: "cap", cmd: "stop" });
    else if (a === "cap-save" && st.worker) st.worker.postMessage({ t: "cap", cmd: "save" });
    else if (a === "pagers-clear") { st.pagers = []; renderPagers(); badge("pagers", 0); }
    else if (a === "devices-clear") { st.devices = []; renderDevices(); badge("devices", 0); }
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
    const list = PRESETS.filter((p) => p.id !== "adsb");
    const open = st.squelch > -100 && st.level > st.squelch;
    if (!first && open) { st.scanTimer = setTimeout(() => scanStep(false), 1500); return; }
    let i = list.findIndex((p) => Math.abs(p.hz - st.tuned) < 1);
    const p = list[(i + 1) % list.length];
    tune(p.hz, { mode: p.mode, quiet: true });
    st.scanTimer = setTimeout(() => scanStep(false), 2500);
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
  function renderDevices() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="devices"]');
    if (!pane || st.tab !== "devices") return;
    const body = st.devices.slice(0, 150).map((d) => `<tr><td>${esc(d.kind)}</td><td>${esc(d.id)}</td><td>${esc(d.kpa.toFixed(1) + " kPa / " + (d.kpa * 0.145038).toFixed(1) + " psi")}</td><td>${esc(d.tempC + " °C")}</td><td>${esc(d.count)}</td><td>${esc(d.last)}</td></tr>`).join("");
    pane.innerHTML = `<div class="gsr-row"><button type="button" class="gsr-btn" data-gsr="tune-ism">TUNE 433.92</button><button type="button" class="gsr-btn" data-gsr="tune-315">TUNE 315</button><button type="button" class="gsr-btn" data-gsr="devices-clear">CLEAR</button></div>` +
      `<div class="gsr-list">${st.devices.length ? tableHtml(["TYPE", "SENSOR", "PRESSURE", "TEMP", "SEEN", "LAST"], body) : `<p class="gsr-empty">${bandOf(st.tuned) === "tpms" ? "Listening for tire pressure sensors on " + mhz(st.tuned) + " MHz…" : "Tune 315 MHz (North America) or 433.92 MHz (Europe and Asia) to hear tire pressure sensors."}</p>`}</div>` +
      `<p class="gsr-hint">Phase 1 decodes a common Manchester OOK sensor format (CRC-8 checked). More vendor formats are planned.</p>`;
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
  function renderLog() {
    const pane = st.wb && st.wb.querySelector('[data-gsr-pane="log"]');
    if (!pane || st.tab !== "log") return;
    const h = st.health;
    const pk = h ? h.packets : {};
    const facts = [["Radio", st.dev ? st.dev.name + (st.dev.version ? " · " + st.dev.version : "") + (st.dev.tuner ? " · " + st.dev.tuner : "") : "Not connected"], ["Tuned", st.dev ? mhz(st.tuned) + " MHz " + st.mode : "—"], ["Band decoder", h ? String(h.band || "").toUpperCase() : "—"], ["Sample rate", h ? (h.rate / 1e6).toFixed(2) + " MS/s" : "—"], ["IQ level (RMS)", h ? h.iqRMS.toFixed(3) + (h.iqRMS > 0.7 ? " (too strong, lower gain)" : h.iqRMS < 0.02 ? " (weak, raise gain)" : "") : "—"], ["USB transfers", h ? h.transfers : "—"], ["Dropped", h ? h.dropped : "—"], ["Bias-T", st.dev && st.dev.biasT ? "ON (" + st.dev.biasVolts + ")" : "Off"], ["Decoded", h ? `ADS-B ${pk.adsb || 0} · AIS ${pk.ais || 0} · APRS ${pk.aprs || 0} · Sonde ${pk.sonde || 0} · Pager ${pk.pager || 0} · TPMS ${pk.device || 0}` : "—"], ["CRC failures", h ? h.crcFail : "—"]];
    pane.innerHTML = rows(facts) + `<div class="gsr-log">${st.log.slice(0, 120).map((l) => `<p><time>${esc(l.t)}</time> ${esc(l.text)}</p>`).join("") || '<p class="gsr-empty">Nothing yet.</p>'}</div>`;
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
    setInterval(() => { if (!st.dev) return; for (const k of ["adsb", "ais", "aprs", "sonde"]) if (st.layers[k] && st.targets[k].size) scheduleDraw(k); }, 5000);
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
      setReceiver: (lat, lon, name) => setReceiver({ lat, lon, name: name || "Receiver pin" }),
      tune: (mhzValue, mode) => tune(Math.round(mhzValue * 1e6), { mode }),
      setLayer, openWorkbench, closeWorkbench, showTab, setMuted,
      state: () => ({ connected: Boolean(st.dev), name: st.dev ? st.dev.name : "", tuned: st.tuned, center: st.center, rate: st.rate, mode: st.mode, layers: Object.assign({}, st.layers), counts: Object.fromEntries(Object.keys(st.targets).map((k) => [k, st.targets[k].size])), pagers: st.pagers.length, devices: st.devices.length, liveKm: st.liveKm || 0, stats: Object.assign({}, st.stats), health: st.health }),
      targets: (k) => Array.from((st.targets[k] || new Map()).values()).map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, alt: t.alt, landing: t.landing || null })),
      pagers: () => st.pagers.map((p) => ({ capcode: p.capcode, text: p.text, baud: p.baud })),
      devices: () => st.devices.map((d) => ({ id: d.id, kpa: d.kpa, tempC: d.tempC })),
      popup: (k, id) => { const t = st.targets[k] && st.targets[k].get(id); return t ? popupHtml(t) : ""; },
      screenOf: (k, id) => (L() ? L().screenOf(k, id) : null),
      frame: (points, o) => L() && L().frame(points, o),
    };
    root.__gsSdrInjectTestFrame = (frame) => {
      ensureWorker();
      const id = ++testId;
      return new Promise((resolve) => { testWaiters[id] = resolve; st.worker.postMessage({ t: "decode", id, frame }); setTimeout(() => { if (testWaiters[id]) { delete testWaiters[id]; resolve({ error: "timeout" }); } }, 4000); });
    };
  }

  root.GsaSdr = { init, pick, popupHtml, clearAll, pickerHtml, railHtml, render, isOn: (k) => Boolean(st.layers[k]), openWorkbench, closeWorkbench, bandOf };
})(window);
