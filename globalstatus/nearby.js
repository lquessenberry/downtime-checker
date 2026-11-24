/* Global Status · WHAT'S NEARBY (runs after an address search pick, geocoder.js)
 *
 * Draws a radius circle (default 50 miles) around the searched place, switches on
 * every point layer that has at least one pin inside it, and opens a small card to
 * change the radius. CLEAR puts the layers back the way they were.
 *
 * Reuses the site's own code: setLayer() to switch layers (each layer's normal loader
 * fetches its data), each layer's Cesium data source (sourceFor) or the infrastructure
 * point collections for positions, and a Cesium EllipseGraphics for the circle.
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

  const run = { place: null, miles: DEFAULT_MILES, autoOn: new Set(), probing: new Set(), counts: {}, token: 0, checking: false, startedAt: 0, ms: 0 };
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

  // Number of a layer's pins (or areas) inside the circle, from data already on the page.
  function countWithin(key, lat, lon, radiusKm) {
    let n = 0;
    const now = Cesium.JulianDate.now();
    const src = typeof sourceFor === "function" ? sourceFor(key) : null;
    if (src) {
      for (const e of src.entities.values) {
        if (e.position) {
          const p = toLatLon(e.position.getValue(now));
          if (p && km(lat, lon, p.lat, p.lon) <= radiusKm) n += 1;
          continue;
        }
        const h = e.polygon && e.polygon.hierarchy && e.polygon.hierarchy.getValue(now);
        if (h && h.positions && h.positions.length) {
          const ring = h.positions.map(toLatLon).filter(Boolean);
          if (insidePolygon(lat, lon, ring) || ring.some((p) => km(lat, lon, p.lat, p.lon) <= radiusKm)) n += 1;
        }
      }
    }
    // Airports and military bases are point primitives (infra.js), not entities.
    const prims = viewer() ? viewer().scene.primitives : null;
    if (prims && (key === "airports" || key === "bases")) {
      for (let i = 0; i < prims.length; i += 1) {
        const coll = prims.get(i);
        if (!(coll instanceof Cesium.PointPrimitiveCollection) || !coll.length) continue;
        const first = coll.get(0);
        if (!first || !first.id || first.id.__infra !== key) continue;
        for (let j = 0; j < coll.length; j += 1) {
          const p = toLatLon(coll.get(j).position);
          if (p && km(lat, lon, p.lat, p.lon) <= radiusKm) n += 1;
        }
      }
    }
    return n;
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
    $("nearby-list").innerHTML = found.map((k) => `<li><button type="button" data-nearby-layer="${k}" class="${state.layers[k] ? "on" : ""}" aria-pressed="${state.layers[k] ? "true" : "false"}"><span>${esc(label(k))}</span><em>${run.counts[k].toLocaleString("en-US")}</em></button></li>`).join("");
  }

  // ---------- run ----------
  function recount() {
    if (!run.place) return;
    const rk = run.miles * MILE / 1000;
    for (const k of CANDIDATES) run.counts[k] = countWithin(k, run.place.lat, run.place.lon, rk);
  }

  // Turn on layers with pins inside; turn off ones we turned on that now have none.
  function applyCounts() {
    for (const k of CANDIDATES) {
      const hit = run.counts[k] > 0;
      if (hit && !state.layers[k]) {
        setLayer(k, true);
        run.autoOn.add(k);
      } else if (!hit && run.autoOn.has(k)) {
        setLayer(k, false);
        run.autoOn.delete(k);
      }
    }
  }

  async function check() {
    const token = ++run.token;
    run.checking = true;
    run.startedAt = Date.now();
    renderCard();
    // Load every candidate layer that is off through its normal switch.
    const probing = CANDIDATES.filter((k) => !state.layers[k]);
    run.probing = new Set(probing);
    for (const k of probing) setLayer(k, true);
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
    // Probe layers without pins inside go back off; the rest stay on.
    for (const k of probing) {
      if (run.counts[k] > 0) run.autoOn.add(k);
      else setLayer(k, false);
    }
    run.probing.clear();
    run.checking = false;
    run.ms = Date.now() - since;
    renderCard();
  }

  // Switch off every layer this card turned on (kept or still being checked).
  function undoAuto() {
    if (typeof setLayer !== "function") return;
    for (const k of new Set([...run.autoOn, ...run.probing])) setLayer(k, false);
    run.autoOn.clear();
    run.probing.clear();
  }

  function start(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
    // A new search: layers this card turned on for the last place go back off first.
    run.token += 1;
    undoAuto();
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
    run.autoOn.clear();
    run.probing.clear();
    run.place = null;
    run.checking = false;
    run.counts = {};
    if (circleSource) circleSource.entities.removeAll();
    const el = $("nearby-card");
    if (el) el.hidden = true;
  }

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
