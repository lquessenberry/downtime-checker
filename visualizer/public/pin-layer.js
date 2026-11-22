/**
 * Primitive-backed pin layers for the Cesium globe.
 *
 * BillboardCollection / PointPrimitiveCollection / LabelCollection /
 * PolylineCollection, with in-place upserts so SSE and live-feed updates
 * mutate existing primitives instead of tearing the collection down.
 * Pairs with Viewer.requestRenderMode: every mutation calls scene.requestRender.
 */
(function (global) {
  "use strict";

  const FAR_LABEL = () => new Cesium.DistanceDisplayCondition(0, 3.5e6);
  const FAR_BILLBOARD = () => new Cesium.DistanceDisplayCondition(0, 1.4e7);
  const FAR_POINT = () => new Cesium.DistanceDisplayCondition(0, 2.0e7);

  function requestRender(viewer) {
    if (viewer && viewer.scene) viewer.scene.requestRender();
  }

  function installRequestRenderMode(viewer) {
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
  }

  function applyPoint(prim, style, position) {
    prim.position = position;
    if (style.pixelSize != null) prim.pixelSize = style.pixelSize;
    if (style.color) prim.color = style.color;
    if (style.outlineColor) prim.outlineColor = style.outlineColor;
    if (style.outlineWidth != null) prim.outlineWidth = style.outlineWidth;
    if (style.heightReference != null) prim.heightReference = style.heightReference;
    if (style.disableDepthTestDistance != null) prim.disableDepthTestDistance = style.disableDepthTestDistance;
    if (style.scaleByDistance) prim.scaleByDistance = style.scaleByDistance;
    if (style.distanceDisplayCondition) prim.distanceDisplayCondition = style.distanceDisplayCondition;
    else if (!prim.distanceDisplayCondition) prim.distanceDisplayCondition = FAR_POINT();
  }

  function applyBillboard(prim, style, position) {
    prim.position = position;
    if (style.image) prim.image = style.image;
    if (style.width != null) prim.width = style.width;
    if (style.height != null) prim.height = style.height;
    if (style.verticalOrigin != null) prim.verticalOrigin = style.verticalOrigin;
    if (style.horizontalOrigin != null) prim.horizontalOrigin = style.horizontalOrigin;
    if (style.pixelOffset) prim.pixelOffset = style.pixelOffset;
    if (style.heightReference != null) prim.heightReference = style.heightReference;
    if (style.disableDepthTestDistance != null) prim.disableDepthTestDistance = style.disableDepthTestDistance;
    if (style.scaleByDistance) prim.scaleByDistance = style.scaleByDistance;
    if (style.distanceDisplayCondition) prim.distanceDisplayCondition = style.distanceDisplayCondition;
    else if (!prim.distanceDisplayCondition) prim.distanceDisplayCondition = FAR_BILLBOARD();
  }

  function applyLabel(prim, style, position) {
    prim.position = position;
    if (style.text != null) prim.text = style.text;
    if (style.font) prim.font = style.font;
    if (style.fillColor) prim.fillColor = style.fillColor;
    if (style.outlineColor) prim.outlineColor = style.outlineColor;
    if (style.outlineWidth != null) prim.outlineWidth = style.outlineWidth;
    if (style.style != null) prim.style = style.style;
    if (style.showBackground != null) prim.showBackground = style.showBackground;
    if (style.backgroundColor) prim.backgroundColor = style.backgroundColor;
    if (style.backgroundPadding) prim.backgroundPadding = style.backgroundPadding;
    if (style.verticalOrigin != null) prim.verticalOrigin = style.verticalOrigin;
    if (style.horizontalOrigin != null) prim.horizontalOrigin = style.horizontalOrigin;
    if (style.pixelOffset) prim.pixelOffset = style.pixelOffset;
    if (style.heightReference != null) prim.heightReference = style.heightReference;
    if (style.disableDepthTestDistance != null) prim.disableDepthTestDistance = style.disableDepthTestDistance;
    if (style.scaleByDistance) prim.scaleByDistance = style.scaleByDistance;
    if (style.distanceDisplayCondition) prim.distanceDisplayCondition = style.distanceDisplayCondition;
    else if (!prim.distanceDisplayCondition) prim.distanceDisplayCondition = FAR_LABEL();
  }

  function applyPolyline(prim, style) {
    if (style.positions) prim.positions = style.positions;
    if (style.width != null) prim.width = style.width;
    if (style.material) prim.material = style.material;
  }

  function create(viewer, name) {
    const scene = viewer.scene;
    const billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    const points = scene.primitives.add(new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.OPAQUE,
    }));
    const labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
    const polylines = scene.primitives.add(new Cesium.PolylineCollection());
    const byId = new Map();

    function destroyRecord(rec) {
      if (rec.point) { points.remove(rec.point); rec.point = null; }
      if (rec.billboard) { billboards.remove(rec.billboard); rec.billboard = null; }
      if (rec.label) { labels.remove(rec.label); rec.label = null; }
      if (rec.polyline) { polylines.remove(rec.polyline); rec.polyline = null; }
    }

    function upsert(id, spec) {
      const key = String(id);
      let rec = byId.get(key);
      if (!rec) {
        rec = { id: key, data: null, position: null, point: null, billboard: null, label: null, polyline: null };
        byId.set(key, rec);
      }
      rec.data = spec.data != null ? spec.data : rec.data;
      if (spec.position) rec.position = spec.position;
      const position = rec.position;
      if (spec.point) {
        if (!rec.point) {
          rec.point = points.add({ position, id: rec });
        }
        rec.point.id = rec;
        applyPoint(rec.point, spec.point, position);
      } else if (rec.point) {
        points.remove(rec.point);
        rec.point = null;
      }
      if (spec.billboard) {
        if (!rec.billboard) {
          rec.billboard = billboards.add({ position, id: rec });
        }
        rec.billboard.id = rec;
        applyBillboard(rec.billboard, spec.billboard, position);
      } else if (rec.billboard && spec.billboard === null) {
        billboards.remove(rec.billboard);
        rec.billboard = null;
      }
      if (spec.label) {
        if (!rec.label) {
          rec.label = labels.add({ position, id: rec, text: "" });
        }
        rec.label.id = rec;
        applyLabel(rec.label, spec.label, position);
      } else if (rec.label && spec.label === null) {
        labels.remove(rec.label);
        rec.label = null;
      }
      if (spec.polyline) {
        if (!rec.polyline) {
          rec.polyline = polylines.add({ positions: spec.polyline.positions || [], id: rec });
        }
        rec.polyline.id = rec;
        applyPolyline(rec.polyline, spec.polyline);
      } else if (rec.polyline && spec.polyline === null) {
        polylines.remove(rec.polyline);
        rec.polyline = null;
      }
      return rec;
    }

    function remove(id) {
      const key = String(id);
      const rec = byId.get(key);
      if (!rec) return;
      destroyRecord(rec);
      byId.delete(key);
    }

    function retain(ids) {
      const keep = ids instanceof Set ? ids : new Set([...ids].map(String));
      for (const key of [...byId.keys()]) {
        if (!keep.has(key)) remove(key);
      }
    }

    function clear() {
      for (const key of [...byId.keys()]) remove(key);
    }

    function sync(items, makeSpec) {
      const keep = new Set();
      for (const item of items) {
        const spec = makeSpec(item);
        if (!spec || spec.id == null) continue;
        const key = String(spec.id);
        keep.add(key);
        upsert(key, spec);
      }
      retain(keep);
      requestRender(viewer);
      return keep.size;
    }

    const layer = {
      name,
      billboards,
      points,
      labels,
      polylines,
      get show() { return points.show; },
      set show(v) {
        const on = Boolean(v);
        billboards.show = points.show = labels.show = polylines.show = on;
        requestRender(viewer);
      },
      get length() { return byId.size; },
      record(id) { return byId.get(String(id)); },
      upsert,
      remove,
      retain,
      clear,
      sync,
      forEach(fn) { for (const rec of byId.values()) fn(rec); },
      positions() {
        const out = [];
        for (const rec of byId.values()) if (rec.position) out.push(rec.position);
        return out;
      },
      flyTo(duration) {
        const pts = layer.positions();
        if (!pts.length) return;
        const sphere = Cesium.BoundingSphere.fromPoints(pts);
        viewer.camera.flyToBoundingSphere(sphere, { duration: duration == null ? 1.1 : duration });
      },
      destroy() {
        clear();
        scene.primitives.remove(billboards);
        scene.primitives.remove(points);
        scene.primitives.remove(labels);
        scene.primitives.remove(polylines);
      },
    };
    return layer;
  }

  function markFirstPins() {
    const perf = global.__pinPerf || (global.__pinPerf = { api: "primitives" });
    if (perf.firstPinsMs == null) {
      perf.firstPinsMs = performance.now();
      performance.mark("first-pins");
    }
  }

  global.PinLayer = {
    create,
    requestRender,
    installRequestRenderMode,
    markFirstPins,
    FAR_LABEL,
    FAR_BILLBOARD,
    FAR_POINT,
  };
})(window);
