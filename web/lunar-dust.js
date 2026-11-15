const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
let dustPromise;
async function dustData() {
  dustPromise ||= fetch('data/lunar_dust.json').then(response => {
    if (!response.ok) throw Error('Lunar dust data unavailable');
    return response.json();
  }).catch(error => { dustPromise = null; throw error; });
  return dustPromise;
}
export function profileRows(ldex, timeIndex) {
  return ldex.profiles.map(p => ({ altitude: p.altitude_km,
    density: p.measurements[timeIndex][0], error: p.measurements[timeIndex][1] }));
}
export function renderLunarDust(host, target, { enabled = true } = {}) {
  host.querySelector('.lunar-dust-card')?.remove();
  if (target.body !== 'moon' || !enabled) return;
  const card = document.createElement('section');
  card.className = 'lunar-dust-card';
  card.innerHTML = `<h2>Lunar dust &amp; regolith</h2>
    <p class="hint">Surface dust is present. Site-specific dust coverage is unavailable in these datasets.</p>
    <details><summary>Explore Scout v3 dust measurements</summary><div class="lunar-dust-body"></div></details>`;
  host.append(card);
  const details = card.querySelector('details');
  details.addEventListener('toggle', async () => {
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded = 'true';
    const body = card.querySelector('.lunar-dust-body');
    body.innerHTML = '<p class="hint">Loading saved dust measurements…</p>';
    try {
      const data = await dustData();
      if (!card.isConnected) return;
      const site = data.sites[target.id], rock = site?.rock_abundance;
      const ldex = data.ldex;
      body.innerHTML = `<h3>Surface evidence at ${esc(target.name)}</h3>
        <p>Surface dust coverage: <b>not measured</b>.</p>
        <p>${rock?.value != null ? `Diviner modeled rock cover: <b>${(rock.value * 100).toFixed(2)}%</b>.` : esc(site?.rock_status || 'Rock cover unavailable at this location.')}</p>
        <p class="hint">Rock cover measures exposed rocks. Its complement is not a measured dust percentage.</p>
        <h3>LADEE LDEX: orbital dust</h3>
        <p class="hint">${esc(ldex.scope)}. Grain radii greater than ${ldex.grain_radius_min_micrometers} micrometres. ${esc(ldex.period[0].slice(0, 10))} to ${esc(ldex.period[1].slice(0, 10))}.</p>
        <p class="hint">${esc(ldex.limitation)} These profiles do not change location rankings.</p>
        <label>Local solar time <select aria-label="LDEX local solar time">${ldex.local_times.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join('')}</select></label>
        <div class="dust-table" tabindex="0" aria-label="Orbital dust density by altitude"></div>
        <p class="hint"><a href="https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/LADEE/ldex.html" target="_blank" rel="noopener noreferrer">LDEX archive and interpretation</a> · <a href="https://science.nasa.gov/moon/composition/" target="_blank" rel="noopener noreferrer">NASA: lunar regolith</a></p>
        <h3>Apollo 17 LEAM</h3><p class="hint">${esc(data.leam.status)}. ${esc(data.leam.limitation)}</p>`;
      const select = body.querySelector('select');
      select.value = String(ldex.local_times.indexOf('06:00'));
      const number = value => value == null ? 'No data' : value.toExponential(2);
      function show() {
        body.querySelector('.dust-table').innerHTML = `<table><thead><tr><th>Altitude (km)</th><th>Density (m⁻³)</th><th>Reported error (m⁻³)</th></tr></thead><tbody>${profileRows(ldex, Number(select.value)).map(row =>
          `<tr><td>${row.altitude}</td><td>${number(row.density)}</td><td>${number(row.error)}</td></tr>`).join('')}</tbody></table>`;
      }
      select.addEventListener('change', show);
      show();
    } catch {
      body.innerHTML = '<p>Could not load dust data. Close and reopen to retry.</p>';
      delete details.dataset.loaded;
    }
  });
}
