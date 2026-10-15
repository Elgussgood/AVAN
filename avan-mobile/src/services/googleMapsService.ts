/**
 * Servicio de Google Maps Platform para AVAN (Fase 5 / TASK-49 y TASK-51).
 *
 * Usa las APIs vigentes (las "legacy" Directions/Places no se pueden habilitar
 * en proyectos nuevos desde marzo de 2025):
 *  - Routes API        (routes.googleapis.com/directions/v2:computeRoutes) -> ruta con tráfico en vivo
 *  - Places API (New)  (places.googleapis.com/v1/places:searchText)        -> negocios / POIs
 *  - Geocoding API     (maps.googleapis.com/maps/api/geocode/json)         -> direcciones con número
 *
 * Contrato: las funciones devuelven `null` ante CUALQUIER fallo (sin clave,
 * cuota, red, API no habilitada, respuesta inválida) y `[]`/resultado vacío sólo
 * cuando Google responde correctamente sin coincidencias. El adaptador
 * (routingAdapter.ts) usa `null` para conmutar a OpenRouteService.
 */

import {
  Coordinates,
  GeocodeResult,
  GeocodePrecision,
  DisambiguationCandidate,
  DisambiguationResult,
  RouteResult,
  StepInstruction,
  StructuredAddressQuery,
  computeDistanceMeters,
  findNearestLandmark,
  extractZoneFromLabel,
  parseStructuredAddress,
} from './orsService';
import { decodePolyline } from '../utils/polylineDecoder';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

const GEOCODE_TIMEOUT_MS = 3500;
const ROUTES_TIMEOUT_MS = 5000;
const CDMX_CENTER: Coordinates = { latitude: 19.4326, longitude: -99.1332 };

// ----------------------------------------------------------------------------
// Clave y circuit breaker por API (una API no habilitada no debe bloquear a las otras)
// ----------------------------------------------------------------------------

export function getGoogleMapsApiKey(): string | null {
  const key = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
  return key.length > 0 ? key : null;
}

export function isGoogleMapsConfigured(): boolean {
  return getGoogleMapsApiKey() !== null;
}

type ApiName = 'routes' | 'places' | 'geocode';
const breakerUntil: Record<ApiName, number> = { routes: 0, places: 0, geocode: 0 };
const failureCount: Record<ApiName, number> = { routes: 0, places: 0, geocode: 0 };

export function isGoogleApiAvailable(api: ApiName, now: number = Date.now()): boolean {
  return getGoogleMapsApiKey() !== null && now >= breakerUntil[api];
}

export function resetGoogleMapsCircuits(): void {
  (Object.keys(breakerUntil) as ApiName[]).forEach((k) => {
    breakerUntil[k] = 0;
    failureCount[k] = 0;
  });
}

function registerFailure(api: ApiName, status?: number): void {
  failureCount[api] += 1;
  if (status === 429) breakerUntil[api] = Date.now() + 60_000; // cuota
  else if (status === 400 || status === 401 || status === 403 || status === 404) {
    breakerUntil[api] = Date.now() + 10 * 60_000; // clave inválida / API no habilitada / restricción
  } else if (failureCount[api] >= 3) breakerUntil[api] = Date.now() + 30_000;
}

async function fetchJson(
  api: ApiName,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<any | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.error_message || '';
      } catch {}
      console.warn(`[googleMapsService] ${api} respondió ${response.status}${detail ? `: ${detail}` : ''}`);
      registerFailure(api, response.status);
      return null;
    }
    const data = await response.json();
    failureCount[api] = 0;
    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.warn(`[googleMapsService] ${api} falló:`, error?.name === 'AbortError' ? 'timeout' : error?.message || error);
    registerFailure(api);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Caché de geocodificación (en memoria, TTL 10 min) - ahorra cuota
// ----------------------------------------------------------------------------
const geocodeCache = new Map<string, { data: GeocodeResult[]; ts: number }>();
const GEOCODE_CACHE_TTL = 10 * 60_000;

function cacheKey(text: string, loc?: Coordinates): string {
  const bucket = loc ? `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}` : 'none';
  return `${text.toLowerCase().trim()}|${bucket}`;
}

export function clearGoogleGeocodeCache(): void {
  geocodeCache.clear();
}

// ----------------------------------------------------------------------------
// Geocodificación
// ----------------------------------------------------------------------------

function buildQueryText(structured: StructuredAddressQuery): string {
  return (
    structured.rawQuery ||
    [structured.street, structured.houseNumber, structured.colonia, structured.alcaldia, structured.city]
      .filter(Boolean)
      .join(', ')
  ).trim();
}

function mapLocationType(locationType?: string): GeocodePrecision {
  switch (locationType) {
    case 'ROOFTOP':
      return 'exact';
    case 'RANGE_INTERPOLATED':
      return 'interpolated';
    case 'GEOMETRIC_CENTER':
      return 'street';
    default:
      return 'approximate';
  }
}

function zoneFromComponents(components: any[] | undefined): string | undefined {
  if (!Array.isArray(components)) return undefined;
  const find = (type: string) =>
    components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const comp =
    find('sublocality_level_1') || find('sublocality') || find('neighborhood') || find('administrative_area_level_3');
  return comp?.long_name || comp?.longText || undefined;
}

async function placesTextSearch(text: string, bias: Coordinates): Promise<GeocodeResult[] | null> {
  if (!isGoogleApiAvailable('places')) return null;
  const data = await fetchJson(
    'places',
    PLACES_SEARCH_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getGoogleMapsApiKey() as string,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents',
      },
      body: JSON.stringify({
        textQuery: text,
        languageCode: 'es',
        regionCode: 'MX',
        maxResultCount: 5,
        locationBias: { circle: { center: { latitude: bias.latitude, longitude: bias.longitude }, radius: 50000 } },
      }),
    },
    GEOCODE_TIMEOUT_MS
  );
  if (!data) return null;

  const places: any[] = Array.isArray(data.places) ? data.places : [];
  return places
    .filter((p) => typeof p?.location?.latitude === 'number' && typeof p?.location?.longitude === 'number')
    .map((p, i) => {
      const name = p.displayName?.text || p.formattedAddress || text;
      const zone = zoneFromComponents(p.addressComponents);
      const address = p.formattedAddress || name;
      return {
        id: p.id || `gplace_${i}`,
        name,
        label: zone && !address.includes(zone) ? `${name}, ${zone}` : address === name ? name : `${name}, ${address}`,
        coordinates: { latitude: p.location.latitude, longitude: p.location.longitude },
        precision: 'exact' as GeocodePrecision,
      };
    });
}

async function geocodingApiSearch(text: string, bias: Coordinates): Promise<GeocodeResult[] | null> {
  if (!isGoogleApiAvailable('geocode')) return null;
  const d = 0.5; // ~55 km de sesgo alrededor del usuario
  const params = [
    `address=${encodeURIComponent(text)}`,
    `components=${encodeURIComponent('country:MX')}`,
    `bounds=${encodeURIComponent(`${bias.latitude - d},${bias.longitude - d}|${bias.latitude + d},${bias.longitude + d}`)}`,
    'language=es',
    `key=${encodeURIComponent(getGoogleMapsApiKey() as string)}`,
  ].join('&');

  const data = await fetchJson('geocode', `${GEOCODE_URL}?${params}`, { method: 'GET' }, GEOCODE_TIMEOUT_MS);
  if (!data) return null;

  if (data.status === 'ZERO_RESULTS') return [];
  if (data.status !== 'OK') {
    // REQUEST_DENIED / OVER_QUERY_LIMIT / API no habilitada llegan con HTTP 200 en este endpoint
    console.warn(`[googleMapsService] Geocoding status ${data.status}: ${data.error_message || ''}`);
    registerFailure('geocode', data.status === 'OVER_QUERY_LIMIT' ? 429 : 403);
    return null;
  }

  return (data.results || [])
    .filter((r: any) => typeof r?.geometry?.location?.lat === 'number')
    .slice(0, 5)
    .map((r: any, i: number) => ({
      id: r.place_id || `ggeo_${i}`,
      name: (r.formatted_address || text).split(',')[0],
      label: r.formatted_address || text,
      coordinates: { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng },
      precision: mapLocationType(r.geometry.location_type),
    }));
}

function sortByProximity(results: GeocodeResult[], loc?: Coordinates): GeocodeResult[] {
  const withDist = results.map((r) => ({
    ...r,
    distanceMeters: loc ? computeDistanceMeters(loc, r.coordinates) : undefined,
  }));
  return withDist; // Google ya ordena por relevancia con locationBias; se conserva ese orden
}

/**
 * Geocodifica un destino. `null` = fallo de Google (usar fallback); `[]` = sin coincidencias.
 */
export async function geocodeDestination(
  query: string | StructuredAddressQuery,
  userLocation?: Coordinates
): Promise<GeocodeResult[] | null> {
  if (!isGoogleMapsConfigured()) return null;

  const structured = parseStructuredAddress(query);
  const text = buildQueryText(structured);
  if (!text) return [];

  const key = cacheKey(text, userLocation);
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.ts < GEOCODE_CACHE_TTL) return cached.data;

  const bias = userLocation || CDMX_CENTER;
  const isStreetAddress = Boolean(structured.street && structured.houseNumber);

  // Direcciones con número -> Geocoding (interpolación a nivel de portal); resto -> Places
  const primary = isStreetAddress ? geocodingApiSearch : placesTextSearch;
  const secondary = isStreetAddress ? placesTextSearch : geocodingApiSearch;

  let results = await primary(text, bias);
  if (results === null || results.length === 0) {
    const second = await secondary(text, bias);
    if (second && second.length > 0) results = second;
    else if (results === null) results = second; // ambos fallaron -> null; uno vacío -> []
  }

  if (results === null) return null;
  const final = sortByProximity(results, userLocation);
  geocodeCache.set(key, { data: final, ts: Date.now() });
  if (geocodeCache.size > 100) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest !== undefined) geocodeCache.delete(oldest);
  }
  return final;
}

/**
 * Candidatos de desambiguación (TASK-51): hasta `maxCandidates`, sin duplicados
 * (<1 km) y enriquecidos con zona/colonia y punto de referencia cercano.
 */
export async function getDisambiguationCandidates(
  query: string | StructuredAddressQuery,
  userLocation?: Coordinates,
  maxCandidates = 3
): Promise<DisambiguationResult | null> {
  const raw = await geocodeDestination(query, userLocation);
  if (raw === null) return null;
  if (raw.length === 0) return { isAmbiguous: false, candidates: [] };

  const unique: GeocodeResult[] = [];
  for (const r of raw) {
    if (!unique.some((u) => computeDistanceMeters(u.coordinates, r.coordinates) < 1000)) unique.push(r);
  }

  const toCandidate = (r: GeocodeResult): DisambiguationCandidate => {
    const landmark = findNearestLandmark(r.coordinates);
    return {
      id: r.id,
      name: r.name,
      label: r.label,
      colonia_o_alcaldia: extractZoneFromLabel(r.label),
      landmarkRef: landmark?.name,
      landmarkType: landmark?.type,
      coordinates: r.coordinates,
      distanceMeters: userLocation ? computeDistanceMeters(userLocation, r.coordinates) : undefined,
      precision: r.precision,
    };
  };

  if (unique.length <= 1) {
    return { isAmbiguous: false, candidates: [toCandidate(unique[0] || raw[0])] };
  }

  let maxSeparation = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      maxSeparation = Math.max(maxSeparation, computeDistanceMeters(unique[i].coordinates, unique[j].coordinates));
    }
  }

  return {
    isAmbiguous: maxSeparation > 2500,
    candidates: unique.slice(0, maxCandidates).map(toCandidate),
  };
}

// ----------------------------------------------------------------------------
// Rutas (Routes API) -> RouteResult con códigos de maniobra compatibles con ORS
// ----------------------------------------------------------------------------

/** Códigos de maniobra de ORS que consume navigationService (0 izq, 1 der, ..., 10 llegada, 11 salida). */
export function mapGoogleManeuverToOrsType(maneuver?: string): number {
  switch (maneuver) {
    case 'TURN_LEFT':
      return 0;
    case 'TURN_RIGHT':
      return 1;
    case 'TURN_SHARP_LEFT':
      return 2;
    case 'TURN_SHARP_RIGHT':
      return 3;
    case 'TURN_SLIGHT_LEFT':
      return 4;
    case 'TURN_SLIGHT_RIGHT':
      return 5;
    case 'ROUNDABOUT_LEFT':
    case 'ROUNDABOUT_RIGHT':
      return 7;
    case 'UTURN_LEFT':
    case 'UTURN_RIGHT':
      return 9;
    case 'KEEP_LEFT':
    case 'FORK_LEFT':
    case 'RAMP_LEFT':
      return 12;
    case 'KEEP_RIGHT':
    case 'FORK_RIGHT':
    case 'RAMP_RIGHT':
      return 13;
    case 'DEPART':
      return 11;
    default:
      return 6; // STRAIGHT, MERGE, NAME_CHANGE, FERRY_*, MANEUVER_UNSPECIFIED
  }
}

function stripHtml(text: string): string {
  return (text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'string') return Math.round(parseFloat(value.replace('s', '')) || 0);
  if (typeof value === 'number') return Math.round(value);
  return 0;
}

function streetNameFromInstruction(instruction: string): string {
  const match = instruction.match(/\b(?:en|por|hacia|sobre|a)\s+((?:[A-ZÁÉÍÓÚÑ0-9].*))$/);
  return match ? match[1].trim() : '';
}

/**
 * Convierte la respuesta de computeRoutes en el RouteResult interno.
 * Exportada para pruebas unitarias sin red.
 */
export function parseRoutesApiResponse(data: any): RouteResult | null {
  const route = data?.routes?.[0];
  if (!route) return null;

  const rawSteps: any[] = route.legs?.flatMap((leg: any) => leg.steps || []) || [];
  const coordinates: Coordinates[] = [];
  const steps: StepInstruction[] = [];

  for (const step of rawSteps) {
    const pts = decodePolyline(step.polyline?.encodedPolyline || '');
    // Evitar duplicar el punto de unión entre pasos consecutivos
    const startIdx = coordinates.length > 0 ? Math.max(coordinates.length - 1, 0) : 0;
    pts.forEach((p, i) => {
      if (i === 0 && coordinates.length > 0) {
        const last = coordinates[coordinates.length - 1];
        if (last.latitude === p.latitude && last.longitude === p.longitude) return;
      }
      coordinates.push(p);
    });
    const endIdx = Math.max(coordinates.length - 1, startIdx);

    const nav = step.navigationInstruction || {};
    const maneuver: string | undefined = nav.maneuver;
    let instruction = stripHtml(nav.instructions || '');
    const isFirst = steps.length === 0;
    let type = mapGoogleManeuverToOrsType(maneuver);
    if (isFirst && (!maneuver || maneuver === 'MANEUVER_UNSPECIFIED' || maneuver === 'DEPART')) type = 11;
    if (!instruction) instruction = isFirst ? 'Inicie su recorrido' : 'Continúe recto';

    steps.push({
      instruction,
      distance: step.distanceMeters || 0,
      duration: parseDurationSeconds(step.staticDuration),
      type,
      name: streetNameFromInstruction(instruction),
      wayPoints: [startIdx, endIdx],
    });
  }

  // Si no vinieron pasos con polilínea, usar la polilínea general de la ruta
  if (coordinates.length < 2) {
    const overview = decodePolyline(route.polyline?.encodedPolyline || '');
    if (overview.length < 2) return null;
    coordinates.length = 0;
    coordinates.push(...overview);
  }

  if (steps.length === 0) {
    steps.push({
      instruction: 'Inicie su recorrido',
      distance: route.distanceMeters || 0,
      duration: parseDurationSeconds(route.duration),
      type: 11,
      name: '',
      wayPoints: [0, coordinates.length - 1],
    });
  }

  // Paso terminal estilo ORS (tipo 10) para que la lógica de llegada/anuncios sea idéntica
  const lastIdx = coordinates.length - 1;
  steps.push({
    instruction: 'Ha llegado a su destino',
    distance: 0,
    duration: 0,
    type: 10,
    name: '',
    wayPoints: [lastIdx, lastIdx],
  });

  const viewport = route.viewport;
  const bbox: [number, number, number, number] | undefined =
    viewport?.low && viewport?.high
      ? [viewport.low.longitude, viewport.low.latitude, viewport.high.longitude, viewport.high.latitude]
      : undefined;

  return {
    coordinates,
    distance: route.distanceMeters || 0,
    duration: parseDurationSeconds(route.duration),
    steps,
    bbox,
    isFallback: false,
  };
}

/** Ruta vehicular con tráfico en vivo. `null` = fallo de Google (usar fallback). */
export async function getDirections(start: Coordinates, destination: Coordinates): Promise<RouteResult | null> {
  if (!isGoogleApiAvailable('routes')) return null;

  const data = await fetchJson(
    'routes',
    ROUTES_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getGoogleMapsApiKey() as string,
        'X-Goog-FieldMask': [
          'routes.duration',
          'routes.distanceMeters',
          'routes.viewport',
          'routes.polyline.encodedPolyline',
          'routes.legs.steps.distanceMeters',
          'routes.legs.steps.staticDuration',
          'routes.legs.steps.polyline.encodedPolyline',
          'routes.legs.steps.navigationInstruction',
        ].join(','),
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: start.latitude, longitude: start.longitude } } },
        destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'ENCODED_POLYLINE',
        languageCode: 'es-MX',
        units: 'METRIC',
      }),
    },
    ROUTES_TIMEOUT_MS
  );
  if (!data) return null;

  const parsed = parseRoutesApiResponse(data);
  if (!parsed || parsed.coordinates.length < 2) {
    console.warn('[googleMapsService] Routes API devolvió una ruta inválida o vacía');
    registerFailure('routes');
    return null;
  }

  console.log(
    `[googleMapsService] Ruta Google calculada: ${(parsed.distance / 1000).toFixed(2)} km, ${parsed.coordinates.length} puntos, ${Math.round(parsed.duration / 60)} min con tráfico.`
  );
  return parsed;
}

export const googleMapsService = {
  geocodeDestination,
  getDisambiguationCandidates,
  getDirections,
  isConfigured: isGoogleMapsConfigured,
};
