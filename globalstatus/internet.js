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
 * center, colored by IODA severity.
 *
 * RIPE Atlas (RIPE NCC) test devices that went offline in the last 24 hours ride
 * in the same two layers as cyan diamonds: US probes in USA, the rest in GLOBAL.
 * The server keeps data/ripe-atlas-cache.json (gsa_ripe_refresh, same cron and
 * 10-minute gate) and answers /api/internet-probes. Each probe is one device, so a
 * drop can be one home or office losing power or internet. Drawn as Cesium entities with the depth test
 * off; cesium.js cullAircraftHorizon hides the ones behind the earth. Cards use
 * the shared #selected box (close X, scrolls) with on-screen text only: no links.
 */
(function (root) {
  const KEYS = ["inetusa", "inetglobal"];
  const URL = "/api/internet-outages";
  const PROBE_URL = "/api/internet-probes";
  const PROBE = { color: "#38d6ff", recovered: "#7fb8c9" };
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
  let probes = null;
  const probeIcons = {};
  let loading = null;
  let timer = null;
  let lastShown = null;
  const st = {};
  const sources = {};
  for (const key of KEYS) st[key] = { on: false, ready: false, error: "", count: null, places: 0, probes: 0, probesOffline: 0 };

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

  function probeRows(key) {
    return (probes && Array.isArray(probes[META[key].field])) ? probes[META[key].field] : [];
  }

  // A diamond, so probe pins never read as IODA's round state and country pins.
  function probeIcon(ongoing) {
    const k = ongoing ? "on" : "off";
    if (probeIcons[k]) return probeIcons[k];
    const size = ongoing ? 18 : 14;
    const c = document.createElement("canvas");
    c.width = c.height = size * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    const h = size / 2;
    g.beginPath();
    g.moveTo(h, 1); g.lineTo(size - 1, h); g.lineTo(h, size - 1); g.lineTo(1, h); g.closePath();
    g.fillStyle = ongoing ? PROBE.color : "rgba(127,184,201,0.45)";
    g.fill();
    g.lineWidth = ongoing ? 1.5 : 1.25;
    g.strokeStyle = ongoing ? "#0b1d26" : PROBE.recovered;
    g.stroke();
    probeIcons[k] = c.toDataURL();
    return probeIcons[k];
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
        const bits = ["Source: IODA, Georgia Tech (Internet Outage Detection and Analysis), and RIPE Atlas (RIPE NCC) test devices. Live, checked every 5 to 10 minutes."];
        bits.push(Object.values(SEVERITY).map((v) => `<span class="io-key" style="--io:${v.color}"></span>${esc(v.label)}`).join(" ") + ` <span class="io-key io-probe"></span>RIPE Atlas probe offline · faded = recovered`);
        if (s.ready) {
          const places = s.places || 0;
          const probeCount = s.probes || 0;
          if (!places && !probeCount) bits.push(esc(META[key].empty));
          else {
            bits.push(places ? `${fmt(places)} ${key === "inetusa" ? (places === 1 ? "US place" : "US places") : (places === 1 ? "country" : "countries")} with an outage in the last 24h (IODA)` : `No ${key === "inetusa" ? "US state or nationwide" : "country-wide"} outages from IODA in the last 24h`);
            if (probeCount) bits.push(`${fmt(probeCount)} RIPE Atlas ${probeCount === 1 ? "probe" : "probes"} went offline in the last 24h, ${fmt(s.probesOffline || 0)} still offline`);
          }
          if (pack && pack.updated) bits.push(`Updated ${esc(etTime(Date.parse(pack.updated) / 1000))}${pack.stale ? " (stale)" : ""}`);
          if (probes && probes.error && !probeCount) bits.push(`RIPE Atlas: ${esc(probes.error)}`);
          bits.push("Place names: GeoNames");
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

  function probeItem(key, p) {
    return {
      internet: true,
      probe: true,
      layer: key,
      kind: p.ongoing ? "PROBE OFFLINE" : "PROBE BACK ONLINE",
      name: probePlace(p),
      lat: p.lat,
      lon: p.lon,
      place: p,
    };
  }

  function probePlace(p) {
    if (p.near) return p.cc === "US" ? p.near : `${p.near}, ${p.country}`;
    return p.country || p.cc || "Unknown place";
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
    let offline = 0;
    const probeList = probeRows(key);
    for (const p of probeList) {
      if (p.lat == null || p.lon == null) continue;
      if (p.ongoing) offline += 1;
      const entity = source.entities.add({
        name: probePlace(p),
        position: Cesium.Cartesian3.fromDegrees(Number(p.lon), Number(p.lat), 0),
        billboard: {
          image: probeIcon(p.ongoing),
          scale: 0.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      const item = probeItem(key, p);
      entity._live = item;
      entity._internet = item;
    }
    st[key].places = rows.length;
    st[key].probes = probeList.length;
    st[key].probesOffline = offline;
    st[key].count = rows.length + probeList.length;
  }

  function applyPack(body, probeBody) {
    pack = body;
    probes = probeBody;
    for (const key of KEYS) {
      st[key].ready = true;
      st[key].error = body && body.error && !(body[META[key].field] || []).length && !probeRows(key).length ? body.error : "";
      place(key);
      render(key);
    }
    if (lastShown) refreshOpenCard();
  }

  function refreshOpenCard() {
    // Keep an open card in step with fresh data, or close it if that outage dropped off.
    const box = document.getElementById("selected");
    if (!box || box.hidden || !lastShown) return;
    const rows = lastShown.probe ? probeRows(lastShown.layer) : ((pack && pack[META[lastShown.layer].field]) || []);
    const fresh = rows.find((p) => String(p.code) === String(lastShown.place.code));
    if (!fresh) return;
    lastShown = lastShown.probe ? probeItem(lastShown.layer, fresh) : itemFrom(lastShown.layer, fresh);
  }

  async function getJson(url) {
    const response = await fetch(`${url}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try { return JSON.parse(text); } catch (err) { throw new Error("the server sent a page instead of data"); }
  }

  async function load() {
    // IODA and RIPE Atlas load side by side; a RIPE Atlas failure keeps the IODA pins.
    const [ioda, ripe] = await Promise.allSettled([getJson(URL), getJson(PROBE_URL)]);
    if (ioda.status === "rejected" && ripe.status === "rejected") throw ioda.reason;
    const body = ioda.status === "fulfilled" ? ioda.value : { error: `IODA: ${ioda.reason && ioda.reason.message ? ioda.reason.message : ioda.reason}`, us: [], global: [] };
    const probeBody = ripe.status === "fulfilled" ? ripe.value : { error: ripe.reason && ripe.reason.message ? ripe.reason.message : String(ripe.reason), us: [], global: [] };
    applyPack(body, probeBody);
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

  function probeHtml(p) {
    const lines = [];
    lines.push(`Status: ${p.ongoing ? "Still offline" : "Back online"}`);
    lines.push(`Where: ${p.near ? `near ${p.near}, ` : ""}${p.country || p.cc || ""}${p.approx ? " (location guessed from its internet address)" : ""}`);
    lines.push(`Network: ${p.network ? p.network : "Unknown"}${p.asn ? ` (AS${p.asn})` : ""}`);
    lines.push(`Went offline: ${etTime(p.start)}`);
    if (p.ongoing) lines.push(`Offline so far: ${duration((Date.now() / 1000) - p.start)}`);
    else {
      lines.push(`Back online: ${etTime(p.end)}`);
      lines.push(`Was offline: ${duration(p.end - p.start)}`);
    }
    if (p.sameNetwork) lines.push(`Other probes on this network that dropped within 15 minutes: ${fmt(p.sameNetwork)}`);
    lines.push(`RIPE Atlas probe #${p.probe}`);
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    html += '<br><i class="infra-caption">This is one RIPE Atlas test device, often in a home or office. When it drops off, that one place may have lost power or internet, so this may be local only. Several probes on the same network dropping together points to a wider outage.</i>';
    html += "<br>Source: RIPE Atlas (RIPE NCC), atlas.ripe.net";
    return html;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    if (item.probe) return probeHtml(item.place || {});
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
