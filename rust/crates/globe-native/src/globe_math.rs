//! Pure globe math shared by the GPU pass and the CPU pin overlay.
//!
//! Frame: unit sphere, +Y through the North Pole, +X through (0°N, 0°E),
//! +Z through (0°N, 90°W). Kept free of GPU types so it tests headless.

use glam::{Mat4, Vec3, Vec4};

/// Unit-sphere position for a latitude/longitude in degrees.
pub fn lat_lon_to_unit(lat_deg: f64, lon_deg: f64) -> Vec3 {
    let (lat, lon) = (lat_deg.to_radians(), lon_deg.to_radians());
    Vec3::new(
        (lat.cos() * lon.cos()) as f32,
        lat.sin() as f32,
        (-lat.cos() * lon.sin()) as f32,
    )
}

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    /// Latitude and longitude in degrees, for the graticule shader.
    pub lat_lon: [f32; 2],
}

/// UV sphere: `stacks` rings from pole to pole, `slices` segments around.
pub fn sphere_mesh(stacks: u32, slices: u32) -> (Vec<Vertex>, Vec<u32>) {
    assert!(stacks >= 2 && slices >= 3);
    let mut vertices = Vec::with_capacity(((stacks + 1) * (slices + 1)) as usize);
    for i in 0..=stacks {
        let lat = 90.0 - 180.0 * f64::from(i) / f64::from(stacks);
        for j in 0..=slices {
            let lon = -180.0 + 360.0 * f64::from(j) / f64::from(slices);
            vertices.push(Vertex {
                position: lat_lon_to_unit(lat, lon).to_array(),
                lat_lon: [lat as f32, lon as f32],
            });
        }
    }
    let row = slices + 1;
    let mut indices = Vec::with_capacity((stacks * slices * 6) as usize);
    for i in 0..stacks {
        for j in 0..slices {
            let a = i * row + j;
            let b = a + row;
            // Clockwise seen from outside the sphere (pipeline uses `FrontFace::Cw`).
            indices.extend_from_slice(&[a, a + 1, b, a + 1, b + 1, b]);
        }
    }
    (vertices, indices)
}

/// Orbit camera around the globe.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrbitCamera {
    /// Longitude under the camera, degrees.
    pub lon: f32,
    /// Latitude under the camera, degrees (clamped to ±85).
    pub lat: f32,
    /// Distance from the globe centre in Earth radii (> 1).
    pub distance: f32,
}

impl Default for OrbitCamera {
    fn default() -> Self {
        // Start over North America, where most catalog sites sit.
        Self { lon: -95.0, lat: 35.0, distance: 3.2 }
    }
}

impl OrbitCamera {
    pub fn eye(&self) -> Vec3 {
        lat_lon_to_unit(f64::from(self.lat), f64::from(self.lon)) * self.distance
    }

    pub fn view_proj(&self, aspect: f32) -> Mat4 {
        let proj = Mat4::perspective_rh(35f32.to_radians(), aspect.max(1e-3), 0.05, 50.0);
        let view = Mat4::look_at_rh(self.eye(), Vec3::ZERO, Vec3::Y);
        proj * view
    }

    /// Drag in screen points turns the globe; scroll zooms.
    pub fn drag(&mut self, dx: f32, dy: f32) {
        let k = 0.25 * (self.distance - 1.0).max(0.05);
        self.lon = wrap_lon(self.lon - dx * k);
        self.lat = (self.lat + dy * k).clamp(-85.0, 85.0);
    }

    pub fn zoom(&mut self, scroll: f32) {
        self.distance = (self.distance * (-scroll * 0.002).exp()).clamp(1.15, 12.0);
    }

    /// True when a surface point faces the camera (not behind the globe).
    pub fn sees(&self, p: Vec3) -> bool {
        p.dot(self.eye() - p) > 0.0
    }
}

fn wrap_lon(lon: f32) -> f32 {
    (lon + 180.0).rem_euclid(360.0) - 180.0
}

/// Project a world point to pixel coordinates inside a `size` viewport
/// (origin top-left). `None` when it falls behind the camera.
pub fn project(view_proj: Mat4, p: Vec3, size: [f32; 2]) -> Option<[f32; 2]> {
    let clip = view_proj * Vec4::new(p.x, p.y, p.z, 1.0);
    if clip.w <= 0.0 {
        return None;
    }
    let ndc = clip.truncate() / clip.w;
    Some([(ndc.x * 0.5 + 0.5) * size[0], (0.5 - ndc.y * 0.5) * size[1]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_points_are_on_the_sphere() {
        for (lat, lon) in [(0.0, 0.0), (90.0, 0.0), (-33.9, 151.2), (35.1, -90.0)] {
            assert!((lat_lon_to_unit(lat, lon).length() - 1.0).abs() < 1e-5);
        }
        assert!((lat_lon_to_unit(90.0, 42.0) - Vec3::Y).length() < 1e-5);
    }

    #[test]
    fn mesh_counts_match_grid() {
        let (v, i) = sphere_mesh(8, 16);
        assert_eq!(v.len(), 9 * 17);
        assert_eq!(i.len(), 8 * 16 * 6);
        assert!(i.iter().all(|&k| (k as usize) < v.len()));
    }

    #[test]
    fn point_under_camera_projects_to_centre_and_is_visible() {
        let cam = OrbitCamera { lon: 10.0, lat: 20.0, distance: 3.0 };
        let p = lat_lon_to_unit(20.0, 10.0);
        let xy = project(cam.view_proj(1.5), p, [300.0, 200.0]).unwrap();
        assert!((xy[0] - 150.0).abs() < 0.5 && (xy[1] - 100.0).abs() < 0.5, "{xy:?}");
        assert!(cam.sees(p));
        assert!(!cam.sees(lat_lon_to_unit(-20.0, -170.0)));
    }

    #[test]
    fn east_is_right_and_north_is_up() {
        let cam = OrbitCamera { lon: -95.0, lat: 35.0, distance: 3.2 };
        let vp = cam.view_proj(1.0);
        let centre = project(vp, lat_lon_to_unit(35.0, -95.0), [100.0, 100.0]).unwrap();
        let east = project(vp, lat_lon_to_unit(35.0, -85.0), [100.0, 100.0]).unwrap();
        let north = project(vp, lat_lon_to_unit(45.0, -95.0), [100.0, 100.0]).unwrap();
        assert!(east[0] > centre[0], "{east:?} vs {centre:?}");
        assert!(north[1] < centre[1], "{north:?} vs {centre:?}");
    }

    #[test]
    fn camera_controls_stay_in_range() {
        let mut cam = OrbitCamera::default();
        cam.drag(1e5, 1e5);
        assert!((-85.0..=85.0).contains(&cam.lat));
        assert!((-180.0..180.0).contains(&cam.lon));
        cam.zoom(1e6);
        assert!(cam.distance >= 1.15);
    }
}
