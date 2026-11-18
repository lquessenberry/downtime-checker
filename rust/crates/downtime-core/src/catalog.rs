//! Parsers for the same catalog files the Python CLI and the Node visualizer read.
//!
//! The sample IP that follows a country in `Name | website | country | ip` rows is
//! ignored. Probes use the website name, because addresses change.

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::model::{Groups, Loaded, Place, SearchCount, SearchDef, Section};

/// Filenames, relative to the catalog root, that make up a full load.
pub const CATALOG_FILES: &[&str] = &[
    "places.txt",
    "added-places.txt",
    "world-governments.txt",
    "institutions.txt",
    "world-exchanges.txt",
    "service-sites.txt",
    "transportation.txt",
    "stores.txt",
    "communications.txt",
    "military.txt",
    "shipping.txt",
    "food.txt",
    "weather.txt",
    "banks-national.txt",
    "utilities-national.txt",
    "government-extra.txt",
];

const SKIP_HOSTS: &[&str] = &[
    "stockanalysis.com",
    "wikipedia.org",
    "newsweek.com",
    "rankings.newsweek.com",
];

const COUNTRY_LABELS: &[(&str, &str)] = &[
    ("united states", "United States"),
    ("united kingdom", "United Kingdom"),
    ("south korea", "South Korea"),
    ("saudi arabia", "Saudi Arabia"),
    ("hong kong", "Hong Kong"),
    ("south africa", "South Africa"),
    ("sri lanka", "Sri Lanka"),
    ("new zealand", "New Zealand"),
    ("switzerland", "Switzerland"),
    ("netherlands", "Netherlands"),
    ("singapore", "Singapore"),
    ("australia", "Australia"),
    ("germany", "Germany"),
    ("france", "France"),
    ("canada", "Canada"),
    ("china", "China"),
    ("japan", "Japan"),
    ("india", "India"),
    ("brazil", "Brazil"),
    ("spain", "Spain"),
    ("italy", "Italy"),
    ("israel", "Israel"),
    ("sweden", "Sweden"),
    ("denmark", "Denmark"),
    ("austria", "Austria"),
    ("russia", "Russia"),
    ("turkey", "Turkey"),
    ("thailand", "Thailand"),
    ("poland", "Poland"),
    ("taiwan", "Taiwan"),
    ("mexico", "Mexico"),
    ("indonesia", "Indonesia"),
    ("vietnam", "Vietnam"),
    ("bangladesh", "Bangladesh"),
    ("malaysia", "Malaysia"),
    ("philippines", "Philippines"),
    ("pakistan", "Pakistan"),
    ("argentina", "Argentina"),
    ("chile", "Chile"),
    ("peru", "Peru"),
    ("finland", "Finland"),
    ("usa", "United States"),
    ("uk", "United Kingdom"),
    ("us", "United States"),
];

const LIST_KINDS: &[(&str, &str)] = &[
    ("MAJOR NATIONWIDE SERVICES", "tech"),
    ("MAJOR NATIONWIDE BANKS", "banks"),
    ("MAIN GOVERNMENT SITES", "government"),
    ("NE ARKANSAS LOCAL BANKS", "banks"),
    ("NE ARKANSAS LOCAL UTILITIES", "utilities"),
];

const SEARCH_DEFS: &[SearchDef] = &[
    SearchDef {
        id: "everything",
        label: "Search everything",
        group: "global",
    },
    SearchDef {
        id: "world",
        label: "World governments",
        group: "global",
    },
    SearchDef {
        id: "united-states",
        label: "United States",
        group: "global",
    },
    SearchDef {
        id: "banks",
        label: "Banks and stock exchanges",
        group: "global",
    },
    SearchDef {
        id: "tech",
        label: "Tech only",
        group: "global",
    },
    SearchDef {
        id: "utilities",
        label: "Utilities only",
        group: "global",
    },
    SearchDef {
        id: "education",
        label: "Education",
        group: "global",
    },
    SearchDef {
        id: "medical",
        label: "Medical",
        group: "global",
    },
    SearchDef {
        id: "exchanges",
        label: "Stock exchanges",
        group: "global",
    },
    SearchDef {
        id: "transport",
        label: "Transportation",
        group: "global",
    },
    SearchDef {
        id: "stores",
        label: "Stores",
        group: "global",
    },
    SearchDef {
        id: "communications",
        label: "Communications",
        group: "global",
    },
    SearchDef {
        id: "military",
        label: "Military",
        group: "global",
    },
    SearchDef {
        id: "shipping",
        label: "Shipping",
        group: "global",
    },
    SearchDef {
        id: "food",
        label: "Food",
        group: "global",
    },
    SearchDef {
        id: "weather",
        label: "Weather",
        group: "global",
    },
    SearchDef {
        id: "us-everything",
        label: "Everything in the United States",
        group: "us",
    },
    SearchDef {
        id: "us-banks",
        label: "US banks and exchanges",
        group: "us",
    },
    SearchDef {
        id: "us-tech",
        label: "US tech",
        group: "us",
    },
    SearchDef {
        id: "us-utilities",
        label: "US utilities",
        group: "us",
    },
    SearchDef {
        id: "us-government",
        label: "US government",
        group: "us",
    },
    SearchDef {
        id: "us-education",
        label: "US education",
        group: "us",
    },
    SearchDef {
        id: "us-medical",
        label: "US medical",
        group: "us",
    },
    SearchDef {
        id: "us-exchanges",
        label: "US stock exchanges",
        group: "us",
    },
    SearchDef {
        id: "us-transport",
        label: "US transportation",
        group: "us",
    },
    SearchDef {
        id: "us-stores",
        label: "US stores",
        group: "us",
    },
    SearchDef {
        id: "us-communications",
        label: "US communications",
        group: "us",
    },
    SearchDef {
        id: "us-military",
        label: "US military",
        group: "us",
    },
    SearchDef {
        id: "us-shipping",
        label: "US shipping",
        group: "us",
    },
    SearchDef {
        id: "us-food",
        label: "US food",
        group: "us",
    },
    SearchDef {
        id: "us-weather",
        label: "US weather",
        group: "us",
    },
];

pub fn searches() -> &'static [SearchDef] {
    SEARCH_DEFS
}

/// Load every catalog from filename to text. Missing names count as empty.
pub fn load_catalog(files: &BTreeMap<String, String>) -> Loaded {
    let groups = load_groups(files);
    let mut countries = Vec::new();
    let mut seen = BTreeSet::new();
    for section in &groups.world {
        let key = section.title.to_lowercase();
        if seen.insert(key) {
            countries.push(section.title.clone());
        }
    }
    countries.sort_by_key(|name| name.to_lowercase());
    let searches = SEARCH_DEFS
        .iter()
        .map(|search| SearchCount {
            id: search.id,
            label: search.label,
            group: search.group,
            count: all_places(&select(&groups, search.id, None)).len(),
        })
        .collect();
    Loaded {
        groups,
        countries,
        searches,
    }
}

pub fn places_for(loaded: &Loaded, id: &str, country: Option<&str>) -> Vec<Place> {
    all_places(&select(&loaded.groups, id, country))
}

fn file<'a>(files: &'a BTreeMap<String, String>, name: &str) -> &'a str {
    files.get(name).map(String::as_str).unwrap_or("")
}

fn load_groups(files: &BTreeMap<String, String>) -> Groups {
    let mut home = load_sections(file(files, "places.txt"));
    tag_list(&mut home);
    let saved = load_saved(file(files, "added-places.txt"));
    if !saved.is_empty() {
        home.push(Section {
            title: "ADDED PLACES".into(),
            places: saved,
        });
    }
    let world = load_world(file(files, "world-governments.txt"));
    let institutions = merge_sections(&[
        load_institutions(file(files, "institutions.txt")),
        load_pipe_catalog(
            file(files, "world-exchanges.txt"),
            "exchanges",
            "exchanges",
            "STOCK EXCHANGES",
        ),
    ]);
    Groups {
        home,
        world,
        institutions,
        services: load_pipe_catalog(
            file(files, "service-sites.txt"),
            "tech",
            "services",
            "TECH SERVICES",
        ),
        transport: load_transportation(file(files, "transportation.txt")),
        stores: load_pipe_catalog(file(files, "stores.txt"), "stores", "stores", "STORES"),
        communications: load_pipe_catalog(
            file(files, "communications.txt"),
            "communications",
            "communications",
            "COMMUNICATIONS",
        ),
        military: load_pipe_catalog(
            file(files, "military.txt"),
            "military",
            "military",
            "MILITARY",
        ),
        shipping: load_pipe_catalog(
            file(files, "shipping.txt"),
            "shipping",
            "shipping",
            "SHIPPING",
        ),
        food: load_pipe_catalog(file(files, "food.txt"), "food", "food", "FOOD"),
        weather: load_pipe_catalog(file(files, "weather.txt"), "weather", "weather", "WEATHER"),
        extra_banks: load_pipe_catalog(
            file(files, "banks-national.txt"),
            "banks",
            "banks",
            "BANKS",
        ),
        extra_utilities: load_pipe_catalog(
            file(files, "utilities-national.txt"),
            "utilities",
            "utilities",
            "UTILITIES",
        ),
        extra_government: load_pipe_catalog(
            file(files, "government-extra.txt"),
            "government",
            "government",
            "GOVERNMENT",
        ),
    }
}

fn select(groups: &Groups, id: &str, country: Option<&str>) -> Vec<Section> {
    match id {
        "everything" => everything(groups),
        "world" => groups.world.clone(),
        "united-states" | "us-everything" => united_states_only(&everything(groups)),
        "banks" => banks_and_exchanges(groups),
        "tech" => tech_sites(groups),
        "utilities" => utility_sites(groups),
        "education" => of_kinds(&groups.institutions, &["education"]),
        "medical" => of_kinds(&groups.institutions, &["medical"]),
        "exchanges" => of_kinds(&groups.institutions, &["exchanges"]),
        "transport" => groups.transport.clone(),
        "stores" => groups.stores.clone(),
        "communications" => groups.communications.clone(),
        "military" => groups.military.clone(),
        "shipping" => groups.shipping.clone(),
        "food" => groups.food.clone(),
        "weather" => groups.weather.clone(),
        "us-banks" => united_states_only(&banks_and_exchanges(groups)),
        "us-tech" => united_states_only(&tech_sites(groups)),
        "us-utilities" => united_states_only(&utility_sites(groups)),
        "us-government" => united_states_only(&government_sites(groups)),
        "us-education" => united_states_only(&of_kinds(&groups.institutions, &["education"])),
        "us-medical" => united_states_only(&of_kinds(&groups.institutions, &["medical"])),
        "us-exchanges" => united_states_only(&of_kinds(&groups.institutions, &["exchanges"])),
        "us-transport" => united_states_only(&groups.transport),
        "us-stores" => united_states_only(&groups.stores),
        "us-communications" => united_states_only(&groups.communications),
        "us-military" => united_states_only(&groups.military),
        "us-shipping" => united_states_only(&groups.shipping),
        "us-food" => united_states_only(&groups.food),
        "us-weather" => united_states_only(&groups.weather),
        "country" => filter_sections(&groups.world, |place| {
            country.is_some_and(|name| place.country == name)
        }),
        _ => Vec::new(),
    }
}

fn everything(groups: &Groups) -> Vec<Section> {
    merged(
        groups,
        &[
            "home",
            "world",
            "institutions",
            "services",
            "transport",
            "stores",
            "communications",
            "military",
            "shipping",
            "food",
            "weather",
            "extra_banks",
            "extra_utilities",
            "extra_government",
        ],
    )
}

fn banks_and_exchanges(groups: &Groups) -> Vec<Section> {
    of_kinds(
        &merged(groups, &["home", "world", "institutions", "extra_banks"]),
        &["banks", "exchanges"],
    )
}

fn tech_sites(groups: &Groups) -> Vec<Section> {
    of_kinds(&merged(groups, &["home", "services"]), &["tech"])
}

fn utility_sites(groups: &Groups) -> Vec<Section> {
    of_kinds(
        &merged(groups, &["home", "extra_utilities"]),
        &["utilities"],
    )
}

fn government_sites(groups: &Groups) -> Vec<Section> {
    of_kinds(
        &merged(groups, &["home", "world", "extra_government"]),
        &["government"],
    )
}

fn group_by_key<'a>(groups: &'a Groups, key: &str) -> &'a [Section] {
    match key {
        "home" => &groups.home,
        "world" => &groups.world,
        "institutions" => &groups.institutions,
        "services" => &groups.services,
        "transport" => &groups.transport,
        "stores" => &groups.stores,
        "communications" => &groups.communications,
        "military" => &groups.military,
        "shipping" => &groups.shipping,
        "food" => &groups.food,
        "weather" => &groups.weather,
        "extra_banks" => &groups.extra_banks,
        "extra_utilities" => &groups.extra_utilities,
        "extra_government" => &groups.extra_government,
        _ => &[],
    }
}

fn merged(groups: &Groups, keys: &[&str]) -> Vec<Section> {
    let parts: Vec<Vec<Section>> = keys
        .iter()
        .map(|key| group_by_key(groups, key).to_vec())
        .collect();
    merge_sections(&parts)
}

fn all_places(sections: &[Section]) -> Vec<Place> {
    sections
        .iter()
        .flat_map(|section| section.places.clone())
        .collect()
}

fn keep_new(places: &[Place], seen: &mut BTreeSet<String>) -> Vec<Place> {
    let mut kept = Vec::new();
    for place in places {
        let key = place.address.to_lowercase();
        if seen.insert(key) {
            kept.push(place.clone());
        }
    }
    kept
}

fn merge_sections(groups: &[Vec<Section>]) -> Vec<Section> {
    let mut seen = BTreeSet::new();
    let mut merged = Vec::new();
    for sections in groups {
        for section in sections {
            let kept = keep_new(&section.places, &mut seen);
            if !kept.is_empty() {
                merged.push(Section {
                    title: section.title.clone(),
                    places: kept,
                });
            }
        }
    }
    merged
}

fn filter_sections(
    sections: &[Section],
    mut predicate: impl FnMut(&Place) -> bool,
) -> Vec<Section> {
    let mut chosen = Vec::new();
    for section in sections {
        let kept: Vec<Place> = section
            .places
            .iter()
            .filter(|place| predicate(place))
            .cloned()
            .collect();
        if !kept.is_empty() {
            chosen.push(Section {
                title: section.title.clone(),
                places: kept,
            });
        }
    }
    chosen
}

fn of_kinds(sections: &[Section], kinds: &[&str]) -> Vec<Section> {
    filter_sections(sections, |place| {
        place
            .kinds
            .iter()
            .any(|kind| kinds.iter().any(|wanted| kind == wanted))
    })
}

fn united_states_only(sections: &[Section]) -> Vec<Section> {
    filter_sections(sections, |place| place.country == "United States")
}

fn tag_list(sections: &mut [Section]) {
    for section in sections {
        let kind = LIST_KINDS
            .iter()
            .find(|(title, _)| *title == section.title.to_uppercase())
            .map(|(_, kind)| *kind);
        for place in &mut section.places {
            if section.title == "ADDED PLACES" {
                place.kinds = alloc::vec!["added".into()];
                place.source = "added".into();
            } else {
                place.kinds = alloc::vec![kind.unwrap_or("added").into()];
                place.source = "list".into();
                place.country = "United States".into();
            }
        }
    }
}

fn load_sections(text: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut title = String::from("Places");
    let mut group = Vec::new();
    let mut skip = false;
    for raw in lines(text) {
        let line = raw.trim();
        if line.is_empty()
            || line.starts_with("Note:")
            || line.starts_with("Generated:")
            || line.starts_with("- ")
            || line.starts_with('#')
        {
            continue;
        }
        if line.starts_with("===") && line.ends_with("===") {
            if !group.is_empty() && !skip {
                sections.push(Section {
                    title: title.clone(),
                    places: core::mem::take(&mut group),
                });
            }
            group.clear();
            title = line.replace('=', "");
            title = collapse_ws(title.trim());
            if title.is_empty() {
                title = "Places".into();
            }
            skip = title.to_uppercase() == "ADDED PLACES";
            continue;
        }
        if skip {
            continue;
        }
        let parts = split_bar(line);
        if parts.len() < 2 || parts.len() > 3 || parts[0].is_empty() || parts[1].is_empty() {
            continue;
        }
        let address = catalog_host(parts[1]);
        if !valid_address(&address) {
            continue;
        }
        group.push(Place::new(parts[0], address));
    }
    if !group.is_empty() && !skip {
        sections.push(Section {
            title,
            places: group,
        });
    }
    sections
}

fn load_saved(text: &str) -> Vec<Place> {
    let mut entries = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in lines(text) {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts = split_bar(line);
        if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
            continue;
        }
        let address = catalog_host(parts[1]);
        if address.is_empty() || !seen.insert(address.clone()) {
            continue;
        }
        let mut entry = Place::new(parts[0], address);
        entry.kinds = alloc::vec!["added".into()];
        entry.source = "added".into();
        if parts.len() >= 3 && !parts[2].is_empty() {
            entry.location = parts[2].to_string();
        }
        if parts.len() >= 5 {
            if let (Ok(lat), Ok(lon)) = (parts[3].parse::<f64>(), parts[4].parse::<f64>()) {
                if lat.is_finite() && lon.is_finite() {
                    entry.lat = Some(lat);
                    entry.lon = Some(lon);
                }
            }
        }
        entries.push(entry);
    }
    entries
}

fn load_world(text: &str) -> Vec<Section> {
    let raw_lines: Vec<&str> = lines(text).collect();
    let mut sections = Vec::new();
    let mut current = String::new();
    let mut group = Vec::new();
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while index < raw_lines.len() {
        let line = raw_lines[index].trim();
        index += 1;
        if line.is_empty() {
            continue;
        }
        if is_bar_line(line) {
            let mut look = index;
            while look < raw_lines.len() && raw_lines[look].trim().is_empty() {
                look += 1;
            }
            if look >= raw_lines.len() || is_bar_line(raw_lines[look].trim()) {
                continue;
            }
            let title = raw_lines[look].trim();
            look += 1;
            while look < raw_lines.len() && raw_lines[look].trim().is_empty() {
                look += 1;
            }
            if look >= raw_lines.len() || !is_bar_line(raw_lines[look].trim()) {
                continue;
            }
            index = look + 1;
            flush_world(&mut sections, &current, &mut group);
            seen.clear();
            let upper = title.to_uppercase();
            if upper.starts_with("NOTE") {
                current = "SKIP".into();
            } else if upper.starts_with("ADDITIONAL COUNTRIES") {
                current = "ADDITIONAL".into();
            } else {
                current = pretty_country(title);
            }
            continue;
        }
        if current.is_empty() || current == "SKIP" {
            continue;
        }
        if current == "ADDITIONAL" {
            let label = if let Some((head, _)) = line.split_once(':') {
                head.trim()
            } else {
                line
            };
            let country = {
                let pretty = pretty_country(label);
                if pretty.is_empty() {
                    "Unknown".into()
                } else {
                    pretty
                }
            };
            let made = government_entries(line, &country);
            if !made.is_empty() {
                let title = made[0].country.clone();
                sections.push(Section {
                    title,
                    places: made,
                });
            }
            continue;
        }
        for entry in government_entries(line, &current) {
            if seen.insert(entry.address.clone()) {
                group.push(entry);
            }
        }
    }
    flush_world(&mut sections, &current, &mut group);
    sections
}

fn flush_world(sections: &mut Vec<Section>, current: &str, group: &mut Vec<Place>) {
    if !current.is_empty() && current != "SKIP" && current != "ADDITIONAL" && !group.is_empty() {
        sections.push(Section {
            title: current.to_string(),
            places: core::mem::take(group),
        });
    }
    group.clear();
}

fn government_entries(line: &str, country: &str) -> Vec<Place> {
    let hosts = hosts_in_text(line);
    if hosts.is_empty() {
        return Vec::new();
    }
    let mut label = strip_bullet(line.trim()).to_string();
    if let Some((head, _)) = label.split_once(':') {
        label = head.trim().to_string();
    }
    if label.is_empty() {
        label = country.to_string();
    }
    let mut kinds = alloc::vec!["government".to_string()];
    let lowered = label.to_lowercase();
    if lowered.contains("bank") || lowered.contains("reserve") {
        kinds.push("banks".into());
    }
    hosts
        .into_iter()
        .enumerate()
        .map(|(index, host)| {
            let name = if index == 0 {
                label.clone()
            } else {
                alloc::format!("{label} ({host})")
            };
            let mut place = Place::new(name, host);
            place.country = country.to_string();
            place.kinds = kinds.clone();
            place.source = "world".into();
            place
        })
        .collect()
}

fn load_institutions(text: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut kind = "";
    let mut title = String::new();
    let mut group = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in lines(text) {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let upper = line.to_uppercase();
        if upper.starts_with("SECTION 1") {
            flush_inst(&mut sections, &title, &mut group);
            kind = "exchanges";
            title = "STOCK EXCHANGES".into();
            continue;
        }
        if upper.starts_with("SECTION 2") {
            flush_inst(&mut sections, &title, &mut group);
            kind = "banks";
            title = "BANKS".into();
            continue;
        }
        if upper.starts_with("SECTION 3") {
            flush_inst(&mut sections, &title, &mut group);
            kind = "education";
            title = "EDUCATION".into();
            continue;
        }
        if upper.starts_with("SECTION 4") {
            flush_inst(&mut sections, &title, &mut group);
            kind = "medical";
            title = "HOSPITALS".into();
            continue;
        }
        if upper.starts_with("B. TOP PHARMACEUTICAL") {
            flush_inst(&mut sections, &title, &mut group);
            kind = "medical";
            title = "PHARMACEUTICALS".into();
            continue;
        }
        if kind.is_empty() || !is_inst_line(line) {
            continue;
        }
        for entry in institution_entries(line, kind) {
            if seen.insert(entry.address.clone()) {
                group.push(entry);
            }
        }
    }
    flush_inst(&mut sections, &title, &mut group);
    sections
}

fn flush_inst(sections: &mut Vec<Section>, title: &str, group: &mut Vec<Place>) {
    if !title.is_empty() && !group.is_empty() {
        sections.push(Section {
            title: title.to_string(),
            places: core::mem::take(group),
        });
    }
    group.clear();
}

fn institution_entries(line: &str, kind: &str) -> Vec<Place> {
    let hosts: Vec<String> = hosts_in_text(line)
        .into_iter()
        .filter(|host| !SKIP_HOSTS.contains(&host.as_str()) && !host.ends_with(".example"))
        .collect();
    if hosts.is_empty() {
        return Vec::new();
    }
    let pieces: Vec<&str> = line
        .split(" - ")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    let mut domain_at = 0;
    for (index, piece) in pieces.iter().enumerate() {
        let lowered = piece.to_lowercase();
        if hosts.iter().any(|host| lowered.contains(host)) {
            domain_at = index;
            break;
        }
    }
    let mut name = if domain_at == 0 {
        pieces.first().copied().unwrap_or("").to_string()
    } else {
        pieces[..domain_at].join(" - ")
    };
    name = clean_inst_name(&name);
    if name.is_empty() {
        name = hosts[0].clone();
    }
    let country = country_in_text(line);
    hosts
        .into_iter()
        .enumerate()
        .map(|(index, host)| {
            let entry_name = if index == 0 {
                name.clone()
            } else {
                alloc::format!("{name} ({host})")
            };
            let mut place = Place::new(entry_name, host);
            place.country = country.clone();
            place.kinds = alloc::vec![kind.to_string()];
            place.source = "institutions".into();
            place
        })
        .collect()
}

fn load_pipe_catalog(text: &str, kind: &str, source: &str, title: &str) -> Vec<Section> {
    let mut group = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in lines(text) {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts = split_bar(line);
        if parts.len() < 2 || parts[0].is_empty() {
            continue;
        }
        let host = catalog_host(parts[1]);
        if host.is_empty() || !valid_address(&host) || !seen.insert(host.clone()) {
            continue;
        }
        let mut place = Place::new(parts[0], host);
        place.country = if parts.len() > 2 {
            parts[2].to_string()
        } else {
            String::new()
        };
        place.kinds = alloc::vec![kind.to_string()];
        place.source = source.to_string();
        group.push(place);
    }
    if group.is_empty() {
        Vec::new()
    } else {
        alloc::vec![Section {
            title: title.into(),
            places: group
        }]
    }
}

fn load_transportation(text: &str) -> Vec<Section> {
    let mut buckets: Vec<(String, Vec<Place>)> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut country = String::new();
    for raw in lines(text) {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with("===") && line.ends_with("===") {
            country = line.replace('=', "");
            country = collapse_ws(country.trim());
            continue;
        }
        let parts = split_bar(line);
        if parts.len() < 4 || country.is_empty() {
            continue;
        }
        let kind_label = parts[0];
        let name = parts[1];
        let website = parts[3];
        let host = catalog_host(website);
        if host.is_empty() || !valid_address(&host) || !seen.insert(host.clone()) {
            continue;
        }
        let label = if kind_label.is_empty() {
            name.to_string()
        } else {
            alloc::format!("{name} ({kind_label})")
        };
        let mut place = Place::new(label, host);
        place.country = country.clone();
        place.kinds = alloc::vec!["transportation".into()];
        place.source = "transportation".into();
        if let Some((_, group)) = buckets.iter_mut().find(|(name, _)| name == &country) {
            group.push(place);
        } else {
            buckets.push((country.clone(), alloc::vec![place]));
        }
    }
    buckets
        .into_iter()
        .filter(|(_, group)| !group.is_empty())
        .map(|(title, places)| Section { title, places })
        .collect()
}

/// Website name from a catalog cell or from something typed into "add a place".
pub fn catalog_host(text: &str) -> String {
    let text = text.trim().to_lowercase();
    let host = if text.contains("://") {
        hostname_of(&text).unwrap_or_default()
    } else {
        text
    };
    host.trim_end_matches('.').to_string()
}

/// Accept a dotted IPv4 (any octet text of 1–3 digits, matching the Node checker)
/// or a DNS name. Empty strings and single labels are rejected.
pub fn valid_address(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }
    if looks_like_ipv4(host) {
        return true;
    }
    if host.len() > 253 || !host.contains('.') {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

pub(crate) fn looks_like_ipv4(host: &str) -> bool {
    let mut parts = host.split('.');
    let mut count = 0;
    for part in parts.by_ref() {
        count += 1;
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    count == 4
}

/// Normalize an address typed into the menu. `None` means it is not usable.
pub fn normalize_address(raw: &str) -> Option<String> {
    let mut text = raw.trim().to_string();
    if text.is_empty() || text.contains('|') || text.chars().any(char::is_whitespace) {
        return None;
    }
    if !text.contains("://") && text.contains('/') {
        text = alloc::format!("http://{text}");
    }
    if text.contains("://") {
        text = hostname_of(&text.to_lowercase())?;
    } else {
        text = text.to_lowercase();
    }
    let text = text.trim_end_matches('.').to_string();
    if valid_address(&text) {
        Some(text)
    } else {
        None
    }
}

fn hostname_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    if rest.is_empty() {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    if authority.is_empty() {
        return None;
    }
    if let Some(stripped) = authority.strip_prefix('[') {
        let host = stripped.split(']').next().unwrap_or("");
        if host.is_empty() {
            return None;
        }
        return Some(host.to_string());
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.is_empty() && !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Some(host.to_string());
        }
    }
    Some(authority.to_string())
}

fn hosts_in_text(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut hosts = Vec::new();
    let mut seen = BTreeSet::new();
    let spans = url_spans(&lower);
    for (start, end) in &spans {
        if let Some(host) = hostname_of(&lower[*start..*end]) {
            push_host(&mut hosts, &mut seen, host);
        }
    }
    let mut bytes = lower.into_bytes();
    for (start, end) in spans {
        for byte in &mut bytes[start..end] {
            *byte = b' ';
        }
    }
    let leftover = String::from_utf8(bytes).unwrap_or_default();
    for host in bare_hosts(&leftover) {
        push_host(&mut hosts, &mut seen, host);
    }
    hosts
}

fn push_host(hosts: &mut Vec<String>, seen: &mut BTreeSet<String>, host: String) {
    let host = host.trim_end_matches('.').to_string();
    if host.is_empty() || !valid_address(&host) || !seen.insert(host.clone()) {
        return;
    }
    hosts.push(host);
}

fn url_spans(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut index = 0;
    let mut spans = Vec::new();
    while index < bytes.len() {
        let rest = &bytes[index..];
        let scheme = if rest.starts_with(b"https://") {
            Some(8)
        } else if rest.starts_with(b"http://") {
            Some(7)
        } else {
            None
        };
        if let Some(len) = scheme {
            let start = index;
            index += len;
            while index < bytes.len() && is_url_byte(bytes[index]) {
                index += 1;
            }
            spans.push((start, index));
        } else {
            index += 1;
        }
    }
    spans
}

fn is_url_byte(byte: u8) -> bool {
    !byte.is_ascii_whitespace()
        && !matches!(byte, b'<' | b'>' | b'"' | b'\'' | b')' | b']' | b',' | b';')
}

fn bare_hosts(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut hosts = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let boundary = index == 0 || !is_js_word_byte(bytes[index - 1]);
        if boundary {
            if let Some(end) = match_bare_host(bytes, index) {
                let after_ok = end == bytes.len() || !is_js_word_byte(bytes[end]);
                if after_ok && end > index {
                    hosts.push(String::from_utf8_lossy(&bytes[index..end]).into_owned());
                    index = end;
                    continue;
                }
            }
        }
        index += 1;
    }
    hosts
}

fn match_bare_host(bytes: &[u8], start: usize) -> Option<usize> {
    let mut labels: Vec<(usize, usize)> = Vec::new();
    let mut index = start;
    loop {
        if index >= bytes.len() || !is_host_label_byte(bytes[index]) {
            break;
        }
        let label_start = index;
        while index < bytes.len() && is_host_label_byte(bytes[index]) {
            index += 1;
        }
        labels.push((label_start, index));
        if index < bytes.len() && bytes[index] == b'.' {
            index += 1;
            continue;
        }
        break;
    }
    if labels.len() < 2 {
        return None;
    }
    let (label_start, label_end) = *labels.last()?;
    let tld = &bytes[label_start..label_end];
    if tld.len() >= 2 && tld.iter().all(|byte| byte.is_ascii_lowercase()) {
        Some(label_end)
    } else {
        None
    }
}

fn is_host_label_byte(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
}

fn is_js_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn pretty_country(title: &str) -> String {
    let title = collapse_ws(title.trim());
    if title.to_uppercase() == "UNITED STATES OF AMERICA" {
        return "United States".into();
    }
    let (head, tail) = match title.find('(') {
        Some(index) => (&title[..index], &title[index..]),
        None => (title.as_str(), ""),
    };
    if head.trim().to_uppercase() == "NATO" {
        return if tail.is_empty() {
            "NATO".into()
        } else {
            alloc::format!("NATO {tail}")
        };
    }
    if !head.trim().is_empty() && head == head.to_uppercase() {
        return alloc::format!("{}{tail}", js_title_case(head));
    }
    if title == title.to_uppercase() {
        return js_title_case(&title);
    }
    title
}

fn js_title_case(text: &str) -> String {
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    let mut out = String::new();
    for (index, ch) in lower.iter().enumerate() {
        let prev_word = index > 0 && is_js_word(lower[index - 1]);
        if is_js_word(*ch) && !prev_word {
            for upper in ch.to_uppercase() {
                out.push(upper);
            }
        } else {
            out.push(*ch);
        }
    }
    out
}

fn is_js_word(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn country_in_text(text: &str) -> String {
    let lowered = text.to_lowercase();
    for (needle, label) in COUNTRY_LABELS {
        if contains_word(&lowered, needle) {
            return (*label).to_string();
        }
    }
    String::new()
}

fn contains_word(haystack: &str, needle: &str) -> bool {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    let last = haystack.len() - needle.len();
    let mut index = 0;
    while index <= last {
        if &haystack[index..index + needle.len()] == needle {
            let before = index == 0 || !is_js_word_byte(haystack[index - 1]);
            let after_at = index + needle.len();
            let after = after_at == haystack.len() || !is_js_word_byte(haystack[after_at]);
            if before && after {
                return true;
            }
        }
        index += 1;
    }
    false
}

fn clean_inst_name(name: &str) -> String {
    let bytes = name.as_bytes();
    let mut index = 0;
    let start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index > start && index < bytes.len() && bytes[index] == b'.' {
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
    } else {
        index = 0;
    }
    let mut text = &name[index..];
    if let Some(rest) = text.strip_prefix('-') {
        text = rest.trim_start();
    }
    text.trim_matches(|ch: char| ch.is_whitespace() || ch == '-')
        .to_string()
}

fn is_inst_line(line: &str) -> bool {
    let bytes = line.as_bytes();
    if bytes.first() == Some(&b'-') {
        return bytes.get(1).is_some_and(|byte| byte.is_ascii_whitespace());
    }
    let mut index = 0;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index == 0 || index >= bytes.len() || bytes[index] != b'.' {
        return false;
    }
    index += 1;
    index < bytes.len() && bytes[index].is_ascii_whitespace()
}

fn strip_bullet(line: &str) -> &str {
    match line.strip_prefix('-') {
        Some(rest) => rest.trim_start(),
        None => line,
    }
}

fn is_bar_line(line: &str) -> bool {
    !line.is_empty() && line.bytes().all(|byte| byte == b'=')
}

fn split_bar(line: &str) -> Vec<&str> {
    line.split('|').map(str::trim).collect()
}

fn collapse_ws(text: &str) -> String {
    let mut out = String::new();
    let mut pending = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            pending = !out.is_empty();
        } else {
            if pending {
                out.push(' ');
                pending = false;
            }
            out.push(ch);
        }
    }
    out
}

fn lines(text: &str) -> impl Iterator<Item = &str> {
    text.split('\n').map(|line| line.trim_end_matches('\r'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::ToString;
    use std::fs;
    use std::path::PathBuf;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    fn load_repo() -> Loaded {
        let root = repo_root();
        let mut files = BTreeMap::new();
        for name in CATALOG_FILES {
            let path = root.join(name);
            let text = fs::read(&path)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                .unwrap_or_default();
            files.insert((*name).to_string(), text);
        }
        load_catalog(&files)
    }

    #[test]
    fn sample_ip_is_not_the_address() {
        let loaded = load_repo();
        let weather = places_for(&loaded, "weather", None);
        assert_eq!(
            weather
                .iter()
                .map(|place| place.address.as_str())
                .collect::<Vec<_>>(),
            vec![
                "weather.gov",
                "weather.com",
                "accuweather.com",
                "wunderground.com"
            ]
        );
        assert!(weather.iter().all(|place| place.country == "United States"));
        assert!(weather.iter().all(|place| place.kinds == ["weather"]));
    }

    #[test]
    fn search_counts_match_the_node_catalog() {
        let loaded = load_repo();
        let expected = [
            ("everything", 1344),
            ("world", 256),
            ("united-states", 417),
            ("banks", 274),
            ("tech", 89),
            ("utilities", 22),
            ("education", 25),
            ("medical", 38),
            ("exchanges", 191),
            ("transport", 316),
            ("stores", 59),
            ("communications", 95),
            ("military", 121),
            ("shipping", 5),
            ("food", 17),
            ("weather", 4),
            ("us-everything", 417),
            ("us-banks", 47),
            ("us-tech", 88),
            ("us-utilities", 21),
            ("us-government", 66),
            ("us-education", 16),
            ("us-medical", 16),
            ("us-exchanges", 9),
            ("us-transport", 15),
            ("us-stores", 49),
            ("us-communications", 60),
            ("us-military", 23),
            ("us-shipping", 4),
            ("us-food", 17),
            ("us-weather", 4),
        ];
        assert_eq!(loaded.searches.len(), expected.len());
        for (search, (id, count)) in loaded.searches.iter().zip(expected) {
            assert_eq!(search.id, id);
            assert_eq!(search.count, count, "count for {id}");
        }
        assert_eq!(loaded.countries.len(), 181);
    }

    #[test]
    fn known_rows_match_the_node_parser() {
        let loaded = load_repo();
        let exchanges = places_for(&loaded, "exchanges", None);
        assert_eq!(exchanges[0].name, "Nasdaq (United States, New York)");
        assert_eq!(exchanges[0].address, "nasdaq.com");
        assert_eq!(exchanges[0].source, "institutions");

        let banks = places_for(&loaded, "banks", None);
        assert_eq!(banks[0].name, "Chase");
        assert_eq!(banks[0].address, "chase.com");
        assert_eq!(banks[0].source, "list");
        assert!(banks.iter().any(|place| {
            place.address == "jpmorganchase.com" && place.name == "JPMorgan Chase - New York, USA"
        }));

        let nato = places_for(&loaded, "country", Some("NATO (Multinational)"));
        assert_eq!(
            nato.iter()
                .map(|place| place.address.as_str())
                .collect::<Vec<_>>(),
            vec!["www.nato.int", "shape.nato.int", "www.act.nato.int"]
        );

        let turkey = places_for(&loaded, "country", Some("Turkey"));
        assert_eq!(turkey[0].address, "www.turkiye.gov.tr");
        assert_eq!(turkey[1].name, "Turkey (gov.tr)");
        assert_eq!(turkey[1].address, "gov.tr");

        let transport = places_for(&loaded, "transport", None);
        assert_eq!(transport[0].name, "Ariana Afghan Airlines (Airline)");
        assert_eq!(transport[0].address, "www.flyariana.com");
        assert_eq!(transport[0].country, "Afghanistan");

        let us = places_for(&loaded, "country", Some("United States"));
        assert_eq!(us[0].name, "Official Portal");
        assert_eq!(us[0].address, "www.usa.gov");
        assert!(us
            .iter()
            .any(|place| place.kinds.iter().any(|kind| kind == "banks")));
    }

    #[test]
    fn hosts_and_normalize() {
        assert_eq!(
            hosts_in_text("Official Portal: https://www.usa.gov"),
            vec!["www.usa.gov".to_string()]
        );
        assert_eq!(
            hosts_in_text("Turkey: https://www.turkiye.gov.tr or gov.tr"),
            vec!["www.turkiye.gov.tr".to_string(), "gov.tr".to_string()]
        );
        assert_eq!(
            catalog_host("https://www.flyariana.com"),
            "www.flyariana.com"
        );
        assert_eq!(
            normalize_address(" Example.COM ").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            normalize_address("https://weather.gov/path").as_deref(),
            Some("weather.gov")
        );
        assert!(normalize_address("not a host").is_none());
        assert!(normalize_address("localhost").is_none());
    }
}
