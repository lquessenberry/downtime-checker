//! Imagery providers. Cesium splits `ImageryProvider` / `ImageryLayer`.
//! Native today: one compiled Blue Marble tile. XYZ/WMTS come next.

#![allow(dead_code)]
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
