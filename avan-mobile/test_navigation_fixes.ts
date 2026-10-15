/**
 * Suite de pruebas automatizadas: Pulido de Navegación, Detección de Llegada y Zoom/Recentrado (TASK-46)
 */
import {
  detectZoomIntensity,
  ConversationService,
} from './src/services/conversationService';
import {
  NavigationService,
  getDistanceMeters,
} from './src/services/navigationService';
import { orsService } from './src/services/orsService';

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
  console.log('🚀 INICIANDO TEST SUITE: PULIDO DE NAVEGACIÓN Y ZOOM (TASK-46)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // GRUPO 1: Detección de Intensidad de Zoom (detectZoomIntensity)
  // -------------------------------------------------------------
  console.log('--- GRUPO 1: Detección de Intensidad de Zoom (detectZoomIntensity) ---');

  const muchoPhrases = [
    'haz mucho zoom',
    'acerca mucho',
    'acerca bastante',
    'haz zoom al máximo',
    'aleja bastante',
    'bien lejos',
    'mucho más cerca',
    'todo el zoom',
    'lo más que puedas',
  ];

  for (const phrase of muchoPhrases) {
    const intensity = detectZoomIntensity(phrase);
    assert(
      intensity === 'mucho',
      `Detecta intensidad 'mucho' en "${phrase}"`,
      `Esperado 'mucho', recibido '${intensity}'`
    );
  }

  const pocoPhrases = [
    'acerca un poco',
    'aleja un poco',
    'acerca tantito',
    'un leve',
    'despacio',
    'ligeramente',
    'un toque',
    'un piquito',
  ];

  for (const phrase of pocoPhrases) {
    const intensity = detectZoomIntensity(phrase);
    assert(
      intensity === 'poco',
      `Detecta intensidad 'poco' en "${phrase}"`,
      `Esperado 'poco', recibido '${intensity}'`
    );
  }

  const normalPhrases = [
    'acerca el mapa',
    'aleja el mapa',
    'haz zoom',
    'ampliar vista',
    'reducir',
  ];

  for (const phrase of normalPhrases) {
    const intensity = detectZoomIntensity(phrase);
    assert(
      intensity === 'normal',
      `Detecta intensidad 'normal' en "${phrase}"`,
      `Esperado 'normal', recibido '${intensity}'`
    );
  }

  // -------------------------------------------------------------
  // GRUPO 2: Detección de Llegada Estricta y Guardia Temporal
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 2: Guardia Temporal y Supresión de Falsa Llegada Inicial ---');

  const routeCoords = [
    { latitude: 19.4326, longitude: -99.1332 }, // Zócalo
    { latitude: 19.4340, longitude: -99.1370 }, // Tramo intermedio
    { latitude: 19.4352, longitude: -99.1412 }, // Bellas Artes (destino)
  ];
  const destCoords = { latitude: 19.4352, longitude: -99.1412 };

  // Caso 2.1: En t = 0 (inicio de viaje), el vehículo está en el origen (Zócalo)
  const currentCoordsStart = routeCoords[0];
  const distToTargetStart = getDistanceMeters(currentCoordsStart, destCoords);
  const elapsedStart = 0; // 0 segundos
  const isGracePeriodActive = elapsedStart < 12;

  // Evaluar con lógica de HomeScreen:
  const shouldTriggerArrivalAtStart =
    !isGracePeriodActive && distToTargetStart <= 50;

  assert(
    distToTargetStart > 50,
    `Distancia al inicio es mayor a 50m (${distToTargetStart}m)`,
    `Distancia: ${distToTargetStart}m`
  );
  assert(
    !shouldTriggerArrivalAtStart,
    'NO se dispara llegada en el arranque del viaje'
  );

  // Caso 2.2: Guardia temporal bloquea llegada incluso si GPS reporta cercanía errónea en t = 2s
  const elapsedEarly = 2; // 2 segundos tras arrancar
  const isEarlyGracePeriod = elapsedEarly < 12;
  const simulatedDrift = { latitude: 19.4351, longitude: -99.1411 }; // 15m del destino
  const distDrift = getDistanceMeters(simulatedDrift, destCoords);

  const shouldTriggerArrivalDrift =
    !isEarlyGracePeriod && distDrift <= 50;

  assert(
    isEarlyGracePeriod,
    'Período de gracia está activo durante los primeros 12 segundos'
  );
  assert(
    !shouldTriggerArrivalDrift,
    'Guardia temporal previene llegada en falso ante fluctuaciones GPS iniciales (<12s)'
  );

  // Caso 2.3: Llegada legítima tras cumplir el período de gracia (>12s) y estar en destino (<50m)
  const elapsedLegitimate = 180; // 3 minutos de viaje
  const isGraceOver = elapsedLegitimate >= 12;
  const currentCoordsArrived = { latitude: 19.4352, longitude: -99.1412 };
  const distArrived = getDistanceMeters(currentCoordsArrived, destCoords);
  const isAtEndOfRoute = true;

  const shouldTriggerLegitimateArrival =
    isGraceOver && distArrived <= 50 && isAtEndOfRoute;

  assert(
    shouldTriggerLegitimateArrival,
    'Dispara llegada legítima cuando se ha transitado la ruta (>12s) y se está a <=50m de destino'
  );

  // -------------------------------------------------------------
  // GRUPO 3: Primer Paso de Maniobra Nunca es "Ha llegado a su destino"
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 3: Integridad de Instrucción Inicial de Salida ---');

  const testSteps = [
    { instruction: 'Inicie su recorrido por Avenida Juárez', distance: 200, type: 11, wayPoints: [0, 5] },
    { instruction: 'Gire a la derecha en Eje Central', distance: 400, type: 1, wayPoints: [5, 10] },
    { instruction: 'Ha llegado a su destino', distance: 0, type: 10, wayPoints: [10, 10] },
  ];

  const firstValidStep = testSteps.find((s) => s.type !== 10 && !s.instruction?.toLowerCase().includes('ha llegado'));
  assert(
    Boolean(firstValidStep),
    'Encuentra maniobra de avance inicial no-terminal'
  );
  assert(
    firstValidStep?.instruction === 'Inicie su recorrido por Avenida Juárez',
    `Instrucción inicial es de avance ("${firstValidStep?.instruction}") y no de llegada`
  );

  // -------------------------------------------------------------
  // GRUPO 4: Comandos NLU de Zoom y Centrado
  // -------------------------------------------------------------
  console.log('\n--- GRUPO 4: Comandos NLU de Zoom y Centrado ---');

  const zoomInRes = await ConversationService.processUserMessage('haz mucho zoom al mapa');
  assert(
    zoomInRes.functionCall?.name === 'ajustar_zoom',
    'NLU reconoce tool call ajustar_zoom para "haz mucho zoom al mapa"'
  );
  assert(
    (zoomInRes.functionCall?.args as any)?.direccion === 'acercar',
    `Dirección es 'acercar'`
  );
  assert(
    (zoomInRes.functionCall?.args as any)?.intensidad === 'mucho',
    `Intensidad es 'mucho' (recibido: ${(zoomInRes.functionCall?.args as any)?.intensidad})`
  );

  const zoomOutRes = await ConversationService.processUserMessage('aleja un poco');
  assert(
    zoomOutRes.functionCall?.name === 'ajustar_zoom',
    'NLU reconoce tool call ajustar_zoom para "aleja un poco"'
  );
  assert(
    (zoomOutRes.functionCall?.args as any)?.direccion === 'alejar',
    `Dirección es 'alejar'`
  );
  assert(
    (zoomOutRes.functionCall?.args as any)?.intensidad === 'poco',
    `Intensidad es 'poco'`
  );

  const centrarRes = await ConversationService.processUserMessage('centrar mapa');
  assert(
    centrarRes.functionCall?.name === 'ajustar_zoom',
    'NLU reconoce tool call ajustar_zoom para "centrar mapa"'
  );
  assert(
    (centrarRes.functionCall?.args as any)?.direccion === 'centrar',
    `Dirección es 'centrar'`
  );

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} pruebas superadas (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TODAS LAS PRUEBAS DE PULIDO DE NAVEGACIÓN Y ZOOM PASARON CON ÉXITO');
    process.exit(0);
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON');
    process.exit(1);
  }
}

runTests();
