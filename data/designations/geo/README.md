# Designation geocoding policy

Every point is placed at the precision its source published. A city is a city
centroid. A street is a street. Nominatim is not treated as authoritative
(`geo_verified` is always false).

Packed globe JSON lives at `globalstatus/api/designations.json` and
`globalstatus/api/violence.json`. Live jsonl stays gitignored.

SPLC hatemap JSON is public to fetch and local to store. SPLC grants no bulk
redistribution license, so that dump is never committed and is not packed
unless `--include-restricted`.

Nominatim: 1 request per second, User-Agent with `--contact`.
