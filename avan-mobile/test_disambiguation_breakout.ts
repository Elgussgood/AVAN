/**
 * Test Suite Automatizada: Ruptura de Desambiguación y Rectificación de Direcciones (Fase 7 / TASK-58 & TASK-59)
 *
 * Valida:
 * 1. Ruptura del bucle de desambiguación cuando el usuario dicta una nueva dirección o rectifica.
 * 2. Rectificación de direcciones mexicanas (con calles, avenidas y números) durante confirmación de viaje.
 * 3. Inmunidad de expresiones como "No, en Sonora 120" frente a cancelaciones erróneas.
 * 4. Extracción de direcciones completas (>6 palabras) sin recorte artificial.
 * 5. Preservación del flujo afirmativo ("Sí", "Vamos") y de cancelación pura ("Cancelar", "No").
 */

import {
  ConversationService,
  hasRectificationPattern,
  extractDestinationFromRectification,
  extractDestination,
  resolveDisambiguationSelection,
  ConversationContext,
} from './src/services/conversationService';
import { DisambiguationCandidate } from './src/services/orsService';
import { AliasService } from './src/services/aliasService';

async function runTests() {
  console.log('================================================================');
  console.log('🚀 SUITE: RUPTURA DE DESAMBIGUACIÓN Y RECTIFICACIÓN (FASE 7)');
  console.log('================================================================\n');

  await AliasService.ensureInitialized();

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
    }
  }

  // --------------------------------------------------------------------------
  // GRUPO 1: DETECCIÓN Y EXTRACCIÓN DE RECTIFICACIONES Y DIRECCIONES
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: Patrones de Rectificación y Extracción de Direcciones ---');

  const testRectifications = [
    { input: 'no, en sonora 120', expectedPattern: true, expectedDest: 'Sonora 120' },
    { input: 'no, sonora 120', expectedPattern: true, expectedDest: 'Sonora 120' },
    { input: 'es en reforma 222', expectedPattern: true, expectedDest: 'Reforma 222' },
    { input: 'no, es en reforma 222', expectedPattern: true, expectedDest: 'Reforma 222' },
    { input: 'no, calle durango 215', expectedPattern: true, expectedDest: 'Durango 215' },
    { input: 'no, en insurgentes sur 1500', expectedPattern: true, expectedDest: 'Insurgentes Sur 1500' },
    { input: 'no, mejor llevame a bellas artes', expectedPattern: true, expectedDest: 'Bellas Artes' },
    { input: 'en realidad es en insurgentes 1500', expectedPattern: true, expectedDest: 'Insurgentes 1500' },
  ];

  for (const t of testRectifications) {
    const hasPattern = hasRectificationPattern(t.input);
    assert(hasPattern === t.expectedPattern, `hasRectificationPattern('${t.input}') detecta rectificación`);

    const extracted = extractDestinationFromRectification(t.input, t.input);
    assert(
      Boolean(extracted && extracted.toLowerCase() === t.expectedDest.toLowerCase()),
      `extractDestinationFromRectification('${t.input}') -> "${extracted}" (esperado: "${t.expectedDest}")`
    );
  }

  // Direcciones mexicanas extensas (>6 palabras)
  const longAddress1 = 'Avenida Insurgentes Sur 1500, Credito Constructor';
  const extractedLong1 = extractDestination(longAddress1, longAddress1.toLowerCase());
  assert(
    Boolean(extractedLong1 && extractedLong1.toLowerCase().includes('insurgentes sur 1500')),
    `extractDestination soporta dirección con calle, número y colonia: "${extractedLong1}"`
  );

  const longAddress2 = 'Calle Durango 215, Roma Norte';
  const extractedLong2 = extractDestination(longAddress2, longAddress2.toLowerCase());
  assert(
    Boolean(extractedLong2 && extractedLong2.toLowerCase().includes('durango 215')),
    `extractDestination soporta calle con número y colonia: "${extractedLong2}"`
  );

  // Las selecciones de opciones no deben extraerse como destinos
  assert(
    extractDestination('la primera', 'la primera') === null,
    'extractDestination("la primera") devuelve null (no es destino)'
  );
  assert(
    extractDestination('la segunda', 'la segunda') === null,
    'extractDestination("la segunda") devuelve null (no es destino)'
  );
  assert(
    extractDestination('opcion 1', 'opcion 1') === null,
    'extractDestination("opcion 1") devuelve null (no es destino)'
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: RUPTURA DE BUCLE EN DESAMBIGUACIÓN (pendingDisambiguation)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: Ruptura de Bucle en pendingDisambiguation ---');

  const mockDisambiguationCandidates: DisambiguationCandidate[] = [
    {
      id: 'fsp_1',
      name: 'Farmacia San Pablo',
      label: 'Farmacia San Pablo, Coyoacán',
      colonia_o_alcaldia: 'Coyoacán',
      coordinates: { latitude: 19.345, longitude: -99.162 },
    },
    {
      id: 'fsp_2',
      name: 'Farmacia San Pablo',
      label: 'Farmacia San Pablo, Insurgentes Sur',
      colonia_o_alcaldia: 'Insurgentes Sur',
      coordinates: { latitude: 19.375, longitude: -99.178 },
    },
  ];

  function createDisambiguationContext(): ConversationContext {
    return {
      userName: 'Gustavo',
      currentLocation: { latitude: 19.4326, longitude: -99.1332 },
      pendingDisambiguation: {
        originalQuery: 'Farmacia San Pablo',
        candidates: [...mockDisambiguationCandidates],
        intent: 'navigation',
        timestamp: Date.now(),
      },
      history: [],
    };
  }

  // Test 2.1: Selección ordinal normal "la primera"
  const ctxOrdinal = createDisambiguationContext();
  const resOrdinal = await ConversationService.processUserMessage('la primera', ctxOrdinal);
  assert(
    resOrdinal.updatedContext.pendingDisambiguation === null,
    'Selección ordinal "la primera" cierra pendingDisambiguation'
  );
  assert(
    Boolean(resOrdinal.updatedContext.pendingConfirmation),
    'Selección ordinal establece pendingConfirmation hacia el candidato seleccionado'
  );
  assert(
    Boolean(resOrdinal.functionCall?.name === 'navegar_a' && (resOrdinal.functionCall.args as any)?.destino?.includes('Coyoacán')),
    `Navegación generada hacia candidato 1: "${(resOrdinal.functionCall?.args as any)?.destino}"`
  );

  // Test 2.2: Rectificación con "No, mejor llévame a Bellas Artes"
  const ctxBreakout1 = createDisambiguationContext();
  const resBreakout1 = await ConversationService.processUserMessage('No, mejor llévame a Bellas Artes', ctxBreakout1);
  assert(
    resBreakout1.updatedContext.pendingDisambiguation === null,
    'Rectificación con "No, mejor..." rompe la desambiguación (pendingDisambiguation = null)'
  );
  assert(
    Boolean(resBreakout1.functionCall?.name === 'navegar_a' && (resBreakout1.functionCall.args as any)?.destino?.includes('Bellas Artes')),
    `Redirección exitosa hacia nuevo destino: "${(resBreakout1.functionCall?.args as any)?.destino}"`
  );
  assert(
    !resBreakout1.spokenText.includes('cuál opción prefiere'),
    'No repite el mensaje de selección de candidatos'
  );

  // Test 2.3: Dictado de nueva dirección "No, en Sonora 120"
  const ctxBreakout2 = createDisambiguationContext();
  const resBreakout2 = await ConversationService.processUserMessage('No, en Sonora 120', ctxBreakout2);
  assert(
    resBreakout2.updatedContext.pendingDisambiguation?.originalQuery !== 'Farmacia San Pablo',
    'Dictado de "No, en Sonora 120" rompe la desambiguación anterior de Farmacia San Pablo'
  );
  assert(
    Boolean(
      resBreakout2.functionCall?.name === 'navegar_a' ||
      resBreakout2.updatedContext.pendingConfirmation?.destination.includes('Sonora 120') ||
      resBreakout2.updatedContext.pendingDisambiguation?.originalQuery.includes('Sonora 120')
    ),
    'El sistema atiende la nueva ubicación "Sonora 120"'
  );
  assert(
    !resBreakout2.spokenText.includes('cancelé la búsqueda'),
    '"No, en Sonora 120" no se interpreta como cancelación de búsqueda'
  );

  // Test 2.4: Dictado de "Es en Reforma 222"
  const ctxBreakout3 = createDisambiguationContext();
  const resBreakout3 = await ConversationService.processUserMessage('Es en Reforma 222', ctxBreakout3);
  assert(
    resBreakout3.updatedContext.pendingDisambiguation === null,
    'Dictado de "Es en Reforma 222" rompe la desambiguación anterior'
  );
  assert(
    Boolean(resBreakout3.functionCall?.name === 'navegar_a' && (resBreakout3.functionCall.args as any)?.destino?.includes('Reforma 222')),
    `Navegación generada hacia "${(resBreakout3.functionCall?.args as any)?.destino}"`
  );

  // Test 2.5: Cancelación pura en desambiguación
  const ctxCancel = createDisambiguationContext();
  const resCancel = await ConversationService.processUserMessage('Cancelar', ctxCancel);
  assert(
    resCancel.updatedContext.pendingDisambiguation === null,
    'Comando "Cancelar" cierra pendingDisambiguation'
  );
  assert(
    resCancel.spokenText.includes('cancelé la búsqueda') || resCancel.spokenText.includes('cancelado'),
    'Respuesta informa cancelación de búsqueda de forma clara'
  );

  // --------------------------------------------------------------------------
  // GRUPO 3: RECTIFICACIÓN DE DIRECCIONES EN CONFIRMACIÓN (pendingConfirmation)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 3: Rectificación de Direcciones en pendingConfirmation ---');

  function createConfirmationContext(destination: string): ConversationContext {
    return {
      userName: 'Gustavo',
      currentLocation: { latitude: 19.4326, longitude: -99.1332 },
      pendingConfirmation: {
        destination,
        coordinates: { latitude: 19.435, longitude: -99.141 },
        timestamp: Date.now(),
      },
      history: [],
    };
  }

  // Test 3.1: Rectificación con "No, en Sonora 120" (atiende la nueva ubicación sin cancelar)
  const ctxConf1 = createConfirmationContext('Farmacia San Pablo');
  const resConf1 = await ConversationService.processUserMessage('No, en Sonora 120', ctxConf1);
  const attendedSonora1 =
    Boolean(resConf1.functionCall?.name === 'navegar_a' && (resConf1.functionCall.args as any)?.destino?.includes('Sonora 120')) ||
    Boolean(resConf1.updatedContext.pendingDisambiguation?.originalQuery.includes('Sonora 120')) ||
    Boolean(resConf1.updatedContext.pendingConfirmation?.destination.includes('Sonora 120'));
  assert(
    attendedSonora1,
    `"No, en Sonora 120" atiende el nuevo destino Sonora 120 (navegación o desambiguación de Sonora 120)`
  );
  assert(
    (resConf1.spokenText.includes('Sonora 120') || resConf1.spokenText.includes('lugares con ese nombre')) &&
      !resConf1.spokenText.includes('Farmacia San Pablo'),
    'Respuesta verbal atiende Sonora 120 y deja atrás el destino anterior'
  );
  assert(
    !resConf1.spokenText.includes('cancelado el viaje'),
    '"No, en Sonora 120" no cancela el viaje'
  );

  // Test 3.2: Rectificación directa con colonia "No, en Sonora 120, Roma Norte" (unívoca -> navegar_a)
  const ctxConf2 = createConfirmationContext('Bellas Artes');
  const resConf2 = await ConversationService.processUserMessage('No, en Sonora 120, Roma Norte', ctxConf2);
  assert(
    Boolean(resConf2.functionCall?.name === 'navegar_a' && (resConf2.functionCall.args as any)?.destino?.includes('Sonora 120')),
    `"No, en Sonora 120, Roma Norte" rectifica destino a "${(resConf2.functionCall?.args as any)?.destino}"`
  );
  assert(
    !resConf2.spokenText.includes('cancelado el viaje'),
    '"No, en Sonora 120, Roma Norte" no cancela el viaje'
  );

  // Test 3.3: Rectificación con "Es en Reforma 222"
  const ctxConf3 = createConfirmationContext('Zócalo');
  const resConf3 = await ConversationService.processUserMessage('Es en Reforma 222', ctxConf3);
  assert(
    Boolean(resConf3.functionCall?.name === 'navegar_a' && (resConf3.functionCall.args as any)?.destino?.includes('Reforma 222')),
    `"Es en Reforma 222" rectifica destino a "${(resConf3.functionCall?.args as any)?.destino}"`
  );

  // Test 3.4: Rectificación con dirección completa "Calle Durango 215, Roma Norte"
  const ctxConf4 = createConfirmationContext('Parque México');
  const resConf4 = await ConversationService.processUserMessage('Calle Durango 215, Roma Norte', ctxConf4);
  assert(
    Boolean(resConf4.functionCall?.name === 'navegar_a' && (resConf4.functionCall.args as any)?.destino?.includes('Durango 215')),
    `Dirección directa con calle y colonia rectifica destino a "${(resConf4.functionCall?.args as any)?.destino}"`
  );

  // Test 3.5: Confirmación afirmativa intacta ("Sí")
  const ctxConf5 = createConfirmationContext('Bellas Artes');
  const resConf5 = await ConversationService.processUserMessage('Sí', ctxConf5);
  assert(
    resConf5.functionCall?.name === 'confirmar_viaje',
    'Respuesta "Sí" confirma el viaje con functionCall "confirmar_viaje"'
  );
  assert(
    resConf5.spokenText.includes('Iniciando la ruta'),
    'Respuesta verbal informa inicio de marcha'
  );

  // Test 3.6: Cancelación pura intacta ("Cancelar")
  const ctxConf6 = createConfirmationContext('Bellas Artes');
  const resConf6 = await ConversationService.processUserMessage('Cancelar', ctxConf6);
  assert(
    resConf6.functionCall?.name === 'cancelar',
    'Respuesta "Cancelar" invoca función "cancelar"'
  );
  assert(
    resConf6.spokenText.includes('cancelado el viaje'),
    'Respuesta verbal confirma cancelación pura'
  );

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FASE 7: ${passed}/${total} pruebas superadas (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Error fatal ejecutando suite:', err);
  process.exit(1);
});
