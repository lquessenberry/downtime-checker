//! Offline geo-orbital factoids for HUD, shaders, and tests.
//! Numbers are public geodesy / NASA / IAU conventions, not a vendor dataset.

use super::ellipsoid::Ellipsoid;

/// WGS84 equatorial radius (m).
pub const WGS84_A_M: f64 = 6_378_137.0;
/// WGS84 polar radius used in this crate (m).
pub const WGS84_B_M: f64 = 6_356_752.314_245_179;
/// Mean Earth radius for “globe toy” scale sketches (m).
pub const MEAN_RADIUS_M: f64 = 6_371_000.0;

/// Kármán line (m).
pub const KARMAN_M: f64 = 100_000.0;
/// Typical ISS altitude (m).
pub const ISS_ALTITUDE_M: f64 = 400_000.0;
/// Geostationary / Clarke belt altitude above equator (m).
pub const GEO_ALTITUDE_M: f64 = 35_786_000.0;
/// GPS MEO altitude (m).
pub const GPS_ALTITUDE_M: f64 = 20_200_000.0;
/// GPS inclination (deg).
pub const GPS_INCLINATION_DEG: f64 = 55.0;
/// Sidereal day (s): 23h 56m 4.09s.
pub const SIDEREAL_DAY_S: f64 = 86_164.09;
/// GPS orbital period ≈ half a sidereal day (s).
pub const GPS_PERIOD_S: f64 = SIDEREAL_DAY_S / 2.0;

/// Null Island (Gulf of Guinea). NOAA buoy 13010 Soul is nearby.
pub const NULL_ISLAND: [f64; 2] = [0.0, 0.0];

/// Rough South Atlantic Anomaly bbox (lon_west, lat_south, lon_east, lat_north).
pub const SAA_BBOX: [f64; 4] = [-50.0, -40.0, 10.0, 0.0];

pub fn wgs84_bulge_m() -> f64 {
    Ellipsoid::WGS84.equatorial_radius_m() - Ellipsoid::WGS84.polar_radius_m()
}

/// Height above a desktop globe of `diameter_m` for an orbit `altitude_m`.
pub fn height_on_globe_m(altitude_m: f64, globe_diameter_m: f64) -> f64 {
    (globe_diameter_m / 2.0) * (altitude_m / MEAN_RADIUS_M)
}

pub fn antipode(lat_deg: f64, lon_deg: f64) -> [f64; 2] {
    let lat = -lat_deg;
    let mut lon = lon_deg + 180.0;
    if lon > 180.0 {
        lon -= 360.0;
    }
    [lat, lon]
}

pub fn in_saa(lat_deg: f64, lon_deg: f64) -> bool {
    lon_deg >= SAA_BBOX[0]
        && lon_deg <= SAA_BBOX[2]
        && lat_deg >= SAA_BBOX[1]
        && lat_deg <= SAA_BBOX[3]
}

/// Maidenhead locator (2, 4, or 6 characters). Algorithmic; no download.
pub fn maidenhead(lat_deg: f64, lon_deg: f64, chars: u8) -> Option<String> {
    if !(-90.0..=90.0).contains(&lat_deg) || !(-180.0..=180.0).contains(&lon_deg) {
        return None;
    }
    let n = chars.max(2).min(6);
    let mut lon = lon_deg + 180.0;
    let mut lat = lat_deg + 90.0;
    let mut out = String::new();
    // field
    let lon_field = (lon / 20.0).floor() as u8;
    let lat_field = (lat / 10.0).floor() as u8;
    out.push((b'A' + lon_field) as char);
    out.push((b'A' + lat_field) as char);
    if n == 2 {
        return Some(out);
    }
    lon -= f64::from(lon_field) * 20.0;
    lat -= f64::from(lat_field) * 10.0;
    let lon_sq = (lon / 2.0).floor() as u8;
    let lat_sq = lat.floor() as u8;
    out.push((b'0' + lon_sq) as char);
    out.push((b'0' + lat_sq) as char);
    if n == 4 {
        return Some(out);
    }
    lon -= f64::from(lon_sq) * 2.0;
    lat -= f64::from(lat_sq);
    let lon_sub = (lon / (2.0 / 24.0)).floor() as u8;
    let lat_sub = (lat / (1.0 / 24.0)).floor() as u8;
    out.push((b'A' + lon_sub.min(23)) as char);
    out.push((b'A' + lat_sub.min(23)) as char);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bulge_is_about_21_km() {
        let bulge = wgs84_bulge_m();
        assert!(bulge > 21_000.0 && bulge < 22_000.0);
    }

    #[test]
    fn iss_is_about_3mm_on_a_10cm_globe() {
        let h = height_on_globe_m(ISS_ALTITUDE_M, 0.10);
        assert!((h - 0.003_14).abs() < 0.000_2);
        let karman_frac = KARMAN_M / MEAN_RADIUS_M;
        assert!((karman_frac - 0.0157).abs() < 0.001);
    }

    #[test]
    fn gps_period_is_half_sidereal_day() {
        assert!((GPS_PERIOD_S - 43_082.0).abs() < 1.0);
        assert!((GPS_INCLINATION_DEG - 55.0).abs() < 0.01);
    }

    #[test]
    fn antipode_of_null_island_is_still_ocean() {
        let [lat, lon] = antipode(0.0, 0.0);
        assert!((lat).abs() < 1e-9);
        assert!((lon - 180.0).abs() < 1e-9 || (lon + 180.0).abs() < 1e-9);
    }

    #[test]
    fn maidenhead_null_island_is_jj00() {
        assert_eq!(maidenhead(0.0, 0.0, 4).as_deref(), Some("JJ00"));
    }

    #[test]
    fn saa_covers_brazil_coast() {
        assert!(in_saa(-20.0, -40.0));
        assert!(!in_saa(35.0, -90.0));
    }
}
