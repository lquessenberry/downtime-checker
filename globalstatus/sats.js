/* Global Status SATELLITES layer.
 * Orbits: CelesTrak GP data in OMM JSON (https://celestrak.org/NORAD/documentation/gp-data-formats.php).
 * Positions: satellite.js (MIT, vendored at /vendor/satellite.js/), loaded only when the layer is turned on.
 * CelesTrak refreshes GP data about every 2 hours and asks clients not to re-download it more often,
 * so the parsed elements are cached in localStorage for CACHE_MS.
 */
(function (root) {
  const BASE = "https://celestrak.org/NORAD/elements/gp.php";
  const LIB_URL = "/vendor/satellite.js/satellite.min.js";
  const CACHE_KEY = "gsa.sats.v1";
  const CACHE_MS = 4 * 60 * 60 * 1000;
  const CREDIT = "Orbits: CelesTrak · positions: satellite.js";
  // Starlink has 10,000+ objects. Keep a spread-out sample so phones stay smooth.
  const STARLINK_KEEP = 400;
  const STARLINK_PHONE = 80;
  const GROUPS = [
    { id: "stations", label: "SPACE STATIONS", color: "#ffffff", size: 9 },
    { id: "gps-ops", label: "GPS", color: "#8fe04a", size: 7 },
    { id: "visual", label: "BRIGHTEST", color: "#7fe0ff", size: 6 },
    { id: "starlink", label: "STARLINK", color: "#9aa7c7", size: 4 },
  ];
  const KEEP_FIELDS = [
    "OBJECT_NAME", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION",
    "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "EPHEMERIS_TYPE", "CLASSIFICATION_TYPE",
    "NORAD_CAT_ID", "ELEMENT_SET_NO", "REV_AT_EPOCH", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT",
  ];

  function slim(omm) {
    const out = {};
    for (const key of KEEP_FIELDS) if (omm[key] != null) out[key] = omm[key];
    return out;
  }

  function thin(list, keep) {
    if (!Array.isArray(list) || list.length <= keep) return list || [];
    const step = list.length / keep;
    const out = [];
    for (let i = 0; i < keep; i += 1) out.push(list[Math.floor(i * step)]);
    return out;
  }

  let libPromise = null;
  function loadLib() {
    if (root.satellite && root.satellite.json2satrec) return Promise.resolve(root.satellite);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = LIB_URL;
      tag.async = true;
      tag.onload = () => (root.satellite ? resolve(root.satellite) : reject(new Error("SATELLITES: satellite.js missing")));
      tag.onerror = () => {
        libPromise = null;
        reject(new Error("SATELLITES: could not load satellite.js"));
      };
      document.head.appendChild(tag);
    });
    return libPromise;
  }

  function readCache() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const body = JSON.parse(raw);
      if (!body || !body.groups || Date.now() - Number(body.at) > CACHE_MS) return null;
      return body;
    } catch (err) {
      return null;
    }
  }

  function writeCache(body) {
    try {
      root.localStorage.setItem(CACHE_KEY, JSON.stringify(body));
    } catch (err) {
      /* Private mode or full storage: still works, just re-downloads next visit. */
    }
  }

  async function fetchGroup(id) {
    const response = await fetch(`${BASE}?GROUP=${encodeURIComponent(id)}&FORMAT=json`);
    if (!response.ok) throw new Error(`CelesTrak ${id} HTTP ${response.status}`);
    const text = await response.text();
    // CelesTrak answers with plain text (not JSON) when a group has not changed or a client is throttled.
    if (!text.trim().startsWith("[")) throw new Error(`CelesTrak ${id}: ${text.trim().slice(0, 80)}`);
    return JSON.parse(text);
  }

  let inflight = null;
  async function fetchElements() {
    const cached = readCache();
    if (cached) return { groups: cached.groups, fetchedAt: cached.at, cached: true };
    if (inflight) return inflight;
    inflight = (async () => {
      const groups = {};
      const errors = [];
      const settled = await Promise.allSettled(GROUPS.map((group) => fetchGroup(group.id)));
      settled.forEach((result, index) => {
        const id = GROUPS[index].id;
        if (result.status === "fulfilled") {
          const list = id === "starlink" ? thin(result.value, STARLINK_KEEP) : result.value;
          groups[id] = list.map(slim);
        } else {
          errors.push(result.reason && result.reason.message ? result.reason.message : String(result.reason));
        }
      });
      if (!Object.keys(groups).length) throw new Error(errors[0] || "CelesTrak unavailable");
      const at = Date.now();
      // Only cache a complete set, so a partial failure is retried next time.
      if (!errors.length) writeCache({ at, groups });
      return { groups, fetchedAt: at, cached: false, errors };
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  // Builds one record per satellite with a satrec, deduped by NORAD id (GPS and brightest overlap with stations).
  function buildRecords(lib, groups, phone) {
    const seen = new Set();
    const records = [];
    for (const group of GROUPS) {
      let list = groups[group.id] || [];
      if (group.id === "starlink" && phone) list = thin(list, STARLINK_PHONE);
      for (const omm of list) {
        const norad = Number(omm.NORAD_CAT_ID);
        if (!norad || seen.has(norad)) continue;
        let satrec;
        try {
          satrec = lib.json2satrec(omm);
        } catch (err) {
          continue;
        }
        if (!satrec || satrec.error) continue;
        seen.add(norad);
        records.push({
          id: `sat-${norad}`,
          norad,
          name: String(omm.OBJECT_NAME || norad).trim(),
          intl: omm.OBJECT_ID || "",
          epoch: omm.EPOCH || "",
          group: group.id,
          groupLabel: group.label,
          color: group.color,
          size: group.size,
          satrec,
          lat: null,
          lon: null,
          altKm: null,
          speedKms: null,
        });
      }
    }
    return records;
  }

  // Updates lat/lon/altKm in place. Returns how many have a valid position.
  function propagateAll(lib, records, date) {
    const gmst = lib.gstime(date);
    let ok = 0;
    for (const rec of records) {
      const pv = lib.propagate(rec.satrec, date);
      const pos = pv && pv.position;
      if (!pos || typeof pos !== "object" || !Number.isFinite(pos.x)) {
        rec.lat = null;
        continue;
      }
      const geo = lib.eciToGeodetic(pos, gmst);
      rec.lat = lib.degreesLat(geo.latitude);
      rec.lon = lib.degreesLong(geo.longitude);
      rec.altKm = geo.height;
      const vel = pv.velocity;
      rec.speedKms = vel && Number.isFinite(vel.x) ? Math.hypot(vel.x, vel.y, vel.z) : null;
      if (Number.isFinite(rec.lat) && Number.isFinite(rec.lon) && Number.isFinite(rec.altKm)) ok += 1;
      else rec.lat = null;
    }
    return ok;
  }

  root.GsaSats = {
    BASE,
    CACHE_KEY,
    CACHE_MS,
    CREDIT,
    GROUPS,
    STARLINK_KEEP,
    STARLINK_PHONE,
    thin,
    loadLib,
    fetchElements,
    buildRecords,
    propagateAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
