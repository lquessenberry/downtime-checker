//! WGS84 ellipsoid matching published Cesium `Ellipsoid.WGS84` radii.
//! Radii are public geodetic constants (meters), not a copy of Ellipsoid.js.
//! A later mechanical port of `packages/core/Source/Ellipsoid.js` stays Apache-2.0.
//!
//! Cesium ECEF: +X (0°N, 0°E), +Y (0°N, 90°E), +Z north pole.
//! Native wgpu: +X (0°N, 0°E), +Y north pole, +Z (0°N, 90°W).

#![allow(dead_code)]
pub const WGS84_RADII_M: [f64; 3] = [6378137.0, 6378137.0, 6356752.314245179];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ellipsoid {
    pub radii_m: [f64; 3],
}

impl Ellipsoid {
    pub const WGS84: Self = Self { radii_m: WGS84_RADII_M };

    pub fn equatorial_radius_m(&self) -> f64 {
        self.radii_m[0]
    }

    pub fn polar_radius_m(&self) -> f64 {
        self.radii_m[2]
    }

    /// First eccentricity squared, `(a² − b²) / a²`.
    pub fn eccentricity_squared(&self) -> f64 {
        let a = self.radii_m[0];
        let b = self.radii_m[2];
        (a * a - b * b) / (a * a)
    }

    /// Cesium `cartographicToCartesian`. Input degrees, output ECEF meters.
    pub fn cartographic_to_ecef(&self, lat_deg: f64, lon_deg: f64, height_m: f64) -> [f64; 3] {
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
    }

    /// Geodetic surface normal in the **native** wgpu frame (Y north).
    pub fn geodetic_surface_normal(lat_deg: f64, lon_deg: f64) -> [f64; 3] {
        let lat = lat_deg.to_radians();
        let lon = lon_deg.to_radians();
        let c = lat.cos();
        [c * lon.cos(), lat.sin(), -c * lon.sin()]
    }

    /// ECEF meters → native unit vector (`[x, z, −y]`, then normalize).
    pub fn cartographic_to_native_unit(&self, lat_deg: f64, lon_deg: f64, height_m: f64) -> [f64; 3] {
        let [x, y, z] = self.cartographic_to_ecef(lat_deg, lon_deg, height_m);
        let (nx, ny, nz) = (x, z, -y);
        let len = (nx * nx + ny * ny + nz * nz).sqrt().max(f64::EPSILON);
        [nx / len, ny / len, nz / len]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wgs84_matches_cesium_constants() {
        assert_eq!(Ellipsoid::WGS84.radii_m[0], 6_378_137.0);
        assert_eq!(Ellipsoid::WGS84.radii_m[2], 6_356_752.3142451793);
    }

    #[test]
    fn equator_ecef_is_equatorial_radius() {
        let p = Ellipsoid::WGS84.cartographic_to_ecef(0.0, 0.0, 0.0);
        assert!((p[0] - 6_378_137.0).abs() < 1e-6);
        assert!(p[1].abs() < 1e-6);
        assert!(p[2].abs() < 1e-6);
    }

    #[test]
    fn north_pole_ecef_is_polar_radius() {
        let p = Ellipsoid::WGS84.cartographic_to_ecef(90.0, 0.0, 0.0);
        assert!(p[0].abs() < 1e-4);
        assert!(p[1].abs() < 1e-4);
        assert!((p[2] - 6_356_752.3142451793).abs() < 1e-4);
    }

    #[test]
    fn native_unit_matches_sphere_at_equator_and_poles() {
        let eq = Ellipsoid::WGS84.cartographic_to_native_unit(0.0, 0.0, 0.0);
        let np = Ellipsoid::WGS84.cartographic_to_native_unit(90.0, 0.0, 0.0);
        let east = Ellipsoid::WGS84.cartographic_to_native_unit(0.0, 90.0, 0.0);
        assert!((eq[0] - 1.0).abs() < 1e-9 && eq[1].abs() < 1e-9 && eq[2].abs() < 1e-9);
        assert!(np[0].abs() < 1e-9 && (np[1] - 1.0).abs() < 1e-9 && np[2].abs() < 1e-9);
        assert!(east[0].abs() < 1e-9 && east[1].abs() < 1e-9 && (east[2] + 1.0).abs() < 1e-9);
        let sphere_eq = crate::globe_math::lat_lon_to_unit(0.0, 0.0);
        assert!((eq[0] - f64::from(sphere_eq.x)).abs() < 1e-6);
    }
}
