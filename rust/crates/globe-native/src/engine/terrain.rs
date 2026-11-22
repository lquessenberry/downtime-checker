//! Terrain providers. Cesium default on Global Status web is Esri
//! WorldElevation3D. Native has ellipsoid-only (smooth sphere).

#![allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerrainKind {
    Ellipsoid,
    Heightmap,
    QuantizedMesh,
}
