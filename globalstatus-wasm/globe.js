const globe = document.getElementById("globe");
const overlay = document.getElementById("overlay");
const octx = overlay.getContext("2d");
const earth = new Image();
earth.src = "./earth.jpg";
earth.crossOrigin = "anonymous";

let yaw = 0.4;
let pitch = 0.15;
let zoom = 1;
let dragging = false;
let moved = 0;
let lastX = 0;
let lastY = 0;
let gz = null;
let rings = null;
let wasmReady = false;
let wasm = null;
let grove = { leaves: [] };
let pins = [];
let selected = null;
let glapi = null;

function resize() {
  const stage = document.getElementById("stage");
  const rect = stage.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width * devicePixelRatio));
  const h = Math.max(320, Math.floor(rect.height * devicePixelRatio));
  for (const c of [globe, overlay]) {
    c.width = w;
    c.height = h;
  }
  if (glapi) glapi.resize();
  requestDraw();
}

function radius() {
  return Math.min(globe.width, globe.height) * 0.42 * zoom;
}

function project(lat, lon) {
  const latr = (lat * Math.PI) / 180;
  const lonr = (lon * Math.PI) / 180 + yaw;
  let x = Math.cos(latr) * Math.sin(lonr);
  let y = Math.sin(latr);
  let z = Math.cos(latr) * Math.cos(lonr);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z * sp;
  const z2 = y * sp + z * cp;
  if (z2 < 0) return null;
  const r = radius();
  return { x: globe.width / 2 + x * r, y: globe.height / 2 - y2 * r, z: z2 };
}

function latLonFromPixel(px, py) {
  const r = radius();
  const cx = globe.width / 2;
  const cy = globe.height / 2;
  let x = (px - cx) / r;
  let y = (cy - py) / r;
  const d = x * x + y * y;
  if (d > 1) return null;
  let z = Math.sqrt(1 - d);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp + z * sp;
  const z2 = -y * sp + z * cp;
  const lat = Math.asin(Math.max(-1, Math.min(1, y2)));
  const lon = Math.atan2(x, z2) - yaw;
  return { lat: (lat * 180) / Math.PI, lon: (((lon * 180) / Math.PI + 540) % 360) - 180 };
}

function initGl() {
  const gl = globe.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(
    vs,
    `attribute vec3 aPos; attribute vec2 aUv;
     uniform float uYaw, uPitch, uSx, uSy;
     varying vec2 vUv;
     void main() {
       float c = cos(uYaw), s = sin(uYaw);
       vec3 p = aPos;
       float x = p.x * c + p.z * s;
       float z = p.z * c - p.x * s;
       float cp = cos(uPitch), sp = sin(uPitch);
       float y = p.y * cp - z * sp;
       z = p.y * sp + z * cp;
       gl_Position = vec4(x * uSx, y * uSy, -z * 0.5, 1.0);
       vUv = aUv;
     }`
  );
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(
    fs,
    `precision mediump float; uniform sampler2D uTex; varying vec2 vUv;
     void main() { gl_FragColor = texture2D(uTex, vUv); }`
  );
  gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return {
      draw() {
        gl.viewport(0, 0, globe.width, globe.height);
        gl.clearColor(0.02, 0.027, 0.043, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      resize() {},
    };
  }

  const latBands = 48;
  const lonBands = 96;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let iy = 0; iy <= latBands; iy++) {
    const lat = (iy / latBands) * Math.PI - Math.PI / 2;
    for (let ix = 0; ix <= lonBands; ix++) {
      const lon = (ix / lonBands) * 2 * Math.PI - Math.PI;
      pos.push(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
      uv.push(ix / lonBands, 1 - iy / latBands);
    }
  }
  for (let iy = 0; iy < latBands; iy++) {
    for (let ix = 0; ix < lonBands; ix++) {
      const a = iy * (lonBands + 1) + ix;
      const b = a + lonBands + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const posBuf = gl.createBuffer();
  const uvBuf = gl.createBuffer();
  const iBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  if (earth.complete && earth.naturalWidth) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earth);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([18, 50, 74]));
    earth.addEventListener("load", () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earth);
      draw();
    });
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  const uYaw = gl.getUniformLocation(prog, "uYaw");
  const uPitch = gl.getUniformLocation(prog, "uPitch");
  const uSx = gl.getUniformLocation(prog, "uSx");
  const uSy = gl.getUniformLocation(prog, "uSy");
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aUv = gl.getAttribLocation(prog, "aUv");
  return {
    draw() {
      gl.viewport(0, 0, globe.width, globe.height);
      gl.clearColor(0.02, 0.027, 0.043, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      const r = radius();
      gl.uniform1f(uYaw, yaw);
      gl.uniform1f(uPitch, pitch);
      gl.uniform1f(uSx, (2 * r) / globe.width);
      gl.uniform1f(uSy, (2 * r) / globe.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    },
    resize() {},
  };
}

function drawFallback() {
  const ctx = globe.getContext("2d");
  if (!ctx) return;
  const w = globe.width;
  const h = globe.height;
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, w, h);
  const r = radius();
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (earth.complete && earth.naturalWidth) {
    const imgH = 2 * r;
    const imgW = imgH * (earth.naturalWidth / earth.naturalHeight);
    const shift = (yaw / (Math.PI * 2)) * imgW;
    ctx.drawImage(earth, cx - imgW / 2 + shift, cy - r, imgW, imgH);
    ctx.drawImage(earth, cx - imgW / 2 + shift - imgW, cy - r, imgW, imgH);
  } else {
    ctx.fillStyle = "#12324a";
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#2a3548";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawOverlay() {
  const w = overlay.width;
  const h = overlay.height;
  octx.clearRect(0, 0, w, h);
  const r = radius();
  octx.beginPath();
  octx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  octx.strokeStyle = "#2a3548";
  octx.lineWidth = 2;
  octx.stroke();

  for (const leaf of grove.leaves || []) {
    if (leaf.bundle === "geofence" && leaf.fields) {
      drawFence(leaf);
    }
    const pt = pointOf(leaf);
    if (!pt) continue;
    const p = project(pt.lat, pt.lon);
    if (!p) continue;
    octx.fillStyle = leaf.id === selected ? "#6ee7b7" : colorFor(leaf.bundle);
    octx.beginPath();
    octx.arc(p.x, p.y, leaf.id === selected ? 7 : 4, 0, Math.PI * 2);
    octx.fill();
  }

  for (const pin of pins) {
    if (pin.lat == null || pin.lon == null) continue;
    const p = project(pin.lat, pin.lon);
    if (!p) continue;
    octx.fillStyle = pin.status === "up" ? "#6ee7b7" : pin.status === "down" ? "#ff6b6b" : "#8b95a7";
    octx.beginPath();
    octx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    octx.fill();
  }

  if (gz) {
    const p = project(gz.lat, gz.lon);
    if (p) {
      octx.fillStyle = "#ff4d4d";
      octx.beginPath();
      octx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      octx.fill();
    }
    if (rings) {
      const colors = ["#ffb703", "#fb8500", "#d00000", "#7b2cbf", "#8d99ae"];
      const meters = [rings.fireballM, rings.heavyM, rings.mediumM, rings.lightM, rings.thermalM];
      meters.forEach((m, i) => {
        if (!m) return;
        const deg = m / 111320;
        octx.strokeStyle = colors[i];
        octx.lineWidth = 1.5;
        octx.beginPath();
        let started = false;
        for (let a = 0; a <= 360; a += 6) {
          const lat = gz.lat + deg * Math.cos((a * Math.PI) / 180);
          const lon = gz.lon + (deg * Math.sin((a * Math.PI) / 180)) / Math.cos((gz.lat * Math.PI) / 180);
          const q = project(lat, lon);
          if (!q) {
            started = false;
            continue;
          }
          if (!started) {
            octx.moveTo(q.x, q.y);
            started = true;
          } else octx.lineTo(q.x, q.y);
        }
        octx.stroke();
      });
    }
  }
}

function drawFence(leaf) {
  const f = leaf.fields;
  if (f.west == null) return;
  octx.strokeStyle = "rgba(110,231,183,.55)";
  octx.lineWidth = 1.5;
  octx.beginPath();
  const ring = [
    [f.south, f.west],
    [f.south, f.east],
    [f.north, f.east],
    [f.north, f.west],
    [f.south, f.west],
  ];
  let started = false;
  for (const [lat, lon] of ring) {
    const q = project(lat, lon);
    if (!q) {
      started = false;
      continue;
    }
    if (!started) {
      octx.moveTo(q.x, q.y);
      started = true;
    } else octx.lineTo(q.x, q.y);
  }
  octx.stroke();
}

function colorFor(bundle) {
  return {
    geolocation: "#6ee7b7",
    geofence: "#fbbf24",
    geoorbital: "#93c5fd",
    geocell: "#c4b5fd",
    catalog: "#fda4af",
  }[bundle] || "#d7dde8";
}

function pointOf(leaf) {
  const f = leaf.fields || {};
  if (typeof f.lat === "number" && typeof f.lon === "number") return { lat: f.lat, lon: f.lon };
  return null;
}

function draw() {
  if (glapi) glapi.draw();
  else drawFallback();
  drawOverlay();
}

let raf = 0;
function requestDraw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}

function eventPos(ev) {
  const rect = globe.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (globe.width / rect.width),
    y: (ev.clientY - rect.top) * (globe.height / rect.height),
  };
}

globe.addEventListener("pointerdown", (ev) => {
  dragging = true;
  moved = 0;
  lastX = ev.clientX;
  lastY = ev.clientY;
  globe.setPointerCapture(ev.pointerId);
});
globe.addEventListener("pointermove", (ev) => {
  if (!dragging) return;
  const dx = ev.clientX - lastX;
  const dy = ev.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  yaw += dx * 0.005;
  pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.005));
  lastX = ev.clientX;
  lastY = ev.clientY;
  requestDraw();
});
globe.addEventListener("pointerup", (ev) => {
  if (!dragging) return;
  dragging = false;
  if (moved > 8) {
    draw();
    return;
  }
  const { x, y } = eventPos(ev);
  const ll = latLonFromPixel(x, y);
  if (ll) {
    gz = ll;
    selected = null;
    showContext(ll.lat, ll.lon);
    draw();
  }
});
globe.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    zoom = Math.max(0.7, Math.min(3.2, zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
    requestDraw();
  },
  { passive: false }
);

function showContext(lat, lon) {
  let ctx = null;
  if (wasmReady && wasm) {
    try {
      ctx = JSON.parse(wasm.rustle_context_json(lat, lon));
    } catch (_) {}
  }
  const apply = (ctx) => {
    const fences = (ctx.fences || []).map((l) => l.label).join(", ") || "none";
    const nearby = (ctx.nearby || [])
      .slice(0, 5)
      .map((row) => `${row.leaf.label} (${row.km} km)`)
      .join("\n");
    const orbitals = (ctx.orbitals || []).map((l) => `${l.label} ${l.fields.altitude_km || ""}km`).join("\n");
    document.getElementById("ctx").textContent =
      `${lat.toFixed(2)}, ${lon.toFixed(2)}\nFences: ${fences}\nNearby:\n${nearby || "—"}\nOrbit:\n${orbitals || "—"}`;
  };
  if (ctx) apply(ctx);
  else {
    fetch(`/api/leaves/context?lat=${lat}&lon=${lon}`)
      .then((r) => r.json())
      .then(apply)
      .catch((err) => {
        document.getElementById("ctx").textContent = String(err);
      });
  }
}

function renderLeaves() {
  const box = document.getElementById("leaves");
  box.innerHTML = (grove.leaves || [])
    .map(
      (leaf) =>
        `<div class="leaf" data-id="${leaf.id}"><span>${leaf.label}</span><b>${leaf.bundle}</b></div>`
    )
    .join("");
  box.querySelectorAll(".leaf").forEach((el) => {
    el.addEventListener("click", () => {
      const leaf = grove.leaves.find((item) => item.id === el.dataset.id);
      if (!leaf) return;
      selected = leaf.id;
      const pt = pointOf(leaf);
      if (pt) {
        yaw = (-pt.lon * Math.PI) / 180;
        pitch = (pt.lat * Math.PI) / 180 * 0.4;
        gz = pt;
        showContext(pt.lat, pt.lon);
      } else {
        document.getElementById("ctx").textContent = JSON.stringify(leaf, null, 2);
      }
      draw();
    });
  });
}

function renderPins() {
  const box = document.getElementById("pins");
  box.innerHTML = pins
    .map((pin) => {
      const st = pin.status || "pending";
      return `<div class="pin" data-i="${pin.index}"><span>${pin.name}</span><b>${st}</b></div>`;
    })
    .join("");
  box.querySelectorAll(".pin").forEach((el) => {
    el.addEventListener("click", () => {
      const pin = pins[Number(el.dataset.i)];
      if (!pin || pin.lat == null) return;
      yaw = (-pin.lon * Math.PI) / 180;
      gz = { lat: pin.lat, lon: pin.lon };
      showContext(pin.lat, pin.lon);
      draw();
    });
  });
}

function joinPin(pin) {
  if (pin.lat != null && pin.lon != null) return pin;
  const leaf = (grove.leaves || []).find(
    (item) => item.fields && item.fields.address === pin.address && pointOf(item)
  );
  if (leaf) {
    const pt = pointOf(leaf);
    pin.lat = pt.lat;
    pin.lon = pt.lon;
  }
  return pin;
}

function loadCatalog() {
  return fetch("/api/catalog")
    .then((r) => r.json())
    .then((data) => {
      const sel = document.getElementById("search");
      const searches = data.searches || [];
      sel.innerHTML = searches
        .map((s) => `<option value="${s.id}">${s.label} (${s.count})</option>`)
        .join("");
      if ([...sel.options].some((o) => o.value === "weather")) sel.value = "weather";
    })
    .catch((err) => {
      document.getElementById("note").textContent = `catalog: ${err}`;
    });
}

function connectEvents() {
  const src = new EventSource("/api/events");
  src.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (msg.type === "scan-start") {
      document.getElementById("scanstat").textContent = `0/${msg.total}`;
      pins = [];
    }
    if (msg.type === "result") {
      const pin = joinPin(msg.result);
      pins[pin.index] = pin;
      document.getElementById("scanstat").textContent = `${msg.done}/${msg.total}  ↑${msg.up} ↓${msg.down}`;
      renderPins();
      draw();
    }
    if (msg.type === "location") {
      const pin = joinPin(msg.result);
      pins[pin.index] = pin;
      renderPins();
      draw();
    }
    if (msg.type === "scan-done") {
      document.getElementById("scanstat").textContent = `done ↑${msg.up} ↓${msg.down}`;
    }
    if (msg.type === "scan-stop") {
      document.getElementById("scanstat").textContent = "stopped";
    }
  };
}

document.getElementById("check").addEventListener("click", () => {
  const id = document.getElementById("search").value;
  fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
    .then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        document.getElementById("scanstat").textContent = j.error || r.statusText;
      }
    })
    .catch((err) => {
      document.getElementById("scanstat").textContent = String(err);
    });
});
document.getElementById("stop").addEventListener("click", () => {
  fetch("/api/stop", { method: "POST" });
});

document.getElementById("fire").addEventListener("click", () => {
  if (!gz) {
    document.getElementById("card").textContent = "Click the globe first.";
    return;
  }
  const kt = Number(document.getElementById("kt").value);
  const air = Number(document.getElementById("air").value);
  if (wasmReady && wasm) {
    rings = JSON.parse(wasm.blast_rings_json(kt, air));
    document.getElementById("card").textContent = wasm.blast_card_text(gz.lat, gz.lon, kt, air);
    document.getElementById("defcon").textContent = String(wasm.blast_defcon_level(1, kt));
  } else {
    fetch(`/api/blast?kt=${kt}&air=${air}&lat=${gz.lat}&lon=${gz.lon}`)
      .then((r) => r.json())
      .then((j) => {
        rings = j;
        document.getElementById("card").textContent = j.card || JSON.stringify(j, null, 2);
      });
  }
  draw();
});

window.addEventListener("resize", resize);
earth.onload = () => draw();

function loadGrove(raw) {
  grove = typeof raw === "string" ? JSON.parse(raw) : raw;
  renderLeaves();
}

import("./downtime_wasm.js")
  .then(async (mod) => {
    await mod.default();
    wasm = mod;
    wasmReady = true;
    document.getElementById("runtime").textContent = "downtime-wasm + rustle";
    document.getElementById("note").textContent = wasm.runtime_note();
    loadGrove(wasm.rustle_grove_json());
  })
  .catch((err) => {
    document.getElementById("runtime").textContent = "server fallback";
    document.getElementById("note").textContent = String(err);
    return fetch("/api/leaves")
      .then((r) => r.json())
      .then(loadGrove);
  })
  .finally(() => {
    loadCatalog();
    connectEvents();
  });

glapi = initGl();
resize();
