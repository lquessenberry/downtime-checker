/* Global Status · Connect Mesh: read-only link to a real Meshtastic or MeshCore radio.
 *
 * - Web Serial (USB cable) and Web Bluetooth, Chrome / Edge / Opera on desktop and
 *   Chrome on Android (Bluetooth). Safari, Firefox and iOS have neither API.
 * - Meshtastic: stream framing (0x94 0xC3 + 16-bit big-endian length) over USB, raw
 *   protobuf over Bluetooth. Only two things are ever written to the radio: the
 *   want_config_id request that starts the session and a periodic heartbeat.
 * - MeshCore companion radios: '<' + 16-bit little-endian length frames over USB,
 *   raw frames over the Nordic UART service on Bluetooth. Only read commands are
 *   sent: app start, device query, list contacts, read channel names and fetch
 *   waiting messages.
 * - Nothing is transmitted over the air, no settings are changed and the radio is
 *   never rebooted. Loaded only when the user clicks Connect Mesh.
 * Original clean-room code for Global Status App, written from the public protocol
 * descriptions and protobuf field numbers. No third-party code.
 */
(function (root) {
  "use strict";

  const MT_SVC = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
  const MT_TORADIO = "f75c76d2-129e-4dad-a1dd-7866124401e7";
  const MT_FROMRADIO = "2c55e69e-4993-11ed-b878-0242ac120002";
  const MT_FROMNUM = "ed9da18c-a800-4f66-a670-aa7547e34453";
  const NUS_SVC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // app -> radio
  const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // radio -> app
  const BAUD = 115200;
  const HEARTBEAT_MS = 5 * 60e3;
  const td = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { fatal: false }) : null;
  const utf8 = (b) => (td ? td.decode(b) : Buffer.from(b).toString("utf8"));
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const nodeId = (num) => "!" + (num >>> 0).toString(16).padStart(8, "0");

  // ------------------------------------------------------------------ protobuf reader
  // Returns { fieldNumber: [values] }. Varints are { u: unsigned Number, lo: low 32 bits },
  // fixed32 values are { f32: uint32 }, length-delimited values are Uint8Array views.
  function pb(b) {
    const out = {};
    let i = 0;
    const varint = () => {
      let lo = 0, hi = 0, shift = 0, byte;
      do {
        if (i >= b.length) throw new Error("truncated varint");
        byte = b[i++];
        if (shift < 28) lo |= (byte & 0x7f) << shift;
        else if (shift === 28) { lo |= (byte & 0x0f) << 28; hi |= (byte & 0x7f) >>> 4; }
        else hi |= (byte & 0x7f) << (shift - 32 + 0);
        shift += 7;
      } while (byte & 0x80 && shift < 70);
      lo >>>= 0; hi >>>= 0;
      return { u: hi * 4294967296 + lo, lo };
    };
    while (i < b.length) {
      const key = varint().u;
      const n = Math.floor(key / 8), wt = key % 8;
      let v;
      if (wt === 0) v = varint();
      else if (wt === 1) { if (i + 8 > b.length) throw new Error("truncated fixed64"); v = { f64: b.subarray(i, i + 8) }; i += 8; }
      else if (wt === 2) { const len = varint().u; if (i + len > b.length) throw new Error("truncated bytes"); v = b.subarray(i, i + len); i += len; }
      else if (wt === 5) { if (i + 4 > b.length) throw new Error("truncated fixed32"); v = { f32: (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 }; i += 4; }
      else throw new Error("bad wire type " + wt);
      (out[n] || (out[n] = [])).push(v);
    }
    return out;
  }
  const first = (f, n) => (f[n] ? f[n][0] : undefined);
  const has = (f, n) => Boolean(f[n]);
  const uint = (f, n) => { const v = first(f, n); return v && v.u !== undefined ? v.u : v && v.f32 !== undefined ? v.f32 : undefined; };
  const int32 = (f, n) => { const v = first(f, n); return v && v.lo !== undefined ? v.lo | 0 : v && v.f32 !== undefined ? v.f32 | 0 : undefined; };
  const bool = (f, n) => { const v = uint(f, n); return v === undefined ? undefined : v !== 0; };
  const fixed = (f, n) => { const v = first(f, n); return v && v.f32 !== undefined ? v.f32 : undefined; };
  const sfixed = (f, n) => { const v = fixed(f, n); return v === undefined ? undefined : v | 0; };
  const f32buf = new DataView(new ArrayBuffer(4));
  const float = (f, n) => { const v = fixed(f, n); if (v === undefined) return undefined; f32buf.setUint32(0, v, true); return Math.round(f32buf.getFloat32(0, true) * 1000) / 1000; };
  const bytes = (f, n) => { const v = first(f, n); return v instanceof Uint8Array ? v : undefined; };
  const str = (f, n) => { const v = bytes(f, n); return v ? utf8(v).replace(/\u0000/g, "").trim() : undefined; };
  const sub = (f, n) => { const v = bytes(f, n); return v ? pb(v) : null; };

  // ------------------------------------------------------------------ Meshtastic enums (public values)
  const PORTS = { 1: "Text", 3: "Position", 4: "Node info", 5: "Routing", 6: "Admin", 7: "Text (compressed)", 8: "Waypoint", 10: "Detection sensor", 32: "Reply", 34: "Paxcounter", 64: "Serial", 65: "Store & forward", 66: "Range test", 67: "Telemetry", 70: "Traceroute", 71: "Neighbor info", 72: "ATAK", 73: "Map report" };
  const ROLES = ["Client", "Client mute", "Router", "Router client", "Repeater", "Tracker", "Sensor", "TAK", "Client hidden", "Lost and found", "TAK tracker", "Router late", "Client base"];
  const REGIONS = ["Unset", "US", "EU 433", "EU 868", "China", "Japan", "Australia / NZ", "Korea", "Taiwan", "Russia", "India", "NZ 865", "Thailand", "LoRa 2.4 GHz", "Ukraine 433", "Ukraine 868", "Malaysia 433", "Malaysia 919", "Singapore 923", "Philippines 433", "Philippines 868", "Philippines 915", "Australia / NZ 433", "Kazakhstan 433", "Kazakhstan 863", "Nepal 865", "Brazil 902"];
  const PRESETS = ["Long Fast", "Long Slow", "Very Long Slow", "Medium Slow", "Medium Fast", "Short Slow", "Short Fast", "Long Moderate", "Short Turbo", "Long Turbo"];
  const HW = { 1: "LilyGO T-LoRa V2", 2: "LilyGO T-LoRa V1", 3: "LilyGO T-LoRa V2.1-1.6", 4: "LilyGO T-Beam", 5: "Heltec V2.0", 6: "LilyGO T-Beam 0.7", 7: "LilyGO T-Echo", 8: "LilyGO T-LoRa V1.3", 9: "RAK WisBlock 4631", 10: "Heltec V2.1", 11: "Heltec V1", 12: "LilyGO T-Beam S3 Core", 13: "RAK 11200", 14: "Nano G1", 15: "LilyGO T-LoRa V2.1-1.8", 16: "LilyGO T3-S3", 17: "Nano G1 Explorer", 18: "Nano G2 Ultra", 25: "Station G1", 26: "RAK 11310", 31: "Station G2", 33: "LilyGO T-Echo Plus", 39: "DIY", 42: "M5Stack", 43: "Heltec V3", 44: "Heltec Wireless Stick Lite V3", 47: "Raspberry Pi Pico", 48: "Heltec Wireless Tracker", 49: "Heltec Wireless Paper", 50: "LilyGO T-Deck", 51: "LilyGO T-Watch S3", 53: "Heltec HT62", 58: "Heltec Wireless Tracker 1.0", 63: "nRF52 Pro Micro DIY", 66: "Heltec Vision Master T190", 67: "Heltec Vision Master E213", 68: "Heltec Vision Master E290", 69: "Heltec Mesh Node T114", 70: "SenseCAP Indicator", 71: "Seeed T1000-E tracker", 79: "Raspberry Pi Pico 2", 81: "Seeed XIAO S3", 84: "RAK WisMesh Tap", 88: "Seeed XIAO nRF52 kit", 89: "ThinkNode M1", 90: "ThinkNode M2", 94: "Heltec Mesh Pocket", 95: "Seeed solar node", 99: "Seeed Wio Tracker L1", 102: "LilyGO T-Deck Pro", 103: "LilyGO T-LoRa Pager", 110: "Heltec V4", 255: "Private hardware" };
  const hwName = (n) => (n == null ? "" : HW[n] || (n ? "Model " + n : ""));

  function position(f) {
    if (!f) return null;
    const latI = sfixed(f, 1), lonI = sfixed(f, 2);
    const p = {};
    if (latI !== undefined && lonI !== undefined && (latI !== 0 || lonI !== 0)) { p.lat = latI / 1e7; p.lon = lonI / 1e7; }
    const alt = int32(f, 3); if (alt !== undefined) p.alt = alt;
    const t = fixed(f, 4) || fixed(f, 7); if (t) p.time = t;
    const gs = uint(f, 15); if (gs !== undefined) p.speed = gs;
    const gt = uint(f, 16); if (gt !== undefined) p.track = gt / 1e5 > 360 ? undefined : gt / 1e5;
    const sats = uint(f, 19); if (sats !== undefined) p.sats = sats;
    const prec = uint(f, 23); if (prec !== undefined) p.precisionBits = prec;
    if (p.lat !== undefined && (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) { delete p.lat; delete p.lon; }
    return p;
  }
  function user(f) {
    if (!f) return null;
    return { id: str(f, 1), longName: str(f, 2), shortName: str(f, 3), hwModel: uint(f, 5), hw: hwName(uint(f, 5)), licensed: bool(f, 6), role: ROLES[uint(f, 7) || 0] || "" };
  }
  function deviceMetrics(f) {
    if (!f) return null;
    const m = { battery: uint(f, 1), voltage: float(f, 2), chUtil: float(f, 3), airUtilTx: float(f, 4), uptime: uint(f, 5) };
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    return m;
  }
  function envMetrics(f) {
    if (!f) return null;
    const m = { tempC: float(f, 1), rh: float(f, 2), pressure: float(f, 3), iaq: uint(f, 7), lux: float(f, 9), windSpeed: float(f, 14), windDir: uint(f, 13) };
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    return m;
  }
  function telemetry(f) {
    if (!f) return null;
    return { time: fixed(f, 1), device: deviceMetrics(sub(f, 2)), env: envMetrics(sub(f, 3)) };
  }
  function meshPacket(f) {
    const from = fixed(f, 1), to = fixed(f, 2);
    const ev = { type: "packet", from, fromId: from !== undefined ? nodeId(from) : "", to, toId: to !== undefined ? nodeId(to) : "", broadcast: to === 0xffffffff, channel: uint(f, 3) || 0, id: fixed(f, 6), rxTime: fixed(f, 7), snr: float(f, 8), rssi: int32(f, 12), viaMqtt: bool(f, 14) };
    const hopLimit = uint(f, 9), hopStart = uint(f, 15);
    if (hopStart !== undefined && hopLimit !== undefined && hopStart >= hopLimit) ev.hops = hopStart - hopLimit;
    const d = sub(f, 4);
    if (!d) { ev.encrypted = has(f, 5); return ev; }
    ev.port = uint(d, 1) || 0;
    ev.portName = PORTS[ev.port] || "Port " + ev.port;
    const pl = bytes(d, 2) || new Uint8Array(0);
    try {
      if (ev.port === 1) ev.text = utf8(pl);
      else if (ev.port === 3) ev.position = position(pb(pl));
      else if (ev.port === 4) ev.user = user(pb(pl));
      else if (ev.port === 67) ev.telemetry = telemetry(pb(pl));
    } catch (e) { ev.bad = true; }
    return ev;
  }
  // One FromRadio protobuf -> one normalized event (or null for things we do not show).
  function decodeFromRadio(buf) {
    const f = pb(buf);
    if (has(f, 2)) return meshPacket(sub(f, 2));
    if (has(f, 3)) { const m = sub(f, 3); return { type: "myInfo", myNum: uint(m, 1), myId: nodeId(uint(m, 1) || 0), rebootCount: uint(m, 8), pioEnv: str(m, 13), nodedbCount: uint(m, 15) }; }
    if (has(f, 4)) {
      const n = sub(f, 4);
      const num = uint(n, 1) || 0;
      return { type: "node", num, id: nodeId(num), user: user(sub(n, 2)), position: position(sub(n, 3)), snr: float(n, 4), lastHeard: fixed(n, 5), metrics: deviceMetrics(sub(n, 6)), channel: uint(n, 7), viaMqtt: bool(n, 8), hops: uint(n, 9) };
    }
    if (has(f, 5)) {
      const c = sub(f, 5);
      if (has(c, 6)) { const l = sub(c, 6); const usePreset = bool(l, 1); return { type: "lora", usePreset, preset: usePreset !== false ? PRESETS[uint(l, 2) || 0] || "" : "Custom", region: REGIONS[uint(l, 7) || 0] || "Region " + uint(l, 7), hopLimit: uint(l, 8), txEnabled: bool(l, 9) }; }
      return { type: "config" };
    }
    if (has(f, 7)) return { type: "configComplete", id: uint(f, 7) };
    if (has(f, 8)) return { type: "rebooted" };
    if (has(f, 10)) {
      const c = sub(f, 10), s = sub(c, 2);
      const role = uint(c, 3) || 0;
      return { type: "channel", index: uint(c, 1) || 0, name: s ? str(s, 3) || "" : "", role: ["Disabled", "Primary", "Secondary"][role] || "", encrypted: s ? (bytes(s, 2) || []).length > 1 : false };
    }
    if (has(f, 13)) { const m = sub(f, 13); return { type: "metadata", firmware: str(m, 1), hw: hwName(uint(m, 9)), role: ROLES[uint(m, 7) || 0] || "", wifi: bool(m, 4), bluetooth: bool(m, 5) }; }
    return null;
  }

  // ------------------------------------------------------------------ Meshtastic framing
  function varintBytes(n) { const out = []; n = Math.floor(n); while (n > 127) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); return out; }
  const mtWantConfig = (nonce) => Uint8Array.from([0x18].concat(varintBytes(nonce))); // ToRadio.want_config_id (field 3)
  const mtHeartbeat = () => Uint8Array.from([0x3a, 0x00]); // ToRadio.heartbeat (field 7), empty message
  function mtFrame(payload) { const out = new Uint8Array(payload.length + 4); out[0] = 0x94; out[1] = 0xc3; out[2] = (payload.length >> 8) & 0xff; out[3] = payload.length & 0xff; out.set(payload, 4); return out; }
  function MtFramer() {
    let state = 0, len = 0, buf = null, at = 0;
    return function push(chunk, emit) {
      for (let i = 0; i < chunk.length; i += 1) {
        const c = chunk[i];
        if (state === 0) { if (c === 0x94) state = 1; }
        else if (state === 1) state = c === 0xc3 ? 2 : c === 0x94 ? 1 : 0;
        else if (state === 2) { len = c << 8; state = 3; }
        else if (state === 3) { len |= c; if (len === 0 || len > 512) { state = c === 0x94 ? 1 : 0; continue; } buf = new Uint8Array(len); at = 0; state = 4; }
        else { buf[at++] = c; if (at === len) { state = 0; emit(buf); } }
      }
    };
  }

  // ------------------------------------------------------------------ MeshCore companion protocol
  const MC = { APP_START: 1, GET_CONTACTS: 4, SYNC_NEXT: 10, DEVICE_QUERY: 22, GET_CHANNEL: 31 };
  const MC_TYPES = ["", "Companion", "Repeater", "Room server", "Sensor"];
  function mcFrame(payload) { const out = new Uint8Array(payload.length + 3); out[0] = 0x3c; out[1] = payload.length & 0xff; out[2] = (payload.length >> 8) & 0xff; out.set(payload, 3); return out; }
  function mcAppStart() { const name = "GlobalStatus"; const out = new Uint8Array(8 + name.length); out[0] = MC.APP_START; out[1] = 3; for (let i = 0; i < name.length; i += 1) out[8 + i] = name.charCodeAt(i); return out; }
  function McFramer() {
    let state = 0, len = 0, buf = null, at = 0;
    return function push(chunk, emit) {
      for (let i = 0; i < chunk.length; i += 1) {
        const c = chunk[i];
        if (state === 0) { if (c === 0x3e) state = 1; }
        else if (state === 1) { len = c; state = 2; }
        else if (state === 2) { len |= c << 8; if (len === 0 || len > 300) { state = 0; continue; } buf = new Uint8Array(len); at = 0; state = 3; }
        else { buf[at++] = c; if (at === len) { state = 0; emit(buf); } }
      }
    };
  }
  const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const les32 = (b, o) => le32(b, o) | 0;
  const cstr = (b) => { const z = b.indexOf(0); return utf8(z >= 0 ? b.subarray(0, z) : b).trim(); };
  function mcLatLon(b, o) { const lat = les32(b, o) / 1e6, lon = les32(b, o + 4) / 1e6; return lat || lon ? { lat, lon } : {}; }
  function decodeMeshCore(b) {
    const code = b[0];
    if (code === 3 || code === 0x8a) {
      if (b.length < 1 + 32 + 3 + 64 + 32 + 12) return null;
      const key = b.subarray(1, 33);
      const o = 1 + 32 + 3 + 64;
      return Object.assign({ type: "mcContact", pubkey: hex(key), id: "!" + hex(key.subarray(0, 4)), kind: MC_TYPES[b[33]] || "Node", name: cstr(b.subarray(o, o + 32)), lastAdvert: le32(b, o + 32), hops: b[35] === 255 ? undefined : b[35] & 0x3f, push: code === 0x8a }, mcLatLon(b, o + 36));
    }
    if (code === 2) return { type: "mcContactsStart", count: b.length >= 5 ? le32(b, 1) : undefined };
    if (code === 4) return { type: "mcContactsEnd" };
    if (code === 5) {
      if (b.length < 58) return null;
      const key = b.subarray(4, 36);
      return Object.assign({ type: "mcSelf", kind: MC_TYPES[b[1]] || "Companion", txPower: b[2], pubkey: hex(key), id: "!" + hex(key.subarray(0, 4)), freqMHz: le32(b, 48) / 1000, bwKHz: le32(b, 52) / 1000, sf: b[56], cr: b[57], name: utf8(b.subarray(58)).replace(/\u0000/g, "").trim() }, mcLatLon(b, 36));
    }
    if (code === 13) {
      const ev = { type: "mcDeviceInfo", fwVer: b[1] };
      if (b[1] >= 3 && b.length >= 80) Object.assign(ev, { maxContacts: b[2] * 2, maxChannels: b[3], build: cstr(b.subarray(8, 20)), model: cstr(b.subarray(20, 60)), version: cstr(b.subarray(60, 80)) });
      return ev;
    }
    if (code === 7 || code === 16) {
      let o = 1; let snr;
      if (code === 16) { snr = ((b[1] << 24) >> 24) / 4; o = 4; }
      const prefix = hex(b.subarray(o, o + 6)); o += 6;
      const pathLen = b[o]; const txtType = b[o + 1]; const ts = le32(b, o + 2); o += 6;
      if (txtType === 2) o += 4;
      return { type: "mcText", dm: true, fromPrefix: prefix, fromId: "!" + prefix.slice(0, 8), snr, hops: pathLen === 255 ? undefined : pathLen & 0x3f, time: ts, text: utf8(b.subarray(o)).replace(/\u0000/g, "") };
    }
    if (code === 8 || code === 17) {
      let o = 1; let snr;
      if (code === 17) { snr = ((b[1] << 24) >> 24) / 4; o = 4; }
      const ch = b[o]; const pathLen = b[o + 1]; const ts = le32(b, o + 3); o += 7;
      return { type: "mcText", dm: false, channel: ch, snr, hops: pathLen === 255 ? undefined : pathLen & 0x3f, time: ts, text: utf8(b.subarray(o)).replace(/\u0000/g, "") };
    }
    if (code === 18) return b.length >= 34 ? { type: "mcChannel", index: b[1], name: cstr(b.subarray(2, 34)) } : null;
    if (code === 10) return { type: "mcNoMore" };
    if (code === 0x80) return { type: "mcAdvert", pubkey: hex(b.subarray(1, 33)) };
    if (code === 0x83) return { type: "mcWaiting" };
    if (code === 0) return { type: "mcOk" };
    if (code === 1) return { type: "mcError", err: b[1] };
    return null;
  }

  // ------------------------------------------------------------------ support
  function support() {
    const nav = root.navigator || {};
    const secure = root.isSecureContext !== false;
    const serial = Boolean(nav.serial) && secure;
    const ble = Boolean(nav.bluetooth) && secure;
    let reason = "";
    if (!serial && !ble) {
      const ua = String(nav.userAgent || "");
      if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) reason = "iPhone and iPad browsers can't talk to USB or Bluetooth radios. Use Chrome or Edge on a computer, or Chrome on Android.";
      else if (/Firefox\//.test(ua)) reason = "Firefox can't talk to USB or Bluetooth radios. Open Global Status in Chrome, Edge or Opera to connect a Meshtastic or MeshCore radio.";
      else if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) reason = "Safari can't talk to USB or Bluetooth radios. Open Global Status in Chrome, Edge or Opera to connect a Meshtastic or MeshCore radio.";
      else reason = secure ? "This browser can't talk to USB or Bluetooth radios. Use Chrome, Edge or Opera on a computer, or Chrome on Android." : "Mesh radios need a secure (https) page.";
    }
    return { ok: serial || ble, serial, ble, reason };
  }

  // ------------------------------------------------------------------ session
  // h: { event(ev), log(text), closed(reason) }
  function Session(h) {
    const s = { proto: "", transport: "", name: "", open: true, timers: [], mc: { waiters: [], lastmod: 0, refreshT: 0, syncing: false } };
    let writeRaw = null; // (Uint8Array) => Promise
    let closeTransport = null;
    const mtPush = MtFramer(), mcPush = McFramer();
    let detectResolve = null;
    function emit(ev) { if (ev && s.open) { try { h.event(ev); } catch (e) { h.log && h.log("Mesh view error: " + (e && e.message)); } } }
    function onMt(buf) {
      if (!s.proto && s.detecting) { s.proto = "meshtastic"; if (detectResolve) detectResolve(); }
      if (s.proto !== "meshtastic") return;
      let ev; try { ev = decodeFromRadio(buf); } catch (e) { h.log && h.log("Skipped a malformed Meshtastic frame"); return; }
      emit(ev);
    }
    function onMc(buf) {
      if (!s.proto && s.detecting && buf[0] === 5) { s.proto = "meshcore"; if (detectResolve) detectResolve(); }
      if (s.proto !== "meshcore") return;
      let ev; try { ev = decodeMeshCore(buf); } catch (e) { return; }
      for (const w of s.mc.waiters.slice()) if (w.codes.includes(buf[0])) { s.mc.waiters.splice(s.mc.waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(ev); }
      if (!ev) return;
      if (ev.type === "mcWaiting") syncMessages();
      if (ev.type === "mcAdvert") { clearTimeout(s.mc.refreshT); s.mc.refreshT = setTimeout(() => mcRequest([MC.GET_CONTACTS], [4], 10000), 4000); }
      emit(ev);
    }
    // Byte stream (USB / simulator): feed both framers until the protocol is known.
    function onBytes(chunk) {
      if (!s.open) return;
      if (s.proto !== "meshcore") mtPush(chunk, onMt);
      if (s.proto !== "meshtastic") mcPush(chunk, onMc);
    }
    function mcRequest(cmd, codes, ms) {
      return new Promise((resolve) => {
        if (!s.open) { resolve(null); return; }
        const w = { codes: codes.concat([1]), resolve, t: 0 };
        w.t = setTimeout(() => { const i = s.mc.waiters.indexOf(w); if (i >= 0) s.mc.waiters.splice(i, 1); resolve(null); }, ms || 2500);
        s.mc.waiters.push(w);
        writeMc(Uint8Array.from(cmd)).catch(() => resolve(null));
      });
    }
    let writeMc = (p) => writeRaw(mcFrame(p));
    let writeMt = (p) => writeRaw(mtFrame(p));
    async function syncMessages() {
      if (s.mc.syncing) return;
      s.mc.syncing = true;
      for (let i = 0; i < 60 && s.open; i += 1) { const r = await mcRequest([MC.SYNC_NEXT], [7, 8, 10, 16, 17], 3000); if (!r || r.type === "mcNoMore" || r.type === "mcError") break; }
      s.mc.syncing = false;
    }
    async function startMeshtastic() {
      const nonce = 1 + Math.floor(Math.random() * 0x7ffffff0);
      await writeMt(mtWantConfig(nonce));
      const hb = setInterval(() => { if (s.open) writeMt(mtHeartbeat()).catch(() => {}); }, HEARTBEAT_MS);
      s.timers.push(hb);
    }
    async function startMeshCore() {
      // app start already answered with SELF_INFO during detection (or is sent here for BLE)
      await mcRequest([MC.DEVICE_QUERY, 3], [13], 2500);
      await mcRequest([MC.GET_CONTACTS], [4], 12000);
      for (let i = 0; i < 8 && s.open; i += 1) { const r = await mcRequest([MC.GET_CHANNEL, i], [18], 1500); if (!r || r.type === "mcError") break; }
      emit({ type: "configComplete" });
      await syncMessages();
    }
    async function detect() {
      const wait = (ms) => new Promise((resolve) => { if (s.proto) { resolve(); return; } detectResolve = resolve; setTimeout(resolve, ms); });
      s.detecting = true;
      // Meshtastic: 32 wake bytes, then want_config_id.
      await writeRaw(new Uint8Array(32).fill(0xc3));
      const nonce = 1 + Math.floor(Math.random() * 0x7ffffff0);
      await writeRaw(mtFrame(mtWantConfig(nonce)));
      await wait(2500);
      if (s.proto === "meshtastic") { detectResolve = null; s.detecting = false; s.timers.push(setInterval(() => { if (s.open) writeMt(mtHeartbeat()).catch(() => {}); }, HEARTBEAT_MS)); return; }
      await writeRaw(mcFrame(mcAppStart()));
      await wait(2500);
      detectResolve = null; s.detecting = false;
      if (s.proto === "meshcore") { startMeshCore(); return; }
      throw new Error("NO_ANSWER");
    }
    s.useStream = async (stream, transport, name) => {
      s.transport = transport; s.name = name;
      writeRaw = stream.write; closeTransport = stream.close;
      stream.start(onBytes, (why) => s.close(why || "The radio was unplugged."));
      await detect();
    };
    s.useBleMeshtastic = async (svc, name) => {
      s.transport = "ble"; s.name = name; s.proto = "meshtastic";
      const to = await svc.getCharacteristic(MT_TORADIO), from = await svc.getCharacteristic(MT_FROMRADIO), num = await svc.getCharacteristic(MT_FROMNUM);
      let draining = false, again = false;
      const drain = async () => {
        if (draining) { again = true; return; }
        draining = true;
        try {
          do { again = false; for (let i = 0; i < 2000 && s.open; i += 1) { const v = await from.readValue(); if (!v || !v.byteLength) break; onMt(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()); } } while (again && s.open);
        } catch (e) { if (s.open) h.log && h.log("Bluetooth read failed: " + (e && e.message)); }
        draining = false;
      };
      await num.startNotifications();
      num.addEventListener("characteristicvaluechanged", drain);
      writeMt = (p) => to.writeValue(p);
      writeRaw = writeMt;
      await startMeshtastic();
      await drain();
    };
    s.useBleMeshCore = async (svc, name) => {
      s.transport = "ble"; s.name = name; s.proto = "meshcore";
      const rx = await svc.getCharacteristic(NUS_RX), tx = await svc.getCharacteristic(NUS_TX);
      tx.addEventListener("characteristicvaluechanged", (e) => { const v = e.target.value; onMc(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()); });
      await tx.startNotifications();
      writeMc = (p) => (rx.writeValueWithResponse ? rx.writeValueWithResponse(p) : rx.writeValue(p));
      writeRaw = writeMc;
      const self = await mcRequest(Array.from(mcAppStart()), [5], 4000);
      if (!self) throw new Error("NO_ANSWER");
      startMeshCore();
    };
    s.setBleClose = (fn) => { closeTransport = fn; };
    s.close = (reason) => {
      if (!s.open) return;
      s.open = false;
      for (const t of s.timers) clearInterval(t);
      clearTimeout(s.mc.refreshT);
      for (const w of s.mc.waiters) { clearTimeout(w.t); w.resolve(null); }
      s.mc.waiters = [];
      try { closeTransport && closeTransport(); } catch (e) { /* already gone */ }
      h.closed && h.closed(reason || "");
    };
    return s;
  }

  // Web Serial byte stream
  function serialStream(port) {
    let reader = null, writer = null, alive = true;
    return {
      write: async (bytes) => { if (!writer) writer = port.writable.getWriter(); await writer.write(bytes); },
      start: (onBytes, onEnd) => {
        (async () => {
          while (alive && port.readable) {
            reader = port.readable.getReader();
            try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) onBytes(value); } }
            catch (e) { if (!alive) break; }
            finally { try { reader.releaseLock(); } catch (e) { /* ignore */ } }
            if (!alive) break;
            if (!port.readable) break;
          }
          if (alive) onEnd("The USB connection closed.");
        })();
      },
      close: async () => {
        alive = false;
        try { if (reader) await reader.cancel(); } catch (e) { /* ignore */ }
        try { if (writer) { writer.releaseLock(); } } catch (e) { /* ignore */ }
        try { await port.close(); } catch (e) { /* ignore */ }
      },
    };
  }

  async function connect(kind, h, opts) {
    const s = Session(h);
    try {
      if (kind === "sim") {
        await s.useStream(opts.stream, opts.transport || "sim", opts.name || "Simulated mesh radio");
      } else if (kind === "serial") {
        const port = await root.navigator.serial.requestPort({});
        await port.open({ baudRate: BAUD });
        const info = port.getInfo ? port.getInfo() : {};
        const name = info.usbVendorId === 0x239a ? "nRF52 radio (USB)" : info.usbVendorId === 0x303a ? "ESP32-S3 radio (USB)" : info.usbVendorId === 0x10c4 ? "CP210x radio (USB)" : info.usbVendorId === 0x1a86 ? "CH340 radio (USB)" : "Mesh radio (USB)";
        await s.useStream(serialStream(port), "serial", name);
        if (root.navigator.serial.addEventListener) root.navigator.serial.addEventListener("disconnect", (e) => { if (e.target === port || e.port === port) s.close("The radio was unplugged."); });
      } else {
        const dev = await root.navigator.bluetooth.requestDevice({ filters: [{ services: [MT_SVC] }, { namePrefix: "MeshCore" }, { namePrefix: "Meshtastic" }], optionalServices: [MT_SVC, NUS_SVC] });
        dev.addEventListener("gattserverdisconnected", () => s.close("Bluetooth disconnected."));
        const gatt = await dev.gatt.connect();
        s.setBleClose(() => { try { gatt.disconnect(); } catch (e) { /* ignore */ } });
        let svc = null;
        try { svc = await gatt.getPrimaryService(MT_SVC); } catch (e) { svc = null; }
        if (svc) await s.useBleMeshtastic(svc, dev.name || "Meshtastic radio");
        else { const nus = await gatt.getPrimaryService(NUS_SVC); await s.useBleMeshCore(nus, dev.name || "MeshCore radio"); }
      }
    } catch (e) { s.close(""); throw e; }
    return s;
  }
  function friendlyError(e) {
    const m = String((e && (e.message || e.name)) || e || "");
    if (/NO_ANSWER/.test(m)) return "The radio didn't answer as Meshtastic or MeshCore. Close the Meshtastic or MeshCore app (or any other tab using it), make sure it runs Meshtastic or MeshCore companion firmware, then try again.";
    if (e && e.name === "NotFoundError") return /cancel/i.test(m) || /No port selected|User cancelled/i.test(m) ? "No radio was picked." : "No radio was picked.";
    if (e && e.name === "SecurityError") return "The browser blocked access to the radio on this page.";
    if (e && e.name === "NetworkError") return "Couldn't open the radio. It may be in use by another app or tab; close it and try again.";
    if (/already open|InvalidStateError/i.test(m)) return "That port is already open in another tab or app. Close it and try again.";
    return "Couldn't connect to the mesh radio: " + m.replace(/(https?:\/\/|www\.)\S*/g, "").slice(0, 140);
  }

  const api = { support, connect, friendlyError, decodeFromRadio, decodeMeshCore, MtFramer, McFramer, mtFrame, mcFrame, mtWantConfig, mtHeartbeat, mcAppStart, pb, nodeId, hwName, ROLES, MT_SVC, NUS_SVC };
  root.GsaMeshDevice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
