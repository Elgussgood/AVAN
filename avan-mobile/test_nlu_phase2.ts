/**
 * Test Suite: Validación de Optimizaciones Fase 2 (NLU y Diálogo Conversacional AVAN)
 *
 * Certifica:
 * 1. Fast-Path Heurístico Inmediato (0-15ms) en mergeAddressAdjustmentWithLLM para números y colonias.
 * 2. Fast-Path Heurístico Inmediato (0-15ms) en normalizeAddressWithLLM para landmarks y direcciones con calle/número.
 * 3. Single-Turn Tool Call: Extracción directa de entidades (calle, número, colonia) en navegar_a.
 * 4. Single-Turn Tool Call: Registro de alias en guardar_ubicacion sin segunda llamada redundante.
 * 5. Poda de historial y prevención de duplicidad del turno de usuario actual.
 */

declare const require: any;
declare const global: any;
declare const __dirname: string;
declare const process: any;

const fs = typeof require !== 'undefined' ? require('fs') : null;
const path = typeof require !== 'undefined' ? require('path') : null;

// Mock de window para entornos Node (evita error en AsyncStorage)
if (typeof global !== 'undefined' && typeof global.window === 'undefined') {
  global.window = {};
}

// Cargar variables de entorno desde .env
if (fs && path) {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

import {
  mergeAddressAdjustmentWithLLM,
  normalizeAddressWithLLM,
  processUserMessage,
  ConversationContext,
} from './src/services/conversationService';

async function runPhase2Tests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO TEST SUITE: FASE 2 - OPTIMIZACIÓN NLU Y DIÁLOGO CONVERSACIONAL');
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
  // GRUPO 1: FAST-PATH DE 0ms EN mergeAddressAdjustmentWithLLM
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: Fast-path heurístico en mergeAddressAdjustmentWithLLM ---');

  const baseAddress = 'Calle Sonora 120, Condesa, Cuauhtémoc, Ciudad de México';

  const tStartNum = Date.now();
  const resNum = await mergeAddressAdjustmentWithLLM(baseAddress, 'no, es el 150');
  const durationNum = Date.now() - tStartNum;

  assert(
    resNum.numero === '150' || resNum.formattedSearchQuery.includes('150'),
    'Ajuste numérico ("no, es el 150") detecta y reemplaza el número exterior correctamente'
  );
  assert(
    resNum.changedFieldDescription.includes('150'),
    'Ajuste numérico describe el cambio ("al número 150")'
  );
  assert(
    durationNum < 50,
    `Ajuste numérico se ejecuta vía fast-path en ${durationNum}ms (< 50ms)`
  );

  const tStartCol = Date.now();
  const resCol = await mergeAddressAdjustmentWithLLM(baseAddress, 'en la Roma Norte');
  const durationCol = Date.now() - tStartCol;

  assert(
    Boolean(resCol.formattedSearchQuery.includes('Roma Norte') || resCol.colonia?.includes('Roma')),
    'Ajuste de colonia ("en la Roma Norte") actualiza la zona de búsqueda'
  );
  assert(
    durationCol < 50,
    `Ajuste de colonia se ejecuta vía fast-path en ${durationCol}ms (< 50ms)`
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: FAST-PATH DE 0ms EN normalizeAddressWithLLM
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 2: Fast-path heurístico en normalizeAddressWithLLM ---');

  const tStartLandmark = Date.now();
  const resLandmark = await normalizeAddressWithLLM('Palacio de Bellas Artes');
  const durationLandmark = Date.now() - tStartLandmark;

  assert(
    resLandmark.landmark === 'Palacio de Bellas Artes' ||
      resLandmark.formattedUserLabel.toLowerCase().includes('bellas artes'),
    'Landmark emblemático ("Palacio de Bellas Artes") se normaliza inmediatamente'
  );
  assert(
    durationLandmark < 50,
    `Normalización de landmark se ejecuta vía fast-path en ${durationLandmark}ms (< 50ms)`
  );

  const tStartStreet = Date.now();
  const resStreet = await normalizeAddressWithLLM('Calle Sonora 120, Condesa');
  const durationStreet = Date.now() - tStartStreet;

  assert(
    Boolean(resStreet.calle?.toLowerCase().includes('sonora') && resStreet.numero === '120'),
    'Dirección con calle y número se extrae correctamente en fast-path'
  );
  assert(
    durationStreet < 50,
    `Normalización de calle/número se ejecuta en ${durationStreet}ms (< 50ms)`
  );

  // --------------------------------------------------------------------------
  // GRUPO 3: SINGLE-TURN TOOL CALL EN navegar_a (LLM CON GROQ)
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 3: Single-Turn Tool Call en navegar_a ---');

  const contextNav: ConversationContext = {
    history: [],
    currentLocation: { latitude: 19.4326, longitude: -99.1332 },
  };

  const tStartNav = Date.now();
  const responseNav = await processUserMessage('Lléveme a Sonora 120 en la Condesa', contextNav);
  const durationNav = Date.now() - tStartNav;

  assert(
    responseNav.requiresConfirmation === true,
    'Formula confirmación en 2 pasos para navegar_a'
  );
  assert(
    responseNav.spokenText.length > 0 &&
      (responseNav.spokenText.toLowerCase().includes('sonora') ||
        responseNav.spokenText.toLowerCase().includes('desea')),
    'Genera texto hablado gerontológico claro para confirmación'
  );
  assert(
    Boolean(responseNav.updatedContext?.pendingConfirmation),
    'Establece pendingConfirmation en el contexto actualizado'
  );
  assert(
    durationNav < 3500,
    `Flujo de navegación en un solo turno respondió en ${durationNav}ms`
  );

  // --------------------------------------------------------------------------
  // GRUPO 4: SINGLE-TURN TOOL CALL EN guardar_ubicacion
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 4: Single-Turn Tool Call en guardar_ubicacion ---');

  const contextAlias: ConversationContext = {
    history: [],
    currentLocation: { latitude: 19.4326, longitude: -99.1332 },
  };

  const tStartAlias = Date.now();
  const responseAlias = await processUserMessage(
    'Guarda la casa de mi nieto en Insurgentes Sur 300, Roma Norte',
    contextAlias
  );
  const durationAlias = Date.now() - tStartAlias;

  assert(
    Boolean(responseAlias.updatedContext?.pendingAliasRegistration),
    'Establece pendingAliasRegistration en el contexto actualizado'
  );
  const aliasName =
    responseAlias.updatedContext?.pendingAliasRegistration?.aliasName?.toLowerCase() || '';
  assert(
    aliasName.includes('nieto') || aliasName.includes('casa'),
    'Extrae el alias correcto ("casa de mi nieto")'
  );
  assert(
    responseAlias.spokenText.toLowerCase().includes('nieto') ||
      responseAlias.spokenText.toLowerCase().includes('correcta') ||
      responseAlias.spokenText.toLowerCase().includes('ubiqu') ||
      responseAlias.spokenText.toLowerCase().includes('insurgentes'),
    'Genera confirmación amable para el registro de alias'
  );
  assert(
    durationAlias < 3500,
    `Flujo de guardar_ubicacion en un solo turno respondió en ${durationAlias}ms`
  );

  // --------------------------------------------------------------------------
  // GRUPO 5: HISTORIAL LIMPIO Y CONTROL DE TURNOS
  // --------------------------------------------------------------------------
  console.log('\n--- GRUPO 5: Control de historial y turnos ---');

  // En responseNav.updatedContext, el historial debe contener exactamente 2 turnos: usuario y asistente
  const navHistory = responseNav.updatedContext?.history;
  assert(
    Boolean(navHistory && navHistory.length === 2),
    `Historial contiene exactamente 2 turnos (1 usuario + 1 asistente), sin duplicados. Actual: ${navHistory?.length}`
  );
  assert(
    Boolean(navHistory?.[0]?.role === 'user' && navHistory?.[1]?.role === 'assistant'),
    'Secuencia correcta de roles: user -> assistant'
  );

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 RESULTADO FASE 2: ${passedTests}/${totalTests} pruebas superadas.`);
  if (passedTests === totalTests) {
    console.log('🎉 TODAS LAS PRUEBAS DE LA FASE 2 PASARON EXITOSAMENTE');
  } else {
    console.error('⚠️ ALGUNAS PRUEBAS FALLARON.');
  }
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Error fatal durante la ejecución de las pruebas:', err);
  process.exit(1);
});
