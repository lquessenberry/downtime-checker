/* Global Status · HEALTH & HUMANITARIAN > USA AIR QUALITY (live).
 *
 * EPA AirNow current monitors (ozone, PM2.5, PM10) plus NOAA Hazard Mapping System
 * smoke plumes. The server keeps data/airquality-cache.json (poll-lib.php
 * gsa_aq_refresh, about every 15 minutes from the five-minute cron) and answers
 * /api/air-quality. This file re-reads that every 10 minutes while the layer is on.
 *
 * Monitor pins use the EPA AQI colors; worse air is drawn larger and on top, and
 * AQI 101+ gets its number beside the pin. Smoke plumes lie flat on the globe in
 * translucent gray / amber / brown by density. Every entity carries a position
 * (plumes use their center), so cesium.js cullAircraftHorizon hides the far side.
 * Cards use the shared #selected box (close X, scrolls) with on-screen text only.
 */
(function (root) {
  const KEY = "airquality";
  const KEYS = [KEY];
  const URL = "/api/air-quality";
  const LABEL = "USA AIR QUALITY";
  const REFRESH_MS = 10 * 60 * 1000;
  const SOURCE = "Source: EPA AirNow & NOAA HMS Smoke";
  const BANDS = {
    good: { color: "#00e400", label: "Good", range: "0–50", size: 7,
      advice: "Air quality is satisfactory, and air pollution poses little or no risk." },
    moderate: { color: "#ffff00", label: "Moderate", range: "51–100", size: 9,
      advice: "Air quality is acceptable. People who are unusually sensitive to air pollution should consider cutting back on long or heavy outdoor activity." },
    usg: { color: "#ff7e00", label: "Unhealthy for Sensitive Groups", range: "101–150", size: 12,
      advice: "People with heart or lung disease (including asthma), older adults, children, teens, and people who work outdoors should cut back on long or heavy outdoor activity. Most other people are unlikely to be affected." },
    unhealthy: { color: "#ff0000", label: "Unhealthy", range: "151–200", size: 14,
      advice: "Everyone may begin to feel health effects. Sensitive groups should avoid long or heavy outdoor activity; everyone else should cut back on it." },
    veryunhealthy: { color: "#8f3f97", label: "Very Unhealthy", range: "201–300", size: 15,
      advice: "Health alert: the risk of health effects is increased for everyone. Sensitive groups should avoid all outdoor physical activity; everyone else should avoid long or heavy outdoor activity." },
    hazardous: { color: "#7e0023", label: "Hazardous", range: "301+", size: 16,
      advice: "Health warning of emergency conditions: everyone is more likely to be affected. Everyone should avoid all outdoor physical activity and stay indoors with windows closed if possible." },
    none: { color: "#8a8f9c", label: "No current reading", range: "", size: 5,
      advice: "This monitor did not report a reading for the latest hour." },
  };
  const ORDER = ["good", "moderate", "usg", "unhealthy", "veryunhealthy", "hazardous"];
  const SMOKE = {
    Light: { color: "#8c8c8c", alpha: 0.3, line: 0.8 },
    Medium: { color: "#d08a2a", alpha: 0.36, line: 0.9 },
    Heavy: { color: "#6b3a1e", alpha: 0.46, line: 0.95 },
  };
  const POLLUTANT = { "PM2.5": "PM2.5 (fine particles, such as smoke and soot)", Ozone: "Ozone (ground-level smog)", PM10: "PM10 (coarse particles, such as dust)" };
  const OUTLINE = "#1a1d27";

  let ctx = null;
  let pack = null;
  let loading = null;
  let timer = null;
  let lastShown = null;
  let source = null;
  const st = { on: false, ready: false, error: "", count: null };

  function hidden() { return Boolean(root.gsProbeHidden && root.gsProbeHidden(KEY)); }
  function shown() { return st.on && !hidden(); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function etTime(sec) {
    if (!sec) return "";
    return `${new Date(sec * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
  }
  function monitors() { return (pack && Array.isArray(pack.monitors)) ? pack.monitors : []; }
  function plumes() { return (pack && pack.smoke && Array.isArray(pack.smoke.plumes)) ? pack.smoke.plumes : []; }
  function bandOf(aqi) {
    if (aqi == null) return "none";
    if (aqi <= 50) return "good";
    if (aqi <= 100) return "moderate";
    if (aqi <= 150) return "usg";
    if (aqi <= 200) return "unhealthy";
    if (aqi <= 300) return "veryunhealthy";
    return "hazardous";
  }
  // Many AirNow site names are ALL CAPS; show them in title case.
  function niceName(name) {
    const s = String(name || "").trim();
    if (!s || s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ncore|Npp)\b/g, (m) => m.toUpperCase());
  }
  function agency(m) { return (pack && Array.isArray(pack.agencies) && m.ag != null) ? pack.agencies[m.ag] || "" : ""; }

  function countText() {
    if (!shown()) return "—";
    if (st.count == null) return "…";
    return fmt(st.count);
  }

  function render() {
    const note = document.querySelector(`[data-airquality-note="${KEY}"]`);
    if (note) {
      note.hidden = !shown();
      if (shown()) {
        // On-screen credit only: no links that leave globalstatus.app.
        const bits = ["Source: EPA AirNow monitors (hourly, preliminary) and NOAA Hazard Mapping System smoke plumes. Checked every 15 minutes."];
        bits.push(ORDER.map((k) => `<span class="io-key" style="--io:${BANDS[k].color}"></span>${esc(BANDS[k].label)} ${esc(BANDS[k].range)}`).join(" "));
        bits.push(["Light", "Medium", "Heavy"].map((d) => `<span class="io-key" style="--io:${SMOKE[d].color}"></span>${d} smoke`).join(" "));
        if (st.ready) {
          const c = (pack && pack.counts) || {};
          const b = c.bands || {};
          const total = monitors().length;
          if (!total) bits.push("No EPA AirNow monitors are reporting right now");
          else {
            bits.push(`${fmt(total)} US monitors: ${ORDER.filter((k) => b[k]).map((k) => `${fmt(b[k])} ${BANDS[k].label}`).join(", ")}${b.none ? `, ${fmt(b.none)} with no current reading (small gray pins)` : ""}`);
          }
          const n = plumes().length;
          const d = c.density || {};
          const day = pack && pack.smoke && pack.smoke.date ? new Date(`${pack.smoke.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
          if (n) bits.push(`${fmt(n)} smoke ${n === 1 ? "plume" : "plumes"} mapped by satellite${day ? ` (${day} analysis)` : ""}: ${["Light", "Medium", "Heavy"].filter((k) => d[k]).map((k) => `${fmt(d[k])} ${k.toLowerCase()}`).join(", ")}`);
          else bits.push(`No smoke plumes mapped${day ? ` in the ${day} analysis` : ""}`);
          const t = pack && (pack.observed || pack.updated);
          if (t) bits.push(`Readings for ${esc(etTime(Date.parse(t) / 1000))}${pack.stale ? " (stale)" : ""}`);
        }
        if (!st.ready && !st.error) bits.push("Loading…");
        if (st.error) bits.push(`<span class="sw-err">${esc(st.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(KEY, countText());
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    const host = document.getElementById("cesium");
    if (host) host.dataset[KEY] = String(source ? source.entities.values.length : 0);
  }

  function monitorItem(m) {
    const band = bandOf(m.aqi);
    return {
      airquality: true,
      layer: KEY,
      kind: `AIR QUALITY · ${BANDS[band].label.toUpperCase()}`,
      name: niceName(m.name) || "Air monitor",
      lat: m.lat,
      lon: m.lon,
      monitor: m,
    };
  }

  function plumeItem(p) {
    return {
      airquality: true,
      layer: KEY,
      kind: `WILDFIRE SMOKE · ${String(p.density).toUpperCase()}`,
      name: `${p.density} smoke plume`,
      lat: p.lat,
      lon: p.lon,
      plume: p,
    };
  }

  function place() {
    const Cesium = root.Cesium;
    if (!source || !Cesium) return;
    source.entities.removeAll();
    source.show = shown();
    // Smoke first (flat, under the pins); heavier smoke over lighter.
    const rank = { Light: 0, Medium: 1, Heavy: 2 };
    for (const p of plumes().slice().sort((x, y) => rank[x.density] - rank[y.density])) {
      if (!Array.isArray(p.ring) || p.ring.length < 4) continue;
      const s = SMOKE[p.density] || SMOKE.Light;
      const flat = [];
      for (const pt of p.ring) flat.push(Number(pt[0]), Number(pt[1]));
      const positions = Cesium.Cartesian3.fromDegreesArray(flat);
      const color = Cesium.Color.fromCssColorString(s.color);
      const entity = source.entities.add({
        name: `${p.density} smoke`,
        // The plume center, so the horizon cull hides plumes on the far side.
        position: Cesium.Cartesian3.fromDegrees(Number(p.lon), Number(p.lat), 0),
        polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: color.withAlpha(s.alpha) },
        polyline: { positions: positions.concat([positions[0]]), width: 1.5, material: color.withAlpha(s.line), clampToGround: true },
      });
      const item = plumeItem(p);
      entity._live = item;
      entity._airquality = item;
    }
    // Monitors: worst air last so it draws on top.
    const list = monitors().slice().sort((x, y) => (x.aqi == null ? -1 : x.aqi) - (y.aqi == null ? -1 : y.aqi));
    for (const m of list) {
      if (m.lat == null || m.lon == null) continue;
      const band = bandOf(m.aqi);
      const b = BANDS[band];
      const bad = m.aqi != null && m.aqi > 100;
      const entity = source.entities.add({
        name: m.id,
        position: Cesium.Cartesian3.fromDegrees(Number(m.lon), Number(m.lat), 0),
        // Depth test is off so pins show at globe distance; cesium.js
        // cullAircraftHorizon hides the ones the earth is covering.
        point: {
          pixelSize: b.size,
          color: Cesium.Color.fromCssColorString(b.color).withAlpha(band === "none" ? 0.55 : 1),
          outlineColor: Cesium.Color.fromCssColorString(bad ? "#ffffff" : OUTLINE),
          outlineWidth: bad ? 2 : (band === "none" ? 0.5 : 1),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: bad ? {
          text: String(m.aqi),
          font: "bold 12px monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.6e7),
        } : undefined,
      });
      const item = monitorItem(m);
      entity._live = item;
      entity._airquality = item;
    }
    st.count = monitors().length;
  }

  function applyPack(body) {
    pack = body;
    st.ready = true;
    st.error = body && body.error && !monitors().length ? body.error : "";
    place();
    render();
    if (lastShown && lastShown.monitor) {
      const fresh = monitors().find((m) => m.id === lastShown.monitor.id);
      if (fresh) lastShown = monitorItem(fresh);
    }
  }

  async function load() {
    const response = await fetch(`${URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (err) { throw new Error("the server sent a page instead of data"); }
    applyPack(body);
  }

  function ensureLoaded(force) {
    if (pack && !force) return Promise.resolve();
    if (!loading) {
      loading = load()
        .catch((error) => {
          if (st.on) {
            st.error = `${LABEL}: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
            if (!pack) st.ready = false;
            render();
          }
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function schedule() {
    if (st.on && !timer) timer = setInterval(() => ensureLoaded(true), REFRESH_MS);
    if (!st.on && timer) { clearInterval(timer); timer = null; }
  }

  function inRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]; const yi = ring[i][1]; const xj = ring[j][0]; const yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function smokeOver(m) {
    const rank = { Light: 1, Medium: 2, Heavy: 3 };
    let best = null;
    for (const p of plumes()) {
      if (Array.isArray(p.ring) && inRing(Number(m.lon), Number(m.lat), p.ring) && (!best || rank[p.density] > rank[best])) best = p.density;
    }
    return best;
  }

  function monitorHtml(m) {
    const band = bandOf(m.aqi);
    const b = BANDS[band];
    const lines = [];
    const where = m.tribal ? ["Tribal monitor", m.area].filter(Boolean).join(" · ") : [m.area, m.state].filter(Boolean).join(", ");
    if (where) lines.push(esc(where));
    if (m.aqi != null) {
      lines.push(`<b>AQI ${esc(m.aqi)} · ${esc(b.label)}</b>`);
      if (m.primary) lines.push(`Main pollutant: ${esc(POLLUTANT[m.primary] || m.primary)}`);
      const parts = [["Ozone", m.o3], ["PM2.5", m.pm25], ["PM10", m.pm10]].filter((x) => x[1] != null);
      if (parts.length > 1) lines.push(`By pollutant: ${esc(parts.map((x) => `${x[0]} AQI ${x[1]}`).join(", "))}`);
    } else {
      lines.push(`<b>${esc(b.label)}</b>`);
    }
    lines.push(`<b>What it means</b><br>${esc(b.advice)}`);
    const smoke = smokeOver(m);
    if (smoke) lines.push(`Satellite-mapped smoke overhead: ${esc(smoke)} (it may be high in the sky rather than at ground level)`);
    const ag = agency(m);
    if (ag) lines.push(`Reporting agency: ${esc(ag)}`);
    if (m.time) lines.push(`Observed: ${esc(etTime(m.time))} (hourly reading)`);
    if (m.temp) lines.push("Temporary monitor (often placed near a wildfire)");
    let html = lines.map((l) => `<br>${l}`).join("");
    html += '<br><i class="infra-caption">AQI is EPA\'s 0–500 Air Quality Index for the latest hour. Readings are preliminary and have not been checked by EPA.</i>';
    html += `<br>${SOURCE}`;
    return html;
  }

  function plumeHtml(p) {
    const lines = [`<b>Smoke density: ${esc(p.density)}</b>`];
    if (p.start || p.end) lines.push(`Seen by satellite: ${esc([etTime(p.start), etTime(p.end)].filter(Boolean).join(" to "))}`);
    if (p.satellite) lines.push(`Satellite: ${esc(p.satellite)}`);
    const day = pack && pack.smoke && pack.smoke.date ? new Date(`${pack.smoke.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
    if (day) lines.push(`Analysis: NOAA Hazard Mapping System, ${esc(day)} (UTC day)`);
    let html = lines.map((l) => `<br>${l}`).join("");
    html += '<br><i class="infra-caption">Analysts trace smoke from satellite images. Smoke may be high in the sky rather than at ground level; nearby monitor pins show the air people breathe.</i>';
    html += `<br>${SOURCE}`;
    return html;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    if (item.plume) return plumeHtml(item.plume);
    return monitorHtml(item.monitor || {});
  }

  function hidePopup() {
    if (!lastShown) return;
    const box = document.getElementById("selected");
    if (box) box.hidden = true;
    lastShown = null;
  }

  function setActive(key, on) {
    if (key !== KEY) return;
    st.on = Boolean(on);
    if (source) source.show = shown();
    if (!st.on) hidePopup();
    schedule();
    if (st.on && !st.ready) {
      st.error = "";
      render();
      ensureLoaded().then(() => render());
    } else if (st.on) {
      place();
      if (pack && pack.updated && Date.now() - Date.parse(pack.updated) > REFRESH_MS * 2) ensureLoaded(true);
    }
    render();
  }

  function sourceFor(key) { return key === KEY ? source : null; }

  function statusParts() {
    return shown() ? [st.count == null ? LABEL : `${LABEL} ${countText()}`] : [];
  }

  function init(options) {
    ctx = options;
    const v = viewer();
    const Cesium = root.Cesium;
    if (v && Cesium) {
      source = new Cesium.CustomDataSource(KEY);
      source.show = false;
      v.dataSources.add(source);
    }
    render();
  }

  root.GsaAirQuality = { KEYS, init, setActive, sourceFor, popupHtml, statusParts, state: st, labels: { [KEY]: LABEL } };
})(typeof window !== "undefined" ? window : globalThis);
