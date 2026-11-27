/* Global Status · TRANSPORTATION > FAA TFR (live).
 *
 * FAA temporary flight restrictions (tfr.faa.gov). The server keeps
 * data/tfr-cache.json (poll-lib.php gsa_tfr_refresh, five-minute cron, at most
 * every 10 minutes) and answers /api/faa-tfr. This file re-reads that every
 * 5 minutes while the layer is on.
 *
 * Each restricted area is drawn flat on the ground, colored by TFR type, with a
 * pin at its center. Pins have the depth test off, so cesium.js
 * cullAircraftHorizon hides the ones (and their areas) behind the earth. Cards
 * use the shared #selected box (close X, scrolls) with on-screen text only: no
 * links. Nationwide notices the FAA publishes without a shape are counted in
 * the layer note but not drawn.
 */
(function (root) {
  const KEY = "tfr";
  const KEYS = [KEY];
  const URL = "/api/faa-tfr";
  const LABEL = "FAA TFR";
  const REFRESH_MS = 5 * 60 * 1000;
  const TYPES = {
    "SECURITY": { color: "#ff4d4d", label: "Security" },
    "VIP": { color: "#ff4fd8", label: "VIP" },
    "HAZARDS": { color: "#ff9b2f", label: "Hazards" },
    "SPACE OPERATIONS": { color: "#a78bfa", label: "Space operations" },
    "AIR SHOWS/SPORTS": { color: "#ffd84a", label: "Air shows / sports" },
    "UAS PUBLIC GATHERING": { color: "#4ade80", label: "UAS public gathering" },
    "SPECIAL": { color: "#38d6ff", label: "Special" },
  };
  const OTHER = { color: "#c0c4cc", label: "Other" };
  const OUTLINE = "#1a1d27";

  let ctx = null;
  let pack = null;
  let loading = null;
  let timer = null;
  let lastShown = null;
  let source = null;
  const st = { on: false, ready: false, error: "", count: null };

  function typeOf(t) { return TYPES[t] || OTHER; }
  function typeLabel(t) { return TYPES[t] ? TYPES[t].label : (t ? t.charAt(0) + t.slice(1).toLowerCase() : OTHER.label); }
  function hidden() { return Boolean(root.gsProbeHidden && root.gsProbeHidden(KEY)); }
  function shown() { return st.on && !hidden(); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function etTime(sec) {
    if (!sec) return "";
    return `${new Date(sec * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
  }
  function rows() { return (pack && Array.isArray(pack.tfrs)) ? pack.tfrs : []; }
  function status(t) {
    const d = t.detail || {};
    const now = Date.now() / 1000;
    if (d.start && d.start > now) return "upcoming";
    if (d.end && d.end < now) return "expired";
    return "active";
  }

  function countText() {
    if (!shown()) return "—";
    if (st.count == null) return "…";
    return fmt(st.count);
  }

  function render() {
    const note = document.querySelector(`[data-tfr-note="${KEY}"]`);
    if (note) {
      note.hidden = !shown();
      if (shown()) {
        // On-screen credit only: no links that leave globalstatus.app.
        const bits = ["Source: FAA Temporary Flight Restrictions (tfr.faa.gov). Live, checked every 5 to 10 minutes."];
        const used = new Set(rows().map((t) => t.type));
        const key = Object.entries(TYPES).filter(([k]) => used.has(k) || !st.ready).map(([, v]) => `<span class="io-key" style="--io:${v.color}"></span>${esc(v.label)}`);
        if (rows().some((t) => !TYPES[t.type])) key.push(`<span class="io-key" style="--io:${OTHER.color}"></span>${OTHER.label}`);
        if (key.length) bits.push(key.join(" ") + " · faded = not yet in effect");
        if (st.ready) {
          const all = rows();
          const active = all.filter((t) => status(t) === "active").length;
          bits.push(all.length ? `${fmt(all.length)} mapped ${all.length === 1 ? "TFR" : "TFRs"}: ${fmt(active)} in effect now, ${fmt(all.length - active)} upcoming` : "No mapped TFRs right now");
          const textOnly = (pack && Array.isArray(pack.textOnly)) ? pack.textOnly.length : 0;
          if (textOnly) bits.push(`${fmt(textOnly)} more FAA ${textOnly === 1 ? "notice has" : "notices have"} no map shape (mostly nationwide notices) and ${textOnly === 1 ? "is" : "are"} not drawn`);
          if (pack && pack.updated) bits.push(`Updated ${esc(etTime(Date.parse(pack.updated) / 1000))}${pack.stale ? " (stale)" : ""}`);
          bits.push("Not for flight planning");
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

  // City plus state, without repeating a state the city text already names ("WASHINGTON, DC.").
  function placeName(t) {
    const d = t.detail || {};
    let where = String(d.city || "").replace(/[.,\s]+$/, "");
    const stateText = t.state || d.stateName || "";
    if (stateText && !new RegExp(`\\b${stateText.replace(/[^A-Za-z ]/g, "")}\\b`, "i").test(where)) where = [where, stateText].filter(Boolean).join(", ");
    return where;
  }

  function itemFrom(t) {
    const where = placeName(t);
    return {
      tfr: true,
      layer: KEY,
      kind: `TFR · ${typeLabel(t.type).toUpperCase()}`,
      name: where || t.title || t.id,
      lat: t.lat,
      lon: t.lon,
      place: t,
    };
  }

  function place() {
    const Cesium = root.Cesium;
    if (!source || !Cesium) return;
    source.entities.removeAll();
    source.show = shown();
    let n = 0;
    for (const t of rows()) {
      if (t.lat == null || t.lon == null || t.status === "expired" || status(t) === "expired") continue;
      const ty = typeOf(t.type);
      const live = status(t) === "active";
      const color = Cesium.Color.fromCssColorString(ty.color);
      const item = itemFrom(t);
      const center = Cesium.Cartesian3.fromDegrees(Number(t.lon), Number(t.lat), 0);
      for (const ring of t.areas || []) {
        const flat = [];
        for (const pt of ring) flat.push(Number(pt[0]), Number(pt[1]));
        const positions = Cesium.Cartesian3.fromDegreesArray(flat);
        // Flat on the ground (no height), so it lies on the globe or terrain.
        // The entity carries the TFR center so the horizon cull hides it with its pin.
        const area = source.entities.add({
          name: t.id,
          position: center,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color.withAlpha(live ? 0.28 : 0.12),
          },
          polyline: {
            positions: positions.concat([positions[0]]),
            width: live ? 2 : 1.5,
            material: color.withAlpha(live ? 0.95 : 0.55),
            clampToGround: true,
          },
        });
        area._live = item;
        area._tfr = item;
      }
      const pin = source.entities.add({
        name: item.name,
        position: center,
        point: {
          pixelSize: live ? 11 : 9,
          color: color.withAlpha(live ? 1 : 0.5),
          outlineColor: Cesium.Color.fromCssColorString(live ? OUTLINE : ty.color),
          outlineWidth: live ? 1.5 : 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      pin._live = item;
      pin._tfr = item;
      n += 1;
    }
    st.count = n;
  }

  function applyPack(body) {
    pack = body;
    st.ready = true;
    st.error = body && body.error && !rows().length ? body.error : "";
    place();
    render();
    refreshOpenCard();
  }

  function refreshOpenCard() {
    const box = document.getElementById("selected");
    if (!box || box.hidden || !lastShown) return;
    const fresh = rows().find((t) => t.id === lastShown.place.id);
    if (fresh) lastShown = itemFrom(fresh);
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

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const t = item.place || {};
    const d = t.detail || {};
    const s = status(t);
    const lines = [];
    lines.push(`Type: ${typeLabel(t.type)}`);
    lines.push(`Status: ${s === "upcoming" ? "Not yet in effect" : s === "expired" ? "Expired" : "In effect now"}`);
    lines.push(`NOTAM: FDC ${t.id}`);
    if (t.facility) lines.push(`Facility: ${t.facility}`);
    const where = placeName(t);
    if (where) lines.push(`Location: ${where}`);
    if (d.name && d.name !== t.id) lines.push(`Name: ${d.name}`);
    if (d.start) lines.push(`Effective: ${etTime(d.start)}`);
    else lines.push("Effective: Now");
    lines.push(`Expires: ${d.end ? etTime(d.end) : "Until further notice"}`);
    if (d.regulation) lines.push(`Rule: ${d.regulation}`);
    let html = lines.map((line) => `<br>${esc(line)}`).join("");
    const areas = Array.isArray(d.areas) ? d.areas : [];
    if (areas.length) {
      html += `<br><b>${areas.length === 1 ? "Altitudes" : "Areas and altitudes"}</b>`;
      for (const a of areas) {
        const alt = a.floor || a.ceiling ? `${a.floor || "?"} to ${a.ceiling || "?"}` : "Altitudes not given";
        const when = a.start && a.end && (a.start !== d.start || a.end !== d.end) ? ` (${etTime(a.start)} to ${etTime(a.end)})` : "";
        html += `<br>· ${areas.length > 1 && a.name ? `${esc(a.name)}: ` : ""}${esc(alt)}${esc(when)}`;
      }
    }
    if (t.title) html += `<br><b>Description</b><br>${esc(t.title)}`;
    if (d.text) html += `<br><b>NOTAM text</b><br><span class="tfr-text">${esc(d.text)}</span>`;
    if (!t.detail) html += "<br><i class=\"infra-caption\">Details for this TFR did not load from the FAA this time; they are tried again every 10 minutes.</i>";
    html += '<br><i class="infra-caption">Times are converted to Eastern Time. Not for flight planning; pilots must check the official NOTAM.</i>';
    html += "<br>Source: FAA Temporary Flight Restrictions (tfr.faa.gov)";
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

  root.GsaTfr = {
    KEYS,
    init,
    setActive,
    sourceFor,
    popupHtml,
    statusParts,
    state: st,
    labels: { [KEY]: LABEL },
  };
})(typeof window !== "undefined" ? window : globalThis);
