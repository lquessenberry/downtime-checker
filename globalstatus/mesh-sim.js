/* Global Status · simulated mesh radio for QA only (loaded with ?sdrtest=1).
 * Speaks real Meshtastic stream frames (0x94 0xC3 + protobuf) or MeshCore companion
 * frames so the Connect Mesh decoder is exercised end to end without hardware.
 * Records every byte the page writes so QA can confirm the session stays read-only.
 * Original code for Global Status App.
 */
(function (root) {
  "use strict";
  // ---- minimal protobuf writer
  function vint(n) { const o = []; n = Math.floor(n); if (n < 0) n += 18446744073709551616; while (n > 127) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; }
  const key = (f, wt) => vint(f * 8 + wt);
  const u = (f, v) => key(f, 0).concat(vint(v));
  const i32 = (f, v) => key(f, 0).concat(v < 0 ? neg(v) : vint(v));
  function neg(v) { const lo = (v >>> 0); const out = []; let n = lo; for (let k = 0; k < 4; k += 1) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push((n & 0x0f) | 0x70 | 0x80); for (let k = 0; k < 4; k += 1) out.push(0xff); out.push(0x01); return out; }
  const fx = (f, v) => key(f, 5).concat([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const fl = (f, v) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, true); return key(f, 5).concat([d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)]); };
  const by = (f, arr) => key(f, 2).concat(vint(arr.length), Array.from(arr));
  const s = (f, text) => by(f, Array.from(new TextEncoder().encode(text)));
  const m = (f, parts) => by(f, [].concat(...parts));
  // ---- Meshtastic payloads
  const pos = (lat, lon, alt) => [fx(1, Math.round(lat * 1e7)), fx(2, Math.round(lon * 1e7)), i32(3, alt || 0), fx(4, Math.floor(Date.now() / 1000)), u(23, 32)];
  const userMsg = (n) => [s(1, n.id), s(2, n.long), s(3, n.short), u(5, n.hw), u(7, n.role || 0)];
  const metrics = (n) => [u(1, n.batt), fl(2, n.volt), fl(3, n.chu), fl(4, 1.2), u(5, 86400)];
  function nodeInfo(n) { return [].concat(...m(4, [u(1, n.num), m(2, userMsg(n)), n.lat != null ? m(3, pos(n.lat, n.lon, n.alt)) : [], fl(4, n.snr), fx(5, Math.floor(Date.now() / 1000) - n.ago), m(6, metrics(n)), u(9, n.hops)])); }
  function packet(from, to, port, payload, extra) { return [].concat(...m(2, [fx(1, from), fx(2, to), u(3, (extra && extra.ch) || 0), m(4, [u(1, port), by(2, payload)]), fx(6, Math.floor(Math.random() * 1e9)), fx(7, Math.floor(Date.now() / 1000)), fl(8, 5.5), i32(12, -92), u(9, 2), u(15, 3)])); }
  const frame = (p) => [0x94, 0xc3, (p.length >> 8) & 255, p.length & 255].concat(p);

  function nodes(c) {
    const lat = c.lat, lon = c.lon;
    return [
      { num: 0x433a1b2c, id: "!433a1b2c", long: "GS Base Station", short: "GSB", hw: 43, role: 0, lat: lat + 0.004, lon: lon - 0.003, alt: 15, snr: 0, ago: 5, batt: 101, volt: 4.9, chu: 9.5, hops: 0 },
      { num: 0xdeadbeef, id: "!deadbeef", long: "Ridge Router", short: "RDGE", hw: 9, role: 2, lat: lat + 0.21, lon: lon + 0.18, alt: 120, snr: 6.25, ago: 60, batt: 88, volt: 4.05, chu: 12.5, hops: 1 },
      { num: 0x0badf00d, id: "!0badf00d", long: "Bay Tracker", short: "BAY", hw: 71, role: 5, lat: lat - 0.12, lon: lon + 0.31, alt: 3, snr: -4.5, ago: 120, batt: 64, volt: 3.85, chu: 10.1, hops: 2 },
      { num: 0x1a2b3c4d, id: "!1a2b3c4d", long: "Downtown Relay", short: "DTR", hw: 43, role: 4, lat: lat + 0.02, lon: lon + 0.05, alt: 210, snr: 9.75, ago: 30, batt: 100, volt: 4.2, chu: 14.2, hops: 0 },
      { num: 0x77aa1100, id: "!77aa1100", long: "Westside Solar", short: "WSS", hw: 95, role: 2, lat: lat + 0.08, lon: lon - 0.42, alt: 40, snr: -8, ago: 900, batt: 92, volt: 4.1, chu: 11, hops: 3 },
      { num: 0x55cc9911, id: "!55cc9911", long: "Hiker Pocket", short: "HIKE", hw: 94, role: 0, lat: lat - 0.33, lon: lon - 0.21, alt: 22, snr: -12.5, ago: 1800, batt: 41, volt: 3.7, chu: 8, hops: 2 },
      { num: 0x2468ace0, id: "!2468ace0", long: "Storm Watch Sensor", short: "STRM", hw: 69, role: 6, lat: lat + 0.37, lon: lon - 0.06, alt: 30, snr: 1.5, ago: 400, batt: 77, volt: 3.95, chu: 7, hops: 1 },
      { num: 0x13579bdf, id: "!13579bdf", long: "No GPS Handheld", short: "NOGP", hw: 50, role: 0, snr: 3, ago: 200, batt: 55, volt: 3.8, chu: 9, hops: 1 },
    ];
  }

  function meshtastic(center) {
    const N = nodes(center);
    let onBytes = null, timer = 0, step = 0, rxState = [];
    const sim = { writes: [], sent: { wantConfig: 0, heartbeat: 0, other: 0 } };
    const emit = (p) => { if (onBytes) onBytes(Uint8Array.from(frame(p))); };
    function config(nonce) {
      emit([].concat(...m(3, [u(1, N[0].num), u(8, 3), u(15, N.length)])));
      emit([].concat(...m(13, [s(1, "2.6.11.sim"), u(9, 43), u(5, 1)])));
      emit([].concat(...m(5, [m(6, [u(1, 1), u(2, 0), u(7, 1), u(8, 3), u(9, 1)])])));
      emit([].concat(...m(10, [u(1, 0), m(2, [by(2, [1]), s(3, "")]), u(3, 1)])));
      emit([].concat(...m(10, [u(1, 1), m(2, [by(2, Array.from({ length: 16 }, (_, i) => i)), s(3, "Neighbors")]), u(3, 2)])));
      N.forEach((n, i) => setTimeout(() => emit(nodeInfo(n)), 10 * i));
      setTimeout(() => emit(u(7, nonce)), 120);
      setTimeout(() => {
        emit(packet(N[1].num, 0xffffffff, 1, Array.from(new TextEncoder().encode("Good evening mesh, ridge router online"))));
        emit(packet(N[2].num, N[0].num, 1, Array.from(new TextEncoder().encode("Heading back to the marina"))));
      }, 400);
      clearInterval(timer);
      timer = setInterval(() => {
        step += 1;
        const b = N[2];
        b.lat += 0.006; b.lon -= 0.004;
        emit(packet(b.num, 0xffffffff, 3, [].concat(...pos(b.lat, b.lon, 3))));
        if (step % 3 === 0) emit(packet(N[3].num, 0xffffffff, 67, [].concat(fx(1, Math.floor(Date.now() / 1000)), m(2, [u(1, 99), fl(2, 4.18), fl(3, 15.5), fl(4, 2.1)]))));
        if (step % 4 === 0) emit(packet(N[6].num, 0xffffffff, 67, [].concat(m(3, [fl(1, 18.5), fl(2, 72), fl(3, 1009.4)]))));
        if (step % 5 === 0) emit(packet(N[4].num, 0xffffffff, 1, Array.from(new TextEncoder().encode("Solar node check-in " + step)), { ch: 1 }));
        if (step % 2 === 0) emit([].concat(...m(2, [fx(1, N[5].num), fx(2, 0xffffffff), by(5, [9, 9, 9]), fl(8, -12)])));
      }, 3000);
    }
    const push = root.GsaMeshDevice.MtFramer();
    sim.stream = {
      write: async (bytes) => {
        sim.writes.push(Array.from(bytes));
        if (bytes.length === 32 && bytes.every((b) => b === 0xc3)) return;
        let any = false;
        push(bytes, (p) => {
          any = true;
          const f = root.GsaMeshDevice.pb(p);
          if (f[3]) { sim.sent.wantConfig += 1; config(f[3][0].u); }
          else if (f[7]) sim.sent.heartbeat += 1;
          else sim.sent.other += 1;
        });
        if (!any && bytes[0] !== 0x94) sim.sent.other += 1;
      },
      start: (cb) => { onBytes = cb; },
      close: () => { clearInterval(timer); onBytes = null; },
    };
    sim.nodes = N;
    return sim;
  }

  function meshcore(center) {
    let onBytes = null, timer = 0, queue = [];
    const sim = { writes: [], sent: { cmds: [] } };
    const enc = new TextEncoder();
    const le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    const pad = (text, n) => { const b = Array.from(enc.encode(text)).slice(0, n); while (b.length < n) b.push(0); return b; };
    const out = (p) => { if (onBytes) onBytes(Uint8Array.from([0x3e, p.length & 255, p.length >> 8].concat(p))); };
    const C = [
      { key: "a1b2c3d4", type: 2, name: "Hill Repeater", lat: center.lat + 0.15, lon: center.lon - 0.1 },
      { key: "c0ffee01", type: 1, name: "Maria T-Deck", lat: center.lat - 0.05, lon: center.lon + 0.12 },
      { key: "be11a5e7", type: 3, name: "Downtown Room", lat: center.lat + 0.03, lon: center.lon + 0.02 },
      { key: "5e05e001", type: 4, name: "Creek Sensor", lat: center.lat - 0.2, lon: center.lon - 0.25 },
    ];
    const keyBytes = (h) => { const b = []; for (let i = 0; i < 8; i += 2) b.push(parseInt(h.slice(i, i + 2), 16)); while (b.length < 32) b.push(0x22); return b; };
    const contact = (c) => [3].concat(keyBytes(c.key), [c.type, 0, 1], new Array(64).fill(0), pad(c.name, 32), le(Math.floor(Date.now() / 1000) - 120), le(Math.round(c.lat * 1e6)), le(Math.round(c.lon * 1e6)), le(Math.floor(Date.now() / 1000)));
    queue = [
      [17, 22, 0, 0, 0, 1, 0].concat(le(Math.floor(Date.now() / 1000)), Array.from(enc.encode("Hill Repeater: public channel test"))),
      [16, 30, 0, 0].concat([0xc0, 0xff, 0xee, 0x01, 0, 0], [1, 0], le(Math.floor(Date.now() / 1000)), Array.from(enc.encode("Are you at the meetup?"))),
    ];
    function handle(p) {
      const code = p[0];
      sim.sent.cmds.push(code);
      if (code === 1) out([5, 1, 22, 22].concat(keyBytes("feedface"), le(Math.round((center.lat + 0.001) * 1e6)), le(Math.round((center.lon + 0.001) * 1e6)), [0, 0, 0, 0], le(910525), le(62500), [7, 5], Array.from(enc.encode("GS MeshCore Sim"))));
      else if (code === 22) out([13, 8, 175, 8].concat(le(0), pad("20-Nov-2025", 12), pad("Heltec V3", 40), pad("v1.10.0", 20)));
      else if (code === 4) { out([2].concat(le(C.length))); C.forEach((c) => out(contact(c))); out([4].concat(le(Math.floor(Date.now() / 1000)))); }
      else if (code === 31) { if (p[1] === 0) out([18, 0].concat(pad("Public", 32), new Array(16).fill(0))); else if (p[1] === 1) out([18, 1].concat(pad("Hikers", 32), new Array(16).fill(0))); else out([1, 2]); }
      else if (code === 10) { const q = queue.shift(); out(q || [10]); }
      else out([1, 1]);
    }
    let buf = [];
    sim.stream = {
      write: async (bytes) => {
        sim.writes.push(Array.from(bytes));
        buf = buf.concat(Array.from(bytes));
        for (;;) {
          const i = buf.indexOf(0x3c);
          if (i < 0) { buf = []; break; }
          if (buf.length < i + 3) { buf = buf.slice(i); break; }
          const len = buf[i + 1] | (buf[i + 2] << 8);
          if (buf.length < i + 3 + len) { buf = buf.slice(i); break; }
          handle(buf.slice(i + 3, i + 3 + len));
          buf = buf.slice(i + 3 + len);
        }
      },
      start: (cb) => {
        onBytes = cb;
        timer = setInterval(() => { const c = C[1]; c.lat += 0.004; out([0x8a].concat(contact(c).slice(1))); }, 4000);
        setTimeout(() => { queue.push([17, 10, 0, 0, 1, 0, 0].concat(le(Math.floor(Date.now() / 1000)), Array.from(enc.encode("Trail is muddy past mile 3")))); out([0x83]); }, 6000);
      },
      close: () => { clearInterval(timer); onBytes = null; },
    };
    return sim;
  }

  root.GsaMeshSim = { meshtastic, meshcore };
})(window);
