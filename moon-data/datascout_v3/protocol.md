# Scouting v3 protocol — additional lunar environmental variables

Question: Which official lunar datasets can supply dust, pressure/exosphere,
light and regolith properties, and which can support a south-polar pixel grid?

Prediction, before access probes: at least one explicitly documented spatial
product will be found for light and regolith; dust and gas candidates may instead
be orbital or local time series and must not be treated as surface rasters.
Failure criterion: no official product/label documents the intended property and
spatial representation. A discovered link alone is not product verification.

Protocol: inspect NASA PDS/mission catalogs; follow published links to exact
collections, sample labels and documentation; save bounded metadata snapshots
with timestamps and SHA256. Read no science raster pixels or full data tables.
Maximum each metadata response: 2 MB. Preserve failures and unknowns. Distinguish
catalog coverage, label facts, remote-access success and extraction readiness.

Record units, measurement kind, representation, spatial/temporal support,
quality limitations, labels and blockers in cards and CSV/JSON registry.
No inferred pressure from gas density, no inferred dust mobility from rock
abundance, and no illumination time series invented from static maps.

Deliverables: reusable metadata-only scout, execution evidence, candidate cards,
comparison and extraction-priority recommendation. Extraction remains not run.
