/* Global Status · FIREARMS layers (saved static files, not a live feed).
 *
 *   USA GUN OWNERSHIP    /api/guns-usa     50 states + D.C. centroids
 *   GLOBAL GUN OWNERSHIP  /api/guns-world   one pin per country (one for the US)
 *
 * World Population Review tables, themselves from Pew / CBS News (US, 2022)
 * and the Small Arms Survey 2017 (world). Drawn as Cesium entities so the
 * nearby list and pin cards work the same way as GLOBAL HUNGER.
 */
(function (root) {
  const KEYS = ["gunsusa", "gunsworld"];
  const V = "20261124h";
  const FILES = {
    gunsusa: "/api/guns-usa?v=" + V,
    gunsworld: "/api/guns-world?v=" + V,
  };
  const META = {
    gunsusa: {
      label: "USA GUN OWNERSHIP",
      kind: "USA GUN OWNERSHIP",
      caption: "Share of households that own guns and gun-ownership licenses, 2022. District of Columbia has no household percentage in the source table. Saved copy, not a live feed.",
    },
    gunsworld: {
      label: "GLOBAL GUN OWNERSHIP",
      kind: "GLOBAL GUN OWNERSHIP",
      caption: "Civilian guns per 100 people, plus civilian, military and law-enforcement firearm totals, 2017. Indonesia and Taiwan have no per-person rate in the source table. One pin for the entire United States. Saved copy, not a live feed.",
    },
  };
  const OUTLINE = "#2A2E3C";
  const SIZE = 14;

  let ctx = null;
  const st = {};
  const sources = {};
  const points = {};
  for (const key of KEYS) {
    st[key] = { on: false, loading: null, ready: false, error: "", count: null, meta: null };
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

  function pct(n) {
    if (n == null || n === "") return "";
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    return `${Number.isInteger(num) ? String(num) : String(num)}%`;
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
    const meta = st[key].meta || {};
    const source = meta.source || "World Population Review";
    const credit = meta.credit || META[key].caption;
    return esc(credit || (source + "."));
  }

  function render(key) {
    const s = st[key];
    const note = document.querySelector(`[data-firearms-note="${key}"]`);
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
      firearms: true,
      layer: key,
      kind: META[key].kind,
      id: point.id,
      name: point.name,
      lat: point.lat,
      lon: point.lon,
      year: point.year,
      color: point.color,
      householdPct: point.householdPct,
      licenses: point.licenses,
      rate: point.rate,
      civilian: point.civilian,
      military: point.military,
      lawEnforcement: point.lawEnforcement,
      rateDisp: point.rateDisp,
      civilianDisp: point.civilianDisp,
      militaryDisp: point.militaryDisp,
      lawEnforcementDisp: point.lawEnforcementDisp,
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
      const color = point.color || (key === "gunsusa" ? "#d4a84b" : "#c45a2e");
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
      entity._firearms = item;
    }
  }

  async function load(key) {
    const body = await getJson(FILES[key]);
    const rows = Array.isArray(body.points) ? body.points : [];
    points[key] = rows;
    st[key].meta = body;
    st[key].count = rows.length;
    st[key].ready = true;
    place(key);
    render(key);
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const lines = [];
    if (item.layer === "gunsusa") {
      if (item.householdPct != null && item.householdPct !== "") {
        lines.push(`${pct(item.householdPct)} of households own guns (${item.year || 2022})`);
      } else {
        lines.push(`The source table has no household percentage for ${item.name}.`);
      }
      if (item.licenses != null && item.licenses !== "") {
        lines.push(`${fmt(item.licenses)} gun ownership licenses (${item.year || 2022})`);
      }
    } else {
      if (item.rate != null && item.rate !== "") {
        lines.push(`${item.rateDisp || item.rate} civilian guns per 100 people (${item.year || 2017})`);
      } else {
        lines.push(`The source table has no civilian guns-per-100 figure for ${item.name}.`);
      }
      if (item.civilian != null) lines.push(`${fmt(item.civilian)} civilian firearms (${item.year || 2017})`);
      if (item.military != null) lines.push(`${fmt(item.military)} military firearms (${item.year || 2017})`);
      if (item.lawEnforcement != null) lines.push(`${fmt(item.lawEnforcement)} law enforcement firearms (${item.year || 2017})`);
    }
    const meta = (st[item.layer] && st[item.layer].meta) || {};
    const source = meta.source || "World Population Review";
    const credit = meta.credit || META[item.layer].caption;
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    html += `<br><i class="infra-caption">${esc(credit || source)}</i>`;
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
    if (s.on && !s.ready && !s.loading) {
      s.error = "";
      s.loading = load(key)
        .catch((error) => fail(key, error))
        .finally(() => { s.loading = null; render(key); });
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

  root.GsaFirearms = {
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
