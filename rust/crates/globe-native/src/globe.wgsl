struct Globals {
    view_proj: mat4x4<f32>,
    // xyz: direction towards the sun, w: graticule mix 0..1.
    sun: vec4<f32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var earth_tex: texture_2d<f32>;
@group(0) @binding(2) var earth_samp: sampler;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) lat_lon: vec2<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>, @location(1) lat_lon: vec2<f32>) -> VsOut {
    var out: VsOut;
    out.clip = globals.view_proj * vec4<f32>(position, 1.0);
    out.normal = position;
    out.lat_lon = lat_lon;
    return out;
}

fn grid_line(v: f32, step: f32, width: f32) -> f32 {
    let d = abs(fract(v / step + 0.5) - 0.5) * step;
    let w = fwidth(v) * width;
    return 1.0 - smoothstep(0.0, w, d);
}

fn equirect_uv(lat_lon: vec2<f32>) -> vec2<f32> {
    // lat +90 at the north pole, lon -180..180. Texture v=0 is the north row.
    let u = lat_lon.y / 360.0 + 0.5;
    let v = 0.5 - lat_lon.x / 180.0;
    return vec2<f32>(u, v);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    let light = 0.38 + 0.62 * max(dot(n, normalize(globals.sun.xyz)), 0.0);
    let albedo = textureSample(earth_tex, earth_samp, equirect_uv(in.lat_lon)).rgb;
    var color = albedo * light;
    let grid_amt = clamp(globals.sun.w, 0.0, 1.0);
    let grid = max(grid_line(in.lat_lon.x, 15.0, 1.0), grid_line(in.lat_lon.y, 15.0, 1.0));
    let equator = grid_line(in.lat_lon.x, 180.0, 2.0);
    color = mix(color, vec3<f32>(0.85, 0.95, 1.0), grid * 0.35 * grid_amt);
    color = mix(color, vec3<f32>(0.95, 0.75, 0.25), equator * 0.7 * grid_amt);
    return vec4<f32>(color, 1.0);
}
