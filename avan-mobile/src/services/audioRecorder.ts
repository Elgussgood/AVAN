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
   * Solicita permisos de micrófono y comienza la grabación en alta calidad usando expo-audio.
   */
  static async startRecording(): Promise<boolean> {
    try {
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

      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await recorder.prepareToRecordAsync();
      recorder.record();

      this.recording = recorder;
      this.isRecordingAudio = true;
      this.status = 'recording';
      this.lastDurationMillis = 0;
      return true;
    } catch (error) {
      console.warn('Error al iniciar grabación con expo-audio:', error);
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
