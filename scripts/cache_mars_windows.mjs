/** Read only native DEM windows; system CAs keep TLS verification enabled. */
import { fromCustomClient, BaseClient, BaseResponse } from '../moon-data/node_modules/geotiff/dist-module/geotiff.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif';
const config = JSON.parse(await readFile(resolve(root, 'config/sites.json'), 'utf8'));
const wanted = process.argv.slice(2);
const sites = config.sites.filter(s => s.body === 'mars' && (!wanted.length || wanted.includes(s.id)));
class CachedResponse extends BaseResponse {
  constructor(response, bytes) { super(); this.response = response; this.bytes = bytes; }
  get status() { return this.response.status; }
  getHeader(name) { return this.response.headers.get(name); }
  async getData() { return this.bytes; }
}
class RangeClient extends BaseClient {
  constructor(url) { super(url); this.tail = Promise.resolve(); }
  async request({ headers }) {
    // Serial requests avoid exhausting the host connection pool for TIFF blocks.
    const previous = this.tail;
    let release; this.tail = new Promise(done => { release = done; });
    await previous;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(this.url, { headers, signal: AbortSignal.timeout(45000) });
          if (response.status !== 206) { await response.body?.cancel(); throw Error(`Range HTTP ${response.status}`); }
          const bytes = await response.arrayBuffer();
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          const requested = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
          if (!match || !requested || +match[1] !== +requested[1] ||
              +match[2] !== Math.min(+requested[2], +match[3] - 1) || bytes.byteLength !== +match[2] - +match[1] + 1) {
            throw Error('Invalid or truncated DEM range');
          }
          return new CachedResponse(response, bytes);
        } catch (error) {
          if (attempt === 2) throw error;
          console.log(`Retrying DEM range (${error.cause?.code || error.message})`);
        }
      }
    } finally { release(); }
  }
}
const tiff = await fromCustomClient(new RangeClient(url), { allowFullFile: false, blockSize: 262144 });
const image = await tiff.getImage();
const [ox, oy] = image.getOrigin(), [rx, ry] = image.getResolution();
const keys = image.getGeoKeys();
if (keys.GTModelTypeGeoKey !== 2 || Math.abs(keys.GeogSemiMajorAxisGeoKey - 3396190) > 1 ||
    Math.abs(rx - .003374120830641) > 1e-10 || ry !== -rx) throw Error('Unexpected Mars DEM geometry');
const dir = resolve(root, 'data/external/mars/terrain_windows');
await mkdir(dir, { recursive: true });
for (const site of sites) {
  // Enclose the local square with a circumscribed circle plus a pixel margin.
  const angular = site.window_km * 1000 / Math.SQRT2 / 3396190 * 180 / Math.PI;
  const dl = angular / Math.cos((Math.abs(site.lat) + angular) * Math.PI / 180);
  const c0 = Math.max(0, Math.floor((site.lon - dl - ox) / rx) - 3);
  const c1 = Math.min(image.getWidth(), Math.ceil((site.lon + dl - ox) / rx) + 3);
  const r0 = Math.max(0, Math.floor((site.lat + angular - oy) / ry) - 3);
  const r1 = Math.min(image.getHeight(), Math.ceil((site.lat - angular - oy) / ry) + 3);
  if (c1 <= c0 || r1 <= r0) throw Error(`Invalid window: ${site.id}`);
  const values = await image.readRasters({ window: [c0, r0, c1, r1], samples: [0], interleave: true });
  const raw = Buffer.alloc(values.length * 4), nodata = image.getGDALNoData();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    raw.writeFloatLE(v === nodata || !Number.isFinite(v) ? NaN : v, i * 4);
  }
  const meta = { source: url, lat: site.lat, lon: site.lon, window_km: site.window_km,
    width: c1 - c0, height: r1 - r0, origin: [ox + c0 * rx, oy + r0 * ry],
    resolution: [rx, ry], radius_m: keys.GeogSemiMajorAxisGeoKey,
    sha256: createHash('sha256').update(raw).digest('hex'),
    retrieved_at: new Date().toISOString(), unit: 'm', dtype: '<f4' };
  await writeFile(resolve(dir, `${site.id}.f32.tmp`), raw);
  await rename(resolve(dir, `${site.id}.f32.tmp`), resolve(dir, `${site.id}.f32`));
  await writeFile(resolve(dir, `${site.id}.json`), JSON.stringify(meta));
  console.log(`${site.id}: ${meta.width}x${meta.height} native pixels (${(raw.length / 1024 ** 2).toFixed(2)} MiB)`);
}
