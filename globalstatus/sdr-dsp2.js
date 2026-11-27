/* Global Status · SDR DSP worker, Phase 2 decoders (receive only)
 *
 * Loaded by sdr-dsp.worker.js with importScripts(), so it only ever runs inside the DSP
 * worker after the user clicks Connect SDR. Original clean-room code for Global Status App,
 * written from public protocol descriptions:
 *   LoRa PHY (chirp spread spectrum, diagonal interleaver, Hamming 4/5..4/8, whitening) +
 *   Meshtastic packet header / AES-CTR / protobuf, MeshCore adverts, LoRaWAN MHDR;
 *   UAT DO-282B (ADS-B frames, RS over GF(256), FIS-B uplink + DLAC text);
 *   ACARS (ARINC 618 character framing, BCS) and VDL2 AVLC / XID;
 *   ERT SCM meter frames; FLEX paging (BCH 31,21 words, block interleave);
 *   DFM radiosondes; RS41 PTU; BLE advertising (access address, whitening, CRC-24);
 *   EOT / HOT train telemetry (BCH 63,45); Z-Wave R1 frames; LTE PSS (Zadoff-Chu);
 *   ATSC pilot; HD Radio IBOC sideband detection + SIS; FT8 77-bit message unpacking;
 *   P25 / DMR LRRP, TETRA LIP and NMEA RMC location reports; CBS GSM 7-bit pages.
 * Nothing here can transmit: the worker only ever reads samples it is given.
 */
"use strict";
(function () {
  const P2 = {};
  self.P2 = P2;
  for (const k of ["mesh", "uat", "fisb", "acars", "vdl2", "dispatch", "meter", "hd", "lte", "ft8", "ble", "eot", "zwave", "flex", "dfm", "remote", "weather", "lorawan"]) H.packets[k] = 0;

  // ================================================================== shared helpers
  const fftCache = {};
  function cfft(re, im) {
    const n = re.length;
    let c = fftCache[n];
    if (!c) {
      const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n);
      for (let i = 0; i < n; i += 1) { let r = 0; for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
      const cs = new Float32Array(n / 2), sn = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i += 1) { cs[i] = Math.cos((-TAU * i) / n); sn[i] = Math.sin((-TAU * i) / n); }
      c = fftCache[n] = { rev, cs, sn };
    }
    const { rev, cs, sn } = c;
    for (let i = 0; i < n; i += 1) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let k = 0; k < half; k += 1) {
        const wr = cs[k * step], wi = sn[k * step], a = i + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const pop32 = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const hex = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n || 0, "0");
  const bytesOfBits = (bits, start, nbytes, lsbFirst) => { const out = new Uint8Array(nbytes); for (let i = 0; i < nbytes * 8; i += 1) if (bits[start + i]) out[i >> 3] |= lsbFirst ? 1 << (i & 7) : 0x80 >> (i & 7); return out; };
  function crc16(bytes, start, len, poly, init, reflected) {
    let c = init;
    for (let i = start; i < start + len; i += 1) {
      if (reflected) { c ^= bytes[i]; for (let b = 0; b < 8; b += 1) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1; }
      else { c ^= bytes[i] << 8; for (let b = 0; b < 8; b += 1) c = c & 0x8000 ? ((c << 1) ^ poly) & 0xffff : (c << 1) & 0xffff; }
    }
    return c & 0xffff;
  }
  function crc8p(bytes, len, poly, init) { let c = init || 0; for (let i = 0; i < len; i += 1) { c ^= bytes[i]; for (let b = 0; b < 8; b += 1) c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff; } return c; }
  const bitsVal = (bits, s, l) => { let v = 0; for (let i = 0; i < l; i += 1) v = v * 2 + (bits[s + i] || 0); return v; };
  const utf8 = (u8) => { try { return new TextDecoder().decode(u8); } catch (e) { return ""; } };
  const le32 = (v) => { const u = v < 0 ? v + 0x100000000 : v; return [u & 255, (u >>> 8) & 255, (u >>> 16) & 255, (u >>> 24) & 255]; };
  const be32 = (v) => { const u = v < 0 ? v + 0x100000000 : v; return [(u >>> 24) & 255, (u >>> 16) & 255, (u >>> 8) & 255, u & 255]; };
  // Capture what one decoder posts (QA single-frame checks).
  function capture(type, fn) { let got = null; const orig = self.postMessage; self.postMessage = (m) => { if (m && m.t === type) got = m.msg; else orig.call(self, m); }; try { fn(); } finally { self.postMessage = orig; } return got; }

  // Complex mixer + FIR decimator for the full-rate bands (LoRa, BLE).
  class Dec {
    constructor(fs, offset, outFs, cutoff, taps) {
      this.d = Math.max(1, Math.round(fs / outFs)); this.fs2 = fs / this.d;
      const w = (-TAU * offset) / fs; this.cw = Math.cos(w); this.sw = Math.sin(w); this.c = 1; this.s = 0;
      this.fir = this.d > 1 ? new FirDecim(lowpassTaps(taps || 33, cutoff, fs), this.d, true) : null;
      this.cap = 0;
    }
    run(f, n) {
      if (this.cap < n) { this.cap = n; this.re = new Float32Array(n); this.im = new Float32Array(n); this.or = new Float32Array(Math.ceil(n / this.d) + 4); this.oi = new Float32Array(Math.ceil(n / this.d) + 4); }
      let c = this.c, s = this.s; const cw = this.cw, sw = this.sw, re = this.re, im = this.im;
      for (let k = 0; k < n; k += 1) { const xr = f[2 * k], xi = f[2 * k + 1]; re[k] = xr * c - xi * s; im[k] = xr * s + xi * c; const nc = c * cw - s * sw; s = c * sw + s * cw; c = nc; }
      const m = Math.hypot(c, s); this.c = c / m; this.s = s / m;
      if (!this.fir) { this.or = re; this.oi = im; return n; }
      return this.fir.run(re, im, n, this.or, this.oi);
    }
  }

  // Hamming (8,4) family used by LoRa and DFM: [d3 d2 d1 d0 p0 p1 p2 p3], cut to 4+cr bits.
  function hamEnc(nib, cwLen) {
    const d3 = (nib >> 3) & 1, d2 = (nib >> 2) & 1, d1 = (nib >> 1) & 1, d0 = nib & 1;
    if (cwLen === 5) return [d3, d2, d1, d0, d3 ^ d2 ^ d1 ^ d0];
    return [d3, d2, d1, d0, d3 ^ d2 ^ d1, d2 ^ d1 ^ d0, d3 ^ d2 ^ d0, d3 ^ d1 ^ d0].slice(0, cwLen);
  }
  const HAM_TBL = {};
  function hamDec(bits) { // nearest codeword (corrects single errors at 4/7 and 4/8)
    const L = bits.length;
    const tbl = HAM_TBL[L] || (HAM_TBL[L] = Array.from({ length: 16 }, (_, v) => hamEnc(v, L)));
    let best = 0, bd = 99;
    for (let v = 0; v < 16; v += 1) { let d = 0; for (let i = 0; i < L; i += 1) if (tbl[v][i] !== bits[i]) d += 1; if (d < bd) { bd = d; best = v; } }
    return best;
  }
  P2.util = { cfft, pop32, hex, bytesOfBits, crc16, crc8p, bitsVal, utf8, le32, be32, capture, Dec, hamEnc, hamDec };
})();

// ==================================================================== LoRa PHY + Meshtastic / MeshCore / LoRaWAN
(function () {
  const P2 = self.P2, { cfft, hex, crc16, utf8, Dec, hamEnc, hamDec } = P2.util;
  const WHITEN = (() => { const w = new Uint8Array(256); let r = 0xff; for (let i = 0; i < 256; i += 1) { w[i] = r; const fb = ((r >> 7) ^ (r >> 5) ^ (r >> 4) ^ (r >> 3)) & 1; r = ((r << 1) | fb) & 0xff; } return w; })();
  function hdrChecksum(n0, n1, n2) {
    const h = [(n0 >> 3) & 1, (n0 >> 2) & 1, (n0 >> 1) & 1, n0 & 1, (n1 >> 3) & 1, (n1 >> 2) & 1, (n1 >> 1) & 1, n1 & 1, (n2 >> 3) & 1, (n2 >> 2) & 1, (n2 >> 1) & 1, n2 & 1];
    const c4 = h[0] ^ h[1] ^ h[2] ^ h[3], c3 = h[0] ^ h[4] ^ h[5] ^ h[6] ^ h[11], c2 = h[1] ^ h[4] ^ h[7] ^ h[8] ^ h[10];
    const c1 = h[2] ^ h[5] ^ h[7] ^ h[9] ^ h[10] ^ h[11], c0 = h[3] ^ h[6] ^ h[8] ^ h[9] ^ h[10] ^ h[11];
    return (c4 << 4) | (c3 << 3) | (c2 << 2) | (c1 << 1) | c0;
  }
  function payloadCrc(p) { // CRC-16/CCITT over all but the last two bytes, folded with them
    const n = p.length;
    let c = crc16(p, 0, Math.max(0, n - 2), 0x1021, 0x0000, false);
    if (n >= 2) c ^= p[n - 1] ^ (p[n - 2] << 8); else if (n === 1) c ^= p[0];
    return c & 0xffff;
  }
  const grayInv = (d) => { let s = d; for (let sh = 1; sh < 32; sh <<= 1) s ^= s >> sh; return s; };
  const rowOf = (i, j, b) => (((i - j - 1) % b) + b) % b;
  // Encoder (QA test signal only): payload -> chirp values after the SFD.
  function symbols(payload, sf, cr) {
    const len = payload.length, N = 1 << sf, sfa = sf - 2;
    const nibs = [len >> 4, len & 15, (cr << 1) | 1];
    const ck = hdrChecksum(nibs[0], nibs[1], nibs[2]);
    nibs.push((ck >> 4) & 1, ck & 15);
    for (let i = 0; i < len; i += 1) { const b = payload[i] ^ WHITEN[i]; nibs.push(b & 15, b >> 4); }
    const crc = payloadCrc(payload);
    nibs.push(crc & 15, (crc >> 4) & 15, (crc >> 8) & 15, (crc >> 12) & 15);
    const out = [];
    let pos = 0;
    const block = (cwLen, bps, reduced) => {
      const cws = [];
      for (let r = 0; r < bps; r += 1) cws.push(hamEnc(pos < nibs.length ? nibs[pos++] : 0, cwLen));
      for (let i = 0; i < cwLen; i += 1) {
        let d = 0;
        for (let j = 0; j < bps; j += 1) d = (d << 1) | cws[rowOf(i, j, bps)][i];
        const s = grayInv(d);
        out.push(reduced ? (s * 4 + 1) % N : (s + 1) % N);
      }
    };
    block(8, sfa, true);
    while (pos < nibs.length) block(4 + cr, sf, false);
    return out;
  }
  function deinterleave(syms, bps, cwLen) {
    const cws = Array.from({ length: bps }, () => new Array(cwLen).fill(0));
    for (let i = 0; i < cwLen; i += 1) for (let j = 0; j < bps; j += 1) cws[rowOf(i, j, bps)][i] = (syms[i] >> (bps - 1 - j)) & 1;
    return cws.map(hamDec);
  }

  class LoRa {
    constructor(fs, offset, cfg) {
      this.cfg = cfg; this.sf = cfg.sf; this.N = 1 << cfg.sf;
      // Keep 4x oversampling (when the input rate allows) so the chip timing can be picked to a quarter chip.
      this.os = Math.max(1, Math.min(4, Math.floor(fs / cfg.bw + 1e-6))); this.phase = 0;
      this.dec = new Dec(fs, offset, cfg.bw * this.os, cfg.bw * (this.os > 1 ? 0.56 : 0.47), 49);
      const N = this.N;
      this.ur = new Float32Array(N); this.ui = new Float32Array(N);
      for (let n = 0; n < N; n += 1) { const ph = Math.PI * ((n * n) / N - n); this.ur[n] = Math.cos(ph); this.ui[n] = Math.sin(ph); }
      this.wr = new Float32Array(N); this.wi = new Float32Array(N);
      this.cap = N * 400 * this.os; this.br = new Float32Array(this.cap); this.bi = new Float32Array(this.cap); this.lenS = 0;
      this.base = 0; this.len = 0; this.win = 0; this.hdr = null; this.reset();
    }
    reset() { this.state = 0; this.cnt = 0; this.lastK = -9; this.miss = 0; this.phase = 0; }
    push(re, im, n) {
      if (this.lenS + n > this.cap) this.trim(true);
      if (this.lenS + n > this.cap) { this.reset(); this.hdr = null; this.base += Math.floor(this.lenS / this.os); this.lenS = 0; this.len = 0; this.win = this.base; }
      this.br.set(re.subarray(0, n), this.lenS); this.bi.set(im.subarray(0, n), this.lenS); this.lenS += n;
      this.len = Math.max(0, Math.floor(this.lenS / this.os) - 1);
    }
    trim(force) {
      const N = this.N;
      let keep = this.state === 0 ? this.win - 3 * N : this.lockAt - 3 * N;
      keep = Math.max(this.base, Math.min(keep, this.base + this.len));
      const drop = keep - this.base;
      if (drop <= 0 || (!force && drop < N * 64)) return;
      const ds = drop * this.os;
      this.br.copyWithin(0, ds, this.lenS); this.bi.copyWithin(0, ds, this.lenS);
      this.lenS -= ds; this.len = Math.max(0, Math.floor(this.lenS / this.os) - 1); this.base = keep;
    }
    dechirp(abs, down) {
      const N = this.N, os = this.os, o = (abs - this.base) * os + this.phase, wr = this.wr, wi = this.wi, br = this.br, bi = this.bi, ur = this.ur, ui = this.ui;
      for (let n = 0; n < N; n += 1) {
        const xr = br[o + n * os], xi = bi[o + n * os];
        if (down) { wr[n] = xr * ur[n] - xi * ui[n]; wi[n] = xr * ui[n] + xi * ur[n]; }
        else { wr[n] = xr * ur[n] + xi * ui[n]; wi[n] = xi * ur[n] - xr * ui[n]; }
      }
      cfft(wr, wi);
      let k = 0, pk = 0, sum = 0;
      for (let i = 0; i < N; i += 1) { const p = wr[i] * wr[i] + wi[i] * wi[i]; sum += p; if (p > pk) { pk = p; k = i; } }
      const mean = (sum - pk) / (N - 1) + 1e-20;
      return { k, pk, ratio: pk / mean, mean };
    }
    run(f, n) {
      const m = this.dec.run(f, n);
      this.push(this.dec.or, this.dec.oi, m);
      const N = this.N, TH = 12 + this.sf * 2;
      for (let guard = 0; guard < 400; guard += 1) {
        if (this.state === 2) { if (!this.decode()) break; continue; }
        if (this.win + N > this.base + this.len) break;
        if (this.state === 0) {
          const r = this.dechirp(this.win, false);
          if (r.ratio > TH) {
            const dk = Math.min((r.k - this.lastK + N) % N, (this.lastK - r.k + N) % N);
            if (dk <= 1) this.cnt += 1; else { this.cnt = 1; this.lastK = r.k; }
            if (this.cnt >= 4) { this.state = 1; this.bUp = this.lastK; this.lockAt = this.win; this.miss = 0; }
          } else this.cnt = 0;
          this.win += N;
        } else {
          const u = this.dechirp(this.win, false), d = this.dechirp(this.win, true);
          if (d.ratio > TH && d.pk > 3 * u.pk) { if (this.win + 3 * N > this.base + this.len) break; this.sfd(d.k); continue; }
          if (u.ratio < TH / 2) this.miss += 1;
          if (this.miss > 4 || this.win - this.lockAt > N * 80) this.reset();
          this.win += N;
        }
      }
      if (this.state === 0) this.trim(false);
    }
    refAt(dflt) {
      const N = this.N, norm = (v) => { v = ((v % N) + N) % N; return v > N / 2 ? v - N : v; };
      const refs = this.refPos.map((at) => this.fracPeak(at, false).k);
      if (!refs.length) return dflt;
      const r0 = refs[0]; return r0 + refs.reduce((acc, r) => acc + norm(r - r0), 0) / refs.length;
    }
    // Pick the quarter-chip sampling phase whose header symbols land closest to whole bins.
    pickPhase() {
      if (this.os < 2) return;
      const N = this.N; let best = this.phase, be = 1e9, bref = this.ref;
      for (let p = 0; p < this.os; p += 1) {
        this.phase = p; const ref = this.refAt(this.ref); let err = 0;
        for (let i = 0; i < 8; i += 1) { const v = (((this.fracPeak(this.dataAt + i * N, false).k - ref) % N) + N) % N; err += Math.abs(v - Math.round(v)); }
        if (err < be) { be = err; best = p; bref = ref; }
      }
      this.phase = best; this.ref = bref;
    }
    // Fractional peak (parabolic interpolation on magnitudes) of the last dechirp.
    fracPeak(abs, down) {
      const r = this.dechirp(abs, down), N = this.N, wr = this.wr, wi = this.wi;
      const m = (i) => Math.hypot(wr[(i + N) % N], wi[(i + N) % N]);
      const a = m(r.k - 1), b = m(r.k), c = m(r.k + 1), den = a - 2 * b + c;
      return { k: r.k + (den ? (0.5 * (a - c)) / den : 0), ratio: r.ratio, pk: r.pk };
    }
    // Upchirp bin = timing + CFO, downchirp bin = CFO - timing (in bins): solve both, then confirm
    // the SFD position by testing which grid slot starts the two downchirps.
    sfd(kD) {
      const N = this.N;
      const norm = (v) => { v = ((v % N) + N) % N; return v > N / 2 ? v - N : v; };
      const s = this.bUp + kD;
      const c1 = norm(Math.round(s / 2)), c2 = norm(Math.round(s / 2) + N / 2);
      const cfo = Math.abs(c1) <= Math.abs(c2) ? c1 : c2;
      const tau = (((this.bUp - cfo) % N) + N) % N;
      let B0 = this.lockAt - tau;
      B0 += Math.floor((this.win - B0) / N) * N;
      if (this.os > 1) { // fractional chip timing from the up/down pair: u - d = 2 * timing
        const u = this.fracPeak(this.lockAt, false).k, d = this.fracPeak(this.win, true).k;
        const t = norm(u - d) / 2, fr = t - Math.round(t);
        this.phase = ((-Math.round(fr * this.os)) % this.os + this.os) % this.os;
      }
      const downness = (at) => { if (at < this.base || at + N > this.base + this.len) return 0; const u = this.dechirp(at, false).pk, d = this.dechirp(at, true).pk; return d / (u + d + 1e-20); };
      let B = B0, best = -1;
      for (const c of [B0 - 2 * N, B0 - N, B0, B0 + N]) { const sc = downness(c) + downness(c + N) - 0.5 * downness(c - N); if (sc > best) { best = sc; B = c; } }
      this.cfo = cfo;
      this.dataAt = B + 2 * N + N / 4;
      // Reference bin of an unmodulated upchirp on this grid (absorbs fractional CFO / timing).
      this.refPos = [B - 5 * N, B - 4 * N, B - 3 * N].filter((at) => at >= this.base);
      this.ref = this.refAt(cfo);
      const ref = this.ref;
      const sw = [];
      for (const at of [B - 2 * N, B - N]) if (at >= this.base) { const r = this.fracPeak(at, false); sw.push(Math.round((((Math.round(r.k - ref) % N) + N) % N) / 8) & 15); }
      this.sync = sw.length === 2 ? (sw[0] << 4) | sw[1] : -1;
      this.state = 2; this.hdr = null;
    }
    symAt(i, reduced) {
      const N = this.N;
      const r = this.fracPeak(this.dataAt + i * N, false);
      const v = (((r.k - this.ref) % N) + N) % N;
      this.snrAcc += 10 * Math.log10(r.ratio / N); this.snrN += 1; this.pw += r.pk / (N * N); this.pwN += 1;
      if (reduced) { const q = N / 4; const s = ((Math.round((v - 1) / 4) % q) + q) % q; return s ^ (s >> 1); }
      const s = ((Math.round(v) - 1) % N + N) % N; return s ^ (s >> 1);
    }
    decode() {
      const N = this.N, sf = this.sf, sfa = sf - 2;
      if (!this.hdr) {
        if (this.dataAt + 8 * N > this.base + this.len) return false;
        this.pickPhase();
        this.snrAcc = 0; this.snrN = 0; this.pw = 0; this.pwN = 0;
        const syms = []; for (let i = 0; i < 8; i += 1) syms.push(this.symAt(i, true));
        const nib = deinterleave(syms, sfa, 8);
        const len = (nib[0] << 4) | nib[1], cr = nib[2] >> 1, hasCrc = nib[2] & 1, ck = ((nib[3] & 1) << 4) | nib[4];
        if (ck !== hdrChecksum(nib[0], nib[1], nib[2]) || cr < 1 || cr > 4 || len < 1) { H.crcFail += 1; this.finish(this.dataAt + 8 * N); return true; }
        const need = 2 * len + (hasCrc ? 4 : 0) - (sfa - 5);
        const blocks = Math.max(0, Math.ceil(need / sf));
        this.hdr = { len, cr, hasCrc, nibs: nib.slice(5), total: 8 + blocks * (4 + cr), blocks };
      }
      const h = this.hdr;
      if (this.dataAt + h.total * N > this.base + this.len) return false;
      const nibs = h.nibs.slice();
      for (let b = 0; b < h.blocks; b += 1) {
        const syms = []; for (let i = 0; i < 4 + h.cr; i += 1) syms.push(this.symAt(8 + b * (4 + h.cr) + i, false));
        nibs.push(...deinterleave(syms, sf, 4 + h.cr));
      }
      const p = new Uint8Array(h.len);
      for (let i = 0; i < h.len; i += 1) p[i] = (nibs[2 * i] | (nibs[2 * i + 1] << 4)) ^ WHITEN[i];
      let ok = true;
      if (h.hasCrc) { const k = 2 * h.len; ok = (nibs[k] | (nibs[k + 1] << 4) | (nibs[k + 2] << 8) | (nibs[k + 3] << 12)) === payloadCrc(p); }
      const meta = { sf, bw: this.cfg.bw, cr: h.cr, sync: this.sync, snr: Math.round((this.snrAcc / Math.max(1, this.snrN)) * 10) / 10, rssi: Math.round(10 * Math.log10(this.pw / Math.max(1, this.pwN) + 1e-12)), preset: this.cfg.name, cfoHz: Math.round((this.cfo * this.cfg.bw) / N) };
      if (ok) packet(p, meta); else H.crcFail += 1;
      this.finish(this.dataAt + h.total * N);
      return true;
    }
    finish(end) { this.reset(); this.win = end; this.hdr = null; this.trim(true); }
  }

  // ---- Meshtastic: 16-byte header, AES-128-CTR (default LongFast key), protobuf Data
  const KEY = Uint8Array.from(atob("1PG7OiApB1nwvP+rz05pAQ=="), (c) => c.charCodeAt(0));
  let keyP = null;
  const key = () => keyP || (keyP = crypto.subtle.importKey("raw", KEY, "AES-CTR", false, ["encrypt", "decrypt"]));
  function nonce(id, from) { const n = new Uint8Array(16); const dv = new DataView(n.buffer); dv.setUint32(0, id >>> 0, true); dv.setUint32(8, from >>> 0, true); return n; }
  async function crypt(id, from, data) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CTR", counter: nonce(id, from), length: 32 }, await key(), data)); }
  const xorHash = (bytes) => Array.from(bytes).reduce((a, b) => a ^ b, 0);
  const HASH = xorHash(Array.from("LongFast", (c) => c.charCodeAt(0))) ^ xorHash(KEY);
  function pb(b) {
    const out = {}; let i = 0;
    const varint = () => { let v = 0, m = 1, by; do { if (i >= b.length) throw new Error("pb"); by = b[i++]; v += (by & 0x7f) * m; m *= 128; } while (by & 0x80 && m < 2 ** 56); return v; };
    while (i < b.length) {
      const k = varint(), f = Math.floor(k / 8), w = k & 7;
      let v;
      if (w === 0) v = varint();
      else if (w === 1) { v = b.subarray(i, i + 8); i += 8; }
      else if (w === 2) { const l = varint(); if (i + l > b.length) throw new Error("pb"); v = b.subarray(i, i + l); i += l; }
      else if (w === 5) { if (i + 4 > b.length) throw new Error("pb"); v = new DataView(b.buffer, b.byteOffset + i, 4).getInt32(0, true); i += 4; }
      else throw new Error("pb wire");
      if (f < 1) throw new Error("pb field");
      (out[f] = out[f] || []).push(v);
    }
    return out;
  }
  const HW = { 1: "TLORA V2", 4: "T-Beam", 9: "RAK4631", 25: "Station G1", 43: "Heltec V3", 48: "T-Echo", 71: "Heltec Wireless Tracker", 84: "Seeed T1000-E" };
  async function meshtastic(p, meta) {
    const dv = new DataView(p.buffer, p.byteOffset, p.length);
    const to = dv.getUint32(0, true), from = dv.getUint32(4, true), id = dv.getUint32(8, true), flags = p[12], ch = p[13];
    const hopLimit = flags & 7, hopStart = (flags >> 5) & 7;
    const msg = Object.assign({ proto: "Meshtastic", id: "!" + hex(from, 8).toLowerCase(), to: to === 0xffffffff ? "broadcast" : "!" + hex(to, 8).toLowerCase(), packetId: id, hopLimit, hopStart, hops: hopStart >= hopLimit ? hopStart - hopLimit : null, channel: ch === HASH ? "LongFast (default key)" : "private channel 0x" + hex(ch, 2), encrypted: true }, meta);
    if (ch === HASH && p.length > 16) {
      try {
        const data = pb(await crypt(id, from, p.subarray(16)));
        const port = data[1] ? data[1][0] : 0, pl = data[2] ? data[2][0] : null;
        msg.encrypted = false; msg.port = port;
        if (pl && port === 3) { const pos = pb(pl); if (pos[1] && pos[2]) { msg.lat = pos[1][0] / 1e7; msg.lon = pos[2][0] / 1e7; } if (pos[3]) msg.alt = pos[3][0] > 2 ** 31 ? pos[3][0] - 2 ** 32 : pos[3][0]; msg.portName = "Position"; }
        else if (pl && port === 4) { const u = pb(pl); if (u[2]) msg.longName = utf8(u[2][0]).slice(0, 40); if (u[3]) msg.shortName = utf8(u[3][0]).slice(0, 4); if (u[5]) msg.hw = HW[u[5][0]] || "Hardware model " + u[5][0]; msg.portName = "Node info"; }
        else if (port === 1) msg.portName = "Text message (content not shown)";
        else if (port === 67) msg.portName = "Telemetry";
        else msg.portName = "Port " + port;
      } catch (e) { msg.encrypted = true; }
    }
    H.packets.mesh += 1;
    post({ t: "mesh", msg });
    return msg;
  }
  function meshcore(p, meta) {
    const type = (p[0] >> 2) & 15, pathLen = p[1] || 0;
    let o = 2 + pathLen;
    const msg = Object.assign({ proto: "MeshCore", hops: pathLen, encrypted: type !== 4 }, meta);
    if (type === 4 && p.length >= o + 101) {
      const k = p.subarray(o, o + 32); o += 32 + 4 + 64;
      const flags = p[o++];
      msg.id = "MC-" + Array.from(k.subarray(0, 4), (b) => hex(b, 2)).join("");
      msg.nodeType = ["Node", "Companion", "Repeater", "Room server", "Sensor"][flags & 15] || "Node";
      const dv = new DataView(p.buffer, p.byteOffset, p.length);
      if (flags & 0x10 && o + 8 <= p.length) { msg.lat = dv.getInt32(o, true) / 1e6; msg.lon = dv.getInt32(o + 4, true) / 1e6; o += 8; }
      if (flags & 0x20) o += 2;
      if (flags & 0x40) o += 2;
      if (flags & 0x80) msg.longName = utf8(p.subarray(o)).replace(/\0.*$/, "").slice(0, 40);
      msg.portName = "Advert";
    } else { msg.id = "MC-" + hex(p[0], 2) + hex(p[p.length - 1], 2); msg.portName = "Packet type " + type; }
    H.packets.mesh += 1;
    post({ t: "mesh", msg });
    return msg;
  }
  function packet(p, meta) {
    if (meta.sync === 0x34 && p.length >= 8) { // public LoRaWAN (encrypted, no position): Devices tab
      const mtype = p[0] >> 5, dev = (p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24)) >>> 0, fcnt = p[6] | (p[7] << 8);
      H.packets.lorawan += 1;
      post({ t: "device", msg: { kind: "LoRaWAN", id: hex(dev, 8), detail: ["Join request", "Join accept", "Uplink", "Downlink", "Confirmed uplink", "Confirmed downlink", "RFU", "Proprietary"][mtype] + " · FCnt " + fcnt, rssi: meta.rssi } });
      return;
    }
    if (meta.sync === 0x12 && !(p.length >= 16 && p[13] === HASH)) { meshcore(p, meta); return; }
    if (p.length >= 16) meshtastic(p, meta);
  }

  const PRESETS = { "906.875": { name: "Meshtastic LongFast (US)", sf: 11, bw: 250e3 }, "915": { name: "LoRa 915 / LoRaWAN", sf: 7, bw: 125e3 }, "869.525": { name: "Meshtastic LongFast (EU)", sf: 11, bw: 250e3 }, "868.1": { name: "LoRaWAN EU868", sf: 7, bw: 125e3 }, "910.525": { name: "MeshCore (US)", sf: 7, bw: 62.5e3 } };
  function cfgFor(hz) { const m = hz / 1e6; let best = null, bd = 99; for (const [k, v] of Object.entries(PRESETS)) { const d = Math.abs(Number(k) - m); if (d < bd) { bd = d; best = v; } } return best; }

  // ---- QA encoders (test signal only)
  const varint = (v) => { const out = []; let x = v < 0 ? v + 2 ** 32 : v; do { let b = x % 128; x = Math.floor(x / 128); if (x) b |= 0x80; out.push(b); } while (x); return out; };
  const pbBytes = (f, arr) => [(f << 3) | 2, ...varint(arr.length), ...arr];
  const asc = (s) => Array.from(s, (c) => c.charCodeAt(0));
  let pid = 1000;
  async function encodeMesh(node, kind) {
    const pos = [0x0d, ...P2.util.le32(Math.round(node.lat * 1e7)), 0x15, ...P2.util.le32(Math.round(node.lon * 1e7)), 0x18, ...varint(node.alt)];
    const inner = kind === "info"
      ? [0x08, 4, ...pbBytes(2, [...pbBytes(1, asc("!" + hex(node.id, 8).toLowerCase())), ...pbBytes(2, asc(node.long)), ...pbBytes(3, asc(node.short)), 0x28, node.hw])]
      : [0x08, 3, ...pbBytes(2, pos)];
    const id = (pid += 1) >>> 0;
    const enc = await crypt(id, node.id, Uint8Array.from(inner)); // CTR: encrypt == decrypt
    const hdr = new Uint8Array(16); const dv = new DataView(hdr.buffer);
    dv.setUint32(0, 0xffffffff, true); dv.setUint32(4, node.id, true); dv.setUint32(8, id, true); hdr[12] = (3 << 5) | (3 - node.hops); hdr[13] = HASH;
    return Uint8Array.from([...hdr, ...enc]);
  }
  function encodeMeshcore(n) {
    const out = [(4 << 2) | 1, 1, 0x5a];
    for (let i = 0; i < 32; i += 1) out.push((n.key + i * 37) & 255);
    out.push(...P2.util.le32(Math.floor(Date.now() / 1000)));
    for (let i = 0; i < 64; i += 1) out.push(i);
    out.push(0x80 | 0x10 | 2, ...P2.util.le32(Math.round(n.lat * 1e6)), ...P2.util.le32(Math.round(n.lon * 1e6)), ...asc(n.name));
    return Uint8Array.from(out);
  }
  function emission(start, payload, cfg, offset, cfo, amp, syncWord) {
    const fs = S.rate, os = fs / cfg.bw, N = 1 << cfg.sf;
    const data = symbols(payload, cfg.sf, 1);
    const seq = [];
    for (let i = 0; i < 16; i += 1) seq.push({ v: 0 });
    seq.push({ v: (syncWord >> 4) * 8 }, { v: (syncWord & 15) * 8 }, { d: 1 }, { d: 1 }, { d: 0.25 });
    for (const v of data) seq.push({ v });
    const starts = []; let acc = 0;
    for (const s of seq) { starts.push(acc); acc += (s.d || 1) * N * os; }
    let phase = Math.random() * TAU, idx = 0;
    return { start, len: Math.ceil(acc), next: (k) => {
      while (idx + 1 < seq.length && k >= starts[idx + 1]) idx += 1;
      const s = seq[idx], chip = (k - starts[idx]) / os;
      const fr = s.d ? 0.5 - ((chip / N) % 1) : (((chip + s.v) / N) % 1) - 0.5;
      phase += (TAU * (offset + cfo + fr * cfg.bw)) / fs;
      return [amp * Math.cos(phase), amp * Math.sin(phase)];
    } };
  }
  P2.lora = { LoRa, cfgFor, symbols, deinterleave, meshtastic, packet, encodeMesh, encodeMeshcore, emission, HASH, PRESETS };
})();

// ==================================================================== UAT 978 MHz (ADS-B + FIS-B ground uplinks)
(function () {
  const P2 = self.P2, { pop32, hex } = P2.util;
  const GF = (() => { const exp = new Uint8Array(512), log = new Uint8Array(256); let x = 1; for (let i = 0; i < 255; i += 1) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x187; } for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255]; return { exp, log }; })();
  const gmul = (a, b) => (a && b ? GF.exp[GF.log[a] + GF.log[b]] : 0);
  const RSG = {};
  function rsGen(nr) { let g = [1]; for (let i = 0; i < nr; i += 1) { const r = GF.exp[(120 + i) % 255]; const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j += 1) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], r); } g = ng; } return g; }
  function rsEncode(data, nr) { const g = RSG[nr] || (RSG[nr] = rsGen(nr)); const par = new Array(nr).fill(0); for (const d of data) { const fb = d ^ par[0]; par.shift(); par.push(0); if (fb) for (let j = 0; j < nr; j += 1) par[j] ^= gmul(fb, g[j + 1]); } return par; }
  function rsCheck(cw, nr) { for (let i = 0; i < nr; i += 1) { const r = GF.exp[(120 + i) % 255]; let s = 0; for (let k = 0; k < cw.length; k += 1) s = gmul(s, r) ^ cw[k]; if (s) return false; } return true; }
  const SYNC = { adsb: [0xe, 0xacdda4e2], up: [0x1, 0x53225b1d] };
  const B40 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ  ..";
  // 2 samples per bit at 2.083333 MS/s; bits from the phase change over each bit, both sample phases searched.
  class Uat {
    constructor() { this.d = new Float32Array(0); this.pr = 1; this.pi = 0; this.ph = [{ i: 0, h: 0, l: 0, wait: -1 }, { i: 1, h: 0, l: 0, wait: -1 }]; }
    run(f, n) {
      const keep = this.d.length, d = new Float32Array(keep + n); d.set(this.d);
      let pr = this.pr, pi = this.pi;
      for (let k = 0; k < n; k += 1) { const r = f[2 * k], q = f[2 * k + 1]; d[keep + k] = Math.atan2(q * pr - r * pi, r * pr + q * pi); pr = r; pi = q; }
      this.pr = pr; this.pi = pi;
      const L = d.length;
      for (const P of this.ph) {
        let i = P.i;
        for (;;) {
          if (P.wait >= 0) {
            if (P.wait + (P.up ? 4416 : 384) * 2 + 1 > L) break;
            i = this.frame(d, P.wait, P.up); P.wait = -1; P.h = 0; P.l = 0;
            continue;
          }
          if (i + 1 >= L) break;
          const bit = d[i] + d[i + 1] > 0 ? 1 : 0; i += 2;
          P.h = ((P.h << 1) | (P.l >>> 31)) & 0xf; P.l = ((P.l << 1) | bit) >>> 0;
          if (pop32((P.h ^ SYNC.adsb[0]) & 0xf) + pop32(P.l ^ SYNC.adsb[1]) <= 3) { P.wait = i; P.up = false; }
          else if (pop32((P.h ^ SYNC.up[0]) & 0xf) + pop32(P.l ^ SYNC.up[1]) <= 3) { P.wait = i; P.up = true; }
        }
        P.i = i;
      }
      let cut = Math.min(...this.ph.map((P) => (P.wait >= 0 ? P.wait : P.i) - 2));
      cut = Math.max(0, Math.min(cut, L - 2)); cut -= cut % 2;
      this.d = d.slice(cut);
      for (const P of this.ph) { P.i -= cut; if (P.wait >= 0) P.wait -= cut; }
    }
    bytes(d, s, nb) { const out = new Uint8Array(nb); for (let j = 0; j < nb * 8; j += 1) if (d[s + 2 * j] + d[s + 2 * j + 1] > 0) out[j >> 3] |= 0x80 >> (j & 7); return out; }
    frame(d, s, up) { // returns the index to resume the bit search from
      if (up) {
        const raw = this.bytes(d, s, 552), blocks = []; let ok = true;
        for (let j = 0; j < 6; j += 1) { const b = new Uint8Array(92); for (let i = 0; i < 92; i += 1) b[i] = raw[i * 6 + j]; if (!rsCheck(b, 20)) ok = false; blocks.push(b); }
        if (!ok) { H.crcFail += 1; return s; }
        const pl = new Uint8Array(432); for (let j = 0; j < 6; j += 1) pl.set(blocks[j].subarray(0, 72), j * 72);
        uplink(pl);
        return s + 4416 * 2;
      }
      const long = this.bytes(d, s, 48);
      if (rsCheck(long, 14)) { adsb(long.subarray(0, 34)); return s + 384 * 2; }
      if (rsCheck(long.subarray(0, 30), 12)) { adsb(long.subarray(0, 18)); return s + 240 * 2; }
      H.crcFail += 1; return s;
    }
  }
  function adsb(p) {
    const type = p[0] >> 3, aq = p[0] & 7, addr = (p[1] << 16) | (p[2] << 8) | p[3];
    const msg = { icao: hex(addr, 6), addrType: ["ADS-B (ICAO)", "ADS-B (self-assigned)", "TIS-B (ICAO)", "TIS-B (track file)", "Surface vehicle", "Fixed beacon", "ADS-R", "Reserved"][aq], type };
    let lat = ((p[4] << 15) | (p[5] << 7) | (p[6] >> 1)) * (360 / 16777216), lon = (((p[6] & 1) << 23) | (p[7] << 15) | (p[8] << 7) | (p[9] >> 1)) * (360 / 16777216);
    if (lat > 90) lat -= 180;
    if (lon > 180) lon -= 360;
    if (lat || lon) { msg.lat = Math.round(lat * 1e5) / 1e5; msg.lon = Math.round(lon * 1e5) / 1e5; }
    const altRaw = (p[10] << 4) | (p[11] >> 4);
    if (altRaw) { msg.alt = (altRaw - 1) * 25 - 1000; msg.altType = p[9] & 1 ? "GNSS" : "barometric"; }
    msg.nic = p[11] & 15;
    const ag = (p[12] >> 6) & 3;
    msg.ground = ag === 2;
    if (ag < 2) {
      const ns = ((p[12] & 0x1f) << 6) | (p[13] >> 2), ew = ((p[13] & 3) << 9) | (p[14] << 1) | (p[15] >> 7);
      if ((ns & 0x3ff) && (ew & 0x3ff)) {
        const vn = ((ns & 0x3ff) - 1) * (ns & 0x400 ? -1 : 1), ve = ((ew & 0x3ff) - 1) * (ew & 0x400 ? -1 : 1);
        msg.speed = Math.round(Math.hypot(vn, ve)); msg.heading = Math.round(((Math.atan2(ve, vn) * 180) / Math.PI + 360) % 360);
      }
      const vv = ((p[15] & 0x7f) << 4) | (p[16] >> 4);
      if (vv & 0x1ff) msg.vrate = ((vv & 0x1ff) - 1) * 64 * (vv & 0x200 ? -1 : 1);
    }
    if (p.length >= 34 && (type === 1 || type === 3)) {
      const w1 = (p[17] << 8) | p[18], w2 = (p[19] << 8) | p[20], w3 = (p[21] << 8) | p[22];
      const cs = B40[Math.floor(w1 / 40) % 40] + B40[w1 % 40] + B40[Math.floor(w2 / 1600) % 40] + B40[Math.floor(w2 / 40) % 40] + B40[w2 % 40] + B40[Math.floor(w3 / 1600) % 40] + B40[Math.floor(w3 / 40) % 40] + B40[w3 % 40];
      msg.emitter = Math.floor(w1 / 1600);
      msg.callsign = cs.replace(/[ .]+$/, "").trim();
    }
    H.packets.uat += 1;
    post({ t: "uat", msg });
    return msg;
  }
  const DLAC = "\x03ABCDEFGHIJKLMNOPQRSTUVWXYZ\x1a\t\x1e\n| !\"#$%&'()*+,-./0123456789:;<=>?";
  function dlacDecode(b) { let s = ""; for (let i = 0; i + 2 < b.length; i += 3) { const c = [b[i] >> 2, ((b[i] & 3) << 4) | (b[i + 1] >> 4), ((b[i + 1] & 15) << 2) | (b[i + 2] >> 6), b[i + 2] & 63]; for (const x of c) { if (x === 0) return s; s += DLAC[x]; } } return s; }
  function dlacEncode(s) { const codes = []; for (const ch of s) { const i = DLAC.indexOf(ch); codes.push(i < 0 ? 32 : i); } codes.push(0); while (codes.length % 4) codes.push(0); const out = []; for (let i = 0; i < codes.length; i += 4) { const [a, b, c, d] = codes.slice(i, i + 4); out.push((a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d); } return out; }
  function uplink(p) {
    let lat = ((p[0] << 15) | (p[1] << 7) | (p[2] >> 1)) * (360 / 16777216), lon = (((p[2] & 1) << 23) | (p[3] << 15) | (p[4] << 7) | (p[5] >> 1)) * (360 / 16777216);
    if (lat > 90) lat -= 180;
    if (lon > 180) lon -= 360;
    const msg = { ground: { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, valid: Boolean(p[5] & 1), slot: p[6] & 31, site: p[7] >> 4 }, texts: [] };
    let o = 8;
    while (o + 2 <= 432) {
      const len = (p[o] << 1) | (p[o + 1] >> 7), type = p[o + 1] & 15;
      if (!len || o + 2 + len > 432) break;
      if (type === 0) {
        const a = p.subarray(o + 2, o + 2 + len);
        const pid = ((a[0] & 0x1f) << 6) | (a[1] >> 2), hh = (a[2] >> 2) & 31, mm = ((a[2] & 3) << 4) | (a[3] >> 4);
        if (pid === 413) for (const rec of dlacDecode(a.subarray(4)).split("\x1e")) { const t = rec.replace(/[\x00-\x1f]/g, " ").trim(); if (t) msg.texts.push({ product: pid, time: String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + "Z", text: t.slice(0, 300) }); }
      }
      o += 2 + len;
    }
    H.packets.fisb += 1;
    post({ t: "fisb", msg });
    return msg;
  }
  // ---- QA encoders
  const latlon = (lat, lon) => [Math.round(((lat < 0 ? lat + 180 : lat) * 16777216) / 360) & 0x7fffff, Math.round(((lon < 0 ? lon + 360 : lon) * 16777216) / 360) & 0xffffff];
  function encodeAdsb(a) {
    const p = new Uint8Array(34);
    p[0] = 1 << 3; p[1] = (a.icao >> 16) & 255; p[2] = (a.icao >> 8) & 255; p[3] = a.icao & 255;
    const [la, lo] = latlon(a.lat, a.lon);
    p[4] = la >> 15; p[5] = (la >> 7) & 255; p[6] = ((la & 0x7f) << 1) | (lo >> 23); p[7] = (lo >> 15) & 255; p[8] = (lo >> 7) & 255; p[9] = (lo & 0x7f) << 1;
    const alt = Math.round((a.alt + 1000) / 25) + 1; p[10] = alt >> 4; p[11] = ((alt & 15) << 4) | 8;
    const vn = Math.round(a.kt * Math.cos((a.hdg * Math.PI) / 180)), ve = Math.round(a.kt * Math.sin((a.hdg * Math.PI) / 180));
    const ns = (vn < 0 ? 0x400 : 0) | (Math.abs(vn) + 1), ew = (ve < 0 ? 0x400 : 0) | (Math.abs(ve) + 1);
    p[12] = ns >> 6; p[13] = ((ns & 0x3f) << 2) | (ew >> 9); p[14] = (ew >> 1) & 255;
    const vv = (a.vr < 0 ? 0x200 : 0) | (Math.round(Math.abs(a.vr) / 64) + 1);
    p[15] = ((ew & 1) << 7) | (vv >> 4); p[16] = (vv & 15) << 4;
    const cs = (a.cs + "        ").slice(0, 8).toUpperCase();
    const c = (ch) => { const i = B40.indexOf(ch); return i < 0 ? 36 : i; };
    const w1 = 1600 + c(cs[0]) * 40 + c(cs[1]), w2 = c(cs[2]) * 1600 + c(cs[3]) * 40 + c(cs[4]), w3 = c(cs[5]) * 1600 + c(cs[6]) * 40 + c(cs[7]);
    p[17] = w1 >> 8; p[18] = w1 & 255; p[19] = w2 >> 8; p[20] = w2 & 255; p[21] = w3 >> 8; p[22] = w3 & 255;
    const cw = Array.from(p).concat(rsEncode(Array.from(p), 14));
    const bits = []; bitsPut(bits, 4, SYNC.adsb[0]); bitsPut(bits, 32, SYNC.adsb[1]);
    for (const b of cw) bitsPut(bits, 8, b);
    return bits;
  }
  function encodeUplink(g, texts) {
    const p = new Uint8Array(432);
    const [la, lo] = latlon(g.lat, g.lon);
    p[0] = la >> 15; p[1] = (la >> 7) & 255; p[2] = ((la & 0x7f) << 1) | (lo >> 23); p[3] = (lo >> 15) & 255; p[4] = (lo >> 7) & 255; p[5] = ((lo & 0x7f) << 1) | 1; p[6] = 0x20 | 7; p[7] = 3 << 4;
    const now = new Date();
    const apdu = [(413 >> 6) & 0x1f, (413 & 0x3f) << 2, (now.getUTCHours() << 2) | (now.getUTCMinutes() >> 4), (now.getUTCMinutes() & 15) << 4, ...dlacEncode(texts.join("\x1e"))].slice(0, 420);
    p[8] = apdu.length >> 1; p[9] = (apdu.length & 1) << 7; p.set(apdu, 10);
    const raw = new Uint8Array(552);
    for (let j = 0; j < 6; j += 1) { const data = Array.from(p.subarray(j * 72, j * 72 + 72)); const cw = data.concat(rsEncode(data, 20)); for (let i = 0; i < 92; i += 1) raw[i * 6 + j] = cw[i]; }
    const bits = []; bitsPut(bits, 4, SYNC.up[0]); bitsPut(bits, 32, SYNC.up[1]);
    for (const b of raw) bitsPut(bits, 8, b);
    return bits;
  }
  P2.uat = { Uat, adsb, uplink, rsEncode, rsCheck, dlacDecode, dlacEncode, encodeAdsb, encodeUplink };
})();

// ==================================================================== OOK sensors, FLEX pagers, DFM + RS41 PTU radiosondes
(function () {
  const P2 = self.P2, { hex, bytesOfBits, crc8p, bitsVal } = P2.util;
  // ---- OOK: TPMS (formats A and B), ERT SCM utility meters, EV1527 remotes, WH2-style weather sensors
  const SCM_PRE = 0x1f2a60; // 21-bit SCM preamble
  function crcBits(bits, start, len, poly, width) { let c = 0; const top = 1 << (width - 1), mask = (1 << width) - 1; for (let i = 0; i < len; i += 1) { const fb = (c & top ? 1 : 0) ^ bits[start + i]; c = (c << 1) & mask; if (fb) c ^= poly; } return c; }
  const ERT = (t) => ([4, 5, 7, 8].includes(t) ? "Electric" : [2, 9, 12].includes(t) ? "Gas" : [11, 13].includes(t) ? "Water" : "Utility");
  class OokMulti extends Ook {
    burst() {
      const runs = [];
      for (const r of this.runs) {
        if (!r) continue;
        if (Math.abs(r) < 3 && runs.length) { runs[runs.length - 1] += Math.sign(runs[runs.length - 1]) * Math.abs(r); continue; }
        if (runs.length && Math.sign(runs[runs.length - 1]) === Math.sign(r)) runs[runs.length - 1] += r; else runs.push(r);
      }
      while (runs.length && runs[0] < 0) runs.shift();
      const pulses = runs.filter((r) => r > 0).length;
      if (pulses < 8) return;
      const rssi = Math.round(10 * Math.log10(this.peak + 1e-12));
      let label = this.manchester(runs, rssi) || this.pwm(runs, rssi);
      if (!label) { H.packets.device += 1; post({ t: "device", msg: { kind: "OOK", id: "", pulses, rssi } }); label = "unknown"; }
      post({ t: "burst", runs: runs.slice(0, 600).map((r) => Math.sign(r) * Math.round((Math.abs(r) / this.fs) * 1e6)), label, rssi });
    }
    manchester(runs, rssi) {
      // Half-bit unit from the short highs and short lows separately (the envelope threshold stretches highs), then refine.
      const hi = runs.filter((r) => r > 0).sort((a, b) => a - b), lo = runs.filter((r) => r < 0).map((r) => -r).sort((a, b) => a - b);
      if (!hi.length || !lo.length) return "";
      let h = (hi[Math.floor(hi.length * 0.2)] + lo[Math.floor(lo.length * 0.2)]) / 2;
      for (let it = 0; it < 3; it += 1) { let sr = 0, sk = 0; for (const r of runs) { const k = Math.max(1, Math.min(2, Math.round(Math.abs(r) / h))); sr += Math.abs(r); sk += k; } h = sr / sk; }
      if (!h) return "";
      const halves = [];
      for (const r of runs) { const x = Math.abs(r) / h; if (x > 2.75) return ""; const k = Math.max(1, Math.min(2, Math.round(x))); for (let j = 0; j < k; j += 1) halves.push(r > 0 ? 1 : 0); }
      halves.push(0);
      for (let start = 0; start < 2; start += 1) {
        const bits = [];
        for (let i = start; i + 1 < halves.length; i += 2) { const a = halves[i], b = halves[i + 1]; if (a === b) { if (bits.length > 40) break; bits.length = 0; continue; } bits.push(a === 1 ? 1 : 0); }
        for (let s = 0; s + 16 <= bits.length; s += 1) {
          const w = bitsVal(bits, s, 16);
          if (w === 0x2dd4 && s + 80 <= bits.length) {
            const by = bytesOfBits(bits, s + 16, 8);
            if (crc8(by, 7) !== by[7]) { H.crcFail += 1; continue; }
            H.packets.device += 1;
            post({ t: "device", msg: { kind: "TPMS", fmt: "A", id: hex(((by[0] << 24) | (by[1] << 16) | (by[2] << 8) | by[3]) >>> 0, 8), kpa: by[4] * 2.5, tempC: by[5] - 40, rssi } });
            return "TPMS A";
          }
          if (w === 0x4b5a && s + 88 <= bits.length) {
            const by = bytesOfBits(bits, s + 16, 9);
            if (crc8p(by, 8, 0x13, 0) !== by[8]) { H.crcFail += 1; continue; }
            H.packets.device += 1;
            post({ t: "device", msg: { kind: "TPMS", fmt: "B", id: hex(((by[0] << 24) | (by[1] << 16) | (by[2] << 8) | by[3]) >>> 0, 8), kpa: Math.round(by[4] * 16) / 10, tempC: by[5] - 50, rssi } });
            return "TPMS B";
          }
          if (s + 96 <= bits.length && bitsVal(bits, s, 21) === SCM_PRE) {
            if (crcBits(bits, s + 21, 59, 0x6f63, 16) !== bitsVal(bits, s + 80, 16)) { H.crcFail += 1; continue; }
            const idHi = bitsVal(bits, s + 21, 2), ert = bitsVal(bits, s + 26, 4), cons = bitsVal(bits, s + 32, 24), idLo = bitsVal(bits, s + 56, 24);
            H.packets.meter += 1;
            post({ t: "meter", msg: { proto: "ERT SCM", id: String(idHi * 16777216 + idLo), ert, kind: ERT(ert), consumption: cons, tamper: Boolean(bitsVal(bits, s + 24, 2) || bitsVal(bits, s + 30, 2)), rssi } });
            return "ERT SCM";
          }
        }
      }
      return "";
    }
    pwm(runs, rssi) {
      const highs = runs.filter((r) => r > 0);
      if (highs.length < 20) return "";
      const sorted = highs.slice().sort((a, b) => a - b);
      const short = sorted[Math.floor(sorted.length * 0.15)], long = sorted[Math.floor(sorted.length * 0.85)];
      if (!(long > short * 2.2 && long < short * 4.2)) return "";
      const thr = (short + long) / 2;
      const raw = highs.map((r) => (r > thr ? 1 : 0));
      if (raw.length >= 24 && raw.length <= 26) {
        const code = bitsVal(raw, 0, 20), btn = bitsVal(raw, 20, 4);
        H.packets.remote += 1;
        post({ t: "device", msg: { kind: "Remote", fmt: "EV1527 24-bit", id: hex(code, 5), detail: "button " + btn, rssi } });
        return "EV1527 remote";
      }
      if (raw.length >= 48) {
        const bits = raw.map((b) => b ^ 1);
        for (let s = 0; s + 48 <= bits.length; s += 1) {
          if (bitsVal(bits, s, 8) !== 0xff) continue;
          const by = bytesOfBits(bits, s + 8, 5);
          if (crc8p(by, 4, 0x31, 0) !== by[4]) continue;
          const id = (by[0] << 4) | (by[1] >> 4); let t = ((by[1] & 15) << 8) | by[2]; if (t & 0x800) t -= 0x1000;
          H.packets.weather += 1;
          post({ t: "device", msg: { kind: "Weather sensor", fmt: "WH2-style PWM", id: hex(id, 3), tempC: t / 10, humidity: by[3], rssi } });
          return "Weather sensor";
        }
      }
      return "";
    }
  }
  const halvesOf = (bits) => { const h = []; for (const b of bits) h.push(b ? 1 : 0, b ? 0 : 1); return h; };
  const alt16 = () => { const b = []; for (let i = 0; i < 16; i += 1) b.push(i & 1 ? 0 : 1); return b; };
  function scmEncode(m) {
    const bits = alt16(); bitsPut(bits, 21, SCM_PRE); const s = bits.length - 21;
    bitsPut(bits, 2, Math.floor(m.id / 16777216) & 3); bitsPut(bits, 1, 0); bitsPut(bits, 2, 0); bitsPut(bits, 4, m.ert); bitsPut(bits, 2, 0); bitsPut(bits, 24, m.cons); bitsPut(bits, 24, m.id % 16777216);
    bitsPut(bits, 16, crcBits(bits, s + 21, 59, 0x6f63, 16));
    return halvesOf(bits);
  }
  function tpmsBEncode(t) {
    const by = new Uint8Array(9);
    by[0] = t.id >>> 24; by[1] = (t.id >>> 16) & 255; by[2] = (t.id >>> 8) & 255; by[3] = t.id & 255; by[4] = Math.round(t.kpa / 1.6); by[5] = t.temp + 50; by[7] = 7; by[8] = crc8p(by, 8, 0x13, 0);
    const bits = alt16().concat(alt16()); bitsPut(bits, 16, 0x4b5a); for (const b of by) bitsPut(bits, 8, b);
    return halvesOf(bits);
  }
  function pwmUnits(bits) { const u = []; for (const b of bits) u.push(...(b ? [1, 1, 1, 0] : [1, 0, 0, 0])); return u; }
  function ev1527Encode(code, btn) { const bits = []; bitsPut(bits, 20, code); bitsPut(bits, 4, btn); return [1].concat(new Array(31).fill(0), pwmUnits(bits), [1, 0, 0, 0]); }
  function wh2Encode(w) {
    const by = new Uint8Array(5); let t = Math.round(w.temp * 10); if (t < 0) t += 0x1000;
    by[0] = (w.id >> 4) & 255; by[1] = ((w.id & 15) << 4) | ((t >> 8) & 15); by[2] = t & 255; by[3] = w.hum; by[4] = crc8p(by, 4, 0x31, 0);
    const bits = []; bitsPut(bits, 8, 0xff); for (const b of by) bitsPut(bits, 8, b);
    return pwmUnits(bits.map((b) => b ^ 1)).concat([1, 0, 0, 0]);
  }

  // ---- FLEX 1600/2: A word sync, FIW, 11 blocks of 8 interleaved BCH(31,21) words
  const FLEX_A = 0x78f3870c;
  const rev21 = (v) => { let r = 0; for (let i = 0; i < 21; i += 1) r |= ((v >> i) & 1) << (20 - i); return r; };
  const flexCw = (d) => pocsagCw(rev21(d & 0x1fffff));
  const flexData = (cw) => rev21((cw >>> 11) & 0x1fffff);
  const NUM = "0123456789 U -][";
  class Flex {
    constructor() { this.reg = 0; this.on = false; this.bits = []; this.inv = 0; }
    bit(b) {
      if (this.on) { this.bits.push(b ^ this.inv); if (this.bits.length === 80 + 2816) { this.on = false; this.frame(this.bits); this.bits = []; } return; }
      this.reg = ((this.reg << 1) | b) >>> 0;
      if (this.reg === FLEX_A) { this.on = true; this.inv = 0; this.bits = []; }
      else if (this.reg === (~FLEX_A >>> 0)) { this.on = true; this.inv = 1; this.bits = []; }
    }
    frame(bits) {
      const fiw = pocsagFix(bitsVal(bits, 48, 32) >>> 0);
      if (fiw == null) { H.crcFail += 1; return; }
      const fd = flexData(fiw), cycle = (fd >> 4) & 15, frameNo = (fd >> 8) & 127;
      const words = [];
      for (let b = 0; b < 11; b += 1) for (let w = 0; w < 8; w += 1) { let v = 0; for (let i = 0; i < 32; i += 1) v = v * 2 + bits[80 + b * 256 + i * 8 + w]; const cw = pocsagFix(v >>> 0); words.push(cw == null ? null : flexData(cw)); }
      const biw = words[0];
      if (biw == null) { H.crcFail += 1; return; }
      const a0 = 1 + ((biw >> 8) & 3), v0 = (biw >> 10) & 63;
      for (let a = a0; a < v0; a += 1) {
        const aw = words[a], vw = words[v0 + (a - a0)];
        if (aw == null || vw == null || aw < 0x8001) continue;
        const type = (vw >> 4) & 7, ms = (vw >> 7) & 127, ml = (vw >> 14) & 127;
        let text = "", kind = "tone";
        if (type === 5) { kind = "alpha"; outer: for (let k = ms + 1; k < ms + ml && k < words.length; k += 1) { const d = words[k]; if (d == null) { text += "?"; continue; } for (const sh of [0, 7, 14]) { const c = (d >> sh) & 127; if (c === 3) break outer; if (c >= 32 && c < 127) text += String.fromCharCode(c); } } }
        else if (type === 3) { kind = "numeric"; for (let k = ms; k < ms + ml && k < words.length; k += 1) { const d = words[k]; if (d == null) continue; for (let sh = 0; sh < 20; sh += 4) text += NUM[(d >> sh) & 15]; } text = text.trim(); }
        H.packets.flex += 1; H.packets.pager += 1;
        post({ t: "pager", msg: { proto: "FLEX", baud: 1600, capcode: aw - 0x8000, func: type, kind, text: text.slice(0, 240), cycle, frame: frameNo } });
      }
    }
  }
  function flexEncode(pages, cycle, frameNo) {
    const words = new Array(88).fill(flexCw(0));
    const a0 = 1, v0 = a0 + pages.length;
    words[0] = flexCw(v0 << 10);
    let at = v0 + pages.length;
    pages.forEach((pg, i) => {
      words[a0 + i] = flexCw(0x8000 + pg.cap);
      const body = [];
      if (pg.alpha) { body.push(0); const ch = Array.from(pg.text + "\x03", (c) => c.charCodeAt(0)); while (ch.length % 3) ch.push(3); for (let k = 0; k < ch.length; k += 3) body.push(ch[k] | (ch[k + 1] << 7) | (ch[k + 2] << 14)); }
      else { const dg = Array.from(pg.text, (c) => Math.max(0, NUM.indexOf(c))); while (dg.length % 5) dg.push(10); for (let k = 0; k < dg.length; k += 5) body.push(dg[k] | (dg[k + 1] << 4) | (dg[k + 2] << 8) | (dg[k + 3] << 12) | (dg[k + 4] << 16)); }
      words[v0 + i] = flexCw(((pg.alpha ? 5 : 3) << 4) | (at << 7) | (body.length << 14));
      body.forEach((d, k) => { if (at + k < 88) words[at + k] = flexCw(d); });
      at += body.length;
    });
    const out = [];
    for (let i = 0; i < 64; i += 1) out.push(i & 1 ? 0 : 1);
    bitsPut(out, 32, FLEX_A); bitsPut(out, 16, 0x5555); bitsPut(out, 32, ~FLEX_A >>> 0); bitsPut(out, 32, flexCw((cycle << 4) | (frameNo << 8)));
    for (let b = 0; b < 11; b += 1) for (let i = 0; i < 32; i += 1) for (let w = 0; w < 8; w += 1) out.push((words[b * 8 + w] >>> (31 - i)) & 1);
    for (let i = 0; i < 16; i += 1) out.push(i & 1);
    return out;
  }

  // ---- DFM radiosondes: 2500 chip/s Manchester FSK, Hamming(8,4) codewords, 7x8 / 13x8 interleave
  const DFM_SYNC = 0x45cf;
  const DFM_MAN = (() => { let v = 0; for (let i = 15; i >= 0; i -= 1) v = ((v << 2) | ((DFM_SYNC >> i) & 1 ? 2 : 1)) >>> 0; return v; })();
  const { hamEnc, hamDec } = P2.util;
  class Dfm {
    constructor() { this.reg = 0; this.col = null; this.st = new Map(); }
    chip(c) {
      if (this.col) { this.col.push(c); if (this.col.length === 560) { const ch = this.col; this.col = null; this.frame(ch); } return; }
      this.reg = ((this.reg << 1) | c) >>> 0;
      if (this.reg === DFM_MAN) this.col = [];
    }
    frame(chips) {
      const bits = []; for (let i = 0; i + 1 < chips.length; i += 2) bits.push(chips[i] && !chips[i + 1] ? 1 : 0);
      const block = (s, n) => { const cws = Array.from({ length: n }, () => []); for (let k = 0; k < n * 8; k += 1) cws[k % n].push(bits[s + k]); return cws.map(hamDec); };
      const conf = block(0, 7);
      if (conf[6] !== 6) { H.crcFail += 1; return; }
      const serial = "D" + (((conf[0] << 20) | (conf[1] << 16) | (conf[2] << 12) | (conf[3] << 8) | (conf[4] << 4) | conf[5]) >>> 0);
      const s = this.st.get(serial) || { serial }; this.st.set(serial, s);
      for (const d of [block(56, 13), block(160, 13)]) {
        const type = d[12]; let hi = 0; for (let i = 0; i < 8; i += 1) hi = hi * 16 + d[i]; let lo = 0; for (let i = 8; i < 12; i += 1) lo = lo * 16 + d[i];
        const i32 = hi > 0x7fffffff ? hi - 0x100000000 : hi, i16 = lo > 0x7fff ? lo - 0x10000 : lo;
        if (type === 2) { s.lat = i32 / 1e7; s.hs = lo / 100; } else if (type === 3) { s.lon = i32 / 1e7; s.dir = lo / 100; } else if (type === 4) { s.alt = i32 / 100; s.vU = i16 / 100; } else if (type === 1) s.frame = hi & 0xffff;
      }
      if (Number.isFinite(s.hs) && Number.isFinite(s.dir)) { s.vE = s.hs * Math.sin((s.dir * Math.PI) / 180); s.vN = s.hs * Math.cos((s.dir * Math.PI) / 180); }
      if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && Number.isFinite(s.alt)) { H.packets.dfm += 1; H.packets.sonde += 1; post({ t: "sonde", msg: { serial, type: "DFM", lat: s.lat, lon: s.lon, alt: s.alt, vE: s.vE, vN: s.vN, vU: s.vU, frame: s.frame } }); }
    }
  }
  function dfmEncode(sd, sub) {
    const bits = []; bitsPut(bits, 16, DFM_SYNC);
    const inter = (nibs) => { const cws = nibs.map((n) => hamEnc(n, 8)), n = nibs.length, out = []; for (let k = 0; k < n * 8; k += 1) out.push(cws[k % n][Math.floor(k / n)]); return out; };
    const id = sd.id;
    bits.push(...inter([(id >> 20) & 15, (id >> 16) & 15, (id >> 12) & 15, (id >> 8) & 15, (id >> 4) & 15, id & 15, 6]));
    const dat = (type, v32, v16) => { const u32 = v32 < 0 ? v32 + 0x100000000 : v32, u16 = v16 < 0 ? v16 + 0x10000 : v16, nibs = []; for (let i = 7; i >= 0; i -= 1) nibs.push(Math.floor(u32 / 16 ** i) % 16); for (let i = 3; i >= 0; i -= 1) nibs.push(Math.floor(u16 / 16 ** i) % 16); nibs.push(type); return inter(nibs); };
    const hs = Math.hypot(sd.vE, sd.vN), dir = ((Math.atan2(sd.vE, sd.vN) * 180) / Math.PI + 360) % 360;
    const fr = [dat(2, Math.round(sd.lat * 1e7), Math.round(hs * 100)), dat(3, Math.round(sd.lon * 1e7), Math.round(dir * 100)), dat(4, Math.round(sd.alt * 100), Math.round(sd.vU * 100)), dat(1, sd.frame, 0)];
    bits.push(...fr[(sub * 2) % 4], ...fr[(sub * 2 + 1) % 4], ...new Array(16).fill(0));
    const chips = []; for (let i = 0; i < 64; i += 1) chips.push(i & 1); for (const b of bits) chips.push(b ? 1 : 0, b ? 0 : 1);
    return chips;
  }

  // ---- RS41 PTU: temperature from the main sensor + references with calibration fragments; approximate humidity
  const cal = new Map();
  P2.rs41Block = function (id, f, p, len, out) {
    if (id === 0x79 && len >= 0x28) {
      const serial = String.fromCharCode(...f.subarray(p + 4, p + 12)).replace(/[^\x20-\x7e]/g, "").trim();
      const frag = f[p + 2 + 23];
      if (frag < 51) { let c = cal.get(serial); if (!c) { c = { bytes: new Uint8Array(51 * 16), have: new Uint8Array(51) }; cal.set(serial, c); } c.bytes.set(f.subarray(p + 2 + 24, p + 2 + 40), frag * 16); c.have[frag] = 1; }
      out._serial = serial;
    } else if (id === 0x7a && len >= 0x2a) {
      const m = (k) => f[p + 2 + k] | (f[p + 3 + k] << 8) | (f[p + 4 + k] << 16);
      out._ptu = { t: m(0), t1: m(3), t2: m(6), h: m(9), h1: m(12), h2: m(15) };
    }
  };
  P2.rs41Finish = function (out) {
    const c = out._serial && cal.get(out._serial), m = out._ptu;
    delete out._serial; delete out._ptu;
    if (!c || !m || !m.t) return;
    if (![3, 4, 5, 6].every((i) => c.have[i])) { out.ptu = "calibrating"; return; }
    const dv = new DataView(c.bytes.buffer), fl = (o) => dv.getFloat32(o, true);
    const Rf1 = fl(0x3d), Rf2 = fl(0x41), co = [fl(0x4d), fl(0x51), fl(0x55)], ct = [fl(0x59), fl(0x5d), fl(0x61)];
    const g = (m.t2 - m.t1) / (Rf2 - Rf1), Rb = (m.t1 * Rf2 - m.t2 * Rf1) / (m.t2 - m.t1), R = (m.t / g - Rb) * ct[0];
    const T = (co[0] + co[1] * R + co[2] * R * R + ct[1]) * (1 + ct[2]);
    if (Number.isFinite(T) && T > -100 && T < 60) out.tempC = Math.round(T * 10) / 10;
    const fh = (m.h - m.h1) / (m.h2 - m.h1), rh = 100 * ((350 / fl(0x48)) * fh - 7.5);
    if (Number.isFinite(rh)) out.rh = Math.max(0, Math.min(100, Math.round(rh)));
  };
  const SIMCAL = (() => { const b = new Uint8Array(51 * 16), dv = new DataView(b.buffer); dv.setFloat32(0x3d, 750, true); dv.setFloat32(0x41, 1100, true); dv.setFloat32(0x48, 46, true); dv.setFloat32(0x4d, -243.9, true); dv.setFloat32(0x51, 0.187, true); dv.setFloat32(0x55, 8.2e-5, true); dv.setFloat32(0x59, 1, true); return b; })();
  P2.rs41Sim = function (sd, f, block) { // QA test signal: rewrite the 0x79 block with a calibration fragment and add PTU values
    const frag = 3 + (sd.frame % 4);
    block(0x39, 0x79, 0x28, (dv) => { dv.setUint16(0, sd.frame & 0xffff, true); for (let i = 0; i < 8; i += 1) dv.setUint8(2 + i, sd.serial.charCodeAt(i)); dv.setUint8(10, 28); dv.setUint8(23, frag); for (let i = 0; i < 16; i += 1) dv.setUint8(24 + i, SIMCAL[frag * 16 + i]); });
    const T = sd.alt < 11000 ? 15 - 0.0065 * sd.alt : -56.5, co = [-243.9, 0.187, 8.2e-5];
    const R = (-co[1] + Math.sqrt(co[1] * co[1] - 4 * co[2] * (co[0] - T))) / (2 * co[2]);
    const f1 = 300000, f2 = 440000, g = (f2 - f1) / 350, Rb = (f1 * 1100 - f2 * 750) / (f2 - f1);
    const h1 = 200000, h2 = 300000, fh = (0.48 + 7.5) / (350 / 46);
    block(0x65, 0x7a, 0x2a, (dv) => { const put = (o, v) => { v = Math.round(v); dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); }; put(0, g * (R + Rb)); put(3, f1); put(6, f2); put(9, h1 + fh * (h2 - h1)); put(12, h1); put(15, h2); });
  };
  P2.sensors = { OokMulti, scmEncode, tpmsBEncode, ev1527Encode, wh2Encode, Flex, flexEncode, Dfm, dfmEncode };
})();

// ==================================================================== ACARS (AM tones), VDL2 frames, BLE adverts, EOT/HOT, Z-Wave
(function () {
  const P2 = self.P2, { hex, pop32, bitsVal, bytesOfBits, crc16, Dec } = P2.util;
  // Two-tone detector (sliding complex correlators) + bit clock: mark tone -> 1.
  class ToneDem {
    constructor(fs, fMark, fSpace, baud, onBit, scale) {
      this.fs = fs; this.N = Math.max(4, Math.round(fs / baud)); this.wm = (TAU * fMark) / fs; this.ws = (TAU * fSpace) / fs; this.scale = scale || 1;
      this.buf = new Float32Array(this.N * 4); this.p = 0; this.sm = [0, 0, 0, 0]; this.k = 0;
      this.slicer = new Slicer(fs / baud, onBit, 0.25);
    }
    run(x, n) {
      const N = this.N;
      for (let i = 0; i < n; i += 1) {
        const t = this.k++, v = x[i] * this.scale;
        const a = v * Math.cos(this.wm * t), b = v * Math.sin(this.wm * t), c = v * Math.cos(this.ws * t), d = v * Math.sin(this.ws * t);
        const q = this.p * 4;
        this.sm[0] += a - this.buf[q]; this.sm[1] += b - this.buf[q + 1]; this.sm[2] += c - this.buf[q + 2]; this.sm[3] += d - this.buf[q + 3];
        this.buf[q] = a; this.buf[q + 1] = b; this.buf[q + 2] = c; this.buf[q + 3] = d;
        this.p = (this.p + 1) % N;
        this.slicer.push(this.sm[0] * this.sm[0] + this.sm[1] * this.sm[1] - this.sm[2] * this.sm[2] - this.sm[3] * this.sm[3]);
      }
      if (this.k > 1e9) { this.k = 0; this.sm = [0, 0, 0, 0]; this.buf.fill(0); }
    }
  }
  // ---- ACARS: 2400 bps, 7-bit chars + odd parity, LSB first; BCS = CRC-16 (0x8408 reflected)
  const par = (c) => (c & 0x7f) | (pop32(c & 0x7f) & 1 ? 0 : 0x80);
  const ACARS_SYNC = (par(0x2b) | (par(0x2a) << 8) | (par(0x16) << 16) | (par(0x16) << 24)) >>> 0;
  function acarsParse(raw, freq) { // raw: bytes from SOH onward as sent (with parity)
    if ((raw[0] & 0x7f) !== 1) return null;
    let e = -1; for (let i = 13; i < raw.length; i += 1) if ((raw[i] & 0x7f) === 3 || (raw[i] & 0x7f) === 0x17) { e = i; break; }
    if (e < 0 || e + 2 >= raw.length) return null;
    for (let i = 1; i <= e; i += 1) if (!(pop32(raw[i]) & 1)) return null;
    const bcs = raw[e + 1] | (raw[e + 2] << 8);
    if (crc16(raw, 1, e, 0x8408, 0, true) !== bcs) { H.crcFail += 1; return null; }
    const s = Array.from(raw.subarray(1, e), (c) => String.fromCharCode(c & 0x7f)).join("");
    const msg = { proto: "ACARS", mode: s[0], reg: s.slice(1, 8).replace(/^\.+/, "").trim(), ack: s[8], label: s.slice(9, 11), block: s[11], text: "", freq };
    const body = s.indexOf("\x02") >= 0 ? s.slice(s.indexOf("\x02") + 1) : "";
    if (/[0-9]/.test(msg.block) && body.length >= 10) { msg.msn = body.slice(0, 4); msg.flight = body.slice(4, 10).trim(); msg.text = body.slice(10); } else msg.text = body;
    msg.text = msg.text.replace(/[\x00-\x1f]/g, " ").trim().slice(0, 400);
    const pm = /POS([NS])(\d{2})(\d{3})([EW])(\d{3})(\d{3})/.exec(msg.text);
    if (pm) { msg.lat = (pm[1] === "S" ? -1 : 1) * (Number(pm[2]) + Number(pm[3]) / 600); msg.lon = (pm[4] === "W" ? -1 : 1) * (Number(pm[5]) + Number(pm[6]) / 600); const am = /,(\d{3,5}),/.exec(msg.text.slice(pm.index)); if (am) msg.alt = Number(am[1]) * (am[1].length <= 3 ? 100 : 1); }
    return msg;
  }
  class Acars {
    constructor(fs, freq) { this.freq = freq; this.reg = 0; this.col = null; this.td = new ToneDem(fs, 2400, 1200, 2400, (b) => this.bit(b), 8); this.dc = 0; this.x = new Float32Array(0); }
    am(re, im, n) {
      if (this.x.length < n) this.x = new Float32Array(n);
      for (let i = 0; i < n; i += 1) { const m = Math.hypot(re[i], im[i]); this.dc += (m - this.dc) * 0.002; this.x[i] = m - this.dc; }
      this.td.run(this.x, n);
    }
    bit(b) {
      if (this.col) {
        const c = this.col; if (b) c.cur |= 1 << c.nb; c.nb += 1;
        if (c.nb === 8) { c.bytes.push(c.cur); c.cur = 0; c.nb = 0; if ((c.cur === 0x7f && c.bytes.length > 14) || c.bytes.length >= 240 || (c.bytes.length > 16 && c.bytes[c.bytes.length - 1] === 0x7f)) this.done(); }
        return;
      }
      this.reg = ((this.reg >>> 1) | (b << 31)) >>> 0;
      if (this.reg === ACARS_SYNC) this.col = { bytes: [], cur: 0, nb: 0 };
    }
    done() {
      const raw = Uint8Array.from(this.col.bytes); this.col = null;
      const msg = acarsParse(raw, this.freq);
      if (msg) { H.packets.acars += 1; post({ t: "acars", msg }); }
    }
  }
  function acarsEncode(m) {
    const txt = m.mode + (m.reg + "       ").slice(0, 7) + "\x15" + m.label + m.block + "\x02" + (m.msn || "M01A") + (m.flight + "      ").slice(0, 6) + m.text + "\x03";
    const body = Array.from(txt, (c) => par(c.charCodeAt(0)));
    const raw = [par(1), ...body];
    const bcs = crc16(Uint8Array.from(raw), 1, raw.length - 1, 0x8408, 0, true);
    const all = [...new Array(16).fill(0xff), par(0x2b), par(0x2a), par(0x16), par(0x16), ...raw, bcs & 255, bcs >> 8, 0x7f, 0x7f];
    const bits = []; for (const by of all) for (let k = 0; k < 8; k += 1) bits.push((by >> k) & 1);
    return bits;
  }
  function acarsEmission(start, bits, offset, amp) {
    const fs = S.rate, sps = fs / 2400; let tone = 0, phase = Math.random() * TAU;
    return { start, len: Math.ceil(bits.length * sps), next: (k) => { const b = bits[Math.min(bits.length - 1, Math.floor(k / sps))]; tone += (TAU * (b ? 2400 : 1200)) / fs; phase += (TAU * offset) / fs; const a = amp * (1 + 0.7 * Math.sin(tone)); return [a * Math.cos(phase), a * Math.sin(phase)]; } };
  }
  // ---- VDL2 AVLC (frame level: the D8PSK physical layer is not demodulated in Phase 2)
  function avlcAddr(b, o) { const a = (b[o] >> 1) | ((b[o + 1] >> 1) << 7) | ((b[o + 2] >> 1) << 14) | ((b[o + 3] >> 1) << 21); return { type: (a >>> 24) & 7, addr: hex(a & 0xffffff, 6) }; }
  function vdl2Frame(b, freq) {
    if (b.length < 11) return null;
    const dst = avlcAddr(b, 0), src = avlcAddr(b, 4), ctl = b[8];
    const msg = { proto: "VDL2", freq, src: src.addr, srcType: src.type === 4 ? "Ground station" : src.type === 1 ? "Aircraft" : "Other", dst: dst.addr, ctl: hex(ctl, 2) };
    if ((ctl & 0xef) === 0xaf && b[9] === 0x82) { // XID with VDL parameter group
      msg.xid = true; let o = 11; const end = Math.min(b.length, 11 + b[10]);
      while (o + 2 <= end) { const id = b[o], len = b[o + 1], v = b.subarray(o + 2, o + 2 + len); if (id === 0x83 && len === 3) { let la = (v[0] << 4) | (v[1] >> 4), lo = ((v[1] & 15) << 8) | v[2]; if (la & 0x800) la -= 0x1000; if (lo & 0x800) lo -= 0x1000; msg.gsLat = la / 10; msg.gsLon = lo / 10; } else if (id === 0x84) msg.gsName = Array.from(v, (c) => String.fromCharCode(c)).join(""); o += 2 + len; }
    } else if (ctl === 0x03 && b[9] === 0xff && b[10] === 0xff && b[11] === 0x01) {
      const ac = acarsParse(b.subarray(11), freq); if (ac) Object.assign(msg, ac, { proto: "VDL2", acars: true });
    }
    H.packets.vdl2 += 1;
    return msg;
  }
  function vdl2Encode(src, srcType, dst, dstType, kind, data) {
    const addr = (a, t) => { const v = ((t & 7) << 24) | (a & 0xffffff); return [(v & 127) << 1, ((v >> 7) & 127) << 1, ((v >> 14) & 127) << 1, (((v >> 21) & 127) << 1) | 1]; };
    const out = [...addr(dst, dstType), ...addr(src, srcType)];
    if (kind === "xid") { let la = Math.round(data.lat * 10), lo = Math.round(data.lon * 10); if (la < 0) la += 0x1000; if (lo < 0) lo += 0x1000; const nm = Array.from(data.name, (c) => c.charCodeAt(0)); const params = [0x83, 3, la >> 4, ((la & 15) << 4) | (lo >> 8), lo & 255, 0x84, nm.length, ...nm]; out.push(0xbf, 0x82, params.length, ...params); }
    else { const bits = acarsEncode(data), bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bitsVal(bits.slice(i, i + 8).reverse(), 0, 8)); out.push(0x03, 0xff, 0xff, ...bytes.slice(20)); }
    return Uint8Array.from(out);
  }
  // ---- BLE advertising on channel 37/38/39 (1 Mbps GFSK); HackRF only (2.4 GHz)
  const BLE_AA = 0x8e89bed6;
  const rev8 = (b) => { let r = 0; for (let i = 0; i < 8; i += 1) r |= ((b >> i) & 1) << (7 - i); return r; };
  function bleWhiten(bytes, chan) { let l = rev8(chan) | 2; const out = Uint8Array.from(bytes); for (let i = 0; i < out.length; i += 1) for (let b = 0; b < 8; b += 1) { if (l & 0x80) { l ^= 0x11; out[i] ^= 1 << b; } l = (l << 1) & 0xff; } return out; }
  function bleCrc(bytes) { let c = 0xaaaaaa; for (const by of bytes) for (let b = 0; b < 8; b += 1) { const t = (c ^ (by >> b)) & 1; c >>>= 1; if (t) c ^= 0xda6000; } return c; }
  const COMPANY = { 0x004c: "Apple", 0x0006: "Microsoft", 0x0075: "Samsung", 0x00e0: "Google", 0x0059: "Nordic Semiconductor", 0x0087: "Garmin", 0x0157: "Huami", 0x038f: "Xiaomi", 0x02e5: "Espressif", 0x0499: "Ruuvi", 0x0822: "Tile" };
  const ADV = ["ADV_IND", "ADV_DIRECT_IND", "ADV_NONCONN_IND", "SCAN_REQ", "SCAN_RSP", "CONNECT_IND", "ADV_SCAN_IND"];
  class Ble {
    constructor(fs, offset, chan) { this.chan = chan; this.dec = new Dec(fs, offset, 2e6, 750e3, 31); this.pr = 1; this.pi = 0; this.ph = [{ reg: 0, col: null }, { reg: 0, col: null }]; this.k = 0; this.pk = 0; }
    run(f, n) {
      const m = this.dec.run(f, n), re = this.dec.or, im = this.dec.oi;
      let pr = this.pr, pi = this.pi;
      for (let i = 0; i < m; i += 1) {
        const r = re[i], q = im[i], d = Math.atan2(q * pr - r * pi, r * pr + q * pi); pr = r; pi = q;
        const P = this.ph[this.k & 1]; this.k += 1;
        const b = d > 0 ? 1 : 0;
        if (P.col) { P.col.bits.push(b); if (P.col.p < r * r + q * q) P.col.p = r * r + q * q; if (P.col.bits.length === 16) P.col.need = 16 + 8 * (bleWhiten(bytesOfBits(P.col.bits, 0, 2, true), this.chan)[1] & 63) + 24; if (P.col.need && P.col.bits.length >= P.col.need) { this.frame(P.col); P.col = null; } continue; }
        P.reg = ((P.reg >>> 1) | (b << 31)) >>> 0;
        if (P.reg === BLE_AA) { P.col = { bits: [], need: 0, p: 0 }; const o = this.ph[this.k & 1]; o.col = null; o.reg = 0; }
      }
      this.pr = pr; this.pi = pi;
    }
    frame(c) {
      const nb = c.need / 8, by = bleWhiten(bytesOfBits(c.bits, 0, nb, true), this.chan), len = by[1] & 63;
      const crc = by[2 + len] | (by[3 + len] << 8) | (by[4 + len] << 16);
      if (bleCrc(by.subarray(0, 2 + len)) !== crc) { H.crcFail += 1; return; }
      const msg = bleParse(by.subarray(0, 2 + len));
      msg.rssi = Math.round(10 * Math.log10(c.p + 1e-12)); msg.chan = this.chan;
      H.packets.ble += 1; post({ t: "ble", msg });
    }
  }
  function bleParse(pdu) {
    const type = pdu[0] & 15, len = pdu[1] & 63, p = pdu.subarray(2, 2 + len);
    const msg = { pdu: ADV[type] || "type " + type, addr: Array.from(p.subarray(0, 6)).reverse().map((v) => hex(v, 2)).join(":"), random: Boolean(pdu[0] & 0x40) };
    let o = 6;
    while (o < p.length) { const l = p[o]; if (!l || o + 1 + l > p.length) break; const t = p[o + 1], d = p.subarray(o + 2, o + 1 + l); if (t === 8 || t === 9) msg.name = Array.from(d, (x) => String.fromCharCode(x)).join("").replace(/[^\x20-\x7e]/g, ""); else if (t === 0x0a) msg.txPower = (d[0] << 24) >> 24; else if (t === 0xff && d.length >= 2) { const id = d[0] | (d[1] << 8); msg.company = COMPANY[id] || "0x" + hex(id, 4); if (id === 0x004c && d[2] === 0x12) msg.tag = "Apple Find My"; if (id === 0x004c && d[2] === 0x02) msg.tag = "iBeacon"; } else if (t === 3 && d.length >= 2) { const u = d[0] | (d[1] << 8); msg.service = "0x" + hex(u, 4); if (u === 0xfd5a) msg.tag = "Samsung SmartTag"; if (u === 0xfeed || u === 0xfeec) msg.tag = "Tile"; } o += 1 + l; }
    return msg;
  }
  function bleEncode(d, chan) {
    const ads = [2, 1, 6];
    if (d.name) { const nm = Array.from(d.name, (c) => c.charCodeAt(0)); ads.push(nm.length + 1, 9, ...nm); }
    if (d.company != null) ads.push(3 + (d.mfg || []).length, 0xff, d.company & 255, d.company >> 8, ...(d.mfg || []));
    if (d.tx != null) ads.push(2, 0x0a, d.tx & 255);
    const pl = [...d.addr.slice().reverse(), ...ads], pdu = Uint8Array.from([0x40 | (d.type || 0), pl.length, ...pl]);
    const crc = bleCrc(pdu), wh = bleWhiten(Uint8Array.from([...pdu, crc & 255, (crc >> 8) & 255, crc >> 16]), chan);
    const bits = []; for (const by of [0xaa, 0xd6, 0xbe, 0x89, 0x8e, ...wh]) for (let k = 0; k < 8; k += 1) bits.push((by >> k) & 1);
    return bits;
  }
  // ---- EOT / HOT train telemetry: 1200 bps FSK (1200 / 1800 Hz) on NFM, 11-bit sync, BCH(63,45)
  const BCH63 = (() => { const exp = [], log = []; let x = 1; for (let i = 0; i < 63; i += 1) { exp[i] = x; log[x] = i; x <<= 1; if (x & 64) x ^= 0x43; } const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 63] : 0); let g = [1]; const done = new Set(); for (const r0 of [1, 3, 5]) { let r = r0; const conj = []; while (!done.has(r)) { done.add(r); conj.push(r); r = (r * 2) % 63; } for (const c of conj) { const root = exp[c], ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j += 1) { ng[j] ^= mul(g[j], root); ng[j + 1] ^= g[j]; } g = ng; } } return g.map((v) => v & 1); })(); // g[i] = coefficient of x^i, degree 18
  function bch63Rem(bits45) { const r = bits45.concat(new Array(18).fill(0)); for (let i = 0; i < 45; i += 1) if (r[i]) for (let j = 0; j <= 18; j += 1) r[i + j] ^= BCH63[18 - j]; return r.slice(45); }
  const EOT_FIELDS = [["chain", 2], ["battCond", 2], ["type", 3], ["unit", 17], ["psi", 7], ["charge", 7], ["s1", 1], ["valve", 1], ["confirm", 1], ["s2", 1], ["motion", 1], ["mkrBatt", 1], ["mkrLight", 1]];
  class Eot {
    constructor(fs, kind) { this.kind = kind; this.reg = 0; this.col = null; this.td = new ToneDem(fs, 1200, 1800, 1200, (b) => this.bit(b), 1 / 3000); }
    bit(b) {
      if (this.col) { this.col.push(b); if (this.col.length === 63) { const c = this.col; this.col = null; this.frame(c); } return; }
      this.reg = ((this.reg << 1) | b) & 0x7ff;
      if (this.reg === 0x48d) this.col = [];
    }
    frame(bits) {
      const rem = bch63Rem(bits.slice(0, 45));
      if (rem.some((v, i) => v !== bits[45 + i])) { H.crcFail += 1; return; }
      const f = {}; let o = 0; for (const [k, l] of EOT_FIELDS) { let v = 0; for (let i = 0; i < l; i += 1) v |= bits[o + i] << i; f[k] = v; o += l; }
      const msg = { kind: this.kind, unit: f.unit, psi: f.psi, charge: f.charge, battery: ["OK", "Weak", "Very weak", "Not monitored"][f.battCond], motion: Boolean(f.motion), markerLight: Boolean(f.mkrLight), valve: f.valve ? "OK" : "Fault", type: f.type };
      H.packets.eot += 1; post({ t: "eot", msg });
    }
  }
  function eotEncode(e) {
    const f = { chain: 3, battCond: 0, type: e.type || 1, unit: e.unit, psi: e.psi, charge: e.charge, s1: 0, valve: 1, confirm: 0, s2: 0, motion: e.motion ? 1 : 0, mkrBatt: 1, mkrLight: e.light ? 1 : 0 };
    const data = []; for (const [k, l] of EOT_FIELDS) for (let i = 0; i < l; i += 1) data.push((f[k] >> i) & 1);
    const bits = []; for (let i = 0; i < 69; i += 1) bits.push(i & 1 ? 0 : 1);
    bitsPut(bits, 11, 0x48d);
    return bits.concat(data, bch63Rem(data), [0, 1, 0, 1]);
  }
  function eotEmission(start, bits, offset, amp) {
    const fs = S.rate, sps = fs / 1200; let tone = 0, phase = Math.random() * TAU;
    return { start, len: Math.ceil(bits.length * sps), next: (k) => { const b = bits[Math.min(bits.length - 1, Math.floor(k / sps))]; tone += (TAU * (b ? 1200 : 1800)) / fs; phase += (TAU * (offset + 3000 * Math.sin(tone))) / fs; return [amp * Math.cos(phase), amp * Math.sin(phase)]; } };
  }
  // ---- Z-Wave R1 (9.6 kbps Manchester FSK at 908.42 / 868.42 / 916 MHz)
  const ZW_SOF = (() => { let v = 0; for (const by of [0x55, 0xf0]) for (let i = 7; i >= 0; i -= 1) v = ((v << 2) | ((by >> i) & 1 ? 2 : 1)) >>> 0; return v; })();
  class Zwave {
    constructor() { this.reg = 0; this.col = null; }
    chip(c) {
      if (this.col) { this.col.push(c); if (this.col.length === 16 * 9) { this.col.need = 9; } if (this.col.length >= 16 * 9 && !this.col.len) { const b = this.bytes(9); this.col.len = b[7]; if (this.col.len < 10 || this.col.len > 64) { this.col = null; return; } } if (this.col && this.col.len && this.col.length >= this.col.len * 16) { const by = this.bytes(this.col.len); this.col = null; this.frame(by); } return; }
      this.reg = ((this.reg << 1) | c) >>> 0;
      if (this.reg === ZW_SOF) this.col = [];
    }
    bytes(n) { const c = this.col, out = new Uint8Array(n); for (let i = 0; i < n * 8; i += 1) if (c[2 * i] && !c[2 * i + 1]) out[i >> 3] |= 0x80 >> (i & 7); return out; }
    frame(b) {
      let x = 0xff; for (let i = 0; i < b.length - 1; i += 1) x ^= b[i];
      if (x !== b[b.length - 1]) { H.crcFail += 1; return; }
      const home = hex(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0, 8), hdr = b[5] & 15;
      H.packets.zwave += 1;
      post({ t: "device", msg: { kind: "Z-Wave", fmt: "R1 9.6k", id: home, detail: "node " + b[4] + " → " + b[8] + (hdr === 3 ? " (ack)" : hdr === 2 ? " (multicast)" : ""), cmd: b.length > 10 ? hex(b[9], 2) : "" } });
    }
  }
  function zwaveEncode(z) {
    const body = [(z.home >>> 24) & 255, (z.home >>> 16) & 255, (z.home >>> 8) & 255, z.home & 255, z.src, 0x41, 0x01, 0, z.dst, ...z.payload];
    body[7] = body.length + 1;
    let x = 0xff; for (const v of body) x ^= v; body.push(x);
    const chips = []; for (const by of [0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xf0, ...body, 0]) for (let i = 7; i >= 0; i -= 1) { const b = (by >> i) & 1; chips.push(b, b ^ 1); }
    return chips;
  }
  P2.air = { ToneDem, Acars, acarsParse, acarsEncode, acarsEmission, vdl2Frame, vdl2Encode, Ble, bleParse, bleEncode, Eot, eotEncode, eotEmission, Zwave, zwaveEncode };
})();

// ==================================================================== LTE PSS + CMAS, ATSC pilot, HD Radio sidebands + SIS, FT8/JS8, dispatch GPS, activity
(function () {
  const P2 = self.P2, { cfft, hex, Dec, bitsVal } = P2.util;
  // ---- LTE: real primary sync signal search (Zadoff-Chu roots 25/29/34) over 10 ms, once a second
  function pssTime(root, n) { // time-domain PSS at n-point IFFT (n = 128 at 1.92 MS/s)
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < 62; k += 1) { const m = k < 31 ? k : k + 1, ph = (-Math.PI * root * m * (m + 1)) / 63, sc = k - 31 + (k >= 31 ? 1 : 0), bin = (sc + n) % n; re[bin] = Math.cos(ph); im[bin] = Math.sin(ph); }
    for (let i = 0; i < n; i += 1) im[i] = -im[i];
    cfft(re, im);
    const s = 1 / Math.sqrt(62), r = new Float32Array(n), q = new Float32Array(n);
    for (let i = 0; i < n; i += 1) { r[i] = re[i] * s; q[i] = -im[i] * s; }
    return [r, q];
  }
  const PSS = [25, 29, 34].map((u) => pssTime(u, 128));
  class Lte {
    constructor(fs, freq) { this.freq = freq; this.dec = new Dec(fs, 0, 1.92e6, 0.6e6, 31); this.br = new Float32Array(19200 + 256); this.bi = new Float32Array(19200 + 256); this.n = 0; this.skip = 0; this.fs = this.dec.fs2; }
    run(f, n) {
      const m = this.dec.run(f, n);
      if (this.skip > 0) { this.skip -= m; return; }
      const take = Math.min(m, this.br.length - this.n);
      this.br.set(this.dec.or.subarray(0, take), this.n); this.bi.set(this.dec.oi.subarray(0, take), this.n); this.n += take;
      if (this.n === this.br.length) { this.search(); this.n = 0; this.skip = Math.round(this.fs * 0.9); }
    }
    search() {
      const L = 19200, br = this.br, bi = this.bi;
      let energy = 0; for (let i = 0; i < L + 128; i += 1) energy += br[i] * br[i] + bi[i] * bi[i];
      const meanE = (energy / (L + 128)) * 128;
      let best = { r: -1, at: 0, v: 0 };
      for (let r = 0; r < 3; r += 1) {
        const [pr, pi] = PSS[r];
        for (let t = 0; t < L; t += 1) { let ar = 0, ai = 0; for (let k = 0; k < 128; k += 1) { const xr = br[t + k], xi = bi[t + k]; ar += xr * pr[k] + xi * pi[k]; ai += xi * pr[k] - xr * pi[k]; } const v = ar * ar + ai * ai; if (v > best.v) best = { r, at: t, v }; }
      }
      const score = best.v / (meanE + 1e-12);
      if (score > 0.25) { H.packets.lte += 1; post({ t: "lte", msg: { kind: "cell", freq: this.freq, nid2: best.r, score: Math.round(score * 100) / 100, offsetUs: Math.round((best.at / this.fs) * 1e6) } }); }
    }
  }
  // CMAS / ETWS page (frame level): GSM 7-bit text, optional WEA polygon (int32 lat/lon in 1e-5 degrees)
  const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  function gsm7Unpack(b, nChars) { let s = ""; for (let i = 0; i < nChars; i += 1) { const bit = i * 7, byte = bit >> 3, sh = bit & 7; const v = ((b[byte] >> sh) | ((b[byte + 1] || 0) << (8 - sh))) & 0x7f; s += GSM7[v] || "?"; } return s; }
  function gsm7Pack(s) { const v = Array.from(s, (c) => Math.max(0, GSM7.indexOf(c))), out = new Uint8Array(Math.ceil((v.length * 7) / 8)); v.forEach((x, i) => { const bit = i * 7, byte = bit >> 3, sh = bit & 7; out[byte] |= (x << sh) & 255; if (sh > 1) out[byte + 1] |= x >> (8 - sh); }); return out; }
  const CMAS = { 4370: "Presidential Alert", 4371: "Extreme Alert (immediate, observed)", 4372: "Extreme Alert (immediate, likely)", 4373: "Severe Alert", 4379: "AMBER Alert", 4380: "Required Monthly Test", 4352: "ETWS Earthquake", 4353: "ETWS Tsunami", 4383: "Public Safety Message", 4396: "State/Local Test" };
  function cmasFrame(b, freq) {
    const id = (b[0] << 8) | b[1], serial = (b[2] << 8) | b[3], nChars = b[4], text = gsm7Unpack(b.subarray(5), nChars);
    let o = 5 + Math.ceil((nChars * 7) / 8); const poly = [];
    if (b[o] === 0xa0) { const n = b[o + 1]; o += 2; const dv = new DataView(b.buffer, b.byteOffset); for (let i = 0; i < n && o + 8 <= b.length; i += 1, o += 8) poly.push([dv.getInt32(o) / 1e5, dv.getInt32(o + 4) / 1e5]); }
    H.packets.lte += 1;
    return { kind: "alert", freq, msgId: id, category: CMAS[id] || "Cell broadcast " + id, serial: hex(serial, 4), text: text.trim().slice(0, 360), poly };
  }
  function cmasEncode(id, serial, text, poly) {
    const t = gsm7Pack(text), out = [id >> 8, id & 255, serial >> 8, serial & 255, text.length, ...t];
    if (poly && poly.length) { out.push(0xa0, poly.length); for (const [la, lo] of poly) { const b = new DataView(new ArrayBuffer(8)); b.setInt32(0, Math.round(la * 1e5)); b.setInt32(4, Math.round(lo * 1e5)); out.push(...new Uint8Array(b.buffer)); } }
    return Uint8Array.from(out);
  }
  function lteEmission(start, root, secs, amp) { // PSS bursts every 5 ms plus OFDM-like filler, at S.rate
    const fs = S.rate, up = Math.round(fs / 1.92e6), n = 128 * up, [pr, pi] = pssTime(root, n), per = Math.round(fs * 0.005), len = Math.round(fs * secs);
    const fill = []; for (let i = 0; i < 40; i += 1) fill.push({ w: (TAU * ((i - 20) * 22000 + 7000)) / fs, ph: Math.random() * TAU });
    return { start, len, next: (k) => { const p = k % per; let r = 0, q = 0; if (p < n) { r = pr[p] * 0.9; q = pi[p] * 0.9; } else { for (let i = 0; i < fill.length; i += 4) { const f = fill[(i + (k >> 9)) % fill.length]; r += Math.cos(f.w * k + f.ph) * 0.05; q += Math.sin(f.w * k + f.ph) * 0.05; } } return [amp * r, amp * q]; } };
  }
  // ---- ATSC pilot + HD Radio sideband detection from the waterfall FFT (real), and the channel activity list
  const atscCh = (mhz) => (mhz >= 470 && mhz < 608 ? Math.floor((mhz - 470) / 6) + 14 : mhz >= 174 && mhz < 216 ? Math.floor((mhz - 174) / 6) + 7 : 0);
  let lastAct = 0, lastHd = 0, lastAtsc = 0;
  P2.onFft = function (db, band) {
    const n = db.length, bw = S.rate / n, binOf = (hz) => Math.round((hz - S.center) / bw + n / 2), now = Date.now();
    const avg = (a, b) => { let s = 0, c = 0; for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i += 1) { s += db[i]; c += 1; } return c ? s / c : -200; };
    const sorted = Array.from(db).sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.3)];
    if (now - lastAct > 900) {
      lastAct = now; const list = []; let i = 0;
      while (i < n) { if (db[i] > floor + 10) { let j = i, pk = i; while (j < n && db[j] > floor + 6) { if (db[j] > db[pk]) pk = j; j += 1; } list.push({ hz: Math.round(S.center + (pk - n / 2) * bw), db: Math.round(db[pk]), snr: Math.round(db[pk] - floor), bwHz: Math.round((j - i) * bw) }); i = j; } else i += 1; }
      list.sort((a, b) => b.snr - a.snr);
      post({ t: "act", list: list.slice(0, 24), floor: Math.round(floor), band });
    }
    if (band === "fm" && now - lastHd > 1500) {
      lastHd = now; const t = S.tuned;
      const up = avg(binOf(t + 135e3), binOf(t + 190e3)), lo = avg(binOf(t - 190e3), binOf(t - 135e3)), noise = Math.min(avg(binOf(t + 230e3), binOf(t + 270e3)), avg(binOf(t - 270e3), binOf(t - 230e3)));
      const on = up > noise + 6 && lo > noise + 6;
      if (on) H.packets.hd += 1;
      post({ t: "hdside", msg: { freq: t, on, upper: Math.round(up - noise), lower: Math.round(lo - noise) } });
    }
    if (band === "atsc" && now - lastAtsc > 1500) {
      lastAtsc = now; const pb = binOf(S.tuned), pk = Math.max(db[pb - 1] || -200, db[pb], db[pb + 1] || -200);
      const above = avg(pb + 20, pb + 300), below = avg(pb - 120, pb - 40);
      const on = pk > above + 6 && above > below + 5;
      post({ t: "atsc", msg: { freq: S.tuned, channel: atscCh(S.tuned / 1e6 - 0.309441 + 0.01), on, pilot: Math.round(pk - floor), plateau: Math.round(above - below) } });
    }
  };
  function toneBand(start, secs, f0, f1, count, amp) { // multitone fill used by the QA signal for OFDM / 8VSB plateaus
    const fs = S.rate, tones = []; for (let i = 0; i < count; i += 1) tones.push({ w: (TAU * (f0 + ((f1 - f0) * (i + 0.5)) / count)) / fs, ph: Math.random() * TAU });
    return { start, len: Math.round(fs * secs), next: (k) => { let r = 0, q = 0; for (const t of tones) { const p = t.w * k + t.ph; r += Math.cos(p); q += Math.sin(p); } return [r * amp, q * amp]; } };
  }
  // HD Radio station information service (frame level): call sign, name, location (22-bit lat / 23-bit lon at 1/8192 deg)
  function sisFrame(b, freq) {
    const call = Array.from(b.subarray(0, 4), (c) => String.fromCharCode(c)).join("").trim(), nl = b[4];
    const name = Array.from(b.subarray(5, 5 + nl), (c) => String.fromCharCode(c)).join("");
    let o = 5 + nl; const v = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0, w = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    let la = v >>> 10, lo = w >>> 9; if (la & 0x200000) la -= 0x400000; if (lo & 0x400000) lo -= 0x800000;
    const progs = b[o + 8];
    H.packets.hd += 1;
    return { freq, call, name, lat: la / 8192, lon: lo / 8192, programs: progs };
  }
  function sisEncode(s) {
    const nm = Array.from(s.name, (c) => c.charCodeAt(0)); let la = Math.round(s.lat * 8192), lo = Math.round(s.lon * 8192); if (la < 0) la += 0x400000; if (lo < 0) lo += 0x800000;
    const v = la * 1024, w = lo * 512;
    return Uint8Array.from([...Array.from((s.call + "    ").slice(0, 4), (c) => c.charCodeAt(0)), nm.length, ...nm, v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255, w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, s.programs]);
  }
  // ---- FT8 77-bit standard message unpack (frame level) + Maidenhead grids; JS8 heartbeat text
  const C1 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", C2 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", C4 = " ABCDEFGHIJKLMNOPQRSTUVWXYZ", NT = 2063592, M22 = 4194304;
  function c28Unpack(n) {
    if (n === 0) return "DE"; if (n === 1) return "QRZ"; if (n === 2) return "CQ";
    if (n < NT + M22) return "<...>";
    let v = n - NT - M22; const c6 = v % 27; v = Math.floor(v / 27); const c5 = v % 27; v = Math.floor(v / 27); const c4 = v % 27; v = Math.floor(v / 27); const c3 = v % 10; v = Math.floor(v / 10); const c2 = v % 36; const c1 = Math.floor(v / 36);
    return (C1[c1] + C2[c2] + c3 + C4[c4] + C4[c5] + C4[c6]).trim();
  }
  function c28Pack(cs) {
    if (cs === "CQ") return 2;
    let s = cs.toUpperCase(); if (!/[0-9]/.test(s[2]) && /[0-9]/.test(s[1])) s = " " + s; s = (s + "      ").slice(0, 6);
    return NT + M22 + ((((C1.indexOf(s[0]) * 36 + C2.indexOf(s[1])) * 10 + Number(s[2])) * 27 + C4.indexOf(s[3])) * 27 + C4.indexOf(s[4])) * 27 + C4.indexOf(s[5]);
  }
  function gridLatLon(g) { if (!/^[A-R]{2}[0-9]{2}$/.test(g)) return null; return { lon: (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2 + 1, lat: (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]) + 0.5 }; }
  function ft8Unpack(bits, freq, snr) {
    const i3 = bitsVal(bits, 74, 3);
    if (i3 !== 1) return null;
    const to = c28Unpack(bitsVal(bits, 0, 28)), from = c28Unpack(bitsVal(bits, 29, 28)), R = bits[58], g15 = bitsVal(bits, 59, 15);
    const msg = { mode: "FT8", to, call: from, freq, snr };
    if (g15 < 32400) { const d2 = g15 % 10, d1 = Math.floor(g15 / 10) % 10, l2 = Math.floor(g15 / 100) % 18, l1 = Math.floor(g15 / 1800); msg.grid = String.fromCharCode(65 + l1, 65 + l2) + d1 + d2; Object.assign(msg, gridLatLon(msg.grid)); }
    else msg.report = (R ? "R" : "") + (g15 - 32400 - 35);
    msg.text = [to, from, msg.grid || msg.report].join(" ");
    H.packets.ft8 += 1;
    return msg;
  }
  function ft8Pack(to, from, grid) {
    const bits = []; bitsPut(bits, 28, c28Pack(to)); bits.push(0); bitsPut(bits, 28, c28Pack(from)); bits.push(0, 0);
    const g = ((grid.charCodeAt(0) - 65) * 18 + (grid.charCodeAt(1) - 65)) * 100 + Number(grid[2]) * 10 + Number(grid[3]);
    bitsPut(bits, 15, g); bitsPut(bits, 3, 1); return bits;
  }
  function js8Text(text, freq, snr) {
    const m = /^([A-Z0-9/]{3,10}):\s*(@\S+|\S+)?\s.*?\b([A-R]{2}[0-9]{2})\b/.exec(text);
    if (!m) return null;
    H.packets.ft8 += 1;
    return Object.assign({ mode: "JS8", call: m[1], to: m[2] || "", grid: m[3], text, freq, snr }, gridLatLon(m[3]));
  }
  // ---- Dispatch radio GPS (frame level): P25/DMR LRRP, TETRA LIP short location, NMEA RMC (NXDN / P25 GPS data)
  function lrrp(b) {
    const out = {}; let o = 0; const dv = new DataView(b.buffer, b.byteOffset, b.length);
    if (b[0] === 0x0d || b[0] === 0x0b) o = 2;
    while (o < b.length) {
      const t = b[o];
      if (t === 0x51 && o + 9 <= b.length) { out.lat = (dv.getInt32(o + 1) * 90) / 2147483648; out.lon = (dv.getInt32(o + 5) * 180) / 2147483648; o += 9; }
      else if (t === 0x66 && o + 11 <= b.length) { out.lat = (dv.getInt32(o + 1) * 90) / 2147483648; out.lon = (dv.getInt32(o + 5) * 180) / 2147483648; out.radius = dv.getUint16(o + 9); o += 11; }
      else if (t === 0x6c && o + 3 <= b.length) { out.speed = dv.getUint16(o + 1) / 128; o += 3; }
      else if (t === 0x56 && o + 2 <= b.length) { out.heading = b[o + 1] * 2; o += 2; }
      else if (t === 0x22 && o + 2 <= b.length) { o += 2 + b[o + 1]; }
      else o += 1;
    }
    return out;
  }
  function lrrpEncode(p) { const b = new DataView(new ArrayBuffer(16)); b.setUint8(0, 0x51); b.setInt32(1, Math.round((p.lat / 90) * 2147483648)); b.setInt32(5, Math.round((p.lon / 180) * 2147483648)); b.setUint8(9, 0x6c); b.setUint16(10, Math.round(p.speed * 128)); b.setUint8(12, 0x56); b.setUint8(13, Math.round(p.heading / 2)); return Uint8Array.from([0x0d, 14, ...new Uint8Array(b.buffer, 0, 14)]); }
  function lip(bits) {
    if (bitsVal(bits, 0, 2) !== 0) return null;
    let lon = bitsVal(bits, 4, 25), lat = bitsVal(bits, 29, 24); if (lon & 0x1000000) lon -= 0x2000000; if (lat & 0x800000) lat -= 0x1000000;
    const v = bitsVal(bits, 56, 7), dir = bitsVal(bits, 63, 4);
    return { lon: (lon * 360) / 33554432, lat: (lat * 180) / 16777216, speed: v < 28 ? v : Math.round(16 * Math.pow(1.038, v - 13)), heading: dir * 22.5 };
  }
  function lipEncode(p) { const bits = [0, 0, 0, 0]; let lon = Math.round((p.lon / 360) * 33554432), lat = Math.round((p.lat / 180) * 16777216); if (lon < 0) lon += 0x2000000; if (lat < 0) lat += 0x1000000; bitsPut(bits, 25, lon); bitsPut(bits, 24, lat); bitsPut(bits, 3, 2); bitsPut(bits, 7, Math.min(27, Math.round(p.speed))); bitsPut(bits, 4, Math.round(p.heading / 22.5) & 15); bits.push(0, 0, 0, 0, 0); return bits; }
  function rmc(s) {
    const f = s.split(","); if (!/RMC$/.test(f[0]) || f[2] !== "A") return null;
    const dm = (v, h, deg) => { const d = Number(v.slice(0, deg)), m = Number(v.slice(deg)); return (h === "S" || h === "W" ? -1 : 1) * (d + m / 60); };
    return { lat: dm(f[3], f[4], 2), lon: dm(f[5], f[6], 3), speed: Number(f[7]) || 0, heading: Number(f[8]) || 0 };
  }
  function rmcEncode(p) { const dm = (v, deg) => { const a = Math.abs(v), d = Math.floor(a); return String(d).padStart(deg, "0") + ((a - d) * 60).toFixed(4).padStart(7, "0"); }; return "$GPRMC,120000,A," + dm(p.lat, 2) + "," + (p.lat < 0 ? "S" : "N") + "," + dm(p.lon, 3) + "," + (p.lon < 0 ? "W" : "E") + "," + p.speed.toFixed(1) + "," + p.heading.toFixed(1) + ",271126,,,A*00"; }
  function dispatchFrame(proto, payload, meta) {
    let pos = null;
    if (proto === "P25" || proto === "DMR") pos = lrrp(payload);
    else if (proto === "TETRA") pos = lip(payload);
    else if (proto === "NXDN") pos = rmc(payload);
    if (!pos || !Number.isFinite(pos.lat)) return null;
    H.packets.dispatch += 1;
    return Object.assign({ proto, freq: S.tuned }, meta || {}, pos);
  }
  P2.cell = { pssTime, Lte, cmasFrame, cmasEncode, gsm7Pack, gsm7Unpack, lteEmission, toneBand, sisFrame, sisEncode, ft8Unpack, ft8Pack, js8Text, gridLatLon, c28Pack, c28Unpack, dispatchFrame, lrrpEncode, lipEncode, rmcEncode, atscCh };
})();

// ==================================================================== pipelines + QA entry points
(function () {
  const P2 = self.P2, U = P2.util, L = P2.lora, A = P2.air, Sn = P2.sensors, C = P2.cell;
  const bleChan = (mhz) => (Math.abs(mhz - 2402) < 0.5 ? 37 : Math.abs(mhz - 2426) < 0.5 ? 38 : Math.abs(mhz - 2480) < 0.5 ? 39 : mhz < 2426 ? Math.round((mhz - 2404) / 2) : Math.round((mhz - 2428) / 2) + 11);
  // Bands that run straight on the full-rate stream (no 240k / 48k channel).
  P2.raw = function (band, fs) {
    const off = S.tuned - S.center;
    if (band === "mesh") { const cfg = L.cfgFor(S.tuned), lr = new L.LoRa(fs, off, cfg); return { label: "LoRa " + cfg.name + " · SF" + cfg.sf + " / " + cfg.bw / 1e3 + " kHz", run: (f, n) => lr.run(f, n) }; }
    if (band === "uat") { const u = new P2.uat.Uat(); return { label: "UAT 978 · ADS-B + FIS-B uplinks", run: (f, n) => u.run(f, n) }; }
    if (band === "ble") { const ch = bleChan(S.tuned / 1e6), b = new A.Ble(fs, off, ch); return { label: "BLE advertising channel " + ch, run: (f, n) => b.run(f, n) }; }
    if (band === "lte") { const l = new C.Lte(fs, S.tuned); return { label: "LTE PSS cell search (10 ms each second)", run: (f, n) => l.run(f, n) }; }
    return null;
  };
  // Extra decoders on the shared 240k / 48k channel.
  P2.decoders = function (band, P, main) {
    const fmSlicer = (rate, sps, cb, onFs1, noDc) => { const d = new Disc(rate); const sl = new Slicer(sps, cb, 0.3); sl.useDc = !noDc; P.decoders.push(() => { const r = onFs1 ? main.r1 : main.r2, i = onFs1 ? main.i1 : main.i2, n = onFs1 ? main.n1 : main.n2, x = d.run(r, i, n); for (let k = 0; k < n; k += 1) sl.push(x[k]); }); };
    if (band === "sonde") { const dfm = new Sn.Dfm(); fmSlicer(main.fs2, main.fs2 / 2500, (c) => dfm.chip(c)); }
    else if (band === "pager") { const fl = new Sn.Flex(); fmSlicer(main.fs2, main.fs2 / 1600, (b) => fl.bit(b), false, true); }
    else if (band === "acars") { const ac = new A.Acars(main.fs2, S.tuned); P.decoders.push(() => ac.am(main.r2, main.i2, main.n2)); }
    else if (band === "train") { const e = new A.Eot(main.fs2, Math.abs(S.tuned - 452.9375e6) < 5e3 ? "HOT (head of train)" : "EOT (end of train)"), d = new Disc(main.fs2); P.decoders.push(() => e.td.run(d.run(main.r2, main.i2, main.n2), main.n2)); }
    else if (band === "zwave") { const z = new A.Zwave(); fmSlicer(main.fs1, main.fs1 / 19200, (c) => z.chip(c), true); }
    else if (band === "meter") { const o = new Sn.OokMulti(main.fs1); P.decoders.push(() => o.push(main.r1, main.i1, main.n1)); }
  };
  const fromHex = (h) => Uint8Array.from(String(h || "").replace(/[^0-9a-f]/gi, "").match(/../g) || [], (x) => parseInt(x, 16));
  // Frame-level injections (QA) and the self-test.
  P2.decodeTest = function (fr) {
    const t = fr.type;
    if (t === "selftest") return selftest();
    if (t === "vdl2") { const m = A.vdl2Frame(fromHex(fr.hex), fr.freq || 136975000); if (m) post({ t: "acars", msg: m }); return m; }
    if (t === "acars") { const m = A.acarsParse(fromHex(fr.hex), fr.freq || 131550000); if (m) { H.packets.acars += 1; post({ t: "acars", msg: m }); } return m; }
    if (t === "cmas") { const m = C.cmasFrame(fromHex(fr.hex), fr.freq || 751e6); post({ t: "lte", msg: m }); return m; }
    if (t === "sis") { const m = C.sisFrame(fromHex(fr.hex), fr.freq || 100.1e6); post({ t: "hd", msg: m }); return m; }
    if (t === "ft8") { const bits = fr.bits || []; const m = C.ft8Unpack(bits, fr.freq || 14074000, fr.snr || -10); if (m) post({ t: "ft8", msg: m }); return m; }
    if (t === "js8") { const m = C.js8Text(fr.text || "", fr.freq || 14078000, fr.snr || -12); if (m) post({ t: "ft8", msg: m }); return m; }
    if (t === "dispatch") { const pl = fr.proto === "NXDN" ? fr.text : fr.proto === "TETRA" ? fr.bits : fromHex(fr.hex); const m = C.dispatchFrame(fr.proto, pl, { radioId: fr.radioId, talkgroup: fr.tg }); if (m) post({ t: "dispatch", msg: m }); return m; }
    if (t === "uat") { const b = fromHex(fr.hex); return P2.uat.adsb(b); }
    if (t === "mesh") return L.encodeMesh(fr.node, fr.kind || "pos").then((p) => L.meshtastic(p, { sf: 11, bw: 250e3, preset: "test", snr: 9, rssi: -60 }));
    return undefined;
  };
  function hexOf(u8) { return Array.from(u8, (v) => v.toString(16).padStart(2, "0")).join("").toUpperCase(); }
  // Feed an emission through a decoder at a chosen sample rate (QA self-test only).
  function feed(rate, em, sink, pad) {
    const save = S.rate; S.rate = rate;
    const e = em(), total = e.len + (pad || 4096) * 2, chunk = 32768;
    const f = new Float32Array(chunk * 2), re = new Float32Array(chunk), im = new Float32Array(chunk);
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    for (let k0 = 0; k0 < total; k0 += chunk) {
      const n = Math.min(chunk, total - k0);
      for (let i = 0; i < n; i += 1) { const k = k0 + i - (pad || 4096); let r = rnd() * 0.01, q = rnd() * 0.01; if (k >= 0 && k < e.len) { const v = e.next(k); if (v) { r += v[0]; q += v[1]; } } f[2 * i] = r; f[2 * i + 1] = q; re[i] = r; im[i] = q; }
      sink(f, n, re, im);
    }
    S.rate = save;
  }
  async function selftest() {
    const got = [], orig = self.postMessage;
    self.postMessage = (m) => { if (m && m.t && m.msg) got.push(m); };
    const R = {}, last = (type, pred) => { for (let i = got.length - 1; i >= 0; i -= 1) if (got[i].t === type && (!pred || pred(got[i].msg))) return got[i].msg; return null; };
    const check = (name, fn) => { try { R[name] = Boolean(fn()); } catch (e) { R[name] = false; R[name + "_err"] = String(e && e.message); } };
    try {
      // public test vectors
      check("vector_meshtastic_longfast_hash_8", () => L.HASH === 8);
      check("vector_gsm7_hellohello", () => hexOf(C.gsm7Pack("hellohello")) === "E8329BFD4697D9EC37" && C.gsm7Unpack(C.gsm7Pack("hellohello"), 10) === "hellohello");
      check("vector_crc16_kermit_123456789", () => U.crc16(Uint8Array.from("123456789", (c) => c.charCodeAt(0)), 0, 9, 0x8408, 0, true) === 0x2189);
      check("vector_crc16_xmodem_123456789", () => U.crc16(Uint8Array.from("123456789", (c) => c.charCodeAt(0)), 0, 9, 0x1021, 0, false) === 0x31c3);
      check("vector_crc8_smbus_123456789", () => U.crc8p(Uint8Array.from("123456789", (c) => c.charCodeAt(0)), 9, 0x07, 0) === 0xf4);
      check("vector_ft8_grid_FN42", () => { const g = C.gridLatLon("FN42"); return g.lat === 42.5 && g.lon === -71; });
      check("vector_ft8_c28_roundtrip", () => ["K1ABC", "W9XYZ", "G4ABC", "CQ"].every((c) => C.c28Unpack(C.c28Pack(c)) === c));
      check("vector_uat_rs_and_dlac", () => { const d = Array.from({ length: 72 }, (_, i) => (i * 7) & 255), cw = Uint8Array.from(d.concat(P2.uat.rsEncode(d, 20))); const bad = cw.slice(); bad[5] ^= 1; return P2.uat.rsCheck(cw, 20) && !P2.uat.rsCheck(bad, 20) && P2.uat.dlacDecode(Uint8Array.from(P2.uat.dlacEncode("METAR KHOU 271853Z 18012KT"))) === "METAR KHOU 271853Z 18012KT"; });
      // LoRa / Meshtastic through real chirp IQ (SF7 125k and SF11 250k)
      const node = { id: 0x1a2b3c4d, lat: 29.61, lon: -95.12, alt: 18, hops: 1 };
      const p1 = await L.encodeMesh(node, "pos");
      const cfg7 = { name: "test SF7", sf: 7, bw: 125e3 }, lr7 = new L.LoRa(500e3, 100e3, cfg7);
      feed(500e3, () => L.emission(0, p1, cfg7, 100e3, 900, 0.4, 0x2b), (f, n) => lr7.run(f, n), 20000);
      await new Promise((r) => setTimeout(r, 30));
      check("iq_lora_sf7_meshtastic_position", () => { const m = last("mesh", (x) => x.proto === "Meshtastic"); return m && Math.abs(m.lat - 29.61) < 1e-6 && Math.abs(m.lon + 95.12) < 1e-6 && m.id === "!1a2b3c4d"; });
      const p2 = await L.encodeMesh({ id: 0x99aa0001, long: "GS Base Station", short: "GSB", hw: 43, hops: 0, lat: 0, lon: 0, alt: 0 }, "info");
      const cfg11 = { name: "test SF11", sf: 11, bw: 250e3 }, lr11 = new L.LoRa(1e6, 200e3, cfg11);
      feed(1e6, () => L.emission(0, p2, cfg11, 200e3, -1500, 0.4, 0x2b), (f, n) => lr11.run(f, n), 40000);
      await new Promise((r) => setTimeout(r, 30));
      check("iq_lora_sf11_longfast_nodeinfo", () => { const m = last("mesh", (x) => x.longName); return m && m.longName === "GS Base Station" && m.shortName === "GSB" && m.hw === "Heltec V3"; });
      const lr7b = new L.LoRa(500e3, 100e3, cfg7);
      feed(500e3, () => L.emission(0, L.encodeMeshcore({ key: 77, lat: 29.5, lon: -95.0, name: "MC Repeater" }), cfg7, 100e3, 0, 0.4, 0x12), (f, n) => lr7b.run(f, n), 20000);
      check("iq_lora_meshcore_advert", () => { const m = last("mesh", (x) => x.proto === "MeshCore"); return m && m.longName === "MC Repeater" && Math.abs(m.lat - 29.5) < 1e-5; });
      // UAT ADS-B + FIS-B uplink through FSK IQ at 2.083 MS/s
      const ua = new P2.uat.Uat();
      feed(2083334, () => fskEmission(0, P2.uat.encodeAdsb({ icao: 0xa12345, lat: 29.7, lon: -95.3, alt: 4500, hdg: 90, kt: 140, vr: 640, cs: "N978GS" }), 1041667, 312500, 0, 0.5, false), (f, n) => ua.run(f, n), 5000);
      check("iq_uat_adsb_long", () => { const m = last("uat"); return m && m.icao === "A12345" && Math.abs(m.lat - 29.7) < 1e-4 && Math.abs(m.lon + 95.3) < 1e-4 && m.alt === 4500 && m.callsign === "N978GS" && m.speed === 140; });
      const ub = new P2.uat.Uat();
      feed(2083334, () => fskEmission(0, P2.uat.encodeUplink({ lat: 29.65, lon: -95.28 }, ["METAR KHOU 271853Z 18012KT 10SM FEW030 24/18 A3001"]), 1041667, 312500, 0, 0.5, false), (f, n) => ub.run(f, n), 12000);
      check("iq_uat_fisb_uplink_metar", () => { const m = last("fisb"); return m && Math.abs(m.ground.lat - 29.65) < 1e-3 && m.texts.length === 1 && m.texts[0].text.startsWith("METAR KHOU"); });
      // OOK sensors at 240 kS/s
      const ook = new Sn.OokMulti(240000), runOok = (halves, rate) => feed(240000, () => ookEmission(0, halves, rate, 0, 0.3), (f, n, re, im) => ook.push(re, im, n), 2000);
      runOok(Sn.scmEncode({ id: 45678901, ert: 7, cons: 123456 }), 16384);
      check("iq_ert_scm_meter", () => { const m = last("meter"); return m && m.id === "45678901" && m.consumption === 123456 && m.kind === "Electric"; });
      runOok(Sn.tpmsBEncode({ id: 0x0badf00d, kpa: 235.2, temp: 21 }), 10000);
      check("iq_tpms_format_b", () => { const m = last("device", (x) => x.fmt === "B"); return m && m.id === "0BADF00D" && m.tempC === 21; });
      runOok(Sn.ev1527Encode(0x5a3c1, 4), 1428.6);
      check("iq_ev1527_remote", () => { const m = last("device", (x) => x.kind === "Remote"); return m && m.id === "5A3C1" && m.detail === "button 4"; });
      runOok(Sn.wh2Encode({ id: 0x2b7, temp: -3.4, hum: 61 }), 1000);
      check("iq_weather_sensor_wh2", () => { const m = last("device", (x) => x.kind === "Weather sensor"); return m && m.id === "2B7" && m.tempC === -3.4 && m.humidity === 61; });
      runOok(encodeTpms({ id: 0x1a2b3c4d, kpa: 230, temp: 24 }), 10000);
      check("iq_tpms_format_a", () => { const m = last("device", (x) => x.fmt === "A"); return m && m.id === "1A2B3C4D"; });
      // FSK at 48 kS/s: FLEX, DFM
      const fsk48 = (bits, baud, dev, dec, noDc) => { const d = new Disc(48000), sl = new Slicer(48000 / baud, dec, 0.3); sl.useDc = !noDc; feed(48000, () => fskEmission(0, bits, baud, dev, 0, 0.4, true), (f, n, re, im) => { const x = d.run(re, im, n); for (let i = 0; i < n; i += 1) sl.push(x[i]); }, 2000); };
      const fl = new Sn.Flex();
      fsk48(Sn.flexEncode([{ cap: 1923456, alpha: true, text: "ENGINE 7 MEDICAL 1420 BAY AREA BLVD" }, { cap: 1203304, alpha: false, text: "5551212" }], 3, 42), 1600, 4800, (b) => fl.bit(b), true);
      check("iq_flex_1600_alpha", () => { const m = last("pager", (x) => x.proto === "FLEX" && x.kind === "alpha"); return m && m.capcode === 1923456 && m.text === "ENGINE 7 MEDICAL 1420 BAY AREA BLVD"; });
      check("iq_flex_1600_numeric", () => { const m = last("pager", (x) => x.proto === "FLEX" && x.kind === "numeric"); return m && m.capcode === 1203304 && m.text.startsWith("5551212"); });
      const dfm = new Sn.Dfm(), sd = { id: 0x0a1b2c, lat: 29.81, lon: -95.44, alt: 12345.6, vE: 7.5, vN: -3.2, vU: 4.9, frame: 77 };
      for (let sub = 0; sub < 2; sub += 1) fsk48(Sn.dfmEncode(sd, sub), 2500, 2400, (c) => dfm.chip(c));
      check("iq_dfm_sonde", () => { const m = last("sonde", (x) => x.type === "DFM"); return m && m.serial === "D" + 0x0a1b2c && Math.abs(m.lat - 29.81) < 1e-6 && Math.abs(m.alt - 12345.6) < 0.01; });
      // RS41 PTU (frame level through the Phase 1 RS41 frame parser with calibration fragments)
      const rs = new Rs41(), s41 = { serial: "T1234567", lat: 29.5, lon: -95.1, alt: 5000, vE: 1, vN: 1, vU: 5, frame: 100 };
      for (let i = 0; i < 4; i += 1) { s41.frame = 100 + i; rs.frame(encodeRs41(s41)); }
      check("frame_rs41_ptu_temperature", () => { const m = last("sonde", (x) => x.type === "RS41" && x.tempC != null); return m && Math.abs(m.tempC - (15 - 0.0065 * 5000)) < 0.6 && m.rh === 48; });
      // ACARS (AM tones), EOT (NFM tones), Z-Wave (Manchester FSK), BLE (GFSK), LTE PSS
      const ac = new A.Acars(48000, 131550000);
      feed(48000, () => A.acarsEmission(0, A.acarsEncode({ mode: "2", reg: ".N12345", label: "H1", block: "1", flight: "UA1542", text: "#M1BPOSN29321W095123,TOPAZ,185412,350,KIAH" }), 0, 0.3), (f, n, re, im) => ac.am(re, im, n), 2000);
      check("iq_acars_position", () => { const m = last("acars", (x) => x.proto === "ACARS"); return m && m.flight === "UA1542" && m.reg === "N12345" && Math.abs(m.lat - (29 + 32.1 / 60)) < 1e-6 && Math.abs(m.lon + (95 + 12.3 / 60)) < 1e-6; });
      const eot = new A.Eot(48000, "EOT (end of train)"), de = new Disc(48000);
      feed(48000, () => A.eotEmission(0, A.eotEncode({ unit: 54321, psi: 88, charge: 97, motion: true, light: true }), 0, 0.3), (f, n, re, im) => eot.td.run(de.run(re, im, n), n), 2000);
      check("iq_eot_bch63", () => { const m = last("eot"); return m && m.unit === 54321 && m.psi === 88 && m.motion === true; });
      const zw = new A.Zwave(), dz = new Disc(240000), slz = new Slicer(240000 / 19200, (c) => zw.chip(c), 0.3);
      feed(240000, () => fskEmission(0, A.zwaveEncode({ home: 0xc0ffee42, src: 5, dst: 1, payload: [0x20, 0x03, 0xff] }), 19200, 20000, 0, 0.4, true), (f, n, re, im) => { const x = dz.run(re, im, n); for (let i = 0; i < n; i += 1) slz.push(x[i]); }, 2000);
      check("iq_zwave_r1", () => { const m = last("device", (x) => x.kind === "Z-Wave"); return m && m.id === "C0FFEE42" && m.detail.startsWith("node 5"); });
      const ble = new A.Ble(2e6, 0, 37);
      feed(2e6, () => fskEmission(0, A.bleEncode({ addr: [0xc4, 0x11, 0x22, 0x33, 0x44, 0x55], name: "GS Tag", company: 0x004c, mfg: [0x12, 0x19], tx: -8 }, 37), 1e6, 250e3, 0, 0.4, true), (f, n) => ble.run(f, n), 2000);
      check("iq_ble_adv", () => { const m = last("ble"); return m && m.addr === "C4:11:22:33:44:55" && m.name === "GS Tag" && m.company === "Apple" && m.tag === "Apple Find My" && m.txPower === -8; });
      const lte = new C.Lte(1.92e6, 751e6);
      feed(1.92e6, () => C.lteEmission(0, 34, 0.03, 0.3), (f, n) => lte.run(f, n), 100);
      check("iq_lte_pss_root34", () => { const m = last("lte", (x) => x.kind === "cell"); return m && m.nid2 === 2; });
      // frame-level parsers
      check("frame_vdl2_xid_ground_station", () => { const m = A.vdl2Frame(A.vdl2Encode(0x10a2b3, 4, 0xffffff, 7, "xid", { lat: 29.9, lon: -95.3, name: "KIAH" }), 136975000); return m && m.srcType === "Ground station" && m.gsLat === 29.9 && m.gsLon === -95.3 && m.gsName === "KIAH"; });
      check("frame_vdl2_acars", () => { const m = A.vdl2Frame(A.vdl2Encode(0xa4f2c1, 1, 0x10a2b3, 4, "acars", { mode: "2", reg: ".N45GS", label: "H1", block: "3", flight: "SW2210", text: "POSN29400W095300,350," }), 136975000); return m && m.acars && m.flight === "SW2210" && Math.abs(m.lat - 29.6667) < 1e-3; });
      check("frame_cmas_polygon", () => { const m = C.cmasFrame(C.cmasEncode(4371, 0x1234, "Flash Flood Warning this area til 9:15 PM CST. Avoid flooded areas.", [[29.5, -95.2], [29.7, -95.2], [29.7, -94.9], [29.5, -94.9]]), 751e6); return m.category.startsWith("Extreme") && m.poly.length === 4 && m.text.startsWith("Flash Flood"); });
      check("frame_hd_sis_location", () => { const m = C.sisFrame(C.sisEncode({ call: "KUHF", name: "Houston Public Media", lat: 29.7214, lon: -95.3421, programs: 3 }), 88.7e6); return m.call === "KUHF" && Math.abs(m.lat - 29.7214) < 2e-4 && Math.abs(m.lon + 95.3421) < 2e-4; });
      check("frame_ft8_cq_grid", () => { const m = C.ft8Unpack(C.ft8Pack("CQ", "K1ABC", "FN42"), 14074000, -7); return m.call === "K1ABC" && m.grid === "FN42" && m.lat === 42.5; });
      check("frame_js8_heartbeat", () => { const m = C.js8Text("KF5GSA: @HB HEARTBEAT EL29", 14078000, -12); return m && m.call === "KF5GSA" && m.grid === "EL29"; });
      check("frame_lrrp_p25", () => { const m = C.dispatchFrame("P25", C.lrrpEncode({ lat: 29.71, lon: -95.4, speed: 12, heading: 90 })); return Math.abs(m.lat - 29.71) < 1e-6 && Math.abs(m.lon + 95.4) < 1e-6 && m.heading === 90; });
      check("frame_tetra_lip", () => { const m = C.dispatchFrame("TETRA", C.lipEncode({ lat: 29.71, lon: -95.4, speed: 20, heading: 180 })); return Math.abs(m.lat - 29.71) < 1e-4 && Math.abs(m.lon + 95.4) < 1e-4 && m.heading === 180; });
      check("frame_nxdn_rmc", () => { const m = C.dispatchFrame("NXDN", C.rmcEncode({ lat: 29.71, lon: -95.4, speed: 5, heading: 45 })); return Math.abs(m.lat - 29.71) < 1e-5 && Math.abs(m.lon + 95.4) < 1e-5; });
    } finally { self.postMessage = orig; }
    const names = Object.keys(R).filter((k) => !k.endsWith("_err"));
    return { pass: names.filter((k) => R[k]).length, total: names.length, results: R };
  }
})();

// ==================================================================== synthetic test signals (QA only; runs only after an explicit {t:"sim"})
(function () {
  const P2 = self.P2, L = P2.lora, A = P2.air, Sn = P2.sensors, C = P2.cell, UA = P2.uat;
  function noiseBand(start, secs, off, width, amp) { // random QPSK chips: a cheap noise-like band for OFDM / 8VSB / digital voice
    const fs = S.rate, m = Math.max(1, Math.round(fs / width)), w = (TAU * off) / fs; let cr = 1, ci = 0;
    return { bg: true, start, len: Math.round(fs * secs), next: (k) => { if (k % m === 0) { cr = Math.random() < 0.5 ? -1 : 1; ci = Math.random() < 0.5 ? -1 : 1; } const c = Math.cos(w * k), s = Math.sin(w * k); return [amp * (cr * c - ci * s), amp * (cr * s + ci * c)]; } };
  }
  P2.noiseBand = noiseBand;
  P2.simStart = function (SIM, rx) {
    const o = (dlat, dlon) => ({ lat: rx.lat + dlat, lon: rx.lon + dlon });
    SIM.p2 = {
      mesh: [Object.assign({ id: 0x1a2b3c4d, long: "Clear Lake Base", short: "CLB", hw: 43, alt: 12, hops: 0 }, o(0.05, -0.07)), Object.assign({ id: 0x5e6f7081, long: "Bay Area Mobile", short: "BAM", hw: 4, alt: 8, hops: 1, mv: 1 }, o(-0.04, 0.09)), Object.assign({ id: 0x0c0ffee1, long: "Kemah Solar Relay", short: "KSR", hw: 9, alt: 30, hops: 2 }, o(0.11, 0.14))],
      meshcore: [Object.assign({ key: 41, name: "MC Webster Rptr" }, o(0.07, 0.02)), Object.assign({ key: 99, name: "MC League City" }, o(-0.09, -0.05))],
      lorawan: [0x26011a2b, 0x260b77c3],
      uat: [{ icao: 0xa61b2c, cs: "N618GS", kt: 118, hdg: 140, vr: -320, alt: 2500, ...o(0.14, -0.18) }, { icao: 0xa9c3d4, cs: "N92UAT", kt: 142, hdg: 275, vr: 512, alt: 5500, ...o(-0.2, 0.25) }],
      tower: o(0.02, -0.12),
      metars: ["METAR KHOU 271853Z 17011KT 10SM FEW035 BKN250 24/17 A3002", "METAR KEFD 271855Z 16009KT 10SM SCT040 23/18 A3003", "METAR KIAH 271853Z 18013G20KT 10SM FEW045 25/16 A3000", "METAR KGLS 271850Z 15012KT 9SM SCT020 22/19 A3004"],
      acars: [{ reg: ".N37522", flight: "UA1871", label: "H1", kt: 280, hdg: 30, alt: 9000, ...o(0.25, -0.3) }, { reg: ".N8642A", flight: "WN3317", label: "15", kt: 250, hdg: 210, alt: 7000, ...o(-0.3, 0.12) }],
      gs: [{ addr: 0x10a2b3, name: "IAH VDL", ...o(0.45, -0.24) }, { addr: 0x10c4d5, name: "HOU VDL", ...o(0.1, -0.21) }],
      units: [{ proto: "P25", id: 1402117, tg: 9001, kt: 22, hdg: 80, ...o(0.03, -0.04) }, { proto: "DMR", id: 3101554, tg: 91, kt: 0, hdg: 0, ...o(-0.06, 0.03) }, { proto: "TETRA", id: 2040411, tg: 1201, kt: 15, hdg: 200, ...o(0.08, 0.06) }, { proto: "NXDN", id: 4471, tg: 12, kt: 31, hdg: 315, ...o(-0.02, -0.09) }],
      meters: [{ id: 45678901, ert: 7, cons: 1234567 }, { id: 38200417, ert: 12, cons: 88213 }, { id: 51177320, ert: 11, cons: 447102 }, { id: 29933410, ert: 4, cons: 772091 }],
      hd: { "100.1": { call: "KGSA", name: "Global Status FM HD1", programs: 3, ...o(0.18, -0.26) }, "99.5": { call: "KGSB", name: "Bay Classics HD", programs: 2, ...o(-0.22, -0.1) } },
      lteCells: [25, 29, 34],
      ft8: [["CQ", "KF5GSA", "EL29"], ["CQ", "W1AW", "FN31"], ["CQ", "K6GSA", "DM04"], ["CQ", "VE3GSA", "FN03"], ["CQ", "N0GSA", "EN34"]],
      js8: ["KF5GSA: @HB HEARTBEAT EL29", "W5GSA: @ALLCALL CQ CQ EM10", "KD7GSA: @HB HEARTBEAT DN17"],
      tpmsB: [{ id: 0x0badf00d, kpa: 236.8, temp: 22 }, { id: 0x13579bdf, kpa: 241.6, temp: 25 }],
      remotes: [[0x5a3c1, 4], [0x81f02, 1]], wx: [{ id: 0x2b7, temp: 23.4, hum: 61 }, { id: 0x0c4, temp: 19.8, hum: 72 }],
      zw: [{ home: 0xc0ffee42, src: 5, dst: 1, payload: [0x20, 0x03, 0xff] }, { home: 0xc0ffee42, src: 9, dst: 1, payload: [0x31, 0x05, 0x01, 0x22, 0x00, 0xe1] }],
      ble: [{ addr: [0xc4, 0x11, 0x22, 0x33, 0x44, 0x55], name: "", company: 0x004c, mfg: [0x12, 0x19, 0x10], tx: -8 }, { addr: [0xd2, 0x9a, 0x01, 0x7c, 0x3e, 0x10], name: "Forerunner 265", company: 0x0087, mfg: [0x01], tx: 4 }, { addr: [0x4f, 0x62, 0xaa, 0x10, 0x09, 0x33], name: "GS Ruuvi", company: 0x0499, mfg: [0x05, 0x12], tx: 0 }, { addr: [0xe8, 0x77, 0x23, 0x44, 0x91, 0x02], name: "Galaxy Buds2", company: 0x0075, mfg: [0x42], tx: -2 }],
      eot: [{ unit: 54321, psi: 88, charge: 97, motion: true, light: true }, { unit: 23017, psi: 0, charge: 61, motion: false, light: false }],
      flex: [{ cap: 1923456, alpha: true, text: "ENGINE 7 MEDICAL 1420 BAY AREA BLVD" }, { cap: 1203304, alpha: false, text: "2814550199" }, { cap: 1603772, alpha: true, text: "MAINT: CHILLER 3 HIGH TEMP ALARM" }],
      dfm: { id: 0x0a1b2c, lat: rx.lat - 0.16, lon: rx.lon + 0.22, alt: 8200, vE: -6.5, vN: 3.1, vU: 4.6, frame: 1 },
      cmasPoly: [[rx.lat - 0.12, rx.lon - 0.18], [rx.lat + 0.1, rx.lon - 0.2], [rx.lat + 0.14, rx.lon + 0.12], [rx.lat - 0.08, rx.lon + 0.16]],
      pending: false,
    };
  };
  const move = (o, kt, hdg, dt) => { const d = kt * 0.514444 * dt; o.lat += (d * Math.cos((hdg * Math.PI) / 180)) / 111320; o.lon += (d * Math.sin((hdg * Math.PI) / 180)) / (111320 * Math.cos((o.lat * Math.PI) / 180)); };
  const posStr = (lat, lon) => { const a = Math.abs(lat), b = Math.abs(lon), ld = Math.floor(a), od = Math.floor(b); return "POS" + (lat < 0 ? "S" : "N") + String(ld).padStart(2, "0") + String(Math.round((a - ld) * 600)).padStart(3, "0") + (lon < 0 ? "W" : "E") + String(od).padStart(3, "0") + String(Math.round((b - od) * 600)).padStart(3, "0"); };
  const near = (mhz, list, tol) => list.some((f) => Math.abs(mhz - f) <= tol);
  const FT8F = [1.84, 3.573, 7.074, 10.136, 14.074, 18.1, 21.074, 24.915, 28.074, 50.313];
  P2.simSchedule = function (band, c) {
    const { at, push, due, rr, dt, SIM } = c, X = SIM.p2, off = S.tuned - S.center, mhz = S.tuned / 1e6;
    if (!X) return false;
    const busy = () => SIM.em.some((e) => e.band === band && !e.bg && e.start + e.len > SIM.k);
    for (const a of X.uat) { move(a, a.kt, a.hdg, dt); a.alt += (a.vr / 60) * dt; }
    for (const a of X.acars) move(a, a.kt, a.hdg, dt);
    for (const u of X.units) if (u.kt) move(u, u.kt, u.hdg, dt);
    const m1 = X.mesh[1]; move(m1, 9, 70 + 40 * Math.sin(SIM.t / 30), dt);
    const sd = X.dfm; sd.lat += (sd.vN * dt) / 111320; sd.lon += (sd.vE * dt) / (111320 * Math.cos((sd.lat * Math.PI) / 180)); sd.alt += sd.vU * dt;
    if (band === "mesh") {
      if (!X.pending && !busy() && due("mesh", 2.2)) {
        const cfg = L.cfgFor(S.tuned), cfo = (Math.random() - 0.5) * 3000;
        if (/MeshCore/.test(cfg.name)) push(L.emission(at, L.encodeMeshcore(X.meshcore[rr("mc", X.meshcore.length)]), cfg, off, cfo, 0.3, 0x12));
        else if (/LoRaWAN/.test(cfg.name)) { const dev = X.lorawan[rr("lw", X.lorawan.length)], fc = rr("fc", 65535), p = [0x40, dev & 255, (dev >>> 8) & 255, (dev >>> 16) & 255, dev >>> 24, 0, fc & 255, fc >> 8, 2]; for (let i = 0; i < 12; i += 1) p.push((Math.random() * 256) | 0); push(L.emission(at, Uint8Array.from(p), cfg, off, cfo, 0.3, 0x34)); }
        else { const i = rr("mesh", X.mesh.length * 2), node = X.mesh[i >> 1]; X.pending = true; L.encodeMesh(node, i & 1 ? "info" : "pos").then((p) => { X.pending = false; if (SIM.p2 === X) push(L.emission(SIM.k + Math.round(S.rate * 0.004), p, cfg, off, cfo, 0.3, 0x2b)); }, () => { X.pending = false; }); }
      }
      return true;
    }
    if (band === "uat") {
      if (!busy() && due("fisb", 3.2)) push(fskEmission(at, UA.encodeUplink(X.tower, X.metars), 1041667, 312500, 0, 0.3, false));
      else if (!busy() && due("uat", 0.4)) push(fskEmission(at, UA.encodeAdsb(X.uat[rr("uat", X.uat.length)]), 1041667, 312500, 0, 0.3, false));
      return true;
    }
    if (band === "acars") {
      if (!busy() && due("acars", 1.7)) { const a = X.acars[rr("acars", X.acars.length)]; push(A.acarsEmission(at, A.acarsEncode({ mode: "2", reg: a.reg, label: a.label, block: String(1 + rr("blk", 9)), flight: a.flight, text: "#M1B" + posStr(a.lat, a.lon) + "," + Math.round(a.alt / 100) + ",EAGLE," + a.flight }), off, 0.25)); }
      return true;
    }
    if (band === "vdl2") {
      if (due("vdl2", 1.3)) {
        push(noiseBand(at, 0.06, off, 10500, 0.05));
        const i = rr("vdl", X.gs.length + X.acars.length);
        const b = i < X.gs.length ? A.vdl2Encode(X.gs[i].addr, 4, 0xffffff, 7, "xid", X.gs[i]) : (() => { const a = X.acars[i - X.gs.length]; return A.vdl2Encode(0xa00000 + i, 1, X.gs[0].addr, 4, "acars", { mode: "2", reg: a.reg, label: "H1", block: "2", flight: a.flight, text: posStr(a.lat, a.lon) + "," + Math.round(a.alt / 100) + "," }); })();
        const m = A.vdl2Frame(b, S.tuned); if (m) post({ t: "acars", msg: m });
      }
      return true;
    }
    if (band === "dispatch") {
      if (due("disp", 2.0)) {
        const u = X.units[rr("disp", X.units.length)];
        push(noiseBand(at, 0.35, off, u.proto === "TETRA" ? 18000 : 6000, 0.05));
        const pl = u.proto === "NXDN" ? C.rmcEncode({ lat: u.lat, lon: u.lon, speed: u.kt, heading: u.hdg }) : u.proto === "TETRA" ? C.lipEncode({ lat: u.lat, lon: u.lon, speed: u.kt * 1.852, heading: u.hdg }) : C.lrrpEncode({ lat: u.lat, lon: u.lon, speed: u.kt * 0.514, heading: u.hdg });
        const m = C.dispatchFrame(u.proto, pl, { radioId: u.id, talkgroup: u.tg }); if (m) post({ t: "dispatch", msg: m });
      }
      return true;
    }
    if (band === "meter") {
      if (!busy() && due("meter", 0.45)) { const m = X.meters[rr("meter", X.meters.length)]; m.cons += 1; push(ookEmission(at, Sn.scmEncode(m), 16384, off, 0.3)); }
      if (due("gridstream", 1.7)) push(noiseBand(at + Math.round(S.rate * 0.2), 0.02, off + 400e3, 19200, 0.04));
      return true;
    }
    if (band === "fm") {
      const st = X.hd[mhz.toFixed(1)];
      if (st && Math.abs(mhz - Number(mhz.toFixed(1))) < 0.02) {
        if (due("hdbg", 0.95)) { push(noiseBand(at, 1.0, off + 162.5e3, 55e3, 0.03)); push(noiseBand(at, 1.0, off - 162.5e3, 55e3, 0.03)); }
        if (due("sis", 4.0)) post({ t: "hd", msg: C.sisFrame(C.sisEncode(st), S.tuned) });
      }
      return false;
    }
    if (band === "lte") {
      if (due("ltebg", 0.98)) { const root = X.lteCells[Math.floor(mhz) % 3]; push(Object.assign(C.lteEmission(at, root, 1.0, 0.25), { bg: true })); }
      if (due("cmas", 7.0)) post({ t: "lte", msg: C.cmasFrame(C.cmasEncode(rr("cm", 2) ? 4371 : 4380, 0x1a20 + rr("cms", 16), rr("cmt", 2) ? "Flash Flood Warning in this area until 9:15 PM CST. Avoid flooded areas. Check local media." : "This is a Required Monthly Test of the Wireless Emergency Alert system. No action needed.", X.cmasPoly), S.tuned) });
      return true;
    }
    if (band === "ft8") {
      if (due("ft8", 1.8)) {
        const js8 = near(mhz, [3.578, 7.078, 14.078, 21.078, 28.078], 0.004);
        push(noiseBand(at, 0.4, off + 1000 + rr("ft8o", 20) * 100, 50, 0.04));
        const m = js8 ? C.js8Text(X.js8[rr("js8", X.js8.length)], S.tuned, -8 - rr("snr", 12)) : C.ft8Unpack(C.ft8Pack(...X.ft8[rr("ft8", X.ft8.length)]), S.tuned, -6 - rr("snr", 14));
        if (m) post({ t: "ft8", msg: m });
      }
      return true;
    }
    if (band === "atsc") { if (due("atscbg", 0.98)) push(noiseBand(at, 1.0, off + 500e3, 400e3, 0.035)); return true; }
    if (band === "tpms") {
      if (!busy() && due("tpms", 0.3)) {
        const k = rr("tpk", 4);
        if (k === 0) push(ookEmission(at, encodeTpms(SIM.tpms[rr("tpms", SIM.tpms.length)]), 10000, off, 0.3));
        else if (k === 1) push(ookEmission(at, Sn.tpmsBEncode(X.tpmsB[rr("tpb", X.tpmsB.length)]), 10000, off, 0.3));
        else if (k === 2) { const r = X.remotes[rr("rem", X.remotes.length)]; push(ookEmission(at, Sn.ev1527Encode(r[0], r[1]), 1428.6, off, 0.3)); }
        else push(ookEmission(at, Sn.wh2Encode(X.wx[rr("wx", X.wx.length)]), 1000, off, 0.3));
      }
      return true;
    }
    if (band === "sonde") {
      if (!busy() && due("sonde", 0.8)) {
        if (rr("sk", 3) < 2) { SIM.sonde.frame += 1; push(fskEmission(at, rs41Bits(encodeRs41(SIM.sonde)), 4800, 2400, off, 0.3, true, 48)); }
        else { sd.frame += 1; push(fskEmission(at, Sn.dfmEncode(sd, rr("dsub", 2)), 2500, 2400, off, 0.3, true)); }
      }
      return true;
    }
    if (band === "pager") {
      if (!busy() && due("pager", 2.0)) {
        if (rr("pgk", 2) === 0) push(fskEmission(at, encodePocsag(SIM.pages[rr("pager", SIM.pages.length)]).map((b) => b ^ 1), 1200, 4500, off, 0.3, false));
        else push(fskEmission(at, Sn.flexEncode([X.flex[rr("flex", X.flex.length)]], 2, rr("ffr", 128)), 1600, 4800, off, 0.3, true));
      }
      return true;
    }
    if (band === "zwave") { if (!busy() && due("zw", 1.1)) push(fskEmission(at, A.zwaveEncode(X.zw[rr("zw", X.zw.length)]), 19200, 20000, off, 0.3, true)); return true; }
    if (band === "ble") {
      if (!busy() && due("ble", 0.18)) { const ch = Math.abs(mhz - 2426) < 0.5 ? 38 : Math.abs(mhz - 2480) < 0.5 ? 39 : 37; push(fskEmission(at, A.bleEncode(X.ble[rr("ble", X.ble.length)], ch), 1e6, 250e3, off, 0.3, true)); }
      return true;
    }
    if (band === "train") { if (!busy() && due("eot", 2.4)) push(A.eotEmission(at, A.eotEncode(X.eot[rr("eot", X.eot.length)]), off, 0.3)); return true; }
    return false;
  };
  P2.simCarriers = function (band, mk) {
    if (band === "atsc") return [mk(S.tuned, 0.05)];
    if (band === "mesh" || band === "uat" || band === "ble" || band === "lte") return [];
    if (band === "acars" || band === "vdl2") return [mk(S.tuned + 25000, 0.025, { fade: 1 })];
    if (band === "voice" || band === "sat" || band === "dispatch") return [mk(S.tuned + 12500, 0.05, { nfm: 1, fade: 1 }), mk(S.tuned - 25000, 0.03, { nfm: 1 })];
    if (band === "ft8") return [mk(S.tuned + 1500, 0.03)];
    return null;
  };
})();
