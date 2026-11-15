const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const pretty = value => typeof value === 'object' ? JSON.stringify(value) : String(value);
const cache = new Map();
let indexPromise;
async function load(path) {
  const response = await fetch(`data/evidence/${path}`);
  if (!response.ok) throw Error(`Evidence unavailable (${response.status})`);
  return response.json();
}

export function renderEvidence(host, target) {
  host.querySelector('.evidence-card')?.remove();
  const card = document.createElement('details');
  card.className = 'evidence-card';
  card.innerHTML = '<summary>Moon &amp; Mars evidence library</summary><div class="evidence-body"><p class="hint">Open to load saved measurements and source notes.</p></div>';
  host.append(card);
  card.addEventListener('toggle', async () => {
    if (!card.open || card.dataset.loaded) return;
    card.dataset.loaded = 'true';
    const body = card.querySelector('.evidence-body');
    try {
      indexPromise ||= load('index.json').catch(error => { indexPromise = null; throw error; });
      const index = await indexPromise;
      if (!card.isConnected) return;
      const links = index.targets[target.id] || [];
      body.innerHTML = `<p class="hint">Saved source evidence; these records do not contribute to the comparison score.</p>
        <label>Explore a location <select aria-label="Evidence location">${index.records.map(r =>
          `<option value="${escapeHtml(r.id)}">${r.body === 'moon' ? 'Moon' : 'Mars'}: ${escapeHtml(r.name)}</option>`).join('')}</select></label>
        <div class="evidence-record" aria-live="polite"></div>`;
      const select = body.querySelector('select');
      if (links.length) select.value = links.find(l => l.exact_location)?.id || links[0].id;
      else select.value = index.records.find(r => r.body === target.body)?.id || index.records[0].id;
      let request = 0;
      async function show() {
        const token = ++request;
        const output = body.querySelector('.evidence-record');
        output.innerHTML = '<p class="hint">Loading evidence…</p>';
        try {
          const summary = index.records.find(r => r.id === select.value);
          if (!cache.has(summary.id)) cache.set(summary.id, load(summary.file).catch(error => { cache.delete(summary.id); throw error; }));
          const record = await cache.get(summary.id);
          if (token !== request || !card.isConnected) return;
          const link = links.find(l => l.id === record.id);
          const location = link?.exact_location ? 'Matches the selected target coordinates.'
            : link ? 'Same named region; coordinates differ from the comparison target.'
              : 'Browsing a separate location; this is not the selected comparison target.';
          output.innerHTML = `<p>${escapeHtml(record.scope)} · ${record.lat.toFixed(4)}°, ${record.lon.toFixed(4)}° E</p>
            <p class="hint">${escapeHtml(location)}</p>
            <details><summary>Location and source notes</summary><p class="hint">${escapeHtml(record.coordinate_note)}</p></details>
            ${record.facts.map(f => {
              let url; try { url = new URL(f.source); } catch { /* missing source */ }
              const source = url && ['https:', 'http:'].includes(url.protocol)
                ? `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Source</a>` : 'Source unavailable';
              const notes = [f.note, f.method, f.spatial_note,
                f.pixel_spacing_m && `Grid spacing (m): ${pretty(f.pixel_spacing_m)}`,
                f.pixel_spacing_deg && `Grid spacing (degrees): ${pretty(f.pixel_spacing_deg)}`,
                f.window_m && `Window (m): ${pretty(f.window_m)}`,
                f.observation_period && `Observation period: ${pretty(f.observation_period)}`,
                f.verified && `Review: ${pretty(f.verified)}`].filter(Boolean);
              return `<details class="evidence-fact"><summary>${escapeHtml(f.key.replaceAll('_', ' '))}: <b>${f.value == null ? 'No measurement' : escapeHtml(pretty(f.value))} ${escapeHtml(f.unit)}</b></summary>
                <p class="hint">${escapeHtml(f.category)} · ${escapeHtml(f.status || 'Status unspecified')} · ${source}</p>
                ${notes.map(n => `<p class="hint">${escapeHtml(n)}</p>`).join('')}</details>`;
            }).join('')}`;
        } catch { if (token === request) output.innerHTML = '<p>Could not load this record. Choose another location to retry.</p>'; }
      }
      select.addEventListener('change', show);
      await show();
    } catch {
      body.innerHTML = '<p>Evidence could not be loaded. Close and reopen to retry.</p>';
      delete card.dataset.loaded;
    }
  });
}
