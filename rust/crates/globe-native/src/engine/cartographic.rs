//! Geodetic position. Cesium `Cartographic` is radians; we keep degrees at the
//! UI edge and convert here.

#![allow(dead_code)]
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
