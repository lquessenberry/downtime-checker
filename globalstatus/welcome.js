// First launch "Choose your first view" picker (GS-47).
// Shows over a slowly turning globe on a visitor's first load. Each preset turns on a
// set of existing layers and flies the camera to a matching view. "Don't show this
// again" is kept in localStorage; the VIEWS button in the top bar reopens the picker.
// The globe stops turning the moment the visitor picks, closes, or touches the globe.
// Fresh launches open with a dive from space down to a tilted, low aerial view over
// Washington, DC on the Aerial photo map; the picker fades in as it lands and the camera
// then circles the city slowly until the visitor picks, closes, or touches the map.
(function (root) {
  "use strict";

  var STORE_KEY = "gsa_welcome_dismissed";
  // Opening dive: straight down over North America, then a tilted landing over the
  // National Mall. The camera sits behind the target along its heading, so it looks
  // ahead across the city toward the horizon like a plane or drone.
  var INTRO = {
    from: { lon: -96, lat: 38, km: 22000 },
    target: { lon: -77.0365, lat: 38.8895, name: "Washington, DC" },
    heading: 20, // degrees, looking north-northeast up the Mall
    pitch: -35, // degrees below the horizon
    altM: 5200, // camera height above the ground in meters
    seconds: 3.2,
    popupAt: 0.82, // fraction of the flight when the picker starts to fade in
    orbitDegPerSec: 1.6, // slow circle around the city after landing
  };

  // [west, south, east, north] in degrees for each view.
  var VIEW_US = [-127, 22, -65, 51];
  var PRESETS = [
    {
      id: "nuke",
      title: "NUKE SIMULATOR",
      sub: "Interactive blast radius and fallout simulator",
      layers: ["effects"],
      view: [-128, 18, -62, 54],
      // Phones: the simulator panel covers the lower half, so the US sits higher on screen.
      phoneView: [-132, -8, -60, 56],
      icon: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="9.2" stroke-dasharray="2.4 2.2"/>',
    },
    {
      id: "power",
      title: "POWER & OUTAGES",
      sub: "Live US power outages and global internet disruptions",
      layers: ["outages", "inetusa", "inetglobal"],
      view: [-130, 8, 5, 62],
      icon: '<path d="M13 2.5 5.5 13.2h5.2L9.8 21.5l8.7-11.3h-5.4z" stroke-linejoin="round"/>',
    },
    {
      id: "traffic",
      title: "AIR & SEA TRAFFIC",
      sub: "Live aircraft, maritime vessels, FAA TFRs and flight delays",
      layers: ["aircraft", "ships", "tfr", "delays"],
      view: VIEW_US,
      icon: '<path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5v2l7.5-2.3v3.6L8.5 20.3v1.2l3.5-.9 3.5.9v-1.2l-2-1.5v-3.6l7.5 2.3z" stroke-linejoin="round"/>',
    },
    {
      id: "weather",
      title: "WEATHER & DISASTERS",
      sub: "Live radar, US weather alerts, global earthquakes and wildfires",
      layers: ["radar", "nwsalerts", "quakes", "wildfires"],
      view: [-168, 5, -48, 74],
      icon: '<path d="M7 17.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.6A3.3 3.3 0 0 0 7 17.5z" stroke-linejoin="round"/><path d="m12.5 18.5-1.6 3.2" stroke-linecap="round"/>',
    },
    {
      id: "safety",
      title: "EMERGENCY & SAFETY",
      sub: "USA hospitals, trauma centers, police, fire and air quality",
      layers: ["hospitals", "police", "fire", "airquality"],
      view: VIEW_US,
      icon: '<path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.5 7.5 10 4.4-1.5 7.5-5.4 7.5-10V5.6z" stroke-linejoin="round"/><path d="M12 8.2v6.4M8.8 11.4h6.4" stroke-linecap="round"/>',
    },
    {
      id: "manual",
      title: "EXPLORE MANUALLY",
      sub: "Begin with a clean globe",
      layers: [],
      view: null,
      icon: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5z" stroke-linejoin="round"/>',
    },
  ];

  var hooks = { viewer: null, setLayer: null, phone: null, setBasemap: null };
  var orbit = { heading: 0 };
  var box = null;
  var spinning = false;
  var spinFrame = 0;
  var spinLast = 0;
  var lastFocus = null;
  var intro = { phase: "none", startedAt: 0, endedAt: 0, timer: 0, fromKm: 0, toKm: 0, landed: false };

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

  function build() {
    if (box) return box;
    box = document.getElementById("welcome");
    if (!box) return null;
    var list = box.querySelector("[data-welcome-list]");
    list.innerHTML = PRESETS.map(function (p, i) {
      return '<button type="button" class="welcome-row' + (i === 0 ? " is-primary" : "") + '" data-welcome-preset="' + p.id + '">' +
        '<span class="welcome-icon">' + svg(p.icon) + "</span>" +
        '<span class="welcome-text"><strong>' + p.title.replace(/&/g, "&amp;") + "</strong><em>" + p.sub + "</em></span>" +
        '<span class="welcome-arrow" aria-hidden="true">→</span></button>';
    }).join("");
    list.addEventListener("click", function (event) {
      var row = event.target.closest("[data-welcome-preset]");
      if (row) choose(row.dataset.welcomePreset);
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
    document.body.classList.remove("welcome-open");
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  function viewer() {
    return typeof hooks.viewer === "function" ? hooks.viewer() : hooks.viewer;
  }

  function choose(id) {
    var preset = PRESETS.filter(function (p) { return p.id === id; })[0];
    stopSpin();
    close();
    if (!preset) return;
    for (var i = 0; i < preset.layers.length; i += 1) {
      if (hooks.setLayer) hooks.setLayer(preset.layers[i], true);
    }
    var v = viewer();
    if (preset.view && v && root.Cesium) {
      var phone = typeof hooks.phone === "function" && hooks.phone();
      var r = phone && preset.phoneView ? preset.phoneView : preset.view;
      v.camera.cancelFlight();
      // Always level out to the usual top-down framing, even from the tilted aerial view.
      v.camera.flyTo({
        destination: root.Cesium.Rectangle.fromDegrees(r[0], r[1], r[2], r[3]),
        orientation: { heading: 0, pitch: -root.Cesium.Math.PI_OVER_TWO, roll: 0 },
        duration: intro.landed ? 2.8 : 2.2,
      });
    }
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
    var v = viewer();
    var C = root.Cesium;
    if (!v || !C) { open({ spin: false, noFocus: true }); return; }
    // Land on real aerial streets and buildings: switch the MAP to Aerial photo.
    if (typeof hooks.setBasemap === "function") {
      try { hooks.setBasemap("satellite"); } catch (e) { /* keep the current map */ }
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
    presets: PRESETS.map(function (p) { return { id: p.id, title: p.title, layers: p.layers.slice() }; }),
    storeKey: STORE_KEY,
  };
})(window);
