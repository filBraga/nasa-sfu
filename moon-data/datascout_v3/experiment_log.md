# Scouting v3 execution and conclusion

Protocol: [protocol.md](protocol.md), saved before access probes.
Skills: lunar-data-research, scientific-method and research-documentation.

Environment: Windows PowerShell, project-local CPython 3.12.16. Source script and
configuration SHA256 are recorded in `scout.json`; each request has its UTC check
time and content checksum. No Git commit identifier is claimed.

Execution: `scripts/scout_environment.py` first inspected 18 URLs. Subsequent
`--resume` runs added only explicitly discovered metadata directories and sample
labels, ending at 30 distinct URLs. `--retry-unavailable` retried two failed checks:
the LDEX primary endpoint still failed; the LAMP label succeeded after supporting
bounded `.lbl` text responses with an absent Content-Type. Its PDS3 header was
validated. The previous failure remains in `attempt_history`.

Results: 29/30 metadata URLs readable, eight candidate families, five sample
product labels and one NMS bundle label inspected. No science files downloaded.
The PDS LDEX mirror succeeded although the primary endpoint did not. HTTP success
is access evidence only, not scientific usability or observed polar coverage.

Conclusion: the protocol's prediction is **supported at the metadata level**:
spatial light and regolith products were located; dust and gas have different
representations. South-polar usability is narrower: selected rock abundance and
Hapke products exclude the pole. No south-polar pressure or surface-dust raster
was verified. LAMP is a candidate for the next bounded raster investigation.

Pixel extraction, physically meaningful value checks, raster alignment, previews
and output-layer manifests are **not run** in this scouting stage.

Validation: all eight unittest checks passed, including science-file download
blocking, metadata size limits, XML namespace/unit retention and the v2 bounded
TIFF access checks. Cached snapshot SHA256 validation passed during the final
metadata-only resume. Commands used the project-local Python executable:
`python -m unittest discover -s tests -v` and
`python scripts/scout_environment.py --resume`.
