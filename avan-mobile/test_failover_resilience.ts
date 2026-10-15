/**
 * Suite: Resiliencia y failover multicapa (TASK-48 / TASK-49 / TASK-52).
 * Gemini -> Groq -> motor local;  Google Maps -> OpenRouteService.
 * Determinista: fetch simulado.
 */
import { ConversationService } from './src/services/conversationService';
import { resetGeminiCircuit } from './src/services/geminiService';
import { resetGoogleMapsCircuits, clearGoogleGeocodeCache } from './src/services/googleMapsService';
import { routingService } from './src/services/routingAdapter';
import { encodePolyline } from './src/utils/polylineDecoder';

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
let calls: string[] = [];
type Handler = (url: string, init: any) => { status?: number; body: any } | 'throw';
function mockFetch(handler: Handler) {
  calls = [];
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push(String(url));
    const r = handler(String(url), init);
    if (r === 'throw') throw new Error('network down');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as any;
  };
}

const isGemini = (u: string) => u.includes('generativelanguage.googleapis.com');
const isGroq = (u: string) => u.includes('api.groq.com');

const geminiTool = (name: string, args: any) => ({
  candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
});
const groqTool = (name: string, args: any) => ({
  choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const A = { latitude: 19.4326, longitude: -99.1332 };
const B = { latitude: 19.4352, longitude: -99.1412 };

async function run() {
  console.log('================================================================');
  console.log('🚀 SUITE: RESILIENCIA Y FAILOVER (TASK-52)');
  console.log('================================================================');

  // ---- GRUPO 1: cascada NLU ----
  console.log('\n--- GRUPO 1: Cascada NLU Gemini -> Groq -> local ---');
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'gem';
  process.env.EXPO_PUBLIC_GROQ_API_KEY = 'groq';

  resetGeminiCircuit();
  mockFetch((u) => (isGemini(u) ? { body: geminiTool('ajustar_zoom', { direccion: 'alejar', intensidad: 'poco' }) } : { status: 500, body: {} }));
  let res = await ConversationService.processUserMessage('aleja un poquito el mapa');
  assert(res.functionCall?.name === 'ajustar_zoom', 'Nivel 1: Gemini resuelve ajustar_zoom');
  assert((res.functionCall?.args as any)?.direccion === 'alejar' && (res.functionCall?.args as any)?.intensidad === 'poco', 'Argumentos de Gemini llegan intactos al flujo existente');
  assert(!calls.some(isGroq), 'Si Gemini responde, Groq NO se consulta');

  resetGeminiCircuit();
  mockFetch((u) => (isGemini(u) ? { status: 500, body: {} } : { body: groqTool('ajustar_zoom', { direccion: 'acercar', intensidad: 'mucho' }) }));
  res = await ConversationService.processUserMessage('acerca mucho el mapa');
  assert(calls.some(isGemini) && calls.some(isGroq), 'Nivel 2: Gemini falla (500) -> se consulta Groq');
  assert(res.functionCall?.name === 'ajustar_zoom' && (res.functionCall?.args as any)?.intensidad === 'mucho', 'Groq resuelve correctamente tras el fallo de Gemini');

  resetGeminiCircuit();
  mockFetch((u) => (isGemini(u) ? { status: 429, body: {} } : { body: groqTool('cancelar', {}) }));
  await ConversationService.processUserMessage('cancela');
  const geminiCallsAfter429 = calls.filter(isGemini).length;
  await ConversationService.processUserMessage('cancela otra vez');
  assert(calls.filter(isGemini).length === geminiCallsAfter429, 'Tras un 429, los turnos siguientes saltan Gemini directo a Groq (sin latencia extra)');

  resetGeminiCircuit();
  mockFetch(() => 'throw');
  res = await ConversationService.processUserMessage('acerca mucho el mapa');
  assert(res.functionCall?.name === 'ajustar_zoom', 'Nivel 3: sin red, el motor local offline resuelve el zoom');
  assert((res.functionCall?.args as any)?.direccion === 'acercar' && (res.functionCall?.args as any)?.intensidad === 'mucho', 'Motor local conserva dirección e intensidad');
  assert(typeof res.spokenText === 'string' && res.spokenText.length > 0, 'Siempre hay respuesta hablada (nunca silencio)');

  resetGeminiCircuit();
  mockFetch(() => 'throw');
  res = await ConversationService.processUserMessage('centrar mapa');
  assert((res.functionCall?.args as any)?.direccion === 'centrar', 'Sin red: "centrar mapa" sigue funcionando');

  // Sin ninguna clave
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  delete process.env.EXPO_PUBLIC_GROQ_API_KEY;
  mockFetch(() => ({ body: {} }));
  res = await ConversationService.processUserMessage('aleja un poco');
  assert(!calls.some((u) => isGemini(u) || isGroq(u)), 'Sin claves: ni Gemini ni Groq se consultan');
  assert(res.functionCall?.name === 'ajustar_zoom', 'Sin claves: motor local responde');

  // ---- GRUPO 2: ruteo Google -> ORS ----
  console.log('\n--- GRUPO 2: Ruteo Google Maps -> OpenRouteService ---');
  const routesBody = {
    routes: [{
      duration: '100s', distanceMeters: 900,
      polyline: { encodedPolyline: encodePolyline([A, B]) },
      legs: [{ steps: [{ distanceMeters: 900, staticDuration: '100s', polyline: { encodedPolyline: encodePolyline([A, B]) }, navigationInstruction: { maneuver: 'DEPART', instructions: 'Dirígete al oeste' } }] }],
    }],
  };

  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'gmaps';
  resetGoogleMapsCircuits();
  mockFetch((u) => (u.includes('routes.googleapis.com') ? { body: routesBody } : 'throw'));
  let route = await routingService.getDirections(A, B);
  assert(routingService.lastProvider.directions === 'google' && route.isFallback === false, 'Con Google disponible: ruta de Google Maps');

  resetGoogleMapsCircuits();
  mockFetch(() => 'throw');
  route = await routingService.getDirections(A, B);
  assert(routingService.lastProvider.directions === 'ors', 'Google caído: conmuta a OpenRouteService');
  assert(route.coordinates.length >= 2 && route.steps.length >= 1, 'La ruta de respaldo es utilizable (polilínea + pasos)');
  assert(route.steps[0].type !== 10, 'La ruta de respaldo no inicia con la maniobra de llegada');

  resetGoogleMapsCircuits();
  mockFetch((u) => (u.includes('routes.googleapis.com') ? { status: 403, body: { error: { message: 'API not enabled' } } } : 'throw'));
  route = await routingService.getDirections(A, B);
  assert(routingService.lastProvider.directions === 'ors' && route.coordinates.length >= 2, 'Routes API no habilitada (403): respaldo transparente, sin excepción');

  delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  resetGoogleMapsCircuits();
  mockFetch(() => 'throw');
  route = await routingService.getDirections(A, B);
  assert(routingService.lastProvider.directions === 'ors' && !calls.some((u) => u.includes('googleapis.com')), 'Sin clave de Google: se usa ORS y no se contacta a Google');

  // Geocodificación: Google devuelve null -> ORS (catálogo curado Tier 0, 0 ms)
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'gmaps';
  resetGoogleMapsCircuits();
  clearGoogleGeocodeCache();
  mockFetch(() => 'throw');
  const geo = await routingService.geocodeDestination('Bellas Artes', A);
  assert(routingService.lastProvider.geocode === 'ors' && geo.length > 0, 'Geocodificación: Google caído -> catálogo/ORS resuelve "Bellas Artes"');

  delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  (globalThis as any).fetch = realFetch;
  console.log('\n================================================================');
  console.log(`📊 RESULTADO FAILOVER: ${passed}/${total} pruebas superadas`);
  console.log('================================================================');
  process.exit(passed === total ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
