#!/usr/bin/env node
/* Unit tests for globalstatus/mesh-device.js (Connect Mesh decoder).
 * Vectors are known-good encodings produced with the official Meshtastic protobuf
 * definitions and MeshCore companion frames laid out per the public protocol.
 * Run: node scripts/test_mesh_device.js
 */
"use strict";
const assert = require("assert");
const M = require("../globalstatus/mesh-device.js");
const V = {
 "my_info": "1a0a08acb6e899044007782a",
 "node_info": "226508effdb6f50d12240a09216465616462656566120d486f7573746f6e2052696467651a0448524447282b38021a1d0da013bd111530b927c718f4ffffffffffffffff0125c0c62869b80120250000c8402d24c72869320c0857159a9981401d000048414802",
 "pkt_text": "12380d4d3c2b1a15ffffffff22130801120f48656c6c6f206d65736820f09f918b356300000045000060c04801609fffffffffffffffff017803",
 "pkt_position": "12210d4d3c2b1a15ffffffff2215080312110dc0c9e9eb15004a1f5a18377803980109",
 "pkt_telemetry": "12230d4d3c2b1a15ffffffff2217084312130d88c72869120c08651566668640250000c03f",
 "pkt_env": "12210d4d3c2b1a15ffffffff2215084312111a0f0d0000ac4115000020421dcd4c7d44",
 "pkt_nodeinfo": "12310d0df0ad0b152c1b3a432225080412210a09213062616466303064120b42617920547261636b65721a0342415928473805",
 "pkt_encrypted": "12140d0df0ad0b15ffffffff2a030102034500000040",
 "channel": "52230801121d1210000102030405060708090a0b0c0d0e0f1a094e65696768626f72731802",
 "lora": "2a0c320a08011004380140034801",
 "metadata": "6a140a0e322e362e31312e3630656330356528014809",
 "config_complete": "38c0c407",
 "to_want_config_123456": "18c0c407",
 "to_heartbeat": "3a00",
 "mc_contact": "03a1b2c3d4000000000000000000000000000000000000000000000000000000000200010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000048696c6c20526570656174657200000000000000000000000000000000000000c0c62869901bc601b8c550fac1c62869",
 "mc_self": "05011616feedface11111111111111111111111111111111111111111111111111111111603a6d0210c296fb00000000bde40d0024f4000007054d7920436f6d70616e696f6e",
 "mc_chan_v3": "11f60000000200ecc728695075626c69632068656c6c6f",
 "mc_dm": "07a1b2c3d4e5f6010050c82869446972656374206869",
 "mc_channel_info": "12005075626c6963000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
 "mc_device_info": "0d08af0840e2010032302d4e6f762d323032350048656c7465632056330000000000000000000000000000000000000000000000000000000000000076312e31302e3000000000000000000000000000",
 "mc_cmd_device_query": "1603",
 "mc_cmd_get_contacts": "04",
 "mc_cmd_sync": "0a",
 "mc_cmd_get_channel_0": "1f00"
};
const h = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), `${a} != ${b}`);
let n = 0;
function t(name, fn) { fn(); n += 1; console.log("ok - " + name); }

t("my_info", () => { const e = M.decodeFromRadio(h(V.my_info)); assert.strictEqual(e.type, "myInfo"); assert.strictEqual(e.myId, "!433a1b2c"); assert.strictEqual(e.rebootCount, 7); assert.strictEqual(e.nodedbCount, 42); });
t("node_info with user, position, metrics", () => {
  const e = M.decodeFromRadio(h(V.node_info));
  assert.strictEqual(e.type, "node"); assert.strictEqual(e.id, "!deadbeef"); assert.strictEqual(e.num, 0xdeadbeef);
  assert.strictEqual(e.user.longName, "Houston Ridge"); assert.strictEqual(e.user.shortName, "HRDG"); assert.strictEqual(e.user.hw, "Heltec V3"); assert.strictEqual(e.user.role, "Router");
  near(e.position.lat, 29.7604); near(e.position.lon, -95.3698); assert.strictEqual(e.position.alt, -12); assert.strictEqual(e.position.precisionBits, 32);
  near(e.snr, 6.25); assert.strictEqual(e.lastHeard, 1764280100); assert.strictEqual(e.metrics.battery, 87); near(e.metrics.voltage, 4.05, 1e-3); near(e.metrics.chUtil, 12.5); assert.strictEqual(e.hops, 2);
});
t("text packet (broadcast, hops, snr, rssi, utf-8)", () => {
  const e = M.decodeFromRadio(h(V.pkt_text));
  assert.strictEqual(e.type, "packet"); assert.strictEqual(e.fromId, "!1a2b3c4d"); assert.ok(e.broadcast); assert.strictEqual(e.port, 1); assert.strictEqual(e.text, "Hello mesh 👋");
  near(e.snr, -3.5); assert.strictEqual(e.rssi, -97); assert.strictEqual(e.hops, 2); assert.strictEqual(e.id, 99);
});
t("position packet (southern / eastern hemisphere)", () => { const e = M.decodeFromRadio(h(V.pkt_position)); near(e.position.lat, -33.7); near(e.position.lon, 151.2); assert.strictEqual(e.position.alt, 55); assert.strictEqual(e.position.sats, 9); assert.strictEqual(e.position.speed, 3); });
t("device telemetry packet", () => { const e = M.decodeFromRadio(h(V.pkt_telemetry)); assert.strictEqual(e.telemetry.device.battery, 101); near(e.telemetry.device.voltage, 4.2, 1e-3); near(e.telemetry.device.airUtilTx, 1.5); assert.strictEqual(e.telemetry.time, 1764280200); });
t("environment telemetry packet", () => { const e = M.decodeFromRadio(h(V.pkt_env)); near(e.telemetry.env.tempC, 21.5); near(e.telemetry.env.rh, 40); near(e.telemetry.env.pressure, 1013.2, 1e-2); });
t("node info packet (User payload)", () => { const e = M.decodeFromRadio(h(V.pkt_nodeinfo)); assert.strictEqual(e.user.longName, "Bay Tracker"); assert.strictEqual(e.user.role, "Tracker"); assert.strictEqual(e.user.hw, "Seeed T1000-E tracker"); assert.ok(!e.broadcast); assert.strictEqual(e.toId, "!433a1b2c"); });
t("encrypted packet", () => { const e = M.decodeFromRadio(h(V.pkt_encrypted)); assert.strictEqual(e.encrypted, true); assert.strictEqual(e.text, undefined); near(e.snr, 2); });
t("channel (name only, key never exposed)", () => { const e = M.decodeFromRadio(h(V.channel)); assert.deepStrictEqual([e.index, e.name, e.role, e.encrypted], [1, "Neighbors", "Secondary", true]); assert.ok(!("psk" in e)); });
t("lora config", () => { const e = M.decodeFromRadio(h(V.lora)); assert.strictEqual(e.preset, "Medium Fast"); assert.strictEqual(e.region, "US"); assert.strictEqual(e.hopLimit, 3); assert.strictEqual(e.txEnabled, true); });
t("metadata", () => { const e = M.decodeFromRadio(h(V.metadata)); assert.strictEqual(e.firmware, "2.6.11.60ec05e"); assert.strictEqual(e.hw, "RAK WisBlock 4631"); assert.strictEqual(e.bluetooth, true); });
t("config complete", () => { const e = M.decodeFromRadio(h(V.config_complete)); assert.deepStrictEqual(e, { type: "configComplete", id: 123456 }); });
t("ToRadio want_config_id + heartbeat match the official encoder", () => { assert.strictEqual(Buffer.from(M.mtWantConfig(123456)).toString("hex"), V.to_want_config_123456); assert.strictEqual(Buffer.from(M.mtHeartbeat()).toString("hex"), V.to_heartbeat); });
t("stream framer: split chunks, log noise, bad length", () => {
  const frames = [h(V.my_info), h(V.node_info), h(V.pkt_text)].map((p) => M.mtFrame(p));
  const noise = Buffer.from("INFO | ??:??:?? 3 [Main] boot > ok\r\n\x94\x00", "binary");
  const bad = Uint8Array.from([0x94, 0xc3, 0x7f, 0xff]);
  const all = Buffer.concat([noise, Buffer.from(frames[0]), bad, Buffer.from(frames[1]), noise, Buffer.from(frames[2])]);
  const push = M.MtFramer(); const out = [];
  for (let i = 0; i < all.length; i += 7) push(all.subarray(i, i + 7), (b) => out.push(M.decodeFromRadio(b)));
  assert.deepStrictEqual(out.map((e) => e.type), ["myInfo", "node", "packet"]);
});
t("MeshCore contact", () => { const e = M.decodeMeshCore(h(V.mc_contact)); assert.strictEqual(e.type, "mcContact"); assert.strictEqual(e.id, "!a1b2c3d4"); assert.strictEqual(e.kind, "Repeater"); assert.strictEqual(e.name, "Hill Repeater"); near(e.lat, 29.7604); near(e.lon, -95.3698); assert.strictEqual(e.lastAdvert, 1764280000); assert.strictEqual(e.hops, 1); });
t("MeshCore self info", () => { const e = M.decodeMeshCore(h(V.mc_self)); assert.strictEqual(e.id, "!feedface"); assert.strictEqual(e.name, "My Companion"); near(e.lat, 40.7128); near(e.lon, -74.006); near(e.freqMHz, 910.525); near(e.bwKHz, 62.5); assert.strictEqual(e.sf, 7); });
t("MeshCore channel message v3 + direct message", () => {
  const c = M.decodeMeshCore(h(V.mc_chan_v3)); assert.deepStrictEqual([c.dm, c.channel, c.snr, c.hops, c.text, c.time], [false, 0, -2.5, 2, "Public hello", 1764280300]);
  const d = M.decodeMeshCore(h(V.mc_dm)); assert.deepStrictEqual([d.dm, d.fromId, d.text, d.time, d.hops], [true, "!a1b2c3d4", "Direct hi", 1764280400, 1]);
});
t("MeshCore channel info + device info", () => { const c = M.decodeMeshCore(h(V.mc_channel_info)); assert.deepStrictEqual([c.index, c.name], [0, "Public"]); assert.ok(!("secret" in c)); const d = M.decodeMeshCore(h(V.mc_device_info)); assert.deepStrictEqual([d.model, d.version, d.maxContacts], ["Heltec V3", "v1.10.0", 350]); });
t("MeshCore framing both ways", () => {
  assert.strictEqual(Buffer.from(M.mcFrame(Uint8Array.from([0x16, 0x03]))).toString("hex"), "3c0200" + V.mc_cmd_device_query);
  const app = M.mcAppStart(); assert.strictEqual(app[0], 1); assert.strictEqual(app[1], 3);
  const inb = h(V.mc_contact); const fr = Buffer.concat([Buffer.from([0x3e, inb.length & 255, inb.length >> 8]), Buffer.from(inb)]);
  const out = []; const push = M.McFramer(); push(Buffer.concat([Buffer.from("junk"), fr]), (b) => out.push(M.decodeMeshCore(b)));
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].name, "Hill Repeater");
});
t("malformed protobuf throws instead of hanging", () => { assert.throws(() => M.decodeFromRadio(Uint8Array.from([0x12, 0x40, 0x01]))); });
console.log(`\n${n} tests passed`);
