//! Globe surface quadtree. Cesium `QuadtreeTile` splits when projected
//! geometric error exceeds a pixel budget. Not wired to the mesh yet.

#![allow(dead_code)]
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
