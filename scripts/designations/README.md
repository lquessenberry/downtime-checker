# Designation claims (#60)

Government lists first. Every record is a **claim by a named designator**, not
a fact about the organization. Addresses the source published stay on the record.

```bash
python3 scripts/designations/designations.py --list-designators
python3 scripts/designations/designations.py --ingest un --out data/designations
python3 scripts/designations/designations.py --report --out data/designations
python3 -m unittest scripts/designations/tests/test_designations.py
```

Individuals are ingested by default. `--entities-only` skips them.

```bash
python3 scripts/designations/designations.py --ingest fto --out data/designations
python3 scripts/designations/designations.py --ingest uk --out data/designations
python3 scripts/designations/geocode_designations.py --no-nominatim --stats \
  --pack globalstatus/api/designations.json
```

NGO dumps (SPLC hatemap JSON) stay local. SPLC grants no bulk redistribution
license; do not commit that jsonl. Government gold pins and NGO purple pins
are different marks. UCDP/ACLED is the violence layer.

Shared `claims.jsonl` (#59) holds designation, violence, and contested-zone
rows. Same fields: claimant, basis, asserted_date, status, geometry or
county_fips. Distinct globe renderers: DESIGNATIONS, ATTRIBUTED VIOLENCE,
CONFLICT TRACKER (zones).

```bash
python3 scripts/designations/designations.py --ingest zones --out data/designations
python3 scripts/designations/designations.py --filter zone --out data/designations
```

Cesium layers: DESIGNATIONS, ATTRIBUTED VIOLENCE. NUKEMAP is an external
link, not an iframe. No FTP until Lee says go-live.
