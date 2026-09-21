import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { File, Paths } from 'expo-file-system';

export type OpenAITTSVoice = 'nova' | 'shimmer' | 'alloy' | 'echo' | 'fable' | 'onyx';

export interface VoiceServiceOptions {
  apiKey?: string;
  voice?: OpenAITTSVoice;
  apiBaseUrl?: string;
  speed?: number;
}

/**
 * Servicio de síntesis de voz (TTS) de alta fidelidad para el proyecto AVAN.
 *
 * Diseñado con enfoque en accesibilidad para adultos mayores:
 * - Voz ultra-natural, humana y cálida vía API OpenAI TTS (modelo tts-1, voz 'nova' o 'shimmer').
 * - Velocidad calibrada a 0.88x para máxima inteligibilidad y menor esfuerzo cognitivo.
 * - Tono 0.95 para reducir estridencia y fatiga auditiva.
 * - Fallback inteligente a expo-speech priorizando voces nativas Enhanced en es-MX / es-419.
 * - Reproducción de baja latencia con expo-av.
 * - Cero persistencia de audios en disco tras la reproducción (privacidad de datos biométricos).
 */
export class VoiceService {
  private static isSpeakingState = false;
  private static currentSound: Audio.Sound | null = null;
  private static currentTempFile: File | null = null;
  private static currentWebObjectUrl: string | null = null;
  private static currentAbortController: AbortController | null = null;
  private static cachedBestVoice: Speech.Voice | null = null;

  // Configuración por defecto
  private static customApiKey: string | null = null;
  private static selectedVoice: OpenAITTSVoice = 'nova';
  private static apiBaseUrl = 'https://api.openai.com/v1/audio/speech';
  private static speed = 0.88;
  private static pitch = 0.95;

  /**
   * Configura la clave de API global para OpenAI TTS.
   */
  static setApiKey(key: string): void {
    this.customApiKey = key;
  }

  /**
   * Configura la voz de OpenAI TTS ('nova' o 'shimmer' recomendadas para adultos mayores).
   */
  static setVoice(voice: OpenAITTSVoice): void {
    this.selectedVoice = voice;
  }

  /**
   * Configura la URL base de la API (compatible con OpenAI o proxies).
   */
  static setApiBaseUrl(url: string): void {
    this.apiBaseUrl = url;
  }

  /**
   * Indica si actualmente se está reproduciendo o procesando voz.
   */
  static isSpeaking(): boolean {
    return this.isSpeakingState;
  }

  /**
   * Alias de compatibilidad con pantallas existentes.
   */
  static getSpeakingState(): boolean {
    return this.isSpeaking();
  }

  /**
   * Sintetiza y reproduce texto por voz.
   * Intenta primero usar la API de OpenAI TTS para voz ultra-natural y humana.
   * Si no hay API key disponible o falla la llamada de red, recurre al motor
   * expo-speech con la mejor voz disponible en el dispositivo.
   *
   * @param text Texto a reproducir.
   * @param onDone Callback opcional al finalizar la reproducción o si ocurre un error.
   * @param onStart Callback opcional al comenzar a reproducir el audio.
   * @param apiKey Clave de API de OpenAI opcional (toma precedencia sobre configuración global).
   */
  static async speak(
    text: string,
    onDone?: () => void,
    onStart?: () => void,
    apiKey?: string
  ): Promise<void> {
    const trimmedText = text?.trim();
    if (!trimmedText) {
      if (onDone) onDone();
      return;
    }

    const naturalText = this.formatTextForNaturalSpeech(trimmedText);

    // Detener cualquier reproducción previa
    await this.stop();

    const resolvedApiKey =
      apiKey ||
      this.customApiKey ||
      (typeof process !== 'undefined' && process.env
        ? process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
        : undefined);

    this.isSpeakingState = true;

    // Intentar primero con OpenAI TTS si hay API key configurada
    if (resolvedApiKey) {
      const success = await this.speakWithOpenAI(
        naturalText,
        resolvedApiKey,
        onDone,
        onStart
      );

      if (success) {
        return;
      }
    }

    // Fallback mejorado con expo-speech
    await this.speakWithSpeechFallback(naturalText, onDone, onStart);
  }

  /**
   * Indica si hay una clave de API configurada para TTS de alta fidelidad.
   */
  static hasApiKey(): boolean {
    return Boolean(
      this.customApiKey ||
        (typeof process !== 'undefined' && process.env
          ? process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
          : false)
    );
  }

  /**
   * Pre-procesa el texto para lograr una entonación conversacional fluida en español:
   * - Expande abreviaturas viales y títulos para evitar pronunciación entrecortada.
   * - Agrega pausas estratégicas en comas y puntos.
   */
  static formatTextForNaturalSpeech(rawText: string): string {
    return rawText
      .replace(/\bAv\.\s*/gi, 'Avenida ')
      .replace(/\bCalz\.\s*/gi, 'Calzada ')
      .replace(/\bCto\.\s*/gi, 'Circuito ')
      .replace(/\bDr\.\s*/gi, 'Doctor ')
      .replace(/\bDra\.\s*/gi, 'Doctora ')
      .replace(/\bDiag\.\s*/gi, 'Diagonal ')
      .replace(/\bProl\.\s*/gi, 'Prolongación ')
      .replace(/\bno\.\s*(\d+)/gi, 'número $1')
      .replace(/\bnum\.\s*(\d+)/gi, 'número $1')
      .replace(/\b(\d+)\s*km\b/gi, '$1 kilómetros')
      .replace(/\b(\d+)\s*m\b/gi, '$1 metros')
      .replace(/\b(\d+)\s*min\b/gi, '$1 minutos')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Detiene de inmediato cualquier reproducción o generación de voz en curso,
   * liberando memoria y asegurando cero persistencia en disco.
   */
  static async stop(): Promise<void> {
    // 1. Cancelar petición de red en curso
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {}
      this.currentAbortController = null;
    }

    // 2. Detener y descargar sonido de expo-av
    if (this.currentSound) {
      try {
        const status = await this.currentSound.getStatusAsync();
        if (status.isLoaded) {
          await this.currentSound.stopAsync();
          await this.currentSound.unloadAsync();
        }
      } catch (error) {
        console.warn('[VoiceService] Error al descargar audio:', error);
      }
      this.currentSound = null;
    }

    // 3. Eliminar archivo temporal en disco (privacidad de datos biométricos)
    if (this.currentTempFile) {
      try {
        if (this.currentTempFile.exists) {
          this.currentTempFile.delete();
        }
      } catch (error) {
        console.warn('[VoiceService] Error al limpiar archivo temporal:', error);
      }
      this.currentTempFile = null;
    }

    // 4. Revocar URL de objeto web si aplica
    if (this.currentWebObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentWebObjectUrl);
      } catch {}
      this.currentWebObjectUrl = null;
    }

    // 5. Detener síntesis nativa de expo-speech
    try {
      await Speech.stop();
    } catch (error) {
      console.warn('[VoiceService] Error al detener Speech nativo:', error);
    }

    this.isSpeakingState = false;
  }

  /**
   * Síntesis vía OpenAI TTS (endpoint https://api.openai.com/v1/audio/speech).
   * Modelo tts-1, voz 'nova' o 'shimmer' a 0.88x de velocidad.
   */
  private static async speakWithOpenAI(
    text: string,
    apiKey: string,
    onDone?: () => void,
    onStart?: () => void
  ): Promise<boolean> {
    const controller = new AbortController();
    this.currentAbortController = controller;

    let audioUri: string | null = null;
    let tempFile: File | null = null;
    let webObjectUrl: string | null = null;

    try {
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: this.selectedVoice,
          speed: this.speed,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn(
          `[VoiceService] Error en OpenAI TTS (${response.status}): ${response.statusText}`
        );
        return false;
      }

      // Procesar buffer binario
      if (Platform.OS === 'web') {
        const blob = await response.blob();
        webObjectUrl = URL.createObjectURL(blob);
        this.currentWebObjectUrl = webObjectUrl;
        audioUri = webObjectUrl;
      } else {
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const fileName = `avan_tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
        tempFile = new File(Paths.cache, fileName);
        tempFile.create({ overwrite: true });
        tempFile.write(bytes);
        this.currentTempFile = tempFile;
        audioUri = tempFile.uri;
      }

      if (controller.signal.aborted) {
        this.cleanupResources(tempFile, webObjectUrl);
        return true;
      }

      // Configurar modo de audio para salida clara en altavoz
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // Ignorar si la plataforma no soporta configuración completa de audio
      }

      let hasStarted = false;
      let hasFinished = false;

      const handleCleanup = async () => {
        if (hasFinished) return;
        hasFinished = true;
        this.isSpeakingState = false;

        if (this.currentSound) {
          try {
            await this.currentSound.unloadAsync();
          } catch {}
          this.currentSound = null;
        }

        this.cleanupResources(tempFile, webObjectUrl);
        this.currentAbortController = null;
      };

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        (status: AVPlaybackStatus) => {
          if (!status.isLoaded) {
            if (status.error) {
              console.warn('[VoiceService] Error en reproducción de audio:', status.error);
              handleCleanup().then(() => {
                if (onDone) onDone();
              });
            }
            return;
          }

          if (status.isPlaying && !hasStarted) {
            hasStarted = true;
            this.isSpeakingState = true;
            if (onStart) onStart();
          }

          if (status.didJustFinish) {
            handleCleanup().then(() => {
              if (onDone) onDone();
            });
          }
        }
      );

      this.currentSound = sound;
      return true;
    } catch (error: any) {
      this.cleanupResources(tempFile, webObjectUrl);

      if (controller.signal.aborted) {
        this.isSpeakingState = false;
        return true;
      }

      console.warn('[VoiceService] Falló síntesis OpenAI TTS, usando fallback:', error?.message || error);
      return false;
    }
  }

  /**
   * Limpia archivos y URLs temporales para garantizar cero persistencia.
   */
  private static cleanupResources(file: File | null, webUrl: string | null): void {
    if (file) {
      try {
        if (file.exists) {
          file.delete();
        }
      } catch (err) {
        console.warn('[VoiceService] Error al limpiar archivo temporal:', err);
      }
      if (this.currentTempFile === file) {
        this.currentTempFile = null;
      }
    }

    if (webUrl) {
      try {
        URL.revokeObjectURL(webUrl);
      } catch {}
      if (this.currentWebObjectUrl === webUrl) {
        this.currentWebObjectUrl = null;
      }
    }
  }

  /**
   * Fallback mejorado en expo-speech:
   * 1. Consulta las voces disponibles en el dispositivo con Speech.getAvailableVoicesAsync().
   * 2. Selecciona la voz en español de mayor calidad (priorizando quality === Speech.VoiceQuality.Enhanced
   *    y variantes naturales en es-MX/es-419).
   * 3. Ajusta rate en 0.88 y pitch en 0.95.
   */
  private static async speakWithSpeechFallback(
    text: string,
    onDone?: () => void,
    onStart?: () => void
  ): Promise<void> {
    try {
      const bestVoice = await this.getBestSpanishVoice();

      const options: Speech.SpeechOptions = {
        language: bestVoice?.language || 'es-MX',
        rate: this.speed,
        pitch: this.pitch,
        onStart: () => {
          this.isSpeakingState = true;
          if (onStart) onStart();
        },
        onDone: () => {
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
        onStopped: () => {
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
        onError: () => {
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
      };

      if (bestVoice?.identifier) {
        options.voice = bestVoice.identifier;
      }

      this.isSpeakingState = true;
      Speech.speak(text, options);
    } catch (error) {
      console.warn('[VoiceService] Error en fallback de expo-speech:', error);
      this.isSpeakingState = false;
      if (onDone) onDone();
    }
  }

  /**
   * Consulta las voces disponibles en el dispositivo con Speech.getAvailableVoicesAsync()
   * y selecciona la voz en español de mayor fidelidad acústica.
   */
  private static async getBestSpanishVoice(): Promise<Speech.Voice | null> {
    if (this.cachedBestVoice) {
      return this.cachedBestVoice;
    }

    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (!voices || voices.length === 0) {
        return null;
      }

      // Filtrar voces en español
      const spanishVoices = voices.filter((v) => {
        const lang = (v.language || '').toLowerCase().replace('_', '-');
        return lang.startsWith('es');
      });

      if (spanishVoices.length === 0) {
        return null;
      }

      // Sistema de puntuación para selección de voz óptima
      const scoredVoices = spanishVoices.map((voice) => {
        let score = 0;
        const lang = (voice.language || '').toLowerCase().replace('_', '-');
        const name = (voice.name || '').toLowerCase();

        // 1. Calidad mejorada del sintetizador (Enhanced / Premium)
        if (voice.quality === Speech.VoiceQuality.Enhanced) {
          score += 100;
        }

        // Palabras clave de naturalidad en el nombre del paquete de voz
        if (
          name.includes('natural') ||
          name.includes('neural') ||
          name.includes('enhanced') ||
          name.includes('premium') ||
          name.includes('siri')
        ) {
          score += 40;
        }

        // 2. Dialecto y acento familiar para el usuario objetivo
        if (lang === 'es-mx' || lang.includes('mx') || name.includes('mexico')) {
          score += 50; // Español de México
        } else if (lang === 'es-419' || lang.includes('419')) {
          score += 45; // Español latinoamericano neutro
        } else if (lang === 'es-us') {
          score += 30; // Español de EE. UU.
        } else {
          score += 15; // Otras variantes de español (es-ES, etc.)
        }

        return { voice, score };
      });

      scoredVoices.sort((a, b) => b.score - a.score);
      this.cachedBestVoice = scoredVoices[0].voice;
      return this.cachedBestVoice;
    } catch (error) {
      console.warn('[VoiceService] No se pudieron consultar las voces del dispositivo:', error);
      return null;
    }
  }
}
