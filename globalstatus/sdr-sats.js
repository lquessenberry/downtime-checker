/* Global Status · SDR amateur satellites with Doppler (Phase 2, receive only)
 *
 * Loaded only when the AMATEUR SATELLITES (DOPPLER) layer is switched on. Orbits are CelesTrak
 * GP elements (amateur group, cached 4 h in localStorage, small built-in fallback set); positions
 * use the vendored satellite.js (MIT) SGP4 already used by the SATELLITES layer. Doppler-corrected
 * downlink frequencies are worked out from the receiver position. No radio is needed for the map;
 * with a radio connected the Voice & Ham tab can tune (and follow) a pass. Original code for Global Status App.
 */
(function (root) {
  "use strict";
  const URL_ELEMENTS = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=json";
  const CACHE_KEY = "gsa.sdrsats.v1", CACHE_MS = 4 * 3600e3, C_KMS = 299792.458;
  // Known downlinks (MHz) for popular amateur satellites, by NORAD id.
  const DOWNLINKS = {
    25544: [145.8, "FM voice / SSTV (ISS)"], 27607: [436.795, "FM repeater"], 43017: [145.96, "FM repeater"], 22825: [436.795, "FM repeater"],
    7530: [145.95, "Linear transponder (mode B)"], 39444: [145.935, "Telemetry beacon"], 40967: [145.98, "FM repeater"], 44909: [435.64, "Linear transponder"],
    43678: [145.9, "FM repeater"], 43137: [436.555, "FM repeater"], 53106: [435.31, "FM / digipeater"], 57166: [137.9, "LRPT weather images"],
  };
  const FALLBACK = [{"OBJECT_NAME":"OSCAR 7 (AO-7)","OBJECT_ID":"1974-089B","EPOCH":"2026-11-27T12:14:06.681984","MEAN_MOTION":12.53700789,"ECCENTRICITY":0.0012267,"INCLINATION":101.9861,"RA_OF_ASC_NODE":346.4343,"ARG_OF_PERICENTER":178.6674,"MEAN_ANOMALY":337.3985,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":7530,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":38098,"BSTAR":-2.3088835e-05,"MEAN_MOTION_DOT":-5e-07,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"EYESAT A (AO-27)","OBJECT_ID":"1993-061C","EPOCH":"2026-11-27T09:50:16.823616","MEAN_MOTION":14.30977435,"ECCENTRICITY":0.00080191,"INCLINATION":98.6702,"RA_OF_ASC_NODE":38.6028,"ARG_OF_PERICENTER":348.9464,"MEAN_ANOMALY":11.1541,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":22825,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":73034,"BSTAR":3.5082274e-05,"MEAN_MOTION_DOT":4.8e-07,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"ISS (ZARYA)","OBJECT_ID":"1998-067A","EPOCH":"2026-11-27T09:29:25.185696","MEAN_MOTION":15.49633135,"ECCENTRICITY":0.00073872,"INCLINATION":51.6311,"RA_OF_ASC_NODE":212.4074,"ARG_OF_PERICENTER":70.5574,"MEAN_ANOMALY":289.6212,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":25544,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":59705,"BSTAR":0.0001007531,"MEAN_MOTION_DOT":5.227e-05,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"SAUDISAT 1C (SO-50)","OBJECT_ID":"2002-058C","EPOCH":"2026-11-26T10:45:44.129088","MEAN_MOTION":14.83367165,"ECCENTRICITY":0.00669871,"INCLINATION":64.5528,"RA_OF_ASC_NODE":346.8404,"ARG_OF_PERICENTER":232.41,"MEAN_ANOMALY":127.0913,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":27607,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":28852,"BSTAR":8.0158441e-05,"MEAN_MOTION_DOT":5.28e-06,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"FUNCUBE-1 (AO-73)","OBJECT_ID":"2013-066AE","EPOCH":"2026-11-27T10:02:54.813408","MEAN_MOTION":15.11501916,"ECCENTRICITY":0.00351935,"INCLINATION":97.8485,"RA_OF_ASC_NODE":306.7083,"ARG_OF_PERICENTER":10.7167,"MEAN_ANOMALY":349.4804,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":39444,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":70430,"BSTAR":0.00029454002,"MEAN_MOTION_DOT":4.991e-05,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"FOX-1A (AO-85)","OBJECT_ID":"2015-058D","EPOCH":"2026-11-27T10:26:33.366624","MEAN_MOTION":14.91770371,"ECCENTRICITY":0.01467482,"INCLINATION":64.7716,"RA_OF_ASC_NODE":131.3123,"ARG_OF_PERICENTER":357.4396,"MEAN_ANOMALY":2.5947,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":40967,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":13791,"BSTAR":7.8850012e-05,"MEAN_MOTION_DOT":7.9e-06,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"RADFXSAT (FOX-1B)","OBJECT_ID":"2017-073E","EPOCH":"2026-11-27T08:15:47.190816","MEAN_MOTION":15.14997897,"ECCENTRICITY":0.01455902,"INCLINATION":97.4431,"RA_OF_ASC_NODE":195.2256,"ARG_OF_PERICENTER":123.6503,"MEAN_ANOMALY":237.8715,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":43017,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":49007,"BSTAR":0.00015703638,"MEAN_MOTION_DOT":3.756e-05,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"DIWATA-2B","OBJECT_ID":"2018-084H","EPOCH":"2026-11-27T14:14:10.803840","MEAN_MOTION":15.00980381,"ECCENTRICITY":0.00117129,"INCLINATION":98.1158,"RA_OF_ASC_NODE":174.9935,"ARG_OF_PERICENTER":356.0426,"MEAN_ANOMALY":4.0702,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":43678,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":44072,"BSTAR":0.00011893211,"MEAN_MOTION_DOT":1.453e-05,"MEAN_MOTION_DDOT":0},{"OBJECT_NAME":"RS-44 & BREEZE-KM R/B","OBJECT_ID":"2019-096E","EPOCH":"2026-11-27T02:07:50.812320","MEAN_MOTION":12.79750147,"ECCENTRICITY":0.02183377,"INCLINATION":82.5224,"RA_OF_ASC_NODE":231.4465,"ARG_OF_PERICENTER":123.3166,"MEAN_ANOMALY":238.9053,"EPHEMERIS_TYPE":0,"CLASSIFICATION_TYPE":"U","NORAD_CAT_ID":44909,"ELEMENT_SET_NO":999,"REV_AT_EPOCH":32318,"BSTAR":0.0001174308,"MEAN_MOTION_DOT":4.2e-07,"MEAN_MOTION_DDOT":0}];
  let lib = null, recs = null, timer = 0, token = 0, fetchedAt = 0, source = "";
  function loadLib() {
    if (root.satellite && root.satellite.json2satrec) return Promise.resolve(root.satellite);
    if (root.GsaSats && root.GsaSats.loadLib) return root.GsaSats.loadLib();
    return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = "/vendor/satellite.js/satellite.min.js"; s.async = true; s.onload = () => (root.satellite ? resolve(root.satellite) : reject(new Error("satellite.js missing"))); s.onerror = () => reject(new Error("could not load satellite.js")); document.head.appendChild(s); });
  }
  async function elements() {
    try { const c = JSON.parse(root.localStorage.getItem(CACHE_KEY) || "null"); if (c && Date.now() - c.at < CACHE_MS && Array.isArray(c.list) && c.list.length) { fetchedAt = c.at; source = "CelesTrak (cached)"; return c.list; } } catch (e) { /* no cache */ }
    try {
      const r = await fetch(URL_ELEMENTS, { cache: "no-store" });
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) { fetchedAt = Date.now(); source = "CelesTrak"; try { root.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: fetchedAt, list })); } catch (e) { /* storage full */ } return list; } }
    } catch (e) { /* offline: use the built-in set */ }
    fetchedAt = Date.parse(FALLBACK[0].EPOCH + "Z") || Date.now(); source = "built-in elements (older, approximate)";
    return FALLBACK;
  }
  function look(sat, date, rx) {
    const pv = lib.propagate(sat, date);
    if (!pv || !pv.position || typeof pv.position !== "object") return null;
    const gmst = lib.gstime(date), gd = lib.eciToGeodetic(pv.position, gmst);
    const out = { lat: lib.degreesLat(gd.latitude), lon: lib.degreesLong(gd.longitude), altKm: gd.height };
    if (rx) {
      const obs = { latitude: (rx.lat * Math.PI) / 180, longitude: (rx.lon * Math.PI) / 180, height: 0.01 };
      const la = lib.ecfToLookAngles(obs, lib.eciToEcf(pv.position, gmst));
      out.az = (la.azimuth * 180) / Math.PI; out.el = (la.elevation * 180) / Math.PI; out.rangeKm = la.rangeSat;
    }
    return out;
  }
  function update(rx, onUpdate) {
    if (!recs) return;
    const now = new Date(), later = new Date(now.getTime() + 1000);
    for (const r of recs) {
      const a = look(r.satrec, now, rx);
      if (!a) { r.lat = NaN; continue; }
      Object.assign(r, a);
      if (rx) {
        const b = look(r.satrec, later, rx);
        r.rangeRate = b ? b.rangeKm - a.rangeKm : 0; // km/s, positive = moving away
        if (r.downlink) r.doppler = r.downlink * 1e6 * (-r.rangeRate / C_KMS);
        r.visible = r.el > 0;
      }
      if (!r.trackAt || now - r.trackAt > 60e3) { // ground track for the next 20 minutes
        r.trackAt = now.getTime(); r.track = [];
        for (let m = 0; m <= 20; m += 1) { const p = look(r.satrec, new Date(now.getTime() + m * 60e3)); if (p) r.track.push([p.lon, p.lat]); }
      }
    }
    onUpdate(recs);
  }
  async function start(rxFn, onUpdate, onError) {
    const my = ++token;
    try {
      lib = await loadLib();
      if (!recs) {
        const list = await elements();
        recs = [];
        for (const omm of list) { try { const satrec = lib.json2satrec(omm); const id = omm.NORAD_CAT_ID, dl = DOWNLINKS[id]; recs.push({ id: "sat" + id, norad: id, name: omm.OBJECT_NAME, epoch: omm.EPOCH, satrec, downlink: dl ? dl[0] : null, service: dl ? dl[1] : "" }); } catch (e) { /* bad element set */ } }
      }
      if (my !== token) return;
      update(rxFn(), onUpdate);
      clearInterval(timer);
      timer = setInterval(() => update(rxFn(), onUpdate), 2000);
    } catch (e) { if (onError) onError(e); }
  }
  function stop() { token += 1; clearInterval(timer); timer = 0; }
  root.GsaSdrSats = { start, stop, DOWNLINKS, info: () => ({ source, fetchedAt, count: recs ? recs.length : 0 }), list: () => recs || [] };
})(window);
