//! First-party nuclear blast rings for the Global Status globe.
//!
//! Cube-root scaling from public 1 kt airburst radii (Glasstone & Dolan
//! order of magnitude). This is not NUKEMAP, not NukeSim, and not their code.
//! Casualty counts are out of scope until a population layer exists.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

/// One-thumb yield steps, kilotons.
pub const KT_PRESETS: [f64; 5] = [15.0, 100.0, 300.0, 1000.0, 5000.0];

const FIREBALL_1KT: f64 = 90.0;
const HEAVY_1KT: f64 = 220.0;
const MEDIUM_1KT: f64 = 450.0;
const LIGHT_1KT: f64 = 1100.0;
const THERMAL_1KT: f64 = 650.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlastRings {
    pub yield_kt: f64,
    pub airburst: bool,
    pub fireball_m: f64,
    pub heavy_m: f64,
    pub medium_m: f64,
    pub light_m: f64,
    pub thermal_m: f64,
    /// Downwind sketch for a ground burst. Zero for airburst.
    pub fallout_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shot {
    pub lat: f64,
    pub lon: f64,
    pub yield_kt: f64,
    pub airburst: bool,
}

pub fn rings(yield_kt: f64, airburst: bool) -> BlastRings {
    let y = yield_kt.max(0.001);
    let s = libm::cbrt(y);
    let over = if airburst { 1.0 } else { 0.9 };
    let fire = if airburst { 1.0 } else { 0.75 };
    let thermal = if airburst { 1.1 } else { 0.7 };
    let light = LIGHT_1KT * s * over;
    BlastRings {
        yield_kt: y,
        airburst,
        fireball_m: FIREBALL_1KT * s * fire,
        heavy_m: HEAVY_1KT * s * over,
        medium_m: MEDIUM_1KT * s * over,
        light_m: light,
        thermal_m: THERMAL_1KT * s * thermal,
        fallout_m: if airburst { 0.0 } else { light * 6.0 },
    }
}

/// DEFCON 5 (idle) through 1 (many or very large shots).
pub fn defcon(shots: &[Shot]) -> u8 {
    if shots.is_empty() {
        return 5;
    }
    let max_kt = shots
        .iter()
        .map(|s| s.yield_kt)
        .fold(0.0_f64, f64::max);
    if shots.len() >= 8 || max_kt >= 5000.0 {
        1
    } else if shots.len() >= 4 || max_kt >= 1000.0 {
        2
    } else if max_kt >= 300.0 {
        3
    } else {
        4
    }
}

pub fn card(shot: Shot) -> String {
    let r = rings(shot.yield_kt, shot.airburst);
    let burst = if r.airburst { "airburst" } else { "ground burst" };
    let mut lines = Vec::new();
    lines.push(format!("{:.0} kt {burst}", r.yield_kt));
    lines.push(format!("fireball {:.1} km", r.fireball_m / 1000.0));
    lines.push(format!("heavy (20 psi) {:.1} km", r.heavy_m / 1000.0));
    lines.push(format!("medium (5 psi) {:.1} km", r.medium_m / 1000.0));
    lines.push(format!("light (1 psi) {:.1} km", r.light_m / 1000.0));
    lines.push(format!("thermal {:.1} km", r.thermal_m / 1000.0));
    if r.fallout_m > 0.0 {
        lines.push(format!(
            "fallout footprint {:.0} km (downwind sketch)",
            r.fallout_m / 1000.0
        ));
    }
    lines.push(String::from(
        "GSA model · cube-root scaling · not a population estimate",
    ));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifteen_kt_is_city_scale() {
        let r = rings(15.0, true);
        assert!(r.light_m > 2000.0 && r.light_m < 4000.0);
        assert!(r.fireball_m > 150.0 && r.fireball_m < 400.0);
        assert_eq!(r.fallout_m, 0.0);
    }

    #[test]
    fn ground_burst_grows_fallout() {
        let air = rings(15.0, true);
        let ground = rings(15.0, false);
        assert!(ground.fallout_m > air.light_m);
        assert!(ground.fireball_m < air.fireball_m);
    }

    #[test]
    fn cube_root_to_a_megaton() {
        let one = rings(1.0, true);
        let mt = rings(1000.0, true);
        let ratio = mt.light_m / one.light_m;
        assert!((ratio - 10.0).abs() < 0.05);
    }

    #[test]
    fn idle_is_defcon_five() {
        assert_eq!(defcon(&[]), 5);
        assert_eq!(
            defcon(&[Shot {
                lat: 0.0,
                lon: 0.0,
                yield_kt: 15.0,
                airburst: true
            }]),
            4
        );
    }
}
