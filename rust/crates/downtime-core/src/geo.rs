//! Location helpers shared by the CLI and the globe server.
//!
//! Coordinates are read from `locations.json` or, for the globe, jittered around
//! a capital so a dot can be drawn before ipwho.is answers. The live HTTPS
//! lookup itself stays in the native crate.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::model::Place;

#[derive(Clone, Debug, PartialEq)]
pub struct GeoRecord {
    pub location: String,
    pub city: String,
    pub region: String,
    pub country: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Located {
    pub location: String,
    pub city: String,
    pub region: String,
    pub country: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub ip: String,
    pub approx: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocateMode {
    /// Cache and saved coordinates only. The CLI fills in "Location not found".
    CacheOnly,
    /// Node globe: fall back to a jittered capital so the map has a dot.
    Globe,
}

/// Same FNV mix the Node visualizer uses to spread dots that share a coordinate.
pub fn jitter(lat: f64, lon: f64, key: &str) -> (f64, f64) {
    let hash = fnv_hash(key);
    let angle = (hash % 1000) as f64 / 1000.0 * core::f64::consts::PI * 2.0;
    let radius = 0.28 + ((hash >> 8) % 100) as f64 / 400.0;
    (
        lat + libm::sin(angle) * radius,
        lon + libm::cos(angle) * radius,
    )
}

pub fn fnv_hash(key: &str) -> u32 {
    let mut hash: u32 = 2_166_136_261;
    for ch in key.chars() {
        hash ^= ch as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

pub fn is_public_ipv4(ip: &str) -> bool {
    let Some([first, second, _, _]) = parse_ipv4(ip) else {
        return false;
    };
    if first == 10 || first == 127 || first == 0 {
        return false;
    }
    if first == 169 && second == 254 {
        return false;
    }
    if first == 172 && (16..=31).contains(&second) {
        return false;
    }
    if first == 192 && second == 168 {
        return false;
    }
    if first >= 224 {
        return false;
    }
    true
}

pub fn first_public_ipv4(ips: &[String]) -> Option<&str> {
    ips.iter().map(String::as_str).find(|ip| is_public_ipv4(ip))
}

pub fn parse_ipv4(ip: &str) -> Option<[u8; 4]> {
    let mut octets = [0u8; 4];
    let mut parts = ip.split('.');
    for slot in &mut octets {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let value: u16 = part.parse().ok()?;
        if value > 255 {
            return None;
        }
        *slot = value as u8;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(octets)
}

pub fn format_location(city: &str, region: &str, postal: &str, country: &str) -> String {
    let city = city.trim();
    let region = region.trim();
    let postal = postal.trim();
    let country = country.trim();
    if !city.is_empty() && !region.is_empty() {
        let mut place = alloc::format!("{city}, {region}");
        if !postal.is_empty() {
            place.push(' ');
            place.push_str(postal);
        }
        if !country.is_empty() {
            place.push_str(", ");
            place.push_str(country);
        }
        return place;
    }
    [city, region, postal, country]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn country_from_location(location: &str) -> String {
    if location.is_empty()
        || location == "Local network"
        || location == "Location not found"
        || !location.contains(',')
    {
        return String::new();
    }
    location
        .rsplit_once(',')
        .map(|(_, tail)| tail.trim().to_string())
        .unwrap_or_default()
}

pub fn region_from_location(location: &str) -> String {
    if location.is_empty() || location == "Local network" || location == "Location not found" {
        return String::new();
    }
    let parts: Vec<&str> = location
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 3 {
        return String::new();
    }
    let mut tokens: Vec<&str> = parts[parts.len() - 2].split_whitespace().collect();
    while tokens
        .last()
        .is_some_and(|token| token.chars().any(|ch| ch.is_ascii_digit()))
    {
        tokens.pop();
    }
    tokens.join(" ")
}

pub fn locate(
    place: &Place,
    ips: &[String],
    cached: Option<&GeoRecord>,
    mode: LocateMode,
) -> Located {
    let public_ip = first_public_ipv4(ips).unwrap_or("").to_string();
    if let Some(found) = cached {
        if !found.location.is_empty() && found.lat.is_finite() && found.lon.is_finite() {
            let (lat, lon) = jitter(found.lat, found.lon, &place.address);
            let country = if !found.country.is_empty() {
                found.country.clone()
            } else {
                let parsed = country_from_location(&found.location);
                if parsed.is_empty() {
                    place.country.clone()
                } else {
                    parsed
                }
            };
            return Located {
                location: found.location.clone(),
                city: found.city.clone(),
                region: found.region.clone(),
                country,
                lat: Some(lat),
                lon: Some(lon),
                ip: public_ip,
                approx: false,
            };
        }
    }
    if let (Some(lat0), Some(lon0)) = (place.lat, place.lon) {
        if lat0.is_finite() && lon0.is_finite() {
            let (lat, lon) = jitter(lat0, lon0, &place.address);
            return Located {
                location: place.location.clone(),
                city: place.city.clone(),
                region: place.region.clone(),
                country: place.country.clone(),
                lat: Some(lat),
                lon: Some(lon),
                ip: public_ip,
                approx: false,
            };
        }
    }
    if mode == LocateMode::Globe {
        if let Some((lat0, lon0)) = capital(&place.country) {
            let (lat, lon) = jitter(lat0, lon0, &place.address);
            let location = if place.location.is_empty() {
                place.country.clone()
            } else {
                place.location.clone()
            };
            return Located {
                location,
                city: place.city.clone(),
                region: place.region.clone(),
                country: place.country.clone(),
                lat: Some(lat),
                lon: Some(lon),
                ip: public_ip,
                approx: true,
            };
        }
    }
    Located {
        location: place.location.clone(),
        city: place.city.clone(),
        region: place.region.clone(),
        country: place.country.clone(),
        lat: None,
        lon: None,
        ip: public_ip,
        approx: false,
    }
}

pub fn capital(country: &str) -> Option<(f64, f64)> {
    CAPITALS
        .iter()
        .find(|(name, _, _)| *name == country)
        .map(|(_, lat, lon)| (*lat, *lon))
}

// Latitudes such as 3.14 are city coordinates from the Node catalog, not pi.
#[allow(clippy::approx_constant)]
const CAPITALS: &[(&str, f64, f64)] = &[
    ("Afghanistan", 34.53, 69.17),
    ("Albania", 41.33, 19.82),
    ("Algeria", 36.75, 3.04),
    ("Angola", -8.84, 13.23),
    ("Argentina", -34.6, -58.38),
    ("Australia", -35.28, 149.13),
    ("Austria", 48.21, 16.37),
    ("Bangladesh", 23.81, 90.41),
    ("Belgium", 50.85, 4.35),
    ("Brazil", -15.79, -47.88),
    ("Canada", 45.42, -75.7),
    ("Chile", -33.45, -70.67),
    ("China", 39.9, 116.4),
    ("Colombia", 4.71, -74.07),
    ("Czech Republic", 50.08, 14.44),
    ("Czechia", 50.08, 14.44),
    ("Denmark", 55.68, 12.57),
    ("Egypt", 30.04, 31.24),
    ("Finland", 60.17, 24.94),
    ("France", 48.86, 2.35),
    ("Germany", 52.52, 13.4),
    ("Greece", 37.98, 23.73),
    ("Hong Kong", 22.32, 114.17),
    ("Hungary", 47.5, 19.04),
    ("India", 28.61, 77.21),
    ("Indonesia", -6.21, 106.85),
    ("Iran", 35.69, 51.39),
    ("Iraq", 33.32, 44.37),
    ("Ireland", 53.35, -6.26),
    ("Israel", 31.77, 35.21),
    ("Italy", 41.9, 12.5),
    ("Japan", 35.68, 139.69),
    ("Kenya", -1.29, 36.82),
    ("Malaysia", 3.14, 101.69),
    ("Mexico", 19.43, -99.13),
    ("NATO", 50.88, 4.42),
    ("Netherlands", 52.37, 4.9),
    ("New Zealand", -41.29, 174.78),
    ("Nigeria", 9.08, 7.4),
    ("Norway", 59.91, 10.75),
    ("Pakistan", 33.68, 73.04),
    ("Peru", -12.05, -77.04),
    ("Philippines", 14.6, 120.98),
    ("Poland", 52.23, 21.01),
    ("Portugal", 38.72, -9.14),
    ("Qatar", 25.29, 51.53),
    ("Romania", 44.43, 26.1),
    ("Russia", 55.76, 37.62),
    ("Saudi Arabia", 24.71, 46.68),
    ("Singapore", 1.35, 103.82),
    ("South Africa", -25.75, 28.19),
    ("South Korea", 37.57, 126.98),
    ("Spain", 40.42, -3.7),
    ("Sri Lanka", 6.93, 79.85),
    ("Sweden", 59.33, 18.07),
    ("Switzerland", 46.95, 7.45),
    ("Taiwan", 25.03, 121.57),
    ("Thailand", 13.76, 100.5),
    ("Turkey", 39.93, 32.85),
    ("Ukraine", 50.45, 30.52),
    ("United Arab Emirates", 24.45, 54.38),
    ("United Kingdom", 51.51, -0.13),
    ("United States", 38.9, -77.04),
    ("Vietnam", 21.03, 105.85),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_hash_matches_node() {
        assert_eq!(fnv_hash("weather.gov"), 1_997_588_017);
    }

    #[test]
    fn public_ipv4_rules_match_the_node_checker() {
        assert!(is_public_ipv4("8.8.8.8"));
        assert!(!is_public_ipv4("10.1.1.1"));
        assert!(!is_public_ipv4("127.0.0.1"));
        assert!(!is_public_ipv4("192.168.1.1"));
        assert!(!is_public_ipv4("172.16.0.1"));
        assert!(is_public_ipv4("172.15.0.1"));
        assert!(!is_public_ipv4("169.254.1.1"));
        assert!(!is_public_ipv4("224.0.0.1"));
        assert!(!is_public_ipv4("999.1.1.1"));
    }

    #[test]
    fn location_line_parses_city_region_country() {
        let line = "San Jose, California 95025, United States";
        assert_eq!(country_from_location(line), "United States");
        assert_eq!(region_from_location(line), "California");
        assert_eq!(
            format_location("San Jose", "California", "95025", "United States"),
            line
        );
    }

    #[test]
    fn globe_mode_jitters_around_the_capital_when_the_cache_misses() {
        let place = Place::new("National Weather Service", "weather.gov");
        let mut place = place;
        place.country = "United States".into();
        let located = locate(&place, &[], None, LocateMode::Globe);
        assert!(located.approx);
        assert!(located.lat.is_some());
        let cached_only = locate(&place, &[], None, LocateMode::CacheOnly);
        assert!(cached_only.lat.is_none());
        assert!(!cached_only.approx);
    }
}
