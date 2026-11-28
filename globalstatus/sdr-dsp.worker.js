/* Global Status · SDR DSP worker (receive only; Phase 2 decoders live in sdr-dsp2.js)
 *
 * Original clean-room code for Global Status App. Written from public protocol
 * descriptions (Mode-S / 1090ES, ITU-R M.1371 AIS, AX.25 + APRS 1.0.1, POCSAG
 * (CCIR Radiopaging Code No. 1), Vaisala RS41 frame layout notes, generic OOK/Manchester).
 *
 * In:  {t:"config"} tuning + mode, {t:"iq"} raw USB sample buffers (s8 HackRF, u8 RTL-SDR),
 *      {t:"cap"} raw capture, {t:"decode"} single test frame (QA), {t:"sim"} synthetic IQ (QA only).
 * Out: {t:"fft"}, {t:"level"}, {t:"audio"}, {t:"adsb"|"ais"|"aprs"|"sonde"|"pager"|"device"},
 *      {t:"health"}, {t:"log"}, {t:"cap"}, {t:"capdata"}.
 * Nothing here can transmit; the worker only ever reads samples.
 */
"use strict";

const TAU = Math.PI * 2;
const post = (m, transfer) => self.postMessage(m, transfer || []);

// ------------------------------------------------------------------ state
const S = {
  rate: 2400000,
  center: 100.1e6 - 300000,
  tuned: 100.1e6,
  device: "",
  mode: "WFM",
  audioOn: false,
  squelch: -70,
  volume: 0.8,
  ref: null, // receiver lat/lon for local CPR
  band: "fm",
};
const H = { samples: 0, transfers: 0, dropped: 0, rmsAcc: 0, rmsN: 0, iqRMS: 0, packets: { adsb: 0, ais: 0, aprs: 0, sonde: 0, pager: 0, device: 0 }, crcFail: 0 };

// ------------------------------------------------------------------ bands
// Which decoders run is decided only by where the radio is tuned (one radio, one band).
function bandOf(hz) {
  const m = hz / 1e6, near = (f, t) => Math.abs(m - f) <= t;
  if (near(1090, 1.2)) return "adsb";
  if (near(978, 1.2)) return "uat";
  if (m >= 161.9 && m <= 162.1) return "ais";
  if (near(144.39, 0.02) || near(144.8, 0.02)) return "aprs";
  if ([1.84, 3.573, 7.074, 10.136, 14.074, 18.1, 21.074, 24.915, 28.074, 50.313, 3.578, 7.078, 14.078, 21.078, 28.078].some((f) => near(f, 0.004))) return "ft8";
  if (m >= 400 && m <= 406.1) return "sonde";
  if (near(457.9375, 0.006) || near(452.9375, 0.006)) return "train";
  if ([151.82, 151.88, 151.94, 154.57, 154.6].some((f) => near(f, 0.006))) return "voice";
  if ((m >= 152 && m <= 159) || (m >= 929 && m <= 932) || (m >= 466 && m <= 466.3)) return "pager";
  if (m >= 129 && m <= 132) return "acars";
  if (m >= 136.6 && m < 137) return "vdl2";
  if ((m >= 137 && m <= 138) || (m >= 145.8 && m <= 146) || (m >= 435 && m <= 438)) return "sat";
  if (near(908.42, 0.05) || near(868.42, 0.05) || near(916, 0.05)) return "zwave";
  if (near(906.875, 0.3) || near(915, 0.15) || (m >= 868 && m <= 870) || near(910.525, 0.05)) return "mesh";
  if (m >= 910 && m <= 920) return "meter";
  if (m >= 2400 && m <= 2483.5) return "ble";
  if ((m >= 617 && m <= 652) || (m >= 729 && m <= 756) || (m >= 869 && m <= 894) || (m >= 1805 && m <= 1880) || (m >= 1930 && m <= 1995) || (m >= 2110 && m <= 2200)) return "lte";
  if ((m >= 470 && m <= 608) || (m >= 174 && m <= 216)) return "atsc";
  if (near(433.92, 0.15) || near(315, 0.15) || near(345, 0.15) || near(319.5, 0.15)) return "tpms";
  if ((m >= 26.96 && m <= 27.41) || (m >= 462.55 && m <= 462.73) || (m >= 467.55 && m <= 467.73) || (m >= 144 && m <= 148) || (m >= 420 && m <= 450) || (m >= 28 && m <= 29.7) || (m >= 50 && m <= 54)) return "voice";
  if ((m >= 450 && m <= 470) || (m >= 851 && m <= 869) || (m >= 380 && m <= 400) || (m >= 769 && m <= 775) || (m >= 806 && m <= 824) || (m >= 159 && m <= 174)) return "dispatch";
  if (m >= 87.5 && m <= 108.1) return "fm";
  return "other";
}

// ------------------------------------------------------------------ FFT (radix-2 Cooley-Tukey)
const FFT_N = 1024;
const fft = (() => {
  const n = FFT_N;
  const re = new Float64Array(n), im = new Float64Array(n);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i += 1) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)); // Hann
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i += 1) { let r = 0; for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) { cs[i] = Math.cos((TAU * i) / n); sn[i] = -Math.sin((TAU * i) / n); }
  const winSum = win.reduce((a, b) => a + b, 0);
  return function power(iq, startSample) {
    for (let i = 0; i < n; i += 1) {
      const k = (startSample + i) * 2;
      const j = rev[i];
      re[j] = iq[k] * win[i];
      im[j] = iq[k + 1] * win[i];
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k += 1) {
          const wr = cs[k * step], wi = sn[k * step];
          const a = s + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    const out = new Float32Array(n);
    const norm = 1 / (winSum * winSum);
    for (let i = 0; i < n; i += 1) {
      const j = (i + n / 2) % n; // fftshift: DC in the middle
      out[i] = 10 * Math.log10((re[j] * re[j] + im[j] * im[j]) * norm + 1e-12);
    }
    return out;
  };
})();

// ------------------------------------------------------------------ filters / channelizer
function lowpassTaps(n, fc, fs) {
  const h = new Float32Array(n);
  const m = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i - m;
    const sinc = x === 0 ? (2 * fc) / fs : Math.sin((TAU * fc * x) / fs) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((TAU * i) / (n - 1)) + 0.08 * Math.cos((2 * TAU * i) / (n - 1)); // Blackman
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < n; i += 1) h[i] /= sum;
  return h;
}

// FIR decimator for complex streams (or real when inIm is null).
class FirDecim {
  constructor(taps, d, complex) {
    this.h = taps; this.n = taps.length; this.d = d;
    this.br = new Float32Array(this.n * 2); this.bi = complex ? new Float32Array(this.n * 2) : null;
    this.pos = 0; this.ph = 0;
  }
  run(inRe, inIm, len, outRe, outIm) {
    const h = this.h, n = this.n, br = this.br, bi = this.bi;
    let o = 0;
    for (let i = 0; i < len; i += 1) {
      br[this.pos] = br[this.pos + n] = inRe[i];
      if (bi) bi[this.pos] = bi[this.pos + n] = inIm[i];
      this.pos = (this.pos + 1) % n;
      this.ph += 1;
      if (this.ph >= this.d) {
        this.ph = 0;
        let ar = 0, ai = 0;
        const base = this.pos;
        for (let k = 0; k < n; k += 1) { ar += h[k] * br[base + k]; if (bi) ai += h[k] * bi[base + k]; }
        outRe[o] = ar; if (outIm) outIm[o] = ai;
        o += 1;
      }
    }
    return o;
  }
}

// NCO mix (offset -> DC) + triangular (CIC-2 equivalent) decimation to ~240 kS/s,
// then a Blackman FIR down to ~48 kS/s for narrowband decoders and audio.
class Channel {
  constructor(fs, offset) {
    this.fs = fs; this.offset = offset;
    this.d1 = Math.max(1, Math.round(fs / 240000));
    this.fs1 = fs / this.d1;
    this.fs2 = this.fs1 / 5;
    const w = (-TAU * offset) / fs;
    this.cw = Math.cos(w); this.sw = Math.sin(w);
    this.c = 1; this.s = 0;
    this.j = 0; this.Rr = 0; this.Ri = 0; this.Fr = 0; this.Fi = 0; this.pRr = 0; this.pRi = 0;
    this.fir = new FirDecim(lowpassTaps(63, 16000, this.fs1), 5, true);
    this.cap = 0;
    this.power = -120; // dB of the 48k channel
  }
  ensure(n) {
    if (this.cap >= n) return;
    this.cap = n;
    this.r1 = new Float32Array(n); this.i1 = new Float32Array(n);
    this.r2 = new Float32Array(n); this.i2 = new Float32Array(n);
  }
  process(iq, n) {
    this.ensure(Math.ceil(n / this.d1) + 4);
    const d = this.d1, inv = 1 / (d * d);
    let c = this.c, s = this.s, o = 0;
    const cw = this.cw, sw = this.sw;
    for (let k = 0; k < n; k += 1) {
      const xr = iq[2 * k], xi = iq[2 * k + 1];
      const yr = xr * c - xi * s, yi = xr * s + xi * c;
      const nc = c * cw - s * sw; s = c * sw + s * cw; c = nc;
      const j = this.j;
      this.Rr += (j + 1) * yr; this.Ri += (j + 1) * yi;
      this.Fr += (d - 1 - j) * yr; this.Fi += (d - 1 - j) * yi;
      this.j = j + 1;
      if (this.j === d) {
        this.r1[o] = (this.pRr + this.Fr) * inv; this.i1[o] = (this.pRi + this.Fi) * inv; o += 1;
        this.pRr = this.Rr; this.pRi = this.Ri; this.Rr = this.Ri = this.Fr = this.Fi = 0; this.j = 0;
      }
    }
    const mag = Math.hypot(c, s); this.c = c / mag; this.s = s / mag;
    this.n1 = o;
    this.n2 = this.fir.run(this.r1, this.i1, o, this.r2, this.i2);
    let p = 0;
    for (let k = 0; k < this.n2; k += 1) p += this.r2[k] * this.r2[k] + this.i2[k] * this.i2[k];
    if (this.n2) this.power = 0.7 * this.power + 0.3 * (10 * Math.log10(p / this.n2 + 1e-12));
    return this;
  }
}

// FM discriminator (output in Hz) with state between blocks.
class Disc {
  constructor(fs) { this.fs = fs; this.pr = 1; this.pi = 0; this.out = new Float32Array(0); }
  run(re, im, n) {
    if (this.out.length < n) this.out = new Float32Array(n);
    const k = this.fs / TAU;
    let pr = this.pr, pi = this.pi;
    for (let i = 0; i < n; i += 1) {
      const r = re[i], q = im[i];
      this.out[i] = Math.atan2(q * pr - r * pi, r * pr + q * pi) * k;
      pr = r; pi = q;
    }
    this.pr = pr; this.pi = pi;
    return this.out;
  }
}

// Bit clock recovery: integrate and dump, nudged by zero crossings.
class Slicer {
  constructor(sps, onBit, gain) { this.sps = sps; this.inc = 1 / sps; this.ph = 0; this.acc = 0; this.prev = 0; this.onBit = onBit; this.g = gain || 0.3; this.dc = 0; this.dcA = 0.0005; this.useDc = false; }
  push(v) {
    if (this.useDc) { this.dc += (v - this.dc) * this.dcA; v -= this.dc; }
    if ((v > 0) !== (this.prev > 0)) { let e = this.ph; if (e > 0.5) e -= 1; this.ph -= e * this.g; }
    this.prev = v; this.acc += v; this.ph += this.inc;
    if (this.ph >= 1) { this.ph -= 1; this.onBit(this.acc > 0 ? 1 : 0, Math.abs(this.acc)); this.acc = 0; }
  }
}

// ------------------------------------------------------------------ CRCs
function modesCrc(bytes, nbits) {
  let crc = 0;
  const n = nbits / 8 - 3;
  for (let i = 0; i < n; i += 1) {
    crc ^= bytes[i] << 16;
    for (let b = 0; b < 8; b += 1) { crc <<= 1; if (crc & 0x1000000) crc ^= 0x1fff409; }
  }
  return crc & 0xffffff;
}
function crc16x25(bytes, len) { // HDLC FCS (AX.25, AIS): reflected 0x1021, init 0xFFFF, inverted
  let crc = 0xffff;
  for (let i = 0; i < len; i += 1) { crc ^= bytes[i]; for (let b = 0; b < 8; b += 1) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1; }
  return ~crc & 0xffff;
}
function crc16ccitt(bytes, start, len) { // RS41 blocks: 0x1021, init 0xFFFF
  let crc = 0xffff;
  for (let i = start; i < start + len; i += 1) { crc ^= bytes[i] << 8; for (let b = 0; b < 8; b += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc;
}
function crc8(bytes, len) { let c = 0; for (let i = 0; i < len; i += 1) { c ^= bytes[i]; for (let b = 0; b < 8; b += 1) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; }

// ------------------------------------------------------------------ Mode-S / ADS-B
const AIS_SIXBIT = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";
const ADSB_CHARS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";
function bitsOf(bytes, start, len) { let v = 0; for (let i = 0; i < len; i += 1) { const b = start + i; v = v * 2 + ((bytes[b >> 3] >> (7 - (b & 7))) & 1); } return v; }
function cprNL(lat) {
  const a = Math.abs(lat);
  if (a < 1e-9) return 59;
  if (Math.abs(a - 87) < 1e-9) return 2;
  if (a > 87) return 1;
  const nz = 15;
  const x = 1 - (1 - Math.cos(Math.PI / (2 * nz))) / Math.pow(Math.cos((Math.PI / 180) * a), 2);
  return Math.floor(TAU / Math.acos(x));
}
const mod = (a, b) => a - b * Math.floor(a / b);
function cprGlobal(e, o, evenNewer) {
  const latE = e.lat / 131072, latO = o.lat / 131072, lonE = e.lon / 131072, lonO = o.lon / 131072;
  const j = Math.floor(59 * latE - 60 * latO + 0.5);
  let rE = (360 / 60) * (mod(j, 60) + latE), rO = (360 / 59) * (mod(j, 59) + latO);
  if (rE >= 270) rE -= 360; if (rO >= 270) rO -= 360;
  if (cprNL(rE) !== cprNL(rO)) return null;
  const lat = evenNewer ? rE : rO;
  const nl = cprNL(lat);
  const ni = Math.max(evenNewer ? nl : nl - 1, 1);
  const m = Math.floor(lonE * (nl - 1) - lonO * nl + 0.5);
  let lon = (360 / ni) * (mod(m, ni) + (evenNewer ? lonE : lonO));
  if (lon >= 180) lon -= 360;
  return { lat, lon };
}
function cprLocal(raw, odd, refLat, refLon) {
  const dLat = 360 / (odd ? 59 : 60);
  const yz = raw.lat / 131072, xz = raw.lon / 131072;
  const j = Math.floor(refLat / dLat) + Math.floor(0.5 + mod(refLat, dLat) / dLat - yz);
  const lat = dLat * (j + yz);
  const nl = cprNL(lat) - (odd ? 1 : 0);
  const dLon = 360 / Math.max(nl, 1);
  const m = Math.floor(refLon / dLon) + Math.floor(0.5 + mod(refLon, dLon) / dLon - xz);
  return { lat, lon: dLon * (m + xz) };
}
function decodeAltitude(field) { // 12-bit altitude field, 25 ft steps (Q bit = 1)
  if (!(field & 0x10)) return null;
  const n = ((field & 0xfe0) >> 1) | (field & 0x0f);
  return n * 25 - 1000;
}
const acState = new Map();
function decodeModeS(bytes) {
  const df = bytes[0] >> 3;
  if (df !== 17 && df !== 18) return null;
  if (modesCrc(bytes, 112) !== ((bytes[11] << 16) | (bytes[12] << 8) | bytes[13])) return null;
  const icao = ((bytes[1] << 16) | (bytes[2] << 8) | bytes[3]).toString(16).toUpperCase().padStart(6, "0");
  const tc = bytes[4] >> 3;
  const out = { icao, df, tc };
  const st = acState.get(icao) || { even: null, odd: null, seq: 0 };
  acState.set(icao, st);
  if (acState.size > 3000) acState.delete(acState.keys().next().value);
  if (tc >= 1 && tc <= 4) {
    let cs = "";
    for (let i = 0; i < 8; i += 1) cs += ADSB_CHARS[bitsOf(bytes, 40 + i * 6, 6)];
    out.callsign = cs.replace(/#/g, "").trim();
    out.category = tc;
  } else if ((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) {
    const altField = bitsOf(bytes, 40, 12);
    if (tc <= 18) out.alt = decodeAltitude(altField);
    const odd = bitsOf(bytes, 53, 1) === 1;
    st.seq += 1;
    const raw = { lat: bitsOf(bytes, 54, 17), lon: bitsOf(bytes, 71, 17), t: Date.now(), seq: st.seq };
    if (odd) st.odd = raw; else st.even = raw;
    out.cprOdd = odd;
    if (st.even && st.odd && Math.abs(st.even.t - st.odd.t) < 10000) {
      const p = cprGlobal(st.even, st.odd, st.even.seq > st.odd.seq);
      if (p) { out.lat = p.lat; out.lon = p.lon; out.cpr = "global"; }
    }
    if (out.lat == null && S.ref) {
      const p = cprLocal(raw, odd, S.ref.lat, S.ref.lon);
      if (Math.abs(p.lat - S.ref.lat) < 4 && Math.abs(p.lon - S.ref.lon) < 6) { out.lat = p.lat; out.lon = p.lon; out.cpr = "local"; }
    }
  } else if (tc === 19) {
    const sub = bitsOf(bytes, 37, 3);
    if (sub === 1 || sub === 2) {
      const k = sub === 2 ? 4 : 1;
      const vew = bitsOf(bytes, 46, 10), vns = bitsOf(bytes, 57, 10);
      if (vew && vns) {
        const vx = (bitsOf(bytes, 45, 1) ? -1 : 1) * (vew - 1) * k;
        const vy = (bitsOf(bytes, 56, 1) ? -1 : 1) * (vns - 1) * k;
        out.speed = Math.hypot(vx, vy);
        out.heading = mod((Math.atan2(vx, vy) * 180) / Math.PI, 360);
      }
      const vr = bitsOf(bytes, 69, 9);
      if (vr) out.vrate = (bitsOf(bytes, 68, 1) ? -1 : 1) * (vr - 1) * 64;
    }
  }
  return out;
}

// Preamble + PPM bit detector on magnitude at 2 MS/s.
const adsb = { tail: new Float32Array(0), mag: new Float32Array(0) };
function adsbBlock(iq, n) {
  const T = adsb.tail.length;
  const len = T + n;
  if (adsb.mag.length < len) adsb.mag = new Float32Array(Math.ceil(len * 1.25));
  const m = adsb.mag;
  m.set(adsb.tail, 0);
  let sum = 0;
  for (let i = 0; i < n; i += 1) { const r = iq[2 * i], q = iq[2 * i + 1]; const v = r * r + q * q; m[T + i] = v; sum += v; }
  const floor = sum / n;
  const bytes = new Uint8Array(14);
  const end = len - 240;
  for (let i = 0; i < end; i += 1) {
    const m0 = m[i], m1 = m[i + 1], m2 = m[i + 2], m3 = m[i + 3], m7 = m[i + 7], m9 = m[i + 9];
    if (!(m0 > m1 && m1 < m2 && m2 > m3 && m3 < m0 && m[i + 4] < m0 && m[i + 5] < m0 && m[i + 6] < m0 && m7 > m[i + 8] && m[i + 8] < m9 && m9 > m[i + 6])) continue;
    const high = (m0 + m2 + m7 + m9) / 4;
    if (high < floor * 6) continue;
    if (m[i + 4] > high / 2 || m[i + 5] > high / 2 || m[i + 11] > high / 2 || m[i + 12] > high / 2 || m[i + 13] > high / 2) continue;
    bytes.fill(0);
    for (let b = 0; b < 112; b += 1) {
      const a = m[i + 16 + 2 * b], c = m[i + 17 + 2 * b];
      if (a > c) bytes[b >> 3] |= 0x80 >> (b & 7);
    }
    const msg = decodeModeS(bytes);
    if (msg) {
      H.packets.adsb += 1;
      msg.rssi = Math.round(10 * Math.log10(high + 1e-12));
      post({ t: "adsb", msg, hex: hexOf(bytes) });
      i += 239;
    } else if ((bytes[0] >> 3) === 17) H.crcFail += 1;
  }
  adsb.tail = m.slice(len - 240, len);
}
function hexOf(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); }

// ------------------------------------------------------------------ HDLC (AIS + AX.25)
class Hdlc {
  constructor(onFrame) { this.onFrame = onFrame; this.shift = 0; this.ones = 0; this.bits = []; this.active = false; }
  push(bit) {
    this.shift = ((this.shift << 1) | bit) & 0xff;
    if (this.shift === 0x7e) {
      if (this.active) {
        const nb = this.bits.length - 7;
        if (nb >= 64 && nb % 8 === 0) {
          const bytes = new Uint8Array(nb / 8);
          for (let i = 0; i < nb; i += 1) if (this.bits[i]) bytes[i >> 3] |= 1 << (i & 7);
          this.onFrame(bytes);
        }
      }
      this.active = true; this.bits.length = 0; this.ones = 0;
      return;
    }
    if (!this.active) return;
    if (bit) { this.ones += 1; if (this.ones > 6) { this.active = false; return; } }
    else { if (this.ones === 5) { this.ones = 0; return; } this.ones = 0; }
    this.bits.push(bit);
    if (this.bits.length > 4200) this.active = false;
  }
}
function nrziDecoder(next) { let prev = 0; return (b) => { next(b === prev ? 1 : 0); prev = b; }; }

// ------------------------------------------------------------------ AIS
function aisBitsFromFrame(bytes) { // HDLC bytes (LSB-first on air) -> message bits MSB-first
  const bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i += 1) for (let b = 0; b < 8; b += 1) bits[i * 8 + b] = (bytes[i] >> (7 - b)) & 1;
  return bits;
}
function u(bits, s, l) { let v = 0; for (let i = 0; i < l; i += 1) v = v * 2 + (bits[s + i] || 0); return v; }
function sgn(bits, s, l) { const v = u(bits, s, l); return v >= Math.pow(2, l - 1) ? v - Math.pow(2, l) : v; }
function txt(bits, s, l) { let o = ""; for (let i = 0; i + 6 <= l; i += 6) o += AIS_SIXBIT[u(bits, s + i, 6)]; return o.replace(/@+$/, "").replace(/@/g, " ").trim(); }
function aisLatLon(bits, lonAt, latAt) {
  const lon = sgn(bits, lonAt, 28) / 600000, lat = sgn(bits, latAt, 27) / 600000;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return {};
  return { lat, lon };
}
function decodeAisBits(bits) {
  const type = u(bits, 0, 6);
  const m = { type, mmsi: String(u(bits, 8, 30)).padStart(9, "0") };
  if (type >= 1 && type <= 3) {
    Object.assign(m, aisLatLon(bits, 61, 89));
    m.status = u(bits, 38, 4);
    const sog = u(bits, 50, 10); if (sog < 1023) m.sog = sog / 10;
    const cog = u(bits, 116, 12); if (cog < 3600) m.cog = cog / 10;
    const hdg = u(bits, 128, 9); if (hdg < 360) m.heading = hdg;
  } else if (type === 4) {
    Object.assign(m, aisLatLon(bits, 79, 107));
    m.base = true;
  } else if (type === 5) {
    m.callsign = txt(bits, 70, 42); m.name = txt(bits, 112, 120); m.shiptype = u(bits, 232, 8);
    m.dest = txt(bits, 302, 120);
  } else if (type === 18) {
    Object.assign(m, aisLatLon(bits, 57, 85));
    const sog = u(bits, 46, 10); if (sog < 1023) m.sog = sog / 10;
    const cog = u(bits, 112, 12); if (cog < 3600) m.cog = cog / 10;
    const hdg = u(bits, 124, 9); if (hdg < 360) m.heading = hdg;
    m.classB = true;
  } else if (type === 21) {
    m.aton = true; m.atonType = u(bits, 38, 5); m.name = txt(bits, 43, 120);
    Object.assign(m, aisLatLon(bits, 164, 192));
  } else if (type === 24) {
    const part = u(bits, 38, 2);
    if (part === 0) m.name = txt(bits, 40, 120);
    else { m.shiptype = u(bits, 40, 8); m.callsign = txt(bits, 90, 42); }
    m.classB = true;
  } else return null;
  return m;
}
function aisFrame(bytes, channel) {
  const n = bytes.length;
  if (n < 8) return;
  const fcs = bytes[n - 2] | (bytes[n - 1] << 8);
  if (crc16x25(bytes, n - 2) !== fcs) { H.crcFail += 1; return; }
  const m = decodeAisBits(aisBitsFromFrame(bytes.subarray(0, n - 2)));
  if (!m) return;
  m.channel = channel;
  H.packets.ais += 1;
  post({ t: "ais", msg: m });
}
function aisFromArmored(payload, fill) { // QA path: NMEA 6-bit armoring -> bits
  const bits = [];
  for (const ch of payload) { let v = ch.charCodeAt(0) - 48; if (v > 40) v -= 8; for (let b = 5; b >= 0; b -= 1) bits.push((v >> b) & 1); }
  if (fill) bits.length -= fill;
  return decodeAisBits(Uint8Array.from(bits));
}

// ------------------------------------------------------------------ AX.25 + APRS
function ax25Frame(bytes) {
  const n = bytes.length;
  if (n < 18) return;
  const fcs = bytes[n - 2] | (bytes[n - 1] << 8);
  if (crc16x25(bytes, n - 2) !== fcs) { H.crcFail += 1; return; }
  const addr = (o) => {
    let c = "";
    for (let i = 0; i < 6; i += 1) c += String.fromCharCode(bytes[o + i] >> 1);
    const ssid = (bytes[o + 6] >> 1) & 15;
    return c.trim() + (ssid ? "-" + ssid : "");
  };
  const dest = addr(0), src = addr(7);
  let o = 14; const path = [];
  if (!(bytes[13] & 1)) { while (o + 7 <= n - 2) { path.push(addr(o) + (bytes[o + 6] & 0x80 ? "*" : "")); const last = bytes[o + 6] & 1; o += 7; if (last) break; } }
  if (bytes[o] !== 0x03 || bytes[o + 1] !== 0xf0) return;
  let info = "";
  for (let i = o + 2; i < n - 2; i += 1) info += String.fromCharCode(bytes[i]);
  const pkt = parseAprs(src, dest, path, info);
  H.packets.aprs += 1;
  post({ t: "aprs", msg: pkt });
}
function parseAprs(src, dest, path, info) {
  const out = { call: src, dest, path: path.join(","), raw: info.slice(0, 200) };
  const t = info[0];
  let body = null;
  if (t === "!" || t === "=") body = info.slice(1);
  else if (t === "/" || t === "@") body = info.slice(8);
  if (body != null) {
    const un = /^(\d{2})([\d ]{2}\.[\d ]{2})([NS])(.)(\d{3})([\d ]{2}\.[\d ]{2})([EW])(.)/.exec(body);
    if (un) {
      out.lat = (Number(un[1]) + Number(un[2].replace(/ /g, "0")) / 60) * (un[3] === "S" ? -1 : 1);
      out.lon = (Number(un[5]) + Number(un[6].replace(/ /g, "0")) / 60) * (un[7] === "W" ? -1 : 1);
      out.symbol = un[4] + un[8];
      out.comment = body.slice(19);
      out.format = "uncompressed";
    } else if (body.length >= 13 && /[\/\\A-Za-j]/.test(body[0])) {
      const b91 = (s) => [...s].reduce((a, c) => a * 91 + (c.charCodeAt(0) - 33), 0);
      out.lat = 90 - b91(body.slice(1, 5)) / 380926;
      out.lon = -180 + b91(body.slice(5, 9)) / 190463;
      out.symbol = body[0] + body[9];
      out.comment = body.slice(13);
      out.format = "compressed";
    }
  } else if ((t === "`" || t === "'") && dest.length >= 6 && info.length >= 9) {
    const d = dest.slice(0, 6).toUpperCase();
    const dig = (c) => (c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : c >= "A" && c <= "J" ? c.charCodeAt(0) - 65 : c >= "P" && c <= "Y" ? c.charCodeAt(0) - 80 : 0);
    const isHi = (c) => c >= "P" && c <= "Z";
    const latDeg = dig(d[0]) * 10 + dig(d[1]);
    const latMin = dig(d[2]) * 10 + dig(d[3]) + (dig(d[4]) * 10 + dig(d[5])) / 100;
    out.lat = (latDeg + latMin / 60) * (isHi(d[3]) ? 1 : -1);
    let lonDeg = info.charCodeAt(1) - 28 + (isHi(d[4]) ? 100 : 0);
    if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80; else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;
    let lonMin = info.charCodeAt(2) - 28; if (lonMin >= 60) lonMin -= 60;
    const lonH = info.charCodeAt(3) - 28;
    out.lon = (lonDeg + (lonMin + lonH / 100) / 60) * (isHi(d[5]) ? -1 : 1);
    const sp = info.charCodeAt(4) - 28, dc = info.charCodeAt(5) - 28, se = info.charCodeAt(6) - 28;
    let speed = sp * 10 + Math.floor(dc / 10); if (speed >= 800) speed -= 800;
    let course = (dc % 10) * 100 + se; if (course >= 400) course -= 400;
    out.speedKn = speed; out.course = course;
    out.symbol = info[8] + info[7];
    out.comment = info.slice(9);
    out.format = "Mic-E";
  } else if (t === ">") { out.status = info.slice(1); out.format = "status"; }
  else out.format = "other";
  if (out.comment) out.comment = out.comment.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 120);
  return out;
}

// AFSK 1200 (Bell 202) tone detector on FM audio at 48 kHz.
class Afsk {
  constructor(fs, onBit) {
    this.fs = fs; this.N = Math.round(fs / 1200);
    this.buf = new Float32Array(this.N * 4); this.p = 0;
    this.sm = [0, 0, 0, 0]; this.k = 0;
    this.slicer = new Slicer(fs / 1200, onBit, 0.25);
  }
  run(x, n) {
    const N = this.N, fs = this.fs;
    for (let i = 0; i < n; i += 1) {
      const t = this.k++;
      const v = x[i] / 3000;
      const am = (TAU * 1200 * t) / fs, as = (TAU * 2200 * t) / fs;
      const a = v * Math.cos(am), b = v * Math.sin(am), c = v * Math.cos(as), d = v * Math.sin(as);
      const q = this.p * 4;
      this.sm[0] += a - this.buf[q]; this.sm[1] += b - this.buf[q + 1]; this.sm[2] += c - this.buf[q + 2]; this.sm[3] += d - this.buf[q + 3];
      this.buf[q] = a; this.buf[q + 1] = b; this.buf[q + 2] = c; this.buf[q + 3] = d;
      this.p = (this.p + 1) % N;
      const mark = this.sm[0] * this.sm[0] + this.sm[1] * this.sm[1];
      const space = this.sm[2] * this.sm[2] + this.sm[3] * this.sm[3];
      this.slicer.push(mark - space);
    }
    if (this.k > 48000 * 3600) { this.k = 0; this.sm = [0, 0, 0, 0]; this.buf.fill(0); }
  }
}

// ------------------------------------------------------------------ POCSAG
const P_SYNC = 0x7cd215d8, P_IDLE = 0x7a89c197;
function bchRem(v31) { let v = v31; for (let i = 30; i >= 10; i -= 1) if (v & (1 << i)) v ^= 0x769 << (i - 10); return v & 0x3ff; }
function parity32(x) { x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1; return x & 1; }
function pocsagOk(cw) { return bchRem(cw >>> 1) === 0 && parity32(cw) === 0; }
function pocsagFix(cw) {
  if (pocsagOk(cw)) return cw;
  for (let b = 0; b < 32; b += 1) { const t = (cw ^ (1 << b)) >>> 0; if (pocsagOk(t)) return t; }
  return null;
}
class Pocsag {
  constructor(baud) { this.baud = baud; this.reg = 0; this.hunt = true; this.inv = false; this.n = 0; this.idx = 0; this.msg = null; }
  bit(b) {
    this.reg = ((this.reg << 1) | b) >>> 0;
    if (this.hunt) {
      if (this.reg === P_SYNC) { this.hunt = false; this.inv = false; this.n = 0; this.idx = 0; }
      else if (this.reg === (~P_SYNC >>> 0)) { this.hunt = false; this.inv = true; this.n = 0; this.idx = 0; }
      return;
    }
    if (++this.n < 32) return;
    this.n = 0;
    let cw = this.inv ? ~this.reg >>> 0 : this.reg;
    if (this.idx === 16) {
      if (cw === P_SYNC || pocsagFix(cw) === P_SYNC) { this.idx = 0; return; }
      this.flush(); this.hunt = true; return;
    }
    const frame = this.idx >> 1;
    this.idx += 1;
    cw = pocsagFix(cw);
    if (cw == null) { H.crcFail += 1; return; }
    if (cw === P_IDLE) { this.flush(); return; }
    if (!(cw >>> 31)) {
      this.flush();
      this.msg = { capcode: (((cw >>> 13) & 0x3ffff) << 3) | frame, func: (cw >>> 11) & 3, bits: [] };
    } else if (this.msg) {
      const d = (cw >>> 11) & 0xfffff;
      for (let i = 19; i >= 0; i -= 1) this.msg.bits.push((d >> i) & 1);
    }
  }
  flush() {
    const m = this.msg; this.msg = null;
    if (!m) return;
    let text = "", kind = "tone";
    if (m.bits.length) {
      if (m.func === 0) {
        kind = "numeric";
        const tbl = "0123456789*U -)(";
        for (let i = 0; i + 4 <= m.bits.length; i += 4) text += tbl[m.bits[i] | (m.bits[i + 1] << 1) | (m.bits[i + 2] << 2) | (m.bits[i + 3] << 3)];
        text = text.trim();
      } else {
        kind = "alpha";
        for (let i = 0; i + 7 <= m.bits.length; i += 7) {
          let c = 0; for (let k = 0; k < 7; k += 1) c |= m.bits[i + k] << k;
          if (c === 0 || c === 3 || c === 4) break;
          text += c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 ? " " : "";
        }
      }
    }
    H.packets.pager += 1;
    post({ t: "pager", msg: { proto: "POCSAG", baud: this.baud, capcode: m.capcode, func: m.func, kind, text: text.slice(0, 240) } });
  }
}

// ------------------------------------------------------------------ RS41 radiosonde
// 320-byte standard frame, whitened with a 64-byte PN mask; blocks are [id][len][data][crc16].
const RS41_MASK = [0x96, 0x83, 0x3e, 0x51, 0xb1, 0x49, 0x08, 0x98, 0x32, 0x05, 0x59, 0x0e, 0xf9, 0x44, 0xc6, 0x26,
  0x21, 0x60, 0xc2, 0xea, 0x79, 0x5d, 0x6d, 0xa1, 0x54, 0x69, 0x47, 0x0c, 0xdc, 0xe8, 0x5c, 0xf1,
  0xf7, 0x76, 0x82, 0x7f, 0x07, 0x99, 0xa2, 0x2c, 0x93, 0x7c, 0x30, 0x63, 0xf5, 0x10, 0x2e, 0x61,
  0xd0, 0xbc, 0xb4, 0xb6, 0x06, 0xaa, 0xf4, 0x23, 0x78, 0x6e, 0x3b, 0xae, 0xbf, 0x7b, 0x4c, 0xc1];
const RS41_HEAD = [0x86, 0x35, 0xf4, 0x40, 0x93, 0xdf, 0x1a, 0x60]; // header as sent on air
const RS41_LEN = 320;
const RS41_HB = (() => { const a = []; for (const b of RS41_HEAD) for (let i = 0; i < 8; i += 1) a.push((b >> i) & 1); return a; })();
class Rs41 {
  constructor() { this.hist = new Uint8Array(64); this.hp = 0; this.collect = null; this.inv = false; }
  bit(b) {
    if (this.collect) {
      const c = this.collect;
      const v = this.inv ? b ^ 1 : b;
      if (v) c.bytes[c.n >> 3] |= 1 << (c.n & 7);
      c.n += 1;
      if (c.n === RS41_LEN * 8) { this.collect = null; this.frame(c.bytes); }
      return;
    }
    this.hist[this.hp] = b; this.hp = (this.hp + 1) % 64;
    let ok = 0;
    for (let i = 0; i < 64; i += 1) if (this.hist[(this.hp + i) % 64] === RS41_HB[i]) ok += 1;
    if (ok >= 62 || ok <= 2) {
      this.inv = ok <= 2;
      const bytes = new Uint8Array(RS41_LEN);
      bytes.set(RS41_HEAD, 0);
      this.collect = { bytes, n: 64 };
    }
  }
  frame(raw) {
    const f = new Uint8Array(RS41_LEN);
    for (let i = 0; i < RS41_LEN; i += 1) f[i] = raw[i] ^ RS41_MASK[i % 64];
    const out = { blocks: 0 };
    let p = 0x39, bad = 0;
    while (p + 4 < RS41_LEN) {
      const id = f[p], len = f[p + 1];
      if (p + 4 + len > RS41_LEN) break;
      const crc = f[p + 2 + len] | (f[p + 3 + len] << 8);
      if (crc16ccitt(f, p + 2, len) !== crc) { bad += 1; p += len + 4; continue; }
      out.blocks += 1;
      const dv = new DataView(f.buffer, p + 2, len);
      if (id === 0x79) {
        out.frame = dv.getUint16(0, true);
        out.serial = String.fromCharCode(...f.subarray(p + 4, p + 12)).replace(/[^\x20-\x7e]/g, "").trim();
        out.battery = f[p + 12] / 10;
        if (self.P2) P2.rs41Block(id, f, p, len, out);
      } else if (id === 0x7a && self.P2) { P2.rs41Block(id, f, p, len, out);
      } else if (id === 0x7b && len >= 0x15) {
        const x = dv.getInt32(0, true) / 100, y = dv.getInt32(4, true) / 100, z = dv.getInt32(8, true) / 100;
        const vx = dv.getInt16(12, true) / 100, vy = dv.getInt16(14, true) / 100, vz = dv.getInt16(16, true) / 100;
        const g = ecefToGeo(x, y, z);
        Object.assign(out, g);
        const enu = ecefVelToEnu(vx, vy, vz, g.lat, g.lon);
        out.vE = enu.e; out.vN = enu.n; out.vU = enu.u;
        out.sats = f[p + 2 + 18];
      }
      p += len + 4;
    }
    if (bad) H.crcFail += bad;
    if (self.P2) P2.rs41Finish(out);
    if (out.serial && Number.isFinite(out.lat)) {
      H.packets.sonde += 1;
      post({ t: "sonde", msg: Object.assign(out, { type: "RS41" }) });
    }
  }
}
function ecefToGeo(x, y, z) {
  const a = 6378137, e2 = 6.69437999014e-3, b = a * Math.sqrt(1 - e2), ep2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(x, y), th = Math.atan2(z * a, p * b);
  const lat = Math.atan2(z + ep2 * b * Math.pow(Math.sin(th), 3), p - e2 * a * Math.pow(Math.cos(th), 3));
  const lon = Math.atan2(y, x);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, alt: p / Math.cos(lat) - N };
}
function geoToEcef(lat, lon, h) {
  const a = 6378137, e2 = 6.69437999014e-3;
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
}
function ecefVelToEnu(vx, vy, vz, lat, lon) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  return { e: -so * vx + co * vy, n: -sl * co * vx - sl * so * vy + cl * vz, u: cl * co * vx + cl * so * vy + sl * vz };
}

// ------------------------------------------------------------------ OOK / TPMS (240 kS/s envelope)
class Ook {
  constructor(fs) { this.fs = fs; this.nf = 1e-4; this.high = false; this.run = 0; this.runs = []; this.peak = 0; }
  push(re, im, n) {
    const fs = this.fs;
    for (let i = 0; i < n; i += 1) {
      const e = re[i] * re[i] + im[i] * im[i];
      const thr = Math.max(this.nf * 14, 1e-6);
      const hi = e > thr;
      if (!hi && this.runs.length === 0) this.nf += (e - this.nf) * 0.001;
      if (hi) this.peak = Math.max(this.peak, e);
      if (hi === this.high) this.run += 1;
      else { if (this.runs.length || hi) this.runs.push((this.high ? 1 : -1) * this.run); this.high = hi; this.run = 1; }
      if (!hi && this.runs.length && this.run > fs * 0.002) { this.burst(); this.runs = []; this.peak = 0; }
      if (this.runs.length > 4000) { this.runs = []; this.peak = 0; }
    }
  }
  burst() {
    // Glitch filter: runs under 3 samples (about 12 us) are noise spikes, fold them into the neighbor.
    const runs = [];
    for (const r of this.runs) {
      if (!r) continue;
      if (Math.abs(r) < 3 && runs.length) { runs[runs.length - 1] += Math.sign(runs[runs.length - 1]) * Math.abs(r); continue; }
      if (runs.length && Math.sign(runs[runs.length - 1]) === Math.sign(r)) runs[runs.length - 1] += r;
      else runs.push(r);
    }
    while (runs.length && runs[0] < 0) runs.shift();
    const pulses = runs.filter((r) => r > 0).length;
    if (pulses < 8) return;
    const lens = runs.map(Math.abs).sort((a, b) => a - b);
    const h = lens[Math.floor(lens.length * 0.2)];
    if (!h) return;
    const halves = [];
    for (const r of runs) { const k = Math.max(1, Math.min(2, Math.round(Math.abs(r) / h))); for (let j = 0; j < k; j += 1) halves.push(r > 0 ? 1 : 0); }
    halves.push(0); // a frame ending on a 1 bit has its last low half hidden in the silence
    const rssi = Math.round(10 * Math.log10(this.peak + 1e-12));
    for (let start = 0; start < 2; start += 1) {
      const bits = [];
      for (let i = start; i + 1 < halves.length; i += 2) {
        const a = halves[i], b = halves[i + 1];
        if (a === b) { if (bits.length > 40) break; bits.length = 0; continue; }
        bits.push(a === 1 ? 1 : 0);
      }
      for (let s = 0; s + 16 + 64 <= bits.length; s += 1) {
        let sync = 0; for (let k = 0; k < 16; k += 1) sync = (sync << 1) | bits[s + k];
        if (sync !== 0x2dd4) continue;
        const bytes = new Uint8Array(8);
        for (let k = 0; k < 64; k += 1) if (bits[s + 16 + k]) bytes[k >> 3] |= 0x80 >> (k & 7);
        if (crc8(bytes, 7) !== bytes[7]) { H.crcFail += 1; continue; }
        const id = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        H.packets.device += 1;
        post({ t: "device", msg: { kind: "TPMS", id: id.toString(16).toUpperCase().padStart(8, "0"), kpa: bytes[4] * 2.5, tempC: bytes[5] - 40, flags: bytes[6], rssi, pulses, halfUs: Math.round((h / this.fs) * 1e6) } });
        return;
      }
    }
    H.packets.device += 1;
    post({ t: "device", msg: { kind: "OOK", id: "", pulses, rssi, halfUs: Math.round((h / this.fs) * 1e6) } });
  }
}

// ------------------------------------------------------------------ pipeline per band
let P = null;
function buildPipeline() {
  const fs = S.rate;
  const band = bandOf(S.tuned);
  S.band = band;
  P = { band, fs, chans: [], decoders: [] };
  if (band === "adsb") { post({ t: "log", text: "Band ADSB · Mode-S DF17/18 decoder at " + (fs / 1e6).toFixed(1) + " MS/s" }); return; }
  const raw = self.P2 ? P2.raw(band, fs) : null;
  if (raw) { P.raw = raw; post({ t: "log", text: "Band " + band.toUpperCase() + " · " + raw.label + " · tuned " + (S.tuned / 1e6).toFixed(4) + " MHz · " + (fs / 1e6).toFixed(3) + " MS/s" }); return; }
  const main = new Channel(fs, S.tuned - S.center);
  P.main = main;
  P.chans.push(main);
  P.audioDisc = new Disc(main.fs2);
  P.wfmDisc = new Disc(main.fs1);
  P.wfmFir = new FirDecim(lowpassTaps(63, 15000, main.fs1), 5, false);
  P.de = 0; P.amDc = 0; P.ssbK = 0;
  P.ssbFir = new FirDecim(lowpassTaps(95, 1450, main.fs2), 1, true);
  if (band === "ais") {
    for (const [label, f] of [["A", 161.975e6], ["B", 162.025e6]]) {
      const ch = new Channel(fs, f - S.center);
      const disc = new Disc(ch.fs2);
      const hd = new Hdlc((b) => aisFrame(b, label));
      const nrzi = nrziDecoder((b) => hd.push(b));
      const sl = new Slicer(ch.fs2 / 9600, (b) => nrzi(b), 0.3);
      sl.useDc = true;
      P.chans.push(ch);
      P.decoders.push(() => { const d = disc.run(ch.r2, ch.i2, ch.n2); for (let i = 0; i < ch.n2; i += 1) sl.push(d[i]); });
    }
  } else if (band === "aprs") {
    const hd = new Hdlc(ax25Frame);
    const nrzi = nrziDecoder((b) => hd.push(b));
    const af = new Afsk(main.fs2, (b) => nrzi(b));
    const disc = new Disc(main.fs2);
    P.decoders.push(() => af.run(disc.run(main.r2, main.i2, main.n2), main.n2));
  } else if (band === "pager") {
    const disc = new Disc(main.fs2);
    // POCSAG: binary 1 = lower frequency, so the slicer output is inverted.
    const rates = [512, 1200, 2400].map((baud) => { const pc = new Pocsag(baud); const sl = new Slicer(main.fs2 / baud, (b) => pc.bit(b ^ 1), 0.25); sl.useDc = true; return sl; });
    P.decoders.push(() => { const d = disc.run(main.r2, main.i2, main.n2); for (let i = 0; i < main.n2; i += 1) for (const sl of rates) sl.push(d[i]); });
  } else if (band === "sonde") {
    const disc = new Disc(main.fs2);
    const rs = new Rs41();
    const sl = new Slicer(main.fs2 / 4800, (b) => rs.bit(b), 0.3);
    sl.useDc = true;
    P.decoders.push(() => { const d = disc.run(main.r2, main.i2, main.n2); for (let i = 0; i < main.n2; i += 1) sl.push(d[i]); });
  } else if (band === "tpms") {
    const ook = self.P2 ? new P2.sensors.OokMulti(main.fs1) : new Ook(main.fs1);
    P.decoders.push(() => ook.push(main.r1, main.i1, main.n1));
  }
  if (self.P2) P2.decoders(band, P, main);
  post({ t: "log", text: "Band " + band.toUpperCase() + " · tuned " + (S.tuned / 1e6).toFixed(4) + " MHz · center " + (S.center / 1e6).toFixed(4) + " MHz · " + (fs / 1e6).toFixed(2) + " MS/s" });
}

// ------------------------------------------------------------------ audio demod (WFM / NFM / AM / USB / LSB)
let audioOut = new Float32Array(0);
function demodAudio() {
  const ch = P.main;
  if (!ch) return;
  const mode = S.mode;
  let n = 0;
  if (audioOut.length < ch.n1 + 16) audioOut = new Float32Array(ch.n1 + 16);
  const out = audioOut;
  if (mode === "WFM") {
    const d = P.wfmDisc.run(ch.r1, ch.i1, ch.n1);
    for (let i = 0; i < ch.n1; i += 1) d[i] /= 75000;
    n = P.wfmFir.run(d, null, ch.n1, out, null);
    const a = 1 - Math.exp(-1 / (ch.fs2 * 75e-6));
    for (let i = 0; i < n; i += 1) { P.de += (out[i] - P.de) * a; out[i] = P.de * 2; }
  } else if (mode === "NFM") {
    const d = P.audioDisc.run(ch.r2, ch.i2, ch.n2);
    n = ch.n2;
    for (let i = 0; i < n; i += 1) out[i] = d[i] / 5000;
  } else if (mode === "AM") {
    n = ch.n2;
    for (let i = 0; i < n; i += 1) { const m = Math.hypot(ch.r2[i], ch.i2[i]); P.amDc += (m - P.amDc) * 0.001; out[i] = ((m - P.amDc) / (P.amDc + 1e-6)) * 0.5; }
  } else {
    n = ch.n2;
    const w = (TAU * (mode === "USB" ? -1500 : 1500)) / ch.fs2;
    const re = new Float32Array(n), im = new Float32Array(n), fr = new Float32Array(n), fi = new Float32Array(n);
    for (let i = 0; i < n; i += 1) { const ph = w * (P.ssbK + i); const c = Math.cos(ph), s = Math.sin(ph); re[i] = ch.r2[i] * c - ch.i2[i] * s; im[i] = ch.r2[i] * s + ch.i2[i] * c; }
    P.ssbFir.run(re, im, n, fr, fi);
    for (let i = 0; i < n; i += 1) { const ph = -w * (P.ssbK + i); out[i] = (fr[i] * Math.cos(ph) - fi[i] * Math.sin(ph)) * 8; }
    P.ssbK = (P.ssbK + n) % 4800000;
  }
  const open = ch.power > S.squelch;
  const pcm = new Float32Array(n);
  if (open) for (let i = 0; i < n; i += 1) pcm[i] = Math.max(-1, Math.min(1, out[i] * S.volume));
  post({ t: "audio", pcm, rate: ch.fs2, open }, [pcm.buffer]);
}

// ------------------------------------------------------------------ raw capture (.c8 = signed 8-bit interleaved I/Q)
const CAP = { on: false, chunks: [], bytes: 0, max: 256 * 1024 * 1024, rate: 0, center: 0 };
function capturePush(buf, fmt) {
  if (!CAP.on) return;
  const copy = new Int8Array(buf.byteLength);
  if (fmt === "u8") { const src = new Uint8Array(buf); for (let i = 0; i < src.length; i += 1) copy[i] = ((src[i] ^ 0x80) << 24) >> 24; }
  else copy.set(new Int8Array(buf));
  CAP.chunks.push(copy);
  CAP.bytes += copy.length;
  if (CAP.bytes >= CAP.max) { CAP.on = false; post({ t: "log", text: "Capture stopped at the 256 MB limit" }); }
}

// ------------------------------------------------------------------ main IQ entry
let floatBuf = new Float32Array(0);
let sinceFft = 0, sinceHealth = 0;
function onIQ(buf, fmt) {
  if (!P) buildPipeline();
  capturePush(buf, fmt);
  const n2 = buf.byteLength;
  if (floatBuf.length < n2) floatBuf = new Float32Array(n2);
  const f = floatBuf;
  if (fmt === "u8") { const a = new Uint8Array(buf); for (let i = 0; i < n2; i += 1) f[i] = (a[i] - 127.5) / 127.5; }
  else { const a = new Int8Array(buf); for (let i = 0; i < n2; i += 1) f[i] = a[i] / 128; }
  const n = n2 >> 1;
  H.samples += n; H.transfers += 1;
  let acc = 0, cnt = 0;
  for (let i = 0; i < n2; i += 7) { acc += f[i] * f[i]; cnt += 1; }
  H.rmsAcc += acc; H.rmsN += cnt;
  sinceFft += n;
  if (sinceFft >= S.rate / 12 && n >= FFT_N) { sinceFft = 0; const db = fft(f, n - FFT_N); if (self.P2) P2.onFft(db, P.band); post({ t: "fft", db, center: S.center, rate: S.rate, tuned: S.tuned }, [db.buffer]); }
  if (P.band === "adsb") adsbBlock(f, n);
  else if (P.raw) { P.raw.run(f, n); post({ t: "level", db: 10 * Math.log10(acc / Math.max(1, cnt) + 1e-12), band: P.band }); }
  else {
    for (const ch of P.chans) ch.process(f, n);
    for (const run of P.decoders) run();
    if (S.audioOn) demodAudio();
    post({ t: "level", db: P.main.power, band: P.band });
  }
  sinceHealth += n;
  if (sinceHealth >= S.rate / 2) { sinceHealth = 0; health(); }
}
function health() {
  H.iqRMS = H.rmsN ? Math.sqrt(H.rmsAcc / H.rmsN) : 0;
  H.rmsAcc = 0; H.rmsN = 0;
  post({ t: "health", h: { iqRMS: H.iqRMS, rate: S.rate, samples: H.samples, transfers: H.transfers, dropped: H.dropped, packets: Object.assign({}, H.packets), crcFail: H.crcFail, band: S.band, tuned: S.tuned, center: S.center } });
  if (CAP.on || CAP.bytes) post({ t: "cap", on: CAP.on, bytes: CAP.bytes, secs: CAP.bytes / 2 / (CAP.rate || S.rate) });
}

// ------------------------------------------------------------------ messages
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.t === "iq") { onIQ(m.buf, m.fmt); return; }
  if (m.t === "drop") { H.dropped += m.n || 1; return; }
  if (m.t === "config") {
    const retune = (m.rate != null && m.rate !== S.rate) || (m.center != null && m.center !== S.center) || (m.tuned != null && m.tuned !== S.tuned);
    for (const k of ["rate", "center", "tuned", "device", "mode", "audioOn", "squelch", "volume", "ref"]) if (m[k] !== undefined) S[k] = m[k];
    if (retune || !P) { buildPipeline(); adsb.tail = new Float32Array(0); }
    return;
  }
  if (m.t === "cap") {
    if (m.cmd === "start") { CAP.on = true; CAP.chunks = []; CAP.bytes = 0; CAP.rate = S.rate; CAP.center = S.center; post({ t: "log", text: "Capture started at " + (S.center / 1e6).toFixed(4) + " MHz" }); }
    else if (m.cmd === "stop") { CAP.on = false; post({ t: "log", text: "Capture stopped · " + (CAP.bytes / 1048576).toFixed(1) + " MB" }); }
    else if (m.cmd === "save") { const bufs = CAP.chunks.map((c) => c.buffer); post({ t: "capdata", bufs, rate: CAP.rate, center: CAP.center, bytes: CAP.bytes }, bufs); CAP.chunks = []; CAP.bytes = 0; }
    health();
    return;
  }
  if (m.t === "decode") { Promise.resolve(decodeTest(m.frame)).then((out) => post({ t: "decoded", id: m.id, out }), (e) => post({ t: "decoded", id: m.id, out: { error: String(e && e.message) } })); return; }
  if (m.t === "sim") { if (m.on) simStart(m); else simStop(); }
};

// Single known frames (public test vectors) straight into the decoders. QA only.
function decodeTest(fr) {
  try {
    if (self.P2) { const r = P2.decodeTest(fr); if (r !== undefined) return r; }
    if (fr.type === "adsb") {
      const hex = String(fr.hex || "").replace(/[^0-9a-f]/gi, "");
      const bytes = new Uint8Array(14);
      for (let i = 0; i < 14; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      const msg = decodeModeS(bytes);
      if (msg) { H.packets.adsb += 1; post({ t: "adsb", msg, hex: hex.toUpperCase() }); }
      return msg;
    }
    if (fr.type === "ais") { const msg = aisFromArmored(fr.payload, fr.fill || 0); if (msg) { msg.channel = fr.channel || "A"; H.packets.ais += 1; post({ t: "ais", msg }); } return msg; }
    if (fr.type === "aprs") {
      const mm = /^([^>]+)>([^,:]+)(?:,([^:]*))?:(.*)$/.exec(fr.tnc2 || "");
      if (!mm) return null;
      const msg = parseAprs(mm[1], mm[2], mm[3] ? mm[3].split(",") : [], mm[4]);
      if (fr.post !== false) { H.packets.aprs += 1; post({ t: "aprs", msg }); }
      return msg;
    }
    if (fr.type === "pocsag") return { ok: pocsagOk(fr.cw >>> 0) };
  } catch (e) { return { error: String(e && e.message) }; }
  return null;
}

// ================================================================== synthetic IQ (QA only)
// Builds real-format frames, modulates them to IQ for the band the radio is tuned to, and
// feeds them through onIQ() exactly like USB transfers, so the whole chain is exercised.
// Runs only after an explicit {t:"sim"} message from the QA test hook.
let SIM = null;
function simStart(m) {
  simStop();
  const rx = m.rx || { lat: 29.55, lon: -95.09 };
  SIM = {
    rx, t: 0, k: 0, timer: 0, em: [], next: {}, rr: {}, bg: null,
    aircraft: [
      { icao: 0xa4f2c1, cs: "UAL1542", lat: rx.lat + 0.32, lon: rx.lon - 0.41, alt: 24000, hdg: 62, kt: 438, vr: 1408 },
      { icao: 0xabc123, cs: "SWA2210", lat: rx.lat - 0.18, lon: rx.lon + 0.36, alt: 11025, hdg: 305, kt: 312, vr: -960 },
      { icao: 0xa1b2c3, cs: "N452GS", lat: rx.lat + 0.06, lon: rx.lon + 0.12, alt: 3500, hdg: 180, kt: 128, vr: 0 },
      { icao: 0xad7f02, cs: "ENY3561", lat: rx.lat - 0.44, lon: rx.lon - 0.22, alt: 17500, hdg: 20, kt: 365, vr: 1920 },
    ],
    ships: [
      { mmsi: 367123450, name: "GULF VOYAGER", cs: "WDJ4521", type: 70, lat: 29.355, lon: -94.745, sog: 11.2, cog: 312, cls: "A", dest: "HOUSTON" },
      { mmsi: 538009876, name: "NORDIC STAR", cs: "V7AB3", type: 80, lat: 29.316, lon: -94.69, sog: 8.4, cog: 296, cls: "A", dest: "TEXAS CITY" },
      { mmsi: 338445566, name: "BAY RUNNER", cs: "", type: 37, lat: 29.505, lon: -94.95, sog: 5.6, cog: 140, cls: "B", dest: "" },
      { mmsi: 993669001, name: "BOLIVAR ROADS LT 18", cs: "", type: 0, lat: 29.34, lon: -94.77, sog: 0, cog: 0, cls: "AtoN", dest: "" },
    ],
    stations: [
      { call: "KF5GSA-9", lat: rx.lat + 0.08, lon: rx.lon - 0.1, sym: "/>", cmt: "Mobile 147.020 GS test" },
      { call: "W5GSA-10", lat: rx.lat - 0.05, lon: rx.lon + 0.15, sym: "/#", cmt: "Digi WIDE2-2 Clear Lake" },
      { call: "N5WX-13", lat: rx.lat + 0.21, lon: rx.lon + 0.05, sym: "/_", cmt: "Wx 72F 54% hum" },
    ],
    sonde: { serial: "S2930412", lat: rx.lat + 0.12, lon: rx.lon - 0.32, alt: 9850, vE: 14.0, vN: 4.5, vU: 5.2, frame: 1740 },
    pages: [
      { cap: 1234567, func: 0, text: "5551234" },
      { cap: 2034512, func: 3, text: "UNIT 12 RESPOND STATION 4 ALARM PANEL CHECK" },
      { cap: 873216, func: 3, text: "LAB RESULTS READY ROOM 214" },
    ],
    tpms: [
      { id: 0x1a2b3c4d, kpa: 230, temp: 24 },
      { id: 0x0f00ba12, kpa: 238, temp: 26 },
      { id: 0x7e4410c5, kpa: 220, temp: 23 },
    ],
  };
  if (self.P2) P2.simStart(SIM, rx);
  SIM.timer = setInterval(simTick, 60);
  post({ t: "log", text: "Synthetic IQ generator on (test mode)" });
}
function simStop() { if (SIM) { clearInterval(SIM.timer); SIM = null; } }

const NOISE = (() => { const n = 1 << 18; const a = new Float32Array(n); for (let i = 0; i < n; i += 1) a[i] = (Math.random() + Math.random() + Math.random() - 1.5) * 0.028; return a; })();

function simTick() {
  if (!SIM) return;
  const fs = S.rate;
  const n = Math.round(fs * 0.05); // 50 ms of radio time per tick
  const re = new Float32Array(n), im = new Float32Array(n);
  const mask = NOISE.length - 1;
  let p = (Math.random() * NOISE.length) | 0;
  for (let i = 0; i < n; i += 1) { re[i] = NOISE[p]; im[i] = NOISE[(p + 7919) & mask]; p = (p + 1) & mask; }
  const band = bandOf(S.tuned);
  simSchedule(band, n / fs);
  simBackground(band, re, im, n, fs);
  const k0 = SIM.k;
  SIM.em = SIM.em.filter((e) => {
    const a = Math.max(e.start, k0), b = Math.min(e.start + e.len, k0 + n);
    for (let k = a; k < b; k += 1) {
      const v = e.next(k - e.start);
      if (v === null) continue;
      re[k - k0] += v[0]; im[k - k0] += v[1];
    }
    return e.start + e.len > k0 + n && e.band === band;
  });
  SIM.k += n; SIM.t += n / fs;
  const out = new Int8Array(2 * n);
  for (let i = 0; i < n; i += 1) {
    out[2 * i] = Math.max(-127, Math.min(127, Math.round(re[i] * 127)));
    out[2 * i + 1] = Math.max(-127, Math.min(127, Math.round(im[i] * 127)));
  }
  onIQ(out.buffer, "s8");
}

// Continuous carriers so the waterfall looks like a real band.
function simBackground(band, re, im, n, fs) {
  if (!SIM.bg || SIM.bg.band !== band || SIM.bg.fs !== fs || SIM.bg.center !== S.center) SIM.bg = { band, fs, center: S.center, items: simCarriers(band) };
  for (const c of SIM.bg.items) {
    const off = c.f - S.center;
    if (Math.abs(off) > fs / 2) continue;
    for (let i = 0; i < n; i += 1) {
      const t = (SIM.k + i) / fs;
      let inst = off;
      if (c.wfm) inst += 60000 * (0.6 * Math.sin(TAU * c.tone * t) + 0.4 * Math.sin(TAU * c.tone2 * t + c.ph));
      if (c.nfm) inst += 2500 * Math.sin(TAU * 900 * t);
      c.phase += (TAU * inst) / fs;
      const a = c.amp * (c.fade ? 0.65 + 0.35 * Math.sin(TAU * 0.13 * t + c.ph) : 1);
      re[i] += a * Math.cos(c.phase); im[i] += a * Math.sin(c.phase);
    }
    c.phase %= TAU;
  }
}
function simCarriers(band) {
  const mk = (f, amp, o) => Object.assign({ f, amp, phase: Math.random() * TAU, ph: Math.random() * TAU, tone: 400 + Math.random() * 600, tone2: 1700 + Math.random() * 900 }, o || {});
  const p2 = self.P2 ? P2.simCarriers(band, mk) : null;
  if (p2) return p2;
  if (band === "fm") return [mk(99.5e6, 0.22, { wfm: 1 }), mk(100.1e6, 0.32, { wfm: 1, fade: 1 }), mk(100.7e6, 0.16, { wfm: 1 }), mk(99.1e6, 0.1, { wfm: 1, fade: 1 })];
  if (band === "other") return [mk(S.tuned + 25000, 0.06, { nfm: 1, fade: 1 }), mk(S.tuned - 410000, 0.04, { fade: 1 })];
  if (band === "adsb") return [];
  return [mk(S.tuned - 520000, 0.03, { fade: 1 }), mk(S.tuned + 410000, 0.025)];
}

function simSchedule(band, dt) {
  const T = SIM.t;
  const step = (o, kt, hdg) => { const d = kt * 0.514444 * dt; o.lat += (d * Math.cos((hdg * Math.PI) / 180)) / 111320; o.lon += (d * Math.sin((hdg * Math.PI) / 180)) / (111320 * Math.cos((o.lat * Math.PI) / 180)); };
  for (const a of SIM.aircraft) { step(a, a.kt, a.hdg); a.alt += (a.vr / 60) * dt; }
  for (const s of SIM.ships) if (s.sog) step(s, s.sog, s.cog);
  const sd = SIM.sonde; sd.lat += (sd.vN * dt) / 111320; sd.lon += (sd.vE * dt) / (111320 * Math.cos((sd.lat * Math.PI) / 180)); sd.alt += sd.vU * dt;
  const due = (key, every) => { if ((SIM.next[key] || 0) > T) return false; SIM.next[key] = T + every; return true; };
  const rr = (key, len) => { const v = (SIM.rr[key] || 0) % len; SIM.rr[key] = v + 1; return v; };
  const at = SIM.k + Math.round(S.rate * 0.004);
  const push = (e) => { e.band = band; SIM.em.push(e); };
  if (self.P2 && P2.simSchedule(band, { at, push, due, rr, dt, SIM })) return;
  if (band === "adsb" && due("adsb", 0.03)) {
    const idx = rr("adsb", SIM.aircraft.length * 4);
    push(ppmEmission(at, encodeModeS(SIM.aircraft[idx >> 2], idx & 3), 0.28 + Math.random() * 0.1));
  }
  if (band === "ais" && due("ais", 0.3)) {
    const idx = rr("ais", SIM.ships.length * 2);
    const chf = idx % 4 < 2 ? 161.975e6 : 162.025e6;
    push(fskEmission(at, nrziEncode(hdlcEncode(encodeAis(SIM.ships[idx >> 1], idx & 1), 24)), 9600, 2400, chf - S.center, 0.3, true));
  }
  if (band === "aprs" && due("aprs", 0.9)) {
    push(afskEmission(at, nrziEncode(hdlcEncode(encodeAx25(SIM.stations[rr("aprs", SIM.stations.length)]), 30, true)), S.tuned - S.center, 0.3));
  }
  if (band === "sonde" && due("sonde", 0.8)) {
    sd.frame += 1;
    push(fskEmission(at, rs41Bits(encodeRs41(sd)), 4800, 2400, S.tuned - S.center, 0.3, true, 48));
  }
  if (band === "pager" && due("pager", 2.0)) {
    push(fskEmission(at, encodePocsag(SIM.pages[rr("pager", SIM.pages.length)]).map((b) => b ^ 1), 1200, 4500, S.tuned - S.center, 0.3, false));
  }
  if (band === "tpms" && due("tpms", 0.25)) {
    push(ookEmission(at, encodeTpms(SIM.tpms[rr("tpms", SIM.tpms.length)]), 10000, S.tuned - S.center, 0.3));
  }
}

// ---- encoders (exact inverses of the decoders above)
function encodeModeS(a, kind) {
  const b = new Uint8Array(14);
  const put = (start, len, val) => { for (let i = 0; i < len; i += 1) { const bit = Math.floor(val / Math.pow(2, len - 1 - i)) % 2; if (bit) b[(start + i) >> 3] |= 0x80 >> ((start + i) & 7); } };
  put(0, 5, 17); put(5, 3, 5); put(8, 24, a.icao);
  if (kind === 0) {
    put(32, 5, 4); put(37, 3, 3);
    const cs = (a.cs + "        ").slice(0, 8);
    for (let i = 0; i < 8; i += 1) { const c = cs[i] === " " ? 32 : ADSB_CHARS.indexOf(cs[i]); put(40 + i * 6, 6, c < 0 ? 32 : c); }
  } else if (kind === 1 || kind === 2) {
    const odd = kind === 2 ? 1 : 0;
    put(32, 5, 11);
    const nAlt = Math.round((a.alt + 1000) / 25);
    put(40, 12, ((nAlt & 0x7f0) << 1) | 0x10 | (nAlt & 0x0f));
    put(53, 1, odd);
    const dLat = 360 / (60 - odd);
    const yz = Math.floor((131072 * mod(a.lat, dLat)) / dLat + 0.5);
    const rlat = dLat * (yz / 131072 + Math.floor(a.lat / dLat));
    const dLon = 360 / Math.max(cprNL(rlat) - odd, 1);
    const xz = Math.floor((131072 * mod(a.lon, dLon)) / dLon + 0.5);
    put(54, 17, yz & 0x1ffff); put(71, 17, xz & 0x1ffff);
  } else {
    put(32, 5, 19); put(37, 3, 1);
    const vx = a.kt * Math.sin((a.hdg * Math.PI) / 180), vy = a.kt * Math.cos((a.hdg * Math.PI) / 180);
    put(45, 1, vx < 0 ? 1 : 0); put(46, 10, Math.round(Math.abs(vx)) + 1);
    put(56, 1, vy < 0 ? 1 : 0); put(57, 10, Math.round(Math.abs(vy)) + 1);
    put(67, 1, 1); put(68, 1, a.vr < 0 ? 1 : 0); put(69, 9, Math.round(Math.abs(a.vr) / 64) + 1);
  }
  const crc = modesCrc(b, 112);
  b[11] = crc >> 16; b[12] = (crc >> 8) & 255; b[13] = crc & 255;
  return b;
}
function ppmEmission(start, bytes, amp) {
  const pulses = new Uint8Array(16 + 224);
  for (const i of [0, 2, 7, 9]) pulses[i] = 1;
  for (let k = 0; k < 112; k += 1) { const bit = (bytes[k >> 3] >> (7 - (k & 7))) & 1; pulses[16 + 2 * k + (bit ? 0 : 1)] = 1; }
  const ph = Math.random() * TAU, c = amp * Math.cos(ph), s = amp * Math.sin(ph);
  return { start, len: pulses.length, next: (k) => (pulses[k] ? [c, s] : null) };
}
function bitsPut(arr, len, val) { for (let i = len - 1; i >= 0; i -= 1) arr.push(Math.floor(val / Math.pow(2, i)) % 2); }
function sixbitPut(arr, str, chars) { const s = (str + "@".repeat(chars)).slice(0, chars); for (const ch of s) { let v = AIS_SIXBIT.indexOf(ch); if (v < 0) v = 0; bitsPut(arr, 6, v); } }
function encodeAis(s, second) {
  const b = [];
  const tw = (v, l) => (v < 0 ? v + Math.pow(2, l) : v);
  const lon = tw(Math.round(s.lon * 600000), 28), lat = tw(Math.round(s.lat * 600000), 27);
  if (s.cls === "AtoN") {
    bitsPut(b, 6, 21); bitsPut(b, 2, 0); bitsPut(b, 30, s.mmsi); bitsPut(b, 5, 13); sixbitPut(b, s.name, 20);
    bitsPut(b, 1, 0); bitsPut(b, 28, lon); bitsPut(b, 27, lat); while (b.length < 272) b.push(0);
  } else if (s.cls === "B" && !second) {
    bitsPut(b, 6, 18); bitsPut(b, 2, 0); bitsPut(b, 30, s.mmsi); bitsPut(b, 8, 0); bitsPut(b, 10, Math.round(s.sog * 10)); bitsPut(b, 1, 0);
    bitsPut(b, 28, lon); bitsPut(b, 27, lat); bitsPut(b, 12, Math.round(s.cog * 10)); bitsPut(b, 9, Math.round(s.cog)); while (b.length < 168) b.push(0);
  } else if (s.cls === "B") {
    bitsPut(b, 6, 24); bitsPut(b, 2, 0); bitsPut(b, 30, s.mmsi); bitsPut(b, 2, 0); sixbitPut(b, s.name, 20); while (b.length < 168) b.push(0);
  } else if (!second) {
    bitsPut(b, 6, 1); bitsPut(b, 2, 0); bitsPut(b, 30, s.mmsi); bitsPut(b, 4, 0); bitsPut(b, 8, 0); bitsPut(b, 10, Math.round(s.sog * 10)); bitsPut(b, 1, 1);
    bitsPut(b, 28, lon); bitsPut(b, 27, lat); bitsPut(b, 12, Math.round(s.cog * 10)); bitsPut(b, 9, Math.round(s.cog)); while (b.length < 168) b.push(0);
  } else {
    bitsPut(b, 6, 5); bitsPut(b, 2, 0); bitsPut(b, 30, s.mmsi); bitsPut(b, 2, 0); bitsPut(b, 30, 9000000 + (s.mmsi % 1000000)); sixbitPut(b, s.cs, 7); sixbitPut(b, s.name, 20);
    bitsPut(b, 8, s.type); while (b.length < 302) b.push(0); sixbitPut(b, s.dest, 20); while (b.length < 424) b.push(0);
  }
  return b;
}
// message bits (MSB-first) or raw bytes -> FCS -> bit-stuffed HDLC stream with flags (LSB-first per byte)
function hdlcEncode(msg, preamble, isBytes) {
  let bytes = msg;
  if (!isBytes) { bytes = new Uint8Array(Math.ceil(msg.length / 8)); for (let i = 0; i < msg.length; i += 1) if (msg[i]) bytes[i >> 3] |= 0x80 >> (i & 7); }
  const fcs = crc16x25(bytes, bytes.length);
  const all = Uint8Array.from([...bytes, fcs & 255, fcs >> 8]);
  const out = [];
  if (isBytes) for (let i = 0; i < preamble; i += 1) out.push(0, 1, 1, 1, 1, 1, 1, 0);
  else for (let i = 0; i < preamble; i += 1) out.push(i & 1);
  out.push(0, 1, 1, 1, 1, 1, 1, 0);
  let ones = 0;
  for (const by of all) for (let k = 0; k < 8; k += 1) { const bit = (by >> k) & 1; out.push(bit); if (bit) { ones += 1; if (ones === 5) { out.push(0); ones = 0; } } else ones = 0; }
  out.push(0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0);
  return out;
}
function nrziEncode(bits) { let lvl = 1; return bits.map((b) => { if (!b) lvl ^= 1; return lvl; }); }
function fskEmission(start, bits, baud, dev, offset, amp, smooth, preBits) {
  const fs = S.rate, sps = fs / baud;
  const all = [];
  for (let i = 0; i < (preBits || 0); i += 1) all.push(i & 1);
  for (const b of bits) all.push(b);
  let phase = Math.random() * TAU, f = 0;
  const a = smooth ? 1 - Math.exp((-TAU * baud * 0.55) / fs) : 1;
  return { start, len: Math.ceil(all.length * sps), next: (k) => {
    const sym = all[Math.min(all.length - 1, Math.floor(k / sps))] ? 1 : -1;
    f += (sym * dev - f) * a;
    phase += (TAU * (offset + f)) / fs;
    return [amp * Math.cos(phase), amp * Math.sin(phase)];
  } };
}
function afskEmission(start, bits, offset, amp) {
  const fs = S.rate, sps = fs / 1200;
  let tone = 0, phase = Math.random() * TAU;
  return { start, len: Math.ceil(bits.length * sps), next: (k) => {
    const b = bits[Math.min(bits.length - 1, Math.floor(k / sps))];
    tone += (TAU * (b ? 1200 : 2200)) / fs;
    phase += (TAU * (offset + 3000 * Math.sin(tone))) / fs;
    return [amp * Math.cos(phase), amp * Math.sin(phase)];
  } };
}
function ookEmission(start, halves, bitRate, offset, amp) {
  const fs = S.rate, sph = fs / (bitRate * 2);
  let phase = 0;
  return { start, len: Math.ceil(halves.length * sph), next: (k) => {
    phase += (TAU * offset) / fs;
    return halves[Math.min(halves.length - 1, Math.floor(k / sph))] ? [amp * Math.cos(phase), amp * Math.sin(phase)] : null;
  } };
}
function encodeAx25(st) {
  const addr = (call, last, hi) => {
    const [c, ss] = call.split("-");
    const out = [];
    for (const ch of (c + "      ").slice(0, 6)) out.push(ch.charCodeAt(0) << 1);
    out.push(0x60 | ((Number(ss || 0) & 15) << 1) | (last ? 1 : 0) | (hi ? 0x80 : 0));
    return out;
  };
  const latD = Math.floor(Math.abs(st.lat)), latM = (Math.abs(st.lat) - latD) * 60;
  const lonD = Math.floor(Math.abs(st.lon)), lonM = (Math.abs(st.lon) - lonD) * 60;
  const pos = String(latD).padStart(2, "0") + latM.toFixed(2).padStart(5, "0") + (st.lat < 0 ? "S" : "N") + st.sym[0] +
    String(lonD).padStart(3, "0") + lonM.toFixed(2).padStart(5, "0") + (st.lon < 0 ? "W" : "E") + st.sym[1];
  const info = "!" + pos + st.cmt;
  return Uint8Array.from([...addr("APGSA1", false, true), ...addr(st.call, false), ...addr("WIDE1-1", true), 0x03, 0xf0, ...[...info].map((c) => c.charCodeAt(0))]);
}
function encodeRs41(sd) {
  const f = new Uint8Array(RS41_LEN);
  f.set([0x10, 0xb6, 0xca, 0x11, 0x22, 0x96, 0x12, 0xf8], 0);
  f[0x38] = 0x0f;
  const block = (pos, id, len, fill) => { f[pos] = id; f[pos + 1] = len; fill(new DataView(f.buffer, pos + 2, len)); const c = crc16ccitt(f, pos + 2, len); f[pos + 2 + len] = c & 255; f[pos + 3 + len] = c >> 8; };
  block(0x39, 0x79, 0x28, (dv) => { dv.setUint16(0, sd.frame & 0xffff, true); for (let i = 0; i < 8; i += 1) dv.setUint8(2 + i, sd.serial.charCodeAt(i)); dv.setUint8(10, 28); });
  if (self.P2) P2.rs41Sim(sd, f, block); else block(0x65, 0x7a, 0x2a, () => {});
  block(0x93, 0x7c, 0x1e, () => {});
  block(0xb5, 0x7b, 0x1e, (dv) => {
    const [x, y, z] = geoToEcef(sd.lat, sd.lon, sd.alt);
    dv.setInt32(0, Math.round(x * 100), true); dv.setInt32(4, Math.round(y * 100), true); dv.setInt32(8, Math.round(z * 100), true);
    const la = (sd.lat * Math.PI) / 180, lo = (sd.lon * Math.PI) / 180;
    const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
    const vx = -so * sd.vE - sl * co * sd.vN + cl * co * sd.vU, vy = co * sd.vE - sl * so * sd.vN + cl * so * sd.vU, vz = cl * sd.vN + sl * sd.vU;
    dv.setInt16(12, Math.round(vx * 100), true); dv.setInt16(14, Math.round(vy * 100), true); dv.setInt16(16, Math.round(vz * 100), true);
    dv.setUint8(18, 9);
  });
  block(0xd7, 0x76, 0x65, () => {});
  for (let i = 0; i < RS41_LEN; i += 1) f[i] ^= RS41_MASK[i % 64];
  return f;
}
function rs41Bits(bytes) { const out = []; for (const by of bytes) for (let k = 0; k < 8; k += 1) out.push((by >> k) & 1); return out; }
function pocsagCw(data21) { const v = (data21 * 1024) >>> 0; const v31 = (v | bchRem(v)) >>> 0; return ((v31 * 2) + parity32(v31)) >>> 0; }
function encodePocsag(pg) {
  const words = [pocsagCw(((pg.cap >>> 3) << 2) | pg.func)];
  const bits = [];
  if (pg.func === 0) { const tbl = "0123456789*U -)("; for (const ch of pg.text) { const d = Math.max(0, tbl.indexOf(ch)); for (let k = 0; k < 4; k += 1) bits.push((d >> k) & 1); } while (bits.length % 20) bits.push(0, 0, 1, 1); }
  else { for (const ch of pg.text + "\x04") { const c = ch.charCodeAt(0); for (let k = 0; k < 7; k += 1) bits.push((c >> k) & 1); } while (bits.length % 20) bits.push(0); }
  for (let i = 0; i < bits.length; i += 20) { let d = 1 << 20; for (let k = 0; k < 20; k += 1) d |= bits[i + k] << (19 - k); words.push(pocsagCw(d)); }
  const cws = [];
  for (let i = 0; i < (pg.cap & 7) * 2; i += 1) cws.push(P_IDLE);
  cws.push(...words);
  while (cws.length % 16) cws.push(P_IDLE);
  for (let i = 0; i < 16; i += 1) cws.push(P_IDLE);
  const out = [];
  for (let i = 0; i < 576; i += 1) out.push((i & 1) ^ 1);
  for (let b = 0; b < cws.length; b += 16) { bitsPut(out, 32, P_SYNC); for (let k = 0; k < 16; k += 1) bitsPut(out, 32, cws[b + k]); }
  return out;
}
function encodeTpms(tp) {
  const bytes = new Uint8Array(8);
  bytes[0] = tp.id >>> 24; bytes[1] = (tp.id >>> 16) & 255; bytes[2] = (tp.id >>> 8) & 255; bytes[3] = tp.id & 255;
  bytes[4] = Math.round(tp.kpa / 2.5); bytes[5] = tp.temp + 40; bytes[6] = 0x01; bytes[7] = crc8(bytes, 7);
  const bits = [];
  for (let i = 0; i < 24; i += 1) bits.push(i & 1 ? 0 : 1);
  bitsPut(bits, 16, 0x2dd4);
  for (const by of bytes) bitsPut(bits, 8, by);
  const halves = [];
  for (const b of bits) halves.push(b ? 1 : 0, b ? 0 : 1);
  return halves;
}

// Phase 2 decoders (LoRa / Meshtastic, UAT, ACARS, FLEX, DFM, BLE, EOT, Z-Wave, LTE, HD, ...). Receive only.
importScripts("/sdr-dsp2.js?v=20261127sdr3");
