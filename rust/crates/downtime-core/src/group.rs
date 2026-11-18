//! Group finished checks the way the Python CLI prints them: country, then state.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::geo::{country_from_location, region_from_location};
use crate::model::{Report, Status};

#[derive(Clone, Debug, PartialEq)]
pub struct StateGroup {
    pub state: String,
    pub reports: Vec<Report>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CountryGroup {
    pub country: String,
    pub states: Vec<StateGroup>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Grouped {
    pub checked: usize,
    pub online: usize,
    pub offline: usize,
    pub countries: Vec<String>,
    pub by_location: Vec<CountryGroup>,
}

pub fn summarize(reports: &[Report]) -> Grouped {
    let online = reports
        .iter()
        .filter(|report| report.status == Status::Up)
        .count();
    let offline = reports
        .iter()
        .filter(|report| report.status == Status::Down)
        .count();
    let mut countries = Vec::new();
    for report in reports {
        let country = country_of(report);
        if country.is_empty() {
            continue;
        }
        if !countries
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&country))
        {
            countries.push(country);
        }
    }
    countries.sort_by_key(|name| name.to_lowercase());

    let mut buckets: Vec<CountryGroup> = Vec::new();
    for report in reports {
        let country = display_country(report);
        let state = display_state(report);
        let country_group =
            if let Some(group) = buckets.iter_mut().find(|group| group.country == country) {
                group
            } else {
                buckets.push(CountryGroup {
                    country: country.clone(),
                    states: Vec::new(),
                });
                buckets.last_mut().unwrap()
            };
        if let Some(state_group) = country_group
            .states
            .iter_mut()
            .find(|group| group.state == state)
        {
            state_group.reports.push(report.clone());
        } else {
            country_group.states.push(StateGroup {
                state,
                reports: alloc::vec![report.clone()],
            });
        }
    }
    buckets.sort_by_key(|country| location_sort(&country.country));
    for country in &mut buckets {
        country
            .states
            .sort_by_key(|state| (state.state == "Unknown", state.state.to_lowercase()));
        for state in &mut country.states {
            state
                .reports
                .sort_by_key(|report| report.place.name.to_lowercase());
        }
    }

    Grouped {
        checked: reports.len(),
        online,
        offline,
        countries,
        by_location: buckets,
    }
}

pub fn checked_address(host: &str, ip: &str) -> String {
    if !ip.is_empty() && ip != host {
        alloc::format!("{host} ({ip})")
    } else {
        host.to_string()
    }
}

pub fn country_of(report: &Report) -> String {
    let country = report.place.country.trim();
    if !country.is_empty() {
        return country.to_string();
    }
    country_from_location(&report.place.location)
}

pub fn display_country(report: &Report) -> String {
    let location = report.place.location.trim();
    if location == "Local network" {
        return "Local network".into();
    }
    if location == "Location not found" {
        return "Location not found".into();
    }
    // An omitted location still honors an explicit country. The CLI fills in
    // "Location not found" before it groups, so this only changes callers such
    // as the WASM aggregate that leave location blank on purpose.
    if location.is_empty() {
        let country = report.place.country.trim();
        if !country.is_empty() {
            return country.to_string();
        }
        return "Location not found".into();
    }
    let country = report.place.country.trim();
    if !country.is_empty() {
        return country.to_string();
    }
    let parsed = country_from_location(location);
    if parsed.is_empty() {
        "Location not found".into()
    } else {
        parsed
    }
}

pub fn display_state(report: &Report) -> String {
    if matches!(
        display_country(report).as_str(),
        "Location not found" | "Local network"
    ) {
        return String::new();
    }
    let region = report.place.region.trim();
    if !region.is_empty() {
        return region.to_string();
    }
    let parsed = region_from_location(&report.place.location);
    if parsed.is_empty() {
        "Unknown".into()
    } else {
        parsed
    }
}

fn location_sort(name: &str) -> (u8, String) {
    if name == "Location not found" || name == "Local network" {
        (1, name.to_lowercase())
    } else {
        (0, name.to_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Method, Place};

    fn report(name: &str, country: &str, location: &str, region: &str, status: Status) -> Report {
        let mut place = Place::new(name, "example.com");
        place.country = country.into();
        place.location = location.into();
        place.region = region.into();
        Report {
            place,
            status,
            method: Method::Ping,
            elapsed_ms: 1,
            ips: Vec::new(),
            ip: String::new(),
            approx: false,
        }
    }

    #[test]
    fn groups_by_country_then_state_and_counts_up_down() {
        let reports = vec![
            report(
                "Bravo",
                "United States",
                "Dallas, Texas 75201, United States",
                "Texas",
                Status::Down,
            ),
            report(
                "Alpha",
                "United States",
                "San Jose, California 95025, United States",
                "California",
                Status::Up,
            ),
            report("Missing", "", "", "", Status::Down),
        ];
        let grouped = summarize(&reports);
        assert_eq!(grouped.checked, 3);
        assert_eq!(grouped.online, 1);
        assert_eq!(grouped.offline, 2);
        assert_eq!(grouped.countries, vec!["United States".to_string()]);
        assert_eq!(grouped.by_location[0].country, "United States");
        assert_eq!(grouped.by_location[1].country, "Location not found");
        assert_eq!(grouped.by_location[0].states[0].state, "California");
        assert_eq!(
            grouped.by_location[0].states[0].reports[0].place.name,
            "Alpha"
        );
        assert_eq!(grouped.by_location[0].states[1].state, "Texas");
        assert_eq!(
            checked_address("weather.gov", "1.2.3.4"),
            "weather.gov (1.2.3.4)"
        );
        assert_eq!(checked_address("1.2.3.4", "1.2.3.4"), "1.2.3.4");
    }

    #[test]
    fn explicit_country_groups_when_location_is_omitted() {
        let grouped = summarize(&[report("Austin", "United States", "", "Texas", Status::Up)]);
        assert_eq!(grouped.countries, vec!["United States".to_string()]);
        assert_eq!(grouped.by_location.len(), 1);
        assert_eq!(grouped.by_location[0].country, "United States");
        assert_eq!(grouped.by_location[0].states[0].state, "Texas");
    }
}
