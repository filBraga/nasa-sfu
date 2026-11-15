/** Cache only the Copernicus GLO-30 pixels needed by newly connected Earth sites. */
import { fromCustomClient, BaseClient, BaseResponse } from '../moon-data/node_modules/geotiff/dist-module/geotiff.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(root, 'config/sites.json'), 'utf8'));
const wanted = process.argv.slice(2);
const sites = config.sites.filter(s => s.body === 'earth' && s.tags?.includes('map_connected') && (!wanted.length || wanted.includes(s.id)));
const dir = resolve(root, 'data/external/earth/terrain_windows');
await mkdir(dir, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

class Response extends BaseResponse {
  constructor(response, data) { super(); this.response = response; this.data = data; }
  get status() { return this.response.status; }
  getHeader(name) { return this.response.headers.get(name); }
  async getData() { return this.data; }
}
class Client extends BaseClient {
  constructor(url) { super(url); this.tail = Promise.resolve(); }
  async request({ headers }) {
    const previous = this.tail;
    let release; this.tail = new Promise(done => { release = done; });
    await previous;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(this.url, { headers, signal: AbortSignal.timeout(45000) });
          if (response.status !== 206) { await response.body?.cancel(); throw Error(`Range HTTP ${response.status}`); }
          const bytes = await response.arrayBuffer();
          const actual = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          const requested = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
          if (!actual || !requested || +actual[1] !== +requested[1] || +actual[2] !== Math.min(+requested[2], +actual[3] - 1)
              || bytes.byteLength !== +actual[2] - +actual[1] + 1) throw Error('Invalid Copernicus byte range');
          return new Response(response, bytes);
        } catch (error) { if (attempt === 2) throw error; }
      }
    } finally { release(); }
  }
}
function tileName(lat, lon) {
  return `Copernicus_DSM_COG_10_${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_00_${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
}
const images = new Map();
const failed = [];
for (const site of sites) {
  try {
    const metaFile = resolve(dir, `${site.id}.json`);
    try {
      const old = JSON.parse(await readFile(metaFile, 'utf8'));
      if (['lat', 'lon', 'window_km'].every(k => old[k] === site[k])) {
        for (const tile of old.tiles) {
          const data = await readFile(resolve(dir, tile.file));
          if (hash(data) !== tile.sha256) throw Error('Cached window hash mismatch');
        }
        console.log(`[skip] ${site.id} (cached source windows)`);
        continue;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const angular = site.window_km * 1000 / Math.SQRT2 / 6371000 * 180 / Math.PI;
    const dl = angular / Math.cos((Math.abs(site.lat) + angular) * Math.PI / 180);
    const w = site.lon - dl, e = site.lon + dl, s = site.lat - angular, n = site.lat + angular;
    const tiles = [];
    for (let lat = Math.floor(s); lat <= Math.floor(n); lat++) {
      for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) {
        const name = tileName(lat, lon), url = `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
        if (!images.has(url)) {
          const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(45000) });
          if (head.status === 404) { images.set(url, null); continue; }
          if (!head.ok) throw Error(`Copernicus HTTP ${head.status}`);
          const tiff = await fromCustomClient(new Client(url), { allowFullFile: false, blockSize: 65536 });
          images.set(url, await tiff.getImage());
        }
        const image = images.get(url);
        if (!image) continue;
        const [ox, oy] = image.getOrigin(), [rx, ry] = image.getResolution();
        const keys = image.getGeoKeys();
        if (keys.GTModelTypeGeoKey !== 2 || keys.GeographicTypeGeoKey !== 4326 || rx <= 0 || ry >= 0) throw Error('Unexpected Copernicus CRS or orientation');
        const c0 = Math.max(0, Math.floor((w - ox) / rx) - 2), c1 = Math.min(image.getWidth(), Math.ceil((e - ox) / rx) + 2);
        const r0 = Math.max(0, Math.floor((n - oy) / ry) - 2), r1 = Math.min(image.getHeight(), Math.ceil((s - oy) / ry) + 2);
        if (c1 <= c0 || r1 <= r0) continue;
        const values = await image.readRasters({ window: [c0, r0, c1, r1], samples: [0], interleave: true });
        const bytes = Buffer.alloc(values.length * 4), nodata = image.getGDALNoData();
        for (let i = 0; i < values.length; i++) bytes.writeFloatLE(values[i] === nodata || !Number.isFinite(values[i]) ? NaN : values[i], i * 4);
        const file = `${site.id}_${tiles.length}.f32`;
        await writeFile(resolve(dir, file), bytes);
        tiles.push({ file, source: url, width: c1 - c0, height: r1 - r0,
          origin: [ox + c0 * rx, oy + r0 * ry], resolution: [rx, ry], sha256: hash(bytes) });
      }
    }
    if (!tiles.length) throw Error('No DEM data at this coordinate');
    await writeFile(metaFile, JSON.stringify({ lat: site.lat, lon: site.lon, window_km: site.window_km,
      unit: 'm', crs: 'EPSG:4326', retrieved_at: new Date().toISOString(), tiles }));
    console.log(`[ok] ${site.id}: ${tiles.length} native DEM window(s)`);
  } catch (error) { console.error(`[failed] ${site.id}: ${error.message}`); failed.push(site.id); }
}
if (failed.length) process.exitCode = 1;
