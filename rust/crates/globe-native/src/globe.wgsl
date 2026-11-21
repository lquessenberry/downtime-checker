struct Globals {
    view_proj: mat4x4<f32>,
    // xyz: direction towards the sun, w: unused.
    sun: vec4<f32>,
};
@group(0) @binding(0) var<uniform> globals: Globals;

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

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    let light = 0.35 + 0.65 * max(dot(n, normalize(globals.sun.xyz)), 0.0);
    // Placeholder ocean tint until imagery tiles land (phase 3).
    var color = vec3<f32>(0.05, 0.16, 0.30) * light;
    let grid = max(grid_line(in.lat_lon.x, 15.0, 1.0), grid_line(in.lat_lon.y, 15.0, 1.0));
    let equator = grid_line(in.lat_lon.x, 180.0, 2.0);
    color = mix(color, vec3<f32>(0.30, 0.60, 0.75), grid * 0.55);
    color = mix(color, vec3<f32>(0.95, 0.75, 0.25), equator * 0.8);
    return vec4<f32>(color, 1.0);
}
