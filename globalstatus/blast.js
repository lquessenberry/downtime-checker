/* Global Status first-party blast rings.
 * Cube-root scaling from public 1 kt airburst radii (Glasstone & Dolan order
 * of magnitude). Not NUKEMAP, not NukeSim, not their code.
 */
(function (root) {
  const KT_PRESETS = [15, 100, 300, 1000, 5000];
  const FIREBALL_1KT = 90;
  const HEAVY_1KT = 220;
  const MEDIUM_1KT = 450;
  const LIGHT_1KT = 1100;
  const THERMAL_1KT = 650;

  function cbrt(y) {
    return Math.cbrt(Math.max(0, Number(y) || 0));
  }

  function rings(yieldKt, airburst) {
    const y = Math.max(0.001, Number(yieldKt) || 15);
    const s = cbrt(y);
    const air = airburst !== false;
    const fire = FIREBALL_1KT * s * (air ? 1 : 0.75);
    const heavy = HEAVY_1KT * s * (air ? 1 : 0.9);
    const medium = MEDIUM_1KT * s * (air ? 1 : 0.9);
    const light = LIGHT_1KT * s * (air ? 1 : 0.9);
    const thermal = THERMAL_1KT * s * (air ? 1.1 : 0.7);
    const fallout = air ? 0 : light * 6;
    return {
      yieldKt: y,
      airburst: air,
      fireballM: fire,
      heavyM: heavy,
      mediumM: medium,
      lightM: light,
      thermalM: thermal,
      falloutM: fallout,
    };
  }

  function defcon(shots) {
    if (!shots || !shots.length) return 5;
    const maxKt = Math.max(...shots.map((s) => Number(s.yieldKt) || 0));
    if (shots.length >= 8 || maxKt >= 5000) return 1;
    if (shots.length >= 4 || maxKt >= 1000) return 2;
    if (maxKt >= 300) return 3;
    return 4;
  }

  function km(meters) {
    return (meters / 1000).toFixed(meters >= 10000 ? 0 : 1);
  }

  function card(shot) {
    const r = rings(shot.yieldKt, shot.airburst);
    const lines = [
      `${r.yieldKt} kt ${r.airburst ? "airburst" : "ground burst"}`,
      `fireball ${km(r.fireballM)} km`,
      `heavy (20 psi) ${km(r.heavyM)} km`,
      `medium (5 psi) ${km(r.mediumM)} km`,
      `light (1 psi) ${km(r.lightM)} km`,
      `thermal ${km(r.thermalM)} km`,
    ];
    if (r.falloutM) lines.push(`fallout footprint ${km(r.falloutM)} km (downwind sketch)`);
    lines.push("GSA model · cube-root scaling · not a population estimate");
    return lines.join("\n");
  }

  root.GsaBlast = { KT_PRESETS, rings, defcon, card, km };
})(typeof window !== "undefined" ? window : globalThis);
