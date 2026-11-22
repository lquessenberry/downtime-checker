import init, {
  blast_rings_json,
  blast_card_text,
  blast_defcon_level,
  layer_catalog,
  runtime_note,
} from "./downtime_wasm.js";

const canvas = document.getElementById("globe");
const ctx = canvas.getContext("2d");
const earth = new Image();
earth.src = "./earth.jpg";

let yaw = 0.4;
let dragging = false;
let lastX = 0;
let gz = null;
let rings = null;
let wasmReady = false;

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * devicePixelRatio));
  canvas.height = Math.max(320, Math.floor(rect.height * devicePixelRatio));
  draw();
}

function latLonFromPixel(px, py) {
  const w = canvas.width;
  const h = canvas.height;
  const r = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h / 2;
  const x = (px - cx) / r;
  const y = (cy - py) / r;
  const d = x * x + y * y;
  if (d > 1) return null;
  const z = Math.sqrt(1 - d);
  const lat = Math.asin(y);
  const lon = Math.atan2(x, z) - yaw;
  return { lat: (lat * 180) / Math.PI, lon: (((lon * 180) / Math.PI + 540) % 360) - 180 };
}

function project(lat, lon) {
  const latr = (lat * Math.PI) / 180;
  const lonr = (lon * Math.PI) / 180 + yaw;
  const x = Math.cos(latr) * Math.sin(lonr);
  const y = Math.sin(latr);
  const z = Math.cos(latr) * Math.cos(lonr);
  if (z < 0) return null;
  const r = Math.min(canvas.width, canvas.height) * 0.42;
  return { x: canvas.width / 2 + x * r, y: canvas.height / 2 - y * r, z };
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h / 2;
  const step = 2;
  if (earth.complete && earth.naturalWidth) {
    for (let py = cy - r; py < cy + r; py += step) {
      for (let px = cx - r; px < cx + r; px += step) {
        const ll = latLonFromPixel(px + step / 2, py + step / 2);
        if (!ll) continue;
        const u = ((ll.lon + 180) / 360) * earth.naturalWidth;
        const v = ((90 - ll.lat) / 180) * earth.naturalHeight;
        ctx.drawImage(earth, u, v, 1, 1, px, py, step, step);
      }
    }
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#12324a";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#2a3548";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (gz) {
    const p = project(gz.lat, gz.lon);
    if (p) {
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (rings) {
      const colors = ["#ffb703", "#fb8500", "#d00000", "#7b2cbf", "#8d99ae"];
      const meters = [rings.fireballM, rings.heavyM, rings.mediumM, rings.lightM, rings.thermalM];
      meters.forEach((m, i) => {
        if (!m) return;
        const deg = m / 111320;
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let a = 0; a <= 360; a += 6) {
          const lat = gz.lat + deg * Math.cos((a * Math.PI) / 180);
          const lon = gz.lon + deg * Math.sin((a * Math.PI) / 180) / Math.cos((gz.lat * Math.PI) / 180);
          const q = project(lat, lon);
          if (!q) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
          } else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      });
    }
  }
}

function eventPos(ev) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (ev.clientX - rect.left) * scaleX, y: (ev.clientY - rect.top) * scaleY };
}

canvas.addEventListener("pointerdown", (ev) => {
  dragging = true;
  lastX = ev.clientX;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener("pointermove", (ev) => {
  if (!dragging) return;
  yaw += (ev.clientX - lastX) * 0.005;
  lastX = ev.clientX;
  draw();
});
canvas.addEventListener("pointerup", (ev) => {
  if (!dragging) return;
  dragging = false;
  const { x, y } = eventPos(ev);
  const ll = latLonFromPixel(x, y);
  if (ll) {
    gz = ll;
    document.getElementById("gz").textContent = `${ll.lat.toFixed(2)}, ${ll.lon.toFixed(2)}`;
    draw();
  }
});

document.getElementById("fire").addEventListener("click", () => {
  if (!gz) return;
  const kt = Number(document.getElementById("kt").value);
  const air = Number(document.getElementById("air").value);
  if (wasmReady) {
    rings = JSON.parse(blast_rings_json(kt, air));
    document.getElementById("card").textContent = blast_card_text(gz.lat, gz.lon, kt, air);
    document.getElementById("defcon").textContent = String(blast_defcon_level(1, kt));
  } else {
    fetch(`/api/blast?kt=${kt}&air=${air}`)
      .then((r) => r.json())
      .then((j) => {
        rings = j;
        document.getElementById("card").textContent = JSON.stringify(j, null, 2);
      });
  }
  draw();
});

window.addEventListener("resize", resize);
earth.onload = draw;

init()
  .then(() => {
    wasmReady = true;
    document.getElementById("runtime").textContent = "downtime-wasm ready";
    document.getElementById("note").textContent = runtime_note();
    const layers = JSON.parse(layer_catalog());
    document.getElementById("layers").innerHTML = layers
      .map((layer) => `<div class="stat"><span>${layer.title}</span><b>${layer.kind}</b></div>`)
      .join("");
  })
  .catch((err) => {
    document.getElementById("runtime").textContent = "wasm missing; /api/blast fallback";
    document.getElementById("note").textContent = String(err);
  });

resize();
