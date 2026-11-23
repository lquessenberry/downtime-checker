//! Rustle: git-text leaves (entities + fields) for map context.
//!
//! Drupal's job — nodes, bundles, fields, entity references — without PHP or
//! SQL. A **leaf** is one normalized datum (geolocation, geofence, geoorbital,
//! geocell, geotime, catalog). A **grove** is the collection. Stanzas are
//! small RFC822-like text so the map can join live pins to published facts.

#![deny(unsafe_code)]

mod grove;
mod leaf;
mod parse;

pub use grove::{Context, Grove, Nearby};
pub use leaf::{leaf_from_place, Bundle, FieldValue, Leaf, Link, LinkKind};
pub use parse::{parse_leaves, ParseError};

pub const CORE_LEAVES: &str = include_str!("../leaves/core.leaf.txt");

pub fn builtin_grove() -> Grove {
    Grove::builtin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_grove_has_geo_bundles_and_saa_contains_a_point() {
        let grove = builtin_grove();
        assert!(grove.len() >= 8, "{}", grove.len());
        let saa = grove.get("saa").expect("saa");
        assert_eq!(saa.bundle, Bundle::Geofence);
        assert!(saa.contains(-30.0, -20.0));
        assert!(!saa.contains(40.0, -90.0));
        let iss = grove.get("iss").expect("iss");
        assert_eq!(iss.number("norad"), Some(25544.0));
        assert_eq!(iss.number("altitude_km"), Some(400.0));
        let nws = grove.get("nws-hq").expect("nws");
        assert!(nws
            .links
            .iter()
            .any(|link| link.kind == LinkKind::Asset && link.target == "nws-alerts"));
        let ctx = grove.context(-30.0, -20.0);
        assert!(ctx.fences.iter().any(|leaf| leaf.id == "saa"));
        assert!(ctx.orbitals.iter().any(|leaf| leaf.id == "iss"));
    }

    #[test]
    fn parse_rejects_unknown_keys() {
        let err = parse_leaves("id: x\nbundle: geolocation\nnope: 1\n").unwrap_err();
        assert!(err.message.contains("unknown key"), "{err}");
    }

    #[test]
    fn place_row_becomes_a_catalog_or_geolocation_leaf() {
        let with_point = leaf_from_place(
            "nws",
            "National Weather Service",
            "weather.gov",
            "United States",
            Some(38.99),
            Some(-77.02),
        );
        assert_eq!(with_point.bundle, Bundle::Geolocation);
        assert_eq!(with_point.point(), Some((38.99, -77.02)));
        let catalog = leaf_from_place("x", "Example", "example.com", "", None, None);
        assert_eq!(catalog.bundle, Bundle::Catalog);
    }
}
