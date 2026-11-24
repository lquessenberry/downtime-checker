/* Global Status · WHAT'S NEARBY (runs after an address search pick, geocoder.js)
 *
 * Draws a radius circle (default 50 miles) around the searched place, loads every
 * point layer out of sight, switches on only the layers with a pin inside the circle,
 * and shows just those pins (SHOW ALL on the card shows them worldwide). CLEAR puts
 * the layers back the way they were. Layers already on before the search are untouched.
 *
 * Reuses the site's own code: setLayer() (each layer's normal loader fetches its data),
 * state.probeHidden in cesium.js (loading with the switch still OFF and nothing drawn),
 * each layer's Cesium data source (sourceFor) and EntityCollection.collectionChanged to
 * catch pins a feed redraws, Entity.show through the horizon cull's _gsHide flag,
 * GsaInfra.setFilter for the airport/base point primitives, and Cesium EllipseGraphics
 * for the circle. (DistanceDisplayCondition was considered; it is camera distance, not
 * distance from a place, so it cannot do this.)
 */
(function (root) {
  const MILE = 1609.344;
  const DEFAULT_MILES = 50;
  const RADII = [10, 25, 50, 100, 250];
  // Point layers only. Day/night, radar, aurora, ISS, satellites and the nuke simulator
  // have no fixed pins on the ground, so they are never switched on from here.
  const CANDIDATES = [
    "outages", "stream", "jamming", "aircraft", "ships", "mesh", "amfm",
    "airports", "conflicts", "bases",
    "quakes", "volcanoes", "disasters", "tsunami", "wildfires", "hurricanes", "nwsalerts",
    "rivers", "coastal", "disease", "animal", "hunger",
  ];
  const MAX_WAIT_MS = 14000;
  const QUIET_MS = 2500;

  const run = { place: null, miles: DEFAULT_MILES, autoOn: new Set(), probing: new Set(), showAll: false, mode: {}, hooked: new Set(), counts: {}, token: 0, checking: false, startedAt: 0, ms: 0 };
  let circleSource = null;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const label = (key) => (typeof LAYER_LABEL !== "undefined" && LAYER_LABEL[key]) || key.toUpperCase();
  const viewer = () => (typeof state !== "undefined" ? state.viewer : null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function km(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function toLatLon(cartesian) {
    if (!cartesian) return null;
    const c = Cesium.Cartographic.fromCartesian(cartesian);
    if (!c) return null;
    return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) };
  }

  function insidePolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.lat > lat) !== (b.lat > lat) && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
  }

  // Is this entity (pin, area or line) inside the circle? null = no geometry to judge.
  function entityInside(e, lat, lon, radiusKm, now) {
    if (e.position) {
      const p = toLatLon(e.position.getValue(now));
      return p ? km(lat, lon, p.lat, p.lon) <= radiusKm : null;
    }
    const h = e.polygon && e.polygon.hierarchy && e.polygon.hierarchy.getValue(now);
    if (h && h.positions && h.positions.length) {
      const ring = h.positions.map(toLatLon).filter(Boolean);
      return insidePolygon(lat, lon, ring) || ring.some((p) => km(lat, lon, p.lat, p.lon) <= radiusKm);
    }
    const line = e.polyline && e.polyline.positions && e.polyline.positions.getValue(now);
    if (line && line.length) return line.map(toLatLon).filter(Boolean).some((p) => km(lat, lon, p.lat, p.lon) <= radiusKm);
    return null;
  }

  function infraCollections(key) {
    const out = [];
    const prims = viewer() ? viewer().scene.primitives : null;
    if (!prims || (key !== "airports" && key !== "bases")) return out;
    for (let i = 0; i < prims.length; i += 1) {
      const coll = prims.get(i);
      if (!(coll instanceof Cesium.PointPrimitiveCollection) || !coll.length) continue;
      const first = coll.get(0);
      if (first && first.id && first.id.__infra === key) out.push(coll);
    }
    return out;
  }

  // Number of a layer's pins (or areas) inside the circle, from data already on the page.
  function countWithin(key, lat, lon, radiusKm) {
    let n = 0;
    const now = Cesium.JulianDate.now();
    const src = typeof sourceFor === "function" ? sourceFor(key) : null;
    if (src) for (const e of src.entities.values) if (entityInside(e, lat, lon, radiusKm, now)) n += 1;
    // Airports and military bases are point primitives (infra.js), not entities.
    for (const coll of infraCollections(key)) {
      for (let j = 0; j < coll.length; j += 1) {
        const p = toLatLon(coll.get(j).position);
        if (p && km(lat, lon, p.lat, p.lon) <= radiusKm) n += 1;
      }
    }
    return n;
  }

  // ---------- which pins a layer draws ----------
  // mode: "none" (loading for the check), "circle" (only inside), undefined (all).
  function hideEntity(e, hide) {
    if (hide) {
      e._gsHide = true;
      e.show = false;
    } else if (e._gsHide) {
      e._gsHide = false;
      e.show = true; // the horizon cull re-hides far-side pins on the next frame
    }
  }

  function entityHidden(key, e, now) {
    const mode = run.mode[key];
    if (mode === "none") return true;
    if (mode !== "circle" || !run.place) return false;
    return entityInside(e, run.place.lat, run.place.lon, run.miles * MILE / 1000, now) === false;
  }

  function setMode(key, mode) {
    if (mode) run.mode[key] = mode;
    else delete run.mode[key];
    const src = typeof sourceFor === "function" ? sourceFor(key) : null;
    if (src) {
      if (!run.hooked.has(key)) {
        // Feeds redraw their pins on every poll; judge each new pin as it arrives.
        run.hooked.add(key);
        src.entities.collectionChanged.addEventListener((coll, added) => {
          if (!run.mode[key] || !added.length) return;
          const now = Cesium.JulianDate.now();
          for (const e of added) hideEntity(e, entityHidden(key, e, now));
        });
      }
      const now = Cesium.JulianDate.now();
      for (const e of src.entities.values) hideEntity(e, entityHidden(key, e, now));
    }
    if ((key === "airports" || key === "bases") && root.GsaInfra && root.GsaInfra.setFilter) {
      if (mode === "none") root.GsaInfra.setFilter(key, () => false);
      else if (mode === "circle" && run.place) {
        // Same great-circle test as the count, so the pins shown match the numbers.
        const { lat, lon } = run.place;
        const rk = run.miles * MILE / 1000;
        const scratch = new Cesium.Cartographic();
        root.GsaInfra.setFilter(key, (pos) => {
          const c = Cesium.Cartographic.fromCartesian(pos, Cesium.Ellipsoid.WGS84, scratch);
          return Boolean(c) && km(lat, lon, Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude)) <= rk;
        });
      } else root.GsaInfra.setFilter(key, null);
    }
  }

  // Card-enabled layers: circle only, or everything when SHOW ALL is on.
  function refreshModes() {
    for (const k of run.autoOn) setMode(k, run.showAll ? null : "circle");
  }

  function settled(key, since) {
    const sw = root.GsaSpaceWeather && root.GsaSpaceWeather.state[key];
    if (sw) return Boolean(sw.error) || (sw.fetchedAt || 0) >= since;
    const inf = root.GsaInfra && root.GsaInfra.state[key];
    if (inf) return Boolean(inf.ready || inf.error);
    return null; // unknown: judged by the pin count holding still
  }

  function drawCircle() {
    const v = viewer();
    if (!v || !run.place) return;
    if (!circleSource) {
      circleSource = new Cesium.CustomDataSource("nearby-radius");
      v.dataSources.add(circleSource);
    }
    circleSource.entities.removeAll();
    const r = run.miles * MILE;
    circleSource.entities.add({
      id: "nearby-radius",
      position: Cesium.Cartesian3.fromDegrees(run.place.lon, run.place.lat, 0),
      ellipse: {
        semiMajorAxis: r,
        semiMinorAxis: r,
        height: 0,
        material: Cesium.Color.fromCssColorString("#ffb020").withAlpha(0.1),
      },
    });
    // Ellipse outlines are 1 px in WebGL; draw the edge as a 3 px line instead.
    const ring = [];
    const lat1 = run.place.lat * Math.PI / 180;
    const lon1 = run.place.lon * Math.PI / 180;
    const d = r / 6371008.8;
    for (let i = 0; i <= 120; i += 1) {
      const b = (i / 120) * 2 * Math.PI;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
      const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      ring.push(Cesium.Cartesian3.fromRadians(lon2, lat2, 0));
    }
    circleSource.entities.add({
      id: "nearby-radius-edge",
      polyline: {
        positions: ring,
        width: 3,
        material: Cesium.Color.fromCssColorString("#ffb020").withAlpha(0.95),
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
  }

  function frameCircle() {
    const v = viewer();
    if (!v || !run.place) return;
    const center = Cesium.Cartesian3.fromDegrees(run.place.lon, run.place.lat, 0);
    v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, run.miles * MILE * 1.6), {
      offset: new Cesium.HeadingPitchRange(0, -Cesium.Math.PI_OVER_TWO, 0),
      duration: 1.6,
    });
  }

  // ---------- card ----------
  function card() {
    let el = $("nearby-card");
    if (el) return el;
    el = document.createElement("aside");
    el.id = "nearby-card";
    el.className = "nearby-card";
    el.hidden = true;
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
      <div class="nearby-head">
        <strong id="nearby-title"></strong>
        <button type="button" id="nearby-min" class="nearby-min" aria-label="Hide or show the list">HIDE</button>
      </div>
      <div class="nearby-radius" role="group" aria-label="Radius in miles">
        ${RADII.map((m) => `<button type="button" class="chip" data-nearby-miles="${m}" aria-pressed="false">${m}</button>`).join("")}<span>MI</span>
      </div>
      <p class="nearby-status" id="nearby-status"></p>
      <button type="button" id="nearby-all" class="nearby-all" aria-pressed="false">SHOW ALL PINS</button>
      <ul class="nearby-list" id="nearby-list"></ul>
      <button type="button" id="nearby-clear" class="nearby-clear">CLEAR SEARCH &amp; LAYERS</button>`;
    const stage = document.querySelector(".stage") || document.body;
    stage.appendChild(el);
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-nearby-miles]");
      if (b) setMiles(Number(b.dataset.nearbyMiles));
      const row = ev.target.closest("[data-nearby-layer]");
      if (row && typeof setLayer === "function") {
        const key = row.dataset.nearbyLayer;
        setLayer(key, !state.layers[key]);
        renderCard();
      }
    });
    $("nearby-all").addEventListener("click", () => {
      run.showAll = !run.showAll;
      refreshModes();
      renderCard();
    });
    $("nearby-clear").addEventListener("click", () => {
      if (root.GsaSearch) root.GsaSearch.clear(); // also clears this card via onCleared
      else clear();
    });
    $("nearby-min").addEventListener("click", () => {
      el.classList.toggle("is-min");
      $("nearby-min").textContent = el.classList.contains("is-min") ? "SHOW" : "HIDE";
    });
    return el;
  }

  function renderCard() {
    const el = card();
    if (!run.place) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    $("nearby-title").textContent = `WITHIN ${run.miles} MI OF ${String(run.place.name).split(",")[0].toUpperCase()}`;
    for (const b of el.querySelectorAll("[data-nearby-miles]")) {
      const on = Number(b.dataset.nearbyMiles) === run.miles;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const found = CANDIDATES.filter((k) => run.counts[k] > 0).sort((a, b) => run.counts[b] - run.counts[a]);
    const status = $("nearby-status");
    if (run.checking) status.textContent = `Checking ${CANDIDATES.length} map layers…`;
    else if (!found.length) status.textContent = "No pins from any layer inside this circle. Try a bigger radius.";
    else status.textContent = `${found.length} layer${found.length === 1 ? "" : "s"} with pins inside · checked in ${(run.ms / 1000).toFixed(1)} s`;
    const all = $("nearby-all");
    all.hidden = run.checking || !run.autoOn.size;
    all.textContent = run.showAll ? "SHOW ONLY INSIDE CIRCLE" : "SHOW ALL PINS";
    all.classList.toggle("on", run.showAll);
    all.setAttribute("aria-pressed", run.showAll ? "true" : "false");
    $("nearby-list").innerHTML = found.map((k) => `<li><button type="button" data-nearby-layer="${k}" class="${state.layers[k] ? "on" : ""}" aria-pressed="${state.layers[k] ? "true" : "false"}"><span>${esc(label(k))}</span><em>${run.counts[k].toLocaleString("en-US")}</em></button></li>`).join("");
  }

  // ---------- run ----------
  function recount() {
    if (!run.place) return;
    const rk = run.miles * MILE / 1000;
    for (const k of CANDIDATES) run.counts[k] = countWithin(k, run.place.lat, run.place.lon, rk);
  }

  function enableAuto(k) {
    run.autoOn.add(k);
    setMode(k, run.showAll ? null : "circle");
    setLayer(k, true);
  }

  function disableAuto(k) {
    run.autoOn.delete(k);
    setLayer(k, false);
    setMode(k, null);
  }

  // Radius changed: layers with pins inside come on, card layers with none go off.
  function applyCounts() {
    for (const k of CANDIDATES) {
      const hit = run.counts[k] > 0;
      if (hit && !state.layers[k]) enableAuto(k);
      else if (!hit && run.autoOn.has(k)) disableAuto(k);
    }
    refreshModes();
  }

  async function check() {
    const token = ++run.token;
    run.checking = true;
    run.startedAt = Date.now();
    renderCard();
    // Load every candidate layer that is off through its normal switch, out of sight:
    // the switch stays OFF (state.probeHidden) and no pin is drawn (mode "none").
    const probing = CANDIDATES.filter((k) => !state.layers[k]);
    run.probing = new Set(probing);
    for (const k of probing) {
      state.probeHidden.add(k);
      setMode(k, "none");
      setLayer(k, true);
    }
    const since = run.startedAt;
    let last = "";
    let quietSince = Date.now();
    while (Date.now() - since < MAX_WAIT_MS) {
      await sleep(600);
      if (token !== run.token) return;
      recount();
      const sig = CANDIDATES.map((k) => run.counts[k]).join(",");
      if (sig !== last) {
        last = sig;
        quietSince = Date.now();
      }
      const known = probing.map((k) => settled(k, since)).filter((x) => x !== null);
      if (known.every(Boolean) && Date.now() - quietSince >= QUIET_MS && Date.now() - since >= 3000) break;
    }
    if (token !== run.token) return;
    recount();
    // Layers with pins inside appear (inside pins only); the rest go back off unseen.
    for (const k of probing) {
      if (run.counts[k] > 0) {
        state.probeHidden.delete(k);
        enableAuto(k);
      } else {
        setLayer(k, false);
        state.probeHidden.delete(k);
        setMode(k, null);
      }
    }
    run.probing.clear();
    run.checking = false;
    run.ms = Date.now() - since;
    renderCard();
    // Pins that finish drawing just after the check get the same circle filter.
    setTimeout(() => { if (token === run.token) refreshModes(); }, 1500);
  }

  // Switch off every layer this card turned on (kept or still being checked) and give
  // every layer back its full worldwide display.
  function undoAuto() {
    if (typeof setLayer !== "function") return;
    for (const k of new Set([...run.autoOn, ...run.probing])) {
      setLayer(k, false);
      state.probeHidden.delete(k);
      setMode(k, null);
    }
    run.autoOn.clear();
    run.probing.clear();
  }

  function start(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
    // A new search: layers this card turned on for the last place go back off first.
    run.token += 1;
    undoAuto();
    run.showAll = false;
    run.place = { name: place.name, lat: place.lat, lon: place.lon };
    run.counts = {};
    drawCircle();
    frameCircle();
    return check();
  }

  function setMiles(miles) {
    if (!run.place || !RADII.includes(miles)) return;
    run.miles = miles;
    drawCircle();
    frameCircle();
    if (run.checking) return renderCard();
    recount();
    applyCounts();
    renderCard();
  }

  // restore=true: switch off what this card switched on (CLEAR / cleared search box).
  function clear(opts) {
    const restore = !opts || opts.restore !== false;
    run.token += 1;
    if (restore) undoAuto();
    else {
      for (const k of new Set([...run.autoOn, ...run.probing])) {
        state.probeHidden.delete(k);
        setMode(k, null);
      }
    }
    run.autoOn.clear();
    run.probing.clear();
    run.place = null;
    run.checking = false;
    run.showAll = false;
    run.counts = {};
    if (circleSource) circleSource.entities.removeAll();
    const el = $("nearby-card");
    if (el) el.hidden = true;
  }

  // A layer switched from the MENU or the dot row belongs to the user again: full
  // worldwide display, and CLEAR leaves it alone. (Capture phase: runs before the
  // site's own toggle handler; the card's own list is not affected.)
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-layer-toggle]");
    if (!b || b.closest("#nearby-card")) return;
    const k = b.dataset.layerToggle;
    if (run.autoOn.has(k)) {
      run.autoOn.delete(k);
      setMode(k, null);
      if (run.place) setTimeout(renderCard, 0);
    }
  }, true);

  root.GsaNearby = {
    start,
    setMiles,
    clear,
    state: run,
    CANDIDATES,
    RADII,
    _countWithin: countWithin,
  };
})(window);
