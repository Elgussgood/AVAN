import {
  orsService,
  findNearestLandmark,
  extractZoneFromLabel,
  computeDistanceMeters,
  DisambiguationCandidate,
} from './src/services/orsService';
import {
  ConversationService,
  buildDisambiguationSpokenPrompt,
  resolveDisambiguationSelection,
  ConversationContext,
} from './src/services/conversationService';
import { AliasService } from './src/services/aliasService';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 SUITE DE PRUEBAS AUTOMATIZADA: SISTEMA DE DESAMBIGUACIÓN (TASK-40)');
  console.log('====================================================\n');

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
  // TEST 1: findNearestLandmark & extractZoneFromLabel
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Detección de Landmarks y Zonas ---');
  // Coordenadas cerca de Metro Hidalgo (19.4373, -99.1472)
  const landmarkNearHidalgo = findNearestLandmark({ latitude: 19.4373, longitude: -99.1472 });
  assert(
    Boolean(landmarkNearHidalgo && landmarkNearHidalgo.name.toLowerCase().includes('hidalgo')),
    `Landmark cerca de Av. Hidalgo detectado: "${landmarkNearHidalgo?.name}" (tipo: ${landmarkNearHidalgo?.type}, dist: ${landmarkNearHidalgo?.distanceMeters}m)`
  );

  // Coordenadas cerca de Metro Coyoacán / Zapata (19.3629, -99.1706)
  const landmarkNearZapata = findNearestLandmark({ latitude: 19.3708, longitude: -99.1652 });
  assert(
    Boolean(landmarkNearZapata && (landmarkNearZapata.name.toLowerCase().includes('zapata') || landmarkNearZapata.name.toLowerCase().includes('coyoacan'))),
    `Landmark en zona sur detectado: "${landmarkNearZapata?.name}" (${landmarkNearZapata?.distanceMeters}m)`
  );

  const zoneExtracted = extractZoneFromLabel('Calle Hidalgo 45, Coyoacán, Ciudad de México');
  assert(
    zoneExtracted === 'Coyoacán',
    `Extracción de alcaldía o zona: "${zoneExtracted}" === "Coyoacán"`
  );

  // --------------------------------------------------------------------------
  // TEST 2: buildDisambiguationSpokenPrompt
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Generación de Prompt Verbal Gerontológico ---');
  const mockCandidates: DisambiguationCandidate[] = [
    {
      id: 'c1',
      name: 'Calle Hidalgo 10',
      label: 'Calle Hidalgo 10, Cuauhtémoc, Ciudad de México',
      colonia_o_alcaldia: 'Cuauhtémoc',
      landmarkRef: 'Metro Hidalgo',
      landmarkType: 'metro',
      coordinates: { latitude: 19.4373, longitude: -99.1472 },
      distanceMeters: 1200,
    },
    {
      id: 'c2',
      name: 'Avenida Hidalgo 55',
      label: 'Avenida Hidalgo 55, Del Carmen, Coyoacán, Ciudad de México',
      colonia_o_alcaldia: 'Coyoacán',
      landmarkRef: 'Metro Viveros',
      landmarkType: 'metro',
      coordinates: { latitude: 19.3524, longitude: -99.1755 },
      distanceMeters: 8500,
    },
  ];

  const promptNav = buildDisambiguationSpokenPrompt(mockCandidates, 'navigation');
  assert(
    promptNav.includes('dos lugares') &&
      promptNav.includes('Cuauhtémoc') &&
      promptNav.includes('Metro Hidalgo') &&
      promptNav.includes('Coyoacán') &&
      promptNav.includes('Metro Viveros') &&
      promptNav.includes('¿A cuál de ellos desea ir?'),
    `Prompt de navegación estructurado con 2 opciones y landmarks:\n   "${promptNav}"`
  );

  const promptAlias = buildDisambiguationSpokenPrompt(mockCandidates, 'alias_registration', 'Casa de mi hijo');
  assert(
    promptAlias.includes('Casa de mi hijo') &&
      promptAlias.includes('¿Cuál de ellos desea registrar?'),
    `Prompt de alias incluye el nombre del alias y pregunta adecuada`
  );

  // --------------------------------------------------------------------------
  // TEST 3: resolveDisambiguationSelection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Resolución Semántica de Respuestas ---');
  // 3.1 Ordinales
  const sel1 = resolveDisambiguationSelection('la primera', 'la primera', mockCandidates);
  assert(sel1?.id === 'c1', 'Selección por ordinal "la primera" -> candidato 1');

  const sel2 = resolveDisambiguationSelection('la segunda', 'la segunda', mockCandidates);
  assert(sel2?.id === 'c2', 'Selección por ordinal "la segunda" -> candidato 2');

  const selNum1 = resolveDisambiguationSelection('el 1', 'el 1', mockCandidates);
  assert(selNum1?.id === 'c1', 'Selección por número "el 1" -> candidato 1');

  const selNum2 = resolveDisambiguationSelection('opción 2', 'opcion 2', mockCandidates);
  assert(selNum2?.id === 'c2', 'Selección por número "opción 2" -> candidato 2');

  // 3.2 Por zona / colonia
  const selZone = resolveDisambiguationSelection('la de Coyoacán', 'la de coyoacan', mockCandidates);
  assert(selZone?.id === 'c2', 'Selección por zona "la de Coyoacán" -> candidato 2');

  // 3.3 Por landmark
  const selLandmark = resolveDisambiguationSelection('la que está cerca de metro hidalgo', 'la que esta cerca de metro hidalgo', mockCandidates);
  assert(selLandmark?.id === 'c1', 'Selección por landmark "metro hidalgo" -> candidato 1');

  const selLandmark2 = resolveDisambiguationSelection('la de metro viveros', 'la de metro viveros', mockCandidates);
  assert(selLandmark2?.id === 'c2', 'Selección por landmark "metro viveros" -> candidato 2');

  // --------------------------------------------------------------------------
  // TEST 4: Flujo Conversacional de Desambiguación en Navegación Directa
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Flujo Conversacional de Navegación Directa ---');
  const baseContext: ConversationContext = {
    userName: 'Gustavo',
    currentLocation: { latitude: 19.4326, longitude: -99.1332 },
  };

  // Forzamos un contexto en estado pendingDisambiguation
  const disambiguationContext: ConversationContext = {
    ...baseContext,
    pendingDisambiguation: {
      originalQuery: 'Calle Hidalgo',
      intent: 'navigation',
      candidates: mockCandidates,
      timestamp: Date.now(),
    },
  };

  // 4.1 Selección verbal ordinal "la primera"
  const resSel1 = await ConversationService.processUserMessage('la primera', disambiguationContext);
  assert(
    resSel1.updatedContext.pendingDisambiguation === null &&
      Boolean(resSel1.updatedContext.pendingConfirmation) &&
      resSel1.updatedContext.pendingConfirmation?.destination === mockCandidates[0].label &&
      resSel1.requiresConfirmation === true,
    `Respuesta a "la primera": limpia desambiguación y pasa a confirmación de viaje hacia "${mockCandidates[0].label}"`
  );

  // 4.2 Selección verbal por zona "la de Coyoacán"
  const resSelZone = await ConversationService.processUserMessage('Coyoacán', disambiguationContext);
  assert(
    resSelZone.updatedContext.pendingDisambiguation === null &&
      Boolean(resSelZone.updatedContext.pendingConfirmation) &&
      resSelZone.updatedContext.pendingConfirmation?.destination === mockCandidates[1].label,
    `Respuesta a "Coyoacán": pasa a confirmación de viaje hacia "${mockCandidates[1].label}"`
  );

  // 4.3 Cancelación
  const resCancel = await ConversationService.processUserMessage('cancelar', disambiguationContext);
  assert(
    resCancel.updatedContext.pendingDisambiguation === null &&
      resCancel.spokenText.toLowerCase().includes('cancel'),
    `Cancelación durante desambiguación limpia el estado correctamente`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Flujo Conversacional de Desambiguación en Registro de Alias
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Flujo Conversacional en Registro de Alias ---');
  const aliasDisambiguationContext: ConversationContext = {
    ...baseContext,
    pendingDisambiguation: {
      originalQuery: 'Calle Hidalgo',
      intent: 'alias_registration',
      aliasName: 'Casa de mi primo',
      candidates: mockCandidates,
      timestamp: Date.now(),
    },
  };

  // 5.1 Selección ordinal "la segunda"
  const resAliasSel = await ConversationService.processUserMessage('la segunda', aliasDisambiguationContext);
  assert(
    resAliasSel.updatedContext.pendingDisambiguation === null &&
      Boolean(resAliasSel.updatedContext.pendingAliasRegistration) &&
      resAliasSel.updatedContext.pendingAliasRegistration?.step === 'confirming_address' &&
      resAliasSel.updatedContext.pendingAliasRegistration?.addressCandidate === mockCandidates[1].label &&
      resAliasSel.spokenText.includes('Casa de mi primo'),
    `Respuesta a "la segunda": pasa a confirmación de dirección de "${mockCandidates[1].label}" para "Casa de mi primo"`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Geocodificación y Desambiguación en Vivo con orsService
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Geocodificación de Lugares Homónimos en Vivo ---');
  try {
    const liveDisambiguation = await orsService.getDisambiguationCandidates(
      'Hidalgo',
      { latitude: 19.4326, longitude: -99.1332 },
      3
    );
    assert(
      liveDisambiguation.candidates.length >= 1,
      `Geocodificación de "Hidalgo" arrojó ${liveDisambiguation.candidates.length} candidato(s) con enriquecimiento de zona y landmarks.`
    );
    if (liveDisambiguation.candidates.length > 0) {
      const c = liveDisambiguation.candidates[0];
      console.log(`   Candidato 1: ${c.label} (Zona: ${c.colonia_o_alcaldia}, Landmark: ${c.landmarkRef || 'N/A'})`);
    }
  } catch (err: any) {
    console.warn('Error en prueba de geocodificación en vivo:', err.message || err);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Regresión de Flujo de Registro de Alias y Cambio en 1 Paso
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Regresión de Flujo de Registro de Alias y Cambio Directo en 1 Paso ---');

  // 7.1 En lista de desambiguación, dictar nueva dirección con número o colonia NO debe elegir falsamente una opción
  const noFalseSelect = resolveDisambiguationSelection(
    'Sonora 120, Cuauhtémoc',
    'sonora 120 cuauhtemoc',
    mockCandidates
  );
  assert(
    noFalseSelect === null,
    'Dictar nueva dirección "Sonora 120, Cuauhtémoc" en lista de desambiguación NO selecciona falsamente por token compartido'
  );

  const noFalseSelectEje = resolveDisambiguationSelection(
    'Eje 1 Norte 200',
    'eje 1 norte 200',
    mockCandidates
  );
  assert(
    noFalseSelectEje === null,
    'Dictar "Eje 1 Norte 200" en lista de desambiguación NO selecciona falsamente la opción 1 por el dígito "1"'
  );

  // 7.2 Flujo completo de registro de alias nuevo -> cambio directo de ubicación en 1 paso -> confirmación y guardado
  let aliasFlowCtx: ConversationContext = {
    userName: 'Gustavo',
    currentLocation: { latitude: 19.4326, longitude: -99.1332 },
  };

  const step1 = await ConversationService.processUserMessage('llévame a casa de mi sobrino Luis', aliasFlowCtx);
  aliasFlowCtx = step1.updatedContext;
  assert(
    Boolean(aliasFlowCtx.pendingAliasRegistration) &&
      aliasFlowCtx.pendingAliasRegistration?.step === 'awaiting_address',
    `Paso 1 (alias no registrado): entra a pendingAliasRegistration (step='awaiting_address') para "${aliasFlowCtx.pendingAliasRegistration?.aliasName}"`
  );

  const step2 = await ConversationService.processUserMessage('Palacio de Bellas Artes', aliasFlowCtx);
  aliasFlowCtx = step2.updatedContext;
  assert(
    Boolean(aliasFlowCtx.pendingAliasRegistration) &&
      aliasFlowCtx.pendingAliasRegistration?.step === 'confirming_address' &&
      !aliasFlowCtx.pendingConfirmation,
    `Paso 2 (proporciona ubicación): pasa a confirming_address para guardar el alias (NO a confirmación de viaje normal)`
  );

  // Cambio directo en 1 solo paso durante confirming_address (sin decir "No" primero)
  const step3 = await ConversationService.processUserMessage('Museo Soumaya', aliasFlowCtx);
  aliasFlowCtx = step3.updatedContext;
  assert(
    Boolean(aliasFlowCtx.pendingAliasRegistration) &&
      aliasFlowCtx.pendingAliasRegistration?.step === 'confirming_address' &&
      Boolean(aliasFlowCtx.pendingAliasRegistration?.addressCandidate?.toLowerCase().includes('soumaya')),
    `Paso 3 (cambio directo en 1 paso durante confirming_address): actualiza a "${aliasFlowCtx.pendingAliasRegistration?.addressCandidate}" conservando el registro del alias`
  );

  // Confirmar guardado con "Sí"
  const step4 = await ConversationService.processUserMessage('Sí', aliasFlowCtx);
  aliasFlowCtx = step4.updatedContext;
  const savedSobrino = AliasService.getAlias('casa de mi sobrino Luis');
  assert(
    Boolean(savedSobrino) &&
      step4.functionCall?.name === 'guardar_ubicacion' &&
      Boolean(aliasFlowCtx.pendingConfirmation),
    `Paso 4 (confirma "Sí"): guarda efectivamente el alias en AliasService ("${savedSobrino?.address}") y pasa a confirmación de viaje`
  );

  // 7.3 Cambio directo de destino en 1 paso durante confirmación de viaje normal (sin tener que decir "No" primero)
  const step5 = await ConversationService.processUserMessage('Alameda Central', aliasFlowCtx);
  aliasFlowCtx = step5.updatedContext;
  assert(
    Boolean(aliasFlowCtx.pendingConfirmation) &&
      Boolean(aliasFlowCtx.pendingConfirmation?.destination.toLowerCase().includes('alameda')),
    `Paso 5 (cambio directo en 1 paso durante pendingConfirmation): cambia destino directamente a "${aliasFlowCtx.pendingConfirmation?.destination}"`
  );

  // --------------------------------------------------------------------------
  // RESUMEN
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`🎯 RESULTADOS: ${passed}/${total} pruebas superadas.`);
  if (passed === total) {
    console.log('🌟 TODAS LAS PRUEBAS DE DESAMBIGUACIÓN FUERON EXITOSAS.');
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON.');
  }
  console.log('====================================================');
}

runTests().catch(console.error);
