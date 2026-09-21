/**
 * Servicio Conversacional y NLU con Function Calling para AVAN.
 *
 * Diseñado bajo principios de diseño gerontológico:
 * - Tono cálido, paciente, empático y respetuoso (sin infantilizar).
 * - Respuestas directas, concisas y fáciles de comprender (máximo 1-2 oraciones).
 * - Confirmación explícita en 2 pasos para iniciar viajes.
 * - Soporte de Function Calling tipado estrictamente.
 */

// ============================================================================
// TIPOS Y DEFINICIONES DE HERRAMIENTAS (TOOLS)
// ============================================================================

export type ToolName =
  | 'navegar_a'
  | 'guardar_ubicacion'
  | 'ajustar_zoom'
  | 'confirmar_viaje'
  | 'cancelar';

export type ZoomDirection = 'acercar' | 'alejar' | 'centrar';

export interface NavegarAArgs {
  destino: string;
}

export interface GuardarUbicacionArgs {
  alias: string;
  latitud?: number;
  longitud?: number;
}

export interface AjustarZoomArgs {
  direccion: ZoomDirection;
}

export interface ConfirmarViajeArgs {
  destino?: string;
}

export interface CancelarArgs {
  motivo?: string;
}

export type FunctionCall =
  | { name: 'navegar_a'; args: NavegarAArgs }
  | { name: 'guardar_ubicacion'; args: GuardarUbicacionArgs }
  | { name: 'ajustar_zoom'; args: AjustarZoomArgs }
  | { name: 'confirmar_viaje'; args: ConfirmarViajeArgs }
  | { name: 'cancelar'; args: CancelarArgs };

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

export const AVAN_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'navegar_a',
      description:
        'Calcula la ruta y solicita confirmación del usuario para iniciar el viaje hacia un destino específico.',
      parameters: {
        type: 'object',
        properties: {
          destino: {
            type: 'string',
            description:
              'Nombre del lugar, dirección o punto de interés al que desea desplazarse el usuario (ej. "Hospital General", "Casa de María", "Farmacia Guadalajara").',
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
        'Guarda la ubicación actual o una ubicación de referencia con un nombre o alias personalizado para recordarla fácilmente.',
      parameters: {
        type: 'object',
        properties: {
          alias: {
            type: 'string',
            description:
              'Nombre, etiqueta o apodo para identificar la ubicación guardada (ej. "casa", "doctor", "hijo").',
          },
          latitud: {
            type: 'number',
            description: 'Latitud geográfica decimal de la ubicación.',
          },
          longitud: {
            type: 'number',
            description: 'Longitud geográfica decimal de la ubicación.',
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
        'Confirma formalmente el inicio de la navegación hacia el destino que estaba pendiente de validación.',
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
        properties: {
          motivo: {
            type: 'string',
            description: 'Motivo o detalle de la cancelación comunicada por el usuario.',
          },
        },
        required: [],
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
}

export interface ActiveRoute {
  destination: string;
  inProgress: boolean;
  startTime?: number;
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
  activeRoute?: ActiveRoute | null;
  savedLocations?: Record<string, SavedLocation>;
  history?: MessageHistoryItem[];
}

export interface ConversationResponse {
  spokenText: string;
  functionCall?: FunctionCall | null;
  updatedContext: ConversationContext;
  requiresConfirmation?: boolean;
}

// ============================================================================
// SYSTEM PROMPT GERONTOLÓGICO
// ============================================================================

export const GERONTOLOGICAL_SYSTEM_PROMPT = `
Eres AVAN, un asistente de voz y navegación vehicular y peatonal diseñado con enfoque gerontológico para adultos mayores.

TUS DIRECTIVAS ESENCIALES:
1. Tono y trato:
   - Sé siempre cálido, empático, paciente y profundamente respetuoso.
   - Habla con amabilidad y dignidad. Trata al usuario con respeto.
   - NUNCA infantilices al usuario: queda estrictamente prohibido usar diminutivos condescendientes (ej. "abuelito", "viejito", "caminito", "carrerita").

2. Concisión y claridad cognitiva:
   - Tus respuestas deben ser DIRECTAS y de MÁXIMO 1 O 2 ORACIONES breves.
   - Evita la sobrecarga cognitiva, no uses tecnicismos ni des instrucciones complejas de golpe.

3. Protocolo de confirmación en 2 pasos:
   - Cuando el usuario solicite ir a un destino nuevo, NUNCA arranques la navegación de inmediato.
   - Primero identifica el destino y solicita confirmación con calma y claridad (ejemplo: "He localizado Bellas Artes. ¿Desea que iniciemos el viaje hacia allá?").
   - Solo cuando el usuario confirme afirmativamente (ej. "Sí", "Vamos", "Iniciar", "Por favor"), invoca 'confirmar_viaje'.
   - Si el usuario rechaza o cancela (ej. "No", "Espera", "Cancelar"), invoca 'cancelar'.

4. Herramientas del sistema:
   - navegar_a(destino: string): Para planear y validar la ruta a un destino.
   - guardar_ubicacion(alias: string, latitud?: number, longitud?: number): Para guardar un sitio frecuente.
   - ajustar_zoom(direccion: 'acercar' | 'alejar' | 'centrar'): Para adaptar la vista del mapa.
   - confirmar_viaje(destino?: string): Para iniciar la marcha tras confirmar.
   - cancelar(motivo?: string): Para abortar una confirmación o detener la navegación.
`.trim();

// ============================================================================
// NLU & ROUTER DE INTENTS LOCAL
// ============================================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()]/g, ' ')
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
  ];

  return affirmativePatterns.some((pattern) => pattern.test(normalized));
}

function isNegativeOrCancel(normalized: string): boolean {
  const negativePatterns = [
    /^no\b/,
    /^no gracias\b/,
    /^no por favor\b/,
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

function extractDestination(rawText: string, normalized: string): string | null {
  const patterns = [
    /(?:por favor\s+)?(?:me puedes llevar|llevame|llevarme|llevanos|vamos|ir|quiero ir|quisiera ir|navegar|navega|dirigeme|dirigirme|como llego|como puedo llegar|rumbo|camino|llevame)\s+(?:a|al|hacia|para|con|en)\s+(.+)/i,
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
// FUNCIÓN PRINCIPAL: processUserMessage
// ============================================================================

export async function processUserMessage(
  userSpeechText: string,
  context?: ConversationContext
): Promise<ConversationResponse> {
  const currentContext: ConversationContext = {
    userName: context?.userName || 'Gustavo',
    currentLocation: context?.currentLocation,
    pendingConfirmation: context?.pendingConfirmation || null,
    activeRoute: context?.activeRoute || null,
    savedLocations: context?.savedLocations || {},
    history: context?.history ? [...context.history] : [],
  };

  const rawText = (userSpeechText || '').trim();
  const normalized = normalizeText(rawText);

  currentContext.history?.push({
    role: 'user',
    content: rawText,
    timestamp: Date.now(),
  });

  // CASO 1: CONFIRMACIÓN PENDIENTE (PASO 2)
  if (currentContext.pendingConfirmation) {
    const destination = currentContext.pendingConfirmation.destination;

    if (isAffirmative(normalized)) {
      const responseText = `Excelente. Iniciando la ruta hacia ${destination}. Conduzca con precaución.`;
      const functionCall: FunctionCall = {
        name: 'confirmar_viaje',
        args: { destino: destination },
      };

      currentContext.pendingConfirmation = null;
      currentContext.activeRoute = {
        destination,
        inProgress: true,
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

    const newDestination = extractDestination(rawText, normalized);
    if (newDestination && newDestination.toLowerCase() !== destination.toLowerCase()) {
      currentContext.pendingConfirmation = {
        destination: newDestination,
        timestamp: Date.now(),
        originalQuery: rawText,
      };

      const responseText = `De acuerdo. He localizado ${newDestination}. ¿Desea que iniciemos el viaje hacia allá?`;
      const functionCall: FunctionCall = {
        name: 'navegar_a',
        args: { destino: newDestination },
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

    const clarifyText = `Para su seguridad, por favor dígame: ¿Desea iniciar el viaje a ${destination}? Puede decir "Sí" o "Cancelar".`;
    return {
      spokenText: clarifyText,
      functionCall: null,
      updatedContext: currentContext,
      requiresConfirmation: true,
    };
  }

  // CASO 2: SOLICITUD DE NAVEGACIÓN (PASO 1)
  const destination = extractDestination(rawText, normalized);
  if (destination) {
    const savedAliasKey = Object.keys(currentContext.savedLocations || {}).find(
      (key) => key.toLowerCase() === destination.toLowerCase()
    );

    const resolvedDestination = savedAliasKey || destination;

    currentContext.pendingConfirmation = {
      destination: resolvedDestination,
      timestamp: Date.now(),
      originalQuery: rawText,
    };

    const responseText = `He localizado ${resolvedDestination}. ¿Desea que iniciemos el viaje hacia allá?`;
    const functionCall: FunctionCall = {
      name: 'navegar_a',
      args: { destino: resolvedDestination },
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

  // CASO 3: AJUSTAR ZOOM
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

  // CASO 4: GUARDAR UBICACIÓN
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

  // CASO 5: CANCELAR
  if (isNegativeOrCancel(normalized)) {
    let spokenText = 'Acción cancelada. ¿En qué más puedo servirle?';
    if (currentContext.activeRoute?.inProgress) {
      spokenText = `He detenido la navegación hacia ${currentContext.activeRoute.destination}. Me mantengo a su disposición.`;
      currentContext.activeRoute = null;
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
    };
  }

  // CASO 6: SALUDOS Y CORTESÍA
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
    };
  }

  if (/^(?:gracias|muchas gracias|te lo agradezco|muy amable)/i.test(normalized)) {
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
    };
  }

  if (/(?:ayuda|que puedes hacer|como funciona|instrucciones|que haces)/i.test(normalized)) {
    const spokenText =
      'Puedo guiarle a un destino, guardar sitios frecuentes o ajustar la vista del mapa. Solo dígame a dónde desea ir.';

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
    };
  }

  // CASO 7: FALLBACK AMIGABLE
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
  };
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
      activeRoute: null,
      savedLocations: {},
      history: [],
    };
  }
}
