/**
 * Servicio de Caché en Memoria para Síntesis de Voz (TTS) en AVAN.
 *
 * Propósito:
 * - Reducir a cero (0) el consumo de tokens y créditos en ElevenLabs/OpenAI
 *   para frases repetitivas del sistema (confirmaciones, cancelaciones, saludos, comandos de zoom).
 * - Proporcionar respuesta de reproducción inmediata (<15 ms) al reutilizar los buffers de audio en RAM.
 * - Cumplir con la política de Zero-Persistence: la caché reside exclusivamente en memoria volátil
 *   durante la sesión activa de la app y se purga automáticamente al cerrar la aplicación.
 */

export class TTSAudioCache {
  private static cache = new Map<string, Uint8Array | Blob>();
  private static readonly MAX_ENTRIES = 80;

  /**
   * Genera una clave normalizada e insensible a puntuación, mayúsculas y espacios redundantes.
   * Ej: "¿Desea que iniciemos el viaje hacia allá?" -> "desea que iniciemos el viaje hacia alla"
   */
  static getCacheKey(text: string): string {
    return (text || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Elimina acentos para normalización uniforme
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()¿?¡!"']/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Almacena un buffer binario de audio en la caché LRU en memoria.
   */
  static store(text: string, data: Uint8Array | Blob): void {
    const key = this.getCacheKey(text);
    if (!key) return;

    if (this.cache.size >= this.MAX_ENTRIES) {
      // Política LRU: eliminar la entrada más antigua
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, data);
  }

  /**
   * Obtiene el buffer binario en caché si existe.
   */
  static get(text: string): Uint8Array | Blob | undefined {
    const key = this.getCacheKey(text);
    return this.cache.get(key);
  }

  /**
   * Indica si una frase se encuentra actualmente en caché.
   */
  static has(text: string): boolean {
    const key = this.getCacheKey(text);
    return this.cache.has(key);
  }

  /**
   * Retorna el número de frases cacheadas en memoria.
   */
  static count(): number {
    return this.cache.size;
  }

  /**
   * Vacía completamente la memoria de la caché.
   */
  static clear(): void {
    this.cache.clear();
  }
}
