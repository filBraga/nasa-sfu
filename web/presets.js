/** Operation-focused analog screening. Selections are provisional, not NASA requirements.
 * Existing metric/category weights and similarity tolerances remain unchanged.
 */
const sources = {
  rover: { label: 'NASA: VIPER lunar operations', url: 'https://science.nasa.gov/mission/viper/lunar-operations/' },
  eva: { label: 'NASA: EVA integrated concept of operations', url: 'https://ntrs.nasa.gov/citations/20240011450' },
  landing: { label: 'NASA: landing-region selection considerations', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/' },
  radar: { label: 'NASA: RIMFAX subsurface radar', url: 'https://science.nasa.gov/blog/searching-for-buried-treasure-on-mars-with-rimfax/' },
  surface: { label: 'NASA: lunar surface technology', url: 'https://www.nasa.gov/lunar-surface-technology/' },
  comms: { label: 'NASA: surface communications and terrain', url: 'https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/' },
};

export const OPERATION_PRESETS = [
  {
    id: 'rover', label: 'Robot / rover traverse',
    metrics: ['slope', 'roughness', 'flat_fraction', 'cold', 'thermal_amplitude', 'surface_dust', 'barren_ground'],
    considers: 'Compare traversability, thermal environment, fine-material proxies and vegetation-free ground for a robot field trial.',
    unmeasured: 'Wheel-scale rocks, soil bearing strength, traction, route connectivity, vehicle limits, power and communications.',
    sources: [sources.rover, sources.comms],
  },
  {
    id: 'eva', label: 'Astronaut EVA traverse',
    metrics: ['slope', 'roughness', 'cold', 'thermal_amplitude', 'surface_dust', 'barren_ground'],
    considers: 'Compare walking terrain and environmental exposure for EVA analog training.',
    unmeasured: 'Suit limits, metabolic workload, route length, emergency return time, radiation, time-dependent lighting and communications.',
    sources: [sources.eva, sources.landing],
  },
  {
    id: 'landing', label: 'Landing-site terrain',
    metrics: ['slope', 'roughness', 'flat_fraction', 'surface_dust', 'barren_ground'],
    considers: 'Compare terrain and surface context relevant to landing-site analog tests.',
    unmeasured: 'Lander-scale obstacles, bearing strength, landing ellipse, navigation, plume erosion, launch timing, lighting and communications. Coarse terrain cannot resolve landing hazards.',
    sources: [sources.landing, sources.surface],
  },
  {
    id: 'radar', label: 'Ground-penetrating radar survey',
    metrics: ['slope', 'roughness', 'cold', 'thermal_amplitude', 'barren_ground'],
    considers: 'Compare survey-platform terrain access and thermal conditions. Orbital radar CPR is not a radar-deployment suitability measurement.',
    unmeasured: 'Subsurface layering, dielectric permittivity, conductivity, radar attenuation, antenna coupling, frequency, survey geometry and instrument power.',
    sources: [sources.radar, sources.rover],
  },
  {
    id: 'excavation', label: 'Excavation / regolith sampling',
    metrics: ['slope', 'roughness', 'flat_fraction', 'cold', 'thermal_amplitude', 'surface_dust', 'barren_ground'],
    considers: 'Compare worksite access, thermal conditions and surface proxies for digging or sampling trials.',
    unmeasured: 'Regolith strength, cohesion, grain-size distribution, buried rocks, excavation depth, volatile abundance and tool forces. Fine-material proxies do not measure diggability.',
    sources: [sources.surface, sources.rover],
  },
  {
    id: 'habitat', label: 'Habitat / surface worksite',
    metrics: ['slope', 'roughness', 'flat_fraction', 'cold', 'thermal_amplitude', 'surface_dust', 'barren_ground'],
    considers: 'Compare construction terrain and environmental exposure for a surface-worksite analog.',
    unmeasured: 'Foundation strength, radiation shielding, seismic hazards, logistics, resources, long-term power and communications.',
    sources: [sources.surface, sources.comms],
  },
  {
    id: 'solar', label: 'Solar equipment deployment',
    metrics: ['slope', 'roughness', 'flat_fraction', 'illumination', 'cold', 'thermal_amplitude', 'surface_dust', 'barren_ground'],
    considers: 'Compare installation terrain, thermal exposure and the existing low-Sun terrain-shadow proxy where applicable.',
    unmeasured: 'Seasonal illumination, night duration, solar irradiance, panel orientation, energy storage, electrical load and dust deposition. The fixed low-Sun proxy cannot predict power yield.',
    sources: [sources.rover, sources.surface],
  },
];

export const findPreset = id => OPERATION_PRESETS.find(p => p.id === id) || null;

// Keep missing measurements selected so they reduce evidence coverage as usual.
// Target-type exclusions and Moon dust exclusions remain the aggregator's responsibility.
export function presetDimensions(id, dimensions) {
  const preset = findPreset(id);
  if (!preset) throw new Error(`Unknown operation preset: ${id}`);
  for (const key of preset.metrics) {
    if (!dimensions[key]) throw new Error(`Preset ${id} requires unknown dimension: ${key}`);
  }
  return new Set(preset.metrics);
}
