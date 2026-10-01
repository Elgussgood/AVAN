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

  // Monitor VAD (Voice Activity Detection)
  private static vadInterval: ReturnType<typeof setInterval> | null = null;
  private static isSpeechDetected: boolean = false;
  private static speechStartTime: number | null = null;
  private static lastSpeechTime: number | null = null;
  private static recordingStartTime: number = 0;

  /**
   * Detiene el monitor de actividad vocal (VAD).
   */
  static stopVADMonitor(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
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

      // Configuración de umbrales y tiempos de VAD
      const isDictating = Boolean(options?.isDictatingAddress);
      const initialSilenceMs = options?.initialSilenceMs ?? 8000;
      const trailingSilenceMs = options?.trailingSilenceMs ?? (isDictating ? 2500 : 1800);
      const maxDurationMs = options?.maxDurationMs ?? (isDictating ? 25000 : 15000);
      const speechThresholdDb = options?.speechThresholdDb ?? -38;

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

        // Si metering está disponible y supera el umbral de voz
        if (typeof metering === 'number') {
          if (metering >= speechThresholdDb) {
            if (!this.isSpeechDetected) {
              this.isSpeechDetected = true;
              this.speechStartTime = now;
              console.log(`[AudioRecorderService] VAD: Habla iniciada (nivel: ${metering.toFixed(1)} dB >= ${speechThresholdDb} dB)`);
              if (options?.onSpeechDetected) {
                options.onSpeechDetected();
              }
            }
            this.lastSpeechTime = now;
          }
        }

        // Condición A: Silencio Posterior (Trailing Silence tras haber hablado)
        if (this.isSpeechDetected && this.lastSpeechTime) {
          const silenceDuration = now - this.lastSpeechTime;
          if (silenceDuration >= trailingSilenceMs) {
            console.log(`[AudioRecorderService] VAD: Silencio posterior completado (${silenceDuration}ms >= ${trailingSilenceMs}ms). Finalizando captura.`);
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
      this.stopVADMonitor();
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

      const resolvedGroqKey =
        apiKey ||
        process.env.EXPO_PUBLIC_GROQ_API_KEY ||
        process.env.GROQ_API_KEY;

      const resolvedOpenAIKey =
        process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY;

      // Si no se cuenta con API key de Groq ni OpenAI, retornamos transcripción simulada para dev
      if (!resolvedGroqKey && !resolvedOpenAIKey) {
        this.status = 'idle';
        return {
          text: 'Quiero ir al hospital general',
          durationMs,
          isSimulated: true,
        };
      }

      // Usar Groq Whisper (ultra-rápido) si está configurado, o OpenAI Whisper
      const endpoint = resolvedGroqKey
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';

      const keyToUse = resolvedGroqKey || resolvedOpenAIKey;

      // Envío con UploadTask de expo-file-system para evitar "Unsupported FormDataPart implementation"
      let uploadResult: { status: number; body: string } | null = null;

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
          },
        });

        uploadResult = await uploadTask.uploadAsync();
      } catch (uploadErr) {
        console.warn('[AudioRecorder] UploadTask error, intentando fallback con legacy uploadAsync:', uploadErr);
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
              },
            });
          }
        } catch (legacyErr) {
          console.warn('[AudioRecorder] Error en fallback legacy uploadAsync:', legacyErr);
        }
      }

      if (uploadResult && uploadResult.status >= 200 && uploadResult.status < 300) {
        const data = JSON.parse(uploadResult.body);
        console.log('[AudioRecorder] Transcripción Whisper:', data.text);
        this.status = 'idle';
        return {
          text: data.text ? data.text.trim() : '',
          durationMs,
          isSimulated: false,
        };
      } else {
        console.warn(
          'Error en respuesta de Whisper:',
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
    this.stopVADMonitor();
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

  static isRecording(): boolean {
    return this.isRecordingAudio;
  }

  static getStatus(): RecordingStatus {
    return this.status;
  }
}
