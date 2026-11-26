/* Global Status · PARANORMAL
 *
 * UFO SIGHTINGS     NUFORC factual fields for 2020–2026, via The UAP Atlas.
 *                   nuforc.org/map did not answer (Cloudflare challenge).
 *                   City-level coordinates. Report text is not included.
 * BIGFOOT SIGHTINGS The public point layer BigfootMap.com draws
 *                   (Bigfoot_Sightings_Cumulative_Final).
 *
 * Both start off. Pins are Cesium point primitives (same path as the dense
 * infrastructure layers) so tens of thousands of reports stay drawable.
 * Pin cards stay on this site and contain no outbound link.
 */
(function (root) {
  const KEYS = ["ufo", "bigfoot"];
  const OUTLINE = "#2A2E3C";
  const SIZE = 18;
  const UFO_PAGE = "https://theuapatlas.com/api/export?format=json&from=2020&to=2026&limit=10000&offset=";
  const BIGFOOT_PAGE = "https://services6.arcgis.com/8EDwePodEaNuHsLR/arcgis/rest/services/Bigfoot_Sightings_Cumulative_Final/FeatureServer/0/query?where=1%3D1&outFields=Join_%2CField3%2CType%2CComments&returnGeometry=true&orderByFields=FID&f=geojson&resultRecordCount=2000&resultOffset=";
  const META = {
    ufo: {
      label: "UFO SIGHTINGS",
      kind: "UFO SIGHTINGS",
      color: "#9fd4e2",
      credit: "NUFORC reports from 2020 on, via The UAP Atlas. City-level, not a pinpoint. A pin is a report someone filed.",
    },
    bigfoot: {
      label: "BIGFOOT SIGHTINGS",
      kind: "BIGFOOT SIGHTINGS",
      color: "#c4a574",
      credit: "Sightings from the public BigfootMap.com layer. A pin is a report, not a confirmed animal.",
    },
  };

  let ctx = null;
  const st = {};
  const collections = {};
  const styles = {};
  for (const key of KEYS) {
    st[key] = { on: false, ready: false, loading: false, error: "", count: null, token: 0 };
  }
  let lastShown = null;
  let cullAt = 0;
  let cullDirty = true;
  const lastCam = { x: NaN, y: NaN, z: NaN, dx: NaN };

  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function shown(key) { return st[key].on && !(root.gsProbeHidden && root.gsProbeHidden(key)); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function plain(value) {
    return String(value ?? "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  }
  function fmt(n) {
    const num = Number(n);
    return Number.isFinite(num) ? num.toLocaleString("en-US") : "";
  }
  const later = (fn) => (root.requestAnimationFrame ? root.requestAnimationFrame(fn) : setTimeout(fn, 0));

  async function getJson(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  function durationText(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 90) return Math.round(n) + " seconds";
    if (n < 5400) return Math.round(n / 60) + " minutes";
    const hours = n / 3600;
    return (hours >= 10 ? Math.round(hours) : hours.toFixed(1)) + " hours";
  }

  function titleCase(value) {
    const text = plain(value);
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function whenText(value) {
    const text = plain(value).replace(/\?+/g, "").replace(/-+$/g, "").trim();
    if (!text) return "";
    return text.slice(0, 16).replace("T", " ");
  }

  function countText(key) {
    const s = st[key];
    if (!shown(key)) return "—";
    if (s.count == null) return "…";
    return fmt(s.count);
  }

  function render(key) {
    const s = st[key];
    const note = document.querySelector('[data-paranormal-note="' + key + '"]');
    if (note) {
      note.hidden = !shown(key);
      if (shown(key)) {
        const bits = [esc(META[key].credit)];
        if (s.ready) bits.push(fmt(s.count) + " reports");
        else if (!s.error) bits.push("Loading…");
        if (s.error) bits.push('<span class="sw-err">' + esc(s.error) + "</span>");
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(key, countText(key));
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
  }

  function styleFor(key) {
    if (styles[key]) return styles[key];
    const Cesium = root.Cesium;
    styles[key] = {
      color: META[key].color,
      cssColor: Cesium.Color.fromCssColorString(META[key].color),
      cssOutline: Cesium.Color.fromCssColorString(OUTLINE),
      scale: new Cesium.NearFarScalar(1.5e6, 1.0, 1.2e7, 0.4),
    };
    return styles[key];
  }

  function ensureCollection(key) {
    if (collections[key]) return collections[key];
    const v = viewer();
    const Cesium = root.Cesium;
    if (!v || !Cesium) return null;
    const coll = new Cesium.PointPrimitiveCollection();
    coll.show = false;
    v.scene.primitives.add(coll);
    collections[key] = coll;
    return coll;
  }

  function addPoint(key, item) {
    const coll = collections[key];
    const style = styleFor(key);
    const Cesium = root.Cesium;
    coll.add({
      position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
      pixelSize: SIZE,
      color: style.cssColor,
      outlineColor: style.cssOutline,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: style.scale,
      id: item,
    });
  }

  function place(key, items, token) {
    const coll = ensureCollection(key);
    if (!coll) return;
    coll.removeAll();
    coll.show = shown(key);
    let i = 0;
    const step = () => {
      if (token !== st[key].token) return;
      const end = Math.min(i + 2500, items.length);
      for (; i < end; i += 1) addPoint(key, items[i]);
      if (i < items.length) {
        later(step);
        return;
      }
      st[key].ready = true;
      st[key].count = coll.length;
      st[key].loading = false;
      render(key);
      cullSoon();
    };
    step();
  }

  async function loadUfo(token) {
    const items = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && items.length < 60000) {
      const body = await getJson(UFO_PAGE + offset);
      if (token !== st.ufo.token) return null;
      const records = (body && body.records) || [];
      total = Number(body && body.total);
      if (!Number.isFinite(total)) total = offset + records.length;
      for (const rec of records) {
        const lat = Number(rec.lat);
        const lon = Number(rec.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const shape = titleCase(rec.shape);
        const when = whenText(rec.datetime);
        items.push({
          paranormal: true,
          layer: "ufo",
          kind: META.ufo.kind,
          name: shape || "Report",
          lat: lat,
          lon: lon,
          when: when,
          shape: shape,
          duration: durationText(rec.durationSec),
          place: plain(rec.country),
          credit: "NUFORC, via The UAP Atlas. City-level report.",
        });
      }
      if (!records.length || records.length < 10000) break;
      offset += records.length;
    }
    return items;
  }

  async function loadBigfoot(token) {
    const items = [];
    let offset = 0;
    for (let page = 0; page < 12; page += 1) {
      const body = await getJson(BIGFOOT_PAGE + offset);
      if (token !== st.bigfoot.token) return null;
      const features = (body && body.features) || [];
      if (!features.length) break;
      for (const feature of features) {
        const coords = feature.geometry && feature.geometry.coordinates;
        const props = feature.properties || {};
        const lon = Number(coords && coords[0]);
        const lat = Number(coords && coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const kind = titleCase(props.Type) || "Report";
        const note = plain(props.Comments).slice(0, 280);
        items.push({
          paranormal: true,
          layer: "bigfoot",
          kind: META.bigfoot.kind,
          name: kind,
          lat: lat,
          lon: lon,
          when: whenText(props.Field3),
          place: plain(props.Join_),
          note: note,
          credit: "BigfootMap.com public sightings layer.",
        });
      }
      offset += features.length;
      if (features.length < 2000) break;
    }
    return items;
  }

  function hidePopup(key) {
    if (!lastShown || lastShown.layer !== key) return;
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  function fail(key, error) {
    st[key].loading = false;
    st[key].error = (error && error.message ? error.message : String(error)) + ". Switch it off and on to try again.";
    render(key);
  }

  function setActive(key, on) {
    if (!st[key]) return;
    const s = st[key];
    s.on = Boolean(on);
    const coll = ensureCollection(key);
    if (!s.on) {
      s.token += 1;
      s.loading = false;
      if (coll) coll.show = false;
      hidePopup(key);
      render(key);
      return;
    }
    if (coll) coll.show = shown(key);
    if (s.ready) {
      render(key);
      cullSoon();
      return;
    }
    if (s.loading) {
      render(key);
      return;
    }
    s.loading = true;
    s.error = "";
    const token = s.token + 1;
    s.token = token;
    render(key);
    const load = key === "ufo" ? loadUfo : loadBigfoot;
    load(token).then((items) => {
      if (token !== s.token || !items) return;
      place(key, items, token);
    }).catch((error) => {
      if (token !== s.token) return;
      fail(key, error);
    });
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const lines = [];
    if (item.when) lines.push(item.when);
    if (item.shape) lines.push("Shape: " + item.shape);
    if (item.duration) lines.push("Duration: " + item.duration);
    if (item.place) lines.push(item.place);
    if (item.note) lines.push(item.note);
    if (item.credit) lines.push(item.credit);
    return lines.map((line) => "<br>" + esc(line)).join("");
  }

  function pick(position) {
    const v = viewer();
    if (!v || !KEYS.some((key) => shown(key))) return null;
    const picked = v.scene.pick(position, 11, 11);
    const item = picked && picked.id;
    if (!item || !item.paranormal || !shown(item.layer)) return null;
    return item;
  }

  function cullSoon() { cullDirty = true; }

  function cull() {
    const v = viewer();
    if (!v) return;
    const colls = KEYS.map((key) => (shown(key) ? collections[key] : null)).filter(Boolean);
    if (!colls.length) return;
    const Cesium = root.Cesium;
    const cam = v.camera.positionWC;
    const dir = v.camera.directionWC;
    const moved = cam.x !== lastCam.x || cam.y !== lastCam.y || cam.z !== lastCam.z || dir.x !== lastCam.dx;
    if (!moved && !cullDirty) return;
    const now = root.performance && root.performance.now ? root.performance.now() : Date.now();
    if (!cullDirty && now - cullAt < 120) return;
    cullAt = now;
    cullDirty = false;
    lastCam.x = cam.x;
    lastCam.y = cam.y;
    lastCam.z = cam.z;
    lastCam.dx = dir.x;
    const flat = v.scene.mode !== Cesium.SceneMode.SCENE3D;
    const occluder = cull.occluder || (cull.occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84));
    occluder.cameraPosition = cam;
    for (const coll of colls) {
      for (let i = 0, n = coll.length; i < n; i += 1) {
        const point = coll.get(i);
        point.show = flat || occluder.isPointVisible(point.position);
      }
    }
  }

  function init(options) {
    ctx = options;
    const v = viewer();
    if (v && v.scene && v.scene.preRender) v.scene.preRender.addEventListener(cull);
    for (const key of KEYS) render(key);
  }

  root.GsaParanormal = {
    KEYS: KEYS,
    init: init,
    setActive: setActive,
    pick: pick,
    popupHtml: popupHtml,
    state: st,
  };
})(window);
