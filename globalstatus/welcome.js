// First launch "Choose your first view" picker (GS-47).
// NUKE SIMULATOR comes first, then one row for every sidebar layer category except
// SIMULATORS & GAMES (its only layer is the Nuke Simulator), then EXPLORE MANUALLY.
// A category row turns on every layer in that sidebar group, opens the group in the
// menu, and flies the camera to a matching top-down view. "Don't show this again" is
// kept in localStorage; QUICK VIEWS / VIEWS in the top bar reopens the picker.
// Fresh launches open like God's Eye View: the Aerial photo map, a dive from about
// 24,000 km down to a low view over downtown Austin. The picker opens when that dive
// lands. A slow circle then keeps the globe moving until the visitor picks, closes,
// or touches the map.
(function (root) {
  "use strict";

  var STORE_KEY = "gsa_welcome_dismissed";
  // Opening dive: straight down over North America, then a low landing over downtown
  // Austin, tilted a little so the streets and buildings read like an aerial photo.
  var INTRO = {
    from: { lon: -97.7431, lat: 33.5, km: 24000 },
    target: { lon: -97.7431, lat: 30.2672, name: "Austin, TX" },
    heading: 0, // degrees, looking north up Congress Avenue
    pitch: -62, // degrees below the horizon
    altM: 650, // camera height above the ground in meters
    seconds: 3.4,
    orbitDegPerSec: 1.4, // slow circle over the city after the picker opens
    basemap: "satellite", // Aerial photo (Esri World Imagery), like God's Eye View
  };

  // [west, south, east, north] in degrees for each view.
  var VIEW_US = [-127, 22, -65, 51];
  var VIEW_WORLD = [-168, -48, 150, 72]; // the site's normal startup framing
  var I = {
    nuke: '<path d="M 5.01 10.74 L 4.75 10.63 L 4.51 10.51 L 4.29 10.37 L 4.11 10.21 L 3.97 10.03 L 3.86 9.74 L 3.88 9.43 L 3.95 9.21 L 4.07 9.00 L 4.23 8.80 L 4.42 8.60 L 4.56 8.42 L 4.57 8.14 L 4.59 7.87 L 4.62 7.60 L 4.67 7.33 L 4.73 7.06 L 4.80 6.79 L 4.88 6.53 L 4.98 6.27 L 4.89 5.94 L 4.80 5.69 L 4.74 5.44 L 4.73 5.09 L 4.82 4.78 L 4.94 4.61 L 5.11 4.47 L 5.32 4.36 L 5.56 4.28 L 5.82 4.23 L 6.11 4.20 L 6.34 4.15 L 6.55 3.94 L 6.76 3.75 L 6.98 3.56 L 7.21 3.38 L 7.45 3.21 L 7.69 3.04 L 7.95 2.89 L 8.21 2.74 L 8.33 2.55 L 8.42 2.28 L 8.53 2.04 L 8.67 1.82 L 8.83 1.64 L 9.02 1.51 L 9.23 1.42 L 9.57 1.39 L 9.81 1.44 L 10.06 1.53 L 10.31 1.66 L 10.56 1.81 L 10.78 1.91 L 11.08 1.87 L 11.39 1.84 L 11.69 1.82 L 12.00 1.82 L 12.31 1.82 L 12.61 1.84 L 12.92 1.87 L 13.22 1.91 L 13.44 1.81 L 13.69 1.66 L 13.94 1.53 L 14.19 1.44 L 14.43 1.39 L 14.77 1.42 L 14.98 1.51 L 15.17 1.64 L 15.33 1.82 L 15.47 2.04 L 15.58 2.28 L 15.67 2.55 L 15.79 2.74 L 16.05 2.89 L 16.31 3.04 L 16.55 3.21 L 16.79 3.38 L 17.02 3.56 L 17.24 3.75 L 17.45 3.94 L 17.66 4.15 L 17.89 4.20 L 18.18 4.23 L 18.44 4.28 L 18.68 4.36 L 18.89 4.47 L 19.06 4.61 L 19.18 4.78 L 19.27 5.09 L 19.26 5.44 L 19.20 5.69 L 19.11 5.94 L 19.00 6.18 L 19.09 6.44 L 19.17 6.71 L 19.25 6.97 L 19.31 7.24 L 19.36 7.51 L 19.40 7.78 L 19.43 8.05 L 19.44 8.33 L 19.58 8.60 L 19.77 8.80 L 19.93 9.00 L 20.05 9.21 L 20.12 9.43 L 20.14 9.74 L 20.03 10.03 L 19.89 10.21 L 19.71 10.37 L 19.49 10.51 L 19.25 10.63 L 18.99 10.74 L 18.70 10.67 L 18.41 10.59 L 18.12 10.52 L 17.83 10.45 L 17.54 10.37 L 17.24 10.30 L 16.95 10.24 L 16.66 10.17 L 16.37 10.11 L 16.08 10.05 L 15.79 9.99 L 15.50 9.93 L 15.20 9.88 L 14.91 9.83 L 14.62 9.79 L 14.33 9.75 L 14.04 9.72 L 13.75 9.69 L 13.46 9.66 L 13.17 9.64 L 12.87 9.62 L 12.58 9.61 L 12.29 9.60 L 12.00 9.60 L 11.71 9.60 L 11.42 9.61 L 11.13 9.62 L 10.83 9.64 L 10.54 9.66 L 10.25 9.69 L 9.96 9.72 L 9.67 9.75 L 9.38 9.79 L 9.09 9.83 L 8.80 9.88 L 8.50 9.93 L 8.21 9.99 L 7.92 10.05 L 7.63 10.11 L 7.34 10.17 L 7.05 10.24 L 6.76 10.30 L 6.46 10.37 L 6.17 10.45 L 5.88 10.52 L 5.59 10.59 L 5.30 10.67 Z"/><path d="M11.08 9.75 V16.57"/><path d="M12.92 9.75 V16.57"/><path d="M 8.53 17.40 L 8.77 17.18 L 9.00 16.98 L 9.23 16.82 L 9.46 16.71 L 9.92 16.71 L 10.15 16.82 L 10.38 16.98 L 10.61 17.18 L 10.84 17.40 L 11.31 17.40 L 11.77 17.40 L 12.23 17.40 L 12.69 17.40 L 13.16 17.40 L 13.39 17.18 L 13.62 16.98 L 13.85 16.82 L 14.08 16.71 L 14.54 16.71 L 14.77 16.82 L 15.00 16.98 L 15.23 17.18 L 15.47 17.40"/><path d="M 4.46 19.90 L 4.67 19.64 L 4.89 19.41 L 5.10 19.23 L 5.32 19.11 L 5.75 19.11 L 5.97 19.23 L 6.18 19.41 L 6.40 19.64 L 6.61 19.90 L 7.04 19.90 L 7.47 19.90 L 7.91 19.90 L 8.34 19.90 L 8.77 19.90 L 8.98 19.64 L 9.20 19.41 L 9.41 19.23 L 9.63 19.11 L 10.06 19.11 L 10.28 19.23 L 10.49 19.41 L 10.71 19.64 L 10.92 19.90 L 11.35 19.90 L 11.78 19.90 L 12.22 19.90 L 12.65 19.90 L 13.08 19.90 L 13.29 19.64 L 13.51 19.41 L 13.72 19.23 L 13.94 19.11 L 14.37 19.11 L 14.59 19.23 L 14.80 19.41 L 15.02 19.64 L 15.23 19.90 L 15.66 19.90 L 16.09 19.90 L 16.53 19.90 L 16.96 19.90 L 17.39 19.90 L 17.60 19.64 L 17.82 19.41 L 18.03 19.23 L 18.25 19.11 L 18.68 19.11 L 18.90 19.23 L 19.11 19.41 L 19.33 19.64 L 19.54 19.90"/>',
    plane: '<path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5v2l7.5-2.3v3.6L8.5 20.3v1.2l3.5-.9 3.5.9v-1.2l-2-1.5v-3.6l7.5 2.3z" stroke-linejoin="round"/>',
    space: '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(-25 12 12)"/><circle cx="19.3" cy="7.4" r="1" fill="currentColor"/>',
    cloud: '<path d="M7 17.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.6A3.3 3.3 0 0 0 7 17.5z" stroke-linejoin="round"/><path d="m12.5 18.5-1.6 3.2" stroke-linecap="round"/>',
    quake: '<path d="M2.5 12h4l2-5 3.5 10 2.5-7 1.5 2h5.5" stroke-linejoin="round" stroke-linecap="round"/>',
    water: '<path d="M12 3.2c3 3.8 5.6 7 5.6 10.1a5.6 5.6 0 0 1-11.2 0C6.4 10.2 9 7 12 3.2z" stroke-linejoin="round"/><path d="M9.4 14.2a2.7 2.7 0 0 0 2.6 2.4" stroke-linecap="round"/>',
    bolt: '<path d="M13 2.5 5.5 13.2h5.2L9.8 21.5l8.7-11.3h-5.4z" stroke-linejoin="round"/>',
    shield: '<path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.5 7.5 10 4.4-1.5 7.5-5.4 7.5-10V5.6z" stroke-linejoin="round"/><path d="M12 8.2v6.4M8.8 11.4h6.4" stroke-linecap="round"/>',
    flag: '<path d="M5.5 21V3.5M5.5 4.5h11l-2.2 3.7 2.2 3.8h-11" stroke-linejoin="round" stroke-linecap="round"/>',
    health: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" stroke-linejoin="round"/><path d="M8.6 12.2h2l1-2 1.6 3.6.9-1.6h1.4" stroke-linejoin="round" stroke-linecap="round"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.4"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke-linecap="round"/>',
    group: '<circle cx="8.5" cy="8.6" r="2.6"/><circle cx="16" cy="9.6" r="2.2"/><path d="M3.5 19c.4-3.2 2.4-5 5-5s4.6 1.8 5 5M13.2 14.6c.8-.5 1.7-.8 2.8-.8 2.2 0 3.9 1.6 4.3 4.6" stroke-linecap="round"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5z" stroke-linejoin="round"/>',
    web: '<circle cx="12" cy="6.4" r="3.5"/><path d="M12 3.1v6.6M9.1 5.1h5.8M9.4 7.7h5.2M12 9.9v2M4.2 11.9h15.6M4.2 11.9v1.8M12 11.9v1.8M19.8 11.9v1.8M2.2 18.5h4.6M9.7 18.5h4.6M17.2 18.5h4.6"/><rect x="2.2" y="14.3" width="4.6" height="3.4" rx="0.7"/><rect x="9.7" y="14.3" width="4.6" height="3.4" rx="0.7"/><rect x="17.2" y="14.3" width="4.6" height="3.4" rx="0.7"/>',
  };
  // group: the sidebar <details> id whose layers the row turns on (read from the page,
  // so a layer added to a sidebar group later is picked up here too).
  var PRESETS = [
    {
      id: "nuke",
      title: "NUKE SIMULATOR",
      sub: "Interactive blast radius and fallout simulator",
      layers: ["effects"],
      view: [-128, 18, -62, 54],
      // Phones: the simulator panel covers the lower half, so the US sits higher on screen.
      phoneView: [-132, -8, -60, 56],
      icon: I.nuke,
    },
    { id: "transportation", group: "group-transportation", title: "TRANSPORTATION", sub: "Live aircraft, ships, airports, FAA TFRs and flight delays", view: VIEW_US, icon: I.plane },
    { id: "space", group: "group-space", title: "SPACE", sub: "ISS, satellites, aurora and the day / night line", view: VIEW_WORLD, icon: I.space },
    { id: "weather", group: "group-weather", title: "WEATHER", sub: "Global radar, US weather alerts and hurricanes", view: [-168, 5, -48, 74], icon: I.cloud },
    { id: "disasters", group: "group-natural-disasters", title: "NATURAL DISASTERS", sub: "Earthquakes, volcanoes, tsunamis, wildfires and disasters", view: VIEW_WORLD, icon: I.quake },
    { id: "floods", group: "group-floods-water", title: "FLOODS & WATER", sub: "US river gauges in flood and coastal water levels", view: VIEW_US, icon: I.water },
    { id: "power", group: "group-power-comms", title: "POWER & COMMUNICATIONS", sub: "Outages, internet, scanners, towers, power grid and GPS jamming", view: [-130, 8, 5, 62], icon: I.bolt },
    { id: "emergency", group: "group-emergency", title: "EMERGENCY SERVICES", sub: "USA police, sheriff, fire departments and hospitals", view: VIEW_US, icon: I.shield },
    { id: "conflict", group: "group-conflict-military", title: "CONFLICT & MILITARY", sub: "Global conflict tracker and military bases", view: VIEW_WORLD, icon: I.flag },
    { id: "health", group: "group-health", title: "HEALTH & HUMANITARIAN", sub: "Disease and animal outbreaks, hunger and US air quality", view: VIEW_WORLD, icon: I.health },
    { id: "firearms", group: "group-firearms", title: "FIREARMS", sub: "USA and global gun ownership and carry reciprocity", view: VIEW_US, icon: I.target },
    { id: "militias", group: "group-militias", title: "MILITIAS", sub: "National, statewide, local and inactive groups", view: VIEW_US, icon: I.group },
    {
      id: "manual",
      title: "EXPLORE MANUALLY",
      sub: "Begin with a clean globe",
      layers: [],
      view: null,
      icon: I.compass,
    },
  ];

  var hooks = { viewer: null, setLayer: null, phone: null, setBasemap: null, openGridTester: null, syncGridTester: null, syncLayers: null };
  var orbit = { heading: 0 };
  var box = null;
  var spinning = false;
  var spinFrame = 0;
  var spinLast = 0;
  var lastFocus = null;
  var openedAt = 0;
  var intro = { phase: "none", startedAt: 0, endedAt: 0, timer: 0, fromKm: 0, toKm: 0, landed: false };

  // Layers a row turns on: its own list, or every toggle in its sidebar group.
  function presetLayers(p) {
    if (p.layers) return p.layers.slice();
    var group = p.group && document.getElementById(p.group);
    if (!group) return [];
    var seen = {};
    var out = [];
    var buttons = group.querySelectorAll("[data-layer-toggle]");
    for (var i = 0; i < buttons.length; i += 1) {
      var key = buttons[i].dataset.layerToggle;
      if (!seen[key]) { seen[key] = true; out.push(key); }
    }
    return out;
  }

  function storeGet() {
    try { return root.localStorage.getItem(STORE_KEY) === "1"; } catch (e) { return false; }
  }
  function storeSet(on) {
    try {
      if (on) root.localStorage.setItem(STORE_KEY, "1");
      else root.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* private mode: the choice just lasts this visit */ }
  }
  function reducedMotion() {
    return Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false">' + inner + "</svg>";
  }

  function layerChoices(p) {
    var group = p.group && document.getElementById(p.group);
    if (!group) return [];
    var seen = {};
    var out = [];
    var buttons = group.querySelectorAll("[data-layer-toggle]");
    for (var i = 0; i < buttons.length; i += 1) {
      var key = buttons[i].dataset.layerToggle;
      if (!key || seen[key]) continue;
      seen[key] = true;
      var nameEl = buttons[i].querySelector(".layer-name");
      var name = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : key;
      out.push({ key: key, name: name });
    }
    return out;
  }

  function build() {
    if (box) return box;
    box = document.getElementById("welcome");
    if (!box) return null;
    var list = box.querySelector("[data-welcome-list]");
    var row = function (p, i) {
      return '<button type="button" class="welcome-row' + (i === 0 ? " is-primary" : "") + '" data-welcome-preset="' + p.id + '">' +
        '<span class="welcome-icon">' + svg(p.icon) + "</span>" +
        '<span class="welcome-text"><strong>' + p.title.replace(/&/g, "&amp;") + "</strong><em>" + p.sub + "</em></span>" +
        '<span class="welcome-arrow" aria-hidden="true">→</span></button>';
    };
    var cat = function (p) {
      var choices = layerChoices(p);
      var items = choices.map(function (item) {
        return '<button type="button" data-welcome-layer="' + item.key + '" data-welcome-preset="' + p.id + '">' +
          item.name.replace(/&/g, "&amp;") + "</button>";
      }).join("");
      return '<div class="welcome-cat">' +
        '<button type="button" class="welcome-row is-category" data-welcome-toggle="' + p.id + '" aria-expanded="false">' +
        '<span class="welcome-icon">' + svg(p.icon) + "</span>" +
        '<span class="welcome-text"><strong>' + p.title.replace(/&/g, "&amp;") + "</strong><em>" + p.sub + "</em></span>" +
        '<span class="welcome-arrow" aria-hidden="true">▾</span></button>' +
        '<div class="welcome-drop" hidden>' + items + "</div></div>";
    };
    var cats = PRESETS.filter(function (p) { return p.group; });
    var gridRow = '<button type="button" class="welcome-row" data-welcome-grid="1">' +
      '<span class="welcome-icon">' + svg(I.web) + "</span>" +
      '<span class="welcome-text"><strong>GRID TESTER</strong><em>Scan a grid and draw the lines on the globe</em></span>' +
      '<span class="welcome-arrow" aria-hidden="true">→</span></button>';
    list.innerHTML = row(PRESETS[0], 0) + gridRow +
      '<p class="welcome-section">ALL CATEGORIES</p><div class="welcome-cats">' +
      cats.map(cat).join("") + "</div>" +
      row(PRESETS[PRESETS.length - 1], 1);
    list.addEventListener("click", function (event) {
      // A tap that stopped the dive must not land on a row of the picker that opened
      // under the same finger, so rows ignore clicks for a moment after opening.
      if (root.performance.now() - openedAt < 450) return;
      var gridBtn = event.target.closest("[data-welcome-grid]");
      if (gridBtn) {
        if (typeof hooks.openGridTester === "function") hooks.openGridTester();
        return;
      }
      var layerBtn = event.target.closest("[data-welcome-layer]");
      if (layerBtn) {
        chooseLayer(layerBtn.dataset.welcomePreset, layerBtn.dataset.welcomeLayer);
        return;
      }
      var toggle = event.target.closest("[data-welcome-toggle]");
      if (toggle) {
        toggleDrop(toggle);
        return;
      }
      var picked = event.target.closest("[data-welcome-preset]");
      if (picked && !picked.closest(".welcome-drop")) choose(picked.dataset.welcomePreset);
    });
    var closers = box.querySelectorAll("[data-welcome-close]");
    for (var c = 0; c < closers.length; c += 1) {
      closers[c].addEventListener("click", function () { close(); });
    }
    var check = box.querySelector("[data-welcome-dismiss]");
    check.addEventListener("change", function () { storeSet(check.checked); });
    return box;
  }

  function isOpen() {
    return Boolean(box && !box.hidden);
  }

  function open(opts) {
    if (!build()) return;
    var check = box.querySelector("[data-welcome-dismiss]");
    check.checked = storeGet();
    lastFocus = document.activeElement;
    box.hidden = false;
    openedAt = root.performance.now();
    if (opts && opts.fade && !reducedMotion()) {
      box.classList.add("is-entering");
      void box.offsetWidth; // start the fade from the hidden state
      box.classList.remove("is-entering");
    }
    document.body.classList.add("welcome-open");
    var dock = Boolean(opts && opts.dock) && !(typeof hooks.phone === "function" && hooks.phone());
    box.classList.toggle("is-docked", dock);
    var home = box.querySelector("[data-welcome-home]");
    var grid = document.getElementById("grid-tester");
    if (home) home.hidden = false;
    if (grid) grid.hidden = true;
    box.setAttribute("aria-labelledby", "welcome-title");
    if (home) home.scrollTop = 0;
    var first = box.querySelector(".welcome-row");
    if (first && !(opts && opts.noFocus)) {
      try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    }
    if (opts && opts.spin) startSpin();
    if (typeof hooks.syncGridTester === "function") hooks.syncGridTester();
    if (typeof hooks.syncLayers === "function") hooks.syncLayers();
  }

  function close() {
    stopSpin();
    endIntro("closed");
    if (box) box.classList.remove("is-docked");
    if (!box || box.hidden) {
      if (typeof hooks.syncLayers === "function") hooks.syncLayers();
      return;
    }
    box.hidden = true;
    document.documentElement.classList.remove("welcome-pending");
    document.body.classList.remove("welcome-open");
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    if (typeof hooks.syncGridTester === "function") hooks.syncGridTester();
    if (typeof hooks.syncLayers === "function") hooks.syncLayers();
  }

  function viewer() {
    return typeof hooks.viewer === "function" ? hooks.viewer() : hooks.viewer;
  }

  function toggleDrop(button) {
    var cat = button.closest(".welcome-cat");
    var drop = cat && cat.querySelector(".welcome-drop");
    if (!drop) return;
    var open = drop.hidden;
    var drops = box.querySelectorAll(".welcome-drop");
    for (var i = 0; i < drops.length; i += 1) {
      drops[i].hidden = true;
      var head = drops[i].parentNode.querySelector("[data-welcome-toggle]");
      if (head) head.setAttribute("aria-expanded", "false");
    }
    drop.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function chooseLayer(presetId, key) {
    var preset = PRESETS.filter(function (p) { return p.id === presetId; })[0];
    stopSpin();
    close();
    if (hooks.setLayer && key) hooks.setLayer(key, true);
    var group = preset && preset.group && document.getElementById(preset.group);
    if (group) group.open = true;
    flyPreset(preset);
    var host = document.getElementById("cesium");
    if (host && preset) host.dataset.welcomePreset = preset.id + ":" + key;
  }

  function flyPreset(preset) {
    var v = viewer();
    if (!preset || !preset.view || !v || !root.Cesium) return;
    var phone = typeof hooks.phone === "function" && hooks.phone();
    var r = phone && preset.phoneView ? preset.phoneView : preset.view;
    v.camera.cancelFlight();
    v.camera.flyTo({
      destination: root.Cesium.Rectangle.fromDegrees(r[0], r[1], r[2], r[3]),
      orientation: { heading: 0, pitch: -root.Cesium.Math.PI_OVER_TWO, roll: 0 },
      duration: intro.landed ? 2.8 : 2.2,
    });
  }

  function choose(id) {
    var preset = PRESETS.filter(function (p) { return p.id === id; })[0];
    stopSpin();
    close();
    if (!preset) return;
    if (preset.group) return;
    var keys = presetLayers(preset);
    for (var i = 0; i < keys.length; i += 1) {
      if (hooks.setLayer) hooks.setLayer(keys[i], true);
    }
    // Open the category in the menu so its layers can be switched one by one.
    var group = preset.group && document.getElementById(preset.group);
    if (group) group.open = true;
    flyPreset(preset);
    var host = document.getElementById("cesium");
    if (host) host.dataset.welcomePreset = preset.id;
  }

  // Camera position for the aerial view at a given heading: behind the target along the
  // heading, at the landing height, so the pitch looks straight at the target.
  function aerialPose(headingDeg) {
    var C = root.Cesium;
    var t = INTRO.target;
    var center = C.Cartesian3.fromDegrees(t.lon, t.lat, 0);
    var enu = C.Transforms.eastNorthUpToFixedFrame(center);
    var h = C.Math.toRadians(headingDeg);
    var d = INTRO.altM / Math.tan(C.Math.toRadians(-INTRO.pitch));
    var local = new C.Cartesian3(-d * Math.sin(h), -d * Math.cos(h), INTRO.altM);
    return {
      destination: C.Matrix4.multiplyByPoint(enu, local, new C.Cartesian3()),
      orientation: { heading: h, pitch: C.Math.toRadians(INTRO.pitch), roll: 0 },
    };
  }

  // After landing, the camera circles the city slowly at the same height and tilt.
  function spinStep(now) {
    if (!spinning) return;
    var v = viewer();
    if (v && root.Cesium && spinLast) {
      var dt = Math.min(0.1, (now - spinLast) / 1000);
      orbit.heading = (orbit.heading + INTRO.orbitDegPerSec * dt) % 360;
      v.camera.setView(aerialPose(orbit.heading));
      if (v.scene.requestRender) v.scene.requestRender();
    }
    spinLast = now;
    spinFrame = root.requestAnimationFrame(spinStep);
  }

  function startSpin() {
    if (spinning || reducedMotion() || !viewer() || !intro.landed) return;
    spinning = true;
    spinLast = 0;
    document.body.classList.add("welcome-spin");
    spinFrame = root.requestAnimationFrame(spinStep);
  }

  function stopSpin() {
    if (!spinning) return;
    spinning = false;
    if (spinFrame) root.cancelAnimationFrame(spinFrame);
    spinFrame = 0;
    document.body.classList.remove("welcome-spin");
  }

  // Hand the camera back before a layer or grid test flies somewhere else.
  function releaseCamera() {
    stopSpin();
    endIntro("closed");
    var v = viewer();
    if (v && v.camera) v.camera.cancelFlight();
  }

  // Any touch, drag, click or wheel on the globe hands the camera back right away.
  function watchGlobe(v) {
    var canvas = v && v.scene && v.scene.canvas;
    if (!canvas) return;
    var handBack = function () {
      stopSpin();
      if (intro.phase === "flying") interruptIntro();
    };
    ["pointerdown", "mousedown", "touchstart", "wheel"].forEach(function (type) {
      canvas.addEventListener(type, handBack, { capture: true, passive: true });
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) { close(); return; }
      if (/^Arrow|^[+\-=wasdqe]$/i.test(event.key) && !isOpen()) handBack();
    });
  }

  function endIntro(phase) {
    if (intro.timer) root.clearTimeout(intro.timer);
    intro.timer = 0;
    if (intro.phase === "flying") {
      intro.phase = phase || "done";
      intro.endedAt = root.performance.now();
    }
  }

  // A tap, drag or wheel during the fly-in stops the camera where it is and shows the
  // picker at once, without the spin, so nothing moves under the visitor's hand.
  function interruptIntro() {
    var v = viewer();
    if (v) v.camera.cancelFlight();
    endIntro("interrupted");
    if (!isOpen()) open({ spin: false, noFocus: true });
  }

  function showSpace() {
    var v = viewer();
    var C = root.Cesium;
    if (!v || !C) return false;
    var f = INTRO.from;
    v.camera.cancelFlight();
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(f.lon, f.lat, f.km * 1000),
      orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    });
    return true;
  }

  function playIntro() {
    document.body.classList.add("welcome-open");
    var v = viewer();
    var C = root.Cesium;
    if (!v || !C || !showSpace()) { open({ spin: false, noFocus: true }); return; }
    // Open on the Aerial photo map like God's Eye View. Lighting, atmosphere, terrain
    // and layers stay on the site's normal defaults (no layers on).
    if (typeof hooks.setBasemap === "function" && INTRO.basemap) {
      try { hooks.setBasemap(INTRO.basemap); } catch (e) { /* keep the current map */ }
    }
    var f = INTRO.from;
    intro.phase = "flying";
    intro.startedAt = root.performance.now();
    intro.fromKm = f.km;
    intro.toKm = INTRO.altM / 1000;
    orbit.heading = INTRO.heading;
    var land = aerialPose(INTRO.heading);
    document.body.classList.add("welcome-intro");
    v.camera.flyTo({
      destination: land.destination,
      orientation: land.orientation,
      duration: INTRO.seconds,
      maximumHeight: f.km * 1000,
      easingFunction: C.EasingFunction.QUADRATIC_OUT, // fast drop from space, slow glide into the city
      complete: function () {
        if (intro.phase !== "flying") return;
        endIntro("done");
        intro.landed = true;
        document.body.classList.remove("welcome-intro");
        if (!isOpen()) open({ spin: true, fade: true, noFocus: true });
        else startSpin();
      },
      cancel: function () {
        document.body.classList.remove("welcome-intro");
      },
    });
  }

  // The splash covers the globe. Hold the dive until that picture is gone so the
  // zoom is on screen, then open the picker only when the dive lands.
  function whenSplashClear(fn) {
    var fired = false;
    function go() {
      if (fired) return;
      fired = true;
      fn();
    }
    var splash = document.getElementById("boot-splash");
    if (!splash) { go(); return; }
    root.setTimeout(go, 12000);
    function check() {
      if (fired) return;
      var node = document.getElementById("boot-splash");
      if (!node) { go(); return; }
      if (node.classList.contains("is-done") || node.dataset.done === "1") {
        node.addEventListener("transitionend", function (event) {
          if (event.propertyName === "opacity") go();
        });
        root.setTimeout(go, 800);
        return;
      }
      root.setTimeout(check, 150);
    }
    check();
  }

  function shouldShowOnLoad() {
    if (storeGet()) return false;
    try {
      var params = new URLSearchParams(root.location.search);
      if (params.get("welcome") === "0") return false;
    } catch (e) { /* ignore */ }
    return true;
  }

  function init(opts) {
    opts = opts || {};
    hooks.viewer = opts.viewer || hooks.viewer;
    hooks.setLayer = opts.setLayer || hooks.setLayer;
    hooks.phone = opts.phone || hooks.phone;
    hooks.setBasemap = opts.setBasemap || hooks.setBasemap;
    hooks.openGridTester = opts.openGridTester || hooks.openGridTester;
    hooks.syncGridTester = opts.syncGridTester || hooks.syncGridTester;
    hooks.syncLayers = opts.syncLayers || hooks.syncLayers;
    build();
    var buttons = document.querySelectorAll("[data-welcome-open]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        if (typeof opts.closePanels === "function") opts.closePanels();
        open({ spin: false });
      });
    }
    watchGlobe(viewer());
    if (!shouldShowOnLoad()) return;
    if (reducedMotion()) {
      whenSplashClear(function () { open({ spin: false, noFocus: true }); });
      return;
    }
    if (typeof hooks.setBasemap === "function" && INTRO.basemap) {
      try { hooks.setBasemap(INTRO.basemap); } catch (e) { /* keep the current map */ }
    }
    showSpace();
    whenSplashClear(playIntro);
  }

  root.GsaWelcome = {
    init: init,
    open: open,
    close: close,
    choose: choose,
    isOpen: isOpen,
    isSpinning: function () { return spinning; },
    introState: function () {
      return { phase: intro.phase, startedAt: intro.startedAt, endedAt: intro.endedAt, fromKm: intro.fromKm, toKm: intro.toKm, seconds: INTRO.seconds, landed: intro.landed, city: INTRO.target.name, pitch: INTRO.pitch, altM: INTRO.altM };
    },
    stopSpin: stopSpin,
    releaseCamera: releaseCamera,
    presets: function () { return PRESETS.map(function (p) { return { id: p.id, title: p.title, group: p.group || "", layers: presetLayers(p) }; }); },
    storeKey: STORE_KEY,
  };
})(window);
