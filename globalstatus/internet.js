/* Global Status · USA INTERNET OUTAGES and GLOBAL INTERNET OUTAGES (live).
 *
 * Source: IODA (Internet Outage Detection and Analysis), Georgia Tech. The server
 * keeps data/ioda-cache.json (poll-lib.php gsa_ioda_refresh, five-minute cron, at most
 * every 10 minutes) and answers /api/internet-outages. This file re-reads that
 * every 5 minutes while a layer is on.
 *
 *   USA INTERNET OUTAGES     US states, plus nationwide and US territory alerts
 *   GLOBAL INTERNET OUTAGES  every other country
 *
 * One pin per place with an outage in the last 24 hours, at the state or country
 * center, colored by IODA severity. Drawn as Cesium entities with the depth test
 * off; cesium.js cullAircraftHorizon hides the ones behind the earth. Cards use
 * the shared #selected box (close X, scrolls) with on-screen text only: no links.
 */
(function (root) {
  const KEYS = ["inetusa", "inetglobal"];
  const URL = "/api/internet-outages";
  const REFRESH_MS = 5 * 60 * 1000;
  const META = {
    inetusa: { label: "USA INTERNET OUTAGES", field: "us", empty: "No US internet outages detected in the last 24h." },
    inetglobal: { label: "GLOBAL INTERNET OUTAGES", field: "global", empty: "No internet outages outside the US detected in the last 24h." },
  };
  const SEVERITY = {
    high: { color: "#ff3b3b", label: "High" },
    medium: { color: "#ff9b2f", label: "Medium" },
    low: { color: "#ffd84a", label: "Low" },
  };
  const OUTLINE = "#1a1d27";

  let ctx = null;
  let pack = null;
  let loading = null;
  let timer = null;
  let lastShown = null;
  const st = {};
  const sources = {};
  for (const key of KEYS) st[key] = { on: false, ready: false, error: "", count: null };

  function hidden(key) { return Boolean(root.gsProbeHidden && root.gsProbeHidden(key)); }
  function shown(key) { return st[key].on && !hidden(key); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }

  function etTime(sec) {
    if (!sec) return "";
    return `${new Date(sec * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
  }
  function duration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function countText(key) {
    if (!shown(key)) return "—";
    if (st[key].count == null) return "…";
    return fmt(st[key].count);
  }

  function render(key) {
    const s = st[key];
    const note = document.querySelector(`[data-internet-note="${key}"]`);
    if (note) {
      note.hidden = !shown(key);
      if (shown(key)) {
        // On-screen credit only: no links that leave globalstatus.app.
        const bits = ["Source: IODA, Georgia Tech (Internet Outage Detection and Analysis). Live, checked every 5 to 10 minutes."];
        bits.push(Object.values(SEVERITY).map((v) => `<span class="io-key" style="--io:${v.color}"></span>${esc(v.label)}`).join(" ") + " · faded = recovered");
        if (s.ready) {
          bits.push(s.count ? `${fmt(s.count)} ${key === "inetusa" ? "US places" : "countries"} with an outage in the last 24h` : esc(META[key].empty));
          if (pack && pack.updated) bits.push(`Updated ${esc(etTime(Date.parse(pack.updated) / 1000))}${pack.stale ? " (stale)" : ""}`);
        }
        if (!s.ready && !s.error) bits.push("Loading…");
        if (s.error) bits.push(`<span class="sw-err">${esc(s.error)}</span>`);
        note.innerHTML = bits.join(" · ");
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(key, countText(key));
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    const host = document.getElementById("cesium");
    if (host) host.dataset[key] = String(sources[key] ? sources[key].entities.values.length : 0);
  }

  function itemFrom(key, p) {
    return {
      internet: true,
      layer: key,
      kind: p.ongoing ? "INTERNET OUTAGE" : "INTERNET OUTAGE (RECOVERED)",
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      place: p,
    };
  }

  function place(key) {
    const source = sources[key];
    const Cesium = root.Cesium;
    if (!source || !Cesium) return;
    source.entities.removeAll();
    source.show = shown(key);
    const rows = (pack && Array.isArray(pack[META[key].field])) ? pack[META[key].field] : [];
    for (const p of rows) {
      if (p.lat == null || p.lon == null) continue;
      const sev = SEVERITY[p.severity] || SEVERITY.low;
      const size = p.severity === "high" ? 16 : p.severity === "medium" ? 13 : 11;
      const entity = source.entities.add({
        name: p.name,
        position: Cesium.Cartesian3.fromDegrees(Number(p.lon), Number(p.lat), 0),
        // Depth test is off so pins show at globe distance; cesium.js
        // cullAircraftHorizon hides the ones the earth is covering.
        point: {
          pixelSize: p.ongoing ? size : size - 3,
          color: Cesium.Color.fromCssColorString(sev.color).withAlpha(p.ongoing ? 1 : 0.45),
          outlineColor: Cesium.Color.fromCssColorString(p.ongoing ? OUTLINE : sev.color),
          outlineWidth: p.ongoing ? 1.5 : 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      const item = itemFrom(key, p);
      entity._live = item;
      entity._internet = item;
    }
    st[key].count = rows.length;
  }

  function applyPack(body) {
    pack = body;
    for (const key of KEYS) {
      st[key].ready = true;
      st[key].error = body && body.error && !(body[META[key].field] || []).length ? body.error : "";
      place(key);
      render(key);
    }
    if (lastShown) refreshOpenCard();
  }

  function refreshOpenCard() {
    // Keep an open card in step with fresh data, or close it if that outage dropped off.
    const box = document.getElementById("selected");
    if (!box || box.hidden || !lastShown) return;
    const rows = (pack && pack[META[lastShown.layer].field]) || [];
    const fresh = rows.find((p) => String(p.code) === String(lastShown.place.code));
    if (!fresh) return;
    lastShown = itemFrom(lastShown.layer, fresh);
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
          for (const key of KEYS) {
            if (st[key].on) {
              st[key].error = `${META[key].label}: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
              if (!pack) st[key].ready = false;
              render(key);
            }
          }
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function schedule() {
    const anyOn = KEYS.some((key) => st[key].on);
    if (anyOn && !timer) timer = setInterval(() => ensureLoaded(true), REFRESH_MS);
    if (!anyOn && timer) { clearInterval(timer); timer = null; }
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const p = item.place || {};
    const sev = SEVERITY[p.severity] || SEVERITY.low;
    const lines = [];
    lines.push(`Status: ${p.ongoing ? "Ongoing" : "Recovered"}`);
    if (p.start) lines.push(`Started: ${etTime(p.start)}`);
    if (p.start && p.end) lines.push(`${p.ongoing ? "Lasting so far" : "Lasted"}: ${duration(p.end - p.start)}`);
    if (!p.ongoing && p.end) lines.push(`Recovered: ${etTime(p.end)}`);
    lines.push(`Severity: ${sev.label} (IODA score ${fmt(Math.round(p.score || 0))})`);
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    const signals = Array.isArray(p.signals) ? p.signals : [];
    if (signals.length) {
      html += "<br><b>Signals that dropped</b>";
      for (const s of signals) {
        html += `<br>· ${esc(s.label)}: score ${esc(fmt(Math.round(s.score || 0)))}, since ${esc(etTime(s.start))}${s.ongoing ? " (ongoing)" : `, back ${esc(etTime(s.end))}`}`;
      }
    }
    html += '<br><i class="infra-caption">IODA watches BGP routing, active probing and darknet (telescope) traffic. A drop can be a real outage or a measurement change.</i>';
    html += "<br>Source: IODA, Georgia Tech";
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
    schedule();
    if (s.on && !s.ready) {
      s.error = "";
      render(key);
      ensureLoaded().then(() => render(key));
    } else if (s.on) {
      place(key);
      // Data older than the refresh interval: fetch again now.
      if (pack && pack.updated && Date.now() - Date.parse(pack.updated) > REFRESH_MS * 2) ensureLoaded(true);
    }
    render(key);
  }

  function sourceFor(key) { return sources[key] || null; }

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

  root.GsaInternet = {
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
