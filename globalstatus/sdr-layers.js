/* Global Status · SDR map layers (Phase 1 + Phase 2)
 *
 * Draws what the user's own radio decodes on the Cesium globe:
 *   adsb   LOCAL ADS-B AIRCRAFT      aircraft icons rotated to heading + short track trail
 *   ais    LOCAL AIS VESSELS         vessel icons rotated to course + trail
 *   aprs   LOCAL APRS STATIONS       station diamonds + callsign
 *   sonde  LOCAL WEATHER BALLOONS    balloon + flight path + predicted burst and landing
 *   range  RECEIVER RANGE            slate-cyan rings around the receiver + live-signal ring
 *   mesh, uat, acars, dispatch, meter, hd, sat, lte (Phase 2): node / aircraft / ground station /
 *   radio / meter / tower / satellite / alert-area pins, trails and WEA alert polygons.
 * Primitives only (no Entities), so the shared #selected card is opened by cesium.js through
 * GsaSdr.pick(). Original code for Global Status App.
 */
(function (root) {
  "use strict";

  const KINDS = {
    adsb: { label: "LOCAL ADS-B AIRCRAFT", color: "#38bdf8" },
    ais: { label: "LOCAL AIS VESSELS", color: "#a5b4fc" },
    aprs: { label: "LOCAL APRS STATIONS", color: "#fbbf24" },
    sonde: { label: "LOCAL WEATHER BALLOONS", color: "#f0abfc" },
    range: { label: "RECEIVER RANGE / LIVE SIGNAL", color: "#38bdf8" },
    mesh: { label: "LOCAL MESH NODES", color: "#c4b5fd" },
    uat: { label: "LOCAL UAT AIRCRAFT", color: "#7dd3fc" },
    acars: { label: "LOCAL ACARS / VDL2", color: "#fda4af" },
    dispatch: { label: "LOCAL RADIO GPS UNITS", color: "#fb923c" },
    meter: { label: "LOCAL UTILITY METERS", color: "#fcd34d" },
    hd: { label: "LOCAL HD RADIO TOWERS", color: "#f9a8d4" },
    sat: { label: "AMATEUR SATELLITES (DOPPLER)", color: "#93c5fd" },
    lte: { label: "LTE ALERT AREAS", color: "#f87171" },
  };
  const OUT = "#0b1117";
  const svg = (body) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' + body + "</svg>");
  const ICONS = {
    adsb: svg('<path d="M16 2.5 17.9 12 28.5 17.6v2.3L17.9 16.8l-.5 7.7 3.6 2.9v1.9L16 28l-5 1.3v-1.9l3.6-2.9-.5-7.7L3.5 19.9v-2.3L14.1 12z" fill="#38bdf8" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>'),
    ais: svg('<path d="M16 3.5 22 14v12.5q-6 3-12 0V14z" fill="#a5b4fc" stroke="' + OUT + '" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 18h6" stroke="' + OUT + '" stroke-width="1.4" stroke-linecap="round"/>'),
    aton: svg('<path d="M16 5 26 16 16 27 6 16z" fill="none" stroke="#a5b4fc" stroke-width="2.4"/><circle cx="16" cy="16" r="3" fill="#a5b4fc" stroke="' + OUT + '" stroke-width="1"/>'),
    aprs: svg('<path d="M16 4 27 16 16 28 5 16z" fill="#fbbf24" stroke="' + OUT + '" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16" cy="16" r="3.2" fill="' + OUT + '"/>'),
    sonde: svg('<circle cx="16" cy="11" r="8" fill="#f0abfc" stroke="' + OUT + '" stroke-width="1.5"/><path d="M16 19v6" stroke="#f0abfc" stroke-width="1.6"/><rect x="13" y="25" width="6" height="4.5" rx="1" fill="#f0abfc" stroke="' + OUT + '" stroke-width="1.2"/>'),
    landing: svg('<circle cx="16" cy="16" r="10.5" fill="rgba(11,17,23,0.6)" stroke="#f0abfc" stroke-width="2"/><path d="M11 11l10 10M21 11 11 21" stroke="#f0abfc" stroke-width="2.4" stroke-linecap="round"/>'),
    burst: svg('<circle cx="16" cy="16" r="5" fill="none" stroke="#f0abfc" stroke-width="2"/><path d="M16 4v5M16 23v5M4 16h5M23 16h5M7.5 7.5l3.5 3.5M21 21l3.5 3.5M24.5 7.5 21 11M11 21l-3.5 3.5" stroke="#f0abfc" stroke-width="1.8" stroke-linecap="round"/>'),
    mesh: svg('<path d="M16 3.5 26.8 9.75v12.5L16 28.5 5.2 22.25V9.75z" fill="#c4b5fd" stroke="' + OUT + '" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16" cy="17" r="3.2" fill="' + OUT + '"/><path d="M10.5 13q5.5-4 11 0" fill="none" stroke="' + OUT + '" stroke-width="1.4" stroke-linecap="round"/>'),
    uat: svg('<path d="M16 3 17.6 12.3 27.5 17.4v2.1L17.6 16.7l-.4 7.6 3.3 2.7v1.7L16 27.6l-4.5 1.1v-1.7l3.3-2.7-.4-7.6L4.5 19.5v-2.1l9.9-5.1z" fill="#7dd3fc" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>'),
    tower: svg('<path d="M16 9 22 28h-3l-3-10-3 10h-3z" fill="#7dd3fc" stroke="' + OUT + '" stroke-width="1.3" stroke-linejoin="round"/><path d="M10 9.5q6-5 12 0M7 6q9-7.5 18 0" fill="none" stroke="#7dd3fc" stroke-width="1.8" stroke-linecap="round"/>'),
    metar: svg('<rect x="5" y="5" width="22" height="22" rx="5" fill="#0b1117" stroke="#7dd3fc" stroke-width="2"/><path d="M10 20q0-4 4-4 1-4 5-3 4 .5 4 4.5 2.5.5 2.5 2.5H10z" fill="#e2e8f0"/>'),
    acars: svg('<path d="M16 3 17.6 12.3 27.5 17.4v2.1L17.6 16.7l-.4 7.6 3.3 2.7v1.7L16 27.6l-4.5 1.1v-1.7l3.3-2.7-.4-7.6L4.5 19.5v-2.1l9.9-5.1z" fill="#fda4af" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>'),
    gs: svg('<rect x="7" y="16" width="18" height="11" rx="2" fill="#fda4af" stroke="' + OUT + '" stroke-width="1.4"/><path d="M16 16V8M11 7q5-4 10 0" fill="none" stroke="#fda4af" stroke-width="2" stroke-linecap="round"/>'),
    dispatch: svg('<rect x="10" y="9" width="12" height="19" rx="2.5" fill="#fb923c" stroke="' + OUT + '" stroke-width="1.5"/><path d="M19 9V3.5" stroke="#fb923c" stroke-width="2.2" stroke-linecap="round"/><rect x="12.5" y="12" width="7" height="5" rx="1" fill="' + OUT + '"/>'),
    meter: svg('<circle cx="16" cy="16" r="11" fill="#fcd34d" stroke="' + OUT + '" stroke-width="1.5"/><path d="M16 16 21.5 10.5" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/><path d="M9 20h14" stroke="' + OUT + '" stroke-width="1.4"/>'),
    hd: svg('<path d="M16 10 21.5 28h-2.8L16 19l-2.7 9h-2.8z" fill="#f9a8d4" stroke="' + OUT + '" stroke-width="1.3" stroke-linejoin="round"/><path d="M10.5 10.5q5.5-5 11 0M7.5 7.5q8.5-8 17 0" fill="none" stroke="#f9a8d4" stroke-width="1.8" stroke-linecap="round"/>'),
    sat: svg('<rect x="12.5" y="12.5" width="7" height="7" rx="1.2" fill="#e2e8f0" stroke="' + OUT + '" stroke-width="1.3" transform="rotate(45 16 16)"/><path d="M4 9.5 9.5 4l5 5-5.5 5.5zM28 22.5 22.5 28l-5-5 5.5-5.5z" fill="#93c5fd" stroke="' + OUT + '" stroke-width="1.2"/>'),
    lte: svg('<path d="M16 4 28 26H4z" fill="#f87171" stroke="' + OUT + '" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 11v8" stroke="' + OUT + '" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="22.5" r="1.5" fill="' + OUT + '"/>'),
    ft8: svg('<rect x="6" y="6" width="20" height="20" rx="3" fill="#fde68a" stroke="' + OUT + '" stroke-width="1.5"/><path d="M10 16h3l2-5 2 10 2-5h3" fill="none" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/>'),
    rx: svg('<circle cx="16" cy="16" r="6" fill="#38bdf8" stroke="' + OUT + '" stroke-width="1.6"/><circle cx="16" cy="16" r="11.5" fill="none" stroke="#38bdf8" stroke-width="1.4" stroke-dasharray="3 3"/>'),
  };

  let viewerFn = null;
  const sets = {};
  let dirty = true;
  const cam = { x: 0, y: 0, z: 0 };

  function viewer() { return viewerFn ? viewerFn() : null; }
  function C() { return root.Cesium; }
  function color(css, a) { const c = C().Color.fromCssColorString(css); return a == null ? c : c.withAlpha(a); }

  function set(kind) {
    if (sets[kind]) return sets[kind];
    const v = viewer();
    if (!v) return null;
    const Cs = C();
    const s = {
      kind, on: false, items: new Map(),
      lines: v.scene.primitives.add(new Cs.PolylineCollection()),
      bb: v.scene.primitives.add(new Cs.BillboardCollection({ scene: v.scene })),
      labels: v.scene.primitives.add(new Cs.LabelCollection({ scene: v.scene })),
    };
    s.lines.show = s.bb.show = s.labels.show = false;
    sets[kind] = s;
    return s;
  }

  function pos(lon, lat, h) { return C().Cartesian3.fromDegrees(lon, lat, h || 0); }

  function labelOpts(text, p) {
    const Cs = C();
    return {
      position: p, text, font: "600 11px ui-monospace, SFMono-Regular, Menlo, monospace",
      fillColor: color("#e2e8f0"), outlineColor: color(OUT), outlineWidth: 3, style: Cs.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cs.Cartesian2(14, -2), horizontalOrigin: Cs.HorizontalOrigin.LEFT, verticalOrigin: Cs.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cs.DistanceDisplayCondition(0, 2.6e6),
    };
  }

  // item: { id, lat, lon, name, label, heading, icon, track:[[lon,lat],..], path:[[lon,lat,alt]], burst:{lat,lon}, landing:{lat,lon} }
  function upsert(kind, item) {
    const s = set(kind);
    if (!s || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    const Cs = C();
    item.sdr = true; item.sdrKind = kind; item.layer = "sdr:" + kind; item.kind = KINDS[kind].label;
    let rec = s.items.get(item.id);
    const p = pos(item.lon, item.lat, 0);
    const iconKey = item.icon || kind;
    if (!rec) {
      rec = { item };
      rec.bb = s.bb.add({ position: p, image: ICONS[iconKey] || ICONS[kind], width: 26, height: 26, id: item, disableDepthTestDistance: Number.POSITIVE_INFINITY, alignedAxis: Cs.Cartesian3.ZERO });
      rec.label = s.labels.add(labelOpts(item.label || item.name || "", p));
      s.items.set(item.id, rec);
    }
    rec.item = item;
    rec.bb.id = item;
    rec.bb.position = p;
    rec.label.position = p;
    rec.label.text = item.label || item.name || "";
    if (Number.isFinite(item.heading)) { rec.bb.alignedAxis = Cs.Cartesian3.UNIT_Z; rec.bb.rotation = -Cs.Math.toRadians(item.heading); }
    const trail = item.track && item.track.length > 1 ? item.track : null;
    if (trail) {
      const positions = trail.map(([lo, la]) => pos(lo, la, 0));
      if (!rec.trail) rec.trail = s.lines.add({ positions, width: 2, material: Cs.Material.fromType("Color", { color: color(KINDS[kind].color, 0.55) }) });
      else rec.trail.positions = positions;
    }
    if (item.path && item.path.length > 1) {
      const positions = item.path.map(([lo, la]) => pos(lo, la, 0));
      if (!rec.path) rec.path = s.lines.add({ positions, width: 2.5, material: Cs.Material.fromType("Color", { color: color(kind === "sat" ? "#93c5fd" : "#f0abfc", kind === "sat" ? 0.55 : 0.8) }) });
      else rec.path.positions = positions;
    }
    const pred = [item.lon, item.lat];
    const predPts = [pred];
    if (item.burst) predPts.push([item.burst.lon, item.burst.lat]);
    if (item.landing) predPts.push([item.landing.lon, item.landing.lat]);
    if (predPts.length > 1) {
      const positions = predPts.map(([lo, la]) => pos(lo, la, 0));
      const mat = Cs.Material.fromType("PolylineDash", { color: color("#f0abfc", 0.75), dashLength: 14 });
      if (!rec.pred) rec.pred = s.lines.add({ positions, width: 2, material: mat });
      else rec.pred.positions = positions;
    }
    if (item.poly && item.poly.length > 2) { // WEA / ETWS alert area outline
      const positions = item.poly.map(([la, lo]) => pos(lo, la, 0));
      if (!rec.poly) rec.poly = s.lines.add({ positions, width: 3, loop: true, material: Cs.Material.fromType("Color", { color: color(KINDS[kind].color, 0.9) }) });
      else rec.poly.positions = positions;
    }
    marker(s, rec, "burstBb", item.burst, ICONS.burst, item, 22);
    marker(s, rec, "landBb", item.landing, ICONS.landing, item, 26);
    if (item.landing) {
      const lp = pos(item.landing.lon, item.landing.lat, 0);
      if (!rec.landLabel) rec.landLabel = s.labels.add(labelOpts("PREDICTED LANDING", lp));
      else rec.landLabel.position = lp;
    }
    dirty = true;
    request();
  }
  function marker(s, rec, key, where, image, item, size) {
    if (!where) { if (rec[key]) { s.bb.remove(rec[key]); rec[key] = null; } return; }
    const p = pos(where.lon, where.lat, 0);
    if (!rec[key]) rec[key] = s.bb.add({ position: p, image, width: size, height: size, id: item, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    else { rec[key].position = p; rec[key].id = item; }
  }

  function removeItem(kind, id) {
    const s = sets[kind];
    const rec = s && s.items.get(id);
    if (!rec) return;
    for (const k of ["bb", "burstBb", "landBb"]) if (rec[k]) s.bb.remove(rec[k]);
    for (const k of ["label", "landLabel"]) if (rec[k]) s.labels.remove(rec[k]);
    for (const k of ["trail", "path", "pred", "poly"]) if (rec[k]) s.lines.remove(rec[k]);
    s.items.delete(id);
    request();
  }
  function clear(kind) {
    const s = sets[kind];
    if (!s) return;
    s.bb.removeAll(); s.labels.removeAll(); s.lines.removeAll(); s.items.clear();
    request();
  }
  function show(kind, on) {
    const s = set(kind);
    if (!s) return;
    s.on = Boolean(on);
    s.lines.show = s.bb.show = s.labels.show = s.on;
    dirty = true;
    request();
  }

  // Receiver range rings (km) and the live-signal ring (farthest decoded target).
  function setRange(rx, liveKm) {
    const s = set("range");
    if (!s) return;
    s.bb.removeAll(); s.labels.removeAll(); s.lines.removeAll(); s.items.clear();
    if (!rx) { request(); return; }
    const Cs = C();
    const item = { id: "rx", lat: rx.lat, lon: rx.lon, name: rx.name || "Your receiver", label: "RX", sdr: true, sdrKind: "range", layer: "sdr:range", kind: KINDS.range.label, rx: true, liveKm, rings: [50, 100, 200] };
    const p = pos(rx.lon, rx.lat, 0);
    s.bb.add({ position: p, image: ICONS.rx, width: 28, height: 28, id: item, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    s.labels.add(labelOpts("RX", p));
    for (const km of item.rings) {
      s.lines.add({ positions: circle(rx, km), width: 1.5, loop: true, material: Cs.Material.fromType("Color", { color: color("#38bdf8", 0.42) }) });
      const lp = destination(rx, km, 0);
      s.labels.add(Object.assign(labelOpts(km + " KM", pos(lp.lon, lp.lat, 0)), { pixelOffset: new Cs.Cartesian2(4, -8), fillColor: color("#94a3b8") }));
    }
    if (liveKm && liveKm > 1) {
      s.lines.add({ positions: circle(rx, liveKm), width: 2.5, loop: true, material: Cs.Material.fromType("PolylineDash", { color: color("#e0f2fe", 0.9), dashLength: 12 }) });
      const lp = destination(rx, liveKm, 45);
      s.labels.add(Object.assign(labelOpts("LIVE " + Math.round(liveKm) + " KM", pos(lp.lon, lp.lat, 0)), { fillColor: color("#e0f2fe") }));
    }
    s.items.set("rx", { item });
    request();
  }
  function destination(o, km, brg) {
    const R = 6371.0088, d = km / R, b = (brg * Math.PI) / 180, la = (o.lat * Math.PI) / 180, lo = (o.lon * Math.PI) / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: (la2 * 180) / Math.PI, lon: (lo2 * 180) / Math.PI };
  }
  function circle(o, km) { const pts = []; for (let a = 0; a < 360; a += 4) { const p = destination(o, km, a); pts.push(pos(p.lon, p.lat, 0)); } return pts; }
  function distanceKm(a, b) {
    const R = 6371.0088, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Hide pins on the far side of the globe (billboards ignore depth so they stay crisp).
  function cull() {
    const v = viewer();
    if (!v) return;
    const Cs = C();
    const c = v.camera.positionWC;
    if (!dirty && c.x === cam.x && c.y === cam.y && c.z === cam.z) return;
    dirty = false; cam.x = c.x; cam.y = c.y; cam.z = c.z;
    const flat = v.scene.mode !== Cs.SceneMode.SCENE3D;
    const occ = cull.occ || (cull.occ = new Cs.EllipsoidalOccluder(Cs.Ellipsoid.WGS84));
    occ.cameraPosition = c;
    for (const s of Object.values(sets)) {
      if (!s.on) continue;
      for (const col of [s.bb, s.labels]) for (let i = 0; i < col.length; i += 1) { const g = col.get(i); g.show = flat || occ.isPointVisible(g.position); }
    }
  }

  function pick(position) {
    const v = viewer();
    if (!v || !Object.values(sets).some((s) => s.on && s.items.size)) return null;
    const hit = v.scene.pick(position, 9, 9);
    const item = hit && hit.id;
    if (!item || !item.sdr || !sets[item.sdrKind] || !sets[item.sdrKind].on) return null;
    return item;
  }

  function request() { const v = viewer(); if (v && v.scene && v.scene.requestRender) v.scene.requestRender(); }

  // Screen position of a pin (QA + nearby list helpers).
  function screenOf(kind, id) {
    const v = viewer(); const s = sets[kind]; const rec = s && s.items.get(id);
    if (!v || !rec) return null;
    const ST = C().SceneTransforms; const toWin = ST.worldToWindowCoordinates || ST.wgs84ToWindowCoordinates;
    const w = toWin(v.scene, rec.bb ? rec.bb.position : pos(rec.item.lon, rec.item.lat, 0));
    if (!w) return null;
    const rect = v.scene.canvas.getBoundingClientRect();
    return { x: rect.left + w.x, y: rect.top + w.y };
  }
  function frame(points, opts) {
    const v = viewer();
    if (!v || !points.length) return;
    const Cs = C();
    const sphere = Cs.BoundingSphere.fromPoints(points.map((p) => pos(p.lon, p.lat, 0)));
    v.camera.flyToBoundingSphere(sphere, { duration: (opts && opts.duration) || 0, offset: new Cs.HeadingPitchRange(0, -Math.PI / 2, Math.max(sphere.radius * ((opts && opts.scale) || 3.0), 60000)) });
  }

  function init(opts) {
    const v0 = opts && opts.viewer;
    viewerFn = typeof v0 === "function" ? v0 : () => v0;
    const v = viewer();
    if (v && v.scene) v.scene.preRender.addEventListener(cull);
  }

  root.GsaSdrLayers = { KINDS, init, upsert, removeItem, clear, show, setRange, pick, distanceKm, destination, screenOf, frame, count: (k) => (sets[k] ? sets[k].items.size : 0) };
})(window);
