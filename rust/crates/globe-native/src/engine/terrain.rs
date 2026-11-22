//! Terrain providers. Web Cesium still has Esri WorldElevation3D; native
//! refuses it. Terrarium PNG (AWS Open Data) is the free height source.

#![allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerrainKind {
    Ellipsoid,
    Heightmap,
    Terrarium,
    QuantizedMesh,
}

impl TerrainKind {
    pub fn label(self) -> &'static str {
        match self {
            TerrainKind::Ellipsoid => "Ellipsoid (smooth)",
            TerrainKind::Heightmap => "Local heightmap",
            TerrainKind::Terrarium => "Mapzen Terrarium (free DEM)",
            TerrainKind::QuantizedMesh => "Quantized mesh (later)",
        }
    }
}
