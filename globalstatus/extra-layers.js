/* Global Status · EXTRA LAYERS core
 *
 * Builds the sidebar for every layer in window.GSX_REGISTRY (extra-layers-registry.js):
 * four new categories and collapsible sub-groups inside each category. welcome.js
 * (the LAYERS picker people actually open) reads these groups from the page, shows the
 * sub-groups with their switches, and has the one search box for every layer.
 *
 * Toggles use data-xl-toggle, so cesium.js / welcome.js handlers for
 * data-layer-toggle never see them. Loaders register by kind:
 *   pack         custom-packs-loader.js     (static open-data pins, layers-data/pack-N.json)
 *   wmts/wms/arcgis/arcgis-image  satellite-imagery-loader.js
 *   points/shapes/lines           live-feeds-loader.js
 *
 * Pins are Cesium point primitives. Cards reuse the shared #selected card (close ×,
 * scrollable body) and are plain text only: no links of any kind.
 */
(function (root) {
  const REG = root.GSX_REGISTRY || { layers: [], newGroups: [] };
  const byKey = new Map(REG.layers.map((l) => [l.key, l]));
  const loaders = {};
  const st = {}; // key -> { on, loading, ready, error, token, count, handle }
  let ctx = null;

  const URLISH = /(https?:\/\/|www\.)\S*|tel:\S*/gi;
  function plain(v) {
    return String(v == null ? "" : v).replace(/<[^>]*>/g, " ").replace(URLISH, "").replace(/\s+/g, " ").trim();
  }
  function esc(v) {
    return plain(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function S(key) { return st[key] || (st[key] = { on: false, loading: false, ready: false, error: "", token: 0, count: null, handle: null }); }

  // ------------------------------------------------------------------ sidebar
  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }

  function ensureGroup(id, label) {
    let g = document.getElementById("group-" + id);
    if (g) return g;
    g = el("details", { class: "layer-group gsx-new", id: "group-" + id, "data-layer-group": id },
      `<summary class="layer-group-head"><span>${esc(label).replace(/&amp;/g, "&amp;")}</span><em class="layer-group-count"></em></summary>`);
    const before = document.getElementById("group-militias") || document.getElementById("btn-reset");
    before.parentNode.insertBefore(g, before);
    return g;
  }

  function buttonHtml(L) {
    const imagery = /^(wmts|wms|arcgis|arcgis-image)$/.test(L.kind);
    const sw = imagery ? "gsx-swatch gsx-img" : "gsx-swatch";
    const style = imagery ? "" : ` style="background:${esc(L.color || "#9fd4e2")}"`;
    return `<button type="button" class="layer gsx-layer" data-xl-toggle="${esc(L.key)}" aria-pressed="false" title="${esc(L.desc || "")}">` +
      `<span class="layer-name"><span class="${sw}"${style}></span> ${esc(L.name)}</span>` +
      `<span class="layer-meta"><em data-xl-count="${esc(L.key)}">—</em><span class="switch gsx-switch" aria-hidden="true"></span></span></button>` +
      `<div class="gsx-note" data-xl-note="${esc(L.key)}" hidden></div>`;
  }

  function buildSidebar() {
    for (const g of REG.newGroups) ensureGroup(g.id, g.label);
    const groups = new Map();
    for (const L of REG.layers) {
      if (!groups.has(L.group)) groups.set(L.group, new Map());
      const subs = groups.get(L.group);
      if (!subs.has(L.sub)) subs.set(L.sub, []);
      subs.get(L.sub).push(L);
    }
    for (const [gid, subs] of groups) {
      const g = document.getElementById("group-" + gid);
      if (!g) continue;
      const names = Array.from(subs.keys()).sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const list = subs.get(name).slice().sort((a, b) => a.name.localeCompare(b.name));
        const d = el("details", { class: "gsx-sub", "data-xl-sub": name },
          `<summary><span>${esc(name)}</span><em class="gsx-sub-count">${list.length}</em></summary>` + list.map(buttonHtml).join(""));
        g.appendChild(d);
      }
    }
    const rail = document.querySelector(".rail .live-overlays");
    rail.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-xl-toggle]");
      if (!b) return;
      ev.preventDefault();
      setActive(b.getAttribute("data-xl-toggle"), b.getAttribute("aria-pressed") !== "true");
    });
    document.addEventListener("input", (ev) => {
      const r = ev.target.closest("[data-xl-opacity]");
      if (!r) return;
      const key = r.getAttribute("data-xl-opacity");
      const s = S(key);
      s.opacity = Number(r.value) / 100;
      const L = byKey.get(key);
      const ld = L && loaders[L.kind];
      if (ld && ld.setOpacity && s.handle) ld.setOpacity(L, s, s.opacity);
    });
  }

  // ------------------------------------------------------------------ state + render
  function render(key) {
    const s = S(key);
    const L = byKey.get(key);
    const b = document.querySelector(`[data-xl-toggle="${key}"]`);
    if (b) {
      b.setAttribute("aria-pressed", s.on ? "true" : "false");
      b.classList.toggle("on", s.on);
    }
    let label = "—";
    if (s.on) {
      if (s.error) label = "ERR";
      else if (s.loading) label = "…";
      else if (s.count != null) label = Number(s.count).toLocaleString("en-US");
      else label = "ON";
    }
    for (const c of document.querySelectorAll(`[data-xl-count="${key}"]`)) c.textContent = label;
    for (const note of document.querySelectorAll(`[data-xl-note="${key}"]`)) {
      if (!L) break;
      const imagery = /^(wmts|wms|arcgis|arcgis-image)$/.test(L.kind);
      if (!s.on) { note.hidden = true; note.innerHTML = ""; }
      else {
        let html = "";
        if (s.error) html += `<p class="gsx-err">${esc(s.error)}</p>`;
        if (L.desc) html += `<p>${esc(L.desc)}</p>`;
        if (L.note) html += `<p>${esc(L.note)}</p>`;
        if (s.info) html += `<p>${esc(s.info)}</p>`;
        html += `<p class="gsx-credit">${esc(L.credit || "")}</p>`;
        if (imagery) {
          const v = Math.round((s.opacity == null ? (L.opacity || 0.75) : s.opacity) * 100);
          html += `<label class="gsx-opacity"><span>Opacity</span><input type="range" min="10" max="100" step="5" value="${v}" data-xl-opacity="${esc(key)}" aria-label="Opacity for ${esc(L.name)}"></label>`;
        }
        if (note.innerHTML !== html) note.innerHTML = html;
        note.hidden = false;
      }
    }
    if (root.gsSyncLayerGroups) root.gsSyncLayerGroups();
    if (root.GsaWelcome && root.GsaWelcome.syncSwitches) root.GsaWelcome.syncSwitches();
  }

  function setActive(key, on) {
    const L = byKey.get(key);
    if (!L) return;
    const s = S(key);
    const ld = loaders[L.kind];
    s.on = Boolean(on);
    if (!s.on) {
      s.token += 1;
      s.loading = false;
      s.error = "";
      if (ld && s.handle) {
        try { ld.remove(L, s, api); } catch (e) { /* removal must never throw into the UI */ }
      }
      s.handle = null;
      s.count = null;
      s.ready = false;
      if (lastShown && lastShown.xlKey === key) hideCard();
      render(key);
      return;
    }
    if (!ld) { s.error = "No loader for this layer type."; render(key); return; }
    if (!viewer()) { render(key); return; } // applied by init() once the globe exists
    s.loading = true;
    s.error = "";
    if (s.opacity == null) s.opacity = L.opacity || 0.75;
    const token = ++s.token;
    render(key);
    Promise.resolve().then(() => ld.add(L, s, api, token)).then((handle) => {
      if (token !== s.token) { if (handle) { s.handle = handle; try { ld.remove(L, s, api); } catch (e) {} s.handle = null; } return; }
      s.handle = handle || null;
      s.loading = false;
      s.ready = true;
      render(key);
      viewer().scene.requestRender && viewer().scene.requestRender();
    }).catch((err) => {
      if (token !== s.token) return;
      s.loading = false;
      s.error = "Source did not answer (" + plain(err && err.message ? err.message : err).slice(0, 80) + "). Switch it off and on to try again.";
      render(key);
    });
  }

  // ------------------------------------------------------------------ pins
  const collections = new Map();
  let cullDirty = true;
  const lastCam = { x: 0, y: 0, z: 0, dx: 0 };

  function pointCollection(key) {
    const v = viewer();
    let c = collections.get(key);
    if (!c) {
      c = v.scene.primitives.add(new root.Cesium.PointPrimitiveCollection());
      collections.set(key, c);
    }
    return c;
  }

  function drawPins(L, s, items) {
    const Cesium = root.Cesium;
    const c = pointCollection(L.key);
    c.removeAll();
    const color = Cesium.Color.fromCssColorString(L.color || "#9fd4e2");
    const outline = Cesium.Color.fromCssColorString("#0b1218");
    for (const it of items) {
      if (!Number.isFinite(it.lat) || !Number.isFinite(it.lon)) continue;
      it.xl = true;
      it.xlKey = L.key;
      it.layer = "xl:" + L.key;
      it.kind = L.name;
      const size = Number.isFinite(it.size) ? it.size : 8;
      c.add({
        position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat, 0),
        color: color,
        pixelSize: size,
        outlineColor: outline,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: it,
      });
    }
    c.show = true;
    s.count = c.length;
    cullDirty = true;
    return { points: c };
  }

  function removePins(L) {
    const c = collections.get(L.key);
    if (!c) return;
    const v = viewer();
    collections.delete(L.key);
    if (v && !v.isDestroyed()) v.scene.primitives.remove(c);
  }

  function cull() {
    const v = viewer();
    if (!v || !collections.size) return;
    const Cesium = root.Cesium;
    const cam = v.camera.positionWC;
    const dir = v.camera.directionWC;
    const moved = cam.x !== lastCam.x || cam.y !== lastCam.y || cam.z !== lastCam.z || dir.x !== lastCam.dx;
    if (!moved && !cullDirty) return;
    cullDirty = false;
    lastCam.x = cam.x; lastCam.y = cam.y; lastCam.z = cam.z; lastCam.dx = dir.x;
    const flat = v.scene.mode !== Cesium.SceneMode.SCENE3D;
    const occ = cull.occ || (cull.occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84));
    occ.cameraPosition = cam;
    for (const c of collections.values()) {
      for (let i = 0, n = c.length; i < n; i += 1) {
        const p = c.get(i);
        p.show = flat || occ.isPointVisible(p.position);
      }
    }
  }

  // ------------------------------------------------------------------ card
  let lastShown = null;
  function hideCard() {
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  function pick(position) {
    const v = viewer();
    if (!v) return null;
    if (!Object.keys(st).some((k) => st[k].on)) return null;
    const picked = v.scene.pick(position, 9, 9);
    if (!picked) return null;
    let item = picked.id;
    if (item && item._xl) item = item._xl; // GeoJSON entity
    if (!item || !item.xl || !S(item.xlKey).on) return null;
    return item;
  }

  function fmtVal(v, how) {
    if (v == null || v === "") return "";
    if (how === "ms") { const d = new Date(Number(v)); return isNaN(d) ? "" : d.toUTCString().replace("GMT", "UTC"); }
    if (how === "iso") { const d = new Date(v); return isNaN(d) ? plain(v) : d.toUTCString().replace("GMT", "UTC"); }
    if (how === "num") return Number(v).toLocaleString("en-US");
    if (typeof v === "number") return String(Math.round(v * 100) / 100);
    return plain(v);
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const L = byKey.get(item.xlKey) || {};
    const out = [];
    if (item.region) out.push(`<span class="gsx-card-region">${esc(item.region)}</span>`);
    if (item.era) out.push(`<span class="gsx-card-era">${esc(item.era)}</span>`);
    if (item.summary) out.push(`<span class="gsx-card-sum">${esc(item.summary)}</span>`);
    if (item.details) out.push(`<span class="gsx-card-det">${esc(item.details)}</span>`);
    if (item.facts && item.facts.length) {
      out.push(`<dl class="nearby-facts gsx-facts">${item.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`);
    }
    out.push(`<span class="gsx-card-credit">${esc(L.credit || "")}</span>`);
    return out.map((x) => "<br>" + x).join("");
  }

  function clearAll() {
    for (const key of Object.keys(st)) if (st[key].on) setActive(key, false);
  }

  const api = { plain, esc, fmtVal, drawPins, removePins, viewer, render, S, byKey, cullSoon: () => { cullDirty = true; } };

  function register(kind, loader) { loaders[kind] = loader; }

  // Point the camera at every pin of a layer (used by QA; handy for a future "zoom to").
  function frame(key) {
    const v = viewer();
    const c = collections.get(key);
    if (!v || !c || !c.length) return false;
    const Cesium = root.Cesium;
    const pts = [];
    for (let i = 0; i < c.length; i += 1) pts.push(c.get(i).position);
    const sphere = Cesium.BoundingSphere.fromPoints(pts);
    v.camera.flyToBoundingSphere(sphere, { duration: 0, offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, Math.max(sphere.radius * 3.2, 2500000)) });
    cullDirty = true;
    return true;
  }

  // Screen position (CSS px, canvas-relative) of a pin of this layer that is on the visible
  // side of the globe, so QA scripts and the nearby list can point at a real pin.
  function visiblePin(key) {
    const v = viewer();
    const c = collections.get(key);
    if (!v || !c) return null;
    const ST = root.Cesium.SceneTransforms;
    const toWin = ST.worldToWindowCoordinates || ST.wgs84ToWindowCoordinates;
    const rect = v.scene.canvas.getBoundingClientRect();
    for (let i = 0; i < c.length; i += 1) {
      const p = c.get(i);
      if (!p.show) continue;
      const w = toWin(v.scene, p.position);
      if (!w || w.x < 40 || w.y < 40 || w.x > rect.width - 40 || w.y > rect.height - 40) continue;
      return { x: rect.left + w.x, y: rect.top + w.y, name: p.id && p.id.name };
    }
    return null;
  }

  function init(options) {
    ctx = options;
    const v = viewer();
    if (v && v.scene) v.scene.preRender.addEventListener(cull);
    for (const key of Object.keys(st)) if (st[key].on) setActive(key, true);
  }

  // The menu markup sits above this script, so build now: welcome.js reads these groups
  // as soon as cesium.js starts, which can be before DOMContentLoaded.
  if (document.querySelector(".rail .live-overlays")) buildSidebar();
  else document.addEventListener("DOMContentLoaded", buildSidebar);

  root.GsaExtraLayers = {
    registry: REG, register, init, setActive, pick, popupHtml, clearAll, visiblePin, frame,
    state: st, plain, esc,
    isOn: (key) => Boolean(st[key] && st[key].on),
  };
})(window);
