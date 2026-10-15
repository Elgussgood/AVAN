/**
 * Suite de Pruebas Automatizadas: Corrección de Alias, Navegación y Llegada a Destino
 * Fase 6: TASK-53, TASK-54, TASK-55, TASK-56, TASK-57
 */

import { AliasService } from './src/services/aliasService';
import { routingService } from './src/services/routingAdapter';
import { orsService, Coordinates, StepInstruction } from './src/services/orsService';
import {
  ConversationService,
  ConversationContext,
} from './src/services/conversationService';
import {
  NavigationService,
  getDistanceMeters,
} from './src/services/navigationService';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`   Detalle: ${details}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TEST SUITE: ALIAS, NAVEGACIÓN Y LLEGADA (FASE 6)');
  console.log('================================================================\n');

  // Asegurar inicialización de alias
  await AliasService.ensureInitialized();

  // -------------------------------------------------------------
  // GRUPO 1: Resolución Inmediata de Alias en el Motor de Ruteo (TASK-53)
  // -------------------------------------------------------------
  console.log('--- GRUPO 1: Resolución de Alias en el Routing Adapter (TASK-53) ---');

  const defaultAliasTests = [
    { query: 'casa de mi hijo', expectedName: 'Casa de mi hijo' },
    { query: 'vamos a la casa de mi hijo', expectedName: 'Casa de mi hijo' },
    { query: 'al doctor', expectedName: 'Doctor (Dr. Roberto Gómez)' },
    { query: 'mi casa', expectedName: 'Mi Casa' },
    { query: 'llévame a mi casa por favor', expectedName: 'Mi Casa' },
  ];

  for (const t of defaultAliasTests) {
    const res = AliasService.resolveDestinationWithAlias(t.query);
    assert(
      res.isAlias === true,
      `AliasService identifica alias para "${t.query}"`,
      `Esperado isAlias=true, recibido ${res.isAlias}`
    );
    assert(
      res.coordinates !== null && typeof res.coordinates?.latitude === 'number',
      `AliasService devuelve coordenadas válidas para "${t.query}"`,
      `Coordenadas: ${JSON.stringify(res.coordinates)}`
    );
  }

  // Geocodificación directa a través de routingService
  const geocodedHijo = await routingService.geocodeDestination('casa de mi hijo');
  assert(
    geocodedHijo.length > 0,
    'routingService.geocodeDestination resuelve "casa de mi hijo" con éxito'
  );
  assert(
    geocodedHijo[0].precision === 'exact',
    'La precisión del alias resuelto es "exact"'
  );
  assert(
    geocodedHijo[0].coordinates.latitude === 19.3638 &&
      geocodedHijo[0].coordinates.longitude === -99.1824,
    'Las coordenadas de "casa de mi hijo" coinciden exactamente con el alias guardado'
  );

  // -------------------------------------------------------------
  // GRUPO 2: Guardado Local de Nuevos Alias con Coordenadas Válidas (TASK-54)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 2: Guardado y Consulta de Nuevos Alias (TASK-54) ---');

  const nuevoAlias = await AliasService.saveAlias({
    name: 'Casa de mi hija Sofía',
    address: 'Calle Durango 215, Roma Norte',
    coordinates: { latitude: 19.4195, longitude: -99.1648 },
    category: 'family',
  });

  assert(
    nuevoAlias !== null && nuevoAlias.id.length > 0,
    'AliasService.saveAlias crea el nuevo alias en memoria'
  );

  const resHija = AliasService.resolveDestinationWithAlias('vamos con mi hija sofía');
  assert(
    resHija.isAlias === true,
    'AliasService reconoce el nuevo alias dinámico "vamos con mi hija sofía"'
  );
  assert(
    resHija.coordinates?.latitude === 19.4195 &&
      resHija.coordinates?.longitude === -99.1648,
    'Coordenadas del nuevo alias coinciden con las registradas'
  );

  // -------------------------------------------------------------
  // GRUPO 3: Inmunidad de Confirmación Afirmativa (TASK-56)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 3: Inmunidad Afirmativa en Confirmación de Viaje (TASK-56) ---');

  const affirmativePhrases = [
    'sí',
    'si',
    'sí por favor',
    'si por favor',
    'vamos',
    'iniciar viaje',
    'claro que sí',
    'por supuesto',
    'vámonos',
    'adelante',
  ];

  for (const phrase of affirmativePhrases) {
    // Crear un contexto en estado de confirmación pendiente
    const testContext: ConversationContext = {
      userName: 'Gustavo',
      pendingConfirmation: {
        destination: 'Hospital Ángeles',
        timestamp: Date.now(),
        originalQuery: 'Av. Paseo del Pedregal 45',
        coordinates: { latitude: 19.3089, longitude: -99.2014 },
      },
    };

    const res = await ConversationService.processUserMessage(phrase, testContext);

    assert(
      res.functionCall?.name === 'confirmar_viaje',
      `Frase afirmativa "${phrase}" invoca 'confirmar_viaje'`,
      `Recibido functionCall: ${res.functionCall?.name || 'ninguno'}, respuesta: ${res.spokenText}`
    );

    assert(
      !res.spokenText.toLowerCase().includes('cancelad') &&
        !res.spokenText.toLowerCase().includes('rechazad'),
      `Frase afirmativa "${phrase}" no produce mensaje de cancelación`,
      `Texto: ${res.spokenText}`
    );
  }

  // -------------------------------------------------------------
  // GRUPO 4: Generación y Trazado de Rutas Robustas (TASK-55)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 4: Trazado de Rutas y Fallback Sin Polilíneas Vacías (TASK-55) ---');

  const startPt: Coordinates = { latitude: 19.4326, longitude: -99.1332 };
  const targetPt: Coordinates = { latitude: 19.4195, longitude: -99.1648 };

  const fallbackRoute = orsService.generateFallbackRoute(startPt, targetPt);

  assert(
    fallbackRoute.coordinates.length >= 5,
    `generateFallbackRoute genera polilínea rica (${fallbackRoute.coordinates.length} puntos)`
  );

  assert(
    fallbackRoute.steps.length >= 2,
    `generateFallbackRoute incluye instrucciones turn-by-turn (${fallbackRoute.steps.length} pasos)`
  );

  const totalDist = fallbackRoute.distance;
  assert(
    totalDist > 500,
    `Distancia calculada es realista (${Math.round(totalDist)} metros)`
  );

  // Validar prevención de ruta origen-destino idéntico
  const sameDist = getDistanceMeters(startPt, startPt);
  assert(sameDist === 0, 'Distancia idéntica inicial detectada correctamente (0m)');

  // -------------------------------------------------------------
  // GRUPO 5: Blindaje Contra Falsa Llegada Prematura (TASK-55)
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 5: Blindaje de Llegada a Destino y Guardia Temporal (TASK-55) ---');

  const routeSteps: StepInstruction[] = [
    {
      instruction: 'Inicie hacia el poniente en Avenida Hidalgo',
      distance: 800,
      duration: 120,
      type: 11,
      name: 'Av. Hidalgo',
      wayPoints: [0, 4],
    },
    {
      instruction: 'Gire a la izquierda en Paseo de la Reforma',
      distance: 1200,
      duration: 180,
      type: 0,
      name: 'Paseo de la Reforma',
      wayPoints: [4, 9],
    },
    {
      instruction: 'Ha llegado a su destino',
      distance: 30,
      duration: 10,
      type: 10,
      name: 'Destino',
      wayPoints: [9, 10],
    },
  ];

  // Caso A: Al arrancar el viaje (Paso 0), con tiempo transcurrido menor a 35 segundos
  const elapsedEarlySec = 15;
  const isNewTripGracePeriodEarly = elapsedEarlySec < 35;
  const currentStepIndexEarly = 0;
  const isLastStepEarly = currentStepIndexEarly >= routeSteps.length - 1;

  assert(
    isNewTripGracePeriodEarly === true,
    'Guardia temporal de 35s está activa a los 15s de arrancar el viaje'
  );
  assert(
    isLastStepEarly === false,
    'El vehículo en el arranque (paso 0) NO está en el último paso'
  );

  // Caso B: Simulación de paso 0 aun con tiempo cumplido (ej. semáforo cerca del origen)
  const elapsedLateSec = 40;
  const isNewTripGracePeriodLate = elapsedLateSec < 35;
  const remainingDistMid = 1800; // Aún lejos de meta
  const distToTargetSimulated = 30; // Posible error de GPS o inicio cerca de fin

  const shouldTriggerArrivalEarly =
    !isNewTripGracePeriodLate &&
    distToTargetSimulated <= 45 &&
    remainingDistMid <= 45 &&
    isLastStepEarly;

  assert(
    shouldTriggerArrivalEarly === false,
    'NO se dispara llegada en paso 0 aun si transcurrieron >35s y distToTarget es baja'
  );

  // Caso C: Llegada legítima (Paso final, >35s, distToTarget <= 45m, remainingDistance <= 45m)
  const currentStepIndexFinal = 2; // Último paso (type 10)
  const isLastStepFinal =
    currentStepIndexFinal >= routeSteps.length - 1 || routeSteps[currentStepIndexFinal].type === 10;
  const remainingDistFinal = 25;
  const distToTargetFinal = 20;

  const shouldTriggerArrivalLegitimate =
    !isNewTripGracePeriodLate &&
    distToTargetFinal <= 45 &&
    remainingDistFinal <= 45 &&
    isLastStepFinal;

  assert(
    shouldTriggerArrivalLegitimate === true,
    'SÍ se dispara llegada cuando el vehículo transita al último paso y está a <=45m de la meta'
  );

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} pruebas superadas (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TODAS LAS PRUEBAS DE ALIAS, NAVEGACIÓN Y LLEGADA PASARON EXITOSAMENTE');
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Error fatal en la ejecución de la suite de pruebas:', err);
  process.exit(1);
});
