/**
 * Test Suite: Validación de Optimizaciones Fase 1 (APIs de Navegación AVAN)
 *
 * Certifica:
 * 1. Proyección a la calzada vial (Snap-to-Road con snapPointToPolyline).
 * 2. Cálculo dinámico de ETA usando step.duration provisto por la API de ruteo.
 * 3. Geocodificación concurrente y Caché LRU en memoria (0ms en hits).
 * 4. Geocodificación inversa (reverseGeocode API de Nominatim).
 * 5. Snapping vial con API OSRM Nearest (snapToRoad).
 */

import {
  NavigationService,
  snapPointToPolyline,
  projectPointToSegment,
} from './src/services/navigationService';
import {
  orsService,
  OpenRouteService,
  StepInstruction,
  Coordinates,
} from './src/services/orsService';

async function runPhase1Tests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TEST SUITE: FASE 1 - OPTIMIZACIÓN DE APIS DE NAVEGACIÓN');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${testName}`);
    } else {
      console.error(`❌ [FAIL] ${testName}`, details ? details : '');
    }
  }

  // --------------------------------------------------------------------------
  // GRUPO 1: SNAP-TO-ROAD Y PROYECCIÓN A LA CALZADA VIAL
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: Pruebas de Snap-to-Road (snapPointToPolyline) ---');

  // Tramo vial de prueba: Av. Paseo de la Reforma de Insurgentes a Glorieta de la Palma
  const routeSample: Coordinates[] = [
    { latitude: 19.4320, longitude: -99.1550 },
    { latitude: 19.4300, longitude: -99.1600 },
    { latitude: 19.4280, longitude: -99.1650 },
  ];

  // Punto con ligero jitter de GPS (a ~12 metros a un lado de la calle)
  const gpsWithJitter: Coordinates = { latitude: 19.4311, longitude: -99.1574 };
  const snapResult = snapPointToPolyline(gpsWithJitter, routeSample, 35);

  assert(snapResult.isSnapped === true, 'Ajusta coordenada con jitter dentro del radio de 35m');
  assert(
    snapResult.distanceToRoad < 20,
    `Calcula distancia a la calzada con precisión (<20m): ${snapResult.distanceToRoad}m`
  );
  assert(
    snapResult.snappedPoint.latitude !== gpsWithJitter.latitude,
    'Coordenada proyectada difiere del GPS ruidoso para alinearse al asfalto'
  );

  // Punto claramente desviado (>80 metros, fuera del radio de snapping)
  const offRoadPoint: Coordinates = { latitude: 19.4380, longitude: -99.1550 };
  const offRoadSnap = snapPointToPolyline(offRoadPoint, routeSample, 35);
  assert(offRoadSnap.isSnapped === false, 'No hace snap si el punto está fuera de la tolerancia (>35m)');
  assert(
    offRoadSnap.snappedPoint.latitude === offRoadPoint.latitude,
    'Preserva la coordenada original si excede el umbral para permitir detección de desvío'
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: TURN-BY-TURN Y ETA DINÁMICO DESDE LA API
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: ETA Dinámico y Duración de API (evaluateProgress) ---');

  const stepsSample: StepInstruction[] = [
    {
      instruction: 'Avance recto por Avenida Paseo de la Reforma',
      distance: 1000,
      duration: 120, // 2 minutos calculados por la API (50 km/h)
      type: 6,
      name: 'Paseo de la Reforma',
      wayPoints: [0, 1],
    },
    {
      instruction: 'Gire a la derecha en Avenida Florencia',
      distance: 500,
      duration: 150, // 2.5 minutos calculados por la API (zona lenta 12 km/h con semáforos)
      type: 1,
      name: 'Florencia',
      wayPoints: [1, 2],
    },
  ];

  // Usuario a 500 metros de la primera maniobra (mitad del primer paso)
  const midPoint: Coordinates = { latitude: 19.4310, longitude: -99.1575 };
  const progress = NavigationService.evaluateProgress(
    midPoint,
    routeSample,
    routeSample[2],
    stepsSample,
    0
  );

  // Distancia restante: ~285m hasta la primera maniobra + 500m del segundo paso = ~785m
  // Duración estimada con API: proporción del paso 1 (~34s) + 150s paso 2 = ~184s (>180s por tramo lento en Florencia).
  assert(
    progress.remainingDistance > 700 && progress.remainingDistance < 900,
    `Distancia restante calculada correctamente (${progress.remainingDistance}m)`
  );
  assert(
    progress.remainingDuration > 180,
    `ETA dinámico refleja el tiempo real de la API (${progress.remainingDuration}s, >180s por tramo lento en lugar de 30 km/h plano)`
  );
  assert(progress.formattedRemainingDuration.includes('min'), 'Formato legible en minutos para adulto mayor');

  // --------------------------------------------------------------------------
  // GRUPO 3: CACHÉ LRU Y CONCURRENCIA DE GEOCODIFICACIÓN
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 3: Rendimiento de Caché LRU de Geocodificación ---');

  const t0 = Date.now();
  const firstCall = await orsService.geocodeDestination('Reforma 222');
  const t1 = Date.now();
  const firstDuration = t1 - t0;

  const t2 = Date.now();
  const cachedCall = await orsService.geocodeDestination('Reforma 222');
  const t3 = Date.now();
  const cachedDuration = t3 - t2;

  assert(firstCall.length > 0, 'Primera llamada a geocodeDestination exitosa');
  assert(cachedCall.length > 0, 'Llamada desde caché exitosa');
  assert(
    cachedDuration < 15,
    `Caché LRU responde en tiempo récord (<15ms, actual: ${cachedDuration}ms vs ${firstDuration}ms inicial)`
  );

  // --------------------------------------------------------------------------
  // GRUPO 4: REVERSE GEOCODING API (reverseGeocode)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 4: Geocodificación Inversa (reverseGeocode) ---');

  // Coordenadas del Zócalo de la CDMX (19.4326, -99.1332)
  const revResult = await orsService.reverseGeocode({ latitude: 19.4326, longitude: -99.1332 });
  assert(revResult !== null, 'reverseGeocode devolvió resultado válido para el Zócalo');
  if (revResult) {
    const isZocaloOrCentro = /constituci[oó]n|z[oó]calo|centro/i.test(revResult.label);
    assert(isZocaloOrCentro, `Identifica calzada o zona en dirección humana: "${revResult.label}"`);
  }

  // --------------------------------------------------------------------------
  // GRUPO 5: SNAPPING CON API OSRM NEAREST (snapToRoad)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 5: API de Snap to Road (snapToRoad) ---');

  const snapRoadRes = await orsService.snapToRoad({ latitude: 19.4326, longitude: -99.1332 });
  assert(snapRoadRes !== null, 'snapToRoad conectó exitosamente con la API OSRM Nearest');
  if (snapRoadRes) {
    assert(
      typeof snapRoadRes.distanceMeters === 'number',
      `Calcula distancia a la calzada con la API: ${snapRoadRes.distanceMeters}m`
    );
    assert(
      Boolean(snapRoadRes.streetName),
      `Nombre vial retornado por la API: "${snapRoadRes.streetName}"`
    );
  }

  // --------------------------------------------------------------------------
  // RESUMEN
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 RESULTADO FASE 1: ${passedTests}/${totalTests} pruebas superadas (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 FASE 1 CERTIFICADA AL 100% EXITOSAMENTE.');
  } else {
    process.exit(1);
  }
}

runPhase1Tests().catch((err) => {
  console.error('Error durante la ejecución del test suite:', err);
  process.exit(1);
});
