/* Global Status USGS earthquake layer.
 * Public GeoJSON summary feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 * Same module pattern as blast.js. No third-party globe code.
 * From Lee's feat/globalstatus-prod (PR #95, issue #81), adapted for the live
 * file set: label EARTHQUAKES, 60-second refresh while the layer is on.
 */
(function (root) {
  const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
  const POLL_MS = 60 * 1000;
  const CREDIT = "Earthquake data: USGS";

  function colorForMag(mag) {
    const value = Number(mag);
    if (!Number.isFinite(value) || value < 2.5) return "#f6e27a";
    if (value < 4) return "#f0c14a";
    if (value < 5) return "#f08a24";
    if (value < 6) return "#e25b12";
    if (value < 7) return "#c43212";
    return "#8b0000";
  }

  function sizeForMag(mag) {
    const value = Math.max(0, Number(mag) || 0);
    return Math.round(Math.min(36, Math.max(8, 3 + (value * value) / 2)));
  }

  function formatTime(ms) {
    const date = new Date(Number(ms));
    if (!Number.isFinite(date.getTime())) return "";
    try {
      return date.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        timeZoneName: "short",
      });
    } catch (err) {
      return date.toISOString();
    }
  }

  function parseFeature(feat) {
    if (!feat || typeof feat !== "object") return null;
    const coords = (feat.geometry && feat.geometry.coordinates) || [];
    const props = feat.properties || {};
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const mag = Number(props.mag);
    const place = props.place || "";
    const title = props.title || (Number.isFinite(mag) ? `M ${mag} - ${place}` : place);
    return {
      id: String(feat.id || props.code || title),
      lon,
      lat,
      depthKm: Number(coords[2]),
      mag: Number.isFinite(mag) ? mag : null,
      place,
      name: title,
      time: props.time,
      timeText: props.time != null ? formatTime(props.time) : "",
      url: props.url || "",
      color: colorForMag(mag),
      size: sizeForMag(mag),
      kind: "EARTHQUAKES",
    };
  }

  function parseCollection(body) {
    const features = body && Array.isArray(body.features) ? body.features : [];
    const points = [];
    for (const feat of features) {
      const point = parseFeature(feat);
      if (point) points.push(point);
    }
    return points;
  }

  let cache = { at: 0, points: [], error: null };
  let inflight = null;

  function fetchFeed(opts) {
    const force = Boolean(opts && opts.force);
    const now = Date.now();
    if (!force && cache.points.length && now - cache.at < POLL_MS) {
      return Promise.resolve({
        points: cache.points,
        cached: true,
        fetchedAt: cache.at,
        credit: CREDIT,
      });
    }
    if (inflight) return inflight;
    // The cache is reused for POLL_MS, so a 60 s timer fetches about once a minute.
    inflight = fetch(FEED, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`USGS quakes HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => {
        const points = parseCollection(body);
        cache = { at: Date.now(), points, error: null };
        return { points, cached: false, fetchedAt: cache.at, credit: CREDIT };
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  root.GsaQuakes = {
    FEED,
    POLL_MS,
    CREDIT,
    colorForMag,
    sizeForMag,
    formatTime,
    parseFeature,
    parseCollection,
    fetchFeed,
  };
})(typeof window !== "undefined" ? window : globalThis);
