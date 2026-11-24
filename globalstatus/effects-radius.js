/* Global Status effects-radius layer.
 * Will Casey's CEX-62.2 / Glasstone & Dolan calculator, drawn on the
 * existing Cesium globe. Not NUKEMAP, and not the NUCLEAR layer in blast.js.
 */
(function (root) {
  "use strict";

// Published CEX-62.2 coefficients. Input and output units are the report's.
var CEX = {
  surfaceScaledMiles: [-0.1307982, -0.6836211, 0.1091296, -0.0167348],
  airScaledMiles: [0.1292768, -0.7227471, 0.0147366, 0.0135239],
  scaledHeightFeet: [3.2015016, -0.3263444],
  thermalMilesFromQOverW: [-0.0193419, -0.4804553, -0.0055685, 0.0002013],
  firstDegreeCal: [0.3141555, 0.059904, 0.0007636, -0.0002015],
  secondDegreeCal: [0.6025982, 0.0201394, 0.0139640, 0.0008559]
};
var MILES_TO_KM = 1.609344;
var FEET_PER_MILE = 5280;
// 7.06 cal/cm² at 1 kt is the third-degree exposure that equation 2.108
// places at 0.37 miles, the usual tabulated 1 kt radius. Yield dependence
// follows the report's second-degree curve.
var THIRD_DEGREE_AT_1KT = 7.06;

// log10 polynomial used by the CEX-62.2 curve fits: 10^(a0 + a1 log10 x + ...).
function logPoly(x, coeffs) {
  var lx = Math.log(x) / Math.LN10;
  var sum = 0;
  var power = 1;
  for (var i = 0; i < coeffs.length; i++) {
    sum += coeffs[i] * power;
    power *= lx;
  }
  return Math.pow(10, sum);
}

function referenceYield(kt) {
  if (kt > 20000) return { kt: kt / 1000, scale: 10 };
  if (kt < 1) return { kt: kt * 1000, scale: 0.1 };
  return { kt: kt, scale: 1 };
}

function blastMiles(kt, psi, airburst) {
  var ref = referenceYield(kt);
  var coeffs = airburst ? CEX.airScaledMiles : CEX.surfaceScaledMiles;
  var scaled = logPoly(psi, coeffs);
  return scaled * Math.pow(ref.kt, 1 / 3) * ref.scale;
}

function optimumHeightFeet(kt, psi) {
  var ref = referenceYield(kt);
  return logPoly(psi, CEX.scaledHeightFeet) * Math.pow(ref.kt, 1 / 3) * ref.scale;
}

function exposureCal(kt, kind) {
  var ref = referenceYield(kt);
  if (kind === "first") return logPoly(ref.kt, CEX.firstDegreeCal);
  var second = logPoly(ref.kt, CEX.secondDegreeCal);
  if (kind === "second") return second;
  var secondAt1 = logPoly(1, CEX.secondDegreeCal);
  return THIRD_DEGREE_AT_1KT * (second / secondAt1);
}

function thermalSlantMiles(kt, calories, airburst) {
  var ref = referenceYield(kt);
  var divisor = airburst ? ref.kt : 0.7 * ref.kt;
  var ratio = calories / divisor;
  if (!(ratio > 0)) return null;
  return logPoly(ratio, CEX.thermalMilesFromQOverW) * ref.scale;
}

// CEX-62.2 equation 2.116. Slant range in miles from yield (kt) and dose (rem).
function promptSlantMiles(kt, rem) {
  var a = 0.1237561, a_ = 0.0143624;
  var b = 0.0994027, b_ = -0.0000816;
  var c = 0.0011878, c_ = -0.0000014;
  var d = -0.0002481, d_ = 0.0054734;
  var e = 0.0000096, e_ = -0.0003272;
  var f = -0.1308215, f_ = 0.0000106;
  var g = 0.0009881, g_ = -0.0001220;
  var h = -0.0032363, h_ = 0.0000217;
  var i = 0.0000111, i_ = -0.0000006;
  var logI = Math.log(rem) / Math.LN10;
  var logI2 = logI * logI;
  var logI3 = logI2 * logI;
  var logW = Math.log(kt) / Math.LN10;
  var distance = a + (b + a_ * logI + d_ * logI2 + g_ * logI3) * logW;
  distance += (c + b_ * logI + e_ * logI2 + h_ * logI3) * Math.pow(logW, 3);
  distance += (d + c_ * logI + f_ * logI2 + i_ * logI3) * Math.pow(logW, 5);
  distance += e * Math.pow(logW, 7) + f * logI + g * logI2 + h * logI3;
  distance += i * Math.pow(logI, 5);
  return Math.pow(10, distance);
}

// Glasstone & Dolan 2.127. Maximum radius is about twice the breakaway radius.
function fireballMiles(kt, surface) {
  var breakawayFeet = (surface ? 145 : 110) * Math.pow(kt, 0.4);
  return (2 * breakawayFeet) / FEET_PER_MILE;
}

// Glasstone & Dolan 6.09. Apparent crater radius in dry soil, contact burst.
function craterMiles(kt) {
  return (60 * Math.pow(kt, 1 / 3)) / FEET_PER_MILE;
}

function groundFromSlant(slantMiles, heightFeet) {
  var heightMiles = heightFeet / FEET_PER_MILE;
  if (slantMiles <= heightMiles) return 0;
  return Math.sqrt(slantMiles * slantMiles - heightMiles * heightMiles);
}

function formatRadius(miles) {
  if (miles === 0) return "Does not reach the ground";
  if (!(miles > 0) || !isFinite(miles)) return "Outside the published curve";
  var km = miles * MILES_TO_KM;
  var feet = miles * FEET_PER_MILE;
  if (km < 1) {
    return round(km * 1000) + " m  ·  " + round(feet) + " ft";
  }
  return round(km) + " km  ·  " + round(miles) + " mi";
}

function round(n) {
  var abs = Math.abs(n);
  var digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toFixed(digits);
}

function formatYield(kt) {
  var amount = kt;
  var unit = " kilotons";
  if (kt < 1) {
    amount = kt * 1000;
    unit = " tons";
  } else if (kt >= 1000) {
    amount = kt / 1000;
    unit = " megatons";
  }
  var text = Math.abs(amount - Math.round(amount)) < 1e-8 ? String(Math.round(amount)) : round(amount).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return text + unit;
}


  var M_PER_MILE = 1609.344;

  function formatRadiusMiKm(miles) {
    if (miles === 0) return "Does not reach the ground";
    if (!(miles > 0) || !isFinite(miles)) return "Outside the published curve";
    var km = miles * MILES_TO_KM;
    var text = round(miles) + " mi  ·  " + round(km) + " km";
    if (km < 1) text += "  (" + round(km * 1000) + " m)";
    return text;
  }

  function row(name, meaning, miles, group, color) {
    var cls = group ? "group" : "";
    var value = (typeof miles === "string") ? miles : formatRadiusMiKm(miles);
    var swatch = color ? "<span class=\"swatch\" style=\"background:" + color + "\"></span>" : "";
    return "<tr><td class=\"" + cls + "\">" + swatch + name + "</td><td>" + meaning + "</td><td class=\"num\">" + value + "</td></tr>";
  }

  function el(id) {
    return document.getElementById(id);
  }

  function weaponLabelIfCurrent() {
    var select = el("effects-weapon");
    if (!select) return "";
    var opt = select.options[select.selectedIndex];
    if (!opt || !opt.value) return "";
    if (opt.getAttribute("data-amount") !== el("effects-yield").value.trim()) return "";
    if (opt.getAttribute("data-unit") !== el("effects-unit").value) return "";
    return opt.textContent;
  }

  function applyWeapon() {
    var select = el("effects-weapon");
    if (!select) return;
    var opt = select.options[select.selectedIndex];
    if (!opt || !opt.value) return;
    el("effects-yield").value = opt.getAttribute("data-amount");
    el("effects-unit").value = opt.getAttribute("data-unit");
  }

  function markPreset(kt) {
    document.querySelectorAll("#effects-presets .chip").forEach(function (button) {
      var match = Math.abs(Number(button.getAttribute("data-kt")) - kt) < 1e-9;
      button.setAttribute("aria-pressed", match ? "true" : "false");
    });
  }

  function readYieldKt() {
    var raw = Number(el("effects-yield").value);
    var unit = Number(el("effects-unit").value);
    if (!(raw > 0) || !isFinite(raw)) return null;
    return raw * unit;
  }

  function computeEffects(kt, air) {
    var hob = air ? optimumHeightFeet(kt, 5) : 0;
    var weapon = weaponLabelIfCurrent();
    var lead = weapon ? weapon + ". " : "";
    var note;
    if (air) {
      note = lead + "Optimum height for the 5 psi ring is " +
        round(hob * 0.3048) + " m (" + round(hob) + " ft). Blast radii below are already ground ranges at that height. Thermal and radiation radii are ground ranges from the slant range.";
    } else {
      note = lead + "Contact surface burst. Early fallout is a plume, not one of these circles, so it is not listed.";
    }
    var burstLabel = air ? "Airburst, optimum height" : "Contact surface burst";
    var yieldText = formatYield(kt) + " · " + burstLabel;
    var yieldLine = weapon ? weapon + " · " + yieldText : yieldText;

    var html = "";
    var rings = [];
    function addGroup(name, meaning) {
      html += row(name, meaning || "", "", true, "");
    }
    function addRing(name, meaning, miles, color, opacity, stroke) {
      html += row(name, meaning, miles, false, color);
      if (typeof miles === "number" && miles > 0 && isFinite(miles)) {
        rings.push({
          name: name,
          meaning: meaning,
          miles: miles,
          color: color,
          opacity: opacity,
          stroke: stroke || color
        });
      }
    }

    addRing("Fireball", "Maximum luminous fireball. About twice the breakaway radius.", fireballMiles(kt, !air), "#ffe014", 0.92, "#e0b800");
    if (!air) {
      addRing("Crater", "Apparent crater radius in dry soil. Real craters vary with the ground.", craterMiles(kt), "#8d5a32", 0.55, "#6b3f22");
    }

    addGroup("Blast");
    addRing("20 psi", "Heavy damage. Reinforced concrete buildings are destroyed.", blastMiles(kt, 20, air), "#e10600", 0.5, "#b00000");
    addRing("5 psi", "Medium damage. Most houses collapse. This is the usual “blast radius.”", blastMiles(kt, 5, air), "#7a7a7a", 0.42, "#4e4e4e");
    addRing("1 psi", "Light damage. Windows break.", blastMiles(kt, 1, air), "#d0d0d0", 0.72, "#6a6a6a");

    addGroup("Thermal, on the ground", "Clear-air radiant heat. A wall or the curve of the earth blocks it.");
    [
      ["third", "3rd-degree burns", "About a 50% chance of a third-degree burn on bare skin.", "#ff8f1f", 0.48, "#e06a00"],
      ["second", "2nd-degree burns", "About a 50% chance of a second-degree burn on bare skin.", "#ffb04a", 0.4, "#e08920"],
      ["first", "1st-degree burns", "About a 50% chance of a first-degree burn on bare skin.", "#ffd27a", 0.55, "#e0a040"]
    ].forEach(function (item) {
      var slant = thermalSlantMiles(kt, exposureCal(kt, item[0]), air);
      var ground = slant == null ? null : groundFromSlant(slant, hob);
      addRing(item[1], item[2], ground, item[3], item[4], item[5]);
    });

    addGroup("Prompt radiation, on the ground", "Neutrons and gamma rays in the first minute. Not fallout.");
    [
      [1000, "Usually lethal even with medical care.", "#146b2e", 0.5, "#0d4a1f"],
      [500, "Often lethal without medical care.", "#2bd15a", 0.55, "#14913a"],
      [100, "Radiation sickness is likely. Cancer risk rises.", "#8fe7a8", 0.6, "#3aaa62"]
    ].forEach(function (item) {
      var rem = item[0];
      var slant = promptSlantMiles(kt, rem);
      var ground = groundFromSlant(slant, hob);
      addRing(rem + " rem", rem + " rem slant dose. " + item[1], ground, item[2], item[3], item[4]);
    });

    return { kt: kt, air: air, hob: hob, note: note, yieldLine: yieldLine, html: html, rings: rings };
  }

  var viewer = null;
  var source = null;
  var hooks = {};
  var bound = false;
  var active = false;
  var groundZero = null;
  var markerEntity = null;
  var ringEntities = [];
  var lastEffects = null;
  var positioned = false;
  // Every submitted test stays on the map as its own blast with its own
  // entities and results. currentBlast is the one tied to the current ground
  // zero (re-submitting there updates it); shownBlast is the one in the popup.
  var blasts = [];
  var blastSeq = 0;
  var currentBlast = null;
  var shownBlast = null;

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 800px)").matches;
  }

  function setNote(text) {
    var note = el("effects-note");
    if (note) note.textContent = text;
  }

  function updateLede() {
    var lede = el("effects-lede");
    if (!lede) return;
    if (!groundZero) {
      lede.textContent = "Tap the globe to choose ground zero, then pick a weapon or type a yield and press Launch Nuke.";
    } else {
      lede.textContent = "Ground zero set. Adjust the settings and press Launch Nuke. Tap a new spot to move it.";
    }
  }

  function hidePopup() {
    var popup = el("effects-results");
    shownBlast = null;
    if (!popup) return;
    popup.hidden = true;
    popup.classList.remove("mobile-sheet");
    var hud = el("effects-hud");
    if (hud && active) hud.hidden = false;
  }

  function removeEntities(list) {
    if (!source) return;
    list.forEach(function (entity) {
      try { source.entities.remove(entity); } catch (err) {}
    });
  }

  function rebuildRingList() {
    ringEntities = [];
    blasts.forEach(function (blast) {
      ringEntities = ringEntities.concat(blast.entities);
    });
    lastEffects = blasts.length ? blasts[blasts.length - 1].effects : null;
    if (typeof hooks.setCount === "function") hooks.setCount("effects", blasts.length);
  }

  function removeBlast(blast) {
    removeEntities(blast.entities);
    if (blast.marker) removeEntities([blast.marker]);
    blasts = blasts.filter(function (b) { return b !== blast; });
    if (currentBlast === blast) currentBlast = null;
    if (shownBlast === blast) shownBlast = null;
    rebuildRingList();
  }

  function clearRings() {
    blasts.slice().forEach(function (blast) {
      removeEntities(blast.entities);
      if (blast.marker) removeEntities([blast.marker]);
    });
    blasts = [];
    currentBlast = null;
    shownBlast = null;
    rebuildRingList();
  }

  function clearMarker() {
    if (source && markerEntity) {
      try { source.entities.remove(markerEntity); } catch (err) {}
    }
    markerEntity = null;
    groundZero = null;
  }

  function clearAll() {
    if (typeof cancelLaunch === "function") cancelLaunch();
    clearRings();
    clearMarker();
    hidePopup();
    updateLede();
    if (typeof hooks.statusLive === "function") hooks.statusLive();
  }

  function circlePositions(lon, lat, miles) {
    var R = 3958.8, n = 128, d = miles / R;
    var la = lat * Math.PI / 180, lo = lon * Math.PI / 180, pts = [];
    for (var i = 0; i < n; i++) {
      var brg = 2 * Math.PI * i / n;
      var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(brg));
      var lo2 = lo + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      pts.push(Cesium.Cartesian3.fromRadians(lo2, la2));
    }
    return pts;
  }

  function colorMaterial(css, opacity) {
    var color = Cesium.Color.fromCssColorString(css);
    return color.withAlpha(opacity);
  }

  function markerOptions(position, text, id) {
    return {
        id: id,
        position: position,
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString("#d31212"),
          outlineColor: Cesium.Color.fromCssColorString("#7a1010"),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: text,
          font: "14px IBM Plex Mono, monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    };
  }

  function setGroundZero(lon, lat) {
    if (!active || !source || typeof Cesium === "undefined") return;
    groundZero = { lon: lon, lat: lat };
    currentBlast = null;
    var position = Cesium.Cartesian3.fromDegrees(lon, lat);
    if (markerEntity) {
      markerEntity.position = position;
    } else {
      markerEntity = source.entities.add(markerOptions(position, "Ground zero", "effects-ground-zero"));
    }
    updateLede();
  }

  // Frame the largest ring for a blast at gz.
  function flyToEffects(gz, effects) {
    if (!viewer || !gz || !effects || !effects.rings || !effects.rings.length) return;
    var largestMiles = 0;
    effects.rings.forEach(function (ring) { if (ring.miles > largestMiles) largestMiles = ring.miles; });
    if (!(largestMiles > 0)) return;
    var latRad = gz.lat * Math.PI / 180;
    var pad = largestMiles * 1.2;
    var dLat = pad / 69;
    var dLon = pad / (69 * Math.max(0.2, Math.cos(latRad)));
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        gz.lon - dLon * 1.25,
        gz.lat - dLat * 1.2,
        gz.lon + dLon * 1.55,
        gz.lat + dLat * 1.2
      ),
      duration: 1.35
    });
  }

  function drawRingsOnGlobe(effects, skipFly) {
    if (!groundZero || !source || typeof Cesium === "undefined") return null;
    // Re-submitting at the same ground zero updates that blast in place.
    // A new spot adds a new blast and keeps every earlier one on the map.
    if (currentBlast) removeBlast(currentBlast);
    blastSeq += 1;
    var blast = {
      id: blastSeq,
      groundZero: { lon: groundZero.lon, lat: groundZero.lat },
      effects: effects,
      entities: [],
      marker: null
    };
    var base = blastSeq * 32;
    var ordered = effects.rings.slice().sort(function (a, b) { return b.miles - a.miles; });
    var ascending = ordered.slice().reverse();
    // Each ring is drawn as a band from the next smaller ring out to its own
    // radius, so bands never overlap and every color matches the popup dot.
    ascending.forEach(function (ring, index) {
      if (!(ring.miles > 0) || !isFinite(ring.miles)) return;
      var inner = 0;
      for (var k = index - 1; k >= 0; k--) {
        if (ascending[k].miles > 0 && ascending[k].miles < ring.miles) { inner = ascending[k].miles; break; }
      }
      var outerPts = circlePositions(groundZero.lon, groundZero.lat, ring.miles);
      var hierarchy = inner > 0
        ? new Cesium.PolygonHierarchy(outerPts, [new Cesium.PolygonHierarchy(circlePositions(groundZero.lon, groundZero.lat, inner))])
        : new Cesium.PolygonHierarchy(outerPts);
      var band = source.entities.add({
        name: ring.name,
        polygon: {
          hierarchy: hierarchy,
          material: colorMaterial(ring.color, Math.max(ring.opacity, 0.6)),
          classificationType: Cesium.ClassificationType.BOTH,
          zIndex: base + index
        }
      });
      band._effectsBlast = blast;
      blast.entities.push(band);
      var edge = source.entities.add({
        name: ring.name + " edge",
        polyline: {
          positions: outerPts.concat([outerPts[0]]),
          width: 2,
          clampToGround: true,
          material: colorMaterial(ring.stroke, 0.95),
          zIndex: base + index
        }
      });
      edge._effectsBlast = blast;
      blast.entities.push(edge);
    });
    // The pending ground-zero pin becomes this blast's own marker.
    var markerText = "Ground zero · " + formatYield(effects.kt);
    if (markerEntity) {
      source.entities.remove(markerEntity);
      markerEntity = null;
    }
    blast.marker = source.entities.add(markerOptions(
      Cesium.Cartesian3.fromDegrees(blast.groundZero.lon, blast.groundZero.lat),
      markerText,
      "effects-ground-zero-" + blast.id
    ));
    blast.marker._effectsBlast = blast;
    blasts.push(blast);
    currentBlast = blast;
    rebuildRingList();
    if (!skipFly) flyToEffects(blast.groundZero, effects);
    if (typeof hooks.statusLive === "function") hooks.statusLive();
    return blast;
  }

  function positionPopup() {
    var popup = el("effects-results");
    if (!popup || popup.hidden || !viewer) return;
    if (isMobile()) {
      popup.classList.add("mobile-sheet");
      popup.style.left = "";
      popup.style.top = "";
      popup.style.transform = "";
      return;
    }
    popup.classList.remove("mobile-sheet");
    var host = document.getElementById("cesium") || document.querySelector(".stage");
    var rect = host ? host.getBoundingClientRect() : { left: 12, top: 12, right: window.innerWidth - 12, bottom: window.innerHeight - 12, width: window.innerWidth, height: window.innerHeight };
    var w = popup.offsetWidth || 420;
    var h = popup.offsetHeight || 280;
    var pad = 12;
    var maxY = rect.bottom - Math.min(h, rect.height - 24) - pad;
    var x = rect.right - w - pad;
    var y = rect.top + pad;
    var anchor = shownBlast ? shownBlast.groundZero : groundZero;
    if (anchor) {
      var cartesian = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat);
      var pos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
      if (pos && isFinite(pos.x) && isFinite(pos.y)) {
        y = Math.max(rect.top + pad, Math.min(pos.y - 36, maxY));
      }
    }
    x = Math.max(rect.left + pad, Math.min(x, rect.right - w - pad));
    y = Math.max(rect.top + pad, Math.min(y, maxY));
    popup.style.left = Math.round(x) + "px";
    popup.style.top = Math.round(y) + "px";
    popup.style.transform = "none";
  }

  function showResults(effects, blast) {
    var yieldLine = el("effects-yield-line");
    var popupNote = el("effects-popup-note");
    var rows = el("effects-rows");
    var popup = el("effects-results");
    if (yieldLine) yieldLine.textContent = effects.yieldLine;
    if (popupNote) popupNote.textContent = effects.note;
    if (rows) rows.innerHTML = effects.html;
    if (!popup) return;
    shownBlast = blast || null;
    popup.hidden = false;
    // The results open where the settings panel sits, so close the settings.
    var hud = el("effects-hud");
    if (hud) hud.hidden = true;
    if (isMobile()) popup.classList.add("mobile-sheet");
    positionPopup();
  }

  // ---- Launch sounds -------------------------------------------------------
  // Launch Nuke plays the alarm, then the detonation. The rings and results
  // appear when the detonation starts. Tap the indicator or press Escape to
  // skip the alarm. Muted, missing, or blocked audio shows the rings at once.
  var SOUND_KEY = "gsa-nuke-sound";
  var SOUND_URLS = { alarm: "sounds/nuke-alarm.mp3", blast: "sounds/nuke-blast.mp3" };
  var sounds = { alarm: null, blast: null };
  var launch = null;
  var launchSeq = 0;

  function isMuted() {
    try { return window.localStorage.getItem(SOUND_KEY) === "off"; } catch (err) { return false; }
  }

  function setMuted(on) {
    try { window.localStorage.setItem(SOUND_KEY, on ? "off" : "on"); } catch (err) {}
    if (on) {
      stopSound("blast");
      if (launch && launch.phase === "alarm") skipLaunch();
    }
    updateSoundChip();
  }

  function updateSoundChip() {
    var chip = el("effects-sound");
    if (!chip) return;
    var muted = isMuted();
    chip.textContent = muted ? "Sound off" : "Sound on";
    chip.setAttribute("aria-pressed", muted ? "false" : "true");
    chip.setAttribute("aria-label", muted ? "Launch sounds are off. Turn them on." : "Launch sounds are on. Turn them off.");
  }

  function getSound(name) {
    if (sounds[name] || typeof Audio === "undefined") return sounds[name];
    try {
      var audio = new Audio();
      audio.preload = "auto";
      audio.src = SOUND_URLS[name];
      audio.load();
      sounds[name] = audio;
    } catch (err) {
      sounds[name] = null;
    }
    return sounds[name];
  }

  function stopSound(name) {
    var audio = sounds[name];
    if (!audio) return;
    try { audio.pause(); audio.currentTime = 0; } catch (err) {}
  }

  function playSound(name) {
    if (isMuted()) return Promise.reject(new Error("muted"));
    var audio = getSound(name);
    if (!audio) return Promise.reject(new Error("no audio"));
    try {
      audio.currentTime = 0;
      var result = audio.play();
      return result && typeof result.then === "function" ? result : Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function launchIndicator() {
    var box = el("effects-launching");
    if (box) return box;
    box = document.createElement("button");
    box.type = "button";
    box.id = "effects-launching";
    box.className = "effects-launching";
    box.hidden = true;
    box.innerHTML = "<span class=\"effects-launching-dot\" aria-hidden=\"true\"></span><span id=\"effects-launching-text\">Launching… tap to skip</span>";
    box.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      skipLaunch();
    });
    var host = document.querySelector(".stage") || document.body;
    host.appendChild(box);
    return box;
  }

  function showIndicator(on, text) {
    var box = on ? launchIndicator() : el("effects-launching");
    if (!box) return;
    if (on) {
      var label = el("effects-launching-text");
      if (label) label.textContent = text || "Launching… tap to skip";
    }
    box.hidden = !on;
  }

  function clearLaunchTimers(job) {
    if (!job) return;
    clearTimeout(job.loadTimer);
    clearTimeout(job.endTimer);
    clearTimeout(job.gifLoadTimer);
    clearTimeout(job.gifTimer);
    if (job.alarm && job.onEnded) {
      job.alarm.removeEventListener("ended", job.onEnded);
      job.alarm.removeEventListener("error", job.onEnded);
    }
  }

  // ---- Explosion GIF --------------------------------------------------------
  // When the blast sound starts, the mushroom cloud plays once with its base
  // on ground zero. When it ends it is removed and the rings are drawn.
  // Browsers loop or cache GIF animations, so the timing is driven here and
  // every launch gets a fresh object URL so the GIF starts from frame 1.
  var GIF_URL = "images/nuke-blast.gif";
  var GIF_MS = 2800;          // total frame time of images/nuke-blast.gif
  var GIF_BASE_Y = 0.96;      // the cloud's base, as a fraction of the image height
  var GIF_ASPECT = 415 / 600; // width / height
  var gifBlob = null;
  var gifFailed = false;
  var gifLoading = null;

  function preloadGif() {
    if (gifBlob || gifLoading || gifFailed) return;
    if (typeof fetch !== "function" || typeof URL === "undefined" || !URL.createObjectURL) return;
    gifLoading = fetch(GIF_URL).then(function (response) {
      if (!response.ok) throw new Error("GIF " + response.status);
      return response.blob();
    }).then(function (blob) {
      gifBlob = blob;
    }).catch(function () {
      gifFailed = true;
    }).then(function () {
      gifLoading = null;
    });
  }

  function gifHeight() {
    var canvas = viewer && viewer.scene && viewer.scene.canvas;
    var h = canvas ? canvas.clientHeight : window.innerHeight;
    return Math.round(Math.max(150, Math.min(440, h * 0.5)));
  }

  function positionGif() {
    var job = launch;
    if (!job || job.phase !== "gif" || !job.img || !viewer) return;
    var img = job.img;
    var pos = null;
    try {
      pos = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene, Cesium.Cartesian3.fromDegrees(job.gz.lon, job.gz.lat));
    } catch (err) { pos = null; }
    if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) {
      img.style.visibility = "hidden";
      return;
    }
    var rect = viewer.scene.canvas.getBoundingClientRect();
    var h = gifHeight();
    var w = Math.round(h * GIF_ASPECT);
    img.style.height = h + "px";
    img.style.width = w + "px";
    img.style.left = Math.round(rect.left + pos.x - w / 2) + "px";
    img.style.top = Math.round(rect.top + pos.y - h * GIF_BASE_Y) + "px";
    if (job.gifReady) img.style.visibility = "visible";
  }

  function removeGif(job) {
    if (!job || !job.img) return;
    var img = job.img;
    job.img = null;
    img.onload = null;
    img.onerror = null;
    if (img.parentNode) img.parentNode.removeChild(img);
    if (job.gifUrl && job.gifUrl.indexOf("blob:") === 0) {
      try { URL.revokeObjectURL(job.gifUrl); } catch (err) {}
    }
  }

  // Stop a launch before its rings are drawn: no rings, no sound, no GIF.
  function cancelLaunch() {
    if (!launch) return false;
    var job = launch;
    launch = null;
    clearLaunchTimers(job);
    stopSound("alarm");
    if (job.phase === "gif") stopSound("blast");
    removeGif(job);
    showIndicator(false);
    return true;
  }

  // The GIF is done (or skipped, or could not load): draw the rings.
  function finishLaunch(job) {
    if (!job || launch !== job) return;
    launch = null;
    clearLaunchTimers(job);
    removeGif(job);
    showIndicator(false);
    var blast = drawRingsOnGlobe(job.effects, true);
    showResults(job.effects, blast);
  }

  // Detonate: stop the alarm, start the blast sound, and play the GIF.
  function detonate(job) {
    if (!job || launch !== job || job.phase !== "alarm") return;
    clearLaunchTimers(job);
    stopSound("alarm");
    job.phase = "gif";
    if (!isMuted()) playSound("blast").catch(function () {});
    flyToEffects(job.gz, job.effects);
    if (gifFailed || typeof document === "undefined") {
      finishLaunch(job);
      return;
    }
    showIndicator(true, "Detonation… tap to skip");
    var img = document.createElement("img");
    img.className = "effects-gif";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.draggable = false;
    img.style.visibility = "hidden";
    img.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      skipLaunch();
    });
    img.onload = function () {
      if (launch !== job) return;
      clearTimeout(job.gifLoadTimer);
      job.gifReady = true;
      positionGif();
      job.gifTimer = setTimeout(function () { finishLaunch(job); }, GIF_MS);
    };
    img.onerror = function () {
      gifFailed = !gifBlob;
      finishLaunch(job);
    };
    job.img = img;
    job.gifUrl = gifBlob ? URL.createObjectURL(gifBlob) : GIF_URL + "?play=" + job.id;
    // A GIF that has not loaded in 4 s is skipped.
    job.gifLoadTimer = setTimeout(function () { finishLaunch(job); }, 4000);
    document.body.appendChild(img);
    positionGif();
    img.src = job.gifUrl;
  }

  function skipLaunch() {
    if (!launch) return;
    if (launch.phase === "alarm") detonate(launch);
    else finishLaunch(launch);
  }

  function startLaunch(effects) {
    cancelLaunch();
    var hud = el("effects-hud");
    if (hud) hud.hidden = true;
    var popup = el("effects-results");
    if (popup && !popup.hidden) {
      popup.hidden = true;
      popup.classList.remove("mobile-sheet");
      shownBlast = null;
    }
    launchSeq += 1;
    var job = {
      id: launchSeq,
      phase: "alarm",
      effects: effects,
      gz: { lon: groundZero.lon, lat: groundZero.lat },
      alarm: null, onEnded: null, loadTimer: 0, endTimer: 0,
      img: null, gifUrl: "", gifReady: false, gifLoadTimer: 0, gifTimer: 0
    };
    launch = job;
    if (isMuted()) {
      detonate(job);
      return job;
    }
    var alarm = getSound("alarm");
    // Already failed to load (for example a 404): do not wait for it.
    if (!alarm || alarm.error || alarm.networkState === 3) {
      detonate(job);
      return job;
    }
    job.alarm = alarm;
    job.onEnded = function () { detonate(job); };
    alarm.addEventListener("ended", job.onEnded);
    alarm.addEventListener("error", job.onEnded);
    showIndicator(true);
    // If the alarm has not started within 5 s, stop waiting for it.
    job.loadTimer = setTimeout(function () { detonate(job); }, 5000);
    playSound("alarm").then(function () {
      if (launch !== job) return;
      clearTimeout(job.loadTimer);
      // Safety net in case "ended" never arrives.
      var seconds = isFinite(alarm.duration) && alarm.duration > 0 ? alarm.duration : 12;
      job.endTimer = setTimeout(function () { detonate(job); }, (seconds + 2) * 1000);
    }).catch(function () {
      detonate(job);
    });
    return job;
  }

  function submitCalc() {
    var kt = readYieldKt();
    var burst = el("effects-burst");
    var air = !burst || burst.value === "air";
    if (kt === null) {
      setNote("Enter a yield greater than zero.");
      hidePopup();
      if (typeof hooks.statusLive === "function") hooks.statusLive();
      return false;
    }
    if (!groundZero) {
      setNote("Tap the globe to choose ground zero first.");
      return false;
    }
    var effects = computeEffects(kt, air);
    setNote(effects.note);
    markPreset(kt);
    startLaunch(effects);
    return true;
  }

  function blastAt(position) {
    if (!viewer || !position) return null;
    var picked;
    try { picked = viewer.scene.pick(position); } catch (err) { return null; }
    if (!picked) return null;
    var entity = picked.id || (picked.primitive && picked.primitive.id);
    if (entity && entity._effectsBlast && blasts.indexOf(entity._effectsBlast) !== -1) {
      return entity._effectsBlast;
    }
    return null;
  }

  // Reopen an earlier blast's own results and make it the current test,
  // so changing the settings and pressing Launch Nuke updates that blast.
  function openBlast(blast) {
    if (!blast) return false;
    cancelLaunch();
    if (markerEntity) {
      try { source.entities.remove(markerEntity); } catch (err) {}
      markerEntity = null;
    }
    groundZero = { lon: blast.groundZero.lon, lat: blast.groundZero.lat };
    currentBlast = blast;
    setNote(blast.effects.note);
    markPreset(blast.effects.kt);
    updateLede();
    showResults(blast.effects, blast);
    return true;
  }

  function handleClick(position) {
    if (!active || !viewer) return false;
    var hit = blastAt(position);
    if (hit) return openBlast(hit);
    var cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    if (!cartesian) return false;
    var carto = Cesium.Cartographic.fromCartesian(cartesian);
    // A new spot cancels a launch in progress, closes the last results and
    // brings the settings back.
    cancelLaunch();
    hidePopup();
    setGroundZero(
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude)
    );
    return true;
  }

  function setActive(on) {
    active = Boolean(on);
    var hud = el("effects-hud");
    if (hud) hud.hidden = !active;
    if (!active) {
      cancelLaunch();
      stopSound("blast");
      clearAll();
      setNote("Pick a weapon or type a yield, then press Launch Nuke.");
    } else {
      updateLede();
    }
    if (source) source.show = active;
  }

  function bind(opts) {
    opts = opts || {};
    viewer = opts.viewer || viewer;
    source = opts.source || source;
    hooks.setCount = opts.setCount || hooks.setCount;
    hooks.statusLive = opts.statusLive || hooks.statusLive;
    if (bound) return;
    bound = true;
    var weapon = el("effects-weapon");
    var form = el("effects-calc");
    var presets = el("effects-presets");
    var closeBtn = el("effects-close");
    if (weapon) weapon.addEventListener("change", applyWeapon);
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitCalc();
      });
    }
    if (presets) {
      presets.addEventListener("click", function (event) {
        var button = event.target.closest("button");
        if (!button) return;
        el("effects-yield").value = button.getAttribute("data-kt");
        el("effects-unit").value = "1";
        el("effects-weapon").value = "";
        if (groundZero) submitCalc();
        else markPreset(Number(button.getAttribute("data-kt")));
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", hidePopup);
    var goBtn = el("effects-go");
    if (goBtn && /^\s*submit\s*$/i.test(goBtn.textContent)) goBtn.textContent = "Launch Nuke";
    var hudBox = el("effects-hud");
    var chip = el("effects-sound");
    if (!chip && hudBox) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.id = "effects-sound";
      chip.className = "effects-sound";
      var title = hudBox.querySelector("h2");
      if (title && title.nextSibling) hudBox.insertBefore(chip, title.nextSibling);
      else hudBox.appendChild(chip);
    }
    if (chip) {
      chip.addEventListener("click", function () { setMuted(!isMuted()); });
      updateSoundChip();
    }
    getSound("alarm");
    getSound("blast");
    preloadGif();
    document.addEventListener("keydown", function (event) {
      if (launch && (event.key === "Escape" || event.key === "Esc")) {
        event.preventDefault();
        skipLaunch();
      }
    });
    setNote("Pick a weapon or type a yield, then press Launch Nuke.");
    updateLede();
    window.addEventListener("resize", positionPopup);
    if (viewer && viewer.scene) {
      viewer.scene.postRender.addEventListener(positionPopup);
      viewer.scene.postRender.addEventListener(positionGif);
      window.addEventListener("resize", positionGif);
      // The site's click handler ignores clicks on map entities, so clicks on
      // an earlier blast's rings or marker are handled here.
      var blastClicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      blastClicks.setInputAction(function (click) {
        if (!active) return;
        var hit = blastAt(click.position);
        if (!hit) return;
        openBlast(hit);
        if (viewer.selectedEntity && viewer.selectedEntity._effectsBlast) viewer.selectedEntity = undefined;
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
  }

  function hasResult() {
    return blasts.length > 0;
  }

  function setInputs(amount, unit, burst) {
    if (el("effects-yield")) el("effects-yield").value = String(amount);
    if (el("effects-unit")) el("effects-unit").value = String(unit);
    if (el("effects-burst")) el("effects-burst").value = burst;
    if (el("effects-weapon")) el("effects-weapon").value = "";
  }

  root.GsaEffectsRadius = {
    logPoly: logPoly,
    CEX: CEX,
    MILES_TO_KM: MILES_TO_KM,
    FEET_PER_MILE: FEET_PER_MILE,
    THIRD_DEGREE_AT_1KT: THIRD_DEGREE_AT_1KT,
    referenceYield: referenceYield,
    blastMiles: blastMiles,
    optimumHeightFeet: optimumHeightFeet,
    exposureCal: exposureCal,
    thermalSlantMiles: thermalSlantMiles,
    promptSlantMiles: promptSlantMiles,
    fireballMiles: fireballMiles,
    craterMiles: craterMiles,
    groundFromSlant: groundFromSlant,
    formatRadius: formatRadius,
    formatYield: formatYield,
    computeEffects: computeEffects,
    bind: bind,
    setActive: setActive,
    handleClick: handleClick,
    clear: clearAll,
    setGroundZero: setGroundZero,
    submit: submitCalc,
    setInputs: setInputs,
    getGroundZero: function () { return groundZero; },
    getLastEffects: function () { return lastEffects; },
    getRingEntities: function () { return ringEntities.slice(); },
    getBlasts: function () { return blasts.slice(); },
    isLaunching: function () { return Boolean(launch); },
    getLaunchPhase: function () { return launch ? launch.phase : ""; },
    gifUrl: GIF_URL,
    gifMs: GIF_MS,
    skipLaunch: skipLaunch,
    cancelLaunch: cancelLaunch,
    isMuted: isMuted,
    setMuted: setMuted,
    soundUrls: SOUND_URLS,
    getSounds: function () { return sounds; },
    getShownBlast: function () { return shownBlast; },
    openBlast: openBlast,
    hasResult: hasResult,
    isActive: function () { return active; }
  };
})(typeof window !== "undefined" ? window : globalThis);
