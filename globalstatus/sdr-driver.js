/* Global Status · SDR USB driver (Phase 1, receive only)
 *
 * Original clean-room WebUSB code for Global Status App, written from the public
 * libhackrf vendor-request list and the public RTL2832U / R820T register notes.
 *   HackRF One / r9 / Pro, Jawbreaker, rad1o    VID 0x1d50 (PIDs 0x6089, 0x604b, 0xcc15)
 *   PortaPack running Mayhem (USB serial)       VID 0x1d50 PID 0x6018 -> sends "hackrf" to switch
 *   RTL-SDR (RTL2832U + R820T/R820T2/R828D)     VID 0x0bda PIDs 0x2832 / 0x2838 + common OEM IDs
 *
 * Nothing in this file can transmit. HackRF transceiver mode only accepts OFF (0) or RX (1),
 * and bias-T is switched off on every connect. navigator.usb is not touched until the user
 * clicks Connect SDR or opens the SDR category (to reconnect a radio they already allowed).
 */
(function (root) {
  "use strict";

  const HACKRF_PIDS = { 0x6089: "HackRF One", 0x604b: "Jawbreaker", 0xcc15: "rad1o" };
  const HACKRF_BOARDS = { 0: "Jellybean", 1: "Jawbreaker", 2: "HackRF One", 3: "rad1o", 4: "HackRF One r9", 5: "HackRF Pro" };
  const PORTAPACK = { vendorId: 0x1d50, productId: 0x6018 };
  const RTL_IDS = [
    [0x0bda, 0x2832, "RTL2832U"], [0x0bda, 0x2838, "RTL-SDR"],
    [0x0413, 0x6680, "DigitalNow Quad"], [0x0413, 0x6f0f, "Leadtek WinFast"], [0x0458, 0x707f, "Genius TVGo"],
    [0x0ccd, 0x00a9, "Terratec Cinergy T Black"], [0x0ccd, 0x00b3, "Terratec NOXON DAB"], [0x0ccd, 0x00b4, "Terratec Deutschlandradio"],
    [0x0ccd, 0x00b5, "Terratec NOXON DAB Stick"], [0x0ccd, 0x00b7, "Terratec NOXON DAB Stick"], [0x0ccd, 0x00b8, "Terratec NOXON DAB Stick"],
    [0x0ccd, 0x00b9, "Terratec NOXON DAB Stick"], [0x0ccd, 0x00c0, "Terratec NOXON DAB Stick"], [0x0ccd, 0x00c6, "Terratec NOXON DAB Stick"],
    [0x0ccd, 0x00d3, "Terratec Cinergy T RC3"], [0x0ccd, 0x00d7, "Terratec T Stick+"], [0x0ccd, 0x00e0, "Terratec NOXON DAB Stick"],
    [0x1554, 0x5020, "PixelView PV-DT235U"], [0x15f4, 0x0131, "Astrometa DVB-T"], [0x15f4, 0x0133, "HanfTek DAB+FM+DVB-T"],
    [0x185b, 0x0620, "Compro VideoMate U620F"], [0x185b, 0x0650, "Compro VideoMate U650F"], [0x185b, 0x0680, "Compro VideoMate U680F"],
    [0x1b80, 0xd393, "GIGABYTE GT-U7300"], [0x1b80, 0xd394, "DIKOM USB-DVBT HD"], [0x1b80, 0xd395, "Peak 102569AGPK"],
    [0x1b80, 0xd397, "KWorld KW-UB450-T"], [0x1b80, 0xd398, "Zaapa ZT-MINDVBZP"], [0x1b80, 0xd39d, "SVEON STV20"],
    [0x1b80, 0xd3a4, "Twintech UT-40"], [0x1b80, 0xd3a8, "ASUS U3100MINI"], [0x1b80, 0xd3af, "SVEON STV27"], [0x1b80, 0xd3b0, "SVEON STV21"],
    [0x1d19, 0x1101, "Dexatek DK DVB-T"], [0x1d19, 0x1102, "Dexatek DK DVB-T"], [0x1d19, 0x1103, "Dexatek Technology"], [0x1d19, 0x1104, "MSI DigiVox Micro HD"],
    [0x1f4d, 0xa803, "Sweex DVB-T"], [0x1f4d, 0xb803, "GTek T803"], [0x1f4d, 0xc803, "Lifeview LV5TDeluxe"], [0x1f4d, 0xd286, "MyGica TD312"], [0x1f4d, 0xd803, "PROlectrix DV107669"],
  ];
  const FILTERS = Object.keys(HACKRF_PIDS).map((pid) => ({ vendorId: 0x1d50, productId: Number(pid) }))
    .concat([PORTAPACK])
    .concat(RTL_IDS.map(([v, p]) => ({ vendorId: v, productId: p })));

  function rtlName(dev) { const hit = RTL_IDS.find(([v, p]) => v === dev.vendorId && p === dev.productId); return hit ? hit[2] : ""; }
  function kindOf(dev) {
    if (!dev) return "";
    if (dev.vendorId === 0x1d50 && HACKRF_PIDS[dev.productId]) return "hackrf";
    if (dev.vendorId === PORTAPACK.vendorId && dev.productId === PORTAPACK.productId) return "portapack";
    if (rtlName(dev)) return "rtl";
    return "";
  }

  // ------------------------------------------------------------------ browser support (no USB access)
  function support() {
    const nav = root.navigator || {};
    const ua = nav.userAgent || "";
    const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const firefox = /Firefox\//.test(ua);
    const hasUsb = "usb" in nav; // feature check only; nothing is called
    if (ios || firefox || !hasUsb) return { ok: false, reason: "This browser can't reach USB radios. Use Chrome or Edge on a computer or an Android phone." };
    if (!root.isSecureContext) return { ok: false, reason: "Plugging in a radio needs the secure (https) version of the site." };
    return { ok: true, serial: "serial" in nav };
  }

  function friendlyError(err, kind) {
    const msg = String((err && (err.message || err.name)) || err || "");
    if (/No device selected|NotFoundError/i.test(msg)) return "No radio was picked.";
    if (/Unable to claim|claimInterface|protected|SecurityError|NetworkError|Access denied/i.test(msg)) {
      if (kind === "rtl") return "Another driver is holding the RTL-SDR. On Windows install the WinUSB driver (Zadig); on Linux unload dvb_usb_rtl28xxu; then plug it in again.";
      return "The radio is busy in another app. Close other SDR apps, unplug it, plug it back in and try again.";
    }
    if (/disconnected|transfer error|stall/i.test(msg)) return "The radio stopped answering. Check the cable or use a powered USB hub.";
    return msg.slice(0, 160) || "The radio did not answer.";
  }

  // ------------------------------------------------------------------ shared bulk loop
  function bulkLoop(drv, endpoint, size, depth, onData, onDrop) {
    drv.running = true;
    const one = async () => {
      while (drv.running) {
        let r;
        try { r = await drv.dev.transferIn(endpoint, size); }
        catch (e) { if (drv.running) { onDrop(1, e); drv.running = false; } return; }
        if (!drv.running) return;
        if (r.status === "ok" && r.data && r.data.byteLength) onData(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength));
        else onDrop(1);
      }
    };
    for (let i = 0; i < depth; i += 1) one();
  }

  // ------------------------------------------------------------------ HackRF
  const HR = { SET_TRANSCEIVER_MODE: 1, SAMPLE_RATE_SET: 6, BASEBAND_FILTER_BANDWIDTH_SET: 7, BOARD_ID_READ: 14, VERSION_STRING_READ: 15, SET_FREQ: 16, AMP_ENABLE: 17, SET_LNA_GAIN: 19, SET_VGA_GAIN: 20, ANTENNA_ENABLE: 23 };
  const MODE_OFF = 0, MODE_RX = 1;
  const HR_FILTERS = [1750000, 2500000, 3500000, 5000000, 5500000, 6000000, 7000000, 8000000, 9000000, 10000000, 12000000, 14000000, 15000000, 20000000, 24000000, 28000000];

  class HackRF {
    constructor(dev) { this.dev = dev; this.kind = "hackrf"; this.fmt = "s8"; this.running = false; this.biasT = false; this.minHz = 1e6; this.maxHz = 6e9; this.biasVolts = "3.3 V"; }
    async open() {
      const d = this.dev;
      await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      await d.claimInterface(0);
      this.boardId = await this.vin(HR.BOARD_ID_READ, 0, 0, 1).then((dv) => dv.getUint8(0)).catch(() => null);
      this.version = await this.vin(HR.VERSION_STRING_READ, 0, 0, 255).then((dv) => new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)).replace(/\0.*$/, "").trim()).catch(() => "");
      this.name = HACKRF_BOARDS[this.boardId] || HACKRF_PIDS[d.productId] || "HackRF";
      await this.setTransceiverMode(MODE_OFF);
      await this.setBiasT(false); // always off on connect
      await this.vout(HR.AMP_ENABLE, 0, 0); // front-end RF amp off
      return this;
    }
    vin(request, value, index, len) {
      return this.dev.controlTransferIn({ requestType: "vendor", recipient: "device", request, value, index }, len).then((r) => { if (r.status !== "ok") throw new Error("HackRF request " + request + " " + r.status); return r.data; });
    }
    vout(request, value, index, data) {
      return this.dev.controlTransferOut({ requestType: "vendor", recipient: "device", request, value, index }, data).then((r) => { if (r.status !== "ok") throw new Error("HackRF request " + request + " " + r.status); });
    }
    setTransceiverMode(mode) {
      if (mode !== MODE_OFF && mode !== MODE_RX) throw new Error("Global Status is receive only");
      return this.vout(HR.SET_TRANSCEIVER_MODE, mode, 0);
    }
    async setFrequency(hz) {
      hz = Math.round(Math.max(this.minHz, Math.min(this.maxHz, hz)));
      const b = new DataView(new ArrayBuffer(8));
      const mhz = Math.floor(hz / 1e6);
      b.setUint32(0, mhz, true); b.setUint32(4, hz - mhz * 1e6, true);
      await this.vout(HR.SET_FREQ, 0, 0, b.buffer);
      this.freq = hz;
    }
    async setSampleRate(sps) {
      const b = new DataView(new ArrayBuffer(8));
      b.setUint32(0, Math.round(sps), true); b.setUint32(4, 1, true);
      await this.vout(HR.SAMPLE_RATE_SET, 0, 0, b.buffer);
      let bw = HR_FILTERS[0];
      for (const f of HR_FILTERS) if (f <= sps * 0.75) bw = f;
      await this.vout(HR.BASEBAND_FILTER_BANDWIDTH_SET, bw & 0xffff, bw >>> 16);
      this.rate = sps;
    }
    async setGain(pct) { // 0..100 -> LNA 0..40 dB (8 dB steps) + VGA 0..62 dB (2 dB steps)
      const p = Math.max(0, Math.min(100, pct)) / 100;
      const lna = Math.round((p * 40) / 8) * 8, vga = Math.round((p * 62) / 2) * 2;
      await this.vin(HR.SET_LNA_GAIN, 0, lna, 1);
      await this.vin(HR.SET_VGA_GAIN, 0, vga, 1);
      this.gainText = "LNA " + lna + " · VGA " + vga + " dB";
    }
    async setBiasT(on) { await this.vout(HR.ANTENNA_ENABLE, on ? 1 : 0, 0); this.biasT = Boolean(on); }
    async start(onData, onDrop) { await this.setTransceiverMode(MODE_RX); bulkLoop(this, 1, 262144, 4, onData, onDrop); }
    async stop() { this.running = false; try { await this.setTransceiverMode(MODE_OFF); } catch (e) { /* unplugged */ } }
    async close() { await this.stop(); try { await this.setBiasT(false); } catch (e) {} try { await this.dev.releaseInterface(0); } catch (e) {} try { await this.dev.close(); } catch (e) {} }
  }

  // ------------------------------------------------------------------ RTL-SDR (RTL2832U + R820T family)
  const BLK = { DEMOD: 0, USB: 1, SYS: 2, IIC: 6 };
  const REG = { USB_SYSCTL: 0x2000, USB_EPA_CTL: 0x2148, USB_EPA_MAXPKT: 0x2158, DEMOD_CTL: 0x3000, DEMOD_CTL_1: 0x300b, GPO: 0x3001, GPOE: 0x3003, GPD: 0x3004 };
  const XTAL = 28800000, IF_HZ = 3570000;
  const R82_INIT = [0x83, 0x32, 0x75, 0xc0, 0x40, 0xd6, 0x6c, 0xf5, 0x63, 0x75, 0x68, 0x6c, 0x83, 0x80, 0x00, 0x0f, 0x00, 0xc0, 0x30, 0x48, 0xcc, 0x60, 0x00, 0x54, 0xae, 0x4a, 0xc0];
  const R82_RANGES = [[0, 0x08, 0x02, 0xdf], [50, 0x08, 0x02, 0xbe], [55, 0x08, 0x02, 0x8b], [60, 0x08, 0x02, 0x7b], [65, 0x08, 0x02, 0x69], [70, 0x08, 0x02, 0x58],
    [75, 0x00, 0x02, 0x44], [80, 0x00, 0x02, 0x44], [90, 0x00, 0x02, 0x34], [100, 0x00, 0x02, 0x34], [110, 0x00, 0x02, 0x24], [120, 0x00, 0x02, 0x24],
    [140, 0x00, 0x02, 0x14], [180, 0x00, 0x02, 0x13], [220, 0x00, 0x02, 0x13], [250, 0x00, 0x02, 0x11], [280, 0x00, 0x02, 0x00], [310, 0x00, 0x41, 0x00],
    [450, 0x00, 0x41, 0x00], [588, 0x00, 0x40, 0x00], [650, 0x00, 0x40, 0x00]];
  const LNA_STEPS = [0, 9, 13, 40, 38, 13, 31, 22, 26, 31, 26, 14, 19, 5, 35, 13];
  const MIX_STEPS = [0, 5, 10, 10, 19, 9, 10, 25, 17, 10, 8, 16, 13, 6, 3, -8];
  const FIR = [-54, -36, -41, -40, -32, -14, 14, 53, 101, 156, 215, 273, 327, 372, 404, 421];
  const bitrev8 = (b) => { let r = 0; for (let i = 0; i < 8; i += 1) r |= ((b >> i) & 1) << (7 - i); return r; };

  class RtlSdr {
    constructor(dev) { this.dev = dev; this.kind = "rtl"; this.fmt = "u8"; this.running = false; this.biasT = false; this.minHz = 1e6; this.maxHz = 1766e6; this.biasVolts = "4.5 V"; this.shadow = new Uint8Array(32); this.direct = false; this.tunerAddr = 0x34; }
    ctrl(index, value) { return { requestType: "vendor", recipient: "device", request: 0, value, index }; }
    async writeReg(block, addr, val, len) {
      const d = len === 1 ? Uint8Array.of(val & 0xff) : Uint8Array.of((val >> 8) & 0xff, val & 0xff);
      const r = await this.dev.controlTransferOut(this.ctrl((block << 8) | 0x10, addr), d);
      if (r.status !== "ok") throw new Error("RTL write " + addr.toString(16));
    }
    async readReg(block, addr, len) {
      const r = await this.dev.controlTransferIn(this.ctrl(block << 8, addr), len);
      return len === 1 ? r.data.getUint8(0) : (r.data.getUint8(1) << 8) | r.data.getUint8(0);
    }
    async demodWrite(page, addr, val, len) {
      const d = len === 1 ? Uint8Array.of(val & 0xff) : Uint8Array.of((val >> 8) & 0xff, val & 0xff);
      await this.dev.controlTransferOut(this.ctrl(0x10 | page, (addr << 8) | 0x20), d);
      await this.dev.controlTransferIn(this.ctrl(0x0a, (0x01 << 8) | 0x20), 1); // required dummy read
    }
    async i2cWrite(bytes) { await this.dev.controlTransferOut(this.ctrl((BLK.IIC << 8) | 0x10, this.tunerAddr), Uint8Array.from(bytes)); }
    async i2cRead(len) { const r = await this.dev.controlTransferIn(this.ctrl(BLK.IIC << 8, this.tunerAddr), len); return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); }
    async repeater(on) { await this.demodWrite(1, 0x01, on ? 0x18 : 0x10, 1); }
    async r82Write(reg, val) { this.shadow[reg] = val; await this.i2cWrite([reg, val]); }
    async r82Mask(reg, val, mask) { await this.r82Write(reg, (this.shadow[reg] & ~mask) | (val & mask)); }
    async r82Read(len) { await this.i2cWrite([0x00]); const raw = await this.i2cRead(len); return Array.from(raw, bitrev8); }

    async open() {
      const d = this.dev;
      await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      await d.claimInterface(0);
      this.name = rtlName(d) || "RTL-SDR";
      if (/RTL-SDR/i.test(d.productName || "") || /Blog/i.test(d.manufacturerName || "")) this.name = (d.productName || "RTL-SDR").slice(0, 40);
      await this.initBaseband();
      await this.repeater(true);
      let id = null;
      for (const addr of [0x34, 0x74]) { this.tunerAddr = addr; try { const r = await this.r82Read(1); if (r[0] === 0x69) { id = addr; break; } } catch (e) { /* not at this address */ } }
      if (id == null) { await this.repeater(false); throw new Error("This RTL-SDR uses an older tuner (E4000/FC0012/FC0013) that Phase 1 does not support yet."); }
      this.tuner = id === 0x74 ? "R828D" : "R820T/R820T2";
      await this.r82Init();
      await this.repeater(false);
      await this.demodWrite(1, 0xb1, 0x1a, 1); // in-phase ADC input only (no zero-IF)
      await this.demodWrite(0, 0x08, 0x4d, 1);
      await this.setIf(IF_HZ);
      await this.demodWrite(1, 0x15, 0x01, 1); // spectrum inversion for the R82xx IF
      await this.setBiasT(false); // always off on connect
      return this;
    }
    async initBaseband() {
      await this.writeReg(BLK.USB, REG.USB_SYSCTL, 0x09, 1);
      await this.writeReg(BLK.USB, REG.USB_EPA_MAXPKT, 0x0002, 2);
      await this.writeReg(BLK.USB, REG.USB_EPA_CTL, 0x1002, 2);
      await this.writeReg(BLK.SYS, REG.DEMOD_CTL_1, 0x22, 1);
      await this.writeReg(BLK.SYS, REG.DEMOD_CTL, 0xe8, 1);
      await this.demodWrite(1, 0x01, 0x14, 1);
      await this.demodWrite(1, 0x01, 0x10, 1);
      await this.demodWrite(1, 0x15, 0x00, 1);
      await this.demodWrite(1, 0x16, 0x0000, 2);
      for (let i = 0; i < 6; i += 1) await this.demodWrite(1, 0x16 + i, 0x00, 1);
      // default FIR: 8 x 8-bit + 8 x 12-bit coefficients packed into 20 bytes
      const fir = new Uint8Array(20);
      for (let i = 0; i < 8; i += 1) fir[i] = FIR[i] & 0xff;
      for (let i = 0; i < 8; i += 2) {
        const v0 = FIR[8 + i], v1 = FIR[8 + i + 1], o = 8 + (i * 3) / 2;
        fir[o] = (v0 >> 4) & 0xff; fir[o + 1] = ((v0 << 4) | ((v1 >> 8) & 0x0f)) & 0xff; fir[o + 2] = v1 & 0xff;
      }
      for (let i = 0; i < 20; i += 1) await this.demodWrite(1, 0x1c + i, fir[i], 1);
      await this.demodWrite(0, 0x19, 0x05, 1); // SDR mode, DAGC off
      await this.demodWrite(1, 0x93, 0xf0, 1);
      await this.demodWrite(1, 0x94, 0x0f, 1);
      await this.demodWrite(1, 0x11, 0x00, 1);
      await this.demodWrite(1, 0x04, 0x00, 1);
      await this.demodWrite(0, 0x61, 0x60, 1);
      await this.demodWrite(0, 0x06, 0x80, 1);
      await this.demodWrite(1, 0xb1, 0x1b, 1);
      await this.demodWrite(0, 0x0d, 0x83, 1);
    }
    async setIf(hz) {
      const v = -Math.floor((hz * 4194304) / XTAL);
      await this.demodWrite(1, 0x19, (v >> 16) & 0x3f, 1);
      await this.demodWrite(1, 0x1a, (v >> 8) & 0xff, 1);
      await this.demodWrite(1, 0x1b, v & 0xff, 1);
    }
    async r82Init() {
      for (let i = 0; i < R82_INIT.length; i += 1) this.shadow[5 + i] = R82_INIT[i];
      for (let i = 0; i < R82_INIT.length; i += 1) await this.i2cWrite([5 + i, R82_INIT[i]]);
      await this.r82Mask(0x0c, 0x00, 0x0f);
      await this.r82Mask(0x13, 49, 0x3f);
      await this.r82Mask(0x1d, 0x00, 0x38);
      // channel filter calibration (narrow 6 MHz digital mode, good for SDR use)
      let cal = 0;
      for (let i = 0; i < 2; i += 1) {
        await this.r82Mask(0x0b, 0x6b, 0x60);
        await this.r82Mask(0x0f, 0x04, 0x04);
        await this.r82Mask(0x10, 0x00, 0x03);
        await this.setPll(56000000);
        await this.r82Mask(0x0b, 0x10, 0x10);
        await this.r82Mask(0x0b, 0x00, 0x10);
        await this.r82Mask(0x0f, 0x00, 0x04);
        const r = await this.r82Read(5);
        cal = r[4] & 0x0f;
        if (cal && cal !== 0x0f) break;
      }
      if (cal === 0x0f) cal = 0;
      await this.r82Mask(0x0a, 0x10 | cal, 0x1f);
      await this.r82Mask(0x0b, 0x6b, 0xef);
      await this.r82Mask(0x07, 0x00, 0x80);
      await this.r82Mask(0x06, 0x10, 0x30);
      await this.r82Mask(0x1e, 0x60, 0x60);
      await this.r82Mask(0x05, 0x00, 0x80);
      await this.r82Mask(0x1f, 0x00, 0x80);
      await this.r82Mask(0x0f, 0x00, 0x80);
      await this.r82Mask(0x19, 0x60, 0x60);
      // system frequency selection (digital)
      await this.r82Mask(0x1d, 0xe5, 0xc7);
      await this.r82Mask(0x1c, 0x24, 0xf8);
      await this.r82Write(0x0d, 0x53);
      await this.r82Write(0x0e, 0x75);
      await this.r82Mask(0x05, 0x00, 0x60);
      await this.r82Mask(0x06, 0x00, 0x08);
      await this.r82Mask(0x11, 0x38, 0x38);
      await this.r82Mask(0x17, 0x30, 0x30);
      await this.r82Mask(0x0a, 0x40, 0x60);
      await this.r82Mask(0x1d, 0x00, 0x38);
      await this.r82Mask(0x1c, 0x00, 0x04);
      await this.r82Mask(0x06, 0x00, 0x40);
      await this.r82Mask(0x1a, 0x30, 0x30);
      await this.r82Mask(0x1d, 0x18, 0x38);
      await this.r82Mask(0x1c, 0x24, 0x04);
      await this.r82Mask(0x1e, 14, 0x1f);
      await this.r82Mask(0x1a, 0x20, 0x30);
    }
    async setMux(hz) {
      const mhz = hz / 1e6;
      let r = R82_RANGES[0];
      for (const x of R82_RANGES) if (mhz >= x[0]) r = x;
      await this.r82Mask(0x17, r[1], 0x08);
      await this.r82Mask(0x1a, r[2], 0xc3);
      await this.r82Write(0x1b, r[3]);
      await this.r82Mask(0x10, 0x00, 0x0b);
      await this.r82Mask(0x08, 0x00, 0x3f);
      await this.r82Mask(0x09, 0x00, 0x3f);
    }
    async setPll(lo) {
      const vcoMin = 1770000, vcoMax = vcoMin * 2, refKhz = XTAL / 1000, freqKhz = Math.round(lo / 1000);
      await this.r82Mask(0x10, 0x00, 0x10);
      await this.r82Mask(0x1a, 0x00, 0x0c);
      await this.r82Mask(0x12, 0x80, 0xe0);
      let mix = 2, div = 0;
      while (mix <= 64) {
        if (freqKhz * mix >= vcoMin && freqKhz * mix < vcoMax) { let b = mix; while (b > 2) { b >>= 1; div += 1; } break; }
        mix <<= 1;
      }
      const st = await this.r82Read(5);
      const fine = (st[4] & 0x30) >> 4;
      if (fine > 2) div -= 1; else if (fine < 2) div += 1;
      await this.r82Mask(0x10, div << 5, 0xe0);
      const vco = lo * mix;
      const nint = Math.floor(vco / (2 * XTAL));
      let fra = Math.floor((vco - 2 * XTAL * nint) / 1000);
      const ni = Math.floor((nint - 13) / 4), si = nint - 4 * ni - 13;
      await this.r82Write(0x14, (ni + (si << 6)) & 0xff);
      await this.r82Mask(0x12, fra ? 0x00 : 0x08, 0x08);
      let sdm = 0, n = 2;
      while (fra > 1) {
        if (fra > (2 * refKhz) / n) { sdm += 32768 / (n / 2); fra -= (2 * refKhz) / n; if (n >= 0x8000) break; }
        n <<= 1;
      }
      sdm = Math.round(sdm);
      await this.r82Write(0x16, (sdm >> 8) & 0xff);
      await this.r82Write(0x15, sdm & 0xff);
      for (let i = 0; i < 2; i += 1) {
        const s = await this.r82Read(3);
        if (s[2] & 0x40) break;
        await this.r82Mask(0x12, 0x60, 0xe0);
      }
      await this.r82Mask(0x1a, 0x08, 0x08);
    }
    async setFrequency(hz) {
      hz = Math.round(Math.max(this.minHz, Math.min(this.maxHz, hz)));
      if (hz < 24e6) { // direct sampling (Q branch) for HF below the tuner's range
        if (!this.direct) { await this.demodWrite(1, 0xb1, 0x1a, 1); await this.demodWrite(0, 0x08, 0x4d, 1); await this.demodWrite(0, 0x06, 0x90, 1); await this.demodWrite(1, 0x15, 0x00, 1); this.direct = true; }
        const v = Math.floor((hz * 4194304) / XTAL);
        await this.demodWrite(1, 0x19, (v >> 16) & 0x3f, 1); await this.demodWrite(1, 0x1a, (v >> 8) & 0xff, 1); await this.demodWrite(1, 0x1b, v & 0xff, 1);
      } else {
        if (this.direct) { await this.demodWrite(0, 0x06, 0x80, 1); await this.demodWrite(1, 0xb1, 0x1a, 1); await this.demodWrite(0, 0x08, 0x4d, 1); await this.setIf(IF_HZ); await this.demodWrite(1, 0x15, 0x01, 1); this.direct = false; }
        await this.repeater(true);
        try { await this.setMux(hz + IF_HZ); await this.setPll(hz + IF_HZ); } finally { await this.repeater(false); }
      }
      this.freq = hz;
    }
    async setSampleRate(sps) {
      const ratio = Math.floor((XTAL * 4194304) / sps) & 0x0ffffffc;
      await this.demodWrite(1, 0x9f, (ratio >> 16) & 0xffff, 2);
      await this.demodWrite(1, 0xa1, ratio & 0xffff, 2);
      await this.demodWrite(1, 0x3f, 0x00, 1); // ppm correction 0
      await this.demodWrite(1, 0x3e, 0x00, 1);
      await this.demodWrite(1, 0x01, 0x14, 1);
      await this.demodWrite(1, 0x01, 0x10, 1);
      this.rate = (XTAL * 4194304) / ratio;
    }
    async setGain(pct) { // 0..100 -> manual LNA + mixer steps, VGA fixed
      const want = (Math.max(0, Math.min(100, pct)) / 100) * 496; // tenths of dB (0..49.6)
      let total = 0, lna = 0, mix = 0;
      for (let i = 0; i < 15 && total < want; i += 1) {
        if (i % 2 === 0) { lna += 1; total += LNA_STEPS[lna]; } else { mix += 1; total += MIX_STEPS[mix]; }
      }
      await this.repeater(true);
      try {
        await this.r82Mask(0x05, 0x10, 0x10);
        await this.r82Mask(0x07, 0x00, 0x10);
        await this.r82Mask(0x0c, 0x08, 0x9f);
        await this.r82Mask(0x05, lna, 0x0f);
        await this.r82Mask(0x07, mix, 0x0f);
      } finally { await this.repeater(false); }
      this.gainText = (total / 10).toFixed(1) + " dB";
    }
    async setBiasT(on) { // GPIO0 on RTL-SDR Blog V3/V4
      const gpd = await this.readReg(BLK.SYS, REG.GPD, 1);
      await this.writeReg(BLK.SYS, REG.GPD, gpd & ~1, 1);
      const oe = await this.readReg(BLK.SYS, REG.GPOE, 1);
      await this.writeReg(BLK.SYS, REG.GPOE, oe | 1, 1);
      const o = await this.readReg(BLK.SYS, REG.GPO, 1);
      await this.writeReg(BLK.SYS, REG.GPO, on ? o | 1 : o & ~1, 1);
      this.biasT = Boolean(on);
    }
    async start(onData, onDrop) {
      await this.writeReg(BLK.USB, REG.USB_EPA_CTL, 0x1002, 2); // reset the FIFO
      await this.writeReg(BLK.USB, REG.USB_EPA_CTL, 0x0000, 2);
      bulkLoop(this, 1, 131072, 4, onData, onDrop);
    }
    async stop() { this.running = false; }
    async close() { this.running = false; try { await this.setBiasT(false); } catch (e) {} try { await this.dev.releaseInterface(0); } catch (e) {} try { await this.dev.close(); } catch (e) {} }
  }

  // ------------------------------------------------------------------ PortaPack (Mayhem) -> HackRF mode
  const SWITCH_CMD = new TextEncoder().encode("hackrf\r\n");
  async function portapackSwitchUsb(dev) {
    await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    const ifs = dev.configuration.interfaces;
    const comm = ifs.find((i) => i.alternates.some((a) => a.interfaceClass === 2));
    const data = ifs.find((i) => i.alternates.some((a) => a.interfaceClass === 10));
    if (!data) throw new Error("PortaPack serial port not found");
    if (comm) await dev.claimInterface(comm.interfaceNumber);
    await dev.claimInterface(data.interfaceNumber);
    if (comm) {
      const lc = new DataView(new ArrayBuffer(7)); lc.setUint32(0, 115200, true); lc.setUint8(4, 0); lc.setUint8(5, 0); lc.setUint8(6, 8);
      await dev.controlTransferOut({ requestType: "class", recipient: "interface", request: 0x20, value: 0, index: comm.interfaceNumber }, lc.buffer);
      await dev.controlTransferOut({ requestType: "class", recipient: "interface", request: 0x22, value: 0x03, index: comm.interfaceNumber });
    }
    const ep = data.alternates[0].endpoints.find((e) => e.direction === "out");
    await dev.transferOut(ep.endpointNumber, SWITCH_CMD);
    try { await dev.close(); } catch (e) { /* it reboots into HackRF mode */ }
  }
  async function portapackSwitchSerial() { // Web Serial fallback (needs a fresh click)
    const port = await root.navigator.serial.requestPort({ filters: [{ usbVendorId: PORTAPACK.vendorId, usbProductId: PORTAPACK.productId }] });
    await port.open({ baudRate: 115200 });
    const w = port.writable.getWriter();
    await w.write(SWITCH_CMD);
    w.releaseLock();
    try { await port.close(); } catch (e) { /* it reboots into HackRF mode */ }
  }

  // ------------------------------------------------------------------ public API
  async function openDevice(dev) {
    const kind = kindOf(dev);
    if (kind === "portapack") return { portapack: true, dev };
    const drv = kind === "hackrf" ? new HackRF(dev) : kind === "rtl" ? new RtlSdr(dev) : null;
    if (!drv) throw new Error("That USB device is not a supported radio.");
    try { await drv.open(); }
    catch (e) { try { await dev.close(); } catch (x) {} const err = new Error(friendlyError(e, kind)); err.kind = kind; throw err; }
    return drv;
  }
  async function request() { // must run from a click
    const dev = await root.navigator.usb.requestDevice({ filters: FILTERS });
    return openDevice(dev);
  }
  async function granted() { // radios this site was already allowed to use
    const list = await root.navigator.usb.getDevices();
    return list.filter((d) => kindOf(d));
  }
  async function waitForHackrf(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const list = await root.navigator.usb.getDevices();
      const hr = list.find((d) => kindOf(d) === "hackrf");
      if (hr) return hr;
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  }

  // Test-signal device for automated QA only (created by the dev hook in sdr-popup.js).
  // It never touches USB; its samples are generated inside the DSP worker.
  class SimDevice {
    constructor(profile) {
      const rtl = profile === "rtl";
      this.kind = "sim"; this.fmt = "s8"; this.sim = true; this.running = false; this.biasT = false;
      this.name = rtl ? "RTL-SDR Blog V4 · test signal" : "HackRF Pro · test signal";
      this.version = rtl ? "R828D" : "test";
      this.minHz = rtl ? 24e6 : 1e6; this.maxHz = rtl ? 1766e6 : 6e9; this.biasVolts = rtl ? "4.5 V" : "3.3 V";
    }
    async open() { return this; }
    async setFrequency(hz) { this.freq = hz; }
    async setSampleRate(sps) { this.rate = sps; }
    async setGain(pct) { this.gainText = Math.round(pct) + "%"; }
    async setBiasT(on) { this.biasT = Boolean(on); }
    async start() { this.running = true; }
    async stop() { this.running = false; }
    async close() { this.running = false; }
  }

  root.GsaSdrDriver = {
    support, request, granted, openDevice, waitForHackrf, kindOf, friendlyError,
    portapackSwitchUsb, portapackSwitchSerial, SimDevice,
    FILTERS, MODE_RX, MODE_OFF,
  };
})(window);
