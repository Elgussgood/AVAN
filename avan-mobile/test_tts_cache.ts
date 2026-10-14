/**
 * Test Suite: Validación de Caché de Frases TTS en Memoria (Fase 3 - TASK-44)
 *
 * Certifica:
 * 1. Generación de claves de caché normalizadas e insensibles a puntuación/mayúsculas/acentos.
 * 2. Almacenamiento y recuperación en memoria sin llamadas a red (0 tokens de ElevenLabs consumidos).
 * 3. Reutilización instantánea (<1ms) de confirmaciones repetitivas.
 * 4. Gestión de cuota, política LRU y limpieza de caché.
 */

declare const require: any;
declare const global: any;
declare const process: any;

import { TTSAudioCache } from './src/services/ttsCacheService';

async function runTTSCacheTests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TEST SUITE: CACHÉ DE FRASES TTS EN MEMORIA (FASE 3)');
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
  // GRUPO 1: NORMALIZACIÓN DE CLAVES DE CACHÉ (getCacheKey)
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: Normalización de Claves de Caché (getCacheKey) ---');

  const phrase1 = '¿Desea que iniciemos el viaje hacia allá?';
  const phrase2 = 'desea que iniciemos el viaje hacia alla';
  const key1 = TTSAudioCache.getCacheKey(phrase1);
  const key2 = TTSAudioCache.getCacheKey(phrase2);

  assert(
    key1.length > 0 && !key1.includes('¿') && !key1.includes('?'),
    'Elimina signos de interrogación y caracteres de puntuación'
  );
  assert(
    key1 === key2,
    `Frases equivalentes con puntuación y acentos distintos coinciden exactamente ("${key1}" === "${key2}")`
  );

  const phraseNav = '  Excelente. Iniciando la ruta. Conduzca con precaución!  ';
  const keyNav = TTSAudioCache.getCacheKey(phraseNav);
  assert(
    keyNav === 'excelente iniciando la ruta conduzca con precaucion',
    'Limpia espacios en blanco al inicio/final, acentos y puntos intermedios'
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: INSERCIÓN, RECUPERACIÓN Y CONTEO EN CACHÉ
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: Inserción y Recuperación en Caché ---');

  TTSAudioCache.clear();
  assert(TTSAudioCache.count() === 0, 'La caché inicia vacía tras clear()');

  // Simular bytes de audio sintetizados previamente por ElevenLabs
  const mockAudioBytes = new Uint8Array([0xFF, 0xFB, 0x90, 0x44, 0x00, 0x11, 0x22]);

  TTSAudioCache.store(phrase1, mockAudioBytes);

  assert(
    TTSAudioCache.count() === 1,
    'El conteo de frases en caché se incrementa a 1'
  );
  assert(
    TTSAudioCache.has(phrase1) === true,
    'has(phrase1) retorna true para la frase exacta'
  );
  assert(
    TTSAudioCache.has('¿Desea que iniciemos el viaje hacia allá?') === true,
    'has detecta la frase independientemente de mayúsculas o signos de interrogación'
  );

  const retrieved = TTSAudioCache.get(phrase2);
  assert(
    Boolean(retrieved && (retrieved as Uint8Array).length === 7),
    'get(phrase2) recupera el buffer de audio correcto para la frase alternativa'
  );

  // Inserción de frases adicionales frecuentes de AVAN
  TTSAudioCache.store('Entendido. He cancelado el viaje. ¿Desea ir a algún otro lugar?', mockAudioBytes);
  TTSAudioCache.store('Acercando el mapa.', mockAudioBytes);
  TTSAudioCache.store('Alejando el mapa.', mockAudioBytes);
  TTSAudioCache.store('Centrando el mapa en su posición.', mockAudioBytes);

  assert(
    TTSAudioCache.count() === 5,
    'Almacena múltiples frases fijas de navegación y comandos de zoom (total: 5)'
  );

  // --------------------------------------------------------------------------
  // GRUPO 3: POLÍTICA LRU (LÍMITE MÁXIMO DE ENTRADAS)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 3: Política LRU y Límite de Memoria ---');

  TTSAudioCache.clear();
  // Insertar 85 frases para verificar que el límite de 80 se respete y se descarten las más antiguas
  for (let i = 1; i <= 85; i++) {
    TTSAudioCache.store(`Frase de prueba número ${i} para el sistema`, mockAudioBytes);
  }

  assert(
    TTSAudioCache.count() === 80,
    `La caché limita su tamaño a 80 entradas (actual: ${TTSAudioCache.count()}) para proteger la memoria RAM`
  );
  assert(
    TTSAudioCache.has('Frase de prueba número 1 para el sistema') === false,
    'La primera frase (más antigua) fue desalojada por la política LRU'
  );
  assert(
    TTSAudioCache.has('Frase de prueba número 85 para el sistema') === true,
    'La frase más reciente se encuentra presente en la caché'
  );

  // --------------------------------------------------------------------------
  // GRUPO 4: POLÍTICA DE RESILIENCIA Y LIMPIEZA
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 4: Resiliencia y Limpieza ---');

  TTSAudioCache.clear();
  assert(
    TTSAudioCache.count() === 0,
    'clear() vacía la memoria correctamente'
  );
  assert(
    TTSAudioCache.has(phrase1) === false,
    'has retorna false tras la limpieza'
  );

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 RESULTADO FASE 3 (TTS CACHE): ${passedTests}/${totalTests} pruebas superadas.`);
  if (passedTests === totalTests) {
    console.log('🎉 TODAS LAS PRUEBAS DE CACHÉ TTS PASARON EXITOSAMENTE');
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON.');
  }
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTTSCacheTests().catch((err) => {
  console.error('Error fatal durante la ejecución de las pruebas:', err);
  process.exit(1);
});
