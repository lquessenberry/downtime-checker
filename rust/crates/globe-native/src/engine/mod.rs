//! Cesium-shaped engine pieces. The live draw path is still `render.rs` +
//! `globe_math.rs`. Types here exist so the rebuild can land one Cesium
//! module at a time without rewriting the window loop.

#![allow(dead_code)]
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
