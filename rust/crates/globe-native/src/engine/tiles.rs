//! OSM / GIBS raster tiles stitched into the equirect albedo QuietEarth samples.
//!
//! Desktop only (needs TLS). Android stays on the compiled Blue Marble until
//! the APK grows INTERNET + a tile cache.

use image::{Rgba, RgbaImage};

const TILE: u32 = 256;
const UA: &str = "QuietEarth/0.1 (https://globalstatus.app; rust-globe)";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TileLayer {
    Osm,
    OpenTopo,
    Gibs,
}

impl TileLayer {
    pub fn host(self) -> &'static str {
        match self {
            TileLayer::Osm => "tile.openstreetmap.org",
            TileLayer::OpenTopo => "a.tile.opentopomap.org",
            TileLayer::Gibs => "gibs.earthdata.nasa.gov",
        }
    }

    pub fn path(self, z: u32, x: u32, y: u32) -> String {
        match self {
            TileLayer::Osm | TileLayer::OpenTopo => format!("/{z}/{x}/{y}.png"),
            TileLayer::Gibs => format!(
                "/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg"
            ),
        }
    }

    pub fn accept(self) -> &'static str {
        match self {
            TileLayer::Gibs => "image/jpeg",
            _ => "image/png",
        }
    }

    pub fn max_z(self) -> u32 {
        match self {
            TileLayer::Gibs => 8,
            _ => 12,
        }
    }
}

pub fn mercator_y(lat_deg: f64) -> f64 {
    let lat = lat_deg.clamp(-85.05112878, 85.05112878).to_radians();
    0.5 - (lat.tan() + 1.0 / lat.cos()).ln() / (4.0 * std::f64::consts::PI)
}

/// Web-mercator mosaic (square, z=0 is one tile) → equirect (2:1) for globe.wgsl.
pub fn mercator_to_equirect(merc: &RgbaImage, out_w: u32, out_h: u32) -> RgbaImage {
    let mut out = RgbaImage::new(out_w, out_h);
    let mw = f64::from(merc.width());
    let mh = f64::from(merc.height());
    for y in 0..out_h {
        let lat = 90.0 - (f64::from(y) + 0.5) / f64::from(out_h) * 180.0;
        if !(-85.05112878..=85.05112878).contains(&lat) {
            continue;
        }
        let my = mercator_y(lat) * mh;
        for x in 0..out_w {
            let lon = (f64::from(x) + 0.5) / f64::from(out_w) * 360.0 - 180.0;
            let mx = (lon + 180.0) / 360.0 * mw;
            out.put_pixel(x, y, sample(merc, mx, my));
        }
    }
    out
}

fn sample(img: &RgbaImage, x: f64, y: f64) -> Rgba<u8> {
    let w = img.width().saturating_sub(1);
    let h = img.height().saturating_sub(1);
    let ix = x.floor().clamp(0.0, f64::from(w)) as u32;
    let iy = y.floor().clamp(0.0, f64::from(h)) as u32;
    *img.get_pixel(ix, iy)
}

/// Paint streets onto Blue Marble; polar rows stay marble (mercator has no poles).
pub fn overlay_on_marble(marble: &RgbaImage, streets: &RgbaImage) -> RgbaImage {
    let mut out = marble.clone();
    let w = out.width().min(streets.width());
    let h = out.height().min(streets.height());
    for y in 0..h {
        let lat = 90.0 - (f64::from(y) + 0.5) / f64::from(out.height()) * 180.0;
        if lat.abs() > 84.0 {
            continue;
        }
        for x in 0..w {
            let p = streets.get_pixel(x, y);
            if p[3] > 0 && (p[0] > 8 || p[1] > 8 || p[2] > 8) {
                out.put_pixel(x, y, *p);
            }
        }
    }
    out
}

#[cfg(not(target_os = "android"))]
pub fn stitch_layer(layer: TileLayer, z: u32) -> Result<RgbaImage, String> {
    let z = z.min(layer.max_z()).min(3);
    let n = 1u32 << z;
    let mut mosaic = RgbaImage::new(n * TILE, n * TILE);
    for y in 0..n {
        for x in 0..n {
            let path = layer.path(z, x, y);
            let bytes = downtime_native::https_get_bytes(
                layer.host(),
                &path,
                layer.accept(),
                UA,
                400_000,
                std::time::Duration::from_secs(10),
            )
            .map_err(|err| err.message)?;
            let tile = image::load_from_memory(&bytes)
                .map_err(|err| err.to_string())?
                .to_rgba8();
            let tw = tile.width().min(TILE);
            let th = tile.height().min(TILE);
            for ty in 0..th {
                for tx in 0..tw {
                    mosaic.put_pixel(x * TILE + tx, y * TILE + ty, *tile.get_pixel(tx, ty));
                }
            }
        }
    }
    Ok(mosaic)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_island_is_the_mercator_center() {
        assert!((mercator_y(0.0) - 0.5).abs() < 1e-9);
        let mut merc = RgbaImage::new(8, 8);
        for p in merc.pixels_mut() {
            *p = Rgba([0, 0, 0, 255]);
        }
        merc.put_pixel(4, 4, Rgba([255, 0, 0, 255]));
        let eq = mercator_to_equirect(&merc, 16, 8);
        let mid = eq.get_pixel(8, 4);
        assert_eq!(mid[0], 255, "{mid:?}");
    }

    #[test]
    fn overlay_keeps_marble_at_the_pole() {
        let marble = RgbaImage::from_pixel(4, 2, Rgba([10, 20, 30, 255]));
        let mut streets = RgbaImage::from_pixel(4, 2, Rgba([9, 9, 9, 255]));
        streets.put_pixel(0, 0, Rgba([1, 1, 1, 255])); // north pole row
        streets.put_pixel(2, 1, Rgba([40, 50, 60, 255]));
        let out = overlay_on_marble(&marble, &streets);
        assert_eq!(out.get_pixel(0, 0).0, [10, 20, 30, 255]);
    }
}
