/** Lazy-load country-state-city so Signup can paint before the dataset is ready. */

type GeoModule = typeof import('country-state-city');

let geoModulePromise: Promise<GeoModule> | null = null;
let countriesCache: ReturnType<GeoModule['Country']['getAllCountries']> | null = null;

export function loadGeoModule(): Promise<GeoModule> {
  if (!geoModulePromise) {
    geoModulePromise = import('country-state-city');
  }
  return geoModulePromise;
}

export async function getAllCountriesSorted() {
  const mod = await loadGeoModule();
  if (!countriesCache) {
    countriesCache = mod.Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
  }
  return countriesCache;
}

export async function defaultCountryIso() {
  const countries = await getAllCountriesSorted();
  return countries.find((c) => c.isoCode === 'IN')?.isoCode || countries[0]?.isoCode || '';
}
