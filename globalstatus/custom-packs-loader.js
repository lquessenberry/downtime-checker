/* Global Status · CUSTOM PACKS loader
 *
 * The 170 custom open-data pin layers live in layers-data/pack-1.json … pack-9.json.
 * A pack is fetched once, the first time any layer in it is switched on, then kept
 * in memory. Each pin: [lat, lon, name, region, era_or_date, summary, details].
 * Every value is plain text (built by scripts/build_extra_layers.py, URL-free).
 * Also renders the static snapshots in layers-data/snapshots/ (same row format).
 */
(function (root) {
  const packs = new Map(); // file -> Promise<json>

  function getPack(file) {
    if (!packs.has(file)) {
      const p = fetch("/layers-data/" + file, { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
      p.catch(() => packs.delete(file));
      packs.set(file, p);
    }
    return packs.get(file);
  }

  function rowsToItems(rows) {
    return rows.map((r) => ({ lat: Number(r[0]), lon: Number(r[1]), name: r[2], region: r[3], era: r[4], summary: r[5], details: r[6] }));
  }

  const loader = {
    async add(L, s, api) {
      const pack = await getPack(L.pack);
      const rows = (pack.layers || {})[L.key];
      if (!rows) throw new Error("layer missing from pack");
      return api.drawPins(L, s, rowsToItems(rows));
    },
    remove(L, s, api) { api.removePins(L); },
  };

  root.GsaCustomPacks = { getPack, rowsToItems, loader };
  if (root.GsaExtraLayers) root.GsaExtraLayers.register("pack", loader);
})(window);
