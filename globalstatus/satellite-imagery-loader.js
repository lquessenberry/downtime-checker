/* Global Status · SATELLITE IMAGERY loader
 *
 * wmts          NASA GIBS (Web Mercator "best" endpoint). Time = "default" (latest image
 *               GIBS has). If that fails repeatedly, fall back to yesterday, then two and
 *               three days ago (UTC), since some daily products publish late.
 * wms           NOAA nowCOAST and EUMETSAT EUMETView WMS. EUMETSAT is requested at the
 *               top of the hour at least one hour old, which keeps it inside the free
 *               CC BY 4.0 "core" data terms (data under one hour old is not core).
 * arcgis        ArcGIS MapServer /export images (NOAA, USGS, EPA, Census).
 * arcgis-image  ArcGIS ImageServer /exportImage (NOAA MRMS and air quality grids).
 *
 * Every layer has its own opacity slider. Switching a layer off removes its
 * imagery layer from the globe (no hidden layers left behind).
 * Credits are plain text Cesium credits (no links).
 */
(function (root) {
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/";

  function utcDay(daysAgo) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function eumetsatTime() {
    const d = new Date(Date.now() - 75 * 60000);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString().replace(".000Z", "Z");
  }
  function credit(L) {
    const Cesium = root.Cesium;
    return new Cesium.Credit(String(L.credit || "").replace(/[<>]/g, ""), false);
  }

  function addLayer(L, s, api, provider) {
    const v = api.viewer();
    const layer = v.imageryLayers.addImageryProvider(provider);
    layer.alpha = s.opacity == null ? 0.75 : s.opacity;
    return { layer, provider };
  }

  function gibsProvider(L, time) {
    const Cesium = root.Cesium;
    const ext = L.fmt === "image/jpeg" ? "jpg" : "png";
    return new Cesium.WebMapTileServiceImageryProvider({
      url: GIBS + L.layer + "/default/" + (L.time ? "{Time}" : "default") + "/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}." + ext,
      layer: L.layer,
      style: "default",
      format: L.fmt,
      tileMatrixSetID: L.tms,
      maximumLevel: L.maxLevel,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      dimensions: L.time ? { Time: time } : undefined,
      credit: credit(L),
    });
  }

  function flaky(L, s, api) {
    return () => {
      if (!s.on) return;
      s.info = "The source server is returning errors for some tiles right now; tiles it does send are shown.";
      api.render(L.key);
    };
  }

  function watchErrors(provider, onFail) {
    let n = 0;
    const ev = provider.errorEvent;
    if (!ev) return;
    ev.addEventListener((err) => {
      n += 1;
      // NASA GIBS and NOAA occasionally answer one tile with HTTP 500; try that tile once more.
      if (err) err.retry = (err.timesRetried || 0) < 1;
      if (n === 8) onFail();
    });
  }

  const wmts = {
    add(L, s, api, token) {
      const times = ["default", utcDay(1), utcDay(2), utcDay(3)];
      let i = 0;
      const mount = () => {
        const prov = gibsProvider(L, times[i]);
        const h = addLayer(L, s, api, prov);
        s.info = L.time ? (i === 0 ? "Latest available image." : "Showing " + times[i] + " (UTC); the latest image was not available.") : "";
        watchErrors(prov, () => {
          if (s.token !== token || !s.handle || s.handle.provider !== prov) return;
          if (!L.time || i >= times.length - 1) return;
          i += 1;
          wmts.remove(L, s, api);
          s.handle = mount();
          api.render(L.key);
        });
        return h;
      };
      return mount();
    },
    remove(L, s, api) {
      const v = api.viewer();
      if (s.handle && s.handle.layer && v && !v.isDestroyed()) v.imageryLayers.remove(s.handle.layer, true);
      s.info = "";
    },
    setOpacity(L, s, a) { if (s.handle && s.handle.layer) s.handle.layer.alpha = a; },
  };

  const wms = {
    add(L, s, api) {
      const Cesium = root.Cesium;
      const params = { transparent: true, format: "image/png" };
      if (L.eumetsat) {
        params.time = eumetsatTime();
        s.info = "Image time: " + params.time.replace("T", " ").replace("Z", " UTC") + ".";
      }
      const prov = new Cesium.WebMapServiceImageryProvider({
        url: L.url,
        layers: L.layers,
        parameters: params,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        tileWidth: 256,
        tileHeight: 256,
        credit: credit(L),
      });
      watchErrors(prov, flaky(L, s, api));
      return addLayer(L, s, api, prov);
    },
    remove: wmts.remove,
    setOpacity: wmts.setOpacity,
  };

  // NOAA's ArcGIS servers drop CORS headers on error answers when flooded, so keep
  // requests per host modest and only ask for tiles inside the service extent.
  function limitHost(url) {
    const Cesium = root.Cesium;
    try {
      const u = new URL(url);
      const key = u.host + (u.port ? "" : ":443");
      if (Cesium.RequestScheduler && Cesium.RequestScheduler.requestsByServer) Cesium.RequestScheduler.requestsByServer[key] = 6;
    } catch (e) { /* ignore */ }
  }

  function extentRect(ext) {
    const Cesium = root.Cesium;
    if (!ext || !Number.isFinite(ext.xmin)) return undefined;
    const wkid = ext.spatialReference && (ext.spatialReference.latestWkid || ext.spatialReference.wkid);
    if (wkid === 4326) return Cesium.Rectangle.fromDegrees(ext.xmin, ext.ymin, ext.xmax, ext.ymax);
    if (wkid !== 3857 && wkid !== 102100) return undefined;
    const proj = new Cesium.WebMercatorProjection();
    const sw = proj.unproject(new Cesium.Cartesian3(ext.xmin, ext.ymin, 0));
    const ne = proj.unproject(new Cesium.Cartesian3(ext.xmax, ext.ymax, 0));
    return new Cesium.Rectangle(sw.longitude, sw.latitude, ne.longitude, ne.latitude);
  }

  function exportProvider(L, path, extra, rect, onFail) {
    const Cesium = root.Cesium;
    limitHost(L.url);
    const url = L.url + path + "?bbox={westProjected},{southProjected},{eastProjected},{northProjected}" +
      "&bboxSR=3857&imageSR=3857&size={width},{height}&transparent=true&f=image" + extra;
    const prov = new Cesium.UrlTemplateImageryProvider({
      url,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 14,
      rectangle: rect,
      credit: credit(L),
    });
    watchErrors(prov, onFail || (() => {}));
    return prov;
  }

  const arcgis = {
    add(L, s, api) {
      const show = L.show ? "&layers=show:" + L.show : "";
      return addLayer(L, s, api, exportProvider(L, "/export", "&format=png32&dpi=96" + show, undefined, flaky(L, s, api)));
    },
    remove: wmts.remove,
    setOpacity: wmts.setOpacity,
  };

  const arcgisImage = {
    async add(L, s, api, token) {
      let time = "";
      const r = await fetch(L.url + "?f=json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const meta = await r.json();
      if (token !== s.token) return null;
      const rect = extentRect(meta && meta.extent);
      if (L.timeAware) {
        const ext = meta && meta.timeInfo && meta.timeInfo.timeExtent;
        if (ext && ext.length === 2) {
          const t = Math.min(Math.max(Date.now(), ext[0]), ext[1]);
          time = "&time=" + t;
          s.info = "Forecast valid " + new Date(t).toUTCString().replace("GMT", "UTC") + ".";
        }
      }
      if (token !== s.token) return null;
      return addLayer(L, s, api, exportProvider(L, "/exportImage", "&format=png" + time, rect, flaky(L, s, api)));
    },
    remove: wmts.remove,
    setOpacity: wmts.setOpacity,
  };

  const loaders = { wmts, wms, arcgis, "arcgis-image": arcgisImage };
  root.GsaSatelliteImagery = { loaders, eumetsatTime };
  if (root.GsaExtraLayers) for (const k in loaders) root.GsaExtraLayers.register(k, loaders[k]);
})(window);
