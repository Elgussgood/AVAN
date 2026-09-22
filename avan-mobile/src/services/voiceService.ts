import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';

export type OpenAITTSVoice = 'nova' | 'shimmer' | 'alloy' | 'echo' | 'fable' | 'onyx';

export interface VoiceServiceOptions {
  apiKey?: string;
  voice?: OpenAITTSVoice;
  elevenLabsVoiceId?: string;
  apiBaseUrl?: string;
  speed?: number;
}

/**
 * Servicio de síntesis de voz (TTS) de alta fidelidad para el proyecto AVAN.
 *
 * Diseñado con enfoque en accesibilidad para adultos mayores:
 * - Soporte nativo para ElevenLabs (voz ultra-humana 'Rachel', modelo multilingüe v2).
 * - Soporte para OpenAI TTS (modelo tts-1, voz 'nova' o 'shimmer').
 * - Motor de contingencia nativo vía expo-speech configurado a prueba de balas en es-MX.
 * - Velocidad calibrada a 0.88x - 0.9x para máxima inteligibilidad y menor esfuerzo cognitivo.
 * - Tono 0.95 para reducir estridencia y fatiga auditiva.
 * - Reproducción de audio externo moderna y resiliente con expo-audio (createAudioPlayer).
 * - Cero persistencia de audios en disco tras la reproducción (privacidad de datos biométricos).
 */
export class VoiceService {
  private static isSpeakingState = false;
  private static currentPlayer: AudioPlayer | null = null;
  private static currentTempFile: File | null = null;
  private static currentWebObjectUrl: string | null = null;
  private static currentAbortController: AbortController | null = null;
  private static cachedBestVoice: Speech.Voice | null = null;

  // Configuración por defecto
  private static customApiKey: string | null = null;
  private static selectedVoice: OpenAITTSVoice = 'nova';
  private static elevenLabsVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Voz premade gratuita (Sarah / Bella, cálida, natural, multilingüe)
  private static apiBaseUrl = 'https://api.openai.com/v1/audio/speech';
  private static speed = 0.88;
  private static pitch = 0.95;

  /**
   * Configura la clave de API global (OpenAI o ElevenLabs).
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
   * Configura el ID de voz para ElevenLabs (por defecto: '21m00Tcm4TlvDq8ikWAM' - Rachel).
   */
  static setElevenLabsVoiceId(voiceId: string): void {
    this.elevenLabsVoiceId = voiceId;
  }

  /**
   * Configura la URL base de la API OpenAI (compatible con proxies).
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
   * Prioridad de síntesis:
   * 1. ElevenLabs (si la clave empieza con 'sk_' o está configurada EXPO_PUBLIC_ELEVENLABS_API_KEY).
   * 2. OpenAI TTS (si la clave empieza con 'sk-').
   * 3. Fallback inteligente y garantizado a expo-speech en 'es-MX'.
   *
   * @param text Texto a reproducir.
   * @param onDone Callback opcional al finalizar la reproducción o si ocurre un error.
   * @param onStart Callback opcional al comenzar a reproducir el audio.
   * @param apiKey Clave de API opcional (toma precedencia sobre configuración global).
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

    const elevenLabsExplicitKey =
      (typeof process !== 'undefined' && process.env
        ? process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY
        : undefined);

    const resolvedApiKey =
      apiKey ||
      this.customApiKey ||
      elevenLabsExplicitKey ||
      (typeof process !== 'undefined' && process.env
        ? process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY
        : undefined);

    this.isSpeakingState = true;

    let success = false;

    // Detectar si la clave corresponde a ElevenLabs
    // Claves de ElevenLabs típicamente inician con 'sk_' (guion bajo), o provienen de variable ElevenLabs
    const isElevenLabsKey =
      Boolean(elevenLabsExplicitKey) ||
      (typeof resolvedApiKey === 'string' && resolvedApiKey.startsWith('sk_'));

    const isOpenAIKey =
      typeof resolvedApiKey === 'string' && resolvedApiKey.startsWith('sk-');

    if (resolvedApiKey) {
      if (isElevenLabsKey) {
        console.log('[VoiceService] Detectada API key de ElevenLabs, sintetizando voz ultra-natural...');
        success = await this.speakWithElevenLabs(
          naturalText,
          resolvedApiKey,
          onDone,
          onStart
        );
      } else if (isOpenAIKey) {
        console.log('[VoiceService] Detectada API key de OpenAI, sintetizando con OpenAI TTS...');
        success = await this.speakWithOpenAI(
          naturalText,
          resolvedApiKey,
          onDone,
          onStart
        );
      } else {
        // Clave genérica: intentar primero ElevenLabs, luego OpenAI
        success = await this.speakWithElevenLabs(
          naturalText,
          resolvedApiKey,
          onDone,
          onStart
        );
        if (!success) {
          success = await this.speakWithOpenAI(
            naturalText,
            resolvedApiKey,
            onDone,
            onStart
          );
        }
      }

      if (success) {
        return;
      }
    }

    // Fallback mejorado y robusto con expo-speech
    await this.speakWithSpeechFallback(naturalText, onDone, onStart);
  }

  /**
   * Indica si hay una clave de API configurada para TTS de alta fidelidad.
   */
  static hasApiKey(): boolean {
    return Boolean(
      this.customApiKey ||
        (typeof process !== 'undefined' && process.env
          ? process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ||
            process.env.ELEVENLABS_API_KEY ||
            process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
            process.env.OPENAI_API_KEY
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

    // 2. Detener y remover AudioPlayer de expo-audio
    if (this.currentPlayer) {
      try {
        this.currentPlayer.pause();
        this.currentPlayer.remove();
      } catch (error) {
        console.warn('[VoiceService] Error al detener AudioPlayer:', error);
      }
      this.currentPlayer = null;
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

    // 5. Detener síntesis nativa de expo-speech únicamente si está activa
    try {
      const isSpeaking = await Speech.isSpeakingAsync();
      if (isSpeaking) {
        await Speech.stop();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    } catch (error) {
      console.warn('[VoiceService] Error al detener Speech nativo:', error);
    }

    this.isSpeakingState = false;
  }

  /**
   * Síntesis de voz ultra-natural con ElevenLabs (voz Rachel, modelo multilingüe v2).
   */
  private static async speakWithElevenLabs(
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
      let currentVoiceId = this.elevenLabsVoiceId;
      let url = `https://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}`;
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: 0.9,
          },
        }),
        signal: controller.signal,
      });

      // Si la petición devuelve 402 (payment_required por ser voz de librería en cuenta gratuita),
      // reintentar de inmediato con la voz premade gratuita garantizada 'EXAVITQu4vr4xnSDxMaL'
      if (response.status === 402 && currentVoiceId !== 'EXAVITQu4vr4xnSDxMaL') {
        console.warn(
          `[VoiceService] ElevenLabs 402 (voz de librería restringida en cuenta free). Reintentando con voz premade 'EXAVITQu4vr4xnSDxMaL'...`
        );
        currentVoiceId = 'EXAVITQu4vr4xnSDxMaL';
        url = `https://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}`;
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed: 0.9,
            },
          }),
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        const errorDetail = await response.text();
        console.warn(`[VoiceService] Error en ElevenLabs TTS (${response.status}):`, errorDetail);
        return false;
      }

      // Procesar buffer binario MP3
      if (Platform.OS === 'web') {
        const blob = await response.blob();
        webObjectUrl = URL.createObjectURL(blob);
        this.currentWebObjectUrl = webObjectUrl;
        audioUri = webObjectUrl;
      } else {
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const fileName = `avan_tts_el_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
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

      return await this.playAudioSource(audioUri, tempFile, webObjectUrl, onDone, onStart);
    } catch (error: any) {
      this.cleanupResources(tempFile, webObjectUrl);

      if (controller.signal.aborted) {
        this.isSpeakingState = false;
        return true;
      }

      console.warn('[VoiceService] Falló síntesis ElevenLabs, intentando fallback:', error?.message || error);
      return false;
    }
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
        const fileName = `avan_tts_oa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
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

      return await this.playAudioSource(audioUri, tempFile, webObjectUrl, onDone, onStart);
    } catch (error: any) {
      this.cleanupResources(tempFile, webObjectUrl);

      if (controller.signal.aborted) {
        this.isSpeakingState = false;
        return true;
      }

      console.warn('[VoiceService] Falló síntesis OpenAI TTS, intentando fallback:', error?.message || error);
      return false;
    }
  }

  /**
   * Reproduce el archivo de audio con expo-audio y maneja el ciclo de vida y Zero-Persistence.
   */
  private static async playAudioSource(
    audioUri: string,
    tempFile: File | null,
    webObjectUrl: string | null,
    onDone?: () => void,
    onStart?: () => void
  ): Promise<boolean> {
    try {
      // Configurar modo de audio para salida clara en altavoz
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
          interruptionMode: 'duckOthers',
        });
      } catch {
        // Ignorar si la plataforma no soporta configuración de audio
      }

      let hasStarted = false;
      let hasFinished = false;

      const handleCleanup = async () => {
        if (hasFinished) return;
        hasFinished = true;
        this.isSpeakingState = false;

        if (this.currentPlayer) {
          try {
            this.currentPlayer.pause();
            this.currentPlayer.remove();
          } catch {}
          this.currentPlayer = null;
        }

        this.cleanupResources(tempFile, webObjectUrl);
        this.currentAbortController = null;
      };

      // Crear player con expo-audio
      const player = createAudioPlayer({ uri: audioUri });
      this.currentPlayer = player;

      player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.error) {
          console.warn('[VoiceService] Error en reproducción de expo-audio:', status.error);
          handleCleanup().then(() => {
            if (onDone) onDone();
          });
          return;
        }

        if (status.playing && !hasStarted) {
          hasStarted = true;
          this.isSpeakingState = true;
          if (onStart) onStart();
        }

        if (status.didJustFinish) {
          handleCleanup().then(() => {
            if (onDone) onDone();
          });
        }
      });

      player.play();
      return true;
    } catch (playError) {
      console.warn('[VoiceService] Error al reproducir audio con expo-audio:', playError);
      this.cleanupResources(tempFile, webObjectUrl);
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
   * Fallback 100% garantizado en expo-speech:
   * 1. Invoca setAudioModeAsync de expo-audio para asegurar que el canal de audio esté en altavoz.
   * 2. Emplea prioritariamente language: 'es-MX' (o 'es') con rate: 0.88 y pitch: 0.95 sin forzar
   *    voice.identifier específico para evitar fallos silenciosos en Google TTS (Android).
   * 3. Registra logs informativos y captura onError detalladamente.
   */
  private static async speakWithSpeechFallback(
    text: string,
    onDone?: () => void,
    onStart?: () => void
  ): Promise<void> {
    try {
      // 1. Configurar modo de audio antes de llamar a Speech.speak
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          shouldRouteThroughEarpiece: false,
          interruptionMode: 'duckOthers',
        });
      } catch (audioModeErr) {
        console.warn('[VoiceService] Error al configurar modo de audio antes de Speech:', audioModeErr);
      }

      console.log('[VoiceService] Reproduciendo por expo-speech:', text);

      // 2. Determinar el idioma base en español
      let languageToUse = 'es-MX';
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (voices && voices.length > 0) {
          const hasEsMx = voices.some((v) =>
            (v.language || '').toLowerCase().replace('_', '-').includes('es-mx')
          );
          const hasSpanish = voices.some((v) =>
            (v.language || '').toLowerCase().startsWith('es')
          );
          if (!hasEsMx && hasSpanish) {
            languageToUse = 'es';
          }
        }
      } catch {
        languageToUse = 'es-MX';
      }

      const options: Speech.SpeechOptions = {
        language: languageToUse,
        rate: this.speed, // 0.88: ritmo pausado para adultos mayores
        pitch: this.pitch, // 0.95: tono ligeramente más grave para reducir fatiga auditiva
        onStart: () => {
          console.log('[VoiceService] Speech.speak onStart');
          this.isSpeakingState = true;
          if (onStart) onStart();
        },
        onDone: () => {
          console.log('[VoiceService] Speech.speak onDone');
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
        onStopped: () => {
          console.log('[VoiceService] Speech.speak onStopped');
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
        onError: (error) => {
          console.warn('[VoiceService] Speech.speak onError:', error);
          this.isSpeakingState = false;
          if (onDone) onDone();
        },
      };

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
   * como método auxiliar de inspección.
   */
  static async getBestSpanishVoice(): Promise<Speech.Voice | null> {
    if (this.cachedBestVoice) {
      return this.cachedBestVoice;
    }

    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (!voices || voices.length === 0) {
        return null;
      }

      const spanishVoices = voices.filter((v) => {
        const lang = (v.language || '').toLowerCase().replace('_', '-');
        return lang.startsWith('es');
      });

      if (spanishVoices.length === 0) {
        return null;
      }

      const scoredVoices = spanishVoices.map((voice) => {
        let score = 0;
        const lang = (voice.language || '').toLowerCase().replace('_', '-');
        const name = (voice.name || '').toLowerCase();

        if (voice.quality === Speech.VoiceQuality.Enhanced) {
          score += 100;
        }

        if (
          name.includes('natural') ||
          name.includes('neural') ||
          name.includes('enhanced') ||
          name.includes('premium') ||
          name.includes('siri')
        ) {
          score += 40;
        }

        if (lang === 'es-mx' || lang.includes('mx') || name.includes('mexico')) {
          score += 50;
        } else if (lang === 'es-419' || lang.includes('419')) {
          score += 45;
        } else if (lang === 'es-us') {
          score += 30;
        } else {
          score += 15;
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
