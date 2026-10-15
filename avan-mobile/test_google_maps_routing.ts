/**
 * Suite: Google Maps Platform (TASK-49 / TASK-51 / TASK-52).
 * Determinista: fetch simulado. No consume cuota ni requiere claves reales.
 */
import { decodePolyline, encodePolyline } from './src/utils/polylineDecoder';
import {
  mapGoogleManeuverToOrsType,
  parseRoutesApiResponse,
  geocodeDestination,
  getDisambiguationCandidates,
  getDirections,
  resetGoogleMapsCircuits,
  clearGoogleGeocodeCache,
  isGoogleApiAvailable,
} from './src/services/googleMapsService';

let total = 0;
let passed = 0;
function assert(cond: boolean, name: string, detail?: any) {
  total++;
  if (cond) {
    passed++;
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (detail !== undefined) console.error('   Detalle:', typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: any }> = [];
function mockFetch(handler: (url: string, init: any) => { status?: number; body: any } | 'throw') {
  calls = [];
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    if (r === 'throw') throw new Error('network down');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as any;
  };
}

const A = { latitude: 19.4326, longitude: -99.1332 };
const B = { latitude: 19.4352, longitude: -99.1412 };

// Ruta simulada con la forma real de Routes API
const seg1 = encodePolyline([{ latitude: 19.4326, longitude: -99.1332 }, { latitude: 19.4335, longitude: -99.1350 }]);
const seg2 = encodePolyline([{ latitude: 19.4335, longitude: -99.1350 }, { latitude: 19.4352, longitude: -99.1412 }]);
const ROUTES_RESPONSE = {
  routes: [
    {
      duration: '312s',
      distanceMeters: 1480,
      viewport: { low: { latitude: 19.4326, longitude: -99.1412 }, high: { latitude: 19.4352, longitude: -99.1332 } },
      polyline: { encodedPolyline: encodePolyline([A, B]) },
      legs: [
        {
          steps: [
            { distanceMeters: 220, staticDuration: '40s', polyline: { encodedPolyline: seg1 }, navigationInstruction: { maneuver: 'DEPART', instructions: 'Dirígete al <b>oeste</b> por <b>Av. Juárez</b>' } },
            { distanceMeters: 1260, staticDuration: '272s', polyline: { encodedPolyline: seg2 }, navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: 'Gira a la derecha en Eje Central' } },
          ],
        },
      ],
    },
  ],
};

async function run() {
  console.log('================================================================');
  console.log('🚀 SUITE: GOOGLE MAPS PLATFORM (TASK-49 / 51 / 52)');
  console.log('================================================================');

  // ---- GRUPO 1: polilínea ----
  console.log('\n--- GRUPO 1: Decodificador de polilíneas ---');
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert(pts.length === 3, 'Vector oficial de Google: 3 puntos', pts.length);
  assert(Math.abs(pts[0].latitude - 38.5) < 1e-5 && Math.abs(pts[0].longitude + 120.2) < 1e-5, 'Punto 1 = (38.5, -120.2)');
  assert(Math.abs(pts[2].latitude - 43.252) < 1e-5 && Math.abs(pts[2].longitude + 126.453) < 1e-5, 'Punto 3 = (43.252, -126.453)');
  const rt = decodePolyline(encodePolyline([A, B]));
  assert(Math.abs(rt[1].latitude - B.latitude) < 1e-5 && Math.abs(rt[1].longitude - B.longitude) < 1e-5, 'Ida y vuelta encode/decode (CDMX, lat/lng no invertidas)');
  assert(decodePolyline('').length === 0 && decodePolyline(null as any).length === 0, 'Entrada vacía/nula -> []');
  let threw = false;
  try {
    decodePolyline('_p~iF~ps|U_ulL');
    decodePolyline('!!!!');
  } catch {
    threw = true;
  }
  assert(!threw, 'Cadenas truncadas/corruptas no lanzan excepción');

  // ---- GRUPO 2: mapeo de maniobras ----
  console.log('\n--- GRUPO 2: Maniobras Google -> códigos ORS ---');
  const table: Array<[string, number]> = [
    ['TURN_LEFT', 0], ['TURN_RIGHT', 1], ['TURN_SHARP_LEFT', 2], ['TURN_SHARP_RIGHT', 3],
    ['TURN_SLIGHT_LEFT', 4], ['TURN_SLIGHT_RIGHT', 5], ['STRAIGHT', 6], ['ROUNDABOUT_RIGHT', 7],
    ['UTURN_LEFT', 9], ['DEPART', 11], ['KEEP_LEFT', 12], ['KEEP_RIGHT', 13], ['MANEUVER_UNSPECIFIED', 6],
  ];
  for (const [g, o] of table) assert(mapGoogleManeuverToOrsType(g) === o, `${g} -> ${o}`);

  // ---- GRUPO 3: parseo de ruta ----
  console.log('\n--- GRUPO 3: parseRoutesApiResponse ---');
  const route = parseRoutesApiResponse(ROUTES_RESPONSE)!;
  assert(!!route && route.coordinates.length >= 2, 'Ruta válida con polilínea');
  assert(route.distance === 1480 && route.duration === 312, 'Distancia y duración (con tráfico) correctas');
  assert(route.steps[0].type === 11, 'Primer paso es de SALIDA (tipo 11), nunca llegada');
  assert(!/ha llegado/i.test(route.steps[0].instruction), 'Primera instrucción no es la de llegada');
  assert(route.steps[route.steps.length - 1].type === 10, 'Último paso es llegada (tipo 10), igual que ORS');
  assert(!/[<>]/.test(route.steps[0].instruction), 'HTML eliminado de las instrucciones', route.steps[0].instruction);
  assert(route.steps[1].type === 1, 'TURN_RIGHT -> tipo 1');
  const dup = route.coordinates.filter((c, i) => i > 0 && c.latitude === route.coordinates[i - 1].latitude && c.longitude === route.coordinates[i - 1].longitude);
  assert(dup.length === 0, 'Sin puntos duplicados en la unión entre pasos');
  assert(route.steps.every((s) => s.wayPoints[0] <= s.wayPoints[1] && s.wayPoints[1] < route.coordinates.length), 'wayPoints dentro de rango');
  assert(Array.isArray(route.bbox) && route.bbox![0] < route.bbox![2], 'bbox [minLng,minLat,maxLng,maxLat]');
  assert(parseRoutesApiResponse({}) === null && parseRoutesApiResponse({ routes: [] }) === null, 'Respuesta sin rutas -> null');

  // ---- GRUPO 4: llamadas HTTP ----
  console.log('\n--- GRUPO 4: Llamadas a Routes / Places / Geocoding (fetch simulado) ---');
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'gkey';
  resetGoogleMapsCircuits();
  clearGoogleGeocodeCache();

  mockFetch(() => ({ body: ROUTES_RESPONSE }));
  const r = await getDirections(A, B);
  const body = JSON.parse(calls[0].init.body);
  assert(!!r && r.coordinates.length >= 2, 'getDirections devuelve RouteResult');
  assert(calls[0].url.startsWith('https://routes.googleapis.com/directions/v2:computeRoutes'), 'Usa Routes API (no la Directions legacy)');
  assert(body.travelMode === 'DRIVE' && body.routingPreference === 'TRAFFIC_AWARE', 'DRIVE + TRAFFIC_AWARE (tráfico en vivo)');
  assert(body.languageCode === 'es-MX', 'Instrucciones en es-MX');
  assert(body.origin.location.latLng.latitude === A.latitude && body.destination.location.latLng.longitude === B.longitude, 'lat/lng en orden correcto');
  assert(calls[0].init.headers['X-Goog-Api-Key'] === 'gkey' && !calls[0].url.includes('gkey'), 'Clave por cabecera, no en URL');
  assert(String(calls[0].init.headers['X-Goog-FieldMask']).includes('routes.legs.steps.navigationInstruction'), 'FieldMask incluye maniobras');

  clearGoogleGeocodeCache();
  mockFetch((url) =>
    url.includes('places.googleapis.com')
      ? {
          body: {
            places: [
              { id: 'p1', displayName: { text: 'Farmacia San Pablo' }, formattedAddress: 'Av. Insurgentes Sur 100, Roma Norte, CDMX', location: { latitude: 19.42, longitude: -99.16 }, addressComponents: [{ types: ['sublocality_level_1'], longText: 'Roma Norte', long_name: 'Roma Norte' }] },
              { id: 'p2', displayName: { text: 'Farmacia San Pablo' }, formattedAddress: 'Calle Hidalgo 5, Coyoacán, CDMX', location: { latitude: 19.35, longitude: -99.16 }, addressComponents: [{ types: ['sublocality_level_1'], long_name: 'Coyoacán' }] },
            ],
          },
        }
      : { body: {} }
  );
  const places = await geocodeDestination('Farmacia San Pablo', A);
  assert(Array.isArray(places) && places!.length === 2, 'Places API (New): 2 resultados');
  assert(calls[0].url === 'https://places.googleapis.com/v1/places:searchText', 'Endpoint Places API (New)');
  assert(JSON.parse(calls[0].init.body).regionCode === 'MX', 'regionCode MX + locationBias');
  assert(places![0].coordinates.latitude === 19.42, 'Coordenadas lat/lng no invertidas');

  clearGoogleGeocodeCache();
  const dis = await getDisambiguationCandidates('Farmacia San Pablo', A, 3);
  assert(!!dis && dis!.isAmbiguous === true && dis!.candidates.length === 2, 'Homónimos separados >2.5 km -> ambiguo con 2 candidatos');
  assert(dis!.candidates.every((c) => !!c.colonia_o_alcaldia), 'Cada candidato trae colonia/alcaldía');

  clearGoogleGeocodeCache();
  mockFetch(() => ({ body: { status: 'OK', results: [{ place_id: 'g1', formatted_address: 'Sonora 120, Roma Norte, 06700 CDMX', geometry: { location: { lat: 19.4145, lng: -99.1675 }, location_type: 'ROOFTOP' } }] } }));
  const addr = await geocodeDestination({ street: 'Sonora', houseNumber: '120', colonia: 'Condesa', rawQuery: 'Sonora 120, Condesa' }, A);
  assert(addr![0].precision === 'exact', 'ROOFTOP -> precisión "exact"');
  assert(calls[0].url.startsWith('https://maps.googleapis.com/maps/api/geocode/json') && calls[0].url.includes('country%3AMX'), 'Dirección con número -> Geocoding API restringida a MX');

  // ---- GRUPO 5: errores ----
  console.log('\n--- GRUPO 5: Errores y circuit breaker ---');
  resetGoogleMapsCircuits();
  clearGoogleGeocodeCache();
  mockFetch((url) =>
    url.includes('places.googleapis.com')
      ? { status: 403, body: { error: { message: 'Places API (New) has not been used' } } }
      : { body: { status: 'REQUEST_DENIED', error_message: 'API not enabled' } }
  );
  const denied = await geocodeDestination({ street: 'Reforma', houseNumber: '222', rawQuery: 'Reforma 222' }, A);
  assert(denied === null, 'REQUEST_DENIED (HTTP 200) -> null para que el adaptador use ORS');
  assert(!isGoogleApiAvailable('geocode'), 'REQUEST_DENIED abre el circuito de Geocoding');

  resetGoogleMapsCircuits();
  mockFetch(() => ({ status: 403, body: { error: { message: 'Routes API has not been used' } } }));
  assert((await getDirections(A, B)) === null, 'Routes API 403 -> null');
  assert(!isGoogleApiAvailable('routes') && isGoogleApiAvailable('places'), 'El circuito es por API (Places sigue disponible)');
  const callsBefore = calls.length;
  await getDirections(A, B);
  assert(calls.length === callsBefore, 'Circuito abierto: no se reintenta la red');

  resetGoogleMapsCircuits();
  mockFetch(() => ({ body: { routes: [] } }));
  assert((await getDirections(A, B)) === null, 'Ruta vacía -> null');

  delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  mockFetch(() => ({ body: {} }));
  assert((await getDirections(A, B)) === null && calls.length === 0, 'Sin clave: null sin tocar la red');

  (globalThis as any).fetch = realFetch;
  console.log('\n================================================================');
  console.log(`📊 RESULTADO GOOGLE MAPS: ${passed}/${total} pruebas superadas`);
  console.log('================================================================');
  process.exit(passed === total ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
