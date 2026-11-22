"""Write compiling Rust engine stubs that match the Cesium module map.

Existing globe_math.rs / render.rs stay the live path. New files live under
src/engine/ and can be filled in one Cesium type at a time.
"""

from __future__ import annotations

from pathlib import Path

from knowledge import WGS84_RADII_M

ENGINE_MOD = '''//! Cesium-shaped engine pieces. The live draw path is still `render.rs` +
//! `globe_math.rs`. Types here exist so the rebuild can land one Cesium
//! module at a time without rewriting the window loop.

pub mod cartographic;
pub mod ellipsoid;
pub mod imagery;
pub mod primitives;
pub mod quadtree;
pub mod scene;
pub mod terrain;

pub use cartographic::Cartographic;
pub use ellipsoid::{Ellipsoid, WGS84_RADII_M};
pub use imagery::{Basemap, ImageryLayer};
pub use primitives::PointPrimitive;
pub use quadtree::QuadtreeTile;
pub use scene::SceneMode;
pub use terrain::TerrainKind;

#[cfg(test)]
mod smoke {
    use super::*;

    #[test]
    fn public_types_construct() {
        let _ = Cartographic::new(0.0, 0.0, 0.0);
        let _ = Ellipsoid::WGS84;
        let _ = Ellipsoid::WGS84.equatorial_radius_m();
        let _ = Ellipsoid::WGS84.polar_radius_m();
        let _ = Ellipsoid::geodetic_surface_normal(35.0, -95.0);
        let _ = ImageryLayer::blue_marble();
        let _ = Basemap::BlueMarble;
        let _ = PointPrimitive { lat_deg: 0.0, lon_deg: 0.0, color: [255, 0, 0, 255] };
        let _ = QuadtreeTile::root();
        let _ = SceneMode::Scene3D;
        let _ = TerrainKind::Ellipsoid;
        let _ = WGS84_RADII_M;
    }
}
'''

ELLIPSOID = f'''//! WGS84 ellipsoid matching Cesium `Ellipsoid.WGS84` (Source/Core/Ellipsoid.js).
//! Radii are meters. The live mesh is still a unit sphere; phase 1 switches it.
//!
//! Cesium ECEF: +X (0°N, 0°E), +Y (0°N, 90°E), +Z north pole.
//! Native wgpu: +X (0°N, 0°E), +Y north pole, +Z (0°N, 90°W).

pub const WGS84_RADII_M: [f64; 3] = [{WGS84_RADII_M[0]}, {WGS84_RADII_M[1]}, {WGS84_RADII_M[2]}];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ellipsoid {{
    pub radii_m: [f64; 3],
}}

impl Ellipsoid {{
    pub const WGS84: Self = Self {{ radii_m: WGS84_RADII_M }};

    pub fn equatorial_radius_m(&self) -> f64 {{
        self.radii_m[0]
    }}

    pub fn polar_radius_m(&self) -> f64 {{
        self.radii_m[2]
    }}

    /// First eccentricity squared, `(a² − b²) / a²`.
    pub fn eccentricity_squared(&self) -> f64 {{
        let a = self.radii_m[0];
        let b = self.radii_m[2];
        (a * a - b * b) / (a * a)
    }}

    /// Cesium `cartographicToCartesian`. Input degrees, output ECEF meters.
    pub fn cartographic_to_ecef(&self, lat_deg: f64, lon_deg: f64, height_m: f64) -> [f64; 3] {{
        let lat = lat_deg.to_radians();
        let lon = lon_deg.to_radians();
        let sin_lat = lat.sin();
        let cos_lat = lat.cos();
        let a = self.radii_m[0];
        let e2 = self.eccentricity_squared();
        let n = a / (1.0 - e2 * sin_lat * sin_lat).sqrt();
        [
            (n + height_m) * cos_lat * lon.cos(),
            (n + height_m) * cos_lat * lon.sin(),
            (n * (1.0 - e2) + height_m) * sin_lat,
        ]
    }}

    /// Geodetic surface normal in the **native** wgpu frame (Y north).
    pub fn geodetic_surface_normal(lat_deg: f64, lon_deg: f64) -> [f64; 3] {{
        let lat = lat_deg.to_radians();
        let lon = lon_deg.to_radians();
        let c = lat.cos();
        [c * lon.cos(), lat.sin(), -c * lon.sin()]
    }}

    /// ECEF meters → native unit vector (`[x, z, −y]`, then normalize).
    pub fn cartographic_to_native_unit(&self, lat_deg: f64, lon_deg: f64, height_m: f64) -> [f64; 3] {{
        let [x, y, z] = self.cartographic_to_ecef(lat_deg, lon_deg, height_m);
        let (nx, ny, nz) = (x, z, -y);
        let len = (nx * nx + ny * ny + nz * nz).sqrt().max(f64::EPSILON);
        [nx / len, ny / len, nz / len]
    }}
}}

#[cfg(test)]
mod tests {{
    use super::*;

    #[test]
    fn wgs84_matches_cesium_constants() {{
        assert_eq!(Ellipsoid::WGS84.radii_m[0], 6_378_137.0);
        assert_eq!(Ellipsoid::WGS84.radii_m[2], 6_356_752.3142451793);
    }}

    #[test]
    fn equator_ecef_is_equatorial_radius() {{
        let p = Ellipsoid::WGS84.cartographic_to_ecef(0.0, 0.0, 0.0);
        assert!((p[0] - 6_378_137.0).abs() < 1e-6);
        assert!(p[1].abs() < 1e-6);
        assert!(p[2].abs() < 1e-6);
    }}

    #[test]
    fn north_pole_ecef_is_polar_radius() {{
        let p = Ellipsoid::WGS84.cartographic_to_ecef(90.0, 0.0, 0.0);
        assert!(p[0].abs() < 1e-4);
        assert!(p[1].abs() < 1e-4);
        assert!((p[2] - 6_356_752.3142451793).abs() < 1e-4);
    }}

    #[test]
    fn native_unit_matches_sphere_at_equator_and_poles() {{
        let eq = Ellipsoid::WGS84.cartographic_to_native_unit(0.0, 0.0, 0.0);
        let np = Ellipsoid::WGS84.cartographic_to_native_unit(90.0, 0.0, 0.0);
        let east = Ellipsoid::WGS84.cartographic_to_native_unit(0.0, 90.0, 0.0);
        assert!((eq[0] - 1.0).abs() < 1e-9 && eq[1].abs() < 1e-9 && eq[2].abs() < 1e-9);
        assert!(np[0].abs() < 1e-9 && (np[1] - 1.0).abs() < 1e-9 && np[2].abs() < 1e-9);
        assert!(east[0].abs() < 1e-9 && east[1].abs() < 1e-9 && (east[2] + 1.0).abs() < 1e-9);
        let sphere_eq = crate::globe_math::lat_lon_to_unit(0.0, 0.0);
        assert!((eq[0] - f64::from(sphere_eq.x)).abs() < 1e-6);
    }}
}}
'''

CARTOGRAPHIC = '''//! Geodetic position. Cesium `Cartographic` is radians; we keep degrees at the
//! UI edge and convert here.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cartographic {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub height_m: f64,
}

impl Cartographic {
    pub fn new(lat_deg: f64, lon_deg: f64, height_m: f64) -> Self {
        Self { lat_deg, lon_deg, height_m }
    }
}
'''

IMAGERY = '''//! Imagery providers. Cesium splits `ImageryProvider` / `ImageryLayer`.
//! Native today: one compiled Blue Marble tile. XYZ/WMTS come next.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Basemap {
    BlueMarble,
    Streets,
    Satellite,
    Sentinel,
    Osm,
    Night,
    Plain,
}

pub struct ImageryLayer {
    pub basemap: Basemap,
    pub credit: &'static str,
}

impl ImageryLayer {
    pub fn blue_marble() -> Self {
        Self {
            basemap: Basemap::BlueMarble,
            credit: "NASA Visible Earth / Blue Marble",
        }
    }
}
'''

QUADTREE = '''//! Globe surface quadtree. Cesium `QuadtreeTile` splits when projected
//! geometric error exceeds a pixel budget. Not wired to the mesh yet.

#[derive(Clone, Debug)]
pub struct QuadtreeTile {
    pub level: u32,
    pub x: u32,
    pub y: u32,
}

impl QuadtreeTile {
    pub fn root() -> Self {
        Self { level: 0, x: 0, y: 0 }
    }
}
'''

TERRAIN = '''//! Terrain providers. Cesium default on Global Status web is Esri
//! WorldElevation3D. Native has ellipsoid-only (smooth sphere).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerrainKind {
    Ellipsoid,
    Heightmap,
    QuantizedMesh,
}
'''

PRIMITIVES = '''//! GPU collections. Cesium Entities are the slow path; BillboardCollection
//! / PointPrimitiveCollection are the fast path. Pins today are egui dots.

#[derive(Clone, Copy, Debug)]
pub struct PointPrimitive {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub color: [u8; 4],
}
'''

SCENE = '''//! Scene modes matching Cesium `SceneMode`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SceneMode {
    Scene3D,
    Scene2D,
    Columbus,
}

impl Default for SceneMode {
    fn default() -> Self {
        Self::Scene3D
    }
}
'''


def write_engine(crate_src: Path) -> list[str]:
    engine = crate_src / "engine"
    engine.mkdir(parents=True, exist_ok=True)
    files = {
        "mod.rs": ENGINE_MOD,
        "ellipsoid.rs": ELLIPSOID,
        "cartographic.rs": CARTOGRAPHIC,
        "imagery.rs": IMAGERY,
        "quadtree.rs": QUADTREE,
        "terrain.rs": TERRAIN,
        "primitives.rs": PRIMITIVES,
        "scene.rs": SCENE,
    }
    written = []
    for name, body in files.items():
        if "#![allow(dead_code)]" not in body:
            lines = body.splitlines(True)
            i = 0
            while i < len(lines) and (lines[i].startswith("//!") or lines[i].strip() == ""):
                i += 1
            lines.insert(i, "#![allow(dead_code)]\n")
            body = "".join(lines)
        path = engine / name
        path.write_text(body, encoding="utf-8")
        written.append(str(path))
    lib = crate_src / "lib.rs"
    text = lib.read_text(encoding="utf-8")
    if "mod engine;" not in text:
        # Keep engine next to the other private modules.
        text = text.replace("mod globe_math;\n", "mod engine;\nmod globe_math;\n")
        lib.write_text(text, encoding="utf-8")
        written.append(str(lib))
    return written
