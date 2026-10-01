import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Variables de entorno para conexión con Supabase.
 * En Expo, las variables con prefijo EXPO_PUBLIC_ están disponibles en tiempo de ejecución.
 */
const supabaseUrl =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_URL) || '';
const supabaseAnonKey =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) || '';

/**
 * Estructura de un lugar registrado en la base de datos de Supabase.
 */
export interface UserPlaceRow {
  id: string;
  user_id: string;
  alias: string;
  display_name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: 'family' | 'home' | 'medical' | 'work' | 'leisure';
  created_at?: string;
  updated_at?: string;
}

/**
 * Cliente singleton de Supabase con almacenamiento seguro y sesión offline-first en AsyncStorage.
 * Si las variables de entorno no están configuradas, el cliente operará de forma transparente
 * y permitirá que los servicios continúen con persistencia local en AsyncStorage sin romper la app.
 */
class SupabaseService {
  private static instance: SupabaseClient | null = null;
  private static isConfiguredState: boolean = false;

  public static getClient(): SupabaseClient | null {
    if (this.instance) {
      return this.instance;
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      console.log(
        '[SupabaseClient] Variables EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY no configuradas. Operando en modo local offline.'
      );
      this.isConfiguredState = false;
      return null;
    }

    try {
      this.instance = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      });
      this.isConfiguredState = true;
      console.log('[SupabaseClient] Cliente Supabase inicializado correctamente.');
      return this.instance;
    } catch (error) {
      console.warn('[SupabaseClient] Error al inicializar cliente Supabase:', error);
      this.isConfiguredState = false;
      return null;
    }
  }

  public static isConfigured(): boolean {
    return Boolean(supabaseUrl && supabaseAnonKey && this.getClient());
  }
}

export const supabase = SupabaseService.getClient();
export const isSupabaseConfigured = () => SupabaseService.isConfigured();
export { SupabaseService };
