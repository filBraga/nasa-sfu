# Scouting v2 result

Protocol: [scouting_protocol.md](../scouting_protocol.md), written before this run.
Evidence: [scout_v2.json](../scout_v2.json), including UTC run timestamp and remote IDs.

Environment: Windows PowerShell; project-local CPython 3.12.16 installed using uv.
Initial download failed certificate validation; system certificate support allowed
installation. Python executable is local; registry/PATH setup was unavailable.

Actual commands:

```powershell
& '.\.tools\python\cpython-3.12.16-windows-x86_64-none\python.exe' scripts/scout_lunar.py --south-only --probe --max-probes 10 --output research/scout_v2.json
& '.\.tools\python\cpython-3.12.16-windows-x86_64-none\python.exe' scripts/summarize_scout.py research/scout_v2.json
```

Observations: all three discovery pages read; 65 south-polar candidate TIFF links;
10 selected access probes, 9 successful (16-byte TIFF signatures and HTTP ranges).
The 60 m solar COG link returned non-TIFF content despite HTTP 206. It is rejected.
The corresponding ordinary TIFF returned a valid signature and range response;
its tiling/COG layout and efficient GDAL readability remain unverified.
No full raster downloaded. Raster pixel extraction **not run**.

Conclusion: prediction that every selected file passes is **not supported** (9/10).
Nine files are access candidates; none is yet verified for physical pixel use.
See the exact-product registry and individual cards here. The original broad
`research/dataset_registry.csv` is retained as the family-level candidate index.

A separate bounded urllib request read one discovered Diviner XML label (13 KB),
saved unchanged in this directory; its SHA256 and metadata are in its card.
No Diviner ASCII data table was downloaded. The optional UCLA browse-raster
directory could not be fetched through the web tool (502); the PDS listing and
label were accessible. A failed web-tool fetch is not proof of archive outage.

Limitations: no raster header metadata inspected beyond TIFF signatures; exact
CRS, vertical datum, units/scaling, masks and valid spatial coverage must be
verified before a native-window extraction. Catalog pixel spacing is not
effective spatial resolution. No output layer manifests are generated because
no scientific raster layer has been exported.

Validation: Python byte-compilation passed for the scout; five unittest regression
checks passed for quality-layer classification, solar/Earth section separation,
non-TIFF rejection, truncated-header rejection, and refusing to read full bodies
when a server ignores Range. Command: `python -m unittest discover -s tests -v`
using the project-local interpreter above.
