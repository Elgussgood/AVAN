/**
 * Servicio Conversacional y NLU con Function Calling para AVAN.
 *
 * Diseñado bajo principios de diseño gerontológico:
 * - Tono cálido, paciente, empático y respetuoso (sin infantilizar).
 * - Respuestas directas, concisas y fáciles de comprender (máximo 1-2 oraciones).
 * - Confirmación explícita en 2 pasos para iniciar viajes.
 * - Integración con LLM de Groq (llama-3.3-70b-versatile) con Function Calling.
 * - Fallback infalible a motor local de heurísticas ante problemas de red o latencia.
 * - Resolución automática de alias y registro asistido (T-2.2).
 * - Rigurosidad reforzada en viajes foráneos / carretera >50 km (T-2.3).
 * - Comandos de tráfico e incidentes en marcha (T-2.4).
 * - Diálogo de continuidad al finalizar viaje (T-2.5).
 */

import {
  AliasService,
  SavedAlias,
  aliasService,
} from './aliasService';
import { orsService } from './orsService';

// ============================================================================
// CONFIGURACIÓN DE GROQ LLM
// ============================================================================

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_TIMEOUT_MS = 4000; // Timeout de 4 segundos para evitar demoras en voz

// ============================================================================
// TIPOS Y DEFINICIONES DE HERRAMIENTAS (TOOLS)
// ============================================================================

export type ToolName =
  | 'navegar_a'
  | 'guardar_ubicacion'
  | 'ajustar_zoom'
  | 'confirmar_viaje'
  | 'cancelar'
  | 'consultar_trafico'
  | 'reportar_incidente'
  | 'finalizar_viaje';

export type ZoomDirection = 'acercar' | 'alejar' | 'centrar';

/**
 * Argumentos para la herramienta navegar_a
 */
export interface NavegarAArgs {
  /** Nombre del destino, dirección o punto de interés */
  destino: string;
  /** Coordenadas opcionales si provienen de un alias */
  latitud?: number;
  longitud?: number;
  /** Indica si es un viaje foráneo en carretera (>50 km) */
  isForaneo?: boolean;
}

/**
 * Argumentos para la herramienta guardar_ubicacion
 */
export interface GuardarUbicacionArgs {
  /** Nombre o alias de referencia para la ubicación (ej. 'casa', 'farmacia') */
  alias: string;
  /** Coordenada de latitud opcional */
  latitud?: number;
  /** Coordenada de longitud opcional */
  longitud?: number;
  /** Dirección física opcional */
  direccion?: string;
}

/**
 * Argumentos para la herramienta ajustar_zoom
 */
export interface AjustarZoomArgs {
  /** Dirección del zoom en el mapa o centrado */
  direccion: ZoomDirection;
}

/**
 * Argumentos para la herramienta confirmar_viaje
 */
export interface ConfirmarViajeArgs {
  /** Destino que se está confirmando (opcional, recuperado del contexto) */
  destino?: string;
  /** Indica si es un viaje foráneo en carretera */
  isForaneo?: boolean;
  latitud?: number;
  longitud?: number;
}

/**
 * Argumentos para la herramienta cancelar
 */
export interface CancelarArgs {
  /** Motivo opcional de la cancelación */
  motivo?: string;
}

/**
 * Argumentos para consultar_trafico
 */
export interface ConsultarTraficoArgs {
  ruta?: string;
}

/**
 * Argumentos para reportar_incidente
 */
export interface ReportarIncidenteArgs {
  tipo: 'accidente' | 'trafico' | 'obras' | 'bache' | 'general' | string;
  descripcion?: string;
}

/**
 * Argumentos para finalizar_viaje
 */
export interface FinalizarViajeArgs {
  destino?: string;
}

/**
 * Llamada a función tipada con discriminante
 */
export type FunctionCall =
  | { name: 'navegar_a'; args: NavegarAArgs }
  | { name: 'guardar_ubicacion'; args: GuardarUbicacionArgs }
  | { name: 'ajustar_zoom'; args: AjustarZoomArgs }
  | { name: 'confirmar_viaje'; args: ConfirmarViajeArgs }
  | { name: 'cancelar'; args: CancelarArgs }
  | { name: 'consultar_trafico'; args: ConsultarTraficoArgs }
  | { name: 'reportar_incidente'; args: ReportarIncidenteArgs }
  | { name: 'finalizar_viaje'; args: FinalizarViajeArgs };

/**
 * Definición estándar JSON Schema de herramientas para LLMs (OpenAI / Groq compatible)
 */
export interface ToolPropertySchema {
  type: string;
  description: string;
  enum?: readonly string[] | string[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: ToolName;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolPropertySchema>;
      required: readonly string[] | string[];
    };
  };
}

/**
 * Catálogo de herramientas disponibles en AVAN con especificación para Function Calling
 */
export const AVAN_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'navegar_a',
      description:
        'Calcula la ruta hacia un destino y formula la confirmación en dos pasos requerida antes de iniciar la navegación.',
      parameters: {
        type: 'object',
        properties: {
          destino: {
            type: 'string',
            description:
              'Nombre del lugar, dirección o punto de interés al que desea desplazarse el usuario.',
          },
        },
        required: ['destino'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'guardar_ubicacion',
      description:
        'Guarda una ubicación con un alias o etiqueta personalizada (ej. "casa", "doctor", "hijo").',
      parameters: {
        type: 'object',
        properties: {
          alias: {
            type: 'string',
            description:
              'Nombre, etiqueta o apodo para identificar la ubicación guardada (ej. "casa", "doctor", "hijo").',
          },
          direccion: {
            type: 'string',
            description: 'Dirección física o colonia completa del lugar.',
          },
        },
        required: ['alias'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ajustar_zoom',
      description:
        'Ajusta la visualización del mapa para mejorar la legibilidad visual o centrar la cámara en la posición actual.',
      parameters: {
        type: 'object',
        properties: {
          direccion: {
            type: 'string',
            enum: ['acercar', 'alejar', 'centrar'],
            description:
              'Acción visual: "acercar" para ampliar detalles, "alejar" para vista panorámica o "centrar" para volver a la posición actual del usuario.',
          },
        },
        required: ['direccion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirmar_viaje',
      description:
        'Confirma formalmente el inicio de la navegación hacia el destino tras la validación en 2 pasos.',
      parameters: {
        type: 'object',
        properties: {
          destino: {
            type: 'string',
            description: 'Nombre del destino confirmado para iniciar el viaje.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar',
      description:
        'Cancela la acción en curso, desiste de la confirmación pendiente de un viaje o detiene la navegación activa.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_trafico',
      description: 'Consulta el estado actual del tráfico en la ruta activa o vialidad actual.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reportar_incidente',
      description: 'Registra un reporte de incidente vial (accidente, choque, obras, tráfico pesado).',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            description: 'Tipo de incidente vial (accidente, choque, obras, trafico, etc.).',
          },
        },
        required: ['tipo'],
      },
    },
  },
] as const;

// ============================================================================
// CONTEXTO Y RESPUESTAS CONVERSACIONALES
// ============================================================================

export interface LocationCoordinate {
  latitude: number;
  longitude: number;
}

export interface SavedLocation {
  alias: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  createdAt?: number;
}

export interface PendingConfirmation {
  destination: string;
  timestamp: number;
  originalQuery?: string;
  isForaneo?: boolean;
  coordinates?: LocationCoordinate;
}

export interface PendingAliasRegistration {
  aliasName: string;
  step: 'awaiting_address' | 'confirming_address';
  addressCandidate?: string;
  coordinates?: LocationCoordinate;
  retryCount?: number;
  timestamp: number;
}

export interface PendingTripCompletion {
  destination: string;
  timestamp: number;
}

export interface ActiveRoute {
  destination: string;
  inProgress: boolean;
  startTime?: number;
  isForaneo?: boolean;
}

export interface MessageHistoryItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  functionCall?: FunctionCall | null;
  timestamp?: number;
}

export interface ConversationContext {
  userName?: string;
  currentLocation?: LocationCoordinate;
  pendingConfirmation?: PendingConfirmation | null;
  pendingAliasRegistration?: PendingAliasRegistration | null;
  pendingTripCompletion?: PendingTripCompletion | null;
  activeRoute?: ActiveRoute | null;
  savedLocations?: Record<string, SavedLocation>;
  history?: MessageHistoryItem[];
}

export interface ConversationResponse {
  /** Texto conciso y empático para síntesis de voz (TTS) */
  spokenText: string;
  /** Llamada a función generada para el sistema */
  functionCall?: FunctionCall | null;
  /** Contexto actualizado para mantener el estado del diálogo */
  updatedContext: ConversationContext;
  /** Indica si la conversación está a la espera de la confirmación explícita del usuario */
  requiresConfirmation?: boolean;
  /** Indica si la app debe mantener la escucha activa tras reproducir el mensaje */
  shouldAutoListen?: boolean;
}

// ============================================================================
// SYSTEM PROMPT GERONTOLÓGICO
// ============================================================================

export const GERONTOLOGICAL_SYSTEM_PROMPT = `
Eres AVAN, un asistente de voz y navegación vehicular para adultos mayores en México.

TUS DIRECTIVAS ESENCIALES:
1. Tono, trato y concordancia gramatical:
   - Trato formal de respeto estricto y consistente: dirígete SIEMPRE al usuario de "usted" (ejemplo: "dígame", "desea", "conduzca", "espere").
   - Queda estrictamente PROHIBIDO tutear al usuario (no uses "tú", "te escucho", "espera", "tu viaje", "toca").
   - Sé siempre cálido, empático, paciente y profundamente respetuoso.
   - NUNCA infantilices al usuario: queda estrictamente prohibido usar diminutivos condescendientes (ej. "abuelito", "viejito", "caminito", "carrerita").

2. Concisión y claridad cognitiva:
   - Tus respuestas deben ser DIRECTAS y de MÁXIMO 1 O 2 ORACIONES breves.
   - Evita la sobrecarga cognitiva, no uses tecnicismos ni des instrucciones complejas de golpe.

3. Protocolo de confirmación obligatoria en 2 pasos:
   - Cuando el usuario solicite ir a un destino nuevo, NUNCA inicies la navegación de inmediato.
   - Primero identifica el destino con la herramienta 'navegar_a(destino)' y pregunta amablemente para confirmar (ejemplo: "He localizado Bellas Artes. ¿Desea que iniciemos el viaje hacia allá?").
   - Advertencia especial para viajes foráneos (>50 km en carretera): si el destino es foráneo o de larga distancia (ej. Acapulco, Cuernavaca, Puebla, Toluca, Pachuca, Querétaro, Valle de Bravo), advierte la distancia y confirma con rigor: "Atención, este es un viaje foráneo en carretera a [Destino], a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?".
   - Solo cuando el usuario confirme afirmativamente (ej. "Sí", "Vamos", "Iniciar", "Por favor"), invoca 'confirmar_viaje'.

4. Protocolo de cancelación y continuidad:
   - Si el usuario pide cancelar un viaje o rechaza una confirmación de destino (ej. "No", "Cancela", "Ya no quiero ir"), invoca la herramienta 'cancelar'.
   - REGLA CRÍTICA DE CANCELACIÓN (PASO 1): Al cancelar un viaje o confirmación, NUNCA te despidas prematuramente (NO digas "hasta luego", "que tenga buen día" ni frases de despedida). Confirma la cancelación y pregunta amablemente de continuidad: "Entendido. He cancelado el viaje a [Destino]. ¿Desea ir a algún otro lugar?".
   - REGLA CRÍTICA DE CIERRE (PASO 2): Si ya le preguntaste al usuario "¿Desea ir a algún otro lugar?" y el usuario responde que no ("No", "No gracias", "Ninguno", "Ya no", "Para nada"), NO invoques ninguna herramienta; responde únicamente con una cálida despedida formal: "Excelente, que tenga un excelente día."

5. Herramientas del sistema:
   - navegar_a(destino: string): Calcula ruta y solicita confirmación.
   - guardar_ubicacion(alias: string, direccion?: string): Guarda un sitio frecuente o inicia el registro.
   - ajustar_zoom(direccion: 'acercar' | 'alejar' | 'centrar'): Adapta la vista del mapa.
   - confirmar_viaje(destino?: string): Inicia la marcha tras confirmación.
   - cancelar(): Cancela confirmación o detiene navegación activa.
   - consultar_trafico(): Informa sobre el estado del tráfico.
   - reportar_incidente(tipo: string): Registra incidente vial (accidente, obras, tráfico).

6. Directiva de Salto de Contexto Ubicuo y Flexibilidad Total:
   - El usuario puede cambiar de opinión o pedir cualquier acción desde cualquier pantalla o estado sin tener que cancelar manualmente el proceso anterior.
   - Si se estaba confirmando una dirección o registrando un alias y el usuario dice "Quiero ir a Chapultepec" o pide cualquier destino, DEBES invocar 'navegar_a(destino: "Chapultepec")'. El sistema cancelará el registro previo automáticamente.
   - Si se estaba por confirmar un viaje y el usuario dice "Quiero registrar una nueva dirección" o "Guarda la casa de mi hijo", DEBES invocar 'guardar_ubicacion'. El sistema cancelará la confirmación del viaje anterior automáticamente.
   - Si el usuario pide ajustar el mapa ("acercar", "alejar"), invoca 'ajustar_zoom'.
   - Atiende SIEMPRE la intención inmediata del usuario sin atraparlo en preguntas repetitivas ni forzar cancelaciones manuales.
`.trim();

// ============================================================================
// CONSTANTES Y LISTAS DE REFERENCIA PARA VIAJES FORÁNEOS
// ============================================================================

const KNOWN_FORANEO_DESTINATIONS = [
  'acapulco',
  'cuernavaca',
  'puebla',
  'toluca',
  'pachuca',
  'queretaro',
  'valle de bravo',
  'guadalajara',
  'veracruz',
  'oaxaca',
  'cancun',
  'morelia',
  'monterrey',
  'merida',
  'tepoztlan',
  'ixtapan de la sal',
  'san miguel de allende',
  'leon',
  'guanajuato',
  'tlaxcala',
  'tequisquiapan',
  'chalma',
  'malinalco',
  'ixmiquilpan',
  'san juan del rio',
  'acambaro',
  'celaya',
  'poza rica',
  'cordoba',
  'orizaba',
];

const CDMX_CENTER: LocationCoordinate = {
  latitude: 19.4326,
  longitude: -99.1332,
};

function calculateDistanceKm(
  coord1: LocationCoordinate,
  coord2: LocationCoordinate
): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
  const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.latitude * Math.PI) / 180) *
      Math.cos((coord2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isForaneoTrip(
  destinationName: string,
  destinationCoords?: LocationCoordinate,
  originCoords?: LocationCoordinate
): boolean {
  const normalizedDest = normalizeText(destinationName);

  if (KNOWN_FORANEO_DESTINATIONS.some((city) => normalizedDest.includes(city))) {
    return true;
  }

  if (destinationCoords) {
    const origin = originCoords || CDMX_CENTER;
    const distanceKm = calculateDistanceKm(origin, destinationCoords);
    if (distanceKm > 50) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// NLU LOCAL Y PARSERS AUXILIARES
// ============================================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAffirmative(normalized: string): boolean {
  const affirmativePatterns = [
    /^si\b/,
    /^si por favor\b/,
    /^vamos\b/,
    /^iniciar\b/,
    /^inicia\b/,
    /^iniciemos\b/,
    /^adelante\b/,
    /^de acuerdo\b/,
    /^esta bien\b/,
    /^claro\b/,
    /^claro que si\b/,
    /^por favor\b/,
    /^dale\b/,
    /^arranca\b/,
    /^arrancar\b/,
    /^comenzar\b/,
    /^comienza\b/,
    /^afirmativo\b/,
    /^proceder\b/,
    /^confirmar\b/,
    /^confirmo\b/,
    /^vamonos\b/,
    /^ok\b/,
    /^bueno\b/,
    /^sale\b/,
    /^andale\b/,
    /^perfecto\b/,
    /^correcto\b/,
    /^seguro\b/,
    /^estoy seguro\b/,
  ];

  return affirmativePatterns.some((pattern) => pattern.test(normalized));
}

function isNegativeOrCancel(normalized: string): boolean {
  const negativePatterns = [
    /^no\b/,
    /^no gracias\b/,
    /^no por favor\b/,
    /^ninguno\b/,
    /^cancelar\b/,
    /^cancela\b/,
    /^detener\b/,
    /^deten\b/,
    /^detente\b/,
    /^para\b/,
    /^parar\b/,
    /^espera\b/,
    /^esperate\b/,
    /^ya no\b/,
    /^mejor no\b/,
    /^olvidalo\b/,
    /^regresar\b/,
    /^terminar\b/,
    /^alto\b/,
    /^desactivar\b/,
  ];

  return negativePatterns.some((pattern) => pattern.test(normalized));
}

function isTripCompletionIntent(normalized: string): boolean {
  return /(?:ya llegue|llegamos|llegue a mi destino|finalizar viaje|terminar viaje|fin del viaje|concluir viaje|llegue)/i.test(
    normalized
  );
}

function isTrafficQuery(normalized: string): boolean {
  return /(?:como esta el trafico|hay mucho trafico|como viene el trafico|reporte de trafico|estado del trafico|hay trafico|trafico en la ruta|como va el trafico)/i.test(
    normalized
  );
}

function isIncidentReport(normalized: string): {
  isReport: boolean;
  tipo: 'accidente' | 'trafico' | 'obras' | 'bache' | 'general';
} {
  if (/(?:accidente|choque|colision|se estrello)/i.test(normalized)) {
    return { isReport: true, tipo: 'accidente' };
  }
  if (/(?:obras|construccion|trabajos en la via|reparacion)/i.test(normalized)) {
    return { isReport: true, tipo: 'obras' };
  }
  if (/(?:bache|socavon|hoyo en el camino)/i.test(normalized)) {
    return { isReport: true, tipo: 'bache' };
  }
  if (/(?:reportar trafico|mucho trafico aqui|trafico pesado)/i.test(normalized)) {
    return { isReport: true, tipo: 'trafico' };
  }
  if (/(?:reportar incidente|reportar problema|hay un peligro)/i.test(normalized)) {
    return { isReport: true, tipo: 'general' };
  }
  return { isReport: false, tipo: 'general' };
}

function extractDestination(rawText: string, normalized: string): string | null {
  const patterns = [
    /(?:por favor\s+)?(?:me puedes llevar|llevame|llevarme|llevanos|vamos|ir|quiero ir|quisiera ir|navegar|navega|dirigeme|dirigirme|como llego|como puedo llegar|rumbo|camino)\s+(?:a|al|hacia|para|con|en)\s+(.+)/i,
    /(?:iniciar viaje a|iniciar ruta a|viajar a|iniciar hacia|ruta hacia|ruta a)\s+(.+)/i,
    /(?:a donde vamos|ir a|quiero llegar a)\s+(.+)/i,
    /(?:buscar|busca|encuentra|encuentrame)\s+(?:la ruta a|el camino a|como ir a)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (extracted.length > 1 && !isAffirmative(extracted) && !isNegativeOrCancel(extracted)) {
        return capitalizeWords(extracted);
      }
    }
  }

  const directMatch = normalized.match(/^(?:a|al|hacia)\s+(.+)/i);
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].trim();
    if (candidate.length > 2 && !isAffirmative(candidate) && !isNegativeOrCancel(candidate)) {
      return capitalizeWords(candidate);
    }
  }

  return null;
}

function detectPersonOrHomeQuery(
  rawText: string,
  normalized: string
): string | null {
  const personPatterns = [
    /(?:ir\s+con|llevarme\s+con|llevame\s+con|vamos\s+con)\s+(.+)/i,
    /(?:a\s+la\s+casa\s+de|a\s+casa\s+de|casa\s+de|a\s+lo\s+de|lo\s+de|donde)\s+(.+)/i,
    /(?:visitar\s+a|ver\s+a)\s+(.+)/i,
  ];

  for (const pattern of personPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length > 1 && !isAffirmative(candidate) && !isNegativeOrCancel(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function isAddAddressIntent(normalized: string): boolean {
  return (
    /(?:anadir|agregar|guardar|registrar|nueva|nuevo|alta)\s+(?:una\s+|un\s+)?(?:direccion|ubicacion|lugar|sitio|destino)/i.test(
      normalized
    ) ||
    /(?:quiero|deseo|necesito|me gustaria)\s+(?:anadir|agregar|guardar|registrar|dar de alta)\s+(?:una\s+|un\s+)?(?:direccion|ubicacion|lugar|sitio|destino)/i.test(
      normalized
    ) ||
    /(?:dar\s+de\s+alta)\s+(?:una\s+|un\s+)?(?:direccion|ubicacion|lugar|sitio|destino)/i.test(
      normalized
    ) ||
    /^(?:anadir|agregar|guardar|registrar)\s+(?:direccion|ubicacion|lugar|sitio)$/i.test(
      normalized
    ) ||
    /(?:quiero|deseo|necesito|me gustaria|voy a)\s+(?:guardar|registrar|anadir|agregar)\s+(?:mi\s+|la\s+|el\s+)?(?:casa|trabajo|oficina|rancho|doctor|dentista|hijo|hija|hermano|hermana|papa|mama|primo|prima|compadre|amigo|amiga)/i.test(
      normalized
    ) ||
    /^(?:guardar|registrar|anadir|agregar)\s+(?:mi\s+|la\s+|el\s+)?(?:casa|trabajo|oficina|rancho|doctor|dentista|hijo|hija|hermano|hermana|papa|mama|primo|prima|compadre|amigo|amiga)/i.test(
      normalized
    )
  );
}

function cleanAliasName(raw: string): string {
  let cleaned = raw
    .replace(/^(?:ir\s+a|ir\s+al|ir\s+con|llevarme\s+a|llevarme\s+con|llevame\s+a|llevame\s+con|vamos\s+a|vamos\s+con|viajar\s+a|navegar\s+a)\s+/i, '')
    .replace(/^(?:a\s+la|a\s+el|al|a|con|hacia|en|para)\s+/i, '')
    .replace(/^(?:mi\s+destino\s+es|destino|quiero\s+ir\s+a|quiero\s+ir\s+al|quiero\s+ir\s+con|quiero\s+ir)\s+/i, '')
    .trim();

  return capitalizeWords(cleaned);
}

function isPersonalPlaceIntent(query: string): boolean {
  const norm = normalizeText(query);

  // 1. Patrones de parentesco y hogar ("casa de...", "depto de...", "a lo de...", "con...", "donde...")
  if (
    /(?:casa de|casa del|depto de|departamento de|a lo de|lo de|donde|rancho de|oficina de|taller de)\s+(.+)/i.test(
      norm
    )
  ) {
    return true;
  }

  // 2. Patrones con "con [persona]": "ir con...", "vamos con..."
  if (/(?:con|visitar a|ver a)\s+(?:mi\s+|el\s+|la\s+)?([a-z]+)/i.test(norm)) {
    return true;
  }

  // 3. Posesivos y familiares frecuentes
  const personalKeywords = [
    'hijo',
    'hija',
    'nieto',
    'nieta',
    'hermano',
    'hermana',
    'mama',
    'papa',
    'madre',
    'padre',
    'abuelo',
    'abuela',
    'tio',
    'tia',
    'primo',
    'prima',
    'sobrino',
    'sobrina',
    'suegro',
    'suegra',
    'cunado',
    'cunada',
    'amigo',
    'amiga',
    'compadre',
    'comadre',
    'novio',
    'novia',
    'esposo',
    'esposa',
    'marido',
    'mujer',
    'doctor',
    'dentista',
    'medico',
    'mecanico',
    'veterinario',
    'terapeuta',
    'trabajo',
    'oficina',
    'negocio',
    'rancho',
    'terreno',
    'casa',
    'bodega',
    'departamento',
    'depa',
    'consultorio',
  ];

  for (const keyword of personalKeywords) {
    const pattern = new RegExp(`\\b(?:mi|el|la|mis)\\s+${keyword}\\b`, 'i');
    if (pattern.test(norm)) {
      return true;
    }
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(norm)) {
      if (!norm.includes('hospital general') && !norm.includes('centro medico')) {
        return true;
      }
    }
  }

  return false;
}

function extractSaveAlias(normalized: string): string | null {
  const patterns = [
    /(?:guarda|guardar|guarde|anota|anotar|registra|registrar|grabar|graba|agrega|agregar|anade|anadir)\s+(?:esta\s+ubicacion\s+como|este\s+lugar\s+como|como|aqui\s+como|mi\s+ubicacion\s+como)\s+(.+)/i,
    /(?:guarda|guardar|guarde|anota|anotar|agrega|agregar|anade|anadir|registra|registrar)\s+(?:este\s+sitio\s+como|el\s+sitio\s+como|esta\s+direccion\s+como)\s+(.+)/i,
    /(?:guarda|guardar|guarde|anota|anotar|agrega|agregar|anade|anadir|registra|registrar)\s+(?:mi\s+casa|la\s+casa\s+de\s+.+|el\s+doctor|la\s+farmacia|el\s+hospital|mi\s+trabajo)/i,
    /(?:guardar\s+ubicacion|anadir\s+ubicacion|agregar\s+ubicacion|anadir\s+direccion|agregar\s+direccion|guardar\s+direccion)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const alias = (match[1] || match[0]).replace(/^(?:guarda|guardar|guarde|agrega|agregar|anade|anadir)\s+/i, '').trim();
      if (alias.length > 1) {
        return capitalizeWords(alias);
      }
    }
  }

  return null;
}

function extractAddressCorrection(rawText: string, normalized: string): string | null {
  const patterns = [
    /(?:no\s*,?\s*)?(?:no es ahi|no es esa|esta mal|me equivoque|era en|es en|cambiar a|ponle en|mejor en|en realidad es en|la direccion es|en)\s+(.+)/i,
    /^no\s*,?\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1]
        .replace(/^(?:la direccion|calle|en)\s+/i, '')
        .trim();
      const lower = candidate.toLowerCase();
      if (
        candidate.length > 2 &&
        !['gracias', 'cancelar', 'cancela', 'ya no', 'olvidalo', 'detener', 'deten'].includes(lower)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function detectZoomDirection(normalized: string): ZoomDirection | null {
  if (
    /(?:acercar|acerca|haz zoom|mas cerca|ampliar|amplia|aumentar|aumenta|acercate|no veo bien|hazlo mas grande|mas grande|acercamiento)/i.test(
      normalized
    )
  ) {
    return 'acercar';
  }

  if (
    /(?:alejar|aleja|menos zoom|mas lejos|vista general|vista amplia|hazlo mas pequeno|mas pequeno|alejate|reducir|alejamiento)/i.test(
      normalized
    )
  ) {
    return 'alejar';
  }

  if (
    /(?:centrar|centra|donde estoy|ubicame|ubicar|ubicacion actual|posicion actual|donde me encuentro|volver al inicio|reubicar|mi ubicacion|centrate)/i.test(
      normalized
    )
  ) {
    return 'centrar';
  }

  return null;
}

function capitalizeWords(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// NORMALIZACIÓN DE DIRECCIONES Y LUGARES CON LLM
// ============================================================================

export interface NormalizedAddressResult {
  formattedSearchQuery: string;
  formattedUserLabel: string;
  aliasCandidate?: string;
  calle?: string;
  numero?: string;
  colonia?: string;
  alcaldia_o_ciudad?: string;
  landmark?: string;
}

/**
 * Normaliza y estructura direcciones habladas en lenguaje natural mexicano mediante LLM (Groq)
 * o mediante heurísticas sintácticas en caso de modo offline.
 * Es capaz de ordenar componentes desordenados (ej: "allá por la Roma en Sonora 120 casi esquina Insurgentes"
 * o "Cuauhtémoc, calle 5 de mayo número 10, colonia centro") en una consulta estandarizada para el geocodificador.
 */
export async function normalizeAddressWithLLM(
  rawInput: string,
  context?: ConversationContext
): Promise<NormalizedAddressResult> {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      formattedSearchQuery: 'Ciudad de México',
      formattedUserLabel: 'Ubicación no especificada',
    };
  }

  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;

  if (apiKey && apiKey.trim() !== '') {
    try {
      const systemPrompt = `Eres un asistente experto en nomenclatura urbana, direcciones y cartografía de México para AVAN.
Tu trabajo es recibir una dirección o lugar dictado por un adulto mayor (frecuentemente con orden desorganizado, muletillas o frases como "allá por la...", "es en...", "casa de mi hijo en...") y devolver ÚNICAMENTE un JSON bien formado sin texto adicional ni bloques markdown.

Estructura requerida:
{
  "aliasCandidate": "nombre del alias o familiar si fue mencionado (ej: 'casa de mi sobrino', 'el doctor'), o null",
  "calle": "nombre de la calle, avenida, calzada o eje (ej: 'Sonora', 'Insurgentes Sur'), o null",
  "numero": "número exterior (ej: '120'), o null",
  "colonia": "colonia, barrio o fraccionamiento (ej: 'Roma Norte', 'Del Valle'), o null",
  "alcaldia_o_ciudad": "alcaldía, municipio o ciudad (ej: 'Cuauhtémoc', 'Ciudad de México')",
  "landmark": "nombre del sitio público de interés si aplica (ej: 'Palacio de Bellas Artes', 'Parque México'), o null",
  "formattedSearchQuery": "cadena completa y ordenada para geocodificación (ej: 'Calle Sonora 120, Roma Norte, Cuauhtémoc, Ciudad de México' o 'Palacio de Bellas Artes, Centro Histórico, Ciudad de México')",
  "formattedUserLabel": "etiqueta corta, natural y clara para confirmación al usuario (ej: 'Calle Sonora 120, Roma Norte' o 'Palacio de Bellas Artes')"
}

Reglas:
1. Si el usuario dictó la colonia primero y luego la calle y número (ej. "En la Roma, Sonora 120"), ordénalo correctamente como "Calle Sonora 120, Roma Norte".
2. Si es un sitio emblemático como "Bellas Artes", "Zócalo", "Soumaya", "Hospital General", identifícalo en 'landmark' y asigna una dirección verosímil y precisa en 'formattedSearchQuery'.
3. Elimina muletillas como "allá por", "es en", "queda en", "por el rumbo de", "está sobre".
4. Devuelve ÚNICAMENTE el JSON.`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: trimmed },
          ],
          temperature: 0.1,
          max_tokens: 512,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.formattedSearchQuery && parsed.formattedUserLabel) {
              return {
                formattedSearchQuery: parsed.formattedSearchQuery,
                formattedUserLabel: parsed.formattedUserLabel,
                aliasCandidate: parsed.aliasCandidate || undefined,
                calle: parsed.calle || undefined,
                numero: parsed.numero || undefined,
                colonia: parsed.colonia || undefined,
                alcaldia_o_ciudad: parsed.alcaldia_o_ciudad || undefined,
                landmark: parsed.landmark || undefined,
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('[conversationService] Fallo al normalizar dirección con Groq LLM, usando parser heurístico:', err);
    }
  }

  // Fallback heurístico inteligente para modo offline o sin API key
  return normalizeAddressHeuristic(trimmed);
}

function normalizeAddressHeuristic(rawInput: string): NormalizedAddressResult {
  let cleaned = rawInput
    .replace(/^(?:la direccion es|es en|esta en|queda en|alla por|allá por|por el rumbo de|en|calle|deja guardada la|guarda la|es la|es el)\s+/i, '')
    .trim();

  // 1. Detectar si viene con un alias previo (ej: "casa de mi primo en sonora 120, roma")
  let aliasCandidate: string | undefined;
  const aliasMatch = cleaned.match(
    /^(.+?)\s+(?:,\s*en\s+|,\s*sobre\s+|,\s*queda\s+en\s+|,\s*esta\s+en\s+|,\s*es\s+en\s+|\s+en\s+|\s+sobre\s+|\s+queda\s+en\s+|\s+esta\s+en\s+|\s+es\s+en\s+)(.+)$/i
  );
  if (aliasMatch && (isPersonalPlaceIntent(aliasMatch[1]) || /^(?:casa|oficina|trabajo|doctor|farmacia|hijo|hija|hermano|hermana|papa|mama|abuelo|compadre)/i.test(aliasMatch[1]))) {
    aliasCandidate = cleanAliasName(aliasMatch[1]);
    cleaned = aliasMatch[2].trim();
  }

  // 2. Detectar si es un landmark conocido de CDMX
  const lower = cleaned.toLowerCase();
  if (lower.includes('bellas artes')) {
    return {
      aliasCandidate,
      landmark: 'Palacio de Bellas Artes',
      formattedSearchQuery: 'Palacio de Bellas Artes, Av. Juárez S/N, Centro Histórico, Ciudad de México',
      formattedUserLabel: 'Palacio de Bellas Artes, Centro Histórico',
    };
  }
  if (lower.includes('zocalo') || lower.includes('zócalo')) {
    return {
      aliasCandidate,
      landmark: 'Plaza de la Constitución / Zócalo',
      formattedSearchQuery: 'Plaza de la Constitución, Centro Histórico, Cuauhtémoc, Ciudad de México',
      formattedUserLabel: 'Zócalo, Centro Histórico',
    };
  }
  if (lower.includes('alameda')) {
    return {
      aliasCandidate,
      landmark: 'Alameda Central',
      formattedSearchQuery: 'Alameda Central, Av. Hidalgo S/N, Centro Histórico, Ciudad de México',
      formattedUserLabel: 'Alameda Central, Centro Histórico',
    };
  }
  if (lower.includes('soumaya')) {
    return {
      aliasCandidate,
      landmark: 'Museo Soumaya',
      formattedSearchQuery: 'Museo Soumaya, Blvd. Miguel de Cervantes Saavedra 303, Granada, Miguel Hidalgo, Ciudad de México',
      formattedUserLabel: 'Museo Soumaya, Granada, Polanco',
    };
  }
  if (lower.includes('parque mexico') || lower.includes('parque méxico')) {
    return {
      aliasCandidate,
      landmark: 'Parque México',
      formattedSearchQuery: 'Parque México, Av. México S/N, Hipódromo Condesa, Cuauhtémoc, Ciudad de México',
      formattedUserLabel: 'Parque México, Condesa',
    };
  }
  if (lower.includes('siglo xxi') || lower.includes('centro medico')) {
    return {
      aliasCandidate,
      landmark: 'Centro Médico Siglo XXI',
      formattedSearchQuery: 'Centro Médico Nacional Siglo XXI, Av. Cuauhtémoc 330, Doctores, Ciudad de México',
      formattedUserLabel: 'Centro Médico Siglo XXI, Doctores',
    };
  }
  if (lower.includes('hospital general')) {
    return {
      aliasCandidate,
      landmark: 'Hospital General de México',
      formattedSearchQuery: 'Hospital General de México, Dr. Balmis 148, Doctores, Ciudad de México',
      formattedUserLabel: 'Hospital General, Doctores',
    };
  }

  // 3. Extracción de patrones de calle, número y colonia desordenados
  let colonia: string | undefined;
  let calle: string | undefined;
  let numero: string | undefined;

  const numMatch = cleaned.match(/(?:(?:n[uú]mero|no\.?|num\.?|#)\s*)?(\d{1,5})/i);
  if (numMatch) {
    numero = numMatch[1];
  }

  const colMatch = cleaned.match(/(?:colonia|col\.?)\s+([^,]+)/i);
  if (colMatch) {
    colonia = capitalizeWords(colMatch[1].trim());
  } else {
    const commonNeighborhoods = [
      'Roma Norte', 'Roma Sur', 'Roma', 'Condesa', 'Hipódromo', 'Del Valle', 'Narvarte',
      'Polanco', 'Juárez', 'Cuauhtémoc', 'Centro', 'Coyoacán', 'San Ángel', 'Nápoles',
      'Santa Fe', 'Doctores', 'Anzures', 'San Rafael', 'Portales', 'Álamos', 'Lindavista'
    ];
    for (const n of commonNeighborhoods) {
      const re = new RegExp(`\\b${n}\\b`, 'i');
      if (re.test(cleaned)) {
        colonia = n;
        break;
      }
    }
  }

  let streetCandidate = cleaned;
  if (colonia) {
    streetCandidate = streetCandidate.replace(new RegExp(`(?:colonia|col\.?|en la|en el|por la)?\\s*${colonia}`, 'i'), '');
  }
  if (numero) {
    streetCandidate = streetCandidate.replace(new RegExp(`(?:(?:n[uú]mero|no\.?|num\.?|#)\\s*)?${numero}\\b`, 'i'), '');
  }
  streetCandidate = streetCandidate
    .replace(/^(?:en\s+|por\s+|calle\s+|avenida\s+|av\.?\s+)+/i, '')
    .replace(/[,\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (streetCandidate.length > 2) {
    calle = capitalizeWords(streetCandidate);
  }

  const streetPart = calle ? (numero ? `${calle} ${numero}` : calle) : (numero ? `Número ${numero}` : '');
  const userParts = [streetPart, colonia].filter(Boolean);
  const formattedUserLabel = userParts.length > 0 ? userParts.join(', ') : capitalizeWords(cleaned);

  const searchParts = [streetPart, colonia, 'Ciudad de México'].filter(Boolean);
  const formattedSearchQuery = searchParts.length > 0 ? searchParts.join(', ') : `${cleaned}, Ciudad de México`;

  return {
    aliasCandidate,
    calle,
    numero,
    colonia,
    alcaldia_o_ciudad: 'Ciudad de México',
    formattedSearchQuery,
    formattedUserLabel,
  };
}

// ============================================================================
// INTEGRACIÓN CON GROQ LLM (llama-3.3-70b-versatile) CON FUNCTION CALLING
// ============================================================================

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqToolCall {
  id: string;
  type: 'function';
  function: {
    name: ToolName;
    arguments: string;
  };
}

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      role: string;
      content?: string | null;
      tool_calls?: GroqToolCall[];
    };
  }>;
}

/**
 * Llama a la API de Groq con el modelo llama-3.3-70b-versatile y Function Calling
 */
async function callGroqLLM(
  userSpeechText: string,
  context: ConversationContext
): Promise<ConversationResponse | null> {
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }

  // 1. Construcción del System Prompt con contexto dinámico
  const aliasesList = AliasService.getAllAliases()
    .map((a) => `• "${a.alias}": ${a.name} (${a.address})`)
    .join('\n');

  let dynamicContextPrompt = `${GERONTOLOGICAL_SYSTEM_PROMPT}\n\nCONTEXTO ACTUAL DE LA SESIÓN:`;
  dynamicContextPrompt += `\n- Nombre del usuario: ${context.userName || 'Gustavo'}`;

  if (context.pendingConfirmation) {
    dynamicContextPrompt += `\n- ESTADO: PENDIENTE DE CONFIRMAR VIAJE hacia "${context.pendingConfirmation.destination}". Esperando que el usuario diga "Sí" o "No/Cancelar".`;
    if (context.pendingConfirmation.isForaneo) {
      dynamicContextPrompt += ` (Es un viaje foráneo en carretera a más de 50 km).`;
    }
  } else if (context.pendingAliasRegistration) {
    dynamicContextPrompt += `\n- ESTADO: REGISTRANDO ALIAS "${context.pendingAliasRegistration.aliasName}". Esperando que el usuario indique la dirección o colonia.`;
  } else if (context.pendingTripCompletion) {
    dynamicContextPrompt += `\n- ESTADO ACTUAL: El viaje a "${context.pendingTripCompletion.destination}" fue cancelado o finalizado. Acabas de preguntarle: "¿Desea ir a algún otro lugar?".
    * Si el usuario dice "No", "No gracias", "Ninguno", "Ya no" o rechaza ir a otro lado: NO LLAMES A NINGUNA HERRAMIENTA. Responde únicamente con una cálida despedida formal: "Excelente, que tenga un excelente día."
    * Si el usuario dice "Sí" o pide ir a otro lugar: responde preguntando a dónde desea ir ("Con gusto, ¿a qué destino le gustaría ir?") o llama a 'navegar_a' si ya mencionó el lugar.`;
  } else if (context.activeRoute?.inProgress) {
    dynamicContextPrompt += `\n- ESTADO: EN NAVEGACIÓN ACTIVA hacia "${context.activeRoute.destination}".`;
  } else {
    dynamicContextPrompt += `\n- ESTADO: En reposo, listo para recibir solicitudes.`;
  }

  if (aliasesList) {
    dynamicContextPrompt += `\n\nALIAS GUARDADOS DEL USUARIO (úsales para resolver destinos):\n${aliasesList}`;
  }

  // 2. Historial de mensajes recientes
  const messages: GroqMessage[] = [
    { role: 'system', content: dynamicContextPrompt },
  ];

  if (context.history && context.history.length > 0) {
    const recent = context.history.slice(-4);
    for (const msg of recent) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  messages.push({
    role: 'user',
    content: userSpeechText,
  });

  // 3. Ejecución de la llamada HTTP a Groq con AbortController para timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: AVAN_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 256,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Groq API respondió con estatus: ${response.status}`);
      return null;
    }

    const data: GroqChatCompletionResponse = await response.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      return null;
    }

    const message = choice.message;
    const rawContent = (message.content || '').trim();
    const toolCalls = message.tool_calls;

    // 4. Procesar Tool Call retornado por Groq
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      const fnName = call.function.name;
      let fnArgs: any = {};
      try {
        fnArgs = JSON.parse(call.function.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      // Integración con el contexto y reglas de negocio de AVAN
      switch (fnName) {
        case 'navegar_a': {
          // Salto de contexto ubicuo: Limpiar cualquier registro pendiente o viaje anterior
          context.pendingAliasRegistration = null;
          context.pendingTripCompletion = null;

          const rawDest = fnArgs.destino || userSpeechText;
          const aliasRes = AliasService.resolveDestinationWithAlias(rawDest);

          // VERIFICACIÓN CRÍTICA: ¿Es un lugar personal o alias no registrado?
          const isPersonal =
            isPersonalPlaceIntent(rawDest) ||
            isPersonalPlaceIntent(userSpeechText) ||
            isPersonalPlaceIntent(fnArgs.destino || '');

          if (!aliasRes.isAlias && isPersonal) {
            const cleanAlias = cleanAliasName(rawDest.length > 2 ? rawDest : userSpeechText);
            context.pendingAliasRegistration = {
              aliasName: cleanAlias,
              step: 'awaiting_address',
              retryCount: 0,
              timestamp: Date.now(),
            };

            const spokenText = `No tengo guardada la ubicación de "${cleanAlias}". ¿Cuál es la dirección o colonia para registrarla?`;

            context.history?.push({
              role: 'assistant',
              content: spokenText,
              timestamp: Date.now(),
            });

            return {
              spokenText,
              functionCall: null,
              updatedContext: context,
              requiresConfirmation: true,
              shouldAutoListen: true,
            };
          }

          const destName = aliasRes.resolvedName;
          let destCoords = aliasRes.coordinates;

          if (!destCoords) {
            try {
              const geocoded = await orsService.geocodeDestination(destName, context.currentLocation);
              if (geocoded && geocoded.length > 0) {
                destCoords = geocoded[0].coordinates;
              }
            } catch (err) {
              console.warn('[conversationService] Error al geocodificar destino para confirmación:', err);
            }
          }

          const isForaneo = isForaneoTrip(destName, destCoords, context.currentLocation);

          context.pendingConfirmation = {
            destination: destName,
            coordinates: destCoords,
            isForaneo,
            timestamp: Date.now(),
            originalQuery: userSpeechText,
          };

          let spokenText = rawContent;
          if (!spokenText || isForaneo) {
            spokenText = isForaneo
              ? `Atención, este es un viaje foráneo en carretera a ${destName}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`
              : `He localizado ${destName}. ¿Desea que iniciemos el viaje hacia allá?`;
          }

          const functionCall: FunctionCall = {
            name: 'navegar_a',
            args: {
              destino: destName,
              latitud: destCoords?.latitude,
              longitud: destCoords?.longitude,
              isForaneo,
            },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: true,
          };
        }

        case 'confirmar_viaje': {
          const destName =
            fnArgs.destino || context.pendingConfirmation?.destination || 'su destino';
          const isForaneo = !!context.pendingConfirmation?.isForaneo;
          const confirmedCoords = context.pendingConfirmation?.coordinates;

          context.pendingConfirmation = null;
          context.activeRoute = {
            destination: destName,
            inProgress: true,
            isForaneo,
            startTime: Date.now(),
          };

          let spokenText = rawContent;
          if (!spokenText) {
            spokenText = isForaneo
              ? `Entendido. Iniciando la ruta en carretera hacia ${destName}. Conduzca con precaución y descanse cuando lo requiera.`
              : `Excelente. Iniciando la ruta hacia ${destName}. Conduzca con precaución.`;
          }

          const functionCall: FunctionCall = {
            name: 'confirmar_viaje',
            args: {
              destino: destName,
              isForaneo,
              latitud: confirmedCoords?.latitude,
              longitud: confirmedCoords?.longitude,
            },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: false,
          };
        }

        case 'cancelar': {
          // Si ya estábamos en espera de respuesta a "¿Desea ir a algún otro lugar?"
          // y el usuario rechaza/cancela, finalizamos el flujo con despedida cordial y apagamos el micro.
          if (context.pendingTripCompletion) {
            context.pendingTripCompletion = null;
            context.pendingConfirmation = null;
            if (context.activeRoute?.inProgress) {
              context.activeRoute = null;
            }

            const spokenText = 'Excelente, que tenga un excelente día.';
            context.history?.push({
              role: 'assistant',
              content: spokenText,
              functionCall: {
                name: 'cancelar',
                args: { motivo: 'Usuario no desea ir a otro lugar' },
              },
              timestamp: Date.now(),
            });

            return {
              spokenText,
              functionCall: null,
              updatedContext: context,
              requiresConfirmation: false,
              shouldAutoListen: false,
            };
          }

          const lastDest =
            context.pendingConfirmation?.destination ||
            context.activeRoute?.destination ||
            'su destino';
          context.pendingConfirmation = null;
          if (context.activeRoute?.inProgress) {
            context.activeRoute = null;
          }

          context.pendingTripCompletion = {
            destination: lastDest,
            timestamp: Date.now(),
          };

          // REGLA CRÍTICA: Al cancelar un viaje o confirmación, confirmar y preguntar si desea ir a otro lugar.
          const spokenText = `Entendido. He cancelado el viaje a ${lastDest}. ¿Desea ir a algún otro lugar?`;
          const functionCall: FunctionCall = {
            name: 'cancelar',
            args: { motivo: 'Cancelación solicitada por el usuario' },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: false,
            shouldAutoListen: true,
          };
        }

        case 'guardar_ubicacion': {
          // Salto de contexto: Limpiar cualquier confirmación o viaje previo
          context.pendingConfirmation = null;
          context.pendingTripCompletion = null;

          let alias = fnArgs.alias || 'nueva ubicación';
          const address = fnArgs.direccion;

          // Si el usuario pidió registrar pero no especificó dirección todavía
          if (!address || address.trim() === '' || address === 'Ubicación registrada' || address.toLowerCase() === 'ubicación registrada') {
            const cleanAlias = cleanAliasName(alias);
            context.pendingAliasRegistration = {
              aliasName: cleanAlias,
              step: 'awaiting_address',
              retryCount: 0,
              timestamp: Date.now(),
            };

            const spokenText = `Entendido, vamos a registrar "${cleanAlias}". ¿Cuál es la dirección o colonia?`;
            context.history?.push({
              role: 'assistant',
              content: spokenText,
              timestamp: Date.now(),
            });

            return {
              spokenText,
              functionCall: null,
              updatedContext: context,
              requiresConfirmation: true,
              shouldAutoListen: true,
            };
          }

          // Si sí especificó dirección, normalizar con LLM y geocodificar para vista previa exacta
          const normalizedAddr = await normalizeAddressWithLLM(address, context);
          if (normalizedAddr.aliasCandidate && (alias === 'nueva ubicación' || alias === 'nueva ubicacion')) {
            alias = normalizedAddr.aliasCandidate;
          }

          let targetCoords = context.currentLocation || CDMX_CENTER;
          let formattedAddress = normalizedAddr.formattedUserLabel;

          try {
            const geocoded = await orsService.geocodeDestination(
              normalizedAddr.formattedSearchQuery,
              context.currentLocation
            );
            if (geocoded && geocoded.length > 0) {
              targetCoords = geocoded[0].coordinates;
              formattedAddress = normalizedAddr.formattedUserLabel || geocoded[0].label || geocoded[0].name;
            }
          } catch {}

          context.pendingAliasRegistration = {
            aliasName: alias,
            step: 'confirming_address',
            addressCandidate: formattedAddress,
            coordinates: targetCoords,
            retryCount: 0,
            timestamp: Date.now(),
          };

          const spokenText = `Entendí: ${formattedAddress}. ¿Es correcta esta ubicación para ${alias}?`;
          context.history?.push({
            role: 'assistant',
            content: spokenText,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall: null,
            updatedContext: context,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        }

        case 'ajustar_zoom': {
          const dir: ZoomDirection =
            fnArgs.direccion === 'acercar' ||
            fnArgs.direccion === 'alejar' ||
            fnArgs.direccion === 'centrar'
              ? fnArgs.direccion
              : 'centrar';

          let defaultSpoken = 'Centrando el mapa en su ubicación actual.';
          if (dir === 'acercar')
            defaultSpoken = 'Acercando el mapa para que pueda ver con mayor detalle.';
          if (dir === 'alejar')
            defaultSpoken = 'Alejando el mapa para mostrar una vista más amplia.';

          const spokenText = rawContent || defaultSpoken;
          const functionCall: FunctionCall = {
            name: 'ajustar_zoom',
            args: { direccion: dir },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: false,
          };
        }

        case 'consultar_trafico': {
          const spokenText =
            rawContent ||
            'El tráfico en su ruta es fluido y sin retrasos mayores. Continúe con precaución.';
          const functionCall: FunctionCall = {
            name: 'consultar_trafico',
            args: { ruta: context.activeRoute?.destination },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: false,
          };
        }

        case 'reportar_incidente': {
          const spokenText =
            rawContent ||
            'Reporte registrado. Estamos monitoreando el camino para su seguridad.';
          const functionCall: FunctionCall = {
            name: 'reportar_incidente',
            args: { tipo: fnArgs.tipo || 'general', descripcion: userSpeechText },
          };

          context.history?.push({
            role: 'assistant',
            content: spokenText,
            functionCall,
            timestamp: Date.now(),
          });

          return {
            spokenText,
            functionCall,
            updatedContext: context,
            requiresConfirmation: false,
          };
        }
      }
    }

    // Si Groq respondió únicamente con texto conversacional (sin tool call)
    if (rawContent) {
      // Si estábamos esperando respuesta a "¿Desea ir a algún otro lugar?", limpiamos el estado de continuidad
      if (context.pendingTripCompletion) {
        context.pendingTripCompletion = null;
      }

      const asksQuestion = rawContent.includes('?');
      const isFarewell =
        !asksQuestion &&
        /(?:hasta luego|buenas noches|a su disposici[oó]n|nos vemos|adi[oó]s|que descanse|cu[ií]dese|que le vaya bien)/i.test(
          rawContent
        );

      // Si la respuesta del LLM parece estar solicitando una dirección para registrar:
      if (
        isAddAddressIntent(normalizeText(rawContent)) ||
        /(?:direccion|ubicacion|donde queda|donde esta).*\?/i.test(rawContent) ||
        /(?:nombre|alias|lugar).*(?:direccion|ubicacion)/i.test(rawContent)
      ) {
        if (!context.pendingAliasRegistration) {
          context.pendingAliasRegistration = {
            aliasName: 'nueva ubicación',
            step: 'awaiting_address',
            retryCount: 0,
            timestamp: Date.now(),
          };
        }
      }

      context.history?.push({
        role: 'assistant',
        content: rawContent,
        timestamp: Date.now(),
      });

      return {
        spokenText: rawContent,
        functionCall: null,
        updatedContext: context,
        requiresConfirmation: Boolean(context.pendingAliasRegistration),
        shouldAutoListen: (asksQuestion || Boolean(context.pendingAliasRegistration)) && !isFarewell,
      };
    }

    return null;
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('Fallo en la llamada a Groq LLM, activando fallback local:', error);
    return null;
  }
}

// ============================================================================
// MOTOR LOCAL DE HEURÍSTICAS (FALLBACK INFALIBLE)
// ============================================================================

async function processUserMessageLocal(
  userSpeechText: string,
  context: ConversationContext
): Promise<ConversationResponse> {
  const currentContext = context;
  const rawText = (userSpeechText || '').trim();
  const normalized = normalizeText(rawText);

  // --------------------------------------------------------------------------
  // CASO A: FLUJO DE REGISTRO ASISTIDO Y CONFIRMACIÓN DE DIRECCIÓN (TASK-21)
  // --------------------------------------------------------------------------
  if (currentContext.pendingAliasRegistration) {
    const pending = currentContext.pendingAliasRegistration;
    const aliasName = pending.aliasName;

    // Salto de contexto 1: Si el usuario solicita navegar hacia otro lugar en vez de continuar registrando
    // Ejemplos: "Quiero ir a Chapultepec", "Llévame al doctor", "Vamos a Bellas Artes"
    const explicitDest = extractDestination(rawText, normalized);
    if (explicitDest) {
      console.log(`[conversationService] Salto de contexto: de registro de "${aliasName}" a navegación hacia "${explicitDest}".`);
      currentContext.pendingAliasRegistration = null;
      return await processUserMessageLocal(rawText, currentContext);
    }

    // Salto de contexto 2: Ajuste de mapa sin romper el registro de alias
    const zoomDir = detectZoomDirection(normalized);
    if (zoomDir) {
      let spokenText = 'Ajustando vista del mapa.';
      if (zoomDir === 'acercar') spokenText = 'Acercando el mapa.';
      if (zoomDir === 'alejar') spokenText = 'Alejando el mapa.';
      if (zoomDir === 'centrar') spokenText = 'Centrando el mapa en su posición.';

      return {
        spokenText,
        functionCall: { name: 'ajustar_zoom', args: { direccion: zoomDir } },
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }
      // 1. Cancelación explícita ("cancelar", "ya no", "olvídalo", "detener")
      if (
        /(?:cancelar|cancela|ya no|olvidalo|detener|deten|ninguno|no quiero)/i.test(normalized)
      ) {
        currentContext.pendingAliasRegistration = null;
        const responseText = 'Entendido, he cancelado el registro. ¿A dónde desea ir?';
        const functionCall: FunctionCall = {
          name: 'cancelar',
          args: { motivo: 'Registro de alias cancelado' },
        };

        currentContext.history?.push({
          role: 'assistant',
          content: responseText,
          functionCall,
          timestamp: Date.now(),
        });

        return {
          spokenText: responseText,
          functionCall,
          updatedContext: currentContext,
          requiresConfirmation: false,
          shouldAutoListen: true,
        };
      }

      // SUB-ESTADO 1: ESPERANDO LA DIRECCIÓN (awaiting_address)
      if (pending.step === 'awaiting_address') {
      if (isNegativeOrCancel(normalized)) {
        currentContext.pendingAliasRegistration = null;
        const responseText = 'Entendido, no he guardado la ubicación. ¿A dónde desea ir?';
        const functionCall: FunctionCall = {
          name: 'cancelar',
          args: { motivo: 'Registro de alias cancelado' },
        };

        currentContext.history?.push({
          role: 'assistant',
          content: responseText,
          functionCall,
          timestamp: Date.now(),
        });

        return {
          spokenText: responseText,
          functionCall,
          updatedContext: currentContext,
          requiresConfirmation: false,
          shouldAutoListen: true,
        };
      }

      let aliasToUse = aliasName;
      let addressToUse = rawText;

      // Si el alias aún es genérico ("nueva ubicación") o el usuario dice alias y dirección en la misma frase:
      // Ej: "Es la casa de mi primo, en calle Sonora 120" o "Casa de mi compadre en insurgentes sur 300"
      const splitMatch = rawText.match(
        /^(.+?)\s+(?:,\s*en\s+|,\s*sobre\s+|,\s*queda\s+en\s+|,\s*esta\s+en\s+|,\s*es\s+en\s+|,\s*ubicada?\s+en\s+|\s+en\s+|\s+sobre\s+|\s+queda\s+en\s+|\s+esta\s+en\s+|\s+es\s+en\s+|\s+ubicada?\s+en\s+)(.+)$/i
      );

      if (splitMatch && (aliasToUse === 'nueva ubicación' || isPersonalPlaceIntent(splitMatch[1]))) {
        const potentialAlias = cleanAliasName(splitMatch[1].replace(/^(?:es\s+|la\s+|el\s+)/i, ''));
        const potentialAddress = splitMatch[2].trim();
        if (potentialAlias.length > 1 && potentialAddress.length > 2) {
          aliasToUse = potentialAlias;
          addressToUse = potentialAddress;
        }
      } else if (aliasToUse === 'nueva ubicación') {
        // Si no hubo conector: ¿dijo solo un nombre personal o solo una dirección?
        if (isPersonalPlaceIntent(rawText) && !/\d+/.test(rawText)) {
          const cleanName = cleanAliasName(rawText);
          currentContext.pendingAliasRegistration = {
            aliasName: cleanName,
            step: 'awaiting_address',
            retryCount: 0,
            timestamp: Date.now(),
          };

          const responseText = `Entendido, ${cleanName}. ¿Cuál es la dirección o colonia para registrarla?`;
          currentContext.history?.push({
            role: 'assistant',
            content: responseText,
            timestamp: Date.now(),
          });

          return {
            spokenText: responseText,
            functionCall: null,
            updatedContext: currentContext,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        }
      }

      // Normalizar la dirección con LLM para ordenar componentes desordenados
      const normalizedAddr = await normalizeAddressWithLLM(addressToUse, currentContext);
      if (normalizedAddr.aliasCandidate && (aliasToUse === 'nueva ubicación' || aliasToUse === 'nueva ubicacion')) {
        aliasToUse = normalizedAddr.aliasCandidate;
      }

      // Geocodificar la dirección ingresada para obtener coordenadas precisas
      let targetCoords = currentContext.currentLocation || CDMX_CENTER;
      let formattedAddress = normalizedAddr.formattedUserLabel;

      try {
        const geocoded = await orsService.geocodeDestination(
          normalizedAddr.formattedSearchQuery,
          currentContext.currentLocation
        );
        if (geocoded && geocoded.length > 0) {
          targetCoords = geocoded[0].coordinates;
          formattedAddress = normalizedAddr.formattedUserLabel || geocoded[0].label || geocoded[0].name;
        }
      } catch (err) {
        console.log('[conversationService] Fallback de geocodificación para alias:', err);
      }

      currentContext.pendingAliasRegistration = {
        aliasName: aliasToUse,
        step: 'confirming_address',
        addressCandidate: formattedAddress,
        coordinates: targetCoords,
        retryCount: 0,
        timestamp: Date.now(),
      };

      const responseText = `Entendí: ${formattedAddress}. ¿Es correcta esta ubicación para ${aliasToUse}?`;

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }

    // SUB-ESTADO 2: CONFIRMANDO LA DIRECCIÓN (confirming_address)
    if (pending.step === 'confirming_address') {
      // 1. Caso Afirmativo: Usuario confirma ("Sí", "Es correcto", "Así es", etc.)
      if (isAffirmative(normalized)) {
        const addressToSave = pending.addressCandidate || rawText;
        const coordsToSave = pending.coordinates || currentContext.currentLocation || CDMX_CENTER;

        const saved = AliasService.saveAlias(
          aliasName,
          capitalizeWords(aliasName),
          addressToSave,
          coordsToSave
        );

        currentContext.pendingAliasRegistration = null;

        const isForaneo = isForaneoTrip(
          aliasName,
          saved.coordinates,
          currentContext.currentLocation
        );

        currentContext.pendingConfirmation = {
          destination: saved.name,
          coordinates: saved.coordinates,
          isForaneo,
          timestamp: Date.now(),
          originalQuery: rawText,
        };

        const responseText = `He guardado ${saved.name}. ¿Desea que iniciemos el viaje hacia allá ahora mismo?`;
        const functionCall: FunctionCall = {
          name: 'guardar_ubicacion',
          args: {
            alias: aliasName,
            direccion: addressToSave,
            latitud: saved.coordinates.latitude,
            longitud: saved.coordinates.longitude,
          },
        };

        currentContext.history?.push({
          role: 'assistant',
          content: responseText,
          functionCall,
          timestamp: Date.now(),
        });

        return {
          spokenText: responseText,
          functionCall,
          updatedContext: currentContext,
          requiresConfirmation: true,
          shouldAutoListen: true,
        };
      }

      // 2. Caso Corrección Directa (ej. "No, era en la Roma", "Es en insurgentes 400", "En calle sonora")
      const directCorrection = extractAddressCorrection(rawText, normalized);
      if (directCorrection) {
        const normalizedCorr = await normalizeAddressWithLLM(directCorrection, currentContext);
        let newCoords = currentContext.currentLocation || CDMX_CENTER;
        let newFormatted = normalizedCorr.formattedUserLabel;

        try {
          const geocoded = await orsService.geocodeDestination(
            normalizedCorr.formattedSearchQuery,
            currentContext.currentLocation
          );
          if (geocoded && geocoded.length > 0) {
            newCoords = geocoded[0].coordinates;
            newFormatted = normalizedCorr.formattedUserLabel || geocoded[0].label || geocoded[0].name;
          }
        } catch (err) {
          console.log('[conversationService] Fallback de geocodificación en corrección:', err);
        }

        currentContext.pendingAliasRegistration = {
          aliasName,
          step: 'confirming_address',
          addressCandidate: newFormatted,
          coordinates: newCoords,
          retryCount: 0,
          timestamp: Date.now(),
        };

        const responseText = `Entendido, corregí a: ${newFormatted}. ¿Es correcta esta ubicación para ${aliasName}?`;

        currentContext.history?.push({
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
        });

        return {
          spokenText: responseText,
          functionCall: null,
          updatedContext: currentContext,
          requiresConfirmation: true,
          shouldAutoListen: true,
        };
      }

      // 3. Caso Negación Simple (ej. "No", "No es ahí", "Está mal", "No está bien")
      if (isNegativeOrCancel(normalized)) {
        currentContext.pendingAliasRegistration = {
          aliasName,
          step: 'awaiting_address',
          retryCount: 0,
          timestamp: Date.now(),
        };

        const responseText = `De acuerdo. Por favor dígame la dirección o colonia correcta para ${aliasName}.`;

        currentContext.history?.push({
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
        });

        return {
          spokenText: responseText,
          functionCall: null,
          updatedContext: currentContext,
          requiresConfirmation: true,
          shouldAutoListen: true,
        };
      }

      // 4. Caso respuesta no clara o ambigua
      const clarifyText = `Por favor dígame si la ubicación para ${aliasName} es correcta. Puede decir "Sí" para confirmar o "No" para corregir.`;
      return {
        spokenText: clarifyText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }
  }

  // --------------------------------------------------------------------------
  // CASO B: DIÁLOGO DE CONTINUIDAD AL FINALIZAR VIAJE (T-2.5)
  // --------------------------------------------------------------------------
  if (currentContext.pendingTripCompletion) {
    const lastDestination = currentContext.pendingTripCompletion.destination;

    if (isNegativeOrCancel(normalized)) {
      currentContext.pendingTripCompletion = null;
      currentContext.activeRoute = null;

      const responseText = 'Excelente, que tenga un excelente día.';
      const functionCall: FunctionCall = {
        name: 'finalizar_viaje',
        args: { destino: lastDestination },
      };

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        functionCall,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall,
        updatedContext: currentContext,
        requiresConfirmation: false,
      };
    }

    if (isAffirmative(normalized)) {
      currentContext.pendingTripCompletion = null;
      const responseText = 'Con gusto. ¿A qué lugar le gustaría ir ahora?';

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: false,
        shouldAutoListen: true,
      };
    }

    const newDestination = extractDestination(rawText, normalized);
    if (newDestination) {
      currentContext.pendingTripCompletion = null;
    } else {
      currentContext.pendingTripCompletion = null;
    }
  }

  if (isTripCompletionIntent(normalized)) {
    const destination = currentContext.activeRoute?.destination || 'su destino';
    currentContext.pendingTripCompletion = {
      destination,
      timestamp: Date.now(),
    };

    const responseText = `Hemos finalizado el viaje a ${destination}. ¿Desea viajar a algún otro lugar?`;
    const functionCall: FunctionCall = {
      name: 'finalizar_viaje',
      args: { destino: destination },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: responseText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText: responseText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO C: COMANDOS DE TRÁFICO E INCIDENTES EN MARCHA (T-2.4)
  // --------------------------------------------------------------------------
  if (isTrafficQuery(normalized)) {
    const responseText = 'El tráfico en su ruta es fluido y sin retrasos mayores. Continúe con precaución.';
    const functionCall: FunctionCall = {
      name: 'consultar_trafico',
      args: { ruta: currentContext.activeRoute?.destination },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: responseText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText: responseText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: false,
    };
  }

  const incidentCheck = isIncidentReport(normalized);
  if (incidentCheck.isReport) {
    const responseText = 'Reporte registrado. Estamos monitoreando el camino para su seguridad.';
    const functionCall: FunctionCall = {
      name: 'reportar_incidente',
      args: { tipo: incidentCheck.tipo, descripcion: rawText },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: responseText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText: responseText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: false,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 1: FLUJO DE CONFIRMACIÓN PENDIENTE (PASO 2)
  // --------------------------------------------------------------------------
  if (currentContext.pendingConfirmation) {
    const destination = currentContext.pendingConfirmation.destination;
    const isForaneo = !!currentContext.pendingConfirmation.isForaneo;

    // Salto de contexto: Si el usuario solicita registrar una nueva dirección mientras confirmaba viaje
    // Ej: "Quiero registrar una nueva dirección", "Guarda la casa de mi hijo"
    if (isAddAddressIntent(normalized) || extractSaveAlias(normalized)) {
      console.log(`[conversationService] Salto de contexto: cancelando confirmación de viaje a "${destination}" para registrar dirección.`);
      currentContext.pendingConfirmation = null;
      return await processUserMessageLocal(rawText, currentContext);
    }

    if (isAffirmative(normalized)) {
      const responseText = isForaneo
        ? `Entendido. Iniciando la ruta en carretera hacia ${destination}. Conduzca con precaución y descanse cuando lo requiera.`
        : `Excelente. Iniciando la ruta hacia ${destination}. Conduzca con precaución.`;

      const confirmedCoords = currentContext.pendingConfirmation.coordinates;

      const functionCall: FunctionCall = {
        name: 'confirmar_viaje',
        args: {
          destino: destination,
          isForaneo,
          latitud: confirmedCoords?.latitude,
          longitud: confirmedCoords?.longitude,
        },
      };

      currentContext.pendingConfirmation = null;
      currentContext.activeRoute = {
        destination,
        inProgress: true,
        isForaneo,
        startTime: Date.now(),
      };

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        functionCall,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall,
        updatedContext: currentContext,
        requiresConfirmation: false,
      };
    }

    if (isNegativeOrCancel(normalized)) {
      const responseText = `Entendido, he cancelado el viaje a ${destination}.`;
      const functionCall: FunctionCall = {
        name: 'cancelar',
        args: { motivo: 'Confirmación rechazada por el usuario' },
      };

      currentContext.pendingConfirmation = null;
      currentContext.pendingTripCompletion = null;

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        functionCall,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall,
        updatedContext: currentContext,
        requiresConfirmation: false,
        shouldAutoListen: false,
      };
    }

    const newDestination = extractDestination(rawText, normalized);
    if (newDestination && newDestination.toLowerCase() !== destination.toLowerCase()) {
      const aliasResult = AliasService.resolveDestinationWithAlias(newDestination);
      const resolvedTarget = aliasResult.resolvedName;
      let newCoords = aliasResult.coordinates;
      if (!newCoords) {
        try {
          const geocoded = await orsService.geocodeDestination(resolvedTarget, currentContext.currentLocation);
          if (geocoded && geocoded.length > 0 && geocoded[0].coordinates) {
            newCoords = geocoded[0].coordinates;
          }
        } catch (err) {
          console.warn('[conversationService] Error al geocodificar destino:', err);
        }
      }

      const foraneoNew = isForaneoTrip(
        resolvedTarget,
        newCoords,
        currentContext.currentLocation
      );

      currentContext.pendingConfirmation = {
        destination: resolvedTarget,
        coordinates: newCoords,
        isForaneo: foraneoNew,
        timestamp: Date.now(),
        originalQuery: rawText,
      };

      let responseText = `De acuerdo. He localizado ${resolvedTarget}. ¿Desea que iniciemos el viaje hacia allá?`;
      if (foraneoNew) {
        responseText = `Atención, este es un viaje foráneo en carretera a ${resolvedTarget}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`;
      }

      const functionCall: FunctionCall = {
        name: 'navegar_a',
        args: {
          destino: resolvedTarget,
          latitud: aliasResult.coordinates?.latitude,
          longitud: aliasResult.coordinates?.longitude,
          isForaneo: foraneoNew,
        },
      };

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        functionCall,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall,
        updatedContext: currentContext,
        requiresConfirmation: true,
      };
    }

    const clarifyText = isForaneo
      ? `Por su seguridad en carretera, por favor confirme: ¿Desea iniciar el viaje a ${destination}? Puede decir "Sí" o "Cancelar".`
      : `Para su seguridad, por favor dígame: ¿Desea iniciar el viaje a ${destination}? Puede decir "Sí" o "Cancelar".`;

    return {
      spokenText: clarifyText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 1b: INTENCIÓN DIRECTA DE AÑADIR O REGISTRAR DIRECCIÓN (TASK-21)
  // --------------------------------------------------------------------------
  if (isAddAddressIntent(normalized)) {
    const specificAlias = extractSaveAlias(normalized);
    const targetAlias = specificAlias || 'nueva ubicación';

    currentContext.pendingAliasRegistration = {
      aliasName: targetAlias,
      step: 'awaiting_address',
      retryCount: 0,
      timestamp: Date.now(),
    };

    const responseText = specificAlias
      ? `Con gusto. Por favor dígame la dirección o colonia para registrar ${specificAlias}.`
      : 'Con gusto. Por favor dígame el nombre del lugar y su dirección.';

    currentContext.history?.push({
      role: 'assistant',
      content: responseText,
      timestamp: Date.now(),
    });

    return {
      spokenText: responseText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: true,
      shouldAutoListen: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 2: SOLICITUD DE NAVEGACIÓN (PASO 1)
  // --------------------------------------------------------------------------
  const personQuery = detectPersonOrHomeQuery(rawText, normalized);
  const rawDestination =
    extractDestination(rawText, normalized) || (personQuery ? `con ${personQuery}` : null);

  if (rawDestination) {
    const aliasResolution = AliasService.resolveDestinationWithAlias(rawDestination);

    const isPersonal =
      isPersonalPlaceIntent(rawDestination) ||
      isPersonalPlaceIntent(rawText) ||
      Boolean(personQuery);

    if (!aliasResolution.isAlias && isPersonal) {
      const aliasName = cleanAliasName(rawDestination);

      currentContext.pendingAliasRegistration = {
        aliasName,
        step: 'awaiting_address',
        retryCount: 0,
        timestamp: Date.now(),
      };

      const responseText = `No tengo guardada la ubicación de "${aliasName}". ¿Cuál es la dirección o colonia para registrarla?`;

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }

    const destinationName = aliasResolution.resolvedName;
    let destinationCoords = aliasResolution.coordinates;

    if (!destinationCoords) {
      try {
        const geocoded = await orsService.geocodeDestination(
          destinationName,
          currentContext.currentLocation
        );
        if (geocoded && geocoded.length > 0) {
          destinationCoords = geocoded[0].coordinates;
        }
      } catch (err) {
        console.warn('[conversationService] Error al geocodificar destino local para confirmación:', err);
      }
    }

    const isForaneo = isForaneoTrip(
      destinationName,
      destinationCoords,
      currentContext.currentLocation
    );

    currentContext.pendingConfirmation = {
      destination: destinationName,
      coordinates: destinationCoords,
      isForaneo,
      timestamp: Date.now(),
      originalQuery: rawText,
    };

    let responseText = `He localizado ${destinationName}. ¿Desea que iniciemos el viaje hacia allá?`;
    if (isForaneo) {
      responseText = `Atención, este es un viaje foráneo en carretera a ${destinationName}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`;
    }

    const functionCall: FunctionCall = {
      name: 'navegar_a',
      args: {
        destino: destinationName,
        latitud: destinationCoords?.latitude,
        longitud: destinationCoords?.longitude,
        isForaneo,
      },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: responseText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText: responseText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 3: AJUSTAR ZOOM
  // --------------------------------------------------------------------------
  const zoomDirection = detectZoomDirection(normalized);
  if (zoomDirection) {
    let spokenText = '';
    switch (zoomDirection) {
      case 'acercar':
        spokenText = 'Acercando el mapa para que pueda ver con mayor detalle.';
        break;
      case 'alejar':
        spokenText = 'Alejando el mapa para mostrar una vista más amplia.';
        break;
      case 'centrar':
        spokenText = 'Centrando el mapa en su ubicación actual.';
        break;
    }

    const functionCall: FunctionCall = {
      name: 'ajustar_zoom',
      args: { direccion: zoomDirection },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: false,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 4: GUARDAR UBICACIÓN MANUALMENTE
  // --------------------------------------------------------------------------
  const saveAlias = extractSaveAlias(normalized);
  if (saveAlias) {
    const isCurrentLocationSave = /(?:esta ubicacion|este lugar|aqui como|mi ubicacion como)/i.test(normalized);
    if (!isCurrentLocationSave) {
      currentContext.pendingAliasRegistration = {
        aliasName: saveAlias,
        step: 'awaiting_address',
        retryCount: 0,
        timestamp: Date.now(),
      };

      const responseText = `Con gusto. ¿Cuál es la dirección o colonia para guardar ${saveAlias}?`;

      currentContext.history?.push({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      return {
        spokenText: responseText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }

    const latitud = currentContext.currentLocation?.latitude;
    const longitud = currentContext.currentLocation?.longitude;

    if (!currentContext.savedLocations) {
      currentContext.savedLocations = {};
    }

    currentContext.savedLocations[saveAlias] = {
      alias: saveAlias,
      latitude: latitud,
      longitude: longitud,
      createdAt: Date.now(),
    };

    AliasService.saveAlias(
      saveAlias,
      capitalizeWords(saveAlias),
      `Ubicación guardada de ${saveAlias}`,
      {
        latitude: latitud || CDMX_CENTER.latitude,
        longitude: longitud || CDMX_CENTER.longitude,
      }
    );

    const spokenText = `He guardado esta ubicación con el nombre "${saveAlias}".`;
    const functionCall: FunctionCall = {
      name: 'guardar_ubicacion',
      args: {
        alias: saveAlias,
        ...(latitud !== undefined ? { latitud } : {}),
        ...(longitud !== undefined ? { longitud } : {}),
      },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: false,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 5: CANCELAR
  // --------------------------------------------------------------------------
  if (isNegativeOrCancel(normalized)) {
    let spokenText = 'Acción cancelada. ¿Desea ir a algún otro lugar?';
    if (currentContext.activeRoute?.inProgress) {
      spokenText = `He detenido la navegación hacia ${currentContext.activeRoute.destination}. ¿Desea ir a algún otro lugar?`;
      currentContext.pendingTripCompletion = {
        destination: currentContext.activeRoute.destination,
        timestamp: Date.now(),
      };
      currentContext.activeRoute = null;
    } else {
      currentContext.pendingTripCompletion = {
        destination: 'su destino anterior',
        timestamp: Date.now(),
      };
    }

    const functionCall: FunctionCall = {
      name: 'cancelar',
      args: { motivo: 'Cancelación solicitada por el usuario' },
    };

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      functionCall,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall,
      updatedContext: currentContext,
      requiresConfirmation: false,
      shouldAutoListen: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 6: SALUDOS Y CORTESÍA
  // --------------------------------------------------------------------------
  if (/^(?:hola|buenos dias|buenas tardes|buenas noches|que tal|saludos|buen dia)/i.test(normalized)) {
    const namePart = currentContext.userName ? ` ${currentContext.userName}` : '';
    const spokenText = `Hola${namePart}. ¿A qué destino le gustaría ir hoy?`;

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: false,
      shouldAutoListen: true,
    };
  }

  if (/^(?:gracias|muchas gracias|te lo agradezco|se lo agradezco|muy amable)/i.test(normalized)) {
    const spokenText = 'Con mucho gusto. Estoy aquí para ayudarle cuando lo necesite.';

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: false,
      shouldAutoListen: false,
    };
  }

  if (/(?:ayuda|que puedes hacer|que puede hacer|como funciona|instrucciones|que haces)/i.test(normalized)) {
    const spokenText =
      'Puedo guiarle a un destino, guardar sitios frecuentes, consultar el tráfico o ajustar el mapa. Solo dígame a dónde desea ir.';

    currentContext.history?.push({
      role: 'assistant',
      content: spokenText,
      timestamp: Date.now(),
    });

    return {
      spokenText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: false,
      shouldAutoListen: true,
    };
  }

  // --------------------------------------------------------------------------
  // CASO 7: FALLBACK AMIGABLE
  // --------------------------------------------------------------------------
  const fallbackText =
    'Disculpe, no logré entenderle con claridad. ¿Podría indicarme el nombre del lugar al que desea ir?';

  currentContext.history?.push({
    role: 'assistant',
    content: fallbackText,
    timestamp: Date.now(),
  });

  return {
    spokenText: fallbackText,
    functionCall: null,
    updatedContext: currentContext,
    requiresConfirmation: false,
    shouldAutoListen: true,
  };
}

// ============================================================================
// FUNCIÓN PRINCIPAL: processUserMessage
// ============================================================================

/**
 * Evalúa el mensaje de voz del usuario usando Groq LLM (llama-3.3-70b-versatile)
 * con Function Calling para una interacción natural y fluida.
 *
 * Si la llamada a Groq no está disponible o falla, utiliza automáticamente
 * el motor local de heurísticas como fallback infalible.
 *
 * @param userSpeechText Texto reconocido de la voz del usuario
 * @param context Contexto conversacional acumulado (opcional)
 * @returns Promesa con la respuesta para TTS y la acción por realizar
 */
export async function processUserMessage(
  userSpeechText: string,
  context?: ConversationContext
): Promise<ConversationResponse> {
  const currentContext: ConversationContext = {
    userName: context?.userName || 'Gustavo',
    currentLocation: context?.currentLocation,
    pendingConfirmation: context?.pendingConfirmation || null,
    pendingAliasRegistration: context?.pendingAliasRegistration || null,
    pendingTripCompletion: context?.pendingTripCompletion || null,
    activeRoute: context?.activeRoute || null,
    savedLocations: context?.savedLocations || {},
    history: context?.history ? [...context.history] : [],
  };

  const rawText = (userSpeechText || '').trim();

  // Registro en el historial
  currentContext.history?.push({
    role: 'user',
    content: rawText,
    timestamp: Date.now(),
  });

  const normalized = normalizeText(rawText);

  // 0a. Si estamos en confirmación de dirección (confirming_address) y el usuario afirma, niega o dicta corrección directa:
  // Procesar de forma inmediata y determinista sin latencia de red
  if (currentContext.pendingAliasRegistration?.step === 'confirming_address') {
    if (
      isAffirmative(normalized) ||
      isNegativeOrCancel(normalized) ||
      extractAddressCorrection(rawText, normalized)
    ) {
      return await processUserMessageLocal(rawText, currentContext);
    }
  }

  // 0b. Si hay confirmación de viaje pendiente y el usuario afirma/niega:
  // Procesar de forma inmediata y determinista sin latencia ni riesgo de desvío por LLM
  if (currentContext.pendingConfirmation) {
    if (isAffirmative(normalized) || isNegativeOrCancel(normalized)) {
      return await processUserMessageLocal(rawText, currentContext);
    }
  }

  // 0c. Si hay finalización de viaje pendiente y el usuario niega:
  if (currentContext.pendingTripCompletion) {
    if (isNegativeOrCancel(normalized)) {
      return await processUserMessageLocal(rawText, currentContext);
    }
  }

  // 1. Intentar procesamiento con Groq LLM
  try {
    const groqResponse = await callGroqLLM(rawText, currentContext);
    if (groqResponse) {
      return groqResponse;
    }
  } catch (error) {
    console.warn('Error en llamada a Groq LLM, procediendo a fallback local:', error);
  }

  // 2. Fallback infalible al motor local
  return await processUserMessageLocal(rawText, currentContext);
}

// ============================================================================
// CLASE SERVICE: ConversationService
// ============================================================================

export class ConversationService {
  static readonly TOOLS = AVAN_TOOLS;
  static readonly SYSTEM_PROMPT = GERONTOLOGICAL_SYSTEM_PROMPT;

  static async processUserMessage(
    userSpeechText: string,
    context?: ConversationContext
  ): Promise<ConversationResponse> {
    return processUserMessage(userSpeechText, context);
  }

  static createInitialContext(
    userName?: string,
    currentLocation?: LocationCoordinate
  ): ConversationContext {
    return {
      userName: userName || 'Gustavo',
      currentLocation,
      pendingConfirmation: null,
      pendingAliasRegistration: null,
      pendingTripCompletion: null,
      activeRoute: null,
      savedLocations: {},
      history: [],
    };
  }
}
