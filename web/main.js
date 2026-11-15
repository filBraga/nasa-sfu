import * as THREE from "three";
import { renderEvidence } from "./evidence.js";
import { renderLunarDust } from "./lunar-dust.js";
import { OPERATION_PRESETS, findPreset, presetDimensions } from "./presets.js";
import { aggregateSimilarity, compareEvidenceScores, scoreText, scoreDescription } from "./similarity.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// ------------------------------------------------------------------ constants
const BODY = {
  earth: { name: "Earth", radiusKm: 6371, color: 0x3a6ea5, tex: "textures/earth.jpg", x: 0 },
  moon:  { name: "Moon",  radiusKm: 1737, color: 0x9a9a9a, tex: "textures/moon.jpg",  x: -3.9 },
  mars:  { name: "Mars",  radiusKm: 3390, color: 0xb5562f, tex: "textures/mars.jpg",  x: 4.1 },
};
const EARTH_R = 2; // scene units for Earth's radius; other bodies to true relative scale
const CSS = getComputedStyle(document.documentElement);
const cssColor = (v) => CSS.getPropertyValue(v).trim();
const COLOR = {
  earth: cssColor("--earth"), mars: cssColor("--mars"), moon: cssColor("--moon"), team: cssColor("--team"),
  strong: cssColor("--strong"), partial: cssColor("--partial"), weak: cssColor("--weak"),
};
const ROLE_LABEL = { analog: "candidate", control: "control", target: "target" }; // calibration pairs get their own chip
const isTeam = (s) => (s.tags || []).includes("team"); // places imported from the team's places_new.json
const roleLabel = (s) => (isTeam(s) ? "#team" : ROLE_LABEL[s.role]);

// ------------------------------------------------------------------ state
const state = { data: null, view: "globes", focus: "all", link: null, earthId: null, targetId: null, exag: 3, indep: false };
const TOP_N = 3;
const heightCache = new Map();

// ------------------------------------------------------------------ renderer + two scenes
const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);

function makeLabelRenderer(id) {
  const r = new CSS2DRenderer({ element: document.getElementById(id) });
  return r;
}
const labelsGlobes = makeLabelRenderer("labels-globes");
const labelsCompare = makeLabelRenderer("labels-compare");

const globes = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 1, 0.01, 500) };
globes.camera.position.set(0, 2.5, 13);
globes.controls = new OrbitControls(globes.camera, renderer.domElement);
globes.controls.enableDamping = true;
globes.controls.minDistance = 3;
globes.controls.maxDistance = 40;

const cmp = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(45, 1, 0.1, 5000) };
cmp.controls = new OrbitControls(cmp.camera, renderer.domElement);
cmp.controls.enableDamping = true;
cmp.controls.enabled = false;
cmp.root = new THREE.Group();
cmp.scene.add(cmp.root);

for (const s of [globes.scene, cmp.scene]) {
  s.background = new THREE.Color(0x05070d);
  s.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-6, 5, 8);
  s.add(sun);
}
addStars(globes.scene);

function addStars(scene) {
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(120 + Math.random() * 80);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899bb, size: 0.35, sizeAttenuation: true })));
}

function label(text, cls) {
  const el = document.createElement("div");
  el.className = "label " + (cls || "");
  el.textContent = text;
  return new CSS2DObject(el);
}

// ------------------------------------------------------------------ globes view
const planets = {};
const markers = [];
const pairLines = [];

function latLonToVec(latDeg, lonDeg, r) {
  // matches THREE.SphereGeometry UVs for an equirectangular map spanning -180..180
  const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

function faceCamera(mesh, lonDeg, latDeg) {
  // Euler XYZ applies the Y turn first (brings lon to +z), then the X tilt (brings lat to the equator)
  mesh.rotation.set(THREE.MathUtils.degToRad(latDeg), THREE.MathUtils.degToRad(-90 - lonDeg), 0);
}

function buildGlobes() {
  const loader = new THREE.TextureLoader();
  for (const [key, b] of Object.entries(BODY)) {
    const r = EARTH_R * b.radiusKm / BODY.earth.radiusKm;
    const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.95, metalness: 0 });
    loader.load(b.tex, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
    }, undefined, () => console.warn(`texture ${b.tex} missing - run scripts/fetch_textures.py`));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), mat);
    const group = new THREE.Group();
    group.position.x = b.x;
    group.add(mesh);
    const name = label(b.name, "planet");
    name.position.set(0, r + 0.35, 0);
    group.add(name);
    globes.scene.add(group);
    planets[key] = { group, mesh, r };
  }
  // turn each globe so its sites of interest face the camera
  faceCamera(planets.earth.mesh, -98, 58);  // Canada, Labrador to the Beaufort Sea
  faceCamera(planets.mars.mesh, 137, 30);   // between Jezero (78E) and Arcadia (196E)
  faceCamera(planets.moon.mesh, 15, -75);   // south pole, near side (Malapert, Mons Mouton)

  for (const site of Object.values(state.data.sites)) {
    const p = planets[site.body];
    const color = site.role === "control" ? 0x8f9bb6 : isTeam(site) ? COLOR.team : site.body === "earth" ? COLOR.earth : COLOR[site.body];
    const size = p.r * (site.role === "target" ? 0.022 : 0.018); // scale with the planet so markers stay subtle up close
    const waiting = site.has_target === false; // e.g. dunes: no Mars dune target yet
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: waiting, opacity: waiting ? 0.35 : 1 }));
    m.position.copy(latLonToVec(site.lat, site.lon, p.r * 1.005));
    m.userData.siteId = site.id;
    m.userData.baseOpacity = waiting ? 0.35 : 1;
    const l = label((isTeam(site) ? "#team " : "") + site.name + (waiting ? " (no target yet)" : ""),
      "site " + site.role + (waiting ? " waiting" : "") + (isTeam(site) ? " team" : ""));
    m.userData.team = isTeam(site);
    l.position.set(0, size * 2.2, 0);
    m.add(l);
    p.mesh.add(m);
    markers.push(m);
  }
  addReferenceMarkers();
  buildPairLines();
}

// sites + landers from moon-data/ and mars-data/ (copied into web/data/). Sites that already exist as
// comparison targets (same id, or id + "_crater") are skipped: those markers carry the comparison/links.
function addReferenceMarkers() {
  const have = new Set(Object.keys(state.data.sites));
  const add = (body, item, kind, text) => {
    const p = planets[body];
    const size = p.r * (kind === "site" ? 0.018 : 0.009);
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8),
      new THREE.MeshBasicMaterial({ color: kind === "site" ? COLOR.team : 0xffffff, transparent: kind !== "site", opacity: kind === "site" ? 1 : 0.7 }));
    m.position.copy(latLonToVec(item.lat, item.lon_e, p.r * 1.005));
    m.userData.baseOpacity = m.material.opacity;
    m.userData.ref = { name: item.name, text };
    if (kind === "site") {
      const l = label(item.name, "site analog");
      l.position.set(0, size * 2.2, 0);
      m.add(l);
    }
    p.mesh.add(m);
    markers.push(m);
  };
  const ok = (x) => typeof x.lat === "number" && typeof x.lon_e === "number";
  for (const c of state.ref.mars.caves?.caves || [])
    if (ok(c)) add("mars", { ...c, name: c.id }, "lander", `Cave candidate ${c.id} (${c.type}): ${c.comment || ""}`);
  for (const f of state.ref.mars.features?.features || []) // 2055 named features: only the big ones
    if (ok(f) && f.diam_km >= 150) add("mars", f, "lander", `${f.name} (${f.type}), ${Math.round(f.diam_km)} km`);
  for (const [body, ref] of Object.entries(state.ref)) {
    for (const s of ref.data?.sites || []) {
      if (have.has(s.id) || have.has(s.id.replace(/_crater$/, ""))) continue;
      add(body, s, "site", `${s.name}: ${s.facts.length} sourced facts (see ${body}-data). Reference site, no terrain comparison yet.`);
    }
    for (const l of ref.landers?.landers || []) {
      if (typeof l.lat !== "number" || typeof l.lon_e !== "number") continue;
      // A selectable comparison marker takes precedence at the same Moon location.
      if (body === "moon" && Object.values(state.data.sites).some(s => s.body === body
        && Math.abs(s.lat - l.lat) < .02 && Math.abs(((s.lon - l.lon_e + 540) % 360) - 180) < .02)) continue;
      add(body, l, "lander", `${l.name}${l.date ? " (" + l.date + ")" : ""}: ${l.outcome || l.type || ""}`);
    }
  }
}

function buildPairLines() {
  for (const l of pairLines) { globes.scene.remove(l.line); l.line.geometry.dispose(); l.line.remove(l.tag); }
  pairLines.length = 0;
  // only the pair the user picked in the "Top matches" card gets a line
  const shown = state.link
    ? state.data.comparisons.filter((c) => c.earth === state.link.earth && c.target === state.link.target)
    : [];
  for (const m of markers) {
    const linked = state.link && (m.userData.siteId === state.link.earth || m.userData.siteId === state.link.target);
    m.scale.setScalar(linked ? 1.8 : 1);
    // while a line is shown, only the two linked sites keep their name and full-strength marker
    const dim = !!state.link && !linked;
    m.material.opacity = dim ? 0.25 : m.userData.baseOpacity;
    const transparent = dim || m.userData.baseOpacity < 1;
    if (m.material.transparent !== transparent) { m.material.transparent = transparent; m.material.needsUpdate = true; }
    // #team places are many and spread worldwide: their names only show when linked
    for (const c of m.children) if (c.isCSS2DObject) c.visible = !dim && (!m.userData.team || linked);
  }
  for (const c of shown) {
    const sc = scoreOf(c), color = COLOR[sc.verdict];
    const line = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.07, transparent: true, opacity: 0.9 }));
    const tag = label(scoreText(sc), "score");
    tag.element.title = scoreDescription(sc);
    tag.element.style.color = color;
    line.add(tag);
    globes.scene.add(line);
    pairLines.push({ line, tag, c });
  }
}

function markerFor(id) { return markers.find((m) => m.userData.siteId === id); }

function linkCurve(earthId, targetId) {
  const a = markerFor(earthId).getWorldPosition(new THREE.Vector3());
  const b = markerFor(targetId).getWorldPosition(new THREE.Vector3());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += 1.2 + a.distanceTo(b) * 0.15;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function updatePairLines() {
  for (const { line, tag, c } of pairLines) {
    const curve = linkCurve(c.earth, c.target);
    line.geometry.setFromPoints(curve.getPoints(48));
    line.computeLineDistances();
    tag.position.copy(curve.getPoint(0.5));
  }
}

// ------------------------------------------------------------------ compare view
const TERRAIN_RAMP = {
  earth: [[0, 0x2b3a4a], [0.35, 0x6b7458], [0.7, 0xb39b72], [1, 0xf2efe6]],
  mars:  [[0, 0x2a1c1c], [0.35, 0x7a3d24], [0.7, 0xc0784a], [1, 0xf0d2b0]],
  moon:  [[0, 0x15171c], [0.4, 0x575b63], [0.75, 0xa3a7ae], [1, 0xf3f4f6]],
};

function ramp(body, t) {
  const stops = TERRAIN_RAMP[body];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      return new THREE.Color(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0));
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

async function loadHeights(site) {
  if (heightCache.has(site.id)) return heightCache.get(site.id);
  const res = await fetch("data/" + site.heightmap.file);
  if (!res.ok) throw new Error(`Missing heightmap for ${site.id}`);
  const arr = new Float32Array(await res.arrayBuffer());
  heightCache.set(site.id, arr);
  return arr;
}

function terrainMesh(site, heights, vScale) {
  const hm = site.heightmap, n = hm.size, ext = hm.extent_km;
  const geo = new THREE.PlaneGeometry(ext, ext, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const range = Math.max(hm.zmax - hm.zmin, 1);
  for (let i = 0; i < pos.count; i++) {
    const z = heights[i];
    pos.setY(i, (z - hm.zmin) / 1000 * vScale);
    const c = ramp(site.body === "earth" ? "earth" : site.body, (z - hm.zmin) / range);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
}

function rimRing(site, feats, vScale, zmin) {
  // dashed circle at the rim radius, at the rim's median elevation from the radial profile
  if (!feats.profile_m || !site.diameter_km) return null; // not a crater comparison
  const prof = feats.profile_m, rs = state.data.bins.profile_r;
  let rimZ = -Infinity;
  rs.forEach((r, i) => { if (r >= 0.8 && r <= 1.2 && prof[i] != null) rimZ = Math.max(rimZ, prof[i]); });
  const R = site.diameter_km / 2, pts = [];
  const [dx, dy] = feats.center_offset_km; // refined crater centre (east, north) in km
  for (let i = 0; i <= 128; i++) {
    const a = i / 128 * Math.PI * 2;
    pts.push(new THREE.Vector3(dx + Math.cos(a) * R, (rimZ - zmin) / 1000 * vScale + 0.05, -dy + Math.sin(a) * R));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.7 }));
  line.computeLineDistances();
  return line;
}

let compareToken = 0;
async function buildCompare(refit) {
  const token = ++compareToken;
  const e = state.data.sites[state.earthId], t = state.data.sites[state.targetId];
  const comp = currentComparison();
  const [he, ht] = await Promise.all([loadHeights(e), loadHeights(t)]);
  if (token !== compareToken) return;

  cmp.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  cmp.root.children.slice().forEach((c) => { c.traverse((o) => o.isCSS2DObject && o.element.remove()); cmp.root.remove(c); });
  if (!comp) { // e.g. a dune site while no Mars dune target exists yet
    document.getElementById("stage-hint").textContent = `${e.name} has no target of its type yet, so there is nothing to compare.`;
    return;
  }

  const reliefE = (e.heightmap.zmax - e.heightmap.zmin) / 1000, reliefT = (t.heightmap.zmax - t.heightmap.zmin) / 1000;
  const shared = state.exag;
  let vE = shared, vT = shared;
  if (state.indep) { // make both reliefs as tall as the taller one at the chosen exaggeration
    const tallest = Math.max(reliefE, reliefT) * shared;
    vE = tallest / Math.max(reliefE, 1e-3); vT = tallest / Math.max(reliefT, 1e-3);
  }
  const gap = 8;
  const items = [[e, he, vE, comp.earth_features, -1], [t, ht, vT, comp.target_features, 1]];
  for (const [site, h, v, feats, side] of items) {
    const g = new THREE.Group();
    g.add(terrainMesh(site, h, v));
    const ring = rimRing(site, feats, v, site.heightmap.zmin);
    if (ring) g.add(ring);
    const ext = site.heightmap.extent_km;
    g.position.x = side * (ext / 2 + gap / 2);
    const relief = (site.heightmap.zmax - site.heightmap.zmin) / 1000;
    const size = ring ? `${site.diameter_km} km crater` : `${Math.round(ext)} km area`;
    const tag = label(`${site.name} - ${size}, ${Math.round(relief * 1000)} m relief`, "terrain");
    tag.element.style.borderColor = site.body === "earth" ? COLOR.earth : COLOR[site.body];
    tag.position.set(0, relief * v + 4, -ext / 2);
    g.add(tag);
    cmp.root.add(g);
  }
  if (refit) fitCompareCamera();
  document.getElementById("stage-hint").textContent =
    `Horizontal scale is true (km).${comp.earth_features.profile_m ? " Dashed ring = crater rim diameter." : ""} Vertical ${state.indep ? "scaled per site" : state.exag + "x exaggerated"}.`;
}

function fitCompareCamera() {
  const box = new THREE.Box3().setFromObject(cmp.root);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(cmp.camera.fov / 2));
  // factor > 1 because the tilted view makes near edges look wider
  const dist = 1.5 * Math.max(size.x / 2 / (tanHalf * cmp.camera.aspect), size.z / 2 / tanHalf);
  const dir = new THREE.Vector3(0, 0.62, 0.78).normalize();
  cmp.controls.target.copy(center);
  cmp.camera.position.copy(center).addScaledVector(dir, dist);
  cmp.camera.far = dist * 20;
  cmp.camera.updateProjectionMatrix();
}

function globesCameraGoal(body) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(globes.camera.fov / 2));
  if (body === "link" && state.link) { // zoom onto the connection line, centred on its middle
    const pts = linkCurve(state.link.earth, state.link.target).getPoints(32);
    const sphere = new THREE.Sphere().setFromPoints(pts);
    const fit = Math.min(tanHalf, tanHalf * globes.camera.aspect); // tighter of vertical / horizontal fov
    const dist = Math.max(3, (sphere.radius * 1.25) / fit + sphere.radius * 0.3);
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    return { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center, minDist: 1.5, dur: 1400 };
  }
  if (body === "link") body = "all"; // link was cleared
  if (body === "all") { // the three globes span roughly 11 scene units side to side
    const dist = Math.max(13, 6.2 / (tanHalf * globes.camera.aspect));
    return { pos: new THREE.Vector3(0, dist * 0.19, dist), target: new THREE.Vector3(), minDist: 3 };
  }
  const p = planets[body];
  const center = p.group.getWorldPosition(new THREE.Vector3());
  // fit the globe (plus label room) in both the vertical and horizontal field of view
  const dist = 1.6 * p.r / Math.min(tanHalf, tanHalf * globes.camera.aspect) + p.r;
  return { pos: center.clone().add(new THREE.Vector3(0, dist * 0.12, dist)), target: center, minDist: p.r * 1.25 };
}

let flight = null;
function fitGlobesCamera(animate = false) {
  const goal = globesCameraGoal(state.focus);
  globes.controls.minDistance = goal.minDist;
  if (!animate) {
    globes.camera.position.copy(goal.pos);
    globes.controls.target.copy(goal.target);
    flight = null;
    return;
  }
  flight = { t0: performance.now(), dur: goal.dur || 900,
    fromPos: globes.camera.position.clone(), fromTarget: globes.controls.target.clone(), ...goal };
}

function updateFlight(now) {
  if (!flight) return;
  const k = Math.min(1, (now - flight.t0) / flight.dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out
  globes.camera.position.lerpVectors(flight.fromPos, flight.pos, e);
  globes.controls.target.lerpVectors(flight.fromTarget, flight.target, e);
  if (k === 1) flight = null;
}

function focusBody(body, animate = true) {
  state.focus = body;
  document.querySelectorAll("#body-switch button").forEach((b) => b.classList.toggle("active", b.dataset.body === body));
  fitGlobesCamera(animate);
  if (state.view === "globes") $("stage-hint").textContent = globesHint();
}

function renderTopMatches() {
  const targets = Object.values(state.data.sites).filter((s) => s.role === "target");
  let html = `<div class="tm-head"><span>Click to draw a comparison. * = partial similarity; evidence is incomplete.</span>
    <button class="tm-clear" ${state.link ? "" : "disabled"}>Clear</button></div>`;
  for (const t of targets) {
    const top = state.data.comparisons
      .filter((c) => c.target === t.id && state.data.sites[c.earth].role !== "control")
      .map((c) => ({ c, s: scoreOf(c) }))
      .sort((a, b) => compareEvidenceScores(a.s, b.s))
      .slice(0, TOP_N);
    html += `<section class="card tm-group"><div class="tm-target" style="color:${COLOR[t.body]}">${esc(t.name)}
      <span class="body">${BODY[t.body].name} <span class="type-tag">${esc(typeShort(t.type))}</span></span></div>`;
    for (const { c, s } of top) {
      const active = state.link && state.link.earth === c.earth && state.link.target === c.target;
      html += `<button class="tm-row ${active ? "active" : ""}" data-earth="${c.earth}" data-target="${c.target}">
        <span class="dot" style="background:${COLOR[s.verdict]}"></span>
        <span class="name">${esc(state.data.sites[c.earth].name)}${isTeam(state.data.sites[c.earth]) ? ` <span class="type-tag team">#team</span>` : ""}</span>
        <span class="val" title="${scoreDescription(s)}" style="color:${s.overall == null ? COLOR.partial : COLOR[s.verdict]}">${scoreText(s)}<small class="hint"> ${Math.round(s.coverage * 100)}%</small></span></button>`;
    }
    if (!top.length) html += `<p class="tm-empty">No Canadian candidates of this type yet.</p>`;
    html += `</section>`;
  }
  const el = $("top-matches");
  el.innerHTML = html;
  el.querySelector(".tm-clear").onclick = () => setLink(null);
  el.querySelectorAll(".tm-row").forEach((b) => {
    b.onclick = () => {
      const same = state.link && state.link.earth === b.dataset.earth && state.link.target === b.dataset.target;
      setLink(same ? null : { earth: b.dataset.earth, target: b.dataset.target });
    };
  });
}

function setLink(link) {
  state.link = link;
  if (link) {
    select(link.earth, link.target); // also rebuilds lines and the top-matches card
    focusBody("link"); // fly in to frame the connection between the two planets
  } else {
    buildPairLines();
    renderTopMatches();
    if (state.focus === "link") focusBody("all");
  }
}

function globesHint() {
  if (state.focus === "link" && state.link) {
    const e = state.data.sites[state.link.earth], t = state.data.sites[state.link.target];
    return `${e.name} ↔ ${t.name} (${BODY[t.body].name}). Drag to orbit, or press All / Clear to zoom back out.`;
  }
  if (state.focus === "all" || state.focus === "link") return "Pick a site in Top matches to draw its connection. Click a marker to compare.";
  const sites = Object.values(state.data.sites).filter((s) => s.body === state.focus);
  return `${BODY[state.focus].name}: ${sites.map((s) => `${s.name} (${roleLabel(s)})`).join(", ")}. Click a marker to compare.`;
}

// ------------------------------------------------------------------ panel
const $ = (id) => document.getElementById(id);

function currentComparison() {
  return state.data.comparisons.find((c) => c.earth === state.earthId && c.target === state.targetId);
}

const typeLabel = (id) => (state.data.site_types?.[id]?.label) || id;
const typeShort = (id) => (state.data.site_types?.[id]?.short) || id;

function fillSelects() {
  const sites = Object.values(state.data.sites);
  const earthOpt = (s) => `<option value="${s.id}">${esc(s.name)}${s.role === "control" ? " (control)" : s.has_target === false ? " (no target yet)" : ""}</option>`;
  $("sel-earth").innerHTML =
    `<optgroup label="Candidates">${sites.filter((s) => s.body === "earth" && s.role !== "control" && !isTeam(s)).map(earthOpt).join("")}</optgroup>` +
    `<optgroup label="#team places">${sites.filter((s) => s.body === "earth" && isTeam(s)).map(earthOpt).join("")}</optgroup>` +
    `<optgroup label="Controls">${sites.filter((s) => s.role === "control").map(earthOpt).join("")}</optgroup>`;
  const targets = sites.filter((s) => s.role === "target");
  $("sel-target").innerHTML = ["moon", "mars"].map(body =>
    `<optgroup label="${BODY[body].name} comparison locations">${targets.filter(t => t.body === body)
      .map(s => `<option value="${s.id}">${esc(s.name)}${s.tags?.includes("planetary_import") ? " · regional" : ""}</option>`).join("")}</optgroup>`).join("");
  $("sel-earth").value = state.earthId;
  $("sel-target").value = state.targetId;
}

/** Best comparison for a site, so picking a site never lands on a pair that doesn't exist. */
function bestComparison(filter) {
  return state.data.comparisons.filter(filter)
    .map((c) => ({ c, s: scoreOf(c), ctl: state.data.sites[c.earth].role === "control" }))
    .sort((a, b) => (a.ctl - b.ctl) || compareEvidenceScores(a.s, b.s))[0]?.c;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ------------------------------------------------------------------ dimensions (terrain metrics + data layers)
const DIM_KEY = "analog-explorer-dims-v2"; // v2: four equal categories (slope, temperature, dust, plants)
const PRESET_KEY = "analog-explorer-operation-v1";

function initPreset() {
  let saved;
  try { saved = localStorage.getItem(PRESET_KEY); } catch { /* storage unavailable */ }
  const params = new URLSearchParams(location.search);
  const id = params.get("preset") ?? (params.has("dims") ? null : saved);
  state.preset = findPreset(id)?.id || null;
  if (state.preset) state.dims = presetDimensions(state.preset, state.data.dimensions);
}

function renderPreset() {
  const preset = findPreset(state.preset);
  $("operation-preset").innerHTML = `<label for="sel-operation">Operation preset</label>
    <select id="sel-operation"><option value="">Custom / default dimensions</option>${OPERATION_PRESETS.map(p => `<option value="${p.id}" ${p.id === state.preset ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
    <p class="hint">${preset ? esc(preset.considers) : "Choose an operation to select relevant scoring layers automatically, or edit dimensions in Filters."}</p>
    ${preset ? `<p class="hint">Operation-focused physical similarity, not operational safety or mission approval. Existing weights and tolerances are provisional. Missing selected data reduces coverage; source filters and target-type exclusions still apply. Moon dust remains context only.</p>
    <details><summary>Requirements outside this score &amp; research</summary><p>${esc(preset.unmeasured)}</p><p class="hint">Coverage describes selected measurements only, not all operation requirements. Similar thermal conditions do not establish equipment survival.</p>${preset.sources.map(s => `<p><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></p>`).join("")}</details>` : ""}`;
  $("sel-operation").addEventListener("change", event => {
    state.preset = event.target.value || null;
    state.dims = state.preset ? presetDimensions(state.preset, state.data.dimensions)
      : new Set(Object.keys(state.data.dimensions).filter(k => state.data.dimensions[k].default_on));
    dimsChanged(true);
  });
}
const verdictOf = (v) => (v >= 0.7 ? "strong" : v >= 0.4 ? "partial" : "weak");
const fmt = (v) => (v == null ? "-" : v.toFixed(2));

function initDims() {
  const dims = state.data.dimensions;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DIM_KEY)); } catch { /* storage unavailable */ }
  const fromUrl = new URLSearchParams(location.search).get("dims"); // e.g. ?dims=slope,profile,demo_tpi
  if (fromUrl) saved = fromUrl.split(",");
  const valid = Array.isArray(saved) ? saved.filter((k) => dims[k]) : [];
  state.dims = new Set(valid.length ? valid : Object.keys(dims).filter((k) => dims[k].default_on));
}

function saveDims() {
  try { localStorage.setItem(DIM_KEY, JSON.stringify([...state.dims])); } catch { /* ignore */ }
}

/** Category geometric mean with explicit evidence coverage; identical to the export policy. */
function scoreOf(c) {
  const dims = state.data.dimensions;
  const na = new Set(c.not_applicable || []); // terrain metrics this target's type doesn't use
  const body = state.data.sites[c.target].body;
  const filterOnly = [...state.dims].filter(k => (dims[k].score_excluded_bodies || []).includes(body));
  const scored = [...state.dims].filter((k) => c.scores[k] != null && !filterOnly.includes(k));
  const used = scored.filter((k) => blockedBy(k, c).length === 0);
  const filtered = scored.filter((k) => blockedBy(k, c).length > 0);
  const missing = [...state.dims].filter((k) => c.scores[k] == null && !na.has(k) && !filterOnly.includes(k));
  // Deliberately switched-off sources/dimensions leave the expected evidence set.
  const expected = [...state.dims].filter(k => blockedBy(k, c).length === 0);
  const result = aggregateSimilarity(c.scores, dims, expected, {
    body, notApplicable: c.not_applicable || [], config: state.data.scoring,
    dimensionWeights: state.data.site_types[c.target_type]?.dimension_weights || {},
  });
  const overall = result.score;
  return { overall, observed_score: result.observed_score, coverage: result.coverage, groups: result.groups,
    verdict: overall == null ? "weak" : verdictOf(overall), used, missing, filtered, filterOnly };
}

// ------------------------------------------------------------------ source filter ("only data from X")
const SRC_KEY = "analog-explorer-sources-off";
const scoreDatasets = () => (state.data.data_sources?.datasets || []).filter((d) => d.category === "elevation" || d.category === "layer");
const datasetBodies = (d) => d.dem_for || d.bodies || (d.body ? [d.body] : []);

function initSources() {
  const known = new Set(scoreDatasets().map((d) => d.id));
  let off = null;
  try { off = JSON.parse(localStorage.getItem(SRC_KEY)); } catch { /* storage unavailable */ }
  const fromUrl = new URLSearchParams(location.search).get("off"); // e.g. ?off=copernicus_dem
  if (fromUrl != null) off = fromUrl.split(",").filter(Boolean);
  state.srcOff = new Set((Array.isArray(off) ? off : []).filter((id) => known.has(id))); // store what's OFF, so new datasets start on
}

/** Dataset ids a dimension relies on for one comparison (Earth side + target side). */
function dimSourceIds(k, c) {
  const d = state.data.dimensions[k];
  const e = state.data.sites[c.earth], t = state.data.sites[c.target];
  if (d.group === "terrain") return [e.dem_source, t.dem_source].filter(Boolean);
  const ids = d.source_ids || {};
  return [ids[e.body], ids[t.body]].filter(Boolean);
}
const blockedBy = (k, c) => (state.srcOff?.size ? dimSourceIds(k, c).filter((id) => state.srcOff.has(id)) : []);
const datasetName = (id) => datasetById(id)?.name || id;

function renderSourceFilter() {
  const ds = scoreDatasets();
  const agencies = [...new Set(ds.map((d) => d.agency || "Other"))];
  const dims = state.data.dimensions;
  const neededBy = (id) => Object.keys(dims).filter((k) =>
    dims[k].group === "terrain" ? ds.find((x) => x.id === id)?.category === "elevation" : Object.values(dims[k].source_ids || {}).includes(id));
  const offCount = state.srcOff.size;
  if (state.srcOpen === undefined) state.srcOpen = true; // it has its own Filters tab now, so start open
  const summary = offCount ? `${offCount} source${offCount === 1 ? "" : "s"} filtered out` : `all ${ds.length} sources`;
  let html = `<details id="src-details" ${state.srcOpen ? "open" : ""}><summary>
    <h2>Data sources <span class="hint">score only with data from the sources you tick</span></h2>
    <span class="src-summary ${offCount ? "active" : ""}">${summary}</span></summary>`;
  for (const ag of agencies) {
    const items = ds.filter((d) => (d.agency || "Other") === ag);
    const on = items.filter((d) => !state.srcOff.has(d.id)).length;
    html += `<div class="src-group">
      <label class="src-agency"><input type="checkbox" data-agency="${esc(ag)}" ${on === items.length ? "checked" : ""} ${on > 0 && on < items.length ? 'data-mixed="1"' : ""}>
        <span>${esc(ag)}</span><button type="button" class="only-btn" data-only-agency="${esc(ag)}">only</button></label>
      ${items.map((d) => {
        const bodies = datasetBodies(d).map((b) => BODY[b]?.name || b).join(", ");
        const n = neededBy(d.id).length;
        const waiting = d.category === "layer" && !(d.available_sites || []).length;
        const meta = waiting ? "no data yet"
          : d.category === "layer" ? `${d.available_sites.length} site${d.available_sites.length === 1 ? "" : "s"}`
          : `${n} dimension${n === 1 ? "" : "s"}`;
        return `<label class="src-row ${waiting ? "planned" : ""}" data-src-info="${esc(d.id)}">
          <input type="checkbox" data-src="${esc(d.id)}" ${state.srcOff.has(d.id) ? "" : "checked"}>
          <span class="src-name">${esc(d.name)}</span>
          <span class="dim-meta">${esc(bodies)} · ${esc(meta)}</span>
          <button type="button" class="info-btn" data-info-btn="${esc(d.id)}" aria-label="About ${esc(d.name)}">i</button></label>`;
      }).join("")}</div>`;
  }
  const earthDemOff = ds.some((d) => (d.dem_for || []).includes("earth") && state.srcOff.has(d.id));
  if (earthDemOff) html += `<p class="tip-warn">Every Earth site's terrain comes from Copernicus DEM, so turning it off removes all terrain scores.</p>`;
  html += `<div class="dim-actions"><button data-src-all>All sources</button></div></details>`;
  const el = $("source-filter");
  el.innerHTML = html;
  el.querySelector("#src-details").addEventListener("toggle", (ev) => { state.srcOpen = ev.currentTarget.open; });
  el.querySelectorAll("[data-mixed]").forEach((cb) => { cb.indeterminate = true; });
  el.querySelectorAll("input[data-src]").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? state.srcOff.delete(cb.dataset.src) : state.srcOff.add(cb.dataset.src);
    sourcesChanged();
  }));
  el.querySelectorAll("input[data-agency]").forEach((cb) => cb.addEventListener("change", () => {
    for (const d of ds.filter((x) => (x.agency || "Other") === cb.dataset.agency)) cb.checked ? state.srcOff.delete(d.id) : state.srcOff.add(d.id);
    sourcesChanged();
  }));
  el.querySelectorAll("[data-only-agency]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault();
    state.srcOff = new Set(ds.filter((x) => (x.agency || "Other") !== b.dataset.onlyAgency).map((x) => x.id));
    sourcesChanged();
  }));
  el.querySelector("[data-src-all]").addEventListener("click", () => { state.srcOff = new Set(); sourcesChanged(); });
}

function sourcesChanged() {
  try { localStorage.setItem(SRC_KEY, JSON.stringify([...state.srcOff])); } catch { /* ignore */ }
  renderSourceFilter();
  renderPanel();
  renderTopMatches();
  buildPairLines();
}

function renderDims() {
  const dims = state.data.dimensions, nSites = Object.keys(state.data.sites).length;
  const row = (k) => {
    const d = dims[k];
    const filterOnly = (d.score_excluded_bodies || []).includes(state.data.sites[state.targetId]?.body);
    const n = d.group === "layer" ? (d.sites_with_data || []).length : nSites;
    const allTypes = Object.keys(state.data.site_types || {});
    const applies = d.applies_to && d.applies_to.length < allTypes.length ? d.applies_to.map(typeShort).join(", ") : "";
    const avail = d.group === "terrain" ? applies : n === 0 ? "no data yet" : `${n}/${nSites} sites`;
    return `<label class="dim-row ${d.group === "layer" && n === 0 ? "empty" : ""}" data-dim-info="${k}">
      <input type="checkbox" data-dim="${k}" ${state.dims.has(k) ? "checked" : ""}>
      <span class="dim-name">${esc(d.label)}</span>
      <span class="dim-meta">${filterOnly ? "Moon: filter / evidence only" : `${avail ? esc(avail) + " · " : ""}w ${d.weight}`}</span>
      <button type="button" class="info-btn" data-info-btn="${k}" aria-label="Where ${esc(d.label)} comes from">i</button></label>`;
  };
  const keys = Object.keys(dims);
  $("dims").innerHTML = `<h2>Score dimensions <span class="hint">pick what the score is based on</span></h2>
    <div class="dim-group"><h3>Terrain (from elevation)</h3>${keys.filter((k) => dims[k].group === "terrain").map(row).join("")}</div>
    <div class="dim-group"><h3>Data layers</h3>${keys.filter((k) => dims[k].group === "layer").map(row).join("") || '<p class="hint">No layers in config/layers.json</p>'}</div>
    <div class="dim-actions"><button data-act="all">All</button><button data-act="terrain">Terrain only</button><button data-act="default">Defaults</button></div>`;
  $("dims").querySelectorAll("input[data-dim]").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? state.dims.add(cb.dataset.dim) : state.dims.delete(cb.dataset.dim);
    dimsChanged();
  }));
  $("dims").querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => {
    const act = b.dataset.act;
    state.dims = new Set(keys.filter((k) => act === "all" || (act === "terrain" ? dims[k].group === "terrain" : dims[k].default_on)));
    dimsChanged();
  }));
}

// ------------------------------------------------------------------ hover card: where a dimension's data comes from
const tip = Object.assign(document.createElement("div"), { id: "dim-tip", hidden: true });
tip.setAttribute("role", "tooltip");
document.body.appendChild(tip);
let tipShowTimer = null, tipHideTimer = null, tipAnchor = null;

const datasetById = (id) => (state.data.data_sources?.datasets || []).find((d) => d.id === id);

// where each dimension's input files sit in the project folder (paths relative to the project root)
const layerFile = (k, s) => `data/layers/${k}/${s.id}.tif`;
const demFile = (s) => `data/raw/${s.id}.npz`;
const pathCode = (p) => `<code class="path" data-copy="${esc(p)}" title="Click to copy">${esc(p)}</code>`;

function filesHtml(k, c, e, t) {
  const d = state.data.dimensions[k];
  const name = (s) => `<b style="color:${s.body === "earth" ? COLOR.earth : COLOR[s.body]}">${esc(s.name)}</b>`;
  const script = (id) => datasetById(id)?.script;
  let html = `<div class="tip-h">Files in the project folder</div>`;
  if (d.group === "terrain") {
    const sites = c ? [e, t] : [];
    html += sites.length
      ? `<ul>${sites.map((s) => `<li>${name(s)}: ${pathCode(demFile(s))}</li>`).join("")}</ul>`
      : `<p>${pathCode("data/raw/<site>.npz")}</p>`;
    const sc = script(c ? e.dem_source : "copernicus_dem");
    html += `<p class="hint">Elevation windows cached as NumPy arrays${sc ? ` by <code>${esc(sc)}</code>` : ""}.</p>`;
    return html;
  }
  const have = new Set(d.sites_with_data || []);
  html += `<p>Folder: ${pathCode(`data/layers/${k}/`)} <span class="hint">(${have.size} file${have.size === 1 ? "" : "s"})</span></p>`;
  if (c) {
    html += `<ul>${[e, t].map((s) => {
      if (have.has(s.id)) return `<li>${name(s)}: ${pathCode(layerFile(k, s))}</li>`;
      const known = s.body !== "earth" && (d.planetary_value != null || c.layers?.[k]?.target_is_constant);
      return known
        ? `<li>${name(s)}: <span class="hint">no file needed (known value)</span></li>`
        : `<li>${name(s)}: <span class="tip-warn">missing</span>, expected at ${pathCode(layerFile(k, s))}</li>`;
    }).join("")}</ul>`;
  }
  const sc = script(d.source_ids?.earth);
  if (sc) html += `<p class="hint">Earth files exported by <code>${esc(sc)}</code>.</p>`;
  return html;
}

function dimInfoHtml(k) {
  const d = state.data.dimensions[k];
  const c = currentComparison();
  const e = state.data.sites[state.earthId], t = state.data.sites[state.targetId];
  const siteName = (s) => `<b style="color:${s.body === "earth" ? COLOR.earth : COLOR[s.body]}">${esc(s.name)}</b>`;
  let html = `<div class="tip-title">${esc(d.label)}</div><p>${esc(d.description || "")}</p>`;
  let moreId = null;

  html += `<div class="tip-h">Data source</div>`;
  if (d.group === "terrain") {
    if (c) {
      html += `<ul>${[e, t].map((s) => {
        const ds = datasetById(s.dem_source);
        return `<li>${siteName(s)}: ${esc(ds ? ds.name : s.source)}${ds ? ` <span class="hint">(${esc(ds.resolution)}, ${esc(ds.provider.split(";")[0])})</span>` : ""}</li>`;
      }).join("")}</ul>
      <p class="hint">Only elevation data is used. Both sites are resampled to ${c.res_m} m/pixel for this comparison.</p>`;
      moreId = e.dem_source;
    } else {
      const dems = (state.data.data_sources?.datasets || []).filter((x) => x.category === "elevation");
      html += `<ul>${dems.map((x) => `<li>${esc(x.name)} <span class="hint">(${esc((x.dem_for || []).map((b) => BODY[b]?.name).join(", "))}, ${esc(x.resolution)})</span></li>`).join("")}</ul>`;
    }
    if (c && (c.not_applicable || []).includes(k)) {
      html += `<p class="tip-warn">Not used for ${esc(typeShort(c.target_type))} targets like ${esc(t.name)}.</p>`;
    }
  } else {
    const have = new Set(d.sites_with_data || []);
    html += `<ul>${Object.entries(d.sources || {}).map(([b, s]) => `<li><b>${esc(BODY[b]?.name || b)}:</b> ${esc(s)}</li>`).join("")}</ul>`;
    html += have.size
      ? `<p class="hint">Files delivered for ${have.size} site${have.size === 1 ? "" : "s"}.</p>`
      : `<p class="tip-warn">No data yet. Waiting for the data teams.</p>`;
    if (c && have.size) {
      const missing = [e, t].filter((s) => !have.has(s.id));
      html += missing.length
        ? `<p class="tip-warn">Missing for this pair: ${missing.map((s) => esc(s.name)).join(" and ")}.</p>`
        : `<p class="hint">This pair: data for both ${siteName(e)} and ${siteName(t)}.</p>`;
    }
    moreId = k;
  }

  html += filesHtml(k, c, e, t);

  const applies = (d.applies_to || []).map(typeShort).join(", ");
  if (applies) html += `<div class="tip-h">Used for</div><p>${esc(applies)} targets</p>`;
  if (c) {
    const blocked = [...new Set(blockedBy(k, c))];
    if (blocked.length) html += `<p class="tip-warn">Excluded from the score: ${blocked.map((id) => esc(datasetName(id))).join(", ")} is switched off in the Data sources filter.</p>`;
    for (const id of new Set(dimSourceIds(k, c))) {
      const ds = datasetById(id);
      if (ds?.caveat) html += `<p class="tip-warn">⚠ ${esc(ds.name)}: ${esc(ds.caveat)}</p>`;
    }
  }
  html += `<div class="tip-h">How it's scored</div><p class="hint">${esc(d.method)}</p>`;
  if (d.code) html += `<div class="tip-h">Code</div><p><code>${esc(d.code)}</code></p>`;
  if (moreId) html += `<button type="button" class="link-btn" data-source="${esc(moreId)}">More in Data sources</button>`;
  return html;
}

/** Hover card for one dataset: what it measures, where it comes from, how we got it, where it's used. */
function datasetInfoHtml(id) {
  const d = datasetById(id);
  if (!d) return `<div class="tip-title">${esc(id)}</div>`;
  const dims = state.data.dimensions, sites = Object.values(state.data.sites);
  const usedBy = Object.keys(dims).filter((k) => d.category === "elevation"
    ? dims[k].group === "terrain" || Object.values(dims[k].source_ids || {}).includes(id)
    : Object.values(dims[k].source_ids || {}).includes(id));
  const siteIds = d.category === "elevation" ? sites.filter((s) => s.dem_source === id).map((s) => s.id) : (d.available_sites || []);
  const siteNames = siteIds.map((sid) => state.data.sites[sid]?.name).filter(Boolean);
  const bodies = datasetBodies(d).map((b) => BODY[b]?.name || b).join(", ");
  const off = state.srcOff?.has(id);
  const row = (k, v) => (v ? `<div class="tip-h">${k}</div><p>${v}</p>` : "");

  let html = `<div class="tip-title">${esc(d.name)}</div>
    <p class="hint">${esc(d.agency || "")}${bodies ? ` · ${esc(bodies)}` : ""}${d.resolution ? ` · ${esc(d.resolution)}` : ""}</p>`;
  if (off) html += `<p class="tip-warn">Switched off in the Data sources filter: scores that need it are left out.</p>`;
  html += row("Measures", esc(d.measures || ""));
  html += row("Provider", esc(d.provider || ""));
  html += row("How we got it", esc(d.how || ""));
  if (d.script) html += `<div class="tip-h">Script</div><p><code>${esc(d.script)}</code></p>`;
  const layerIds = Object.keys(dims).filter((k) => Object.values(dims[k].source_ids || {}).includes(id));
  const where = d.category === "elevation" ? "data/raw/<site>.npz" : layerIds.map((k) => `data/layers/${k}/<site>.tif`).join(", ");
  if (where && d.category !== "globe") html += `<div class="tip-h">Files in the project folder</div><p><code>${esc(where)}</code></p>`;
  html += row("Used for", usedBy.length ? usedBy.map((k) => esc(dims[k].label)).join(", ") : esc(d.used_for || ""));
  html += `<div class="tip-h">Sites with this data</div>` + (siteNames.length
    ? `<p>${siteNames.length} site${siteNames.length === 1 ? "" : "s"}: ${siteNames.map(esc).join(", ")}</p>`
    : `<p class="tip-warn">No data yet. Waiting for the data teams.</p>`);
  if (d.caveat) html += `<p class="tip-warn">⚠ ${esc(d.caveat)}</p>`;
  if (d.credit) html += `<p class="hint">Credit: ${esc(d.credit)}</p>`;
  html += `<button type="button" class="link-btn" data-source="${esc(id)}">More in Data sources</button>`;
  return html;
}

function showTip(anchor) {
  clearTimeout(tipHideTimer);
  tipAnchor = anchor;
  tip.innerHTML = anchor.dataset.srcInfo ? datasetInfoHtml(anchor.dataset.srcInfo)
    : dimInfoHtml(anchor.dataset.dimInfo || anchor.dataset.infoBtn);
  tip.hidden = false;
  tip.querySelector("[data-source]")?.addEventListener("click", (ev) => { hideTip(true); openSources(ev.currentTarget.dataset.source); });
  tip.querySelectorAll("[data-copy]").forEach((el) => el.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el.dataset.copy); el.classList.add("copied"); setTimeout(() => el.classList.remove("copied"), 900); }
    catch { /* clipboard unavailable (e.g. file:// page) */ }
  }));
  // place it to the left of the side panel row; above it for the fact cards at the bottom of the
  // 3D view; below it on narrow screens
  const r = anchor.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left - w - 12, y = r.top - 8;
  if (anchor.closest("#facts-strip")) { x = Math.max(8, Math.min(r.left - w / 2, innerWidth - w - 8)); y = r.top - h - 8; }
  else if (x < 8) { x = Math.max(8, Math.min(r.left, innerWidth - w - 8)); y = r.bottom + 6; }
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip(now = false) {
  clearTimeout(tipShowTimer);
  clearTimeout(tipHideTimer);
  const go = () => { tip.hidden = true; tipAnchor = null; };
  now ? go() : (tipHideTimer = setTimeout(go, 180));
}

const TIP_TARGET = "[data-dim-info],[data-src-info]";
for (const id of ["dims", "metrics", "source-filter", "facts-strip"]) {
  const el = $(id);
  el.addEventListener("mouseover", (ev) => {
    const a = ev.target.closest(TIP_TARGET);
    if (!a || a === tipAnchor) { if (a) clearTimeout(tipHideTimer); return; }
    clearTimeout(tipShowTimer);
    tipShowTimer = setTimeout(() => showTip(a), 250);
  });
  el.addEventListener("mouseout", (ev) => {
    const a = ev.target.closest(TIP_TARGET);
    if (a && !a.contains(ev.relatedTarget) && !tip.contains(ev.relatedTarget)) hideTip();
  });
  el.addEventListener("focusin", (ev) => { const a = ev.target.closest(TIP_TARGET); if (a) showTip(a); });
  el.addEventListener("focusout", () => hideTip());
  // the small "i" button: tap to open on touch screens
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-info-btn]");
    if (!b) return;
    ev.preventDefault(); // don't toggle the checkbox
    const a = b.closest(TIP_TARGET);
    tip.hidden || tipAnchor !== a ? showTip(a) : hideTip(true);
  });
}
tip.addEventListener("mouseenter", () => clearTimeout(tipHideTimer));
tip.addEventListener("mouseleave", () => hideTip());
addEventListener("keydown", (ev) => { if (ev.key === "Escape") hideTip(true); });
$("panel").addEventListener("scroll", () => hideTip(true), { passive: true });

function dimsChanged(keepPreset = false) {
  if (!keepPreset) state.preset = null;
  try { state.preset ? localStorage.setItem(PRESET_KEY, state.preset) : localStorage.removeItem(PRESET_KEY); } catch { /* storage unavailable */ }
  saveDims();
  renderPreset();
  renderDims();
  renderPanel();
  renderTopMatches();
  buildPairLines();
}

// ------------------------------------------------------------------ facts strip (bottom of the 3D view)
const FACTS_KEY = "analog-explorer-facts-collapsed";
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const toC = (k) => Math.round(k - 273.15);

function factRow(label, value, datasetId, extraTitle = "") {
  const ds = datasetId ? datasetById(datasetId) : null;
  const title = [ds?.name, extraTitle].filter(Boolean).join(" - ");
  const v = value == null ? `<span class="na">no data yet</span>` : `<span class="v">${value}</span>`;
  const src = ds ? `<span class="src" data-src-info="${esc(datasetId)}" tabindex="0" aria-label="${esc(title)}">${esc(ds.short || ds.name)}</span>`
    : extraTitle ? `<span class="src" title="${esc(extraTitle)}">by definition</span>` : "";
  return `<dt>${label}</dt><dd>${v}${src}</dd>`;
}

function siteFactsHtml(s) {
  const f = s.facts || {}, L = f.layers || {};
  const t = f.temperature;
  const temp = t ? `${toC(t.low_k)} to ${toC(t.high_k)} °C` : null;

  const tr = f.terrain;
  let terrain = null;
  if (tr) {
    const word = tr.flat_fraction >= 0.7 ? "flat" : tr.flat_fraction >= 0.4 ? "gently rolling" : tr.flat_fraction >= 0.15 ? "hilly" : "steep";
    terrain = `${word} <span class="hint">(${pctTxt(tr.flat_fraction)} under 5°)</span>`;
  }

  const dl = L.surface_dust;
  let dust = null;
  if (s.body === "moon") dust = 'Present <span class="hint">(local coverage unmeasured)</span>';
  if (dl && dl.fraction != null) {
    const word = dl.fraction >= 0.4 ? "high" : dl.fraction >= 0.1 ? "moderate" : dl.fraction > 0.01 ? "low" : "very low";
    const what = s.body === "earth" ? "bare fine soil" : s.body === "mars" ? "dust-covered" : "dusty";
    dust = `${word} <span class="hint">(${pctTxt(dl.fraction)} ${what})</span>`;
  }

  const pl = L.barren_ground;
  let plants = null;
  if (pl) {
    if (pl.constant) plants = "none";
    else {
      const veg = 1 - pl.fraction;
      const word = veg >= 0.6 ? "high" : veg >= 0.25 ? "moderate" : veg >= 0.05 ? "low" : "almost none";
      plants = `${word} <span class="hint">(${pctTxt(veg)} vegetated)</span>`;
    }
  }
  return `<dl>
    ${factRow("Temperature", temp, t?.dataset, t?.what)}
    ${factRow("Terrain", terrain, tr?.dataset, tr ? `median slope ${tr.slope_median}°, at ${tr.res_m} m/pixel` : "")}
    ${factRow("Dust", dust, dl?.dataset)}
    ${factRow("Plants", plants, pl?.dataset, pl?.constant ? (pl.note || "") : "")}
  </dl>`;
}

function renderFacts() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(FACTS_KEY) === "1"; } catch { /* ignore */ }
  const e = state.data.sites[state.earthId], t = state.data.sites[state.targetId];
  const shown = currentComparison() ? [e, t] : [e];
  $("facts-strip").innerHTML = shown.map((s) => `
    <section class="fact-card ${collapsed ? "collapsed" : ""}" style="border-top-color:${s.body === "earth" ? COLOR.earth : COLOR[s.body]}">
      <header><span class="body">${BODY[s.body].name}</span><b>${esc(s.name)}</b>
        <button class="fact-min" type="button" title="${collapsed ? "Show facts" : "Hide facts"}">${collapsed ? "▴" : "▾"}</button></header>
      ${siteFactsHtml(s)}
    </section>`).join("");
  $("facts-strip").querySelectorAll(".fact-min").forEach((b) => b.addEventListener("click", () => {
    try { localStorage.setItem(FACTS_KEY, collapsed ? "0" : "1"); } catch { /* ignore */ }
    renderFacts();
  }));
}

function renderSuitability() {
  const e = state.data.sites[state.earthId];
  const t = state.data.sites[state.targetId];
  const metricsEl = $("metrics");
  if (!metricsEl) return;

  // Clear existing suit cards
  metricsEl.querySelectorAll(".suit-card").forEach(el => el.remove());

  // Earth site absolute suitability
  if (e && e.body === "earth" && state.suitability && state.suitability.scores) {
    const suit = state.suitability.scores[e.id];
    if (suit) {
      const verdict = suit.score == null ? "insufficient data" : suit.score >= 0.7 ? "strong" : suit.score >= 0.4 ? "partial" : "weak";
      const groupsHtml = Object.entries(suit.groups || {}).map(([name, g]) => {
        if (!g || g.score == null) return "";
        const metricEntries = Object.entries(g.metric_scores || {}).filter(([, v]) => v != null);
        if (metricEntries.length === 0) return "";
        const metricsHtml = metricEntries.map(([m, v]) =>
          `<span class="dim-chip" style="background:${COLOR[v >= 0.6 ? "strong" : v >= 0.3 ? "partial" : "weak"]}">${m}: ${v.toFixed(2)}</span>`
        ).join(" ");
        return `<div class="suit-group">
          <div class="suit-group-header">
            <span>${name.charAt(0).toUpperCase() + name.slice(1)} <small class="hint">${((g.coverage ?? 0) * 100).toFixed(0)}% coverage</small></span>
            <b style="color:${COLOR[g.score >= 0.6 ? "strong" : g.score >= 0.3 ? "partial" : "weak"]}">${g.score.toFixed(2)}</b>
          </div>
          <div class="suit-metrics">${metricsHtml}</div>
        </div>`;
      }).join("");

      const html = `
        <div class="suit-card">
          <div class="suit-header">
            <h3>Earth Site Suitability</h3>
            <span class="chip ${verdict}">${verdict} (${suit.score != null ? suit.score.toFixed(2) : "N/A"})</span>
          </div>
          <p class="hint">Suitability across environmental metrics. Coverage: ${(suit.coverage * 100).toFixed(0)}%</p>
          ${groupsHtml}
        </div>`;
      metricsEl.insertAdjacentHTML("afterbegin", html);
    }
  }

  // Moon target absolute suitability (if target is Moon and we have Moon absolute scores)
  if (t && t.body === "moon" && state.moonSuitability && state.moonSuitability.scores) {
    const suit = state.moonSuitability.scores[t.id];
    if (suit) {
      const verdict = suit.score == null ? "insufficient data" : suit.score >= 0.7 ? "strong" : suit.score >= 0.4 ? "partial" : "weak";
      const groupsHtml = Object.entries(suit.groups || {}).map(([name, g]) => {
        if (!g || g.score == null) return "";
        const metricEntries = Object.entries(g.metric_scores || {}).filter(([, v]) => v != null);
        if (metricEntries.length === 0) return "";
        const metricsHtml = metricEntries.map(([m, v]) =>
          `<span class="dim-chip" style="background:${COLOR[v >= 0.6 ? "strong" : v >= 0.3 ? "partial" : "weak"]}">${m}: ${v.toFixed(2)}</span>`
        ).join(" ");
        return `<div class="suit-group">
          <div class="suit-group-header">
            <span>${name.charAt(0).toUpperCase() + name.slice(1)} <small class="hint">${((g.coverage ?? 0) * 100).toFixed(0)}% coverage</small></span>
            <b style="color:${COLOR[g.score >= 0.6 ? "strong" : g.score >= 0.3 ? "partial" : "weak"]}">${g.score.toFixed(2)}</b>
          </div>
          <div class="suit-metrics">${metricsHtml}</div>
        </div>`;
      }).join("");

      const html = `
        <div class="suit-card">
          <div class="suit-header">
            <h3>Moon Site Suitability</h3>
            <span class="chip ${verdict}">${verdict} (${suit.score != null ? suit.score.toFixed(2) : "N/A"})</span>
          </div>
          <p class="hint">Absolute Moon suitability. Coverage: ${(suit.coverage * 100).toFixed(0)}% ${suit.coverage < 0.5 ? "(terrain only)" : ""}</p>
          ${groupsHtml}
        </div>`;
      metricsEl.insertAdjacentHTML("beforeend", html);
    }
  }
}

// ------------------------------------------------------------------ right panel sub-tabs
const PANE_KEY = "analog-explorer-pane";
function setPane(name) {
  document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  document.querySelectorAll(".subtabs button").forEach((b) => b.classList.toggle("active", b.dataset.pane === name));
  try { localStorage.setItem(PANE_KEY, name); } catch { /* ignore */ }
}
document.querySelectorAll(".subtabs button").forEach((b) => b.addEventListener("click", () => setPane(b.dataset.pane)));
{
  let saved = null;
  try { saved = localStorage.getItem(PANE_KEY); } catch { /* ignore */ }
  setPane(["scores", "charts", "filters", "about"].includes(saved) ? saved : "scores");
}
function updateFiltersBadge() {
  const el = document.getElementById("filters-badge");
  if (!el || !state.data) return;
  const total = Object.keys(state.data.dimensions).length;
  const off = state.srcOff ? state.srcOff.size : 0;
  el.textContent = `${state.dims.size}/${total}` + (off ? ` · ${off} off` : "");
  el.classList.toggle("active", off > 0);
}

const SITE_CARDS = ["metrics", "charts", "layer-charts", "ranking", "limits"];

function renderSources(sitesShown) {
  $("sources").innerHTML = `<h2>Sites and datasets</h2>` + sitesShown.map((s) => `
    <p><b style="color:${s.body === "earth" ? COLOR.earth : COLOR[s.body]}">${esc(s.name)}</b>
    ${(s.types || []).map((ty) => `<span class="type-tag">${esc(typeShort(ty))}</span>`).join("")}<br>
    ${esc(s.region)} (${s.lat.toFixed(2)}, ${s.lon.toFixed(2)})${s.verify ? ` <span class="hint">- ${esc(s.verify)}</span>` : ""}<br>
    ${esc(s.blurb)}<br>
    <span class="hint">Elevation: </span>${s.dem_source
      ? `<button class="link-btn" data-source="${esc(s.dem_source)}">${esc(s.source)}</button>`
      : `<span class="hint">${esc(s.source)}</span>`}
    ${s.coord_source ? `<br><span class="hint">Coordinates: ${esc(s.coord_source.source)}</span>` : ""}</p>`).join("") +
    `<p class="hint">Generated ${esc(state.data.generated)}</p>`;
  $("sources").querySelectorAll("[data-source]").forEach((b) => b.addEventListener("click", () => openSources(b.dataset.source)));
}

// ------------------------------------------------------------------ "Data sources & how we got them" window
const SOURCE_SECTIONS = [
  ["elevation", "Elevation data", "Used for every terrain score and the 3D terrain."],
  ["layer", "Datasets behind the data layers", "Temperature, plants, dust, albedo and radar."],
  ["globe", "Globe images", "Only for the look of the planets; not used in any score."],
];

function linkList(links) {
  return (links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ");
}

function renderDataSources() {
  const ds = state.data.data_sources || { datasets: [] };
  const dims = state.data.dimensions;
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "");
  let html = `<p class="dlg-intro">Every number in this viewer comes from the public datasets below, downloaded by
    the scripts in this project, or is calculated from them by our own code. Nothing is typed in by hand
    except the site coordinates (listed at the bottom with where each one came from).</p>`;

  for (const [cat, title, note] of SOURCE_SECTIONS) {
    const items = ds.datasets.filter((d) => d.category === cat);
    if (!items.length) continue;
    html += `<h2>${title} <span class="hint">${note}</span></h2>`;
    html += items.map((d) => `<section class="src-card" id="src-${esc(d.id)}">
      <h3>${esc(d.name)}${(d.dem_for || []).map((b) => `<span class="type-tag">${esc(BODY[b]?.name || b)}</span>`).join("")}</h3>
      <table class="src-table">
        ${row("Measures", esc(d.measures))}${row("Resolution", esc(d.resolution))}
        ${row("Provider", esc(d.provider))}${row("Used for", esc(d.used_for))}
        ${row("How we got it", esc(d.how))}${row("Script", d.script ? `<code>${esc(d.script)}</code>` : "")}
        ${row("Links", linkList(d.links))}${row("Credit", `<span class="hint">${esc(d.credit)}</span>`)}
      </table></section>`).join("");
  }

  // data layers: from config/layers.json, with live status
  const layerIds = Object.keys(dims).filter((k) => dims[k].group === "layer");
  if (layerIds.length) {
    html += `<h2>Data layers <span class="hint">GeoTIFFs delivered by the data teams into data/layers/&lt;layer&gt;/&lt;site&gt;.tif</span></h2>`;
    html += layerIds.map((k) => {
      const d = dims[k], n = (d.sites_with_data || []).length;
      const status = n ? `<span class="chip strong">${n} site file${n === 1 ? "" : "s"}</span>` : `<span class="chip weak">no data yet</span>`;
      const planned = Object.entries(d.sources || {}).map(([b, s]) => `<li><b>${esc(BODY[b]?.name || b)}:</b> ${esc(s)}</li>`).join("");
      return `<section class="src-card" id="src-${esc(k)}"><h3>${esc(d.label)} ${status}</h3>
        <p>${esc(d.description || "")}</p>
        <ul>${planned}</ul>
        <p>Files: <code>data/layers/${esc(k)}/&lt;site&gt;.tif</code>${n ? ` <span class="hint">(${(d.sites_with_data || []).map(esc).join(", ")})</span>` : ""}</p>
        <p class="hint">How it's compared: ${esc(d.method)}. Registered in <code>config/layers.json</code>; loaded by <code>analog/layers.py</code>.</p>
      </section>`;
    }).join("");
  }

  // computed by us
  const terrain = Object.keys(dims).filter((k) => dims[k].group === "terrain");
  html += `<h2>Calculated by our code <span class="hint">from the elevation data above (analog/terrain.py, analog/compare.py)</span></h2>
    <table class="src-table metrics-table"><tr><th>Metric</th><th>Used for</th><th>Method</th></tr>
    ${terrain.map((k) => `<tr><td>${esc(dims[k].label)}</td><td>${esc((dims[k].applies_to || []).map(typeShort).join(", "))}</td><td class="hint">${esc(dims[k].method)}</td></tr>`).join("")}
    </table>`;

  // site coordinates
  const coordNote = ds.site_coordinates?._how;
  html += `<h2>Site coordinates ${coordNote ? `<span class="hint">${esc(coordNote)}</span>` : ""}</h2>
    <table class="src-table metrics-table"><tr><th>Site</th><th>Lat, lon</th><th>Where the position comes from</th></tr>
    ${Object.values(state.data.sites).map((s) => {
      const c = s.coord_source || {};
      const src = c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.source)}</a>` : esc(c.source || "-");
      return `<tr><td>${esc(s.name)}</td><td>${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}</td><td>${src}</td></tr>`;
    }).join("")}</table>
    <p class="hint">Results generated ${esc(state.data.generated)} by <code>python scripts/analyze.py</code>.
    Full instructions: README.md and docs/DATA_INTEGRATION.md.</p>`;
  $("sources-body").innerHTML = html;
}

function openSources(focusId) {
  renderDataSources();
  const dlg = $("sources-dialog");
  if (!dlg.open) dlg.showModal();
  const target = focusId && document.getElementById("src-" + focusId);
  if (target) { target.scrollIntoView({ block: "start" }); target.classList.add("flash"); setTimeout(() => target.classList.remove("flash"), 1600); }
  else $("sources-body").scrollTop = 0;
}

$("open-sources").addEventListener("click", () => openSources());
$("open-sources-footer").addEventListener("click", () => openSources());
$("sources-dialog").querySelector(".dlg-close").addEventListener("click", () => $("sources-dialog").close());
$("sources-dialog").addEventListener("click", (ev) => { if (ev.target === $("sources-dialog")) $("sources-dialog").close(); }); // click outside

function renderPanel() {
  const c = currentComparison();
  const e = state.data.sites[state.earthId], t = state.data.sites[state.targetId];
  renderFacts();
  renderSuitability();
  updateFiltersBadge();
  if (!c) { // a site whose type has no target yet (e.g. dunes, evaporite)
    $("score-card").innerHTML = `<h2>${esc(e.name)}</h2>
      <p>This is a <b>${(e.types || []).map(typeLabel).map(esc).join(" / ")}</b> site, and there is no Moon or Mars target of that type yet.</p>
      <p class="hint">${esc(e.types?.map((ty) => state.data.site_types?.[ty]?.description).filter(Boolean).join(" ") || "")}</p>`;
    SITE_CARDS.forEach((id) => { $(id).hidden = true; });
    renderSources([e]);
    return;
  }
  SITE_CARDS.forEach((id) => { $(id).hidden = false; });
  const tColor = COLOR[t.body];
  const dims = state.data.dimensions;
  const sc = scoreOf(c);
  const na = new Set([...(c.not_applicable || []), ...sc.filterOnly]);

  $("score-card").innerHTML = `
    <div class="score-row">
      <div class="score-big" title="${scoreDescription(sc)}" style="color:${sc.overall == null ? COLOR.partial : COLOR[sc.verdict]}">${scoreText(sc)}</div>
      <div>
        ${sc.overall == null ? `<span class="chip weak">${sc.observed_score != null ? "insufficient evidence" : sc.filtered.length ? "nothing left after source filter" : sc.filterOnly.length ? "selected filters do not contribute to this score" : "no dimensions selected"}</span>` : `<span class="chip ${sc.verdict}">${sc.verdict} analog</span>`}
        <span class="chip role${isTeam(e) ? " team" : ""}">${c.is_pair ? "calibration pair" : roleLabel(e)}</span>
        <span class="chip role">${esc(typeShort(c.target_type))}</span>
        <div class="pair-names"><b>${esc(e.name)}</b> vs <b>${esc(t.name)}</b><br>
        based on ${sc.used.length} metric${sc.used.length === 1 ? "" : "s"}${sc.filtered.length ? `, ${sc.filtered.length} excluded by source filter` : ""}${sc.missing.length ? `, ${sc.missing.length} selected without data` : ""} · ${c.res_m} m/pixel<br>
        Evidence coverage: ${(sc.coverage * 100).toFixed(0)}%${sc.overall == null && sc.observed_score != null ? ` · observed similarity ${sc.observed_score.toFixed(2)} (incomplete)` : ""}</div>
      </div>
    </div>`;

  const bar = (k) => {
    const d = dims[k], v = c.scores[k];
    if (v == null) {
      const why = na.has(k) ? `not used for ${typeShort(c.target_type)} targets` : "no data for this pair";
      return `<div class="metric nodata" data-dim-info="${k}">
        <div class="top"><span>${esc(d.label)}</span><span class="hint">${esc(why)}</span></div>
        <div class="bar"></div></div>`;
    }
    const blocked = blockedBy(k, c);
    if (blocked.length) {
      return `<div class="metric nodata" data-dim-info="${k}">
        <div class="top"><span>${esc(d.label)} <s class="hint">${v.toFixed(2)}</s></span>
        <span class="hint">excluded: ${esc([...new Set(blocked)].map(datasetName).join(", "))} filtered out</span></div>
        <div class="bar"></div></div>`;
    }
    return `<div class="metric" data-dim-info="${k}">
      <div class="top"><span>${esc(d.label)} <span class="hint">w=${d.weight}</span></span><b>${v.toFixed(2)}</b></div>
      <div class="bar"><div style="width:${v * 100}%;background:${COLOR[verdictOf(v)]}"></div></div></div>`;
  };
  const holds = sc.used.filter((k) => c.scores[k] >= 0.6), breaks = sc.used.filter((k) => c.scores[k] < 0.6);
  const li = (k) => `<li>${esc(dims[k].label)}: ${c.scores[k].toFixed(2)}</li>`;
  // bars only for dimensions that count (or were filtered out by source); the rest go in one short line
  const selected = [...state.dims];
  const notUsed = selected.filter((k) => c.scores[k] == null && na.has(k));
  const noData = selected.filter((k) => c.scores[k] == null && !na.has(k));
  const chips = (ks) => ks.map((k) => `<span class="dim-chip" data-dim-info="${k}">${esc(dims[k].label)}</span>`).join("");
  const skipped = (notUsed.length ? `<p class="skipped"><span class="hint">Not used for ${esc(typeShort(c.target_type))} targets:</span> ${chips(notUsed)}</p>` : "")
    + (noData.length ? `<p class="skipped"><span class="hint">No data for this pair yet:</span> ${chips(noData)}</p>` : "");
  $("metrics").innerHTML = `<h2>Per-dimension similarity</h2>` +
    (selected.filter((k) => c.scores[k] != null).map(bar).join("") || '<p class="hint">Nothing to score: pick dimensions in the Filters tab.</p>') +
    skipped +
    `<div class="cols">
      <div><h3 style="color:var(--strong)">Where it holds</h3><ul>${holds.map(li).join("") || "<li>-</li>"}</ul></div>
      <div><h3 style="color:var(--weak)">Where it breaks</h3><ul>${breaks.map(li).join("") || "<li>-</li>"}</ul></div>
    </div>
    <ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;

  renderEvidence($("metrics"), t);
  renderLunarDust($("metrics"), t, { enabled: state.dims.has("surface_dust") });
  if (t.body === "moon") {
    $("score-card").insertAdjacentHTML("beforeend", '<p class="hint">Lunar dust is excluded from this score. The dust checkbox in Filters shows or hides its evidence.</p>');
  }
  if (t.tags?.some(tag => ["planetary_import", "moon_catalog"].includes(tag))) {
    $("score-card").insertAdjacentHTML("beforeend", `<p class="hint">${esc(t.verify)} Comparison window: ${t.window_km} km.</p>`);
  }

  // one histogram per selected data layer that has data for this pair
  const layerIds = sc.used.filter((k) => dims[k].group === "layer" && c.layers && c.layers[k]);
  $("layer-charts").hidden = layerIds.length === 0;
  const legendL = `<div class="legend"><span><i style="background:${COLOR.earth}"></i>${esc(e.name)}</span><span><i style="background:${tColor}"></i>${esc(t.name)}</span></div>`;
  // known limitations of a dataset used by this pair (e.g. THEMIS only sees Mars at ~7 h and ~17 h)
  const caveats = (k) => [...new Set(dimSourceIds(k, c))].map(datasetById).filter((x) => x?.caveat)
    .map((x) => `<p class="tip-warn">⚠ ${esc(x.name)}: ${esc(x.caveat)}</p>`).join("");
  $("layer-charts").innerHTML = layerIds.map((k) => caveats(k) + layerChart(k)).join("");
  function layerChart(k) {
    const d = dims[k], L = c.layers[k];
    if (L.kind === "relative" || L.kind === "absolute") {
      const u = d.unit ? " " + esc(d.unit) : "";
      const s = c.scores[k];
      return `<h2>${esc(d.label)} <span class="hint">${esc(e.name)} ${L.earth_value}${u} · ${esc(t.name)} ${L.target_value}${u}</span></h2>
        <div class="frac-row"><span>${esc(e.name)}</span><div class="bar"><div style="width:${s * 100}%;background:${COLOR.earth}"></div></div><b>${s.toFixed(2)}</b></div>
        <p class="hint">${L.kind === "absolute" ? `Absolute target difference ${L.distance.toFixed(1)}${u}; provisional half-similarity tolerance ${L.tau.toFixed(1)}${u}. ${esc(L.note || "")}` : `Scored against the Earth cohort (${L.earth_min} to ${L.earth_max}${u}).`}</p>`;
    }
    if (L.kind === "fraction") { // e.g. barren ground: share of area below a threshold
      const pct = (v) => `${Math.round(v * 100)}%`;
      const bars = [[e, L.earth_value, COLOR.earth], [t, L.target_value, tColor]].map(([s, v, col]) => `
        <div class="frac-row"><span>${esc(s.name)}</span><div class="bar"><div style="width:${v * 100}%;background:${col}"></div></div><b>${pct(v)}</b></div>`).join("");
      const hist = L.earth_hist ? `<div class="chart">${lineChart([{ ys: L.earth_hist, color: COLOR.earth, fill: true }],
        L.bins.slice(1).map((b, i) => (b + L.bins[i]) / 2), { xLabel: `${esc(e.name)} values (threshold ${L.threshold})`, vline: L.threshold })}</div>` : "";
      const sameRule = L.target_threshold == null || L.target_is_constant ||
        (L.target_threshold === L.threshold && L.target_direction === L.direction);
      const rule = sameRule
        ? `share of area ${L.direction || "below"} ${L.threshold}${d.unit ? " " + esc(d.unit) : ""}`
        : `${BODY[e.body].name}: share ${L.direction} ${L.threshold}${d.unit ? " " + esc(d.unit) : ""} · ${BODY[t.body].name}: share ${L.target_direction} ${L.target_threshold}`;
      return `<h2>${esc(d.label)} <span class="hint">${rule}</span></h2>${bars}
        ${L.target_is_constant ? `<p class="hint">${esc(t.name)}: ${esc(d.sources?.[t.body] || "known value")}</p>` : ""}${hist}`;
    }
    const mids = L.bins.slice(1).map((b, i) => (b + L.bins[i]) / 2);
    const xl = L.x_label || (L.normalized === "none" ? (d.unit || "value") : `${L.normalized}-normalised`);
    const ratio = L.kind === "ratio" ? ` · ${esc(t.name)} is ${L.ratio >= 1 ? `${L.ratio}x` : `${(1 / L.ratio).toFixed(2)}x smaller than`} ${esc(e.name)}` : "";
    return `<h2>${esc(d.label)} <span class="hint">median ${L.earth_median} vs ${L.target_median}${d.unit ? " " + esc(d.unit) : ""}${ratio}</span></h2>
      ${legendL}<div class="chart">${lineChart([
        { ys: L.earth_hist, color: COLOR.earth, fill: true }, { ys: L.target_hist, color: tColor, fill: true }], mids, { xLabel: xl })}</div>`;
  }

  const ef = c.earth_features, tf = c.target_features, bins = state.data.bins;
  const legend = `<div class="legend"><span><i style="background:${COLOR.earth}"></i>${esc(e.name)}</span><span><i style="background:${tColor}"></i>${esc(t.name)}</span></div>`;
  const norm = (a) => { const v = a.filter((x) => x != null); const lo = Math.min(...v), hi = Math.max(...v); return a.map((x) => x == null ? null : (x - lo) / Math.max(hi - lo, 1e-6)); };
  $("chart-profile-wrap").hidden = !(ef.profile_m && tf.profile_m);
  if (ef.profile_m && tf.profile_m) {
    $("chart-profile").innerHTML = legend + lineChart([
      { ys: norm(ef.profile_m), color: COLOR.earth }, { ys: norm(tf.profile_m), color: tColor }],
      bins.profile_r, { xLabel: "r / R", vline: 1 });
  }
  $("chart-illum-wrap").hidden = !(ef.illum_hist && tf.illum_hist);
  if (ef.illum_hist && tf.illum_hist) {
    $("chart-illum-hint").textContent = `share of area vs fraction of sun directions lit, sun ${tf.sun_elevation_deg} deg up`;
    $("chart-illum").innerHTML = legend + lineChart([
      { ys: ef.illum_hist, color: COLOR.earth, fill: true }, { ys: tf.illum_hist, color: tColor, fill: true }],
      bins.illum_lit_fraction, { xLabel: "lit fraction" });
  }
  $("chart-texture-wrap").hidden = !(ef.spectrum && tf.spectrum);
  if (ef.spectrum && tf.spectrum) {
    // shape-only comparison: subtract each curve's mean over the shared wavelengths, then shift up for plotting
    const ok = ef.spectrum.map((v, i) => v != null && tf.spectrum[i] != null);
    const centre = (a) => { const v = a.filter((x, i) => ok[i]); const m = v.reduce((s, x) => s + x, 0) / Math.max(v.length, 1); return a.map((x, i) => (ok[i] ? x - m : null)); };
    const ce = centre(ef.spectrum), ct = centre(tf.spectrum);
    const lo = Math.min(...[...ce, ...ct].filter((x) => x != null));
    const xs = bins.spectrum_wavelength_m.map((w) => Math.log10(w / 1000)); // log10 km
    $("chart-texture").innerHTML = legend + lineChart([
      { ys: ce.map((x) => (x == null ? null : x - lo)), color: COLOR.earth },
      { ys: ct.map((x) => (x == null ? null : x - lo)), color: tColor }], xs, { xLabel: "log10 wavelength (km)" });
  }
  const mids = bins.slope_deg.slice(1).map((b, i) => (b + bins.slope_deg[i]) / 2);
  $("chart-slope").innerHTML = lineChart([
    { ys: ef.slope_hist, color: COLOR.earth, fill: true }, { ys: tf.slope_hist, color: tColor, fill: true }],
    mids, { xLabel: "slope (deg)" });
  $("chart-hypso").innerHTML = lineChart([
    { ys: ef.hypsometry, color: COLOR.earth }, { ys: tf.hypsometry, color: tColor }],
    bins.hypsometry_area, { xLabel: "area fraction" });

  const ranked = state.data.comparisons.filter((x) => x.target === state.targetId)
    .map((x) => ({ x, s: scoreOf(x) })).sort((a, b) => compareEvidenceScores(a.s, b.s));
  $("ranking").innerHTML = `<h2>All Earth sites vs ${esc(t.name)} <span class="hint">* = partial similarity; complete scores appear first</span></h2>
    <table><thead><tr><th>#</th><th>Earth site</th><th>Type</th><th class="num">Score</th></tr></thead><tbody>
    ${ranked.map(({ x, s: r }, i) => { const s = state.data.sites[x.earth]; return `<tr class="clickable ${x.earth === state.earthId ? "selected" : ""}" data-earth="${s.id}">
      <td>${i + 1}</td><td>${esc(s.name)}</td><td>${roleLabel(s)}</td>
      <td class="num" title="${scoreDescription(r)}" style="color:${r.overall == null ? COLOR.partial : COLOR[r.verdict]}">${scoreText(r)} <small class="hint">${Math.round(r.coverage * 100)}% evidence</small></td></tr>`; }).join("")}
    </tbody></table>`;
  $("ranking").querySelectorAll("tr[data-earth]").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.earth, null)));

  $("limits").innerHTML = `<h2>What Earth cannot reproduce at ${esc(t.name)}</h2>
    <ul>${(t.earth_limits || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;

  renderSources([e, t]);
}

function lineChart(series, xs, { xLabel, vline } = {}) {
  const W = 360, H = 130, L = 26, R = 8, T = 8, B = 24;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.max(1e-9, ...series.flatMap((s) => s.ys.filter((y) => y != null)));
  const X = (x) => L + (x - xmin) / (xmax - xmin) * (W - L - R);
  const Y = (y) => T + (1 - y / ymax) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  svg += `<line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>`;
  for (let i = 0; i <= 4; i++) {
    const x = xmin + (xmax - xmin) * i / 4;
    svg += `<text x="${X(x)}" y="${H - B + 12}" text-anchor="middle">${+x.toFixed(2)}</text>`;
  }
  svg += `<text x="${W - R}" y="${H - 2}" text-anchor="end">${xLabel || ""}</text>`;
  if (vline != null) svg += `<line x1="${X(vline)}" y1="${T}" x2="${X(vline)}" y2="${H - B}" stroke="#ffffff" stroke-opacity=".25" stroke-dasharray="3 3"/>`;
  for (const s of series) {
    const pts = s.ys.map((y, i) => (y == null ? null : `${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`)).filter(Boolean);
    if (s.fill) svg += `<polygon points="${X(xs[0])},${H - B} ${pts.join(" ")} ${X(xs[xs.length - 1])},${H - B}" fill="${s.color}" fill-opacity=".15"/>`;
    svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  return svg + "</svg>";
}

// ------------------------------------------------------------------ interaction
function select(earthId, targetId, { pair = false } = {}) {
  if (earthId) state.earthId = earthId;
  if (targetId) state.targetId = targetId;
  if (pair) { // jump to the calibration partner of the picked site
    const p = state.data.pairs.find((p) => p.earth === earthId || p.target === targetId);
    if (p) { state.earthId = p.earth; state.targetId = p.target; }
  }
  if (!currentComparison()) {
    // the chosen Earth site and target have different types: switch the other side to its best match
    const best = targetId && !earthId
      ? bestComparison((c) => c.target === state.targetId)
      : bestComparison((c) => c.earth === state.earthId);
    if (best) { state.earthId = best.earth; state.targetId = best.target; }
    // else: an Earth site with no target of its type yet; renderPanel explains that
  }
  // never let the line contradict the side panel
  if (state.link && (state.link.earth !== state.earthId || state.link.target !== state.targetId)) {
    state.link = null;
    if (state.focus === "link") focusBody("all");
  }
  fillSelects();
  renderDims();
  renderPanel();
  buildPairLines();
  renderTopMatches();
  if (state.view === "compare") buildCompare(true);
}

function setView(v) {
  state.view = v;
  $("tab-globes").classList.toggle("active", v === "globes");
  $("tab-compare").classList.toggle("active", v === "compare");
  $("labels-globes").hidden = v !== "globes";
  $("labels-compare").hidden = v !== "compare";
  $("compare-controls").hidden = v !== "compare";
  $("body-switch").hidden = v !== "globes";
  globes.controls.enabled = v === "globes";
  cmp.controls.enabled = v === "compare";
  if (v === "compare") buildCompare(true);
  else $("stage-hint").textContent = globesHint();
}

document.querySelectorAll("#body-switch button").forEach((b) => {
  b.onclick = () => {
    focusBody(b.dataset.body);
    history.replaceState(null, "", b.dataset.body === "all" ? location.pathname : "#" + b.dataset.body);
  };
});

$("tab-globes").onclick = () => setView("globes");
$("tab-compare").onclick = () => setView("compare");
$("sel-earth").onchange = (ev) => select(ev.target.value, null);
$("sel-target").onchange = (ev) => select(null, ev.target.value);
$("exag").oninput = (ev) => { state.exag = +ev.target.value; $("exag-val").textContent = state.exag + "x"; buildCompare(false); };
$("indep").onchange = (ev) => { state.indep = ev.target.checked; buildCompare(false); };

const raycaster = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (ev) => { downAt = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener("pointerup", (ev) => {
  if (state.view !== "globes" || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, globes.camera);
  const hit = raycaster.intersectObjects(markers, false)[0];
  if (!hit) return;
  if (hit.object.userData.ref) { $("stage-hint").textContent = hit.object.userData.ref.text; return; }
  const site = state.data.sites[hit.object.userData.siteId];
  if (site.body === "earth") select(site.id, null, { pair: site.role === "analog" });
  else select(null, site.id, { pair: true });
  setView("compare");
});

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labelsGlobes.setSize(w, h);
  labelsCompare.setSize(w, h);
  for (const v of [globes, cmp]) { v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); }
}
addEventListener("resize", resize);
new ResizeObserver(() => resize()).observe(stage); // the stage width also changes with the side columns

function loop() {
  requestAnimationFrame(loop);
  if (state.view === "globes") {
    updateFlight(performance.now());
    globes.controls.update();
    updatePairLines();
    renderer.render(globes.scene, globes.camera);
    labelsGlobes.render(globes.scene, globes.camera);
  } else {
    cmp.controls.update();
    renderer.render(cmp.scene, cmp.camera);
    labelsCompare.render(cmp.scene, cmp.camera);
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const [resResults, resSuitability, resMoonSuitability] = await Promise.all([
      fetch("data/results.json"),
      fetch("data/suitability_scores.json").catch(() => null), // Earth absolute
      fetch("data/suitability_scores_moon_absolute.json").catch(() => null) // Moon absolute
    ]);
    if (!resResults.ok) throw new Error(resResults.status);
    state.data = await resResults.json();
    if (resSuitability && resSuitability.ok) {
      state.suitability = await resSuitability.json();
    }
    if (resMoonSuitability && resMoonSuitability.ok) {
      state.moonSuitability = await resMoonSuitability.json();
    }
  } catch {
    const el = $("error");
    el.hidden = false;
    el.innerHTML = `No results found.<br>Run <code>python scripts/fetch_dems.py</code> then <code>python scripts/analyze.py</code>,<br>
      and serve the site with <code>python -m http.server 8000 -d web</code> (opening the file directly will not work).`;
    return;
  }
  const j = (f) => fetch("data/" + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [md, ml, rd, rl] = await Promise.all([j("moon_data.json"), j("moon_landers.json"), j("mars_data.json"), j("mars_landers.json")]);
  const [mc, mv, mf] = await Promise.all([j("mars_candidates.json"), j("mars_caves.json"), j("mars_features.json")]);
  state.ref = { moon: { data: md, landers: ml }, mars: { data: rd, landers: rl, candidates: mc, caves: mv, features: mf } };
  // optional deep links: #moon, #mars, #earth, #compare[/<earthId>/<targetId>], #link/<earthId>/<targetId>
  const [view, hashEarth, hashTarget] = location.hash.slice(1).split("/");
  const first = state.data.pairs[0];
  state.earthId = state.data.sites[hashEarth] ? hashEarth : first.earth;
  state.targetId = state.data.sites[hashTarget] ? hashTarget : first.target;
  initDims();
  initPreset();
  initSources();
  if (!currentComparison()) { // link names an Earth site and a target of different types
    const best = bestComparison((c) => c.earth === state.earthId) || bestComparison((c) => c.target === state.targetId);
    if (best && state.data.sites[state.earthId].has_target !== false) { state.earthId = best.earth; state.targetId = best.target; }
  }
  resize();
  buildGlobes();
  focusBody(BODY[view] ? view : "all", false);
  fillSelects();
  renderPreset();
  renderDims();
  renderSourceFilter();
  renderPanel();
  renderTopMatches();
  setView(view === "compare" ? "compare" : "globes");
  if (view === "link" && state.data.sites[hashEarth] && state.data.sites[hashTarget]) {
    setLink({ earth: hashEarth, target: hashTarget });
    fitGlobesCamera(false);
  }
  loop();
}
boot();
