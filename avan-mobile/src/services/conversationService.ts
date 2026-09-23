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
  step: 'awaiting_address';
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
   - guardar_ubicacion(alias: string, direccion?: string): Guarda un sitio frecuente.
   - ajustar_zoom(direccion: 'acercar' | 'alejar' | 'centrar'): Adapta la vista del mapa.
   - confirmar_viaje(destino?: string): Inicia la marcha tras confirmación.
   - cancelar(): Cancela confirmación o detiene navegación activa.
   - consultar_trafico(): Informa sobre el estado del tráfico.
   - reportar_incidente(tipo: string): Registra incidente vial (accidente, obras, tráfico).
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
    /(?:a\s+casa\s+de|casa\s+de|a\s+lo\s+de)\s+(.+)/i,
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

function extractSaveAlias(normalized: string): string | null {
  const patterns = [
    /(?:guarda|guardar|guarde|anota|anotar|registra|registrar|grabar|graba)\s+(?:esta\s+ubicacion\s+como|este\s+lugar\s+como|como|aqui\s+como|mi\s+ubicacion\s+como)\s+(.+)/i,
    /(?:guarda|guardar|guarde|anota|anotar)\s+(?:este\s+sitio\s+como|el\s+sitio\s+como)\s+(.+)/i,
    /(?:guarda|guardar|guarde|anota|anotar)\s+(?:mi\s+casa|la\s+casa\s+de\s+.+|el\s+doctor|la\s+farmacia|el\s+hospital|mi\s+trabajo)/i,
    /(?:guardar\s+ubicacion)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const alias = (match[1] || match[0]).replace(/^(?:guarda|guardar|guarde)\s+/i, '').trim();
      if (alias.length > 1) {
        return capitalizeWords(alias);
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
          if (context.pendingTripCompletion) {
            context.pendingTripCompletion = null;
          }
          const rawDest = fnArgs.destino || userSpeechText;
          const aliasRes = AliasService.resolveDestinationWithAlias(rawDest);
          const destName = aliasRes.resolvedName;
          const destCoords = aliasRes.coordinates;
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
            args: { destino: destName, isForaneo },
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
          const alias = fnArgs.alias || 'ubicación guardada';
          const address = fnArgs.direccion || 'Ubicación registrada';
          const coords = context.currentLocation || CDMX_CENTER;

          AliasService.saveAlias(alias, capitalizeWords(alias), address, coords);

          const spokenText =
            rawContent || `He guardado esta ubicación con el nombre "${alias}".`;
          const functionCall: FunctionCall = {
            name: 'guardar_ubicacion',
            args: {
              alias,
              direccion: address,
              latitud: coords.latitude,
              longitud: coords.longitude,
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

      const isFarewell =
        /(?:hasta luego|excelente d[ií]a|buen d[ií]a|buenas noches|a su disposici[oó]n|nos vemos|adi[oó]s|que descanse|cu[ií]dese|que le vaya bien|con mucho gusto)/i.test(
          rawContent
        );
      const asksQuestion = rawContent.includes('?');

      context.history?.push({
        role: 'assistant',
        content: rawContent,
        timestamp: Date.now(),
      });

      return {
        spokenText: rawContent,
        functionCall: null,
        updatedContext: context,
        requiresConfirmation: false,
        shouldAutoListen: asksQuestion && !isFarewell,
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

function processUserMessageLocal(
  userSpeechText: string,
  context: ConversationContext
): ConversationResponse {
  const currentContext = context;
  const rawText = (userSpeechText || '').trim();
  const normalized = normalizeText(rawText);

  // --------------------------------------------------------------------------
  // CASO A: FLUJO DE REGISTRO ASISTIDO DE ALIAS (T-2.2)
  // --------------------------------------------------------------------------
  if (currentContext.pendingAliasRegistration) {
    const aliasName = currentContext.pendingAliasRegistration.aliasName;

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
      };
    }

    const address = rawText;
    const defaultCoords = currentContext.currentLocation || CDMX_CENTER;

    const saved = AliasService.saveAlias(
      aliasName,
      capitalizeWords(aliasName),
      address,
      defaultCoords
    );

    currentContext.pendingAliasRegistration = null;

    const isForaneo = isForaneoTrip(aliasName, saved.coordinates, currentContext.currentLocation);
    currentContext.pendingConfirmation = {
      destination: saved.name,
      coordinates: saved.coordinates,
      isForaneo,
      timestamp: Date.now(),
      originalQuery: rawText,
    };

    const responseText = `He guardado ${saved.name}. ¿Desea que iniciemos el viaje hacia allá?`;
    const functionCall: FunctionCall = {
      name: 'guardar_ubicacion',
      args: {
        alias: aliasName,
        direccion: address,
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
    };
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

    if (isAffirmative(normalized)) {
      const responseText = isForaneo
        ? `Entendido. Iniciando la ruta en carretera hacia ${destination}. Conduzca con precaución y descanse cuando lo requiera.`
        : `Excelente. Iniciando la ruta hacia ${destination}. Conduzca con precaución.`;

      const functionCall: FunctionCall = {
        name: 'confirmar_viaje',
        args: { destino: destination, isForaneo },
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
      const responseText = `Entendido. He cancelado el viaje a ${destination}. ¿Desea ir a algún otro lugar?`;
      const functionCall: FunctionCall = {
        name: 'cancelar',
        args: { motivo: 'Confirmación rechazada por el usuario' },
      };

      currentContext.pendingConfirmation = null;
      currentContext.pendingTripCompletion = {
        destination,
        timestamp: Date.now(),
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

    const newDestination = extractDestination(rawText, normalized);
    if (newDestination && newDestination.toLowerCase() !== destination.toLowerCase()) {
      const aliasResult = AliasService.resolveDestinationWithAlias(newDestination);
      const resolvedTarget = aliasResult.resolvedName;
      const foraneoNew = isForaneoTrip(
        resolvedTarget,
        aliasResult.coordinates,
        currentContext.currentLocation
      );

      currentContext.pendingConfirmation = {
        destination: resolvedTarget,
        coordinates: aliasResult.coordinates,
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
  // CASO 2: SOLICITUD DE NAVEGACIÓN (PASO 1)
  // --------------------------------------------------------------------------
  const personQuery = detectPersonOrHomeQuery(rawText, normalized);
  const rawDestination =
    extractDestination(rawText, normalized) || (personQuery ? `con ${personQuery}` : null);

  if (rawDestination) {
    const aliasResolution = AliasService.resolveDestinationWithAlias(rawDestination);

    if (!aliasResolution.isAlias && personQuery) {
      const personName = personQuery.replace(/^(?:mi|el|la)\s+/i, '').trim();

      currentContext.pendingAliasRegistration = {
        aliasName: `casa de ${personQuery}`,
        step: 'awaiting_address',
        timestamp: Date.now(),
      };

      const responseText = `No tengo guardada la casa de tu ${personName}. ¿Cuál es la dirección o colonia para guardarla?`;

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
      };
    }

    const destinationName = aliasResolution.resolvedName;
    const destinationCoords = aliasResolution.coordinates;

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

  // 0. Si hay confirmación pendiente o finalización de viaje pendiente y el usuario afirma/niega:
  // Procesar de forma inmediata y determinista sin latencia ni riesgo de desvío por LLM
  const normalized = normalizeText(rawText);
  if (currentContext.pendingConfirmation) {
    if (isAffirmative(normalized) || isNegativeOrCancel(normalized)) {
      return processUserMessageLocal(rawText, currentContext);
    }
  }
  if (currentContext.pendingTripCompletion) {
    if (isNegativeOrCancel(normalized)) {
      return processUserMessageLocal(rawText, currentContext);
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
  return processUserMessageLocal(rawText, currentContext);
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
