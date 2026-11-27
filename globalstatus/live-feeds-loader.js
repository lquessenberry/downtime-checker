/* Global Status · LIVE FEEDS loader (NOAA / USGS / EPA / FAA / NIFC / EMSC / snapshots)
 *
 * points  GeoJSON URLs, ArcGIS FeatureServer layers (paged), or a static snapshot in
 *         layers-data/snapshots/ (feeds without CORS: GVP volcanoes, NDBC buoys, AERONET).
 *         Polygon features become a pin at their centre.
 * shapes  Polygons from ArcGIS FeatureServer layers (generalised on the server), drawn
 *         with Cesium GeoJsonDataSource. Several sources can make one layer.
 * lines   Large polyline sets (FAA ATS routes: ~18,000), drawn as one PolylineCollection.
 *
 * Every request is wrapped: a failing source shows "ERR" and a plain note in the menu,
 * never an exception. Cards are plain text built from a fixed list of fields per layer.
 * Live layers with a refresh interval reload while on and the tab is visible.
 */
(function (root) {
  const timers = new Map();

  async function getJson(url) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 30000) : 0;
    try {
      const r = await fetch(url, ctl ? { signal: ctl.signal } : {});
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      if (t) clearTimeout(t);
    }
  }

  function arcQuery(base, L, offset, extra) {
    return base + "/query?where=" + encodeURIComponent(L.where || "1=1") + "&outFields=" + encodeURIComponent(L.outFields || "*") +
      "&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=2000&resultOffset=" + offset + (extra || "");
  }

  async function arcAll(base, L, token, s, extra, maxPages) {
    const feats = [];
    for (let page = 0, off = 0; page < (maxPages || 15); page += 1) {
      const body = await getJson(arcQuery(base, L, off, extra));
      if (token !== s.token) return null;
      if (body && body.error) throw new Error(String(body.error.message || "query error"));
      const f = (body && body.features) || [];
      feats.push(...f);
      if (f.length < 2000 && !(body.properties && body.properties.exceededTransferLimit)) break;
      if (!f.length) break;
      off += f.length;
    }
    return feats;
  }

  function centre(geom) {
    if (!geom) return null;
    const c = geom.coordinates;
    if (geom.type === "Point") return [c[0], c[1]];
    let ring = null;
    if (geom.type === "Polygon") ring = c[0];
    else if (geom.type === "MultiPolygon") ring = c[0] && c[0][0];
    else if (geom.type === "LineString") ring = c;
    else if (geom.type === "MultiPoint") ring = c;
    if (!ring || !ring.length) return null;
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
  }

  function featureItem(L, f, api) {
    const pos = centre(f.geometry);
    if (!pos) return null;
    const p = Object.assign({}, f.properties || {});
    if (p.depth == null && f.geometry && f.geometry.type === "Point" && f.geometry.coordinates.length > 2) p.depth = f.geometry.coordinates[2];
    const facts = [];
    for (const fd of L.fields || []) {
      const v = api.fmtVal(p[fd[0]], fd[2]);
      if (v) facts.push([fd[1], v]);
    }
    const name = api.plain(p[L.title] != null ? p[L.title] : (p.name || p.NAME || p.title || L.name));
    const it = { lat: pos[1], lon: pos[0], name: name || L.name, facts };
    if (p.mag != null && Number.isFinite(Number(p.mag))) it.size = Math.max(5, Math.min(16, 4 + Number(p.mag) * 1.7));
    return it;
  }

  function schedule(L, s, api, token, fn) {
    if (!L.refresh) return;
    clearInterval(timers.get(L.key));
    timers.set(L.key, setInterval(() => {
      if (document.hidden || token !== s.token || !s.on) return;
      fn().catch(() => {});
    }, L.refresh * 1000));
  }
  function unschedule(L) { clearInterval(timers.get(L.key)); timers.delete(L.key); }

  const points = {
    async add(L, s, api, token) {
      const load = async () => {
        let items = [];
        if (L.fmt === "snap") {
          const rows = await getJson(L.url);
          items = root.GsaCustomPacks.rowsToItems(rows);
        } else if (L.fmt === "arcgis") {
          const feats = await arcAll(L.url, L, token, s);
          if (!feats) return null;
          items = feats.map((f) => featureItem(L, f, api)).filter(Boolean);
        } else {
          const body = await getJson(L.url);
          items = ((body && body.features) || []).map((f) => featureItem(L, f, api)).filter(Boolean);
        }
        if (token !== s.token) return null;
        const h = api.drawPins(L, s, items);
        api.render(L.key);
        return h;
      };
      const h = await load();
      schedule(L, s, api, token, load);
      return h;
    },
    remove(L, s, api) { unschedule(L); api.removePins(L); },
  };

  const DM_LABEL = ["D0 Abnormally Dry", "D1 Moderate Drought", "D2 Severe Drought", "D3 Extreme Drought", "D4 Exceptional Drought"];

  const shapes = {
    async add(L, s, api, token) {
      const Cesium = root.Cesium;
      const v = api.viewer();
      const sources = L.sources || [L.url];
      const all = [];
      for (const src of sources) {
        const feats = await arcAll(src, L, token, s, "&maxAllowableOffset=0.02&geometryPrecision=3", 5);
        if (!feats) return null;
        all.push(...feats);
      }
      const ds = await Cesium.GeoJsonDataSource.load({ type: "FeatureCollection", features: all }, {
        stroke: Cesium.Color.fromCssColorString(L.fill || "#b9d3e6"),
        fill: Cesium.Color.fromCssColorString(L.fill || "#b9d3e6").withAlpha(0.28),
        strokeWidth: 1.5,
        clampToGround: false,
      });
      if (token !== s.token) return null;
      for (const e of ds.entities.values) {
        const props = {};
        if (e.properties) for (const n of e.properties.propertyNames) props[n] = e.properties[n].getValue();
        if (L.styleBy && L.palette && e.polygon) {
          const col = L.palette[String(props[L.styleBy])];
          if (col) {
            e.polygon.material = Cesium.Color.fromCssColorString(col).withAlpha(0.45);
            e.polygon.outlineColor = Cesium.Color.fromCssColorString(col);
          }
        }
        if (e.polygon) { e.polygon.height = 0; e.polygon.outline = false; }
        const pos = e.polygon && e.polygon.hierarchy ? e.polygon.hierarchy.getValue(Cesium.JulianDate.now()) : null;
        let lat = NaN, lon = NaN;
        if (pos && pos.positions && pos.positions.length) {
          const c = Cesium.Cartographic.fromCartesian(Cesium.BoundingSphere.fromPoints(pos.positions).center);
          lat = Cesium.Math.toDegrees(c.latitude); lon = Cesium.Math.toDegrees(c.longitude);
        }
        const facts = [];
        for (const fd of L.fields || []) {
          let val = props[fd[0]];
          if (L.key === "usdm" && fd[0] === "DM") val = DM_LABEL[Number(val)] || val;
          const t = api.fmtVal(val, fd[2]);
          if (t) facts.push([fd[1], t]);
        }
        let name = props[L.title];
        if (L.key === "usdm") name = DM_LABEL[Number(props.DM)] || "Drought area";
        e.name = undefined;
        e.description = undefined;
        e._xl = { xl: true, xlKey: L.key, layer: "xl:" + L.key, kind: L.name, name: api.plain(name || L.name), lat, lon, facts };
      }
      await v.dataSources.add(ds);
      s.count = all.length;
      return { ds };
    },
    remove(L, s, api) {
      const v = api.viewer();
      if (s.handle && s.handle.ds && v && !v.isDestroyed()) v.dataSources.remove(s.handle.ds, true);
    },
  };

  const lines = {
    async add(L, s, api, token) {
      const Cesium = root.Cesium;
      const v = api.viewer();
      const feats = await arcAll(L.url, Object.assign({}, L, { outFields: "IDENT,TYPE_CODE" }), token, s, "&maxAllowableOffset=0.01&geometryPrecision=3", 12);
      if (!feats) return null;
      const coll = new Cesium.PolylineCollection();
      const mat = Cesium.Material.fromType("Color", { color: Cesium.Color.fromCssColorString(L.stroke || "#9cc0e6").withAlpha(0.55) });
      let n = 0;
      for (const f of feats) {
        const g = f.geometry;
        if (!g) continue;
        const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        const p = f.properties || {};
        const item = { xl: true, xlKey: L.key, layer: "xl:" + L.key, kind: L.name, name: api.plain(p.IDENT || "Route"),
          facts: [["Route", api.plain(p.IDENT)], ["Type", api.plain(p.TYPE_CODE)]].filter((x) => x[1]) };
        for (const part of parts) {
          if (part.length < 2) continue;
          const flat = [];
          for (const c of part) flat.push(c[0], c[1]);
          const mid = part[Math.floor(part.length / 2)];
          item.lat = mid[1]; item.lon = mid[0];
          coll.add({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width: 1.2, material: mat, id: item });
        }
        n += 1;
      }
      if (token !== s.token) { coll.destroy(); return null; }
      v.scene.primitives.add(coll);
      s.count = n;
      return { coll };
    },
    remove(L, s, api) {
      const v = api.viewer();
      if (s.handle && s.handle.coll && v && !v.isDestroyed()) v.scene.primitives.remove(s.handle.coll);
    },
  };

  root.GsaLiveFeeds = { points, shapes, lines };
  if (root.GsaExtraLayers) {
    root.GsaExtraLayers.register("points", points);
    root.GsaExtraLayers.register("shapes", shapes);
    root.GsaExtraLayers.register("lines", lines);
  }
})(window);
