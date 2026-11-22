/**
 * Frida on a globe we own (downtime-globe). Never attach to Google Earth.
 *
 *   frida -n downtime-globe -l scripts/globe-re/templates/frida_hooks.js
 *
 * Answers what the process does: outbound sockets (tile CDNs, AIS, ADS-B).
 */

function log(msg) {
  console.log("[globe-re] " + msg);
}

if (Process.platform === "darwin" || Process.platform === "linux") {
  const connect = Module.findExportByName(null, "connect");
  if (connect) {
    Interceptor.attach(connect, {
      onEnter(args) {
        try {
          const sa = args[1];
          const family = sa.readU16();
          if (family === 2) {
            const port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
            const ip = [
              sa.add(4).readU8(),
              sa.add(5).readU8(),
              sa.add(6).readU8(),
              sa.add(7).readU8(),
            ].join(".");
            log("connect " + ip + ":" + port);
          }
        } catch (err) {
          log("connect parse failed: " + err);
        }
      },
    });
    log("hooked connect()");
  }
}

log("ready. Toggle a live layer and watch tile / API sockets.");
