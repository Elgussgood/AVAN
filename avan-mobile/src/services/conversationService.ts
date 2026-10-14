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
import {
  orsService,
  DisambiguationCandidate,
  GeocodePrecision,
  StructuredAddressQuery,
  parseStructuredAddress,
} from './orsService';

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
export type ZoomIntensity = 'normal' | 'mucho' | 'poco';

/**
 * Argumentos para la herramienta navegar_a
 */
export interface NavegarAArgs {
  /** Nombre del destino, dirección o punto de interés */
  destino: string;
  /** Nombre de la calle o avenida si aplica */
  calle?: string;
  /** Número exterior si aplica */
  numero?: string;
  /** Colonia o barrio si aplica */
  colonia?: string;
  /** Alcaldía o municipio si aplica */
  alcaldia?: string;
  /** Cruce o esquina si aplica */
  cruce?: string;
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
  /** Nombre de la calle o avenida si aplica */
  calle?: string;
  /** Número exterior si aplica */
  numero?: string;
  /** Colonia o barrio si aplica */
  colonia?: string;
  /** Cruce o esquina si aplica */
  cruce?: string;
}

/**
 * Argumentos para la herramienta ajustar_zoom
 */
export interface AjustarZoomArgs {
  /** Dirección del zoom en el mapa o centrado */
  direccion: ZoomDirection;
  /** Intensidad del zoom solicitado */
  intensidad?: ZoomIntensity;
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
        'Calcula la ruta hacia un destino, dirección o punto de interés, y formula la confirmación en dos pasos requerida antes de iniciar la navegación.',
      parameters: {
        type: 'object',
        properties: {
          destino: {
            type: 'string',
            description:
              'Nombre normalizado del lugar, dirección o punto de interés al que desea desplazarse el usuario (ej. "Palacio de Bellas Artes", "Sonora 120, Condesa").',
          },
          calle: {
            type: 'string',
            description: 'Nombre de la calle o avenida si se indicó una dirección vial (ej. "Sonora", "Insurgentes").',
          },
          numero: {
            type: 'string',
            description: 'Número exterior si se especificó en la dirección (ej. "120", "1422").',
          },
          colonia: {
            type: 'string',
            description: 'Colonia o barrio si se indicó (ej. "Condesa", "Roma Norte", "Del Valle").',
          },
          alcaldia: {
            type: 'string',
            description: 'Alcaldía o municipio si se indicó (ej. "Cuauhtémoc", "Benito Juárez").',
          },
          cruce: {
            type: 'string',
            description: 'Calle transversal, cruce o esquina si fue mencionada (ej. "Ámsterdam").',
          },
          isForaneo: {
            type: 'boolean',
            description: 'Verdadero si el destino es un viaje foráneo en carretera (>50 km fuera de la ciudad, ej. Cuernavaca, Puebla, Acapulco).',
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
        'Guarda o actualiza una ubicación con un alias o etiqueta personalizada (ej. "casa", "doctor", "hijo").',
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
          calle: {
            type: 'string',
            description: 'Nombre de la calle o avenida si se especificó.',
          },
          numero: {
            type: 'string',
            description: 'Número exterior si aplica.',
          },
          colonia: {
            type: 'string',
            description: 'Colonia o barrio si aplica.',
          },
          cruce: {
            type: 'string',
            description: 'Calle de cruce o esquina si aplica.',
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
          intensidad: {
            type: 'string',
            enum: ['normal', 'mucho', 'poco'],
            description:
              'Grado de intensidad solicitado por el usuario: "mucho" si dice "haz mucho zoom", "acerca bastante", "aleja bastante", "máximo", "mucho más grande"; "poco" si dice "un poco", "un tantito", "un leve"; o "normal" por defecto.',
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
  isAlias?: boolean;
  aliasKey?: string;
  precision?: GeocodePrecision;
}

export interface PendingAliasRegistration {
  aliasName: string;
  step: 'awaiting_address' | 'confirming_address';
  addressCandidate?: string;
  coordinates?: LocationCoordinate;
  retryCount?: number;
  timestamp: number;
  isUpdating?: boolean;
  precision?: GeocodePrecision;
}

export interface PendingDisambiguation {
  originalQuery: string;
  intent: 'navigation' | 'alias_registration';
  aliasName?: string;
  candidates: DisambiguationCandidate[];
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
  pendingDisambiguation?: PendingDisambiguation | null;
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

4. Protocolo de cancelación, rectificación y continuidad:
   - Si el usuario rechaza la confirmación pero RECTIFICA o indica otro destino (ej. "No, quiero ir a Bellas Artes", "No, mejor al metro", "Cámbialo a Reforma", "Prefiero ir con mi hijo", "No, al Zócalo"): DEBES invocar inmediatamente 'navegar_a(destino: nuevo_destino)'. Responde reconociendo el cambio: "Entendido, he cambiado el destino a [Nuevo Destino]. ¿Desea que iniciemos el viaje hacia allá?". NUNCA invoques 'cancelar' cuando el usuario haya mencionado un nuevo destino.
   - Si el usuario estaba confirmando un viaje a un alias o lugar registrado (ej. "casa de mi primo", "el doctor", "casa de mi hijo") y dice que la dirección es otra o que no es ahí (ej. "No es ahí, es en Sonora 120", "Está mal la dirección, es en...", "No, es en Sonora 120", "Cambia la dirección a...", "La dirección es..."): DEBES invocar 'guardar_ubicacion(alias, direccion)' para actualizar la dirección guardada de dicho alias con confirmación del usuario. NUNCA invoques 'navegar_a' hacia la calle como un viaje nuevo inconexo.
   - Si el usuario pide cancelar un viaje o rechaza una confirmación sin indicar un nuevo destino (ej. "No", "Cancela", "Ya no quiero ir", "Detener"), invoca la herramienta 'cancelar'.
   - REGLA CRÍTICA DE CANCELACIÓN (PASO 1): Al cancelar un viaje o confirmación pura, NUNCA te despidas prematuramente (NO digas "hasta luego", "que tenga buen día" ni frases de despedida). Confirma la cancelación y pregunta amablemente de continuidad: "Entendido. He cancelado el viaje a [Destino]. ¿Desea ir a algún otro lugar?".
   - REGLA CRÍTICA DE CIERRE (PASO 2): Si ya le preguntaste al usuario "¿Desea ir a algún otro lugar?" y el usuario responde que no ("No", "No gracias", "Ninguno", "Ya no", "Para nada"), NO invoques ninguna herramienta; responde únicamente con una cálida despedida formal: "Excelente, que tenga un excelente día."

5. Herramientas del sistema:
   - navegar_a(destino: string): Calcula ruta y solicita confirmación.
   - guardar_ubicacion(alias: string, direccion?: string): Guarda un sitio frecuente o inicia el registro.
   - ajustar_zoom(direccion: 'acercar' | 'alejar' | 'centrar', intensidad?: 'normal' | 'mucho' | 'poco'): Adapta la vista del mapa con el grado de intensidad requerido. Si el usuario dice "haz mucho zoom", "acerca bastante", "haz zoom al máximo", "aleja bastante", usa intensidad: "mucho". Si dice "un poco", "un tantito", "un leve", usa intensidad: "poco". Si dice simplemente "haz zoom" o "acerca", usa intensidad: "normal".
   - confirmar_viaje(destino?: string): Inicia la marcha tras confirmación.
   - cancelar(): Cancela confirmación o detiene navegación activa.
   - consultar_trafico(): Informa sobre el estado del tráfico.
   - reportar_incidente(tipo: string): Registra incidente vial (accidente, obras, tráfico).

6. Directiva de Salto de Contexto Ubicuo y Flexibilidad Total:
   - El usuario puede cambiar de opinión o pedir cualquier acción desde cualquier pantalla o estado sin tener que cancelar manualmente el proceso anterior.
   - Si se estaba confirmando un viaje a un destino y el usuario dice "No, quiero ir a {otro lugar}" o menciona otro destino, invoca 'navegar_a' con el nuevo destino de inmediato.
   - Si se estaba confirmando una dirección o registrando un alias y el usuario dice "Quiero ir a Chapultepec" o pide cualquier destino, DEBES invocar 'navegar_a(destino: "Chapultepec")'. El sistema cancelará el registro previo automáticamente.
   - Si se estaba por confirmar un viaje y el usuario dice "Quiero registrar una nueva dirección" o "Guarda la casa de mi hijo", DEBES invocar 'guardar_ubicacion'. El sistema cancelará la confirmación del viaje anterior automáticamente.
   - Si el usuario pide ajustar el mapa ("acercar", "haz mucho zoom", "aleja un poco", "centrar"), invoca 'ajustar_zoom'.
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

/**
 * Detecta si una expresión verbal del usuario contiene una rectificación de destino o cambio de opinión.
 * Evita que frases como "no, quiero ir a Bellas Artes" o "no, mejor al metro politécnico"
 * sean interceptadas erróneamente como cancelaciones puras.
 */
export function hasRectificationPattern(normalized: string): boolean {
  return (
    /(?:quiero\s+ir|quisiera\s+ir|deseo\s+ir|voy\s+a\s+ir|llevame|llevarme|vamos|mejor|cambia|cambialo|modifica|prefiero|a\s+la\s+casa|casa\s+de|con\s+mi|donde\s+mi)\b/i.test(
      normalized
    ) ||
    /^(?:no\s*,?\s+)(?:a|al|hacia|con|para)\s+[a-z0-9]/i.test(normalized) ||
    /^(?:no\s*,?\s+)(?:el\s+|la\s+)?(?:metro|metrobus|metrob[uú]s|suburbano|tren|hospital|parque|plaza|museo|alameda|bellas\s+artes|zocalo|z[oó]calo|aeropuerto)\b/i.test(
      normalized
    ) ||
    /^(?:no\s*,?\s+)?(?:me\s+equivoqu[eé]|no\s+es\s+ah[ií]|esta\s+mal)\s*,?\s*(?:es\s+en|es\s+a|era\s+en|era\s+a|vamos\s+a|quiero\s+ir\s+a|llevame\s+a)\s+[a-z0-9]/i.test(
      normalized
    )
  );
}

/**
 * Extrae el nuevo destino solicitado cuando el usuario rectifica o cambia de parecer durante una confirmación.
 */
export function extractDestinationFromRectification(
  rawText: string,
  normalized: string
): string | null {
  // 1. Patrones directos de transporte / POI con "no, ..."
  // Ej: "no, metro politécnico", "no, al metro politécnico", "no, el metrobus insurgentes", "no, bellas artes"
  const noPoiMatch = normalized.match(
    /^(?:no\s*,?\s+)(?:al?\s+|el\s+|la\s+)?(metro\b.+|metrobus\b.+|metrob[uú]s\b.+|suburbano\b.+|parque\b.+|hospital\b.+|plaza\b.+|centro\b.+|museo\b.+|alameda\b.+|bellas\s+artes\b.*|zocalo\b.*|z[oó]calo\b.*|aeropuerto\b.*)/i
  );
  if (noPoiMatch && noPoiMatch[1]) {
    const candidate = noPoiMatch[1].trim();
    if (candidate.length > 2 && !['gracias', 'cancelar', 'cancela', 'ya no', 'detener'].includes(candidate.toLowerCase())) {
      return capitalizeWords(candidate);
    }
  }

  // 2. Patrones con "con [persona]" o "a la casa de [persona]" o "donde [persona]"
  // Ej: "no, quiero ir con mi hijo", "no, a la casa de juan", "no, con mi doctor"
  const personMatch = normalized.match(
    /^(?:no\s*,?\s*)?(?:me\s+equivoqu[eé]\s*,?\s*)?(?:mejor\s+|quiero\s+ir\s+|quisiera\s+ir\s+|vamos\s+|llevame\s+)?(?:con\s+|a\s+la\s+casa\s+de\s+|a\s+casa\s+de\s+|donde\s+)(.+)/i
  );
  if (personMatch && personMatch[1]) {
    const candidate = personMatch[1].trim();
    if (candidate.length > 1 && !isAffirmative(candidate) && !['gracias', 'cancelar', 'cancela', 'ya no'].includes(candidate.toLowerCase())) {
      if (personMatch[0].includes('con ')) {
        return capitalizeWords(`con ${candidate}`);
      } else if (personMatch[0].includes('casa de')) {
        return capitalizeWords(`casa de ${candidate}`);
      }
      return capitalizeWords(candidate);
    }
  }

  // 3. Patrones de verbos y conectores de rectificación
  const patterns = [
    // "no, quiero ir a...", "no, quisiera ir a...", "no quiero ir a..."
    /^(?:no\s*,?\s*)?(?:me\s+equivoqu[eé]\s*,?\s*|no\s+es\s+ah[ií]\s*,?\s*)?(?:mejor\s+)?(?:quiero|quisiera|deseo|voy\s+a)\s+(?:ir|llegar|viajar|navegar)\s+(?:a|al|hacia|para)\s+(.+)/i,
    // "no, mejor llévame a...", "llévame mejor a...", "no, llévame a...", "llévame a..."
    /^(?:no\s*,?\s*)?(?:mejor\s+)?(?:llevame|llevarme|llevanos|conduceme|dirigeme)\s+(?:mejor\s+)?(?:a|al|hacia|para)\s+(.+)/i,
    // "no, cámbialo a...", "cambia el destino a...", "cambiar a..."
    /^(?:no\s*,?\s*)?(?:cambialo|c[aá]mbialo|cambia|cambiar|modifica|modificar)\s+(?:el\s+destino\s+a|a|al|hacia|por)\s+(.+)/i,
    // "no, mejor a...", "mejor al...", "mejor hacia...", "mejor en..."
    /^(?:no\s*,?\s*)?mejor\s+(?:a|al|hacia|en)\s+(.+)/i,
    // "no, prefiero ir a...", "prefiero ir a...", "prefiero ir al..."
    /^(?:no\s*,?\s*)?prefiero\s+(?:ir\s+a|ir\s+al|ir\s+hacia|a|al|hacia)\s+(.+)/i,
    // "no, vamos a...", "vamos mejor a..."
    /^(?:no\s*,?\s*)?vamos\s+(?:mejor\s+)?(?:a|al|hacia)\s+(.+)/i,
    // "no es ahí, es en / es a...", "era en...", "es a..."
    /^(?:no\s*,?\s*)?(?:no\s+es\s+ah[ií]|esta\s+mal)\s*,?\s*(?:es\s+en|es\s+a|era\s+en|era\s+a|vamos\s+a)\s+(.+)/i,
    // "no, a...", "no, al...", "no, hacia..." (ej: "no, a Bellas Artes", "no, al Zócalo", "no, a Polanco")
    /^(?:no\s*,?\s+)(?:a|al|hacia|para)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      let candidate = match[1].trim();
      candidate = candidate.replace(/^(?:la\s+direccion\s+es|calle|en|a|al)\s+/i, '').trim();
      if (
        candidate.length > 1 &&
        !isAffirmative(candidate) &&
        !['gracias', 'cancelar', 'cancela', 'ya no', 'olvidalo', 'detener', 'deten', 'nada', 'ninguno'].includes(candidate.toLowerCase())
      ) {
        return capitalizeWords(candidate);
      }
    }
  }

  return null;
}

/**
 * Detecta si el usuario está rectificando o actualizando la dirección de un alias o lugar registrado.
 * Ej: "no es ahí, es en Sonora 120", "está mal la dirección, es en...", "cambia la dirección a Sonora 120",
 * "la dirección es en...", "no, es en...", "no es ahí", "está mal la dirección".
 */
export function isAddressAdjustmentPattern(normalized: string): boolean {
  // 1. Detección de números directos (ej. "el 150", "es el 150", "numero 150", "al 150", "al numero 150", "cambia al 150", "150")
  if (/(?:es\s+el|es\s+la|el\s+numero|numero|al\s+numero|numero\s+exterior|al|cambia\s+al|cambialo\s+al|ponle\s+el|ponle\s+al)\s+\d+/i.test(normalized)) {
    return true;
  }
  if (/^(?:no\s*,?\s*)?(?:es\s+el\s+|el\s+|al\s+|al\s+numero\s+|numero\s+)?\d+[a-z0-9\s-]*$/i.test(normalized)) {
    return true;
  }
  // 2. Ajustes de colonia o zona (ej. "en la roma", "colonia del valle", "en la condesa")
  if (/^(?:no\s*,?\s*)?(?:es\s+en|era\s+en|en\s+la|en\s+el|colonia|cruce\s+con|esquina\s+con)\s+[a-z0-9]/i.test(normalized)) {
    return true;
  }
  // 3. Ajustes de número interior o departamento
  if (/(?:departamento|depto|interior|int|edificio|piso)\s+[a-z0-9]+/i.test(normalized)) {
    return true;
  }
  // 4. Frases que inician con "no, [dirección o lugar]" sin ser despedidas o cancelaciones
  if (/^no\s*,?\s+(?:es\s+|era\s+)?(?:el|la|en|calle|avenida|[a-z0-9]+)\s+/i.test(normalized)) {
    if (!['gracias', 'cancelar', 'cancela', 'ya no', 'olvidalo', 'detener', 'deten'].some((w) => normalized.includes(w))) {
      return true;
    }
  }
  return false;
}

/**
 * Detecta si el usuario está rectificando o actualizando la dirección de un alias o lugar registrado.
 * Ej: "no es ahí, es en Sonora 120", "está mal la dirección, es en...", "cambia la dirección a Sonora 120",
 * "la dirección es en...", "no, es en...", "no es ahí", "está mal la dirección".
 */
export function isAliasAddressCorrectionIntent(
  rawText: string,
  normalized: string
): { isCorrection: boolean; newAddress?: string } {
  // 1. Detección explícita de cambio/actualización de dirección
  const changeAddressMatch = normalized.match(
    /^(?:por\s+favor\s+)?(?:cambia|cambiale|cambiar|actualiza|actualizar|modifica|modificar|corrige|corregir)\s+(?:la\s+)?(?:direccion|ubicacion)\s+(?:a|por|en)\s+(.+)/i
  );
  if (changeAddressMatch && changeAddressMatch[1]) {
    let newAddress = changeAddressMatch[1].trim();
    newAddress = newAddress.replace(/^(?:la\s+direccion\s+es|la\s+direccion|direccion)\s+/i, '').trim();
    return { isCorrection: true, newAddress };
  }

  // 2. Detección de "la dirección es [en]..." / "la dirección correcta es [en]..."
  const addressIsMatch = normalized.match(
    /^(?:no\s*,?\s*)?(?:la\s+)?(?:direccion|ubicacion)(?:\s+correcta|\s+real)?\s+(?:es|era)\s+(?:en\s+|a\s+)?(.+)/i
  );
  if (addressIsMatch && addressIsMatch[1]) {
    let newAddress = addressIsMatch[1].trim();
    newAddress = newAddress.replace(/^(?:la\s+direccion\s+es|la\s+direccion|direccion)\s+/i, '').trim();
    return { isCorrection: true, newAddress };
  }

  // 3. Detección de "no es ahí / está mal la dirección / la dirección está mal / me equivoqué de dirección, es en..."
  const wrongWithNewMatch = normalized.match(
    /^(?:no\s*,?\s*)?(?:ah[ií]\s+no\s+es|no\s+es\s+ah[ií]|no\s+es\s+esa(?:\s+la)?\s+direccion|la\s+direccion\s+no\s+es\s+ah[ií]|la\s+direccion\s+esta\s+mal|esta\s+mal(?:\s+la\s+direccion)?|me\s+equivoqu[eé](?:\s+de\s+direccion)?|esa\s+no\s+es(?:\s+su|\s+la)?\s+(?:casa|direccion)|.+?\s+no\s+es\s+ah[ií])\s*,?\s*(?:es\s+en|es\s+a|era\s+en|era\s+a|en\s+realidad\s+es\s+en)\s+(.+)/i
  );
  if (wrongWithNewMatch && wrongWithNewMatch[1]) {
    let newAddress = wrongWithNewMatch[1].trim();
    newAddress = newAddress.replace(/^(?:la\s+direccion\s+es|la\s+direccion|direccion)\s+/i, '').trim();
    return { isCorrection: true, newAddress };
  }

  // 4. Detección de "no, es en [dirección]" / "no, era en [dirección]"
  const noEsEnMatch = normalized.match(
    /^(?:no\s*,?\s+)?(?:es\s+en|era\s+en|esta\s+en)\s+(.+)/i
  );
  if (noEsEnMatch && noEsEnMatch[1]) {
    let newAddress = noEsEnMatch[1].trim();
    newAddress = newAddress.replace(/^(?:la\s+direccion\s+es|la\s+direccion|direccion)\s+/i, '').trim();
    if (!['verdad', 'cierto', 'correcto', 'seguro'].includes(newAddress)) {
      return { isCorrection: true, newAddress };
    }
  }

  // 5. Detección de "no, en [calle/número/avenida]"
  const noEnMatch = normalized.match(
    /^(?:no\s*,?\s+)(?:en\s+)([a-z0-9].+)/i
  );
  if (noEnMatch && noEnMatch[1]) {
    let newAddress = noEnMatch[1].trim();
    if (!['serio', 'broma', 'vano'].includes(newAddress)) {
      return { isCorrection: true, newAddress };
    }
  }

  // 6. Detección de ajuste numérico (ej. "no, es el 150", "es el 150", "al 150")
  const numAdjMatch = normalized.match(
    /^(?:no\s*,?\s*)?(?:es\s+el|el\s+numero|numero|al\s+numero)\s+(\d+[a-z0-9\s-]*)/i
  );
  if (numAdjMatch && numAdjMatch[1]) {
    return { isCorrection: true, newAddress: numAdjMatch[1].trim() };
  }

  // 7. Detección de que la dirección está mal pero SIN dar la nueva dirección todavía
  const wrongWithoutAddressMatch = normalized.match(
    /^(?:no\s*,?\s*)?(?:no\s+es\s+ah[ií]|no\s+es\s+esa(?:\s+la)?\s+direccion|esta\s+mal\s+la\s+direccion|la\s+direccion\s+esta\s+mal|me\s+equivoqu[eé]\s+de\s+direccion|esa\s+no\s+es(?:\s+su|\s+la)?\s+(?:casa|direccion)|la\s+direccion\s+no\s+es\s+correcta)\s*$/i
  );
  if (wrongWithoutAddressMatch) {
    return { isCorrection: true, newAddress: undefined };
  }

  return { isCorrection: false };
}

function isNegativeOrCancel(normalized: string): boolean {
  // Si contiene una rectificación hacia otro destino, NO es una cancelación pura
  if (hasRectificationPattern(normalized)) {
    return false;
  }

  // Si contiene un ajuste o corrección de dirección, NO es una cancelación pura
  if (isAddressAdjustmentPattern(normalized)) {
    return false;
  }

  const negativePatterns = [
    /^no\s*$/,
    /^no gracias\b/,
    /^no por favor\b/,
    /^no quiero\s*$/,
    /^no quiero ir\s*$/,
    /^no me lleves\s*$/,
    /^no ya no\s*$/,
    /^ninguno\b/,
    /^ningun lugar\b/,
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
    /^no\b/,
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

  // Soporte directo para estaciones de transporte público (Metro, Metrobús, Tren Suburbano, etc.)
  const transportMatch = normalized.match(/^(?:el\s+|la\s+)?(?:metro|estacion|estación|metrobus|metrobús|suburbano|tren|paradero|terminal)\s+(.+)/i);
  if (transportMatch && transportMatch[1]) {
    const candidate = transportMatch[1].trim();
    if (candidate.length > 1 && !isAffirmative(candidate) && !isNegativeOrCancel(candidate)) {
      return capitalizeWords(rawText.trim());
    }
  }

  // Detección directa de POIs y destinos urbanos directos sin verbo (ej. "Metro Politécnico", "Bellas Artes", "Reforma 222")
  // Siempre que no sea comando de control, ni zoom, ni reporte de tráfico, ni saludo, ni solicitud de guardar
  const isControlOrNonDest =
    isAffirmative(normalized) ||
    isNegativeOrCancel(normalized) ||
    /(?:acercar|alejar|centrar|zoom|mas cerca|mas lejos|trafico|incidente|accidente|bache|ayuda|hola|adios|gracias)/i.test(normalized) ||
    isAddAddressIntent(normalized);

  if (!isControlOrNonDest) {
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 6) {
      if (!/^\d+$/.test(normalized) && normalized.length > 3) {
        return capitalizeWords(rawText.trim());
      }
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

  // EXCLUSIÓN ABSOLUTA: Si es transporte público, avenidas, hospitales o lugares públicos, NUNCA es un lugar personal
  if (
    /(?:metro|estacion|estación|metrobus|metrobús|suburbano|paradero|terminal|avenida|calle|eje|viaducto|periferico|hospital|clinica|parque|bosque|alameda|museo|plaza|aeropuerto|universidad|facultad|instituto|politecnico|zacatenco|cu|unam|ipn|escom)/i.test(
      norm
    )
  ) {
    return false;
  }

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
    // 1. Correcciones que empiezan explícitamente con negación o indicación de error
    /^(?:no\s*,?\s*)?(?:no es ahi|no es esa|esta mal|me equivoque|me equivoque de direccion)\s*,?\s*(?:es en|es a|era en|era a|en realidad es en|la direccion es|ponle en|cambiar a|mejor en|es el|es la|es)\s+(.+)/i,
    // 2. Prefijos de rectificación directa
    /^(?:no\s*,?\s*)?(?:era en|es en|cambiar a|cambialo a|cambiale a|ponle en|ponle|mejor en|en realidad es en|la direccion es|la direccion correcta es)\s+(.+)/i,
    // 3. Ajustes de número directo (ej: "no, es el 150", "es el 150", "el numero es 150", "numero 150", "al 150")
    /^(?:no\s*,?\s*)?(?:es\s+el|es\s+la|el\s+numero\s+es|el\s+numero|numero|al\s+numero)\s+(\d+[a-zA-Z0-9\s-]*)/i,
    // 4. Inicia con "no, [algo]"
    /^no\s*,?\s+(?:es\s+)?(.+)/i,
    // 5. Inicia con "en [dirección]"
    /^en\s+(.+)/i,
    // 6. Directo "es el [número]" o "el [número]"
    /^(?:es\s+el|el)\s+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1]
        .replace(/^(?:la direccion es|la direccion|direccion)\s+/i, '')
        .trim();
      const lower = candidate.toLowerCase();
      if (
        candidate.length > 0 &&
        !['gracias', 'cancelar', 'cancela', 'ya no', 'olvidalo', 'detener', 'deten'].includes(lower)
      ) {
        return candidate;
      }
    }
  }

  // Si el usuario dijo únicamente un número (ej. "150")
  if (/^\d+[a-zA-Z0-9\s-]*$/.test(rawText.trim())) {
    return rawText.trim();
  }

  return null;
}

function detectZoomDirection(normalized: string): ZoomDirection | null {
  if (
    /(?:acercar|acerca|haz\s+(?:\w+\s+)?zoom|zoom|mas cerca|ampliar|amplia|aumentar|aumenta|acercate|no veo bien|hazlo\s+(?:\w+\s+)?grande|mas grande|acercamiento)/i.test(
      normalized
    )
  ) {
    return 'acercar';
  }

  if (
    /(?:alejar|aleja|menos zoom|mas lejos|vista general|vista amplia|hazlo\s+(?:\w+\s+)?pequeno|mas pequeno|alejate|reducir|alejamiento)/i.test(
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

function detectZoomIntensity(normalized: string): ZoomIntensity {
  if (
    /(?:mucho|bastante|al maximo|maximo|bien grande|muy cerca|mucho zoom|lo mas que puedas|todo el zoom|mas mas|mucho mas|bien lejos|muy lejos|todo)/i.test(
      normalized
    )
  ) {
    return 'mucho';
  }

  if (
    /(?:un poco|poco|tantito|un leve|leve|un tantito|despacio|ligeramente|apenitas)/i.test(
      normalized
    )
  ) {
    return 'poco';
  }

  return 'normal';
}

function capitalizeWords(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// DESAMBIGUACIÓN ASISTIDA POR REFERENCIAS Y LANDMARKS (TASK-40)
// ============================================================================

/**
 * Genera el mensaje hablado gerontológico para presentar opciones de desambiguación.
 * Estructurado en máximo 3-4 opciones con puntos de referencia notorios (Metros, Parques, Hospitales).
 */
export function buildDisambiguationSpokenPrompt(
  candidates: DisambiguationCandidate[],
  intent: 'navigation' | 'alias_registration',
  aliasName?: string
): string {
  const count = candidates.length;
  const countWord = count === 2 ? 'dos' : count === 3 ? 'tres' : count === 4 ? 'cuatro' : `${count}`;

  const header =
    intent === 'alias_registration'
      ? `Encontré ${countWord} lugares con ese nombre para ${aliasName || 'el lugar'}:`
      : `Encontré ${countWord} lugares con ese nombre:`;

  const lines = candidates.map((c, i) => {
    const num = i + 1;
    const ref = c.landmarkRef ? `, cerca de ${c.landmarkRef}` : '';
    return `${num}, en ${c.colonia_o_alcaldia}${ref}.`;
  });

  const question =
    intent === 'alias_registration'
      ? '¿Cuál de ellos desea registrar? Puede decirme el número, la zona o un lugar cercano.'
      : '¿A cuál de ellos desea ir? Puede decirme el número, la zona o un lugar cercano.';

  return `${header} ${lines.join(' ')} ${question}`;
}

/**
 * Resuelve la selección del usuario frente a una lista de candidatos en desambiguación.
 * Soporta selección ordinal ("la primera", "el 1", "2"), por zona ("Coyoacán") y por referencia ("el metro").
 */
export function resolveDisambiguationSelection(
  rawText: string,
  normalized: string,
  candidates: DisambiguationCandidate[]
): DisambiguationCandidate | null {
  if (!candidates || candidates.length === 0) return null;

  // 1. Coincidencia por número ordinal o cardinal
  const ordinalMap: Record<string, number> = {
    'primera': 0, 'primero': 0, 'primer': 0, 'la 1': 0, 'el 1': 0, 'uno': 0, '1': 0, 'opcion 1': 0, 'la una': 0,
    'segunda': 1, 'segundo': 1, 'la 2': 1, 'el 2': 1, 'dos': 1, '2': 1, 'opcion 2': 1,
    'tercera': 2, 'tercero': 2, 'la 3': 2, 'el 3': 2, 'tres': 2, '3': 2, 'opcion 3': 2,
    'cuarta': 3, 'cuarto': 3, 'la 4': 3, 'el 4': 3, 'cuatro': 3, '4': 3, 'opcion 4': 3,
  };

  for (const [phrase, index] of Object.entries(ordinalMap)) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'i');
    if (regex.test(normalized)) {
      if (index < candidates.length) {
        return candidates[index];
      }
    }
  }

  // 2. Coincidencia por zona / colonia / alcaldía
  for (const candidate of candidates) {
    const zoneTokens = normalizeText(candidate.colonia_o_alcaldia)
      .split(/\s+/)
      .filter((t) => t.length > 3);
    for (const token of zoneTokens) {
      if (normalized.includes(token)) {
        return candidate;
      }
    }
    const labelTokens = normalizeText(candidate.label)
      .split(/\s+/)
      .filter((t) => t.length > 4 && !['calle', 'avenida', 'numero', 'ciudad', 'mexico'].includes(t));
    for (const token of labelTokens) {
      if (normalized.includes(token)) {
        return candidate;
      }
    }
  }

  // 3. Coincidencia por nombre específico de Landmark o referencia (ej. "viveros", "hidalgo", "zapata")
  for (const candidate of candidates) {
    if (candidate.landmarkRef) {
      const refNorm = normalizeText(candidate.landmarkRef);
      const refTokens = refNorm
        .split(/\s+/)
        .filter((t) => t.length > 3 && !['metro', 'metrobus', 'cerca', 'parque', 'hospital'].includes(t));
      for (const token of refTokens) {
        if (normalized.includes(token)) {
          return candidate;
        }
      }
    }
  }

  // 4. Coincidencia por tipo de Landmark si es único entre los candidatos (ej. "la del parque", "la del metro")
  for (const candidate of candidates) {
    if (candidate.landmarkType && normalized.includes(candidate.landmarkType)) {
      const candidatesWithType = candidates.filter((c) => c.landmarkType === candidate.landmarkType);
      if (candidatesWithType.length === 1) {
        return candidate;
      }
    }
  }

  return null;
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
  cruce?: string;
  structuredQuery?: StructuredAddressQuery;
  precision?: GeocodePrecision;
}

export interface MergedAddressResult {
  formattedSearchQuery: string;
  formattedUserLabel: string;
  changedFieldDescription: string;
  calle?: string;
  numero?: string;
  colonia?: string;
  alcaldia_o_ciudad?: string;
  landmark?: string;
  cruce?: string;
  structuredQuery?: StructuredAddressQuery;
}

/**
 * Fusión diferencial e incremental de direcciones dictadas por el usuario sobre una dirección base.
 * Emplea Groq LLM (Llama 3.3 70B) para interpretar cambios puntuales dictados en lenguaje natural
 * (ej: "No, es el 150", "en la Roma Norte", "cruce con Insurgentes", "departamento 4B")
 * sin obligar al usuario a dictar la dirección entera de nuevo.
 */
export async function mergeAddressAdjustmentWithLLM(
  baseAddress: string,
  userAdjustmentText: string,
  context?: ConversationContext
): Promise<MergedAddressResult> {
  const trimmedAdjustment = (userAdjustmentText || '').trim();
  const trimmedBase = (baseAddress || 'Ciudad de México').trim();

  if (!trimmedAdjustment) {
    return {
      formattedSearchQuery: trimmedBase,
      formattedUserLabel: trimmedBase.split(',').slice(0, 2).join(',').trim(),
      changedFieldDescription: 'a la dirección indicada',
    };
  }

  // 1. FAST-PATH HEURÍSTICO / 0ms: Si es un ajuste numérico, de colonia o calle predecible
  const heuristicResult = mergeAddressAdjustmentHeuristic(trimmedBase, trimmedAdjustment);
  if (
    heuristicResult &&
    heuristicResult.changedFieldDescription &&
    heuristicResult.changedFieldDescription !== 'a la nueva ubicación' &&
    heuristicResult.formattedSearchQuery !== trimmedBase
  ) {
    return heuristicResult;
  }

  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;

  if (apiKey && apiKey.trim() !== '') {
    try {
      const systemPrompt = `Eres un asistente experto en nomenclatura urbana, cartografía y direcciones de México para la app gerontológica AVAN.
Tu trabajo es recibir una dirección previamente propuesta y una corrección o ajuste menor dictado por un adulto mayor, devolviendo la dirección resultante FUSIONADA sin obligar al usuario a repetir todo desde cero.

DIRECCIÓN BASE PROPUESTA: "${trimmedBase}"
CORRECCIÓN O AJUSTE DICTADO POR EL USUARIO: "${trimmedAdjustment}"

INSTRUCCIONES CLAVE:
1. Identifica qué componente específico está corrigiendo el usuario:
   - Número exterior (ej: "no, es el 150", "el 150", "al 150", "número 150"): MANTÉN la misma calle, colonia y alcaldía de la base y sustituye ÚNICAMENTE el número por el nuevo. Descripción: "al número [nuevo]".
   - Colonia / Barrio (ej: "no, en la Roma Norte", "en la Roma, no en la Condesa"): MANTÉN la calle y el número de la base y sustituye la colonia. Descripción: "a la colonia [nueva]".
   - Nombre de calle (ej: "era en Oaxaca, no en Sonora", "sobre Michoacán"): MANTÉN el número y colonia si aplican y sustituye la calle. Descripción: "a la Calle [nueva]".
   - Esquina / Cruce (ej: "esquina con Monterrey", "cruce con Insurgentes"): Añade el cruce vial conservando la calle y colonia. Descripción: "al cruce con [calle]".
   - Dirección completa nueva (ej: "no, es en Calzada de Tlalpan 500"): Si el usuario dictó una calle y zona totalmente distintas, sustituye toda la dirección. Descripción: "a [dirección corta]".
2. Genera 'formattedSearchQuery' como la dirección completa normalizada para el geocodificador (ej: "Calle Sonora 150, Condesa, Cuauhtémoc, Ciudad de México").
3. Genera 'formattedUserLabel' como una etiqueta corta y amable para el usuario (ej: "Calle Sonora 150, Condesa").
4. Genera 'changedFieldDescription' explicando de manera muy breve y natural el cambio realizado (ej: "al número 150", "a la colonia Roma Norte", "al cruce con Insurgentes").

Responde ÚNICAMENTE con un JSON bien formado sin texto adicional ni bloques markdown:
{
  "changedFieldDescription": "descripción corta del cambio (ej: 'al número 150', 'a la colonia Roma Norte')",
  "calle": "nombre de la calle",
  "numero": "número exterior",
  "colonia": "colonia o barrio",
  "alcaldia_o_ciudad": "alcaldía o ciudad",
  "cruce": "cruce o calle transversal si aplica",
  "formattedSearchQuery": "dirección unificada y completa para geocodificación",
  "formattedUserLabel": "etiqueta corta y legible para confirmación"
}`;

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
            { role: 'user', content: `Ajuste: ${trimmedAdjustment}` },
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
              const structuredQuery: StructuredAddressQuery = {
                street: parsed.calle || '',
                houseNumber: parsed.numero || undefined,
                colonia: parsed.colonia || undefined,
                alcaldia: parsed.alcaldia_o_ciudad || undefined,
                crossStreet: parsed.cruce || undefined,
                city: 'Ciudad de México',
                rawQuery: parsed.formattedSearchQuery,
              };

              return {
                formattedSearchQuery: parsed.formattedSearchQuery,
                formattedUserLabel: parsed.formattedUserLabel,
                changedFieldDescription: parsed.changedFieldDescription || 'a la nueva ubicación',
                calle: parsed.calle || undefined,
                numero: parsed.numero || undefined,
                colonia: parsed.colonia || undefined,
                alcaldia_o_ciudad: parsed.alcaldia_o_ciudad || undefined,
                landmark: parsed.landmark || undefined,
                cruce: parsed.cruce || undefined,
                structuredQuery,
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('[conversationService] Error en mergeAddressAdjustmentWithLLM con Groq, usando fallback heurístico:', err);
    }
  }

  // Fallback heurístico inteligente
  return mergeAddressAdjustmentHeuristic(trimmedBase, trimmedAdjustment);
}

export function mergeAddressAdjustmentHeuristic(
  baseAddress: string,
  adjustmentText: string
): MergedAddressResult {
  const cleanAdj = adjustmentText.trim();

  // 1. Ajuste numérico (ej: "150", "el 150", "es el 150", "número 150", "no, 150")
  const numMatch = cleanAdj.match(/(?:es\s+el|el\s+numero|numero|al\s+numero|no\s*,?\s*es\s+el|no\s*,?\s*)?\s*(\d+[a-zA-Z0-9-]*)/i);
  if (numMatch && numMatch[1] && (cleanAdj.length < 20 || /^\D*\d+\D*$/.test(cleanAdj))) {
    const newNum = numMatch[1];
    let updatedQuery = baseAddress;
    if (/\b\d+\b/.test(baseAddress)) {
      updatedQuery = baseAddress.replace(/\b\d+\b/, newNum);
    } else {
      updatedQuery = baseAddress.replace(/^([A-Za-z\s]+?)(?:,|$)/, `$1 ${newNum},`);
    }
    const labelParts = updatedQuery.split(',').map((s) => s.trim());
    const structuredQuery = parseStructuredAddress(updatedQuery);
    return {
      changedFieldDescription: `al número ${newNum}`,
      numero: newNum,
      formattedSearchQuery: updatedQuery,
      formattedUserLabel: labelParts.slice(0, 2).join(', '),
      structuredQuery,
    };
  }

  // 2. Ajuste de colonia o zona (cuando no hay números en el ajuste y no es comando de control)
  if (!/\d+/.test(cleanAdj)) {
    const colCleaned = cleanAdj
      .replace(/^(?:no\s*,?\s*)?(?:es\s+en|era\s+en|en\s+la|en\s+el|en|colonia|col\.?|la|el)\s+/i, '')
      .trim();
    if (
      colCleaned.length > 2 &&
      !['gracias', 'cancelar', 'cancela', 'ya no', 'olvidalo', 'detener', 'deten'].includes(colCleaned.toLowerCase())
    ) {
      const parts = baseAddress.split(',').map((s) => s.trim());
      const colFormatted = capitalizeWords(colCleaned);
      if (parts.length >= 2) {
        parts[1] = colFormatted;
      } else {
        parts.push(colFormatted);
      }
      const updatedQuery = parts.join(', ');
      const structuredQuery = parseStructuredAddress(updatedQuery);
      return {
        changedFieldDescription: `a la colonia ${colFormatted}`,
        colonia: colFormatted,
        formattedSearchQuery: updatedQuery,
        formattedUserLabel: parts.slice(0, 2).join(', '),
        structuredQuery,
      };
    }
  }

  // 3. Reemplazo general delegando a la normalización heurística
  const norm = normalizeAddressHeuristic(cleanAdj);
  return {
    changedFieldDescription: `a: ${norm.formattedUserLabel}`,
    formattedSearchQuery: norm.formattedSearchQuery,
    formattedUserLabel: norm.formattedUserLabel,
    calle: norm.calle,
    numero: norm.numero,
    colonia: norm.colonia,
    alcaldia_o_ciudad: norm.alcaldia_o_ciudad,
    cruce: norm.cruce,
    structuredQuery: norm.structuredQuery,
  };
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

  // 1. FAST-PATH HEURÍSTICO / 0ms: Si es un landmark conocido o tiene componentes claros de calle y número/colonia
  const heuristic = normalizeAddressHeuristic(trimmed);
  if (heuristic && (heuristic.landmark || (heuristic.calle && (heuristic.numero || heuristic.colonia)))) {
    return heuristic;
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
  "cruce": "calle que cruza o hace esquina si fue mencionada (ej: 'Ámsterdam', 'Monterrey'), o null",
  "formattedSearchQuery": "cadena completa y ordenada para geocodificación (ej: 'Calle Sonora 120, Roma Norte, Cuauhtémoc, Ciudad de México' o 'Palacio de Bellas Artes, Centro Histórico, Ciudad de México')",
  "formattedUserLabel": "etiqueta corta, natural y clara para confirmación al usuario (ej: 'Calle Sonora 120, Roma Norte' o 'Palacio de Bellas Artes')"
}

Reglas:
1. NUNCA trunques la dirección si contiene la preposición "en". Ejemplo: "Sonora 120 en la Condesa" tiene calle "Sonora", número "120", colonia "Condesa", y búsqueda "Calle Sonora 120, Condesa, Cuauhtémoc, Ciudad de México".
2. Si el usuario dictó la colonia primero y luego la calle y número (ej. "En la Roma, Sonora 120"), ordénalo correctamente como "Calle Sonora 120, Roma Norte".
3. Si incluye un alias (ej. "casa de mi primo en sonora 120"), extrae en 'aliasCandidate': "Casa de mi primo" y la dirección en los demás campos.
4. Si es un sitio emblemático como "Bellas Artes", "Zócalo", "Soumaya", "Hospital General", identifícalo en 'landmark' y asigna una dirección precisa.
5. Elimina muletillas como "allá por", "es en", "queda en", "por el rumbo de", "está sobre".
6. Devuelve ÚNICAMENTE el JSON.`;

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
              const structuredQuery: StructuredAddressQuery = {
                street: parsed.calle || '',
                houseNumber: parsed.numero || undefined,
                colonia: parsed.colonia || undefined,
                alcaldia: parsed.alcaldia_o_ciudad || undefined,
                crossStreet: parsed.cruce || undefined,
                city: 'Ciudad de México',
                rawQuery: trimmed,
              };

              return {
                formattedSearchQuery: parsed.formattedSearchQuery,
                formattedUserLabel: parsed.formattedUserLabel,
                aliasCandidate: parsed.aliasCandidate || undefined,
                calle: parsed.calle || undefined,
                numero: parsed.numero || undefined,
                colonia: parsed.colonia || undefined,
                alcaldia_o_ciudad: parsed.alcaldia_o_ciudad || undefined,
                landmark: parsed.landmark || undefined,
                cruce: parsed.cruce || undefined,
                structuredQuery,
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

  // 3. Extracción de patrones de calle, número, cruce y colonia desordenados
  let colonia: string | undefined;
  let calle: string | undefined;
  let numero: string | undefined;
  let cruce: string | undefined;

  const crossMatch = cleaned.match(
    /(?:casi\s+esquina\s+con|esquina\s+con|cruce\s+con|esq\.?\s+con|esq\.?)\s+([^,]+)/i
  );
  if (crossMatch) {
    cruce = capitalizeWords(crossMatch[1].trim());
    cleaned = cleaned
      .replace(/(?:casi\s+esquina\s+con|esquina\s+con|cruce\s+con|esq\.?\s+con|esq\.?)\s+[^,]+/gi, '')
      .trim();
  }

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
  const userParts = [streetPart, cruce ? `esquina con ${cruce}` : undefined, colonia].filter(Boolean);
  const formattedUserLabel = userParts.length > 0 ? userParts.join(', ') : capitalizeWords(cleaned);

  const searchParts = [streetPart, cruce, colonia, 'Ciudad de México'].filter(Boolean);
  const formattedSearchQuery = searchParts.length > 0 ? searchParts.join(', ') : `${cleaned}, Ciudad de México`;

  const structuredQuery: StructuredAddressQuery = {
    street: calle || '',
    houseNumber: numero,
    colonia,
    alcaldia: 'Ciudad de México',
    crossStreet: cruce,
    city: 'Ciudad de México',
    rawQuery: rawInput,
  };

  return {
    aliasCandidate,
    calle,
    numero,
    colonia,
    alcaldia_o_ciudad: 'Ciudad de México',
    cruce,
    structuredQuery,
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
    const isPendingAlias = Boolean(
      context.pendingConfirmation.isAlias ||
      context.pendingConfirmation.aliasKey ||
      AliasService.getAlias(context.pendingConfirmation.destination) ||
      isPersonalPlaceIntent(context.pendingConfirmation.destination) ||
      (context.pendingConfirmation.originalQuery && isPersonalPlaceIntent(context.pendingConfirmation.originalQuery))
    );
    const aliasLabel =
      context.pendingConfirmation.aliasKey ||
      AliasService.getAlias(context.pendingConfirmation.destination)?.alias ||
      context.pendingConfirmation.destination;

    dynamicContextPrompt += `\n- ESTADO: PENDIENTE DE CONFIRMAR VIAJE hacia "${context.pendingConfirmation.destination}".`;
    if (isPendingAlias) {
      dynamicContextPrompt += `\n    * IMPORTANTE: El destino es un ALIAS o lugar guardado. Si el usuario dice que la dirección es otra, que no es ahí o proporciona una nueva dirección (ej: "No es ahí, es en Sonora 120", "Está mal la dirección, es en...", "No, es en...", "Cambia la dirección a...", "La dirección es..."): DEBES invocar 'guardar_ubicacion(alias: "${aliasLabel}", direccion: "<nueva dirección>")'. NO invoques 'navegar_a' ni 'cancelar'.`;
    }
    dynamicContextPrompt += `
    * Si el usuario confirma ("Sí", "Vamos", "De acuerdo", "Iniciar", "Por favor", "Adelante"): DEBES invocar 'confirmar_viaje'.
    * Si el usuario rectifica o cambia de destino a otro lugar diferente (ej: "No, quiero ir a {lugar}", "No, mejor llévame a {lugar}", "Cámbialo a {lugar}", "No, al metro {estación}", "Mejor a {lugar}", "Prefiero {lugar}"): DEBES invocar 'navegar_a(destino: nuevo_destino)'. NUNCA invoques 'cancelar' ni preguntes "¿Desea ir a otro lugar?" si ya indicó a dónde ir.
    * Si el usuario solo dice "No", "Cancela", "Ya no quiero ir", "Detener" o rechaza sin indicar otro lugar: DEBES invocar 'cancelar'.`;
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

  // 2. Historial de mensajes recientes (sin duplicar el mensaje actual recién añadido)
  const messages: GroqMessage[] = [
    { role: 'system', content: dynamicContextPrompt },
  ];

  if (context.history && context.history.length > 1) {
    const previousHistory = context.history.slice(0, -1).slice(-3);
    for (const msg of previousHistory) {
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
        temperature: 0.1,
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

    // Función centralizada para resolver, geocodificar y confirmar navegar_a (soporta rectificaciones y cambios de opinión)
    const executeNavegarAFlow = async (
      targetDest: string,
      customSpoken?: string,
      structuredFromArgs?: Partial<StructuredAddressQuery>
    ): Promise<ConversationResponse> => {
      // Salto de contexto ubicuo: Limpiar cualquier registro pendiente o viaje anterior
      context.pendingAliasRegistration = null;
      context.pendingTripCompletion = null;

      const previousPendingDest = context.pendingConfirmation?.destination;
      const rawDest = (targetDest || userSpeechText).trim();

      // DEFENSIVE GUARD: ¿El usuario está corrigiendo la dirección de un alias que estaba en confirmación previa?
      const wasPendingAlias = Boolean(
        context.pendingConfirmation?.isAlias ||
        context.pendingConfirmation?.aliasKey ||
        (previousPendingDest && AliasService.getAlias(previousPendingDest)) ||
        (previousPendingDest && isPersonalPlaceIntent(previousPendingDest))
      );
      const correctionCheck = isAliasAddressCorrectionIntent(userSpeechText, normalizeText(userSpeechText));

      if (wasPendingAlias && correctionCheck.isCorrection) {
        const aliasToUpdate =
          context.pendingConfirmation?.aliasKey ||
          (previousPendingDest && AliasService.getAlias(previousPendingDest)?.alias) ||
          (previousPendingDest ? cleanAliasName(previousPendingDest) : 'ubicación');

        const addrToUse = correctionCheck.newAddress || targetDest || userSpeechText;

        const normalizedAddr = await normalizeAddressWithLLM(addrToUse, context);
        let targetCoords = context.currentLocation || CDMX_CENTER;
        let formattedAddress = normalizedAddr.formattedUserLabel;
        let precision: GeocodePrecision | undefined;

        try {
          const geocoded = await orsService.geocodeDestination(
            normalizedAddr.structuredQuery || normalizedAddr.formattedSearchQuery,
            context.currentLocation
          );
          if (geocoded && geocoded.length > 0) {
            targetCoords = geocoded[0].coordinates;
            formattedAddress = normalizedAddr.formattedUserLabel || geocoded[0].label || geocoded[0].name;
            precision = geocoded[0].precision;
          }
        } catch {}

        context.pendingConfirmation = null;
        context.pendingAliasRegistration = {
          aliasName: aliasToUpdate,
          step: 'confirming_address',
          addressCandidate: formattedAddress,
          coordinates: targetCoords,
          isUpdating: true,
          retryCount: 0,
          timestamp: Date.now(),
          precision,
        };

        let spokenText = `Entendido. Ubiqué: ${formattedAddress}. ¿Desea actualizar la dirección de ${aliasToUpdate} con esta ubicación?`;
        if (precision === 'street' && normalizedAddr.numero) {
          const streetName = normalizedAddr.calle || formattedAddress;
          const colName = normalizedAddr.colonia ? ` en ${normalizedAddr.colonia}` : '';
          spokenText = `Entendido. Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${normalizedAddr.numero}. ¿Desea actualizar la dirección de ${aliasToUpdate} con esta ubicación?`;
        }
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

      const aliasRes = AliasService.resolveDestinationWithAlias(rawDest);

      // VERIFICACIÓN CRÍTICA: ¿Es un lugar personal o alias no registrado?
      const isPersonal =
        isPersonalPlaceIntent(rawDest) ||
        isPersonalPlaceIntent(userSpeechText) ||
        isPersonalPlaceIntent(targetDest);

      if (!aliasRes.isAlias && isPersonal) {
        const cleanAlias = cleanAliasName(rawDest.length > 2 ? rawDest : userSpeechText);
        context.pendingConfirmation = null;
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
      let destPrecision: GeocodePrecision | undefined;
      const parsed = parseStructuredAddress(rawDest);
      const structuredDest: StructuredAddressQuery = {
        street: structuredFromArgs?.street || parsed.street,
        houseNumber: structuredFromArgs?.houseNumber || parsed.houseNumber,
        colonia: structuredFromArgs?.colonia || parsed.colonia,
        alcaldia: structuredFromArgs?.alcaldia || parsed.alcaldia,
        crossStreet: structuredFromArgs?.crossStreet || parsed.crossStreet,
        city: structuredFromArgs?.city || parsed.city || 'Ciudad de México',
        rawQuery: rawDest,
      };

      if (!destCoords) {
        try {
          const disambiguation = await orsService.getDisambiguationCandidates(
            structuredDest.street ? structuredDest : destName,
            context.currentLocation,
            3
          );
          if (disambiguation.isAmbiguous && disambiguation.candidates.length > 1) {
            context.pendingConfirmation = null;
            context.pendingDisambiguation = {
              originalQuery: rawDest,
              intent: 'navigation',
              candidates: disambiguation.candidates,
              timestamp: Date.now(),
            };

            const promptText = buildDisambiguationSpokenPrompt(disambiguation.candidates, 'navigation');
            context.history?.push({
              role: 'assistant',
              content: promptText,
              timestamp: Date.now(),
            });

            return {
              spokenText: promptText,
              functionCall: null,
              updatedContext: context,
              requiresConfirmation: true,
              shouldAutoListen: true,
            };
          } else if (disambiguation.candidates.length > 0) {
            destCoords = disambiguation.candidates[0].coordinates;
            destPrecision = disambiguation.candidates[0].precision;
          }
        } catch (err) {
          console.warn('[conversationService] Error al geocodificar destino para confirmación:', err);
        }
      }

      const isForaneo = isForaneoTrip(destName, destCoords, context.currentLocation);

      const wasChangingDestination = Boolean(
        previousPendingDest &&
        previousPendingDest.toLowerCase() !== destName.toLowerCase()
      );

      context.pendingConfirmation = {
        destination: destName,
        coordinates: destCoords,
        isForaneo,
        timestamp: Date.now(),
        originalQuery: userSpeechText,
        isAlias: aliasRes.isAlias,
        aliasKey: aliasRes.alias?.alias || rawDest,
        precision: destPrecision,
      };

      let spokenText = customSpoken;
      if (!spokenText || isForaneo || wasChangingDestination) {
        if (isForaneo) {
          spokenText = `Atención, este es un viaje foráneo en carretera a ${destName}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`;
        } else if (wasChangingDestination) {
          spokenText = `Entendido, he cambiado el destino a ${destName}. ¿Desea que iniciemos el viaje hacia allá?`;
        } else if (destPrecision === 'street' && structuredDest.houseNumber) {
          const streetName = structuredDest.street || destName;
          const colName = structuredDest.colonia ? ` en ${structuredDest.colonia}` : '';
          spokenText = `Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${structuredDest.houseNumber}. ¿Desea que iniciemos el viaje hacia allá?`;
        } else {
          spokenText = `He localizado ${destName}. ¿Desea que iniciemos el viaje hacia allá?`;
        }
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
        shouldAutoListen: true,
      };
    };

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
          const rawDest = fnArgs.destino || userSpeechText;
          const structuredFromArgs: Partial<StructuredAddressQuery> = {
            street: fnArgs.calle,
            houseNumber: fnArgs.numero,
            colonia: fnArgs.colonia,
            alcaldia: fnArgs.alcaldia,
            crossStreet: fnArgs.cruce,
          };
          return await executeNavegarAFlow(rawDest, rawContent, structuredFromArgs);
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
          // DEFENSIVE GUARD: Si el LLM devolvió 'cancelar' pero la entrada del usuario contenía una rectificación de destino
          // (ej. "no, quiero ir a Bellas Artes", "no, mejor al metro politécnico", "cámbialo a Reforma"), interceptar y redirigir a 'navegar_a'
          const rectifiedCandidate =
            extractDestinationFromRectification(userSpeechText, normalizeText(userSpeechText)) ||
            extractDestination(userSpeechText, normalizeText(userSpeechText));

          if (
            rectifiedCandidate &&
            (!context.pendingConfirmation ||
              rectifiedCandidate.toLowerCase() !== context.pendingConfirmation.destination.toLowerCase())
          ) {
            console.log(
              `[conversationService] Defensive Guard: LLM invocó 'cancelar' pero se detectó rectificación hacia "${rectifiedCandidate}". Redirigiendo a navegar_a.`
            );
            return await executeNavegarAFlow(rectifiedCandidate);
          }

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
            const isExisting = Boolean(AliasService.getAlias(cleanAlias));
            context.pendingAliasRegistration = {
              aliasName: cleanAlias,
              step: 'awaiting_address',
              isUpdating: isExisting,
              retryCount: 0,
              timestamp: Date.now(),
            };

            const spokenText = isExisting
              ? `Entendido, vamos a actualizar la dirección de "${cleanAlias}". ¿Cuál es la nueva dirección o colonia?`
              : `Entendido, vamos a registrar "${cleanAlias}". ¿Cuál es la dirección o colonia?`;
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

          // Si sí especificó dirección o se extrajeron entidades directamente en el Tool Call:
          let normalizedAddr: NormalizedAddressResult;
          if (fnArgs.calle || fnArgs.colonia || fnArgs.numero) {
            const parts: string[] = [];
            if (fnArgs.calle) {
              parts.push(`Calle ${fnArgs.calle}${fnArgs.numero ? ' ' + fnArgs.numero : ''}`);
            } else if (fnArgs.numero) {
              parts.push(`Número ${fnArgs.numero}`);
            }
            if (fnArgs.colonia) parts.push(fnArgs.colonia);
            if (fnArgs.cruce) parts.push(`esq. ${fnArgs.cruce}`);

            const userLabel = parts.join(', ') || address;
            const fullSearch = `${userLabel}, Ciudad de México`;

            normalizedAddr = {
              formattedSearchQuery: fullSearch,
              formattedUserLabel: userLabel,
              calle: fnArgs.calle,
              numero: fnArgs.numero,
              colonia: fnArgs.colonia,
              cruce: fnArgs.cruce,
              structuredQuery: {
                street: fnArgs.calle || '',
                houseNumber: fnArgs.numero,
                colonia: fnArgs.colonia,
                crossStreet: fnArgs.cruce,
                city: 'Ciudad de México',
                rawQuery: fullSearch,
              },
            };
          } else {
            normalizedAddr = await normalizeAddressWithLLM(address, context);
          }
          if (normalizedAddr.aliasCandidate && (alias === 'nueva ubicación' || alias === 'nueva ubicacion')) {
            alias = normalizedAddr.aliasCandidate;
          }

          let targetCoords = context.currentLocation || CDMX_CENTER;
          let formattedAddress = normalizedAddr.formattedUserLabel;
          let aliasPrecision: GeocodePrecision | undefined;

          try {
            const disambiguation = await orsService.getDisambiguationCandidates(
              normalizedAddr.structuredQuery || normalizedAddr.formattedSearchQuery,
              context.currentLocation,
              3
            );
            if (disambiguation.isAmbiguous && disambiguation.candidates.length > 1) {
              context.pendingConfirmation = null;
              context.pendingDisambiguation = {
                originalQuery: address,
                intent: 'alias_registration',
                aliasName: alias,
                candidates: disambiguation.candidates,
                timestamp: Date.now(),
              };

              const promptText = buildDisambiguationSpokenPrompt(
                disambiguation.candidates,
                'alias_registration',
                alias
              );
              context.history?.push({
                role: 'assistant',
                content: promptText,
                timestamp: Date.now(),
              });

              return {
                spokenText: promptText,
                functionCall: null,
                updatedContext: context,
                requiresConfirmation: true,
                shouldAutoListen: true,
              };
            } else if (disambiguation.candidates.length > 0) {
              targetCoords = disambiguation.candidates[0].coordinates;
              formattedAddress = normalizedAddr.formattedUserLabel || disambiguation.candidates[0].label || disambiguation.candidates[0].name;
              aliasPrecision = disambiguation.candidates[0].precision;
            }
          } catch (err) {
            console.warn('[conversationService] Fallback de geocodificación en guardar_ubicacion:', err);
          }

          const isExisting = Boolean(AliasService.getAlias(alias));
          context.pendingAliasRegistration = {
            aliasName: alias,
            step: 'confirming_address',
            addressCandidate: formattedAddress,
            coordinates: targetCoords,
            isUpdating: isExisting,
            retryCount: 0,
            timestamp: Date.now(),
            precision: aliasPrecision,
          };

          let spokenText = isExisting
            ? `Entendido. Ubiqué: ${formattedAddress}. ¿Desea actualizar la dirección de ${alias} con esta ubicación?`
            : `Entendí: ${formattedAddress}. ¿Es correcta esta ubicación para ${alias}?`;

          if (aliasPrecision === 'street' && normalizedAddr.numero) {
            const streetName = normalizedAddr.calle || formattedAddress;
            const colName = normalizedAddr.colonia ? ` en ${normalizedAddr.colonia}` : '';
            spokenText = isExisting
              ? `Entendido. Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${normalizedAddr.numero}. ¿Desea actualizar la dirección de ${alias} con esta ubicación?`
              : `Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${normalizedAddr.numero}. ¿Es correcta esta ubicación para ${alias}?`;
          }
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

          const intensidad: ZoomIntensity =
            fnArgs.intensidad === 'mucho' ||
            fnArgs.intensidad === 'poco' ||
            fnArgs.intensidad === 'normal'
              ? fnArgs.intensidad
              : 'normal';

          let defaultSpoken = 'Centrando el mapa en su ubicación actual.';
          if (dir === 'acercar') {
            defaultSpoken =
              intensidad === 'mucho'
                ? 'Acercando bastante el mapa para ver el máximo detalle.'
                : intensidad === 'poco'
                ? 'Acercando un poco el mapa.'
                : 'Acercando el mapa para que pueda ver con mayor detalle.';
          } else if (dir === 'alejar') {
            defaultSpoken =
              intensidad === 'mucho'
                ? 'Alejando ampliamente el mapa para mostrar el panorama general.'
                : intensidad === 'poco'
                ? 'Alejando un poco el mapa.'
                : 'Alejando el mapa para mostrar una vista más amplia.';
          }

          const spokenText = rawContent || defaultSpoken;
          const functionCall: FunctionCall = {
            name: 'ajustar_zoom',
            args: { direccion: dir, intensidad },
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
      // DEFENSIVE GUARD: Si había una confirmación pendiente y el usuario rectificó destino
      if (context.pendingConfirmation) {
        const rectifiedCandidate =
          extractDestinationFromRectification(userSpeechText, normalizeText(userSpeechText)) ||
          extractDestination(userSpeechText, normalizeText(userSpeechText));

        if (
          rectifiedCandidate &&
          rectifiedCandidate.toLowerCase() !== context.pendingConfirmation.destination.toLowerCase()
        ) {
          console.log(
            `[conversationService] Defensive Guard: Groq no llamó a tool pero se detectó rectificación hacia "${rectifiedCandidate}". Ejecutando navegar_a.`
          );
          return await executeNavegarAFlow(rectifiedCandidate);
        }
      }

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
  // CASO 0: ESTADO PRIORITARIO: RESOLUCIÓN DE DESAMBIGUACIÓN (TASK-40)
  // --------------------------------------------------------------------------
  if (currentContext.pendingDisambiguation) {
    const disambiguation = currentContext.pendingDisambiguation;

    // Caso A: Cancelación explícita
    if (isNegativeOrCancel(normalized)) {
      currentContext.pendingDisambiguation = null;
      const cancelText = disambiguation.intent === 'alias_registration'
        ? `Entendido. He cancelado el registro para ${disambiguation.aliasName || 'la ubicación'}. ¿Desea hacer algo más?`
        : 'Entendido, cancelé la búsqueda. ¿A qué otro lugar le gustaría ir?';

      currentContext.history?.push({
        role: 'assistant',
        content: cancelText,
        timestamp: Date.now(),
      });

      return {
        spokenText: cancelText,
        functionCall: null,
        updatedContext: currentContext,
        requiresConfirmation: false,
        shouldAutoListen: true,
      };
    }

    // Caso B: El usuario seleccionó una de las opciones
    const selected = resolveDisambiguationSelection(rawText, normalized, disambiguation.candidates);
    if (selected) {
      currentContext.pendingDisambiguation = null;

      if (disambiguation.intent === 'alias_registration') {
        const aliasTarget = disambiguation.aliasName || 'nueva ubicación';
        currentContext.pendingAliasRegistration = {
          aliasName: aliasTarget,
          step: 'confirming_address',
          addressCandidate: selected.label,
          coordinates: selected.coordinates,
          isUpdating: Boolean(AliasService.getAlias(aliasTarget)),
          retryCount: 0,
          timestamp: Date.now(),
        };

        const responseText = currentContext.pendingAliasRegistration.isUpdating
          ? `Entendido, seleccioné: ${selected.label}. ¿Desea actualizar la dirección de ${aliasTarget} con esta ubicación?`
          : `Entendido, seleccioné: ${selected.label}. ¿Es correcta esta ubicación para ${aliasTarget}?`;

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
      } else {
        // Viaje directo
        const isForaneo = isForaneoTrip(
          selected.name || selected.label,
          selected.coordinates,
          currentContext.currentLocation
        );

        currentContext.pendingConfirmation = {
          destination: selected.label,
          coordinates: selected.coordinates,
          isForaneo,
          timestamp: Date.now(),
          originalQuery: disambiguation.originalQuery,
        };

        const responseText = `Entendido, ${selected.label}. ¿Desea que iniciemos el viaje hacia allá ahora mismo?`;
        const functionCall: FunctionCall = {
          name: 'navegar_a',
          args: {
            destino: selected.label,
            latitud: selected.coordinates.latitude,
            longitud: selected.coordinates.longitude,
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
          shouldAutoListen: true,
        };
      }
    }

    // Caso C: El usuario dio una pista o colonia adicional
    const newCombinedQuery = `${disambiguation.originalQuery} ${rawText}`;
    const newCandidatesResult = await orsService.getDisambiguationCandidates(
      newCombinedQuery,
      currentContext.currentLocation,
      3
    );

    if (newCandidatesResult.candidates.length > 0) {
      if (newCandidatesResult.isAmbiguous && newCandidatesResult.candidates.length > 1) {
        currentContext.pendingDisambiguation.candidates = newCandidatesResult.candidates;
        const prompt = buildDisambiguationSpokenPrompt(
          newCandidatesResult.candidates,
          disambiguation.intent,
          disambiguation.aliasName
        );
        return {
          spokenText: prompt,
          functionCall: null,
          updatedContext: currentContext,
          requiresConfirmation: true,
          shouldAutoListen: true,
        };
      } else {
        const single = newCandidatesResult.candidates[0];
        currentContext.pendingDisambiguation = null;

        if (disambiguation.intent === 'alias_registration') {
          currentContext.pendingAliasRegistration = {
            aliasName: disambiguation.aliasName || 'nueva ubicación',
            step: 'confirming_address',
            addressCandidate: single.label,
            coordinates: single.coordinates,
            timestamp: Date.now(),
          };
          const responseText = `Ubiqué: ${single.label}. ¿Es correcta esta ubicación para ${disambiguation.aliasName}?`;
          return {
            spokenText: responseText,
            functionCall: null,
            updatedContext: currentContext,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        } else {
          currentContext.pendingConfirmation = {
            destination: single.label,
            coordinates: single.coordinates,
            timestamp: Date.now(),
          };
          const responseText = `Ubiqué: ${single.label}. ¿Desea iniciar el viaje hacia allá?`;
          return {
            spokenText: responseText,
            functionCall: null,
            updatedContext: currentContext,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        }
      }
    }

    // Caso D: Aclaración
    const repeatPrompt = `Por favor dígame cuál opción prefiere (por ejemplo "la primera" o "la segunda") o un lugar conocido de referencia.`;
    return {
      spokenText: repeatPrompt,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: true,
      shouldAutoListen: true,
    };
  }

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

      // Si el alias aún es genérico ("nueva ubicación"), evaluar si el usuario dictó alias y dirección en la misma frase:
      // Ej: "Es la casa de mi primo, en calle Sonora 120"
      if (aliasToUse === 'nueva ubicación' || aliasToUse === 'nueva ubicacion') {
        const splitMatch = rawText.match(
          /^(.+?)\s+(?:,\s*en\s+|,\s*sobre\s+|,\s*queda\s+en\s+|,\s*esta\s+en\s+|,\s*es\s+en\s+|,\s*ubicada?\s+en\s+|\s+en\s+|\s+sobre\s+|\s+queda\s+en\s+|\s+esta\s+en\s+|\s+es\s+en\s+|\s+ubicada?\s+en\s+)(.+)$/i
        );

        if (splitMatch && isPersonalPlaceIntent(splitMatch[1])) {
          const potentialAlias = cleanAliasName(splitMatch[1].replace(/^(?:es\s+|la\s+|el\s+)/i, ''));
          const potentialAddress = splitMatch[2].trim();
          if (potentialAlias.length > 1 && potentialAddress.length > 2) {
            aliasToUse = potentialAlias;
            addressToUse = potentialAddress;
          }
        } else if (isPersonalPlaceIntent(rawText) && !/\d+/.test(rawText)) {
          // Si no hubo conector y dijo solo un nombre personal sin dirección (ej: "la casa de mi sobrino"):
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
      let aliasPrecision: GeocodePrecision | undefined;

      try {
        const disambiguation = await orsService.getDisambiguationCandidates(
          normalizedAddr.structuredQuery || normalizedAddr.formattedSearchQuery,
          currentContext.currentLocation,
          3
        );
        if (disambiguation.isAmbiguous && disambiguation.candidates.length > 1) {
          currentContext.pendingAliasRegistration = null;
          currentContext.pendingDisambiguation = {
            originalQuery: addressToUse,
            intent: 'alias_registration',
            aliasName: aliasToUse,
            candidates: disambiguation.candidates,
            timestamp: Date.now(),
          };

          const promptText = buildDisambiguationSpokenPrompt(
            disambiguation.candidates,
            'alias_registration',
            aliasToUse
          );
          currentContext.history?.push({
            role: 'assistant',
            content: promptText,
            timestamp: Date.now(),
          });

          return {
            spokenText: promptText,
            functionCall: null,
            updatedContext: currentContext,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        } else if (disambiguation.candidates.length > 0) {
          targetCoords = disambiguation.candidates[0].coordinates;
          formattedAddress = normalizedAddr.formattedUserLabel || disambiguation.candidates[0].label || disambiguation.candidates[0].name;
          aliasPrecision = disambiguation.candidates[0].precision;
        }
      } catch (err) {
        console.log('[conversationService] Fallback de geocodificación para alias:', err);
      }

      const isExisting = Boolean(AliasService.getAlias(aliasToUse));
      currentContext.pendingAliasRegistration = {
        aliasName: aliasToUse,
        step: 'confirming_address',
        addressCandidate: formattedAddress,
        coordinates: targetCoords,
        isUpdating: isExisting || pending.isUpdating,
        retryCount: 0,
        timestamp: Date.now(),
        precision: aliasPrecision,
      };

      let responseText = (isExisting || pending.isUpdating)
        ? `Entendido. Ubiqué: ${formattedAddress}. ¿Desea actualizar la dirección de ${aliasToUse} con esta ubicación?`
        : `Entendí: ${formattedAddress}. ¿Es correcta esta ubicación para ${aliasToUse}?`;

      if (aliasPrecision === 'street' && normalizedAddr.numero) {
        const streetName = normalizedAddr.calle || formattedAddress;
        const colName = normalizedAddr.colonia ? ` en ${normalizedAddr.colonia}` : '';
        responseText = (isExisting || pending.isUpdating)
          ? `Entendido. Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${normalizedAddr.numero}. ¿Desea actualizar la dirección de ${aliasToUse} con esta ubicación?`
          : `Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${normalizedAddr.numero}. ¿Es correcta esta ubicación para ${aliasToUse}?`;
      }

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
          isAlias: true,
          aliasKey: saved.alias,
        };

        const responseText = pending.isUpdating
          ? `He actualizado la dirección de ${saved.name}. ¿Desea que iniciemos el viaje hacia allá ahora mismo?`
          : `He guardado ${saved.name}. ¿Desea que iniciemos el viaje hacia allá ahora mismo?`;
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

      // 2. Caso Corrección Directa o Ajuste Parcial con soporte LLM
      const directCorrection = extractAddressCorrection(rawText, normalized);
      const isAdjustment = isAddressAdjustmentPattern(normalized);

      if (directCorrection || isAdjustment) {
        const textToProcess = directCorrection || rawText;
        const baseAddr = pending.addressCandidate || 'Ciudad de México';

        // Usamos el LLM (o heurística de respaldo) para fusionar diferencialmente el ajuste con la dirección propuesta
        const merged = await mergeAddressAdjustmentWithLLM(baseAddr, textToProcess, currentContext);

        let newCoords = currentContext.currentLocation || CDMX_CENTER;
        let newFormatted = merged.formattedUserLabel;

        try {
          const geocoded = await orsService.geocodeDestination(
            merged.formattedSearchQuery,
            currentContext.currentLocation
          );
          if (geocoded && geocoded.length > 0) {
            newCoords = geocoded[0].coordinates;
            newFormatted = merged.formattedUserLabel || geocoded[0].label || geocoded[0].name;
          }
        } catch (err) {
          console.log('[conversationService] Fallback de geocodificación en corrección/ajuste de dirección:', err);
        }

        currentContext.pendingAliasRegistration = {
          aliasName,
          step: 'confirming_address',
          addressCandidate: newFormatted,
          coordinates: newCoords,
          isUpdating: pending.isUpdating,
          retryCount: 0,
          timestamp: Date.now(),
        };

        const changeDesc = merged.changedFieldDescription ? `cambié ${merged.changedFieldDescription}` : 'corregí';
        const responseText = pending.isUpdating
          ? `Entendido, ${changeDesc}: ${newFormatted}. ¿Desea actualizar la dirección de ${aliasName} con esta ubicación?`
          : `Entendido, ${changeDesc}: ${newFormatted}. ¿Es correcta esta ubicación para ${aliasName}?`;

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
          isUpdating: pending.isUpdating,
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

    // Salto de contexto / Ajuste de mapa durante confirmación:
    const zoomDir = detectZoomDirection(normalized);
    if (zoomDir) {
      const zoomInt = detectZoomIntensity(normalized);
      let spokenText = 'Ajustando vista del mapa.';
      if (zoomDir === 'acercar') spokenText = 'Acercando el mapa.';
      if (zoomDir === 'alejar') spokenText = 'Alejando el mapa.';
      if (zoomDir === 'centrar') spokenText = 'Centrando el mapa.';
      return {
        spokenText,
        functionCall: { name: 'ajustar_zoom', args: { direccion: zoomDir, intensidad: zoomInt } },
        updatedContext: currentContext,
        requiresConfirmation: true,
        shouldAutoListen: true,
      };
    }

    // 0c. DETECCIÓN PRIORITARIA: Corrección o actualización de dirección de un ALIAS guardado
    // Si el destino pendiente es un alias o lugar personal y el usuario indica que la dirección es errónea o proporciona la correcta:
    const isPendingAlias = Boolean(
      currentContext.pendingConfirmation.isAlias ||
      currentContext.pendingConfirmation.aliasKey ||
      AliasService.getAlias(destination) ||
      isPersonalPlaceIntent(destination) ||
      (currentContext.pendingConfirmation.originalQuery && isPersonalPlaceIntent(currentContext.pendingConfirmation.originalQuery))
    );

    const aliasCorrection = isAliasAddressCorrectionIntent(rawText, normalized);

    if ((isPendingAlias || /direccion|ubicacion/i.test(normalized)) && aliasCorrection.isCorrection) {
      const existingAlias =
        (currentContext.pendingConfirmation.aliasKey ? AliasService.getAlias(currentContext.pendingConfirmation.aliasKey) : undefined) ||
        AliasService.getAlias(destination) ||
        (currentContext.pendingConfirmation.originalQuery ? AliasService.getAlias(currentContext.pendingConfirmation.originalQuery) : undefined);

      const targetAliasName = existingAlias ? existingAlias.alias : cleanAliasName(destination);

      if (aliasCorrection.newAddress) {
        let formattedSearchQuery: string;
        let formattedAddress: string;
        let changeDesc = '';

        const baseAddr = existingAlias?.address;
        if (baseAddr && (isAddressAdjustmentPattern(normalized) || aliasCorrection.newAddress.length < 35)) {
          const merged = await mergeAddressAdjustmentWithLLM(baseAddr, aliasCorrection.newAddress, currentContext);
          formattedSearchQuery = merged.formattedSearchQuery;
          formattedAddress = merged.formattedUserLabel;
          changeDesc = merged.changedFieldDescription;
        } else {
          const normalizedAddr = await normalizeAddressWithLLM(aliasCorrection.newAddress, currentContext);
          formattedSearchQuery = normalizedAddr.formattedSearchQuery;
          formattedAddress = normalizedAddr.formattedUserLabel;
        }

        let targetCoords = currentContext.currentLocation || CDMX_CENTER;
        let correctionPrecision: GeocodePrecision | undefined;

        try {
          const geocoded = await orsService.geocodeDestination(
            formattedSearchQuery,
            currentContext.currentLocation
          );
          if (geocoded && geocoded.length > 0) {
            targetCoords = geocoded[0].coordinates;
            formattedAddress = formattedAddress || geocoded[0].label || geocoded[0].name;
            correctionPrecision = geocoded[0].precision;
          }
        } catch (err) {
          console.warn('[conversationService] Fallback de geocodificación en corrección de alias:', err);
        }

        currentContext.pendingConfirmation = null;
        currentContext.pendingAliasRegistration = {
          aliasName: targetAliasName,
          step: 'confirming_address',
          addressCandidate: formattedAddress,
          coordinates: targetCoords,
          isUpdating: true,
          retryCount: 0,
          timestamp: Date.now(),
          precision: correctionPrecision,
        };

        const prefix = changeDesc ? `Entendido, cambié ${changeDesc}:` : 'Entendido. Ubiqué:';
        let responseText = `${prefix} ${formattedAddress}. ¿Desea actualizar la dirección de ${targetAliasName} con esta ubicación?`;
        if (correctionPrecision === 'street') {
          const parsedCorr = parseStructuredAddress(formattedSearchQuery);
          if (parsedCorr.houseNumber) {
            const streetName = parsedCorr.street || formattedAddress;
            const colName = parsedCorr.colonia ? ` en ${parsedCorr.colonia}` : '';
            responseText = `${prefix} la Calle ${streetName}${colName} a la altura aproximada del número ${parsedCorr.houseNumber}. ¿Desea actualizar la dirección de ${targetAliasName} con esta ubicación?`;
          }
        }
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
      } else {
        currentContext.pendingConfirmation = null;
        currentContext.pendingAliasRegistration = {
          aliasName: targetAliasName,
          step: 'awaiting_address',
          isUpdating: true,
          retryCount: 0,
          timestamp: Date.now(),
        };

        const responseText = `Entendido. Por favor dígame la dirección o colonia correcta para ${targetAliasName}.`;
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

    // 1. RECTIFICACIÓN PRIORITARIA: El usuario corrige o cambia de opinión
    // Ej: "No, quiero ir a Bellas Artes", "No, mejor al metro politécnico", "Cámbialo a Reforma", "No, con mi hijo", "Mejor a Coyoacán"
    const rectifiedDestination =
      extractDestinationFromRectification(rawText, normalized) ||
      extractDestination(rawText, normalized);

    if (rectifiedDestination && rectifiedDestination.toLowerCase() !== destination.toLowerCase()) {
      const aliasResult = AliasService.resolveDestinationWithAlias(rectifiedDestination);
      const isPersonal =
        isPersonalPlaceIntent(rectifiedDestination) ||
        isPersonalPlaceIntent(rawText);

      // Si es un lugar personal y no tiene alias guardado, iniciar registro asistido
      if (!aliasResult.isAlias && isPersonal) {
        const cleanAlias = cleanAliasName(rectifiedDestination);
        currentContext.pendingConfirmation = null;
        currentContext.pendingAliasRegistration = {
          aliasName: cleanAlias,
          step: 'awaiting_address',
          retryCount: 0,
          timestamp: Date.now(),
        };

        const responseText = `No tengo guardada la ubicación de "${cleanAlias}". ¿Cuál es la dirección o colonia para registrarla?`;
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

      const resolvedTarget = aliasResult.resolvedName;
      let newCoords = aliasResult.coordinates;
      if (!newCoords) {
        try {
          const disambiguation = await orsService.getDisambiguationCandidates(
            resolvedTarget,
            currentContext.currentLocation,
            3
          );
          if (disambiguation.isAmbiguous && disambiguation.candidates.length > 1) {
            currentContext.pendingConfirmation = null;
            currentContext.pendingDisambiguation = {
              originalQuery: rectifiedDestination,
              intent: 'navigation',
              candidates: disambiguation.candidates,
              timestamp: Date.now(),
            };

            const promptText = buildDisambiguationSpokenPrompt(disambiguation.candidates, 'navigation');
            currentContext.history?.push({
              role: 'assistant',
              content: promptText,
              timestamp: Date.now(),
            });

            return {
              spokenText: promptText,
              functionCall: null,
              updatedContext: currentContext,
              requiresConfirmation: true,
              shouldAutoListen: true,
            };
          } else if (disambiguation.candidates.length > 0) {
            newCoords = disambiguation.candidates[0].coordinates;
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
        isAlias: aliasResult.isAlias,
        aliasKey: aliasResult.alias?.alias || rectifiedDestination,
      };

      let responseText = `Entendido, he cambiado el destino a ${resolvedTarget}. ¿Desea que iniciemos el viaje hacia allá?`;
      if (foraneoNew) {
        responseText = `Atención, este es un viaje foráneo en carretera a ${resolvedTarget}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`;
      }

      const functionCall: FunctionCall = {
        name: 'navegar_a',
        args: {
          destino: resolvedTarget,
          latitud: newCoords?.latitude,
          longitud: newCoords?.longitude,
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
        shouldAutoListen: true,
      };
    }

    // 2. CONFIRMACIÓN AFIRMATIVA
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

    // 3. CANCELACIÓN PURA (sin destino alternativo)
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

    // Salto a navegación limpia: asegurar que no persistan registros de dirección pendientes
    currentContext.pendingAliasRegistration = null;
    currentContext.pendingTripCompletion = null;

    const destinationName = aliasResolution.resolvedName;
    let destinationCoords = aliasResolution.coordinates;
    let destinationPrecision: GeocodePrecision | undefined;
    const structuredDest = parseStructuredAddress(rawDestination);

    if (!destinationCoords) {
      try {
        const disambiguation = await orsService.getDisambiguationCandidates(
          structuredDest.street ? structuredDest : destinationName,
          currentContext.currentLocation,
          3
        );
        if (disambiguation.isAmbiguous && disambiguation.candidates.length > 1) {
          currentContext.pendingConfirmation = null;
          currentContext.pendingDisambiguation = {
            originalQuery: rawDestination,
            intent: 'navigation',
            candidates: disambiguation.candidates,
            timestamp: Date.now(),
          };

          const promptText = buildDisambiguationSpokenPrompt(disambiguation.candidates, 'navigation');
          currentContext.history?.push({
            role: 'assistant',
            content: promptText,
            timestamp: Date.now(),
          });

          return {
            spokenText: promptText,
            functionCall: null,
            updatedContext: currentContext,
            requiresConfirmation: true,
            shouldAutoListen: true,
          };
        } else if (disambiguation.candidates.length > 0) {
          destinationCoords = disambiguation.candidates[0].coordinates;
          destinationPrecision = disambiguation.candidates[0].precision;
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
      isAlias: aliasResolution.isAlias,
      aliasKey: aliasResolution.alias?.alias || rawDestination,
      precision: destinationPrecision,
    };

    let responseText = `He localizado ${destinationName}. ¿Desea que iniciemos el viaje hacia allá?`;
    if (isForaneo) {
      responseText = `Atención, este es un viaje foráneo en carretera a ${destinationName}, a más de 50 kilómetros de distancia. ¿Está seguro de que desea iniciar este viaje en carretera ahora?`;
    } else if (destinationPrecision === 'street' && structuredDest.houseNumber) {
      const streetName = structuredDest.street || destinationName;
      const colName = structuredDest.colonia ? ` en ${structuredDest.colonia}` : '';
      responseText = `Ubiqué la Calle ${streetName}${colName} a la altura aproximada del número ${structuredDest.houseNumber}. ¿Desea que iniciemos el viaje hacia allá?`;
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
    const zoomIntensity = detectZoomIntensity(normalized);
    let spokenText = '';
    switch (zoomDirection) {
      case 'acercar':
        spokenText =
          zoomIntensity === 'mucho'
            ? 'Acercando bastante el mapa para ver el máximo detalle.'
            : zoomIntensity === 'poco'
            ? 'Acercando un poco el mapa.'
            : 'Acercando el mapa para que pueda ver con mayor detalle.';
        break;
      case 'alejar':
        spokenText =
          zoomIntensity === 'mucho'
            ? 'Alejando ampliamente el mapa para mostrar el panorama general.'
            : zoomIntensity === 'poco'
            ? 'Alejando un poco el mapa.'
            : 'Alejando el mapa para mostrar una vista más amplia.';
        break;
      case 'centrar':
        spokenText = 'Centrando el mapa en su ubicación actual.';
        break;
    }

    const functionCall: FunctionCall = {
      name: 'ajustar_zoom',
      args: { direccion: zoomDirection, intensidad: zoomIntensity },
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
    pendingDisambiguation: context?.pendingDisambiguation || null,
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

  // 0. Si hay desambiguación activa (TASK-40), procesar de inmediato en local:
  if (currentContext.pendingDisambiguation) {
    return await processUserMessageLocal(rawText, currentContext);
  }

  // 0a. Si estamos en confirmación de dirección (confirming_address) o esperando dirección (awaiting_address):
  // Procesar de forma inmediata manteniendo el contexto del alias
  if (currentContext.pendingAliasRegistration?.step === 'confirming_address') {
    if (
      isAffirmative(normalized) ||
      isNegativeOrCancel(normalized) ||
      extractAddressCorrection(rawText, normalized) ||
      isAddressAdjustmentPattern(normalized)
    ) {
      return await processUserMessageLocal(rawText, currentContext);
    }
  }

  if (currentContext.pendingAliasRegistration?.step === 'awaiting_address') {
    return await processUserMessageLocal(rawText, currentContext);
  }

  // 0b. Si hay confirmación de viaje pendiente y el usuario afirma/niega o corrige la dirección:
  // Procesar de forma inmediata y determinista sin latencia ni riesgo de desvío por LLM
  if (currentContext.pendingConfirmation) {
    const isPendingAlias = Boolean(
      currentContext.pendingConfirmation.isAlias ||
      currentContext.pendingConfirmation.aliasKey ||
      AliasService.getAlias(currentContext.pendingConfirmation.destination) ||
      isPersonalPlaceIntent(currentContext.pendingConfirmation.destination) ||
      (currentContext.pendingConfirmation.originalQuery && isPersonalPlaceIntent(currentContext.pendingConfirmation.originalQuery))
    );

    if (
      (isPendingAlias || /direccion|ubicacion/i.test(normalized)) &&
      isAliasAddressCorrectionIntent(rawText, normalized).isCorrection
    ) {
      return await processUserMessageLocal(rawText, currentContext);
    }

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
      pendingDisambiguation: null,
      pendingTripCompletion: null,
      activeRoute: null,
      savedLocations: {},
      history: [],
    };
  }
}
