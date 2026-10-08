/**
 * Test Suite: Validación de Precisión Predial y Geocodificación Estructurada (TASK-41)
 *
 * Evalúa:
 * 1. Descomposición sintáctica precisa de direcciones en CDMX con parseStructuredAddress.
 * 2. Geocodificación multi-tier resiliente (ORS, Nominatim, Photon) con tagging de precisión:
 *    - 'exact': número exterior o predio catalogado / POI específico.
 *    - 'street': anclaje vial en la calle dentro de la colonia indicada (Street Segment Fallback).
 * 3. Manejo de cruces e intersecciones viales ("Sonora casi esquina con Ámsterdam").
 * 4. Integridad de candidatos de desambiguación.
 */

import {
  parseStructuredAddress,
  orsService,
  StructuredAddressQuery,
  GeocodeResult,
} from './src/services/orsService';

async function runPrecisionTests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TEST SUITE: PRECISIÓN PREDIAL Y CALLES AVAN (TASK-41)');
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
  // GRUPO 1: PARSEO ESTRUCTURADO (parseStructuredAddress)
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: Pruebas Unitarias de parseStructuredAddress ---');

  const p1 = parseStructuredAddress('Sonora 120, Condesa');
  assert(
    Boolean(p1.street.toLowerCase().includes('sonora') && p1.houseNumber === '120' && p1.colonia?.toLowerCase().includes('condesa')),
    'Parsea "Sonora 120, Condesa" extrayendo calle, número y colonia',
    p1
  );

  const p2 = parseStructuredAddress('División del Norte 1422, Benito Juárez');
  assert(
    Boolean(p2.street.toLowerCase().includes('division del norte') || p2.street.toLowerCase().includes('división del norte')),
    'Parsea "División del Norte 1422, Benito Juárez" reconociendo calle larga',
    p2
  );
  assert(p2.houseNumber === '1422', 'Extrae número 1422', p2);
  assert(Boolean(p2.alcaldia?.toLowerCase().includes('benito juarez') || p2.alcaldia?.toLowerCase().includes('benito juárez')), 'Extrae alcaldía Benito Juárez', p2);

  const p3 = parseStructuredAddress('Sonora casi esquina con Ámsterdam, Condesa');
  assert(
    Boolean(
      p3.street.toLowerCase().includes('sonora') &&
      (p3.crossStreet?.toLowerCase().includes('amsterdam') || p3.crossStreet?.toLowerCase().includes('ámsterdam')) &&
      p3.colonia?.toLowerCase().includes('condesa')
    ),
    'Parsea cruce e intersección vial "Sonora casi esquina con Ámsterdam, Condesa"',
    p3
  );

  const p4 = parseStructuredAddress('Calle 5 de Mayo número 10, Centro Histórico');
  assert(
    Boolean(p4.street.toLowerCase().includes('5 de mayo') && p4.houseNumber === '10' && p4.colonia?.toLowerCase().includes('centro')),
    'Parsea número con prefijo "número" y calle con número en el nombre ("5 de Mayo 10")',
    p4
  );

  const p5 = parseStructuredAddress('allá por la Roma Norte en Puebla 45');
  assert(
    Boolean(p5.street.toLowerCase().includes('puebla') && p5.houseNumber === '45' && p5.colonia?.toLowerCase().includes('roma')),
    'Limpia muletillas y asocia calle y colonia desordenadas ("allá por la Roma Norte en Puebla 45")',
    p5
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: GEOCODIFICACIÓN REAL EN LÍNEA Y DEGENERACIÓN PROGRESIVA
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: Geocodificación y Clasificación de Precisión (orsService.geocodeDestination) ---');

  try {
    // 1. Predio con número exacto (Avenida 5 de Mayo 10, Centro)
    console.log('\nConsultando "5 de Mayo 10, Centro"...');
    const res1 = await orsService.geocodeDestination('5 de Mayo 10, Centro');
    assert(res1.length > 0, 'Devuelve al menos 1 resultado para "5 de Mayo 10, Centro"');
    if (res1.length > 0) {
      const top = res1[0];
      const isCdmx = top.coordinates.latitude > 19.2 && top.coordinates.latitude < 19.6 && top.coordinates.longitude < -98.9 && top.coordinates.longitude > -99.4;
      assert(isCdmx, 'Coordenadas están dentro de la Zona Metropolitana de CDMX', top.coordinates);
      assert(top.precision === 'exact' || top.precision === 'street', `Asigna precisión '${top.precision}' (exact o street)`);
    }

    // 2. Calle y número donde OSM puede no tener el predio exacto pero sí la calle en la colonia (Sonora 120, Condesa)
    console.log('\nConsultando "Sonora 120, Condesa"...');
    const res2 = await orsService.geocodeDestination('Sonora 120, Condesa');
    assert(res2.length > 0, 'Devuelve resultados para "Sonora 120, Condesa"');
    if (res2.length > 0) {
      const top = res2[0];
      // Sonora en Condesa está alrededor de lat ~19.41-19.42, lon ~ -99.16 a -99.17
      const isCondesaArea = top.coordinates.latitude > 19.40 && top.coordinates.latitude < 19.43 && top.coordinates.longitude < -99.15 && top.coordinates.longitude > -99.19;
      assert(isCondesaArea, 'Street Segment Fallback: Ubica la calle Sonora en la zona de Condesa/Hipódromo (no en el Zócalo ni en otro municipio)', top);
      assert(top.precision === 'exact' || top.precision === 'street', `Precisión es '${top.precision}' evitando 'approximate' de colonia`);
    }

    // 3. Cruce vial (Sonora casi esquina con Ámsterdam, Condesa)
    console.log('\nConsultando cruce vial "Sonora casi esquina con Ámsterdam, Condesa"...');
    const res3 = await orsService.geocodeDestination('Sonora casi esquina con Ámsterdam, Condesa');
    assert(res3.length > 0, 'Devuelve resultados para cruce "Sonora esquina con Ámsterdam"');
    if (res3.length > 0) {
      const top = res3[0];
      const isCondesaArea = top.coordinates.latitude > 19.40 && top.coordinates.latitude < 19.43;
      assert(isCondesaArea, 'Ubica la intersección vial dentro del perímetro de Condesa', top.coordinates);
    }

    // 4. Landmark o POI de alta fidelidad (Palacio de Bellas Artes)
    console.log('\nConsultando landmark "Bellas Artes"...');
    const res4 = await orsService.geocodeDestination('Bellas Artes');
    assert(res4.length > 0, 'Devuelve POI curado para Bellas Artes');
    if (res4.length > 0) {
      assert(res4[0].precision === 'exact', 'Landmark curado tiene precision="exact"', res4[0].precision);
    }

    // --------------------------------------------------------------------------
    // GRUPO 3: DESAMBIGUACIÓN CON CANDIDATOS Y PRECISIÓN PRESERVADA
    // --------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: Desambiguación y Preservación de Precisión ---');
    const disRes = await orsService.getDisambiguationCandidates('Sonora 120, Condesa');
    assert(disRes.candidates.length > 0, 'getDisambiguationCandidates devuelve candidatos para consulta estructurada');
    if (disRes.candidates.length > 0) {
      assert(disRes.candidates[0].precision !== undefined, `Candidato preserva campo precision: ${disRes.candidates[0].precision}`);
    }

  } catch (err) {
    console.error('Error durante la ejecución de pruebas en red:', err);
  }

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} pruebas superadas (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TODAS LAS PRUEBAS DE PRECISIÓN PREDIAL PASARON EXITOSAMENTE.');
    process.exit(0);
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON.');
    process.exit(1);
  }
}

runPrecisionTests();
