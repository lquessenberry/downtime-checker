/* Global Status · TRANSPORTATION > FLIGHT DELAYS (live).
 *
 * FAA National Airspace System Status (nasstatus.faa.gov). The server keeps
 * data/flight-delays-cache.json (poll-lib.php gsa_fd_refresh, five-minute cron) and
 * answers /api/flight-delays. This file re-reads that every 5 minutes while the layer
 * is on.
 *
 * One pin per affected airport, at the FAA's own airport coordinates, colored by the
 * most serious event (closure, ground stop, ground delay program, arrival / departure
 * delay, deicing, notice) with the airport code beside it. Depth test is off, so
 * cesium.js cullAircraftHorizon hides the ones behind the earth. Cards use the shared
 * #selected box (close X, scrolls) with on-screen text only: no links.
 */
(function (root) {
  const KEY = "delays";
  const KEYS = [KEY];
  const URL = "/api/flight-delays";
  const LABEL = "FLIGHT DELAYS";
  const REFRESH_MS = 5 * 60 * 1000;
  const KINDS = {
    closure: { color: "#8b0000", label: "Airport closure", size: 15 },
    groundstop: { color: "#ff2d2d", label: "Ground stop", size: 15 },
    gdp: { color: "#ff8c1a", label: "Ground delay program", size: 14 },
    arrival: { color: "#ffd400", label: "Arrival delay", size: 12 },
    departure: { color: "#ffd400", label: "Departure delay", size: 12 },
    deicing: { color: "#3fa9ff", label: "Deicing", size: 11 },
    notice: { color: "#8fb3d9", label: "Notice (NOTAM)", size: 8 },
  };
  const LEGEND = ["closure", "groundstop", "gdp", "arrival", "deicing", "notice"];
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
  function etClock(date) {
    return date.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  }
  function mins(m) {
    if (m == null) return "";
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h} h${r ? ` ${r} min` : ""}` : `${m} min`;
  }
  function airports() { return (pack && Array.isArray(pack.airports)) ? pack.airports : []; }
  function isDelay(a) { return a.top !== "notice"; }
  function kindOf(a) { return KINDS[a.top] || KINDS.notice; }

  function countText() {
    if (!shown()) return "—";
    if (st.count == null) return "…";
    return fmt(st.count);
  }

  function render() {
    const note = document.querySelector(`[data-delays-note="${KEY}"]`);
    if (note) {
      note.hidden = !shown();
      if (shown()) {
        // On-screen credit only: no links that leave globalstatus.app.
        const bits = ["Source: FAA National Airspace System Status (nasstatus.faa.gov). Live, checked every 5 minutes."];
        bits.push(LEGEND.map((k) => `<span class="io-key" style="--io:${KINDS[k].color}"></span>${esc(k === "arrival" ? "Arrival / departure delay" : KINDS[k].label)}`).join(" "));
        if (st.ready) {
          const all = airports().concat((pack && pack.noLocation) || []);
          const delayed = all.filter(isDelay);
          if (!delayed.length) bits.push("No active FAA delays reported");
          else {
            const by = {};
            for (const a of delayed) by[a.top === "departure" ? "arrival" : a.top] = (by[a.top === "departure" ? "arrival" : a.top] || 0) + 1;
            bits.push(`${fmt(delayed.length)} ${delayed.length === 1 ? "airport" : "airports"} with delays: ${LEGEND.filter((k) => by[k]).map((k) => `${fmt(by[k])} ${k === "arrival" ? "arrival / departure delay" : KINDS[k].label.toLowerCase()}`).join(", ")}`);
          }
          const notices = all.filter((a) => !isDelay(a)).length;
          if (notices) bits.push(`${fmt(notices)} ${notices === 1 ? "airport has" : "airports have"} a NOTAM notice only (small pins), such as limits on private flights`);
          const afp = (pack && Array.isArray(pack.afp)) ? pack.afp : [];
          if (afp.length) bits.push(`Airspace flow programs (not tied to one airport): ${afp.map((p) => `${esc(p.element)}${p.reason ? ` (${esc(p.reason)})` : ""}${p.avg != null ? `, average ${esc(mins(p.avg))}` : ""}`).join("; ")}`);
          const t = pack && (pack.feedUpdated || pack.updated);
          if (t) bits.push(`Updated ${esc(etTime(Date.parse(t) / 1000))}${pack.stale ? " (stale)" : ""}`);
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

  function itemFrom(a) {
    return {
      delays: true,
      layer: KEY,
      kind: `${isDelay(a) ? "FLIGHT DELAY" : "AIRPORT NOTICE"} · ${kindOf(a).label.toUpperCase()}`,
      name: `${a.code} · ${a.name || "Airport"}`,
      lat: a.lat,
      lon: a.lon,
      place: a,
    };
  }

  function place() {
    const Cesium = root.Cesium;
    if (!source || !Cesium) return;
    source.entities.removeAll();
    source.show = shown();
    let delayed = 0;
    // Notices first, so delay pins draw on top.
    const list = airports().slice().sort((x, y) => Number(isDelay(x)) - Number(isDelay(y)));
    for (const a of list) {
      if (a.lat == null || a.lon == null) continue;
      const k = kindOf(a);
      const delay = isDelay(a);
      if (delay) delayed += 1;
      const entity = source.entities.add({
        name: a.code,
        position: Cesium.Cartesian3.fromDegrees(Number(a.lon), Number(a.lat), 0),
        // Depth test is off so pins show at globe distance; cesium.js
        // cullAircraftHorizon hides the ones the earth is covering.
        point: {
          pixelSize: k.size,
          color: Cesium.Color.fromCssColorString(k.color).withAlpha(delay ? 1 : 0.8),
          outlineColor: Cesium.Color.fromCssColorString(a.top === "closure" ? "#ffffff" : OUTLINE),
          outlineWidth: a.top === "closure" ? 2 : 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: delay ? {
          text: a.code,
          font: "bold 12px monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.2e7),
        } : undefined,
      });
      const item = itemFrom(a);
      entity._live = item;
      entity._delays = item;
    }
    const noLoc = ((pack && pack.noLocation) || []).filter(isDelay).length;
    st.count = delayed + noLoc;
  }

  function applyPack(body) {
    pack = body;
    st.ready = true;
    st.error = body && body.error && !airports().length ? body.error : "";
    place();
    render();
    if (lastShown) {
      const fresh = airports().find((a) => a.code === lastShown.place.code);
      if (fresh) lastShown = itemFrom(fresh);
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

  // "DLY 0730-1415" closures: the window is UTC; show it in ET for today.
  function dailyText(d) {
    if (!Array.isArray(d) || d.length !== 2) return "";
    const at = (hhmm) => { const t = new Date(); t.setUTCHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0, 0); return t; };
    return `Closed daily ${d[0].slice(0, 2)}:${d[0].slice(2)}–${d[1].slice(0, 2)}:${d[1].slice(2)} UTC (${etClock(at(d[0]))}–${etClock(at(d[1]))} ET)`;
  }

  function eventHtml(e) {
    const k = KINDS[e.kind] || KINDS.notice;
    const lines = [];
    if (e.reason) lines.push(`Reason: ${e.reason}`);
    if (e.kind === "arrival" || e.kind === "departure") {
      if (e.min != null || e.max != null) lines.push(`Delays: ${e.min != null && e.max != null ? `${mins(e.min)} to ${mins(e.max)}` : mins(e.max != null ? e.max : e.min)}`);
      if (e.avg != null) lines.push(`Average delay: ${mins(e.avg)}`);
    } else {
      if (e.avg != null) lines.push(`Average delay: ${mins(e.avg)}`);
      if (e.max != null) lines.push(`Maximum delay: ${mins(e.max)}`);
    }
    if (e.trend) lines.push(`Trend: ${e.trend.charAt(0).toUpperCase()}${e.trend.slice(1).toLowerCase()}`);
    if (e.daily) lines.push(dailyText(e.daily));
    if (e.start) lines.push(`${e.kind === "closure" || e.kind === "notice" ? "Effective" : "Started"}: ${etTime(e.start)}`);
    if (e.end) lines.push(`${e.kind === "closure" ? "Reopens" : e.kind === "notice" ? "Until" : "Planned end"}: ${etTime(e.end)}`);
    if (e.endText) lines.push(`Planned end: ${e.endText}`);
    if (e.updated) lines.push(`Updated: ${etTime(e.updated)}`);
    if (e.center) lines.push(`Air traffic control center: ${e.center}`);
    if (e.scope) lines.push(`Departure scope: ${e.scope}`);
    if (e.text && e.text !== e.reason) lines.push(`NOTAM: ${e.text}`);
    return `<br><b>${esc(k.label)}</b>${lines.map((line) => `<br>${esc(line)}`).join("")}`;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const a = item.place || {};
    let html = "";
    const where = [a.city, a.state].filter(Boolean).join(", ");
    if (where) html += `<br>${esc(where)}`;
    for (const e of a.events || []) html += eventHtml(e);
    const c = a.config;
    if (c && (c.arr || c.dep || c.rate != null)) {
      html += "<br><b>Airport setup</b>";
      if (c.arr) html += `<br>Arrival runways: ${esc(c.arr)}`;
      if (c.dep) html += `<br>Departure runways: ${esc(c.dep)}`;
      if (c.rate != null) html += `<br>Arrival rate: ${esc(fmt(c.rate))} per hour`;
    }
    html += '<br><i class="infra-caption">Delays are for flights the FAA manages at this airport; individual flights may differ. Check with the airline for a specific flight.</i>';
    html += "<br>Source: FAA National Airspace System Status (nasstatus.faa.gov)";
    return html;
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

  root.GsaDelays = { KEYS, init, setActive, sourceFor, popupHtml, statusParts, state: st, labels: { [KEY]: LABEL } };
})(typeof window !== "undefined" ? window : globalThis);
