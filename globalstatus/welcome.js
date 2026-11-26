// First launch "Choose your first view" picker (GS-47).
// NUKE SIMULATOR comes first, then one row for every sidebar layer category except
// SIMULATORS & GAMES (its only layer is the Nuke Simulator), then EXPLORE MANUALLY.
// A category row turns on every layer in that sidebar group, opens the group in the
// menu, and flies the camera to a matching top-down view. "Don't show this again" is
// kept in localStorage; QUICK VIEWS / VIEWS in the top bar reopens the picker.
// Fresh launches open like God's Eye View: the Aerial photo map, a dive from about
// 24,000 km down to a low view over downtown Austin, the picker fading in as it lands,
// then a slow circle over the city until the visitor picks, closes, or touches the map.
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
    popupAt: 0.82, // fraction of the flight when the picker starts to fade in
    orbitDegPerSec: 1.4, // slow circle over the city after landing
    basemap: "satellite", // Aerial photo (Esri World Imagery), like God's Eye View
  };

  // [west, south, east, north] in degrees for each view.
  var VIEW_US = [-127, 22, -65, 51];
  var VIEW_WORLD = [-168, -48, 150, 72]; // the site's normal startup framing
  var I = {
    nuke: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="9.2" stroke-dasharray="2.4 2.2"/>',
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

  var hooks = { viewer: null, setLayer: null, phone: null, setBasemap: null };
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
    list.innerHTML = row(PRESETS[0], 0) +
      '<p class="welcome-section">ALL CATEGORIES</p><div class="welcome-cats">' +
      cats.map(cat).join("") + "</div>" +
      row(PRESETS[PRESETS.length - 1], 1);
    list.addEventListener("click", function (event) {
      // A tap that stopped the dive must not land on a row of the picker that opened
      // under the same finger, so rows ignore clicks for a moment after opening.
      if (root.performance.now() - openedAt < 450) return;
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
    box.querySelector("[data-welcome-close]").addEventListener("click", function () { close(); });
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
    box.querySelector(".welcome-card").scrollTop = 0;
    var first = box.querySelector(".welcome-row");
    if (first && !(opts && opts.noFocus)) {
      try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    }
    if (opts && opts.spin) startSpin();
  }

  function close() {
    stopSpin();
    endIntro("closed");
    if (!box || box.hidden) return;
    box.hidden = true;
    document.documentElement.classList.remove("welcome-pending");
    document.body.classList.remove("welcome-open");
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
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

  function playIntro() {
    document.body.classList.add("welcome-open");
    var v = viewer();
    var C = root.Cesium;
    if (!v || !C) { open({ spin: false, noFocus: true }); return; }
    // Open on the Aerial photo map like God's Eye View. Lighting, atmosphere, terrain
    // and layers stay on the site's normal defaults (no layers on).
    if (typeof hooks.setBasemap === "function" && INTRO.basemap) {
      try { hooks.setBasemap(INTRO.basemap); } catch (e) { /* keep the current map */ }
    }
    var f = INTRO.from;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(f.lon, f.lat, f.km * 1000),
      orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    });
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
    // Fade the picker in near the end of the dive; the slow circle starts once it lands.
    intro.timer = root.setTimeout(function () {
      intro.timer = 0;
      if (intro.phase === "flying" && !isOpen()) open({ spin: false, fade: true, noFocus: true });
    }, INTRO.seconds * INTRO.popupAt * 1000);
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
    if (reducedMotion()) open({ spin: false, noFocus: true });
    else playIntro();
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
    presets: function () { return PRESETS.map(function (p) { return { id: p.id, title: p.title, group: p.group || "", layers: presetLayers(p) }; }); },
    storeKey: STORE_KEY,
  };
})(window);
