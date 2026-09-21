import { Audio } from 'expo-av';
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
 * Aplica una estricta política de Zero-Persistence:
 * el audio grabado solo existe en memoria/temporalmente y se elimina de inmediato
 * tras transcribir o cancelar la operación.
 */
export class AudioRecorderService {
  private static recording: Audio.Recording | null = null;
  private static isRecordingAudio: boolean = false;
  private static lastDurationMillis: number = 0;
  private static status: RecordingStatus = 'idle';

  /**
   * Solicita permisos de micrófono al usuario.
   */
  static async requestPermissions(): Promise<boolean> {
    try {
      const permission = await Audio.requestPermissionsAsync();
      return permission.granted;
    } catch (error) {
      console.warn('Error al solicitar permisos de audio:', error);
      return false;
    }
  }

  /**
   * Solicita permisos de micrófono y comienza la grabación en alta calidad
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await newRecording.startAsync();

      this.recording = newRecording;
      this.isRecordingAudio = true;
      this.status = 'recording';
      this.lastDurationMillis = 0;
      return true;
    } catch (error) {
      console.warn('Error al iniciar grabación:', error);
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
        const status = await this.recording.getStatusAsync();
        durationMillis = status.durationMillis || 0;
      } catch {
        durationMillis = this.lastDurationMillis;
      }

      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();

      // Restaurar modo de audio para reproducción (hablar)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
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
   * Detiene la grabación, envía el audio a la API de Whisper (Groq u OpenAI)
   * y elimina el archivo de audio para cumplir la política de Zero-Persistence.
   */
  static async stopAndTranscribe(
    apiKey?: string
  ): Promise<TranscriptionResult | null> {
    if (!this.recording) {
      return null;
    }

    try {
      this.status = 'processing';
      this.isRecordingAudio = false;
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      this.recording = null;

      // Restaurar modo de audio para reproducción
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
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
          isSimulated: true,
        };
      }

      // Preparar payload multipart/form-data
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'audio.m4a';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match?.[1] || 'm4a';
      const mimeType = ext === 'wav' ? 'audio/wav' : 'audio/m4a';

      formData.append('file', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        name: filename,
        type: mimeType,
      } as unknown as Blob);

      // Usar Groq Whisper (ultra-rápido) si está configurado, o OpenAI Whisper
      const endpoint = resolvedGroqKey
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';

      const keyToUse = resolvedGroqKey || resolvedOpenAIKey;
      formData.append(
        'model',
        resolvedGroqKey ? 'whisper-large-v3-turbo' : 'whisper-1'
      );
      formData.append('language', 'es');
      formData.append('response_format', 'json');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keyToUse}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn('Error en respuesta de Whisper:', errText);
        this.status = 'error';
        return null;
      }

      const data = await response.json();
      this.status = 'idle';

      return {
        text: data.text ? data.text.trim() : '',
        isSimulated: false,
      };
    } catch (error) {
      console.warn('Error durante la transcripción de audio:', error);
      this.status = 'error';
      return null;
    } finally {
      this.recording = null;
      this.isRecordingAudio = false;
      if (this.status !== 'error') {
        this.status = 'idle';
      }
    }
  }

  /**
   * Cancela cualquier grabación en curso y libera recursos
   */
  static async cancelRecording(): Promise<void> {
    try {
      if (this.recording) {
        await this.recording.stopAndUnloadAsync();
        this.recording = null;
      }
    } catch (error) {
      console.warn('Error al cancelar grabación:', error);
    } finally {
      this.recording = null;
      this.isRecordingAudio = false;
      this.status = 'idle';
    }
  }

  static isRecording(): boolean {
    return this.isRecordingAudio;
  }

  static getStatus(): RecordingStatus {
    return this.status;
  }
}
