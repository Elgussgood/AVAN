import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { File, UploadTask, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

export type RecordingStatus = 'idle' | 'recording' | 'processing' | 'error';

export interface TranscriptionResult {
  text: string;
  durationMs?: number;
  isSimulated?: boolean;
}

export interface AudioRecordingResult {
  uri: string | null;
  durationMillis: number;
}

export interface AudioRecordingOptions {
  /**
   * Si es true, activa la calibración para dictado de dirección (pausas más largas de 4s y máximo 25s).
   */
  isDictatingAddress?: boolean;

  /**
   * Ventana de silencio inicial en ms (tiempo esperando a que el usuario empiece a hablar). Por defecto: 8000ms.
   */
  initialSilenceMs?: number;

  /**
   * Ventana de silencio posterior (trailing silence) en ms (tiempo de silencio tras haber hablado para cerrar y procesar).
   * Por defecto: 3000ms (o 4000ms si isDictatingAddress es true).
   */
  trailingSilenceMs?: number;

  /**
   * Duración máxima absoluta de grabación en ms.
   * Por defecto: 15000ms (o 25000ms si isDictatingAddress es true).
   */
  maxDurationMs?: number;

  /**
   * Umbral de energía vocal en dB para considerar que el usuario empezó a hablar.
   * Por defecto: -40 dB.
   */
  speechThresholdDb?: number;

  /**
   * Callback invocado cuando se detecta por primera vez energía de habla.
   */
  onSpeechDetected?: () => void;

  /**
   * Callback invocado si transcurre la ventana de silencio inicial (8s) sin que el usuario haya hablado.
   */
  onInitialSilenceTimeout?: () => void | Promise<void>;

  /**
   * Callback invocado cuando el usuario habló y transcurren 3s continuos de silencio (trailing silence),
   * o se alcanza la duración máxima. Se le entrega el resultado de la transcripción.
   */
  onSpeechEnded?: (transcription: TranscriptionResult | null) => void | Promise<void>;
}

/**
 * Servicio de grabación de audio y transcripción STT (Speech-to-Text) para AVAN.
 * Utiliza `expo-audio` para máxima compatibilidad con Expo Go (SDK 52+).
 * Aplica una estricta política de Zero-Persistence:
 * el audio grabado solo existe en memoria/temporalmente y se elimina de inmediato
 * tras transcribir o cancelar la operación.
 */
export class AudioRecorderService {
  private static recording: AudioRecorder | null = null;
  private static isRecordingAudio: boolean = false;
  private static lastDurationMillis: number = 0;
  private static status: RecordingStatus = 'idle';

  // Monitor VAD (Voice Activity Detection) adaptativo
  private static vadInterval: ReturnType<typeof setInterval> | null = null;
  private static isSpeechDetected: boolean = false;
  private static speechStartTime: number | null = null;
  private static lastSpeechTime: number | null = null;
  private static recordingStartTime: number = 0;
  private static noiseFloorDb: number = -45;
  private static noiseCalibrationSamples: number[] = [];
  private static consecutiveSpeechFrames: number = 0;
  private static totalSpeechFrames: number = 0;

  /**
   * Detiene el monitor de actividad vocal (VAD).
   */
  static stopVADMonitor(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    this.consecutiveSpeechFrames = 0;
  }

  /**
   * Solicita permisos de micrófono al usuario mediante expo-audio.
   */
  static async requestPermissions(): Promise<boolean> {
    try {
      const permission = await requestRecordingPermissionsAsync();
      return permission.granted;
    } catch (error) {
      console.warn('Error al solicitar permisos de audio con expo-audio:', error);
      return false;
    }
  }

  /**
   * Solicita permisos de micrófono y comienza la grabación en alta calidad usando expo-audio
   * con monitoreo VAD en tiempo real (silencio inicial de 8s y trailing silence de 3s).
   */
  static async startRecording(options?: AudioRecordingOptions): Promise<boolean> {
    try {
      this.stopVADMonitor();
      if (this.recording) {
        await this.cancelRecording();
      }

      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.warn('Permiso de micrófono no otorgado');
        this.status = 'error';
        this.isRecordingAudio = false;
        return false;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      const recordingOptions = {
        ...RecordingPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      };

      const recorder = new AudioModule.AudioRecorder(recordingOptions);
      await recorder.prepareToRecordAsync(recordingOptions);
      recorder.record();

      this.recording = recorder;
      this.isRecordingAudio = true;
      this.status = 'recording';
      this.lastDurationMillis = 0;
      this.isSpeechDetected = false;
      this.speechStartTime = null;
      this.lastSpeechTime = null;
      this.recordingStartTime = Date.now();
      this.noiseFloorDb = -45;
      this.noiseCalibrationSamples = [];
      this.consecutiveSpeechFrames = 0;
      this.totalSpeechFrames = 0;

      // Configuración de umbrales y tiempos de VAD
      const isDictating = Boolean(options?.isDictatingAddress);
      const initialSilenceMs = options?.initialSilenceMs ?? 8000;
      const trailingSilenceMs = options?.trailingSilenceMs ?? (isDictating ? 2500 : 1800);
      const maxDurationMs = options?.maxDurationMs ?? (isDictating ? 25000 : 15000);

      // Calibración acústica adaptativa:
      // - baseSpeechThresholdDb: Mínimo absoluto para considerar voz humana (-32 dB para evitar ruidos de motor o AC a -35 dB)
      // - snrMarginDb: Margen requerido sobre el piso de ruido ambiental (8 dB)
      const baseSpeechThresholdDb = options?.speechThresholdDb ?? -32;
      const snrMarginDb = 8;

      this.vadInterval = setInterval(async () => {
        if (!this.recording || !this.isRecordingAudio) {
          this.stopVADMonitor();
          return;
        }

        const now = Date.now();
        const elapsed = now - this.recordingStartTime;
        let metering: number | undefined;

        try {
          const status = this.recording.getStatus();
          metering = status.metering;
        } catch {
          // ignore
        }

        // Si metering está disponible
        if (typeof metering === 'number') {
          // 1. Calibración continua del piso de ruido ambiental (Noise Floor)
          if (!this.isSpeechDetected) {
            if (this.noiseCalibrationSamples.length < 5) {
              this.noiseCalibrationSamples.push(metering);
              const sum = this.noiseCalibrationSamples.reduce((a, b) => a + b, 0);
              this.noiseFloorDb = sum / this.noiseCalibrationSamples.length;
            } else {
              // Promedio móvil para seguir variaciones graduales del ruido ambiental (rodadura, ventilación)
              this.noiseFloorDb = this.noiseFloorDb * 0.92 + metering * 0.08;
            }
          }

          // 2. Umbral dinámico adaptado al entorno sonoro actual
          // La voz debe superar el ruido ambiental por al menos snrMarginDb y no ser menor a baseSpeechThresholdDb
          const adaptiveThresholdDb = Math.max(
            baseSpeechThresholdDb,
            this.noiseFloorDb + snrMarginDb
          );

          // 3. Verificación de energía con persistencia temporal (Debounce acústico)
          if (metering >= adaptiveThresholdDb) {
            this.consecutiveSpeechFrames++;
            this.totalSpeechFrames++;

            // Requiere al menos 2 frames consecutivos (~200ms) para confirmar habla
            if (this.consecutiveSpeechFrames >= 2) {
              if (!this.isSpeechDetected) {
                this.isSpeechDetected = true;
                this.speechStartTime = now - (this.consecutiveSpeechFrames * 100);
                console.log(
                  `[AudioRecorderService] VAD: Habla confirmada (nivel: ${metering.toFixed(1)} dB >= umbral ${adaptiveThresholdDb.toFixed(1)} dB [ruido base: ${this.noiseFloorDb.toFixed(1)} dB])`
                );
                if (options?.onSpeechDetected) {
                  options.onSpeechDetected();
                }
              }
              this.lastSpeechTime = now;
            }
          } else {
            // El frame actual está por debajo del umbral adaptativo
            this.consecutiveSpeechFrames = 0;
          }
        }

        // Condición A: Silencio Posterior (Trailing Silence tras haber hablado)
        if (this.isSpeechDetected && this.lastSpeechTime) {
          const silenceDuration = now - this.lastSpeechTime;
          if (silenceDuration >= trailingSilenceMs) {
            const speechDuration = (this.lastSpeechTime || now) - (this.speechStartTime || now);

            // Filtro de duración mínima de habla:
            // Si duró menos de 300ms o menos de 2 frames totales sobre el umbral,
            // fue un ruido transitorio (bache, roce de ropa, tos lejana, click)
            if (speechDuration < 300 || this.totalSpeechFrames < 2) {
              console.log(
                `[AudioRecorderService] VAD: Ruido transitorio descartado (${speechDuration}ms / ${this.totalSpeechFrames} frames). Reanudando escucha.`
              );
              // Resetear estado de habla para que continúe la ventana de escucha normal
              this.isSpeechDetected = false;
              this.speechStartTime = null;
              this.lastSpeechTime = null;
              this.consecutiveSpeechFrames = 0;
              this.totalSpeechFrames = 0;
              return;
            }

            console.log(
              `[AudioRecorderService] VAD: Silencio posterior completado (${silenceDuration}ms >= ${trailingSilenceMs}ms, habla acumulada: ${speechDuration}ms). Finalizando captura.`
            );
            this.stopVADMonitor();
            const transcription = await this.stopAndTranscribe();
            if (options?.onSpeechEnded) {
              await options.onSpeechEnded(transcription);
            }
            return;
          }
        }

        // Condición B: Silencio Inicial (el usuario no ha hablado y pasaron 8 segundos)
        if (!this.isSpeechDetected && elapsed >= initialSilenceMs) {
          console.log(`[AudioRecorderService] VAD: Silencio inicial cumplido (${elapsed}ms >= ${initialSilenceMs}ms).`);
          this.stopVADMonitor();
          await this.stopRecording();
          if (options?.onInitialSilenceTimeout) {
            await options.onInitialSilenceTimeout();
          }
          return;
        }

        // Condición C: Límite máximo de duración de seguridad
        if (elapsed >= maxDurationMs) {
          console.log(`[AudioRecorderService] VAD: Límite máximo de duración alcanzado (${elapsed}ms >= ${maxDurationMs}ms).`);
          this.stopVADMonitor();
          const transcription = await this.stopAndTranscribe();
          if (options?.onSpeechEnded) {
            await options.onSpeechEnded(transcription);
          }
          return;
        }
      }, 100);

      return true;
    } catch (error) {
      console.warn('Error al iniciar grabación con expo-audio:', error);
      this.stopVADMonitor();
      this.status = 'error';
      this.isRecordingAudio = false;
      this.recording = null;
      return false;
    }
  }

  /**
   * Detiene la grabación actual y devuelve el URI del archivo y la duración en ms.
   * Restaura el modo de audio para permitir reproducción de voz.
   */
  static async stopRecording(): Promise<AudioRecordingResult> {
    try {
      this.resetVADState();
      if (!this.recording) {
        this.isRecordingAudio = false;
        this.status = 'idle';
        return { uri: null, durationMillis: 0 };
      }

      let durationMillis = 0;
      try {
        durationMillis = Math.round((this.recording.currentTime || 0) * 1000);
      } catch {
        durationMillis = this.lastDurationMillis;
      }

      await this.recording.stop();
      const uri = this.recording.uri;

      // Restaurar modo de audio para reproducción (hablar)
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      this.recording = null;
      this.isRecordingAudio = false;
      this.status = 'idle';
      this.lastDurationMillis = durationMillis;

      return { uri, durationMillis };
    } catch (error) {
      console.warn('Error al detener grabación de audio:', error);
      this.stopVADMonitor();
      this.recording = null;
      this.isRecordingAudio = false;
      this.status = 'error';
      return { uri: null, durationMillis: 0 };
    }
  }

  /**
   * Directiva de Privacidad Biométrica: Zero-Persistence.
   * Elimina de manera segura e inmediata el archivo de audio temporal del dispositivo.
   */
  static async deleteAudioFile(uri: string | null): Promise<void> {
    if (!uri) return;

    try {
      let FileSystemModule: any = null;
      try {
        FileSystemModule = require('expo-file-system');
      } catch {
        try {
          FileSystemModule = require('expo-file-system/legacy');
        } catch {
          try {
            FileSystemModule = require('expo/node_modules/expo-file-system');
          } catch {}
        }
      }

      if (FileSystemModule?.File) {
        try {
          const file = new FileSystemModule.File(uri);
          if (file && typeof file.delete === 'function') {
            file.delete();
            return;
          }
        } catch {}
      }

      if (typeof FileSystemModule?.deleteAsync === 'function') {
        await FileSystemModule.deleteAsync(uri, { idempotent: true });
        return;
      }

      try {
        const legacyFS = require('expo-file-system/legacy');
        if (typeof legacyFS?.deleteAsync === 'function') {
          await legacyFS.deleteAsync(uri, { idempotent: true });
          return;
        }
      } catch {}
    } catch (error) {
      console.warn('Error al eliminar archivo de audio temporal (Zero-Persistence):', error);
    }
  }

  /**
   * Detiene la grabación, envía el audio a la API de Whisper (Groq u OpenAI)
   * utilizando UploadTask nativo de expo-file-system (evita Unsupported FormDataPart en Android)
   * y elimina el archivo de audio para cumplir la política de Zero-Persistence.
   */
  static async stopAndTranscribe(
    apiKey?: string
  ): Promise<TranscriptionResult | null> {
    this.stopVADMonitor();
    if (!this.recording) {
      return null;
    }

    let uri: string | null = null;
    let durationMs = 0;
    try {
      this.status = 'processing';
      this.isRecordingAudio = false;
      try {
        durationMs = Math.round((this.recording.currentTime || 0) * 1000);
      } catch {}

      await this.recording.stop();
      uri = this.recording.uri;
      this.recording = null;

      // Restaurar modo de audio para reproducción
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) {
        this.status = 'idle';
        return null;
      }

      const rawGroqKey = (
        apiKey ||
        process.env.EXPO_PUBLIC_GROQ_API_KEY ||
        process.env.GROQ_API_KEY ||
        ''
      ).trim();
      const resolvedGroqKey = rawGroqKey && !rawGroqKey.includes('TU_API_KEY') ? rawGroqKey : '';

      const rawOpenAIKey = (
        process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        ''
      ).trim();
      const resolvedOpenAIKey = rawOpenAIKey && !rawOpenAIKey.includes('TU_API_KEY') ? rawOpenAIKey : '';

      // Si no se cuenta con API key de Groq ni OpenAI, no devolver texto simulado falso
      if (!resolvedGroqKey && !resolvedOpenAIKey) {
        console.warn('[AudioRecorder] No se encontró EXPO_PUBLIC_GROQ_API_KEY ni EXPO_PUBLIC_OPENAI_API_KEY para transcribir.');
        this.status = 'error';
        return null;
      }

      // Usar Groq Whisper (ultra-rápido) si está configurado, o OpenAI Whisper
      const endpoint = resolvedGroqKey
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';

      const keyToUse = resolvedGroqKey || resolvedOpenAIKey;

      // Envío con espera y reintento automático (hasta 2 intentos) para tolerar microcortes de red antes de borrar el archivo
      let uploadResult: { status: number; body: string } | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const file = new File(uri);
          const uploadTask = new UploadTask(file, endpoint, {
            httpMethod: 'POST',
            uploadType: UploadType.MULTIPART,
            fieldName: 'file',
            mimeType: 'audio/m4a',
            headers: {
              Authorization: `Bearer ${keyToUse}`,
            },
            parameters: {
              model: resolvedGroqKey ? 'whisper-large-v3-turbo' : 'whisper-1',
              language: 'es',
              response_format: 'json',
              temperature: '0',
              prompt: 'Comandos breves de navegación vehicular AVAN en español. Si solo hay silencio, ruido de motor o ambiente de auto, responde exactamente vacío.',
            },
          });

          uploadResult = await uploadTask.uploadAsync();
        } catch (uploadErr) {
          console.warn(`[AudioRecorder] UploadTask error (intento ${attempt}), intentando fallback con legacy uploadAsync:`, uploadErr);
          try {
            const legacyFS = require('expo-file-system/legacy');
            if (legacyFS?.uploadAsync) {
              uploadResult = await legacyFS.uploadAsync(endpoint, uri, {
                httpMethod: 'POST',
                uploadType: legacyFS.FileSystemUploadType.MULTIPART,
                fieldName: 'file',
                mimeType: 'audio/m4a',
                headers: {
                  Authorization: `Bearer ${keyToUse}`,
                },
                parameters: {
                  model: resolvedGroqKey ? 'whisper-large-v3-turbo' : 'whisper-1',
                  language: 'es',
                  response_format: 'json',
                  temperature: '0',
                  prompt: 'Comandos breves de navegación vehicular AVAN en español. Si solo hay silencio, ruido de motor o ambiente de auto, responde exactamente vacío.',
                },
              });
            }
          } catch (legacyErr) {
            console.warn(`[AudioRecorder] Error en fallback legacy uploadAsync (intento ${attempt}):`, legacyErr);
          }
        }

        if (uploadResult && uploadResult.status >= 200 && uploadResult.status < 300) {
          break;
        }

        if (attempt < 2) {
          console.log('[AudioRecorder] Esperando 1000ms para reintentar transcripción de audio...');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (uploadResult && uploadResult.status >= 200 && uploadResult.status < 300) {
        const data = JSON.parse(uploadResult.body);
        const rawText = data.text ? data.text.trim() : '';
        const sanitizedText = AudioRecorderService.sanitizeWhisperOutput(rawText);

        if (rawText && !sanitizedText) {
          console.log('[AudioRecorder] Whisper alucinación o ruido filtrado:', rawText);
        } else {
          console.log('[AudioRecorder] Transcripción Whisper validada:', sanitizedText);
        }

        this.status = 'idle';
        return {
          text: sanitizedText,
          durationMs,
          isSimulated: false,
        };
      } else {
        console.warn(
          'Error en respuesta de Whisper tras reintentos:',
          uploadResult?.status,
          uploadResult?.body
        );
        this.status = 'error';
        return null;
      }
    } catch (error) {
      console.warn('Error durante la transcripción de audio:', error);
      this.status = 'error';
      return null;
    } finally {
      this.recording = null;
      this.isRecordingAudio = false;
      // Zero-Persistence: eliminar el archivo de audio local inmediatamente
      if (uri) {
        await this.deleteAudioFile(uri);
      }
      if (this.status !== 'error') {
        this.status = 'idle';
      }
    }
  }

  /**
   * Cancela cualquier grabación en curso y libera recursos
   */
  static async cancelRecording(): Promise<void> {
    this.resetVADState();
    let uri: string | null = null;
    try {
      if (this.recording) {
        try {
          await this.recording.stop();
        } catch {}
        uri = this.recording.uri;
        this.recording = null;
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch (error) {
      console.warn('Error al cancelar grabación:', error);
    } finally {
      this.recording = null;
      this.isRecordingAudio = false;
      this.status = 'idle';
      if (uri) {
        await this.deleteAudioFile(uri);
      }
    }
  }

  /**
   * Resetea el monitor y contadores de VAD
   */
  private static resetVADState(): void {
    this.stopVADMonitor();
    this.isSpeechDetected = false;
    this.speechStartTime = null;
    this.lastSpeechTime = null;
    this.consecutiveSpeechFrames = 0;
    this.totalSpeechFrames = 0;
    this.noiseCalibrationSamples = [];
  }

  /**
   * Filtro anti-alucinaciones para Whisper ante ruido ambiental de cabina / vehículo.
   * Descarta subtítulos fantasma (Amara, YouTube), emojis musicales y textos sin contenido semántico.
   */
  static sanitizeWhisperOutput(text: string): string {
    if (!text) return '';
    const trimmed = text.trim();

    // 1. Descartar si solo contiene signos de puntuación, espacios o símbolos
    const cleanChars = trimmed.replace(/[\s\.,!\?¿¡\-_:;~…\(\)\[\]"'\*`«»“”]/g, '');
    if (!cleanChars) {
      return '';
    }

    const lower = trimmed.toLowerCase();

    // 2. Patrones conocidos de alucinaciones de Whisper sobre ruido de fondo
    const hallucinationPatterns = [
      'amara.org',
      'subtítulos realizados por',
      'subtitulado por',
      'subtitulos por',
      'comunidad de amara',
      'gracias por ver',
      'suscríbete',
      'suscribete',
      'suscríbanse',
      'suscribanse',
      'dale like',
      'canal de youtube',
      'transcripción por',
      'transcripcion por',
      'continuará',
      'continuara',
      '[música]',
      '[musica]',
      '(música)',
      '(musica)',
      '[silencio]',
      '(silencio)',
      '[sonido de fondo]',
      '[aplausos]',
      '[risas]',
      '♪',
      '♫',
    ];

    for (const pattern of hallucinationPatterns) {
      if (lower.includes(pattern)) {
        return '';
      }
    }

    // 3. Descartar repeticiones patológicas (ej. "sí, sí, sí, sí, sí" o "no no no no no") producidas por bucles autoregresivos
    const words = lower.split(/\s+/).filter((w) => w.length > 0);
    if (words.length >= 4) {
      const allSame = words.every((w) => w === words[0]);
      if (allSame) {
        return '';
      }
    }

    return trimmed;
  }

  static isRecording(): boolean {
    return this.isRecordingAudio;
  }

  static getStatus(): RecordingStatus {
    return this.status;
  }
}
