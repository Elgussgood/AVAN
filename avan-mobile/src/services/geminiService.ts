/**
 * Servicio de NLU con Google Gemini (Fase 5 / TASK-48).
 *
 * Usa la API REST oficial de Gemini (generateContent) vía fetch, igual que el
 * resto de servicios de AVAN: cero dependencias nativas, compatible con Expo.
 * Convierte las herramientas AVAN_TOOLS (formato OpenAI/Groq) al formato
 * `functionDeclarations` de Google y normaliza la respuesta al mismo formato
 * `{ content, tool_calls[] }` que ya consume conversationService, de modo que
 * el resto de la máquina de estados no cambia.
 *
 * Incluye un "circuit breaker": si Gemini falla por cuota (429) o error de
 * servidor repetido, se omite temporalmente para no agregar latencia al
 * conductor y se cae directo al siguiente nivel (Groq -> motor local).
 */

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const GEMINI_TIMEOUT_MS = 3500;

export interface GeminiToolInput {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: readonly string[] | string[] }>;
      required: readonly string[] | string[];
    };
  };
}

export interface GeminiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NormalizedToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface NormalizedLLMMessage {
  content: string;
  tool_calls?: NormalizedToolCall[];
}

// ----------------------------------------------------------------------------
// Circuit breaker
// ----------------------------------------------------------------------------
let breakerOpenUntil = 0;
let consecutiveFailures = 0;

export function isGeminiCircuitOpen(now: number = Date.now()): boolean {
  return now < breakerOpenUntil;
}

export function resetGeminiCircuit(): void {
  breakerOpenUntil = 0;
  consecutiveFailures = 0;
}

function tripBreaker(cooldownMs: number): void {
  breakerOpenUntil = Date.now() + cooldownMs;
}

function registerFailure(status?: number): void {
  consecutiveFailures += 1;
  if (status === 429) {
    tripBreaker(60_000); // cuota: esperar 1 min
  } else if (status === 400 || status === 401 || status === 403 || status === 404) {
    tripBreaker(10 * 60_000); // clave/modelo/solicitud inválida: no insistir
  } else if (consecutiveFailures >= 3) {
    tripBreaker(30_000); // red/servidor inestable
  }
}

// ----------------------------------------------------------------------------
// Conversión de herramientas y mensajes
// ----------------------------------------------------------------------------

export function getGeminiApiKey(): string | null {
  const key = (process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim();
  return key.length > 0 ? key : null;
}

export function getGeminiModel(): string {
  return (process.env.EXPO_PUBLIC_GEMINI_MODEL || '').trim() || GEMINI_DEFAULT_MODEL;
}

/** Convierte AVAN_TOOLS al formato `tools[].functionDeclarations` de Gemini. */
export function convertToolsToGemini(tools: readonly GeminiToolInput[]): Array<{ functionDeclarations: any[] }> {
  const declarations = tools.map((tool) => {
    const fn = tool.function;
    const properties: Record<string, any> = {};
    for (const [key, schema] of Object.entries(fn.parameters.properties || {})) {
      const prop: any = {
        type: String(schema.type || 'string').toUpperCase(),
        description: schema.description,
      };
      if (schema.enum && schema.enum.length > 0) prop.enum = [...schema.enum];
      properties[key] = prop;
    }

    const decl: any = { name: fn.name, description: fn.description };
    // Gemini rechaza OBJECT sin propiedades: se omite `parameters` en tools sin argumentos.
    if (Object.keys(properties).length > 0) {
      decl.parameters = { type: 'OBJECT', properties };
      const required = [...(fn.parameters.required || [])].filter((r) => r in properties);
      if (required.length > 0) decl.parameters.required = required;
    }
    return decl;
  });
  return [{ functionDeclarations: declarations }];
}

/**
 * Convierte el historial al formato `contents` de Gemini:
 * roles user/model, alternando, empezando siempre por un turno de usuario.
 */
export function convertMessagesToGeminiContents(
  messages: readonly GeminiChatMessage[]
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const msg of messages) {
    const text = (msg.content || '').trim();
    if (!text) continue;
    const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
    if (contents.length === 0 && role === 'model') continue; // debe iniciar con user
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text }); // fusionar turnos consecutivos del mismo rol
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  return contents;
}

/** Normaliza la respuesta de Gemini al formato { content, tool_calls } de AVAN. */
export function parseGeminiResponse(data: any): NormalizedLLMMessage | null {
  const candidate = data?.candidates?.[0];
  const parts: any[] = candidate?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  let content = '';
  const toolCalls: NormalizedToolCall[] = [];

  parts.forEach((part, i) => {
    if (part?.thought) return; // ignorar pensamientos internos
    if (typeof part?.text === 'string') content += part.text;
    if (part?.functionCall?.name) {
      toolCalls.push({
        id: `gemini_call_${Date.now()}_${i}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  });

  content = content.trim();
  if (!content && toolCalls.length === 0) return null;
  return { content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
}

// ----------------------------------------------------------------------------
// Llamada principal
// ----------------------------------------------------------------------------

export interface GeminiChatParams {
  systemPrompt: string;
  messages: readonly GeminiChatMessage[];
  tools: readonly GeminiToolInput[];
  timeoutMs?: number;
}

/**
 * Llama a Gemini con Function Calling. Devuelve `null` ante cualquier fallo
 * (sin clave, circuito abierto, timeout, cuota, respuesta vacía) para que el
 * llamador conmute al siguiente nivel de la cascada.
 */
export async function callGeminiChat(params: GeminiChatParams): Promise<NormalizedLLMMessage | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  if (isGeminiCircuitOpen()) return null;

  const contents = convertMessagesToGeminiContents(params.messages);
  if (contents.length === 0) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEMINI_API_BASE}/${getGeminiModel()}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey, // cabecera: la clave no queda en URLs/logs
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemPrompt }] },
        contents,
        tools: convertToolsToGemini(params.tools),
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 }, // sin "pensar": latencia mínima para voz
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[geminiService] Gemini respondió con estatus ${response.status}`);
      registerFailure(response.status);
      return null;
    }

    const data = await response.json();
    const parsed = parseGeminiResponse(data);
    if (!parsed) {
      console.warn('[geminiService] Respuesta de Gemini vacía o bloqueada:', data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason);
      registerFailure();
      return null;
    }

    consecutiveFailures = 0;
    return parsed;
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.warn('[geminiService] Fallo o timeout en Gemini:', error?.name === 'AbortError' ? 'timeout' : error?.message || error);
    registerFailure();
    return null;
  }
}
