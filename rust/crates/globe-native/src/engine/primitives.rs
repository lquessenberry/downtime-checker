//! GPU collections. Cesium Entities are the slow path; BillboardCollection
//! / PointPrimitiveCollection are the fast path. Pins today are egui dots.

#![allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub struct PointPrimitive {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub color: [u8; 4],
}
