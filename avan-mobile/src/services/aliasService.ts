import AsyncStorage from '@react-native-async-storage/async-storage';
import { SupabaseService, UserPlaceRow } from './supabaseClient';

/**
 * Servicio de Gestión y Resolución de Alias para AVAN.
 *
 * Permite a adultos mayores referirse a sus destinos frecuentes con lenguaje
 * natural y afectivo (ej. "casa de mi hijo", "el doctor", "mi casa", "la farmacia").
 *
 * Arquitectura Offline-First:
 * - Persistencia local inmediata con AsyncStorage para disponibilidad sin conexión.
 * - Sincronización transparente con Supabase en la nube para permitir gestión remota
 *   por parte de familiares o cuidadores.
 */

export interface SavedAlias {
  id: string;
  alias: string; // ej. "casa de mi hijo", "el doctor", "mi casa", "la farmacia"
  name: string; // Nombre descriptivo formal
  address: string; // Dirección completa
  coordinates: { latitude: number; longitude: number };
  category?: 'family' | 'home' | 'medical' | 'work' | 'leisure';
}

export interface AliasResolutionResult {
  resolvedName: string;
  coordinates?: { latitude: number; longitude: number };
  isAlias: boolean;
  alias?: SavedAlias;
}

/**
 * Normaliza cadenas de texto para búsqueda flexible y tolerante a variaciones léxicas
 */
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita tildes
    .replace(/[¿?¡!.,;:()"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alias predeterminados realistas para adultos mayores en la Ciudad de México
 */
const DEFAULT_ALIASES: SavedAlias[] = [
  {
    id: 'alias-hijo',
    alias: 'casa de mi hijo',
    name: 'Casa de mi hijo',
    address: 'Insurgentes Sur 1602, Crédito Constructor, Benito Juárez, CDMX',
    coordinates: {
      latitude: 19.3638,
      longitude: -99.1824,
    },
    category: 'family',
  },
  {
    id: 'alias-casa',
    alias: 'mi casa',
    name: 'Mi Casa',
    address: 'Calle Durango 216, Roma Norte, Cuauhtémoc, CDMX',
    coordinates: {
      latitude: 19.4194,
      longitude: -99.1678,
    },
    category: 'home',
  },
  {
    id: 'alias-doctor',
    alias: 'el doctor',
    name: 'Consultorio Médico (Hospital Ángeles)',
    address: 'Hospital Ángeles México, Agrarismo 208, Escandón, Miguel Hidalgo, CDMX',
    coordinates: {
      latitude: 19.3985,
      longitude: -99.1764,
    },
    category: 'medical',
  },
  {
    id: 'alias-farmacia',
    alias: 'la farmacia',
    name: 'Farmacia San Pablo',
    address: 'Av. Universidad 1080, Xoco, Benito Juárez, CDMX',
    coordinates: {
      latitude: 19.3712,
      longitude: -99.1662,
    },
    category: 'medical',
  },
];

const STORAGE_KEY = '@avan_user_aliases_v1';

export class AliasService {
  private static instance: AliasService | null = null;
  private aliases: Map<string, SavedAlias> = new Map();
  private isInitialized: boolean = false;
  private isSyncing: boolean = false;

  private constructor() {
    this.preloadDefaults();
    this.initializeStorage();
  }

  /**
   * Obtiene la instancia singleton de AliasService
   */
  public static getInstance(): AliasService {
    if (!AliasService.instance) {
      AliasService.instance = new AliasService();
    }
    return AliasService.instance;
  }

  /**
   * Precarga los alias por defecto en memoria
   */
  private preloadDefaults(): void {
    DEFAULT_ALIASES.forEach((item) => {
      this.aliases.set(item.id, { ...item });
    });
  }

  /**
   * Inicializa la persistencia local desde AsyncStorage y dispara sincronización con la nube
   */
  private async initializeStorage(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: SavedAlias[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((alias) => {
            this.aliases.set(alias.id, alias);
          });
        }
      } else {
        // Primera ejecución: guardar los valores por defecto en AsyncStorage
        await this.persistToLocal();
      }
      this.isInitialized = true;

      // Disparar sincronización con Supabase en segundo plano si hay red y credenciales
      this.syncWithCloud().catch((err) => {
        console.log('[AliasService] Sincronización inicial en segundo plano pospuesta:', err);
      });
    } catch (error) {
      console.warn('[AliasService] Error al cargar alias desde AsyncStorage:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Guarda los alias actuales de memoria en AsyncStorage
   */
  private async persistToLocal(): Promise<void> {
    try {
      const list = Array.from(this.aliases.values());
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (error) {
      console.warn('[AliasService] Error al persistir alias localmente:', error);
    }
  }

  /**
   * Sincronización bidireccional con Supabase:
   * 1. Descarga lugares remotos actualizados por familiares / cuidadores.
   * 2. Sube lugares locales nuevos registrados por voz en el vehículo.
   */
  public async syncWithCloud(): Promise<void> {
    const supabase = SupabaseService.getClient();
    if (!supabase || this.isSyncing) return;

    this.isSyncing = true;
    try {
      // 1. Obtener lugares registrados en Supabase
      const { data: cloudPlaces, error } = await supabase
        .from('user_places')
        .select('*');

      if (error) {
        console.log('[AliasService] Aviso al consultar Supabase:', error.message);
        this.isSyncing = false;
        return;
      }

      if (cloudPlaces && cloudPlaces.length > 0) {
        // Fusionar lugares de la nube en la memoria local
        cloudPlaces.forEach((row: UserPlaceRow) => {
          const aliasItem: SavedAlias = {
            id: row.id,
            alias: row.alias,
            name: row.display_name,
            address: row.address,
            coordinates: {
              latitude: row.latitude,
              longitude: row.longitude,
            },
            category: row.category,
          };
          this.aliases.set(aliasItem.id, aliasItem);
        });

        // Guardar actualización en caché local
        await this.persistToLocal();
      }

      // 2. Subir alias locales que no existan en Supabase
      const localAliases = Array.from(this.aliases.values());
      for (const local of localAliases) {
        // Si el id es generado localmente (ej. "alias-hijo" o "alias-123")
        const existsInCloud = cloudPlaces?.some(
          (cp: UserPlaceRow) =>
            cp.id === local.id ||
            normalizeForSearch(cp.alias) === normalizeForSearch(local.alias)
        );

        if (!existsInCloud) {
          await supabase.from('user_places').insert([
            {
              alias: local.alias,
              display_name: local.name,
              address: local.address,
              latitude: local.coordinates.latitude,
              longitude: local.coordinates.longitude,
              category: local.category || 'family',
            },
          ]);
        }
      }
    } catch (error) {
      console.log('[AliasService] Sincronización de nube en espera de conectividad.');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Obtiene todos los alias registrados
   */
  public getAllAliases(): SavedAlias[] {
    return Array.from(this.aliases.values());
  }

  /**
   * Busca un alias por texto con normalización y coincidencia flexible.
   * Maneja variaciones comunes como "hijo", "mi hijo", "con mi hijo", "al doctor", etc.
   */
  public getAlias(aliasQuery: string): SavedAlias | undefined {
    if (!aliasQuery || !aliasQuery.trim()) return undefined;

    const normalizedQuery = normalizeForSearch(aliasQuery);

    // 1. Coincidencia exacta por ID o por alias normalizado
    for (const item of this.aliases.values()) {
      const normalizedItemAlias = normalizeForSearch(item.alias);
      if (normalizedQuery === normalizedItemAlias) {
        return item;
      }
    }

    // 2. Coincidencia eliminando partículas conversacionales comunes
    // ("ir con", "a casa de", "con", "donde", "a lo de", "a", "al", "mi", "el", "la")
    const cleanQuery = normalizedQuery
      .replace(/^(?:ir\s+con|ir\s+a|llevarme\s+con|llevame\s+con|llevame\s+a|vamos\s+con|vamos\s+a)\s+/g, '')
      .replace(/^(?:a\s+casa\s+de|casa\s+de|donde|a\s+lo\s+de)\s+/g, '')
      .replace(/^(?:a|al|en|con|de)\s+/g, '')
      .replace(/^(?:mi|mis|el|la|los|las)\s+/g, '')
      .trim();

    // Mapeos léxicos semánticos frecuentes para adultos mayores
    const synonymMap: Record<string, string> = {
      hijo: 'alias-hijo',
      'mi hijo': 'alias-hijo',
      'casa de mi hijo': 'alias-hijo',
      'casa de hijo': 'alias-hijo',
      doctor: 'alias-doctor',
      medico: 'alias-doctor',
      'el doctor': 'alias-doctor',
      'mi doctor': 'alias-doctor',
      'el medico': 'alias-doctor',
      'mi medico': 'alias-doctor',
      hospital: 'alias-doctor',
      casa: 'alias-casa',
      'mi casa': 'alias-casa',
      hogar: 'alias-casa',
      farmacia: 'alias-farmacia',
      'la farmacia': 'alias-farmacia',
      'farmacia san pablo': 'alias-farmacia',
    };

    if (synonymMap[cleanQuery]) {
      const found = this.aliases.get(synonymMap[cleanQuery]);
      if (found) return found;
    }

    if (synonymMap[normalizedQuery]) {
      const found = this.aliases.get(synonymMap[normalizedQuery]);
      if (found) return found;
    }

    // 3. Coincidencia parcial o por contención
    for (const item of this.aliases.values()) {
      const normalizedItemAlias = normalizeForSearch(item.alias);
      const normalizedName = normalizeForSearch(item.name);

      if (
        normalizedQuery.includes(normalizedItemAlias) ||
        normalizedItemAlias.includes(normalizedQuery) ||
        (cleanQuery.length > 2 && (normalizedItemAlias.includes(cleanQuery) || normalizedName.includes(cleanQuery)))
      ) {
        return item;
      }
    }

    return undefined;
  }

  /**
   * Guarda un nuevo alias o actualiza uno existente de manera persistente (Offline-First)
   * y sincroniza en segundo plano con Supabase.
   */
  public saveAlias(
    alias: string,
    name: string,
    address: string,
    coordinates: { latitude: number; longitude: number },
    category?: 'family' | 'home' | 'medical' | 'work' | 'leisure'
  ): SavedAlias {
    const existing = this.getAlias(alias);
    const id = existing ? existing.id : `alias-${Date.now()}`;
    const resolvedCat = category || this.inferCategory(alias);

    const newAlias: SavedAlias = {
      id,
      alias: alias.trim(),
      name: name.trim(),
      address: address.trim(),
      coordinates,
      category: resolvedCat,
    };

    // 1. Guardar en memoria
    this.aliases.set(id, newAlias);

    // 2. Persistir localmente en AsyncStorage
    this.persistToLocal().catch((err) => {
      console.warn('[AliasService] Error al guardar en AsyncStorage:', err);
    });

    // 3. Sincronizar con Supabase en la nube en segundo plano
    const supabase = SupabaseService.getClient();
    if (supabase) {
      (async () => {
        try {
          const { error } = await supabase.from('user_places').upsert({
            alias: newAlias.alias,
            display_name: newAlias.name,
            address: newAlias.address,
            latitude: newAlias.coordinates.latitude,
            longitude: newAlias.coordinates.longitude,
            category: newAlias.category,
          });
          if (error) {
            console.log('[AliasService] Error al sincronizar nuevo alias con Supabase:', error.message);
          } else {
            console.log('[AliasService] Alias sincronizado exitosamente con Supabase:', newAlias.alias);
          }
        } catch (err: any) {
          console.log('[AliasService] Sincronización remota pendiente de conexión:', err);
        }
      })();
    }

    return newAlias;
  }

  /**
   * Elimina un alias local y remotamente
   */
  public async deleteAlias(id: string): Promise<boolean> {
    const existed = this.aliases.delete(id);
    if (existed) {
      await this.persistToLocal();
      const supabase = SupabaseService.getClient();
      if (supabase) {
        (async () => {
          try {
            await supabase.from('user_places').delete().eq('id', id);
          } catch {}
        })();
      }
    }
    return existed;
  }

  /**
   * Resuelve si el destino solicitado corresponde a un alias registrado.
   * Si es un alias, devuelve las coordenadas y el nombre descriptivo completo.
   */
  public resolveDestinationWithAlias(query: string): AliasResolutionResult {
    const matchedAlias = this.getAlias(query);

    if (matchedAlias) {
      return {
        resolvedName: matchedAlias.name,
        coordinates: matchedAlias.coordinates,
        isAlias: true,
        alias: matchedAlias,
      };
    }

    return {
      resolvedName: query,
      isAlias: false,
    };
  }

  /**
   * Infiere la categoría según palabras clave
   */
  private inferCategory(
    alias: string
  ): 'family' | 'home' | 'medical' | 'work' | 'leisure' {
    const normalized = normalizeForSearch(alias);
    if (/hijo|hija|nieto|nieta|hermano|hermana|familia|sobrino/i.test(normalized)) {
      return 'family';
    }
    if (/casa|hogar|depa|departamento/i.test(normalized)) {
      return 'home';
    }
    if (/doctor|medico|hospital|clinica|farmacia|consultorio|salud/i.test(normalized)) {
      return 'medical';
    }
    if (/oficina|trabajo|taller/i.test(normalized)) {
      return 'work';
    }
    return 'leisure';
  }

  // ==========================================================================
  // MÉTODOS ESTÁTICOS DE CONVENIENCIA
  // ==========================================================================

  public static getAlias(aliasQuery: string): SavedAlias | undefined {
    return AliasService.getInstance().getAlias(aliasQuery);
  }

  public static saveAlias(
    alias: string,
    name: string,
    address: string,
    coordinates: { latitude: number; longitude: number },
    category?: 'family' | 'home' | 'medical' | 'work' | 'leisure'
  ): SavedAlias {
    return AliasService.getInstance().saveAlias(alias, name, address, coordinates, category);
  }

  public static resolveDestinationWithAlias(query: string): AliasResolutionResult {
    return AliasService.getInstance().resolveDestinationWithAlias(query);
  }

  public static getAllAliases(): SavedAlias[] {
    return AliasService.getInstance().getAllAliases();
  }

  public static async syncWithCloud(): Promise<void> {
    return AliasService.getInstance().syncWithCloud();
  }

  public static async deleteAlias(id: string): Promise<boolean> {
    return AliasService.getInstance().deleteAlias(id);
  }
}

export const aliasService = AliasService.getInstance();
