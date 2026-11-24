/* Global Status · ADDRESS SEARCH
 *
 * Reuses Cesium's built-in Geocoder widget (the Viewer `geocoder` option: search box,
 * suggestion list, arrow keys / Enter, 500 ms type-ahead debounce, credits) and plugs a
 * custom GeocoderService into it, the same pattern as Cesium Sandcastle's
 * "Custom Geocoder" example (https://sandcastle.cesium.com/?src=Custom%20Geocoder.html).
 *
 * Lookups run once typing pauses (Cesium's 500 ms rate limit plus a settle check here),
 * from 3 characters, cached per query; picking a suggestion costs no request:
 *   Mapbox Geocoding v6 /forward  addresses, streets, towns, regions, countries
 *   Mapbox Search Box /forward    landmarks and businesses (types=poi); skipped when
 *                                 the query starts with a house number
 *   "lat, lon" in decimal degrees  handled here, no request
 *
 * Picking a result drops one pin (replaces the last one) and hands the place to
 * nearby.js, which frames a 50-mile circle and switches on layers with pins inside.
 * Clearing the box, CLEAR on the nearby card, or RESET MAP removes pin and circle.
 */
(function (root) {
  // ---- CONFIG ---------------------------------------------------------------
  // Mapbox PUBLIC token (pk.*). It is visible to every visitor by design; lock it to
  // the site's domains in Mapbox → Tokens → URL restrictions. Blank = search hidden.
  const MAPBOX_TOKEN = "pk.eyJ1Ijoid2lsbC1jLWNhc2V5IiwiYSI6ImNtd3VyZHlnYzAxb24yeHB0ZnRrdDN6OXUifQ.uKzfi-zQYvBA08yJ547PtQ";
  const MIN_CHARS = 3;
  const MAX_RESULTS = 5;
  const MAX_POIS = 2;
  const SETTLE_MS = 350; // type-ahead waits until the text stops changing this long
  // MY AREA (approx.): free, no-key, HTTPS + CORS IP lookups, tried in order. ipwho.is is
  // the lookup the repo already uses (downtime.py, visualizer); its free tier is 1,000
  // requests a day per caller, commercial use allowed. GeoJS (MaxMind GeoLite data) has
  // no rate limit and is the fallback. Each call runs from the visitor's own browser.
  const IP_SERVICES = [
    { name: "ipwho.is", url: "https://ipwho.is/", parse: (d) => (d && d.success !== false ? d : null) },
    { name: "GeoJS", url: "https://get.geojs.io/v1/ip/geo.json", parse: (d) => d },
  ];
  const LOCATE_TIMEOUT_MS = 8000;
  // ---------------------------------------------------------------------------

  const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";
  const SEARCHBOX_URL = "https://api.mapbox.com/search/searchbox/v1/forward";
  // Camera height (metres) after flying to each kind of result.
  const HEIGHTS = {
    country: 4500000, region: 1000000, postcode: 30000, district: 150000, place: 45000,
    locality: 20000, neighborhood: 8000, street: 3000, block: 2000, address: 1500,
    secondary_address: 1500, poi: 1500, coordinates: 20000,
  };
  const TYPE_RANK = {
    country: 6, region: 5, place: 5, district: 3, locality: 3, postcode: 3, address: 4,
    secondary_address: 4, poi: 4, neighborhood: 2, street: 2, block: 1,
  };

  const cache = new Map();
  const meta = new WeakMap(); // destination -> { name, lon, lat }
  const stats = { requests: 0, cacheHits: 0, coordinateHits: 0, errors: 0 };
  let autoSeq = 0;
  let lastPicked = "";
  let warned = false;
  let viewerRef = null;
  let pinSource = null;
  let pinImage = null;
  let locateSeq = 0;
  let noteTimer = 0;

  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const lang = () => {
    const l = String((root.navigator && root.navigator.language) || "en").split("-")[0].toLowerCase();
    return /^[a-z]{2}$/.test(l) ? l : "en";
  };

  // "38.8977, -77.0365", "38.8977 -77.0365", "38.8977°N 77.0365°W" -> lat, lon.
  function parseLatLon(q) {
    const m = String(q).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
    if (!m) return null;
    let lat = Number(m[1]);
    let lon = Number(m[3]);
    if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
    if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  function makeResult(name, lon, lat, type) {
    const height = HEIGHTS[type] || 20000;
    const destination = Cesium.Cartesian3.fromDegrees(lon, lat, height);
    meta.set(destination, { name, lon, lat, type });
    return { displayName: name, destination };
  }

  function labelFor(p, fallback) {
    const name = p.name_preferred || p.name || "";
    const full = p.full_address || "";
    const where = p.place_formatted || "";
    if (full && norm(full).startsWith(norm(name))) return full;
    if (name && full) return `${name}, ${full}`;
    if (name && where) return `${name}, ${where}`;
    return name || full || where || fallback;
  }

  function score(name, q, type) {
    const n = norm(name);
    if (!n) return 0;
    if (n === q) return 3;
    if (n.startsWith(q)) return 2;
    // "eiffel tower paris" still finds the landmark; a town named in an address does not
    // outrank the address itself.
    if (n.includes(q) || (type === "poi" && n.length >= 4 && q.includes(n))) return 1;
    return 0;
  }

  async function getJson(url) {
    stats.requests += 1;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Mapbox ${res.status}`);
    return res.json();
  }

  async function lookup(q) {
    const key = norm(q);
    if (cache.has(key)) {
      stats.cacheHits += 1;
      return cache.get(key);
    }
    // No proximity bias: biasing to the map view or the visitor's IP pulled "115 E Main St,
    // Marshall, AR" to the wrong state in tests. Mapbox ranks the typed text worldwide.
    const common = `q=${encodeURIComponent(q)}&language=${lang()}&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
    const wantPoi = !/^\d/.test(q);
    const [geo, poi] = await Promise.allSettled([
      getJson(`${GEOCODE_URL}?${common}&autocomplete=true&limit=${MAX_RESULTS}`),
      wantPoi ? getJson(`${SEARCHBOX_URL}?${common}&types=poi&auto_complete=true&limit=3`) : Promise.resolve({ features: [] }),
    ]);
    if (geo.status === "rejected" && poi.status === "rejected") throw geo.reason;
    const rows = [];
    const take = (settled, source) => {
      if (settled.status !== "fulfilled") return;
      for (const f of (settled.value && settled.value.features) || []) {
        const c = f.geometry && f.geometry.coordinates;
        const p = f.properties || {};
        if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const type = p.feature_type || source;
        if (source === "poi" && type !== "poi") continue;
        rows.push({ label: labelFor(p, q), name: p.name_preferred || p.name || "", lon: c[0], lat: c[1], type, order: rows.length });
      }
    };
    take(geo, "geo");
    take(poi, "poi");
    for (const r of rows) {
      r.score = score(r.name, key, r.type);
      r.rank = TYPE_RANK[r.type] || 0;
    }
    rows.sort((a, b) => b.score - a.score || (b.score > 0 ? b.rank - a.rank : 0) || a.order - b.order);
    const seen = new Set();
    const out = [];
    let pois = 0;
    const nonPoi = rows.filter((r) => r.type !== "poi").length;
    for (const r of rows) {
      const k = norm(r.label);
      if (seen.has(k)) continue;
      // A business whose name does not match the query is noise once addresses came back.
      if (r.type === "poi" && r.score === 0 && nonPoi >= 3) continue;
      if (r.type === "poi" && pois >= MAX_POIS && nonPoi > 0) continue;
      seen.add(k);
      if (r.type === "poi") pois += 1;
      out.push(r);
      if (out.length >= MAX_RESULTS) break;
    }
    cache.set(key, out);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return out;
  }

  function MapboxGeocoderService() {
    this._credit = new Cesium.Credit('Search © <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">Mapbox</a>', true);
  }
  Object.defineProperties(MapboxGeocoderService.prototype, {
    credit: { get() { return this._credit; } },
  });
  MapboxGeocoderService.prototype.geocode = async function (input, type) {
    const q = String(input || "").trim();
    const auto = type === Cesium.GeocodeType.AUTOCOMPLETE;
    const seq = auto ? ++autoSeq : autoSeq;
    if (!q || / \(not found\)$/.test(q)) return [];
    const ll = parseLatLon(q);
    if (ll) {
      stats.coordinateHits += 1;
      const name = `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`;
      return [makeResult(name, ll.lon, ll.lat, "coordinates")];
    }
    // After a pick Cesium writes the chosen name back into the box, which would fire one
    // more type-ahead lookup. Skip it: no request, no list popping back open.
    if (auto && q === lastPicked) return [];
    if (q.length < MIN_CHARS) return [];
    // Half-typed coordinates ("38.89", "38.8977, -") are not worth a request.
    if (/^[-+\d\s.,°]+$/.test(q) && /[.,]/.test(q)) return [];
    if (auto) {
      // Cesium's rate limit fires every 500 ms while typing; only look up settled text.
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const now = viewerRef && viewerRef.geocoder ? String(viewerRef.geocoder.viewModel._searchText || "").trim() : q;
      if (now !== q || seq !== autoSeq) return [];
    }
    try {
      const rows = await lookup(q);
      if (auto && seq !== autoSeq) return []; // a newer keystroke already owns the list
      return rows.map((r) => makeResult(r.label, r.lon, r.lat, r.type));
    } catch (err) {
      stats.errors += 1;
      if (!warned) {
        warned = true;
        console.warn("Address search unavailable:", err && err.message);
      }
      if (auto) return [];
      throw err;
    }
  };

  function pinCanvas() {
    if (!pinImage) pinImage = new Cesium.PinBuilder().fromColor(Cesium.Color.fromCssColorString("#ffb020"), 44).toDataURL();
    return pinImage;
  }

  function clearPin() {
    if (pinSource) pinSource.entities.removeAll();
  }

  function dropPin(info) {
    if (!viewerRef) return;
    if (!pinSource) {
      pinSource = new Cesium.CustomDataSource("address-search");
      viewerRef.dataSources.add(pinSource);
    }
    clearPin();
    const short = String(info.name).split(",")[0].slice(0, 48);
    pinSource.entities.add({
      id: "address-search-pin",
      name: info.name,
      position: Cesium.Cartesian3.fromDegrees(info.lon, info.lat, 0),
      billboard: {
        image: pinCanvas(),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: short,
        font: '600 13px "IBM Plex Mono", ui-monospace, monospace',
        fillColor: Cesium.Color.fromCssColorString("#d7e6ea"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(7,11,16,0.85)"),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 6),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function destinationFound(viewModel, destination) {
    const info = meta.get(destination);
    lastPicked = String(viewModel._searchText || "").trim();
    if (info) dropPin(info);
    if (info && root.GsaNearby) {
      viewModel.complete.raiseEvent();
      root.GsaNearby.start(info);
    } else viewModel._scene.camera.flyTo({
      destination,
      duration: viewModel.flightDuration,
      endTransform: Cesium.Matrix4.IDENTITY,
      complete: () => viewModel.complete.raiseEvent(),
    });
    // Close the phone keyboard so the globe and the nearby card are visible. Cesium
    // re-focuses the box on the tap's pointerup, so let that run first.
    if (root.matchMedia && root.matchMedia("(max-width: 800px)").matches) {
      setTimeout(() => {
        viewModel._focusTextbox = false;
        const box = document.querySelector(".cesium-geocoder-input");
        if (box) box.blur();
      }, 50);
    }
  }

  // ---------- MY AREA / MY EXACT LOCATION ----------
  // Same path as a picked search result: pin, search box text, nearby radius card.
  function goTo(info) {
    lastPicked = info.name;
    if (viewerRef && viewerRef.geocoder) viewerRef.geocoder.viewModel.searchText = info.name;
    dropPin(info);
    if (root.GsaNearby) root.GsaNearby.start(info);
    else if (viewerRef) viewerRef.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(info.lon, info.lat, 60000) });
  }

  function note(text, ms) {
    const el = document.getElementById("gsa-locate-note");
    if (!el) return;
    clearTimeout(noteTimer);
    el.textContent = text || "";
    el.hidden = !text;
    if (text && ms) noteTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function busy(on) {
    for (const b of document.querySelectorAll("[data-gsa-locate]")) {
      b.disabled = on;
      b.setAttribute("aria-busy", on ? "true" : "false");
    }
  }

  async function ipLocate() {
    for (const svc of IP_SERVICES) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), LOCATE_TIMEOUT_MS);
      try {
        const res = await fetch(svc.url, { signal: ctl.signal, cache: "no-store", credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = svc.parse(await res.json());
        const lat = Number(d && d.latitude);
        const lon = Number(d && d.longitude);
        if (!d || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) throw new Error("no location");
        const where = [d.city, d.region, d.country].filter(Boolean).join(", ") || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        return { name: `≈ ${where}`, lat, lon, approx: true, service: svc.name };
      } catch (err) {
        stats.locateErrors = (stats.locateErrors || 0) + 1;
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }

  async function locateApprox(prefix) {
    const seq = ++locateSeq;
    busy(true);
    note(`${prefix || ""}Finding your approximate area…`);
    const info = await ipLocate();
    if (seq !== locateSeq) return null;
    busy(false);
    if (!info) {
      note(`${prefix || ""}Could not find your area. Search an address instead.`, 8000);
      return null;
    }
    goTo(info);
    note(`${prefix || ""}Approximate (city-level) area from your internet address, via ${info.service}.`, 15000);
    return info;
  }

  function locateExact() {
    const seq = ++locateSeq;
    const geo = root.navigator && root.navigator.geolocation;
    if (!geo || !root.isSecureContext) return locateApprox("Exact location is not available here. ");
    busy(true);
    note("Waiting for location permission…");
    return new Promise((resolve) => {
      geo.getCurrentPosition((pos) => {
        if (seq !== locateSeq) return resolve(null);
        busy(false);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy || 0);
        const info = { name: "My location", lat, lon, approx: false, accuracy: acc };
        goTo(info);
        note(acc ? `Your device location, accurate to about ${acc >= 1000 ? `${(acc / 1609.344).toFixed(1)} mi` : `${acc} m`}.` : "Your device location.", 7000);
        resolve(info);
      }, (err) => {
        if (seq !== locateSeq) return resolve(null);
        const why = err && err.code === 1 ? "Location permission denied" : "Exact location unavailable";
        resolve(locateApprox(`${why}; showing your approximate area instead. `));
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }

  function addLocateButtons(viewer) {
    const toolbar = viewer.container.querySelector(".cesium-viewer-toolbar");
    if (!toolbar || toolbar.querySelector(".gsa-locate")) return;
    const box = document.createElement("div");
    box.className = "gsa-locate";
    box.innerHTML = `
      <button type="button" data-gsa-locate="approx" title="Show my approximate area (city-level, from my internet address)" aria-label="Show my approximate area, city-level"><svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 1.8"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg><b>MY AREA (APPROX)</b></button>
      <button type="button" data-gsa-locate="exact" title="Use my exact location (asks permission)" aria-label="Use my exact location"><svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg><b>MY EXACT LOCATION</b></button>
      <p id="gsa-locate-note" class="gsa-locate-note" role="status" hidden></p>`;
    toolbar.appendChild(box);
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-gsa-locate]");
      if (!b || b.disabled) return;
      if (b.dataset.gsaLocate === "exact") locateExact();
      else locateApprox();
    });
  }

  root.GsaSearch = {
    enabled: () => Boolean(MAPBOX_TOKEN),
    // Viewer option value: false (no search) or the service list.
    viewerOption: () => (MAPBOX_TOKEN ? [new MapboxGeocoderService()] : false),
    attach(viewer) {
      viewerRef = viewer;
      addLocateButtons(viewer);
      if (!viewer.geocoder) return;
      const vm = viewer.geocoder.viewModel;
      vm.destinationFound = destinationFound;
      const input = viewer.geocoder.container.querySelector(".cesium-geocoder-input");
      if (input) {
        input.setAttribute("placeholder", "Search address, place, or lat, lon");
        input.setAttribute("aria-label", "Search for an address or place");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("enterkeyhint", "search");
      }
      Cesium.knockout.getObservable(vm, "_searchText").subscribe((v) => {
        if (!String(v || "").trim()) {
          lastPicked = "";
          clearPin();
          if (root.GsaNearby) root.GsaNearby.clear();
        }
      });
    },
    clear() {
      locateSeq += 1;
      busy(false);
      note("");
      lastPicked = "";
      clearPin();
      if (root.GsaNearby) root.GsaNearby.clear();
      if (viewerRef && viewerRef.geocoder) viewerRef.geocoder.viewModel.searchText = "";
    },
    stats: () => ({ ...stats }),
    locateApprox,
    locateExact,
    IP_SERVICES: IP_SERVICES.map((s) => s.name),
    _parseLatLon: parseLatLon,
  };
})(window);
