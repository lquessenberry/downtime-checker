/* Global Status · MILITIAS layers (saved static file, not a live feed).
 *
 *   NATIONAL GROUPS    9 nationwide groups, clustered near the CONUS center
 *   STATEWIDE GROUPS  37 groups placed within their listed state
 *   LOCAL GROUPS      86 groups at the listed city, county, or region
 *   INACTIVE GROUPS   10 former groups placed within their listed state
 *
 * Source: Wikipedia, List of militia organizations in the United States.
 * Drawn as Cesium entities so the nearby list and pin cards work the same
 * way as FIREARMS. Depth test is off so pins stay visible at globe distance;
 * cesium.js cullAircraftHorizon hides the ones the earth itself is covering.
 */
(function (root) {
  const KEYS = ["militianational", "militiastate", "militialocal", "militiainactive"];
  const V = "20261124k";
  const FILE = "/api/militias?v=" + V;
  const META = {
    militianational: {
      label: "NATIONAL GROUPS",
      kind: "NATIONAL GROUPS",
      caption: "Nationwide groups from a saved copy of the Wikipedia list, not a live feed. Pins are placed near the geographic center of the contiguous United States.",
    },
    militiastate: {
      label: "STATEWIDE GROUPS",
      kind: "STATEWIDE GROUPS",
      caption: "Statewide groups from a saved copy of the Wikipedia list, not a live feed. Pins are placed within the listed state.",
    },
    militialocal: {
      label: "LOCAL GROUPS",
      kind: "LOCAL GROUPS",
      caption: "Local groups from a saved copy of the Wikipedia list, not a live feed. Pins use the listed city, county, or region.",
    },
    militiainactive: {
      label: "INACTIVE GROUPS",
      kind: "INACTIVE GROUPS",
      caption: "Inactive groups from a saved copy of the Wikipedia list, not a live feed. Pins are placed within the listed state.",
    },
  };
  const OUTLINE = "#2A2E3C";
  const SIZE = 14;

  let ctx = null;
  let pack = null;
  let loading = null;
  const st = {};
  const sources = {};
  const points = {};
  for (const key of KEYS) {
    st[key] = { on: false, ready: false, error: "", count: null, meta: null };
    points[key] = [];
  }
  let lastShown = null;

  function hidden(key) { return Boolean(root.gsProbeHidden && root.gsProbeHidden(key)); }
  function shown(key) { return st[key].on && !hidden(key); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function fmt(n) {
    if (n == null || n === "") return "";
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    return Number.isInteger(num) ? num.toLocaleString("en-US") : String(num);
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("the server sent a page instead of data");
    }
  }

  function countText(key) {
    const s = st[key];
    if (!shown(key)) return "—";
    if (s.count == null) return "…";
    return fmt(s.count);
  }

  function creditHtml(key) {
    const meta = st[key].meta || pack || {};
    const source = meta.source || "Wikipedia, List of militia organizations in the United States";
    const credit = META[key].caption;
    // On-screen credit only: no links or buttons that leave globalstatus.app.
    return `${esc(source)}. ${esc(credit)}`;
  }

  function render(key) {
    const s = st[key];
    const note = document.querySelector(`[data-militias-note="${key}"]`);
    if (note) {
      note.hidden = !shown(key);
      if (shown(key)) {
        const bits = [creditHtml(key)];
        if (s.ready) bits.push(`${fmt(s.count)} pins`);
        if (!s.ready && !s.error) bits.push("Loading…");
        if (s.error) bits.push(`<span class="sw-err">${esc(s.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(key, countText(key));
    if (typeof window.gsSyncLayerGroups === "function") window.gsSyncLayerGroups();
    const host = document.getElementById("cesium");
    if (host) host.dataset[key] = String(sources[key] ? sources[key].entities.values.length : 0);
  }

  function fail(key, error) {
    st[key].error = `${META[key].label}: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
    render(key);
  }

  function itemFrom(key, point) {
    return {
      militias: true,
      layer: key,
      kind: META[key].kind,
      id: point.id,
      name: point.name,
      lat: point.lat,
      lon: point.lon,
      color: point.color,
      section: point.section,
      locationText: point.locationText,
      placement: point.placement,
      placementNote: point.placementNote,
    };
  }

  function place(key) {
    const source = sources[key];
    const v = viewer();
    const Cesium = root.Cesium;
    if (!v || !source || !Cesium) return;
    source.entities.removeAll();
    source.show = shown(key);
    for (const point of points[key]) {
      if (point.lat == null || point.lon == null) continue;
      const item = itemFrom(key, point);
      const color = point.color || "#5aad7a";
      const entity = source.entities.add({
        name: point.name,
        position: Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), 0),
        // Depth test is off so pins stay visible at globe distance; cesium.js
        // cullAircraftHorizon hides the ones the earth itself is covering, or
        // they would show through and look stuck on the screen when the globe turns.
        point: {
          pixelSize: SIZE,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.fromCssColorString(OUTLINE),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entity._live = item;
      entity._militias = item;
    }
  }

  function applyPack(body) {
    pack = body;
    const layers = body && body.layers ? body.layers : {};
    for (const key of KEYS) {
      const rows = layers[key] && Array.isArray(layers[key].points) ? layers[key].points : [];
      points[key] = rows;
      st[key].meta = body;
      st[key].count = rows.length;
      st[key].ready = true;
      if (st[key].on) place(key);
      render(key);
    }
  }

  async function loadAll() {
    const body = await getJson(FILE);
    applyPack(body);
  }

  function ensureLoaded() {
    if (pack) return Promise.resolve();
    if (!loading) {
      loading = loadAll()
        .catch((error) => {
          for (const key of KEYS) {
            if (st[key].on && !st[key].ready) fail(key, error);
          }
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const lines = [];
    if (item.section) lines.push(item.section);
    if (item.locationText) lines.push(item.locationText);
    if (item.placementNote) lines.push(item.placementNote);
    const meta = pack || {};
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    html += `<br>Source: ${esc(meta.source || "Wikipedia, List of militia organizations in the United States")}`;
    return html;
  }

  function hidePopupFor(key) {
    if (!lastShown || lastShown.layer !== key) return;
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  function setActive(key, on) {
    if (!st[key]) return;
    const s = st[key];
    s.on = Boolean(on);
    if (sources[key]) sources[key].show = shown(key);
    if (!s.on) hidePopupFor(key);
    if (s.on && !s.ready) {
      s.error = "";
      render(key);
      ensureLoaded().then(() => {
        if (s.on && s.ready) place(key);
        render(key);
      });
    } else if (s.on && s.ready) {
      place(key);
    }
    render(key);
  }

  function sourceFor(key) {
    return sources[key] || null;
  }

  function statusParts() {
    return KEYS.filter((key) => shown(key)).map((key) => (st[key].count == null ? META[key].label : `${META[key].label} ${countText(key)}`));
  }

  function init(options) {
    ctx = options;
    const v = viewer();
    const Cesium = root.Cesium;
    if (v && Cesium) {
      for (const key of KEYS) {
        sources[key] = new Cesium.CustomDataSource(key);
        sources[key].show = false;
        v.dataSources.add(sources[key]);
      }
    }
    for (const key of KEYS) render(key);
  }

  root.GsaMilitias = {
    KEYS,
    init,
    setActive,
    sourceFor,
    popupHtml,
    statusParts,
    state: st,
    labels: Object.fromEntries(KEYS.map((key) => [key, META[key].label])),
  };
})(typeof window !== "undefined" ? window : globalThis);
