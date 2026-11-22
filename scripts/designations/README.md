# Designation claims (#60)

Government lists first. Every record is a **claim by a named designator**, not
a fact about the organization. County or country only — never a street or city.

```bash
python3 scripts/designations/designations.py --list-designators
python3 scripts/designations/designations.py --ingest un --out data/designations
python3 scripts/designations/designations.py --report --out data/designations
python3 -m unittest scripts/designations/tests/test_designations.py
```

UN individuals are skipped unless `--include-individuals`. Do not put named
people on the globe.

NGO CSVs (SPLC, ADL, InfluenceWatch) are local-only. SPLC grants no bulk
redistribution license; do not commit that jsonl. A layer with SPLC and no
counter-designator fails `SYMMETRY.md`.

Government legal designations and NGO catalogs must not share a mark style
on the globe. Attributed violence is UCDP/ACLED, a different variable.

No Cesium overlay in this change. No FTP.
