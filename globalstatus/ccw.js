/* Global Status · FIREARMS > USA CONCEALED CARRY RECIPROCITY (saved, not a live feed).
 *
 * /api/ccw-reciprocity: 50 states + D.C. carry rules and who honors whose permit,
 * compiled from state Attorney General / State Police reciprocity pages (last verified
 * Nov 2026). /geo/us-states.json: Census state outlines, simplified.
 *
 * Turn the layer on, choose a permit state (list in the layer note or the banner on
 * the globe, or click a state), and every state is colored by what that permit means
 * there. Outlines lie flat on the globe; each carries its state center so cesium.js
 * cullAircraftHorizon hides the far side. Cards use the shared #selected box with
 * on-screen text only: no links.
 */
(function (root) {
  const KEY = "ccw";
  const KEYS = [KEY];
  const LABEL = "USA CONCEALED CARRY RECIPROCITY";
  const V = "20261126a";
  const DATA_URL = "/api/ccw-reciprocity?v=" + V;
  const GEO_URL = "/geo/us-states.json?v=" + V;
  const STORE = "gsa.ccw.permitState";
  const REL = {
    selected: { color: "#2f7bff", label: "Your permit state" },
    permitless: { color: "#1fae4b", label: "Permitless carry" },
    honored: { color: "#22c7b8", label: "Permit honored" },
    restricted: { color: "#f2b233", label: "Honored with restrictions" },
    not: { color: "#e5383b", label: "Not honored" },
  };
  const ORDER = ["selected", "permitless", "honored", "restricted", "not"];
  const NEUTRAL = "#9aa3b5";

  let ctx = null;
  let data = null;
  let geo = null;
  let loading = null;
  let source = null;
  let permit = "";
  let lastShown = null;
  let choosingFromCard = false;
  const entities = {};
  const st = { on: false, ready: false, error: "", count: null };
  try { permit = root.localStorage ? (root.localStorage.getItem(STORE) || "") : ""; } catch (err) { permit = ""; }

  function hidden() { return Boolean(root.gsProbeHidden && root.gsProbeHidden(KEY)); }
  function shown() { return st.on && !hidden(); }
  function viewer() { return ctx && ctx.viewer ? ctx.viewer() : null; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function states() { return data && data.states ? data.states : {}; }
  function nameOf(code) { return (states()[code] && states()[code].name) || code; }
  function codesSorted() { return Object.keys(states()).sort((a, b) => nameOf(a).localeCompare(nameOf(b))); }

  // What a permit from state P means in state D.
  function relation(p, d) {
    const S = states();
    const P = S[p];
    const D = S[d];
    if (!P || !D) return null;
    if (p === d) {
      return { rel: "selected", badge: "Your permit state", why: P.permitless && !P.permitlessResidentsOnly ? "Your home state. It also allows permitless carry for eligible adults." : "Your home state, where your permit was issued." };
    }
    if (D.permitless && !D.permitlessResidentsOnly) {
      return { rel: "permitless", badge: "Permitless carry", why: `${D.name} allows concealed carry without a permit. ${D.permitlessRule}` };
    }
    const h = D.honors || {};
    const pName = P.name;
    const age = h.age21 && !/\b21\b/.test(h.note || "") ? " The permit holder must be 21 or older." : "";
    if (P.noPermits && h.type !== "vehicle") {
      return { rel: "not", badge: "Not honored", why: `${pName} issues no carry permits, so there is no permit for ${D.name} to honor. A nonresident permit from a state ${D.name} honors would be needed.` };
    }
    if (h.type === "none") {
      return { rel: "not", badge: "Not honored", why: `${D.name} does not honor any out-of-state carry permits. Visitors need a ${D.name} nonresident license where one is offered.` };
    }
    if (h.type === "vehicle") {
      return { rel: "restricted", badge: "Vehicle only", why: h.note };
    }
    if (h.type === "all") {
      if (h.resident) return { rel: "restricted", badge: `Honored with restrictions (${pName} permit)`, why: `${h.note} Your permit counts only if you live in ${pName}; a nonresident permit is not honored.${age}` };
      return { rel: "honored", badge: `Honored (${pName} permit)`, why: `${h.note}${age}` };
    }
    if (h.type === "list") {
      if (!Array.isArray(h.list) || !h.list.includes(p)) {
        return { rel: "not", badge: "Not honored", why: `${D.name} does not honor ${pName} permits. ${h.note}` };
      }
      const limits = [];
      if (h.cls && h.cls[p]) limits.push(h.cls[p]);
      if (h.resident) limits.push(`only if you live in ${pName} (no nonresident permits)`);
      if (limits.length) {
        return { rel: "restricted", badge: `Honored with restrictions (${pName} permit)`, why: `${h.note} Limits for your permit: ${limits.join("; ")}.${age}` };
      }
      return { rel: "honored", badge: `Honored (${pName} permit)`, why: `${h.note}${age}` };
    }
    return { rel: "not", badge: "Not honored", why: `${D.name} does not honor ${pName} permits.` };
  }

  function counts() {
    const c = { selected: 0, permitless: 0, honored: 0, restricted: 0, not: 0 };
    if (!permit) return c;
    for (const d of Object.keys(states())) {
      const r = relation(permit, d);
      if (r) c[r.rel] += 1;
    }
    return c;
  }

  function selectHtml(attr) {
    const opts = codesSorted().map((code) => `<option value="${esc(code)}"${code === permit ? " selected" : ""}>${esc(nameOf(code))}</option>`).join("");
    return `<select class="ccw-select" ${attr} aria-label="Choose your permit state"><option value="">Choose your permit state…</option>${opts}</select>`;
  }

  function countText() {
    if (!shown()) return "—";
    if (!st.ready) return "…";
    if (!permit) return "PICK";
    return String(permit);
  }

  function legendHtml() {
    return ORDER.map((k) => `<span class="io-key" style="--io:${REL[k].color}"></span>${esc(REL[k].label)}`).join(" ");
  }

  function summaryText() {
    const c = counts();
    return `${c.permitless + c.honored} permitless or honored · ${c.restricted} with restrictions · ${c.not} not honored`;
  }

  function render() {
    const note = document.querySelector(`[data-ccw-note="${KEY}"]`);
    if (note) {
      note.hidden = !shown();
      if (shown()) {
        const bits = [];
        if (!st.ready && !st.error) bits.push("Loading…");
        if (st.error) bits.push(`<span class="sw-err">${esc(st.error)}</span>`);
        if (st.ready) {
          bits.push(`<b>${permit ? "Permit state" : "Choose your permit state"}</b> ${selectHtml("data-ccw-select")}${permit ? "" : " or click a state on the globe."}`);
          if (permit) {
            bits.push(legendHtml());
            bits.push(`${esc(nameOf(permit))} permit: ${esc(summaryText())}. Click any state for its rules.`);
          }
          bits.push(`Last verified: ${esc(data.verified || "Nov 2026")}. Not legal advice — verify with state authorities before traveling. Source: ${esc(data.source)}.`);
        }
        note.innerHTML = bits.join(" · ");
      }
    }
    const banner = document.getElementById("ccw-banner");
    if (banner) {
      banner.hidden = !(shown() && st.ready);
      if (!banner.hidden) {
        banner.innerHTML = permit
          ? `<span class="ccw-banner-text">${esc(nameOf(permit))} permit · ${esc(summaryText())}</span>${selectHtml("data-ccw-select")}`
          : `<span class="ccw-banner-text"><b>Choose your permit state</b> or tap a state</span>${selectHtml("data-ccw-select")}`;
      }
    }
    if (ctx && ctx.setCount) ctx.setCount(KEY, countText());
    if (typeof root.gsSyncLayerGroups === "function") root.gsSyncLayerGroups();
    const host = document.getElementById("cesium");
    if (host) host.dataset[KEY] = permit || "";
  }

  function colorFor(code) {
    if (!permit) return { fill: NEUTRAL, alpha: 0.22 };
    const r = relation(permit, code);
    return { fill: r ? REL[r.rel].color : NEUTRAL, alpha: r && r.rel === "selected" ? 0.6 : 0.45 };
  }

  function build() {
    const Cesium = root.Cesium;
    if (!source || !Cesium || !geo || !data) return;
    source.entities.removeAll();
    for (const k of Object.keys(entities)) delete entities[k];
    for (const [code, s] of Object.entries(geo.states || {})) {
      if (!states()[code]) continue;
      const center = Cesium.Cartesian3.fromDegrees(s.c[0], s.c[1], 0);
      entities[code] = [];
      for (const ring of s.rings || []) {
        const flat = [];
        for (const pt of ring) flat.push(pt[0], pt[1]);
        const positions = Cesium.Cartesian3.fromDegreesArray(flat);
        // Flat on the ground; the state center lets the horizon cull hide far-side states.
        const entity = source.entities.add({
          name: nameOf(code),
          position: center,
          polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: Cesium.Color.fromCssColorString(NEUTRAL).withAlpha(0.22) },
          polyline: { positions: positions.concat([positions[0]]), width: 1.2, material: Cesium.Color.WHITE.withAlpha(0.65), clampToGround: true },
        });
        const item = { ccw: true, layer: KEY, code, name: nameOf(code), kind: LABEL, lat: s.c[1], lon: s.c[0] };
        entity._live = item;
        entity._ccw = item;
        entities[code].push(entity);
      }
    }
    paint();
  }

  function paint() {
    const Cesium = root.Cesium;
    if (!Cesium) return;
    for (const [code, list] of Object.entries(entities)) {
      const c = colorFor(code);
      const color = Cesium.Color.fromCssColorString(c.fill).withAlpha(c.alpha);
      const line = code === permit ? Cesium.Color.fromCssColorString("#ffffff") : Cesium.Color.WHITE.withAlpha(0.65);
      for (const e of list) {
        e.polygon.material = color;
        e.polyline.material = line;
        e.polyline.width = code === permit ? 3 : 1.2;
      }
    }
    st.count = permit ? 1 : 0;
  }

  function choose(code) {
    permit = states()[code] ? code : "";
    try { if (root.localStorage) root.localStorage.setItem(STORE, permit); } catch (err) { /* private mode */ }
    paint();
    render();
    // An open state card described the old permit state: close it.
    if (lastShown && !choosingFromCard) hidePopup();
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try { return JSON.parse(text); } catch (err) { throw new Error("the server sent a page instead of data"); }
  }

  function ensureLoaded() {
    if (st.ready) return Promise.resolve();
    if (!loading) {
      loading = Promise.all([getJson(DATA_URL), getJson(GEO_URL)])
        .then(([d, g]) => {
          data = d;
          geo = g;
          if (permit && !states()[permit]) permit = "";
          st.ready = true;
          st.error = "";
          build();
          render();
        })
        .catch((error) => {
          st.error = `${LABEL}: ${error && error.message ? error.message : String(error)}. Switch it off and on to try again.`;
          render();
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function popupHtml(item, opts) {
    if (!(opts && opts.list)) lastShown = item;
    const S = states();
    const D = S[item.code];
    if (!D) return "";
    if (!permit) {
      // First tap on a state picks it as the permit state.
      if (!(opts && opts.list)) {
        choosingFromCard = true;
        choose(item.code);
        choosingFromCard = false;
      }
      const c = counts();
      return `<span data-ccw-card></span><br><b>Permit state set to ${esc(D.name)}</b><br>The globe now shows where a ${esc(D.name)} permit works: ${esc(String(c.permitless + c.honored))} permitless or honored, ${esc(String(c.restricted))} with restrictions, ${esc(String(c.not))} not honored. Tap any state for its rules, or change the permit state in the list.<br><i class="infra-caption">Not legal advice — verify with state authorities before traveling.</i>`;
    }
    const r = relation(permit, item.code);
    const color = REL[r.rel].color;
    const lines = [];
    lines.push(`<span class="ccw-badge" style="--ccw:${color}">${esc(r.badge)}</span>`);
    lines.push(`<b>Why</b><br>${esc(r.why)}`);
    lines.push("<b>Key rules</b>");
    lines.push(`Permitless carry: ${esc(D.permitless ? (D.permitlessResidentsOnly ? "Residents only. " : "Yes. ") + D.permitlessRule : D.permitlessRule)}`);
    lines.push(`Minimum age: ${esc(D.minAge)}`);
    lines.push(`Duty to inform an officer: ${esc(D.inform)}`);
    lines.push(`Restricted places: ${esc(D.places)}`);
    if (D.honors && D.honors.note && r.rel !== "permitless") lines.push(`Who ${esc(D.name)} honors: ${esc(D.honors.note)}`);
    lines.push(`Last verified: ${esc(data.verified || "Nov 2026")}`);
    lines.push('<i class="infra-caption">Not legal advice — verify with state authorities before traveling.</i>');
    lines.push(`Source: ${esc(data.source)}`);
    return `<span data-ccw-card></span>${lines.map((l) => `<br>${l}`).join("")}`;
  }

  function hidePopup() {
    if (!lastShown) return;
    const box = document.getElementById("selected");
    if (box && document.querySelector("#selected-body [data-ccw-card]")) box.hidden = true;
    lastShown = null;
  }

  function setActive(key, on) {
    if (key !== KEY) return;
    st.on = Boolean(on);
    if (source) source.show = shown();
    if (!st.on) hidePopup();
    render();
    if (st.on) ensureLoaded().then(() => render());
  }

  function sourceFor(key) { return key === KEY ? source : null; }

  function statusParts() {
    if (!shown()) return [];
    return [permit ? `${LABEL} · ${nameOf(permit).toUpperCase()}` : `${LABEL} · CHOOSE A STATE`];
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
    // One listener for every permit-state list (layer note and globe banner).
    document.addEventListener("change", (event) => {
      const el = event.target;
      if (el && el.matches && el.matches("[data-ccw-select]")) choose(el.value);
    });
    render();
  }

  root.GsaCcw = { KEYS, init, setActive, sourceFor, popupHtml, statusParts, relation, choose, state: st, labels: { [KEY]: LABEL } };
})(typeof window !== "undefined" ? window : globalThis);
