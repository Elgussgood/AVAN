/**
 * Suite: NLU con Gemini (TASK-48 / TASK-52).
 * Determinista: usa fetch simulado, no consume cuota ni requiere claves reales.
 */
import {
  convertToolsToGemini,
  convertMessagesToGeminiContents,
  parseGeminiResponse,
  callGeminiChat,
  isGeminiCircuitOpen,
  resetGeminiCircuit,
} from './src/services/geminiService';
import { AVAN_TOOLS } from './src/services/conversationService';

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
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    } as any;
  };
}

async function run() {
  console.log('================================================================');
  console.log('🚀 SUITE: GEMINI NLU (TASK-48 / TASK-52)');
  console.log('================================================================');
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';

  // ---- GRUPO 1: conversión de herramientas ----
  console.log('\n--- GRUPO 1: AVAN_TOOLS -> functionDeclarations ---');
  const converted = convertToolsToGemini(AVAN_TOOLS as any);
  const decls = converted[0].functionDeclarations;
  const names = decls.map((d: any) => d.name);
  for (const n of ['navegar_a', 'guardar_ubicacion', 'ajustar_zoom', 'confirmar_viaje', 'cancelar', 'consultar_trafico', 'reportar_incidente']) {
    assert(names.includes(n), `Herramienta "${n}" presente`);
  }
  const zoom = decls.find((d: any) => d.name === 'ajustar_zoom');
  assert(zoom.parameters?.type === 'OBJECT', 'Tipos en mayúsculas (OBJECT)');
  assert(zoom.parameters?.properties?.direccion?.type === 'STRING', 'Propiedades STRING en mayúsculas');
  assert(
    Array.isArray(zoom.parameters?.properties?.intensidad?.enum) &&
      zoom.parameters.properties.intensidad.enum.includes('mucho'),
    'Enum de intensidad conservado (mucho/normal/poco)'
  );
  const noParamTools = decls.filter((d: any) => !d.parameters);
  assert(
    decls.every((d: any) => !d.parameters || Object.keys(d.parameters.properties).length > 0),
    'Ninguna herramienta envía OBJECT con propiedades vacías (Gemini lo rechaza)',
    noParamTools.map((d: any) => d.name)
  );
  assert(
    decls.every((d: any) => !d.parameters?.required || d.parameters.required.every((r: string) => r in d.parameters.properties)),
    'Todos los "required" existen en properties'
  );

  // ---- GRUPO 2: conversión de historial ----
  console.log('\n--- GRUPO 2: Historial -> contents ---');
  const contents = convertMessagesToGeminiContents([
    { role: 'assistant', content: 'Hola, ¿a dónde vamos?' },
    { role: 'user', content: 'Quiero ir al metro' },
    { role: 'user', content: 'Politécnico' },
    { role: 'assistant', content: '¿Desea iniciar el viaje?' },
    { role: 'user', content: '   ' },
    { role: 'user', content: 'Sí' },
  ]);
  assert(contents[0].role === 'user', 'El historial inicia siempre con turno de usuario');
  assert(contents.every((c, i) => i === 0 || c.role !== contents[i - 1].role), 'Los roles alternan (turnos consecutivos fusionados)');
  assert(contents[0].parts.length === 2, 'Dos mensajes de usuario consecutivos se fusionan');
  assert(!contents.some((c) => c.parts.some((p) => !p.text.trim())), 'Se descartan mensajes vacíos');

  // ---- GRUPO 3: parseo de respuesta ----
  console.log('\n--- GRUPO 3: Respuesta de Gemini -> tool_calls ---');
  const fc = parseGeminiResponse({
    candidates: [{ content: { parts: [{ functionCall: { name: 'ajustar_zoom', args: { direccion: 'acercar', intensidad: 'mucho' } } }] } }],
  });
  assert(fc?.tool_calls?.[0].function.name === 'ajustar_zoom', 'functionCall -> tool_calls[0].function.name');
  assert(JSON.parse(fc!.tool_calls![0].function.arguments).intensidad === 'mucho', 'args serializados como JSON string (formato Groq)');
  const txt = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Con gusto.' }] } }] });
  assert(txt?.content === 'Con gusto.' && !txt.tool_calls, 'Respuesta de sólo texto');
  const thought = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'razonando…', thought: true }, { text: 'Listo.' }] } }] });
  assert(thought?.content === 'Listo.', 'Se ignoran las partes de "thought"');
  assert(parseGeminiResponse({ candidates: [{ finishReason: 'SAFETY' }] }) === null, 'Respuesta bloqueada/vacía -> null');
  assert(parseGeminiResponse({}) === null, 'Respuesta sin candidatos -> null');

  // ---- GRUPO 4: llamada HTTP ----
  console.log('\n--- GRUPO 4: callGeminiChat (fetch simulado) ---');
  resetGeminiCircuit();
  mockFetch(() => ({ body: { candidates: [{ content: { parts: [{ functionCall: { name: 'cancelar', args: {} } }] } }] } }));
  const ok = await callGeminiChat({
    systemPrompt: 'SYS',
    messages: [{ role: 'user', content: 'cancela el viaje' }],
    tools: AVAN_TOOLS as any,
  });
  assert(ok?.tool_calls?.[0].function.name === 'cancelar', 'Devuelve el tool call normalizado');
  const sent = JSON.parse(calls[0].init.body);
  assert(calls[0].init.headers['x-goog-api-key'] === 'test-key', 'Clave enviada por cabecera x-goog-api-key');
  assert(!calls[0].url.includes('test-key'), 'La clave NO viaja en la URL');
  assert(sent.systemInstruction.parts[0].text === 'SYS', 'systemInstruction enviado');
  assert(sent.generationConfig.temperature === 0.1, 'temperature 0.1');
  assert(sent.generationConfig.thinkingConfig.thinkingBudget === 0, 'thinkingBudget 0 (latencia mínima)');
  assert(calls[0].url.includes('gemini-2.5-flash:generateContent'), 'Modelo por defecto gemini-2.5-flash');

  // Sin clave -> null y sin red
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  mockFetch(() => ({ body: {} }));
  const noKey = await callGeminiChat({ systemPrompt: 's', messages: [{ role: 'user', content: 'hola' }], tools: AVAN_TOOLS as any });
  assert(noKey === null && calls.length === 0, 'Sin clave: devuelve null sin llamar a la red');
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';

  // ---- GRUPO 5: circuit breaker ----
  console.log('\n--- GRUPO 5: Circuit breaker ---');
  resetGeminiCircuit();
  mockFetch(() => ({ status: 429, body: { error: { message: 'quota' } } }));
  const r429 = await callGeminiChat({ systemPrompt: 's', messages: [{ role: 'user', content: 'hola' }], tools: AVAN_TOOLS as any });
  assert(r429 === null, '429 -> null');
  assert(isGeminiCircuitOpen(), 'Un 429 abre el circuito');
  const before = calls.length;
  await callGeminiChat({ systemPrompt: 's', messages: [{ role: 'user', content: 'hola' }], tools: AVAN_TOOLS as any });
  assert(calls.length === before, 'Con el circuito abierto no se vuelve a llamar a la red (cero latencia extra)');

  resetGeminiCircuit();
  mockFetch(() => 'throw');
  for (let i = 0; i < 3; i++) await callGeminiChat({ systemPrompt: 's', messages: [{ role: 'user', content: 'hola' }], tools: AVAN_TOOLS as any });
  assert(isGeminiCircuitOpen(), 'Tres fallos de red consecutivos abren el circuito');

  resetGeminiCircuit();
  mockFetch(() => ({ status: 403, body: {} }));
  await callGeminiChat({ systemPrompt: 's', messages: [{ role: 'user', content: 'hola' }], tools: AVAN_TOOLS as any });
  assert(isGeminiCircuitOpen(), 'Clave inválida/403 abre el circuito (no insistir)');
  resetGeminiCircuit();

  (globalThis as any).fetch = realFetch;
  console.log('\n================================================================');
  console.log(`📊 RESULTADO GEMINI NLU: ${passed}/${total} pruebas superadas`);
  console.log('================================================================');
  process.exit(passed === total ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
