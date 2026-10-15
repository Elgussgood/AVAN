/**
 * Servicio de OpenRouteService (ORS) para AVAN.
 * Proporciona geocodificación de destinos en lenguaje natural y
 * cálculo de rutas vehiculares con polilínea e instrucciones turn-by-turn.
 * Incluye un fallback realista y dinámico para desarrollo y modo sin conexión.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type GeocodePrecision = 'exact' | 'street' | 'interpolated' | 'approximate';

export interface StructuredAddressQuery {
  street: string;
  houseNumber?: string;
  colonia?: string;
  alcaldia?: string;
  crossStreet?: string;
  city?: string;
  state?: string;
  rawQuery?: string;
}

export interface GeocodeResult {
  id: string;
  name: string;
  label: string;
  coordinates: Coordinates;
  distanceMeters?: number;
  precision?: GeocodePrecision;
  isFallback?: boolean;
}

export interface DisambiguationCandidate {
  id: string;
  name: string;
  label: string;
  colonia_o_alcaldia: string;
  landmarkRef?: string;
  landmarkType?: 'metro' | 'metrobus' | 'parque' | 'hospital' | 'museo' | 'monumento' | 'lugar';
  coordinates: Coordinates;
  distanceMeters?: number;
  precision?: GeocodePrecision;
}

export interface DisambiguationResult {
  isAmbiguous: boolean;
  candidates: DisambiguationCandidate[];
}

export interface StepInstruction {
  instruction: string;
  distance: number; // Metros
  duration: number; // Segundos
  type: number; // Código de maniobra de ORS
  modifier?: number;
  name: string;
  wayPoints: [number, number]; // Índices [inicio, fin] dentro de coordinates[]
}

export interface RouteResult {
  coordinates: Coordinates[];
  distance: number; // Metros totales
  duration: number; // Segundos totales
  steps: StepInstruction[];
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  isFallback?: boolean;
}

import { CDMX_TRANSPORT_POIS } from '../data/cdmxTransportPois';
import { AliasService } from './aliasService';

// Destinos predefinidos y puntos de interés de referencia en CDMX y área metropolitana
const FALLBACK_DESTINATIONS: (GeocodeResult & { keywords: string[] })[] = [
  {
    id: 'poi-bellas-artes',
    name: 'Palacio de Bellas Artes',
    label: 'Av. Juárez S/N, Centro Histórico, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4352, longitude: -99.1412 },
    keywords: ['bellas artes', 'palacio de bellas artes', 'teatro bellas artes', 'alameda'],
  },
  {
    id: 'poi-angel',
    name: 'Ángel de la Independencia',
    label: 'Paseo de la Reforma y Eje 2 Pte, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.427025, longitude: -99.167665 },
    keywords: ['angel', 'ángel', 'independencia', 'reforma', 'paseo de la reforma'],
  },
  {
    id: 'poi-zocalo',
    name: 'Plaza de la Constitución / Zócalo',
    label: 'Plaza de la Constitución S/N, Centro Histórico, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4326, longitude: -99.1332 },
    keywords: ['zocalo', 'zócalo', 'constitucion', 'catedral', 'palacio nacional', 'centro historico'],
  },
  {
    id: 'poi-alameda',
    name: 'Alameda Central',
    label: 'Av. Hidalgo S/N, Centro Histórico, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4359, longitude: -99.1439 },
    keywords: ['alameda', 'alameda central', 'hidalgo', 'hemiciclo a juarez'],
  },
  {
    id: 'poi-chapultepec',
    name: 'Bosque de Chapultepec / Castillo',
    label: 'Bosque de Chapultepec I Sección, Miguel Hidalgo, Ciudad de México',
    coordinates: { latitude: 19.4204, longitude: -99.1819 },
    keywords: ['chapultepec', 'castillo de chapultepec', 'bosque chapultepec', 'lago chapultepec'],
  },
  {
    id: 'poi-auditorio',
    name: 'Auditorio Nacional',
    label: 'Paseo de la Reforma 50, Bosque de Chapultepec, Miguel Hidalgo, Ciudad de México',
    coordinates: { latitude: 19.4258, longitude: -99.1918 },
    keywords: ['auditorio', 'auditorio nacional', 'reforma 50'],
  },
  {
    id: 'poi-soumaya',
    name: 'Museo Soumaya / Polanco',
    label: 'Blvd. Miguel de Cervantes Saavedra 303, Granada, Miguel Hidalgo, Ciudad de México',
    coordinates: { latitude: 19.4407, longitude: -99.2047 },
    keywords: ['soumaya', 'museo soumaya', 'plaza carso', 'granada', 'polanco'],
  },
  {
    id: 'poi-parque-mexico',
    name: 'Parque México / Condesa',
    label: 'Av. México S/N, Hipódromo Condesa, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4124, longitude: -99.1697 },
    keywords: ['parque mexico', 'parque méxico', 'condesa', 'hipodromo', 'amsterdam'],
  },
  {
    id: 'poi-siglo-xxi',
    name: 'Centro Médico Nacional Siglo XXI',
    label: 'Av. Cuauhtémoc 330, Doctores, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4069, longitude: -99.1558 },
    keywords: ['siglo xxi', 'centro medico', 'imss', 'hospital siglo xxi', 'doctores'],
  },
  {
    id: 'poi-hospital-general',
    name: 'Hospital General de México Dr. Eduardo Liceaga',
    label: 'Dr. Balmis 148, Doctores, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4124, longitude: -99.1537 },
    keywords: ['hospital general', 'dr balmis', 'liceaga'],
  },
  {
    id: 'poi-basilica',
    name: 'Basílica de Santa María de Guadalupe',
    label: 'Fray Juan de Zumárraga 2, Villa Gustavo A. Madero, Gustavo A. Madero, Ciudad de México',
    coordinates: { latitude: 19.4847, longitude: -99.1175 },
    keywords: ['basilica', 'basílica', 'guadalupe', 'la villa', 'tepeyac'],
  },
  {
    id: 'poi-unam',
    name: 'Ciudad Universitaria (UNAM)',
    label: 'Av. Universidad 3000, Coyoacán, Ciudad de México',
    coordinates: { latitude: 19.3328, longitude: -99.1868 },
    keywords: ['unam', 'ciudad universitaria', 'rectoria', 'estadio olimpico', 'cu'],
  },
  {
    id: 'poi-escom',
    name: 'ESCOM - Escuela Superior de Cómputo IPN',
    label: 'Av. Juan de Dios Bátiz S/N, Nueva Industrial Vallejo, Gustavo A. Madero, Ciudad de México',
    coordinates: { latitude: 19.5046, longitude: -99.1468 },
    keywords: ['escom', 'escuela superior de computo', 'ipn escom', 'computo ipn'],
  },
  {
    id: 'poi-zacatenco',
    name: 'Unidad Profesional Adolfo López Mateos (IPN Zacatenco)',
    label: 'Av. Wilfrido Massieu S/N, Lindavista, Gustavo A. Madero, Ciudad de México',
    coordinates: { latitude: 19.5034, longitude: -99.1357 },
    keywords: ['zacatenco', 'ipn zacatenco', 'poli zacatenco', 'cinvestav'],
  },
  {
    id: 'poi-coyoacan',
    name: 'Jardín Hidalgo / Coyoacán Centro',
    label: 'Jardín Hidalgo 1, Coyoacán Centro, Coyoacán, Ciudad de México',
    coordinates: { latitude: 19.3497, longitude: -99.1623 },
    keywords: ['coyoacan', 'coyoacán', 'jardin hidalgo', 'parque centenario', 'plaza hidalgo'],
  },
  {
    id: 'poi-wtc',
    name: 'World Trade Center (WTC México)',
    label: 'Montecito 38, Nápoles, Benito Juárez, Ciudad de México',
    coordinates: { latitude: 19.3939, longitude: -99.1738 },
    keywords: ['wtc', 'world trade center', 'montecito', 'napoles', 'nápoles'],
  },
  {
    id: 'poi-satelite',
    name: 'Plaza Satélite',
    label: 'Cto. Centro Comercial 2251, Ciudad Satélite, Naucalpan de Juárez, Estado de México',
    coordinates: { latitude: 19.5104, longitude: -99.2346 },
    keywords: ['plaza satelite', 'plaza satélite', 'satelite', 'satélite', 'torres de satelite'],
  },
  {
    id: 'poi-revolucion',
    name: 'Monumento a la Revolución',
    label: 'Plaza de la República S/N, Tabacalera, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4362, longitude: -99.1546 },
    keywords: ['monumento a la revolucion', 'monumento revolucion', 'plaza de la republica'],
  },
  {
    id: 'poi-parque-hundido',
    name: 'Parque Hundido / Extremadura',
    label: 'Av. Insurgentes Sur S/N, Extremadura Insurgentes, Benito Juárez, Ciudad de México',
    coordinates: { latitude: 19.3789, longitude: -99.1788 },
    keywords: ['parque hundido', 'extremadura', 'insurgentes parque hundido'],
  },
  {
    id: 'poi-aicm',
    name: 'Aeropuerto Internacional de la Ciudad de México (AICM)',
    label: 'Av. Capitán Carlos León S/N, Peñón de los Baños, Venustiano Carranza, Ciudad de México',
    coordinates: { latitude: 19.4361, longitude: -99.0719 },
    keywords: ['aeropuerto', 'aicm', 'terminal 1', 'terminal 2', 'aeropuerto cdmx'],
  },
  {
    id: 'poi-hospital-espanol',
    name: 'Hospital Español de México',
    label: 'Av. Ejército Nacional 613, Granada, Miguel Hidalgo, Ciudad de México',
    coordinates: { latitude: 19.4385, longitude: -99.1866 },
    keywords: ['hospital espanol', 'hospital español', 'ejercito nacional'],
  },
  {
    id: 'poi-hospital-angeles-pedregal',
    name: 'Hospital Ángeles del Pedregal',
    label: 'Camino a Santa Teresa 1055, Héroes de Padierna, La Magdalena Contreras, Ciudad de México',
    coordinates: { latitude: 19.3094, longitude: -99.2144 },
    keywords: ['angeles pedregal', 'ángeles pedregal', 'hospital angeles', 'hospital ángeles'],
  },
];

/**
 * Traduce maniobras de OSRM a instrucciones en español natural para AVAN.
 */
function translateOsrmManeuver(m: any, streetName: string, isFirstStep?: boolean): { instruction: string; type: number } {
  const typeStr = m?.type || '';
  const modifier = m?.modifier || '';
  const targetStreet = streetName ? `"${streetName}"` : 'la vía principal';

  if (typeStr === 'depart' || (isFirstStep && typeStr === 'arrive')) {
    return {
      instruction: streetName ? `Inicie su recorrido por ${targetStreet}` : 'Inicie su recorrido por la ruta indicada',
      type: 11, // Depart
    };
  }
  if (typeStr === 'arrive') {
    return {
      instruction: 'Ha llegado a su destino',
      type: 10, // Arrive
    };
  }
  if (typeStr === 'roundabout' || typeStr === 'rotary') {
    return {
      instruction: `En la rotonda, tome la salida hacia ${targetStreet}`,
      type: 7, // Roundabout
    };
  }
  if (modifier === 'uturn') {
    return {
      instruction: `Dé vuelta en U hacia ${targetStreet}`,
      type: 9, // U-turn
    };
  }
  if (modifier.includes('right')) {
    const isSlight = modifier.includes('slight');
    const isSharp = modifier.includes('sharp');
    return {
      instruction: isSharp
        ? `Gire pronunciadamente a la derecha en ${targetStreet}`
        : isSlight
        ? `Gire levemente a la derecha hacia ${targetStreet}`
        : `Gire a la derecha en ${targetStreet}`,
      type: 1, // Turn right
    };
  }
  if (modifier.includes('left')) {
    const isSlight = modifier.includes('slight');
    const isSharp = modifier.includes('sharp');
    return {
      instruction: isSharp
        ? `Gire pronunciadamente a la izquierda en ${targetStreet}`
        : isSlight
        ? `Gire levemente a la izquierda hacia ${targetStreet}`
        : `Gire a la izquierda en ${targetStreet}`,
      type: 0, // Turn left
    };
  }
  if (modifier === 'straight' || typeStr === 'continue' || typeStr === 'new name') {
    return {
      instruction: streetName ? `Continúe recto por ${targetStreet}` : 'Continúe recto por la vía',
      type: 6, // Straight
    };
  }
  if (typeStr === 'on ramp' || typeStr === 'merge') {
    return {
      instruction: `Incorpórese a ${targetStreet}`,
      type: 6,
    };
  }
  if (typeStr === 'off ramp' || typeStr === 'fork') {
    return {
      instruction: modifier.includes('left')
        ? `Tome la salida a la izquierda hacia ${targetStreet}`
        : `Tome la salida a la derecha hacia ${targetStreet}`,
      type: modifier.includes('left') ? 0 : 1,
    };
  }
  if (typeStr === 'end of road') {
    return {
      instruction: modifier.includes('left')
        ? `Al final de la calle, gire a la izquierda en ${targetStreet}`
        : `Al final de la calle, gire a la derecha en ${targetStreet}`,
      type: modifier.includes('left') ? 0 : 1,
    };
  }

  return {
    instruction: streetName ? `Continúe hacia ${targetStreet}` : 'Continúe recto por la ruta',
    type: 6,
  };
}

export function computeDistanceMeters(coord1: Coordinates, coord2: Coordinates): number {
  const R = 6371e3;
  const φ1 = (coord1.latitude * Math.PI) / 180;
  const φ2 = (coord2.latitude * Math.PI) / 180;
  const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
  const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function findNearestLandmark(coords: Coordinates): {
  name: string;
  type: 'metro' | 'metrobus' | 'parque' | 'hospital' | 'museo' | 'monumento' | 'lugar';
  distanceMeters: number;
} | null {
  let nearest: { name: string; type: any; distanceMeters: number } | null = null;
  let minDistance = 2500; // Máximo 2.5 km

  // 1. Revisar estaciones de transporte masivo (Metro / Metrobús)
  for (const poi of CDMX_TRANSPORT_POIS) {
    const dist = computeDistanceMeters(coords, poi.coordinates);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = {
        name: poi.name,
        type: poi.type === 'metro' ? 'metro' : poi.type === 'metrobus' ? 'metrobus' : 'lugar',
        distanceMeters: dist,
      };
    }
  }

  // 2. Revisar POIs emblemáticos y culturales
  for (const poi of FALLBACK_DESTINATIONS) {
    const dist = computeDistanceMeters(coords, poi.coordinates);
    if (dist < minDistance) {
      minDistance = dist;
      let landmarkType: any = 'lugar';
      const lower = poi.name.toLowerCase();
      if (lower.includes('parque') || lower.includes('alameda') || lower.includes('bosque')) {
        landmarkType = 'parque';
      } else if (lower.includes('hospital') || lower.includes('médico') || lower.includes('medico')) {
        landmarkType = 'hospital';
      } else if (lower.includes('museo') || lower.includes('bellas artes')) {
        landmarkType = 'museo';
      } else if (lower.includes('ángel') || lower.includes('angel') || lower.includes('monumento')) {
        landmarkType = 'monumento';
      }
      nearest = {
        name: poi.name,
        type: landmarkType,
        distanceMeters: dist,
      };
    }
  }

  return nearest;
}

export function extractZoneFromLabel(label: string): string {
  const parts = label.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'Ciudad de México';

  const conocidas = [
    'Coyoacán', 'Cuauhtémoc', 'Benito Juárez', 'Miguel Hidalgo', 'Tlalpan',
    'Gustavo A. Madero', 'Álvaro Obregón', 'Iztapalapa', 'Venustiano Carranza',
    'Azcapotzalco', 'Iztacalco', 'Xochimilco', 'Cuajimalpa', 'Tláhuac',
    'Magdalena Contreras', 'Milpa Alta', 'Naucalpan', 'Tlalnepantla', 'Ecatepec',
    'Huixquilucan', 'Nezahualcóyotl', 'Centro Histórico', 'Roma Norte', 'Condesa',
    'Polanco', 'Del Valle', 'Narvarte', 'Nápoles', 'Lindavista', 'Santa Fe'
  ];

  for (const p of parts) {
    for (const c of conocidas) {
      if (p.toLowerCase().includes(c.toLowerCase())) {
        return c;
      }
    }
  }

  if (parts.length >= 3) {
    return parts[1] || parts[parts.length - 2] || parts[0];
  }
  return parts[1] || parts[0];
}

/**
 * Parsea una consulta en lenguaje natural o estandariza un objeto estructurado,
 * identificando calle, número predial, colonia, alcaldía, ciudad y cruce vial.
 */
export function parseStructuredAddress(
  input: string | StructuredAddressQuery
): StructuredAddressQuery {
  if (typeof input === 'object' && input !== null) {
    return {
      street: input.street || '',
      houseNumber: input.houseNumber,
      colonia: input.colonia,
      alcaldia: input.alcaldia,
      crossStreet: input.crossStreet,
      city: input.city || 'Ciudad de México',
      state: input.state,
      rawQuery: input.rawQuery || input.street,
    };
  }

  const raw = (input || '').trim();
  let street = '';
  let houseNumber: string | undefined;
  let colonia: string | undefined;
  let alcaldia: string | undefined;
  let crossStreet: string | undefined;

  // 1. Extraer cruce vial o intersección (ej. "esquina con Monterrey", "casi esquina con Ámsterdam", "cruce con Insurgentes")
  const crossMatch = raw.match(
    /(?:casi\s+esquina\s+con|esquina\s+con|cruce\s+con|esq\.?\s+con|esq\.?)\s+([^,]+)/i
  );
  if (crossMatch) {
    crossStreet = crossMatch[1].trim();
  }

  let textWithoutCross = raw.replace(
    /(?:casi\s+esquina\s+con|esquina\s+con|cruce\s+con|esq\.?\s+con|esq\.?)\s+[^,]+/gi,
    ''
  );

  // 2. Extraer número exterior (ej. "120", "número 1422", "# 10")
  // Priorizar indicador explícito ("número 10", "no. 1422", "# 150")
  const explicitNumMatch = textWithoutCross.match(
    /(?:n[uú]mero|no\.?|num\.?|#)\s*(\b\d{1,5}[a-zA-Z]?\b)/i
  );
  if (explicitNumMatch) {
    houseNumber = explicitNumMatch[1];
  } else {
    // Si no hay prefijo explícito, proteger nombres de calles que contienen números o fechas
    // (ej: "5 de Mayo", "16 de Septiembre", "20 de Noviembre", "Eje 1 Norte")
    const protectedDateStreetsRegex = /\b(?:\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|eje\s+\d+)\b/i;
    let textToFindNum = textWithoutCross;
    if (protectedDateStreetsRegex.test(textWithoutCross)) {
      textToFindNum = textWithoutCross.replace(protectedDateStreetsRegex, '');
    }
    const numMatch = textToFindNum.match(/\b(\d{1,5}[a-zA-Z]?)\b/);
    if (numMatch) {
      houseNumber = numMatch[1];
    }
  }

  // 3. Extraer colonia
  const colMatch = textWithoutCross.match(/(?:colonia|col\.?)\s+([^,]+)/i);
  if (colMatch) {
    colonia = colMatch[1].trim();
  } else {
    const knownColonias = [
      'Roma Norte', 'Roma Sur', 'Roma', 'Condesa', 'Hipódromo Condesa', 'Hipódromo',
      'Del Valle', 'Del Valle Norte', 'Del Valle Sur', 'Narvarte', 'Narvarte Poniente',
      'Polanco', 'Juárez', 'Cuauhtémoc', 'Centro Histórico', 'Centro', 'Coyoacán',
      'San Ángel', 'Nápoles', 'Santa Fe', 'Doctores', 'Anzures', 'San Rafael',
      'Portales', 'Álamos', 'Lindavista', 'Industrial', 'Escandón', 'Tabacalera',
      'Granada', 'Irrigación', 'Tacubaya', 'Mixcoac'
    ];
    for (const c of knownColonias) {
      const regex = new RegExp(`\\b${c}\\b`, 'i');
      if (regex.test(textWithoutCross)) {
        colonia = c;
        break;
      }
    }
  }

  // 4. Extraer alcaldía si se menciona explícitamente
  const knownAlcaldias = [
    'Cuauhtémoc', 'Benito Juárez', 'Miguel Hidalgo', 'Coyoacán', 'Tlalpan',
    'Gustavo A. Madero', 'Álvaro Obregón', 'Iztapalapa', 'Venustiano Carranza',
    'Azcapotzalco', 'Iztacalco', 'Xochimilco', 'Cuajimalpa', 'Tláhuac',
    'Magdalena Contreras', 'Milpa Alta', 'Naucalpan', 'Tlalnepantla'
  ];
  for (const alc of knownAlcaldias) {
    const regex = new RegExp(`\\b${alc}\\b`, 'i');
    if (regex.test(textWithoutCross)) {
      alcaldia = alc;
      break;
    }
  }

  // 5. Extraer nombre de la calle
  let streetCand = textWithoutCross;
  if (colonia) {
    streetCand = streetCand.replace(new RegExp(`(?:colonia|col\.?|en la|en el|por la)?\\s*${colonia}`, 'i'), '');
  }
  if (alcaldia) {
    streetCand = streetCand.replace(new RegExp(`(?:alcald[ií]a|municipio)?\\s*${alcaldia}`, 'i'), '');
  }
  if (houseNumber) {
    const isPartOfDate = new RegExp(`\\b${houseNumber}\\s+de\\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\\b`, 'i').test(streetCand);
    if (!isPartOfDate) {
      streetCand = streetCand.replace(new RegExp(`(?:(?:n[uú]mero|no\.?|num\.?|#)\\s*)?${houseNumber}\\b`, 'i'), '');
    } else {
      streetCand = streetCand.replace(new RegExp(`(?:n[uú]mero|no\.?|num\.?|#)\\s*${houseNumber}\\b`, 'i'), '');
    }
  }
  streetCand = streetCand
    .replace(/^(?:en\s+|por\s+|calle\s+|avenida\s+|av\.?\s+|calzada\s+)+/i, '')
    .replace(/(?:,\s*ciudad de m[eé]xico|,\s*cdmx)/i, '')
    .replace(/[,\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (streetCand.length > 1) {
    street = streetCand;
  } else {
    const parts = raw.split(',')[0].trim();
    street = parts;
  }

  return {
    street,
    houseNumber,
    colonia,
    alcaldia,
    crossStreet,
    city: 'Ciudad de México',
    rawQuery: raw,
  };
}

export class OpenRouteService {
  private apiKey: string;
  private baseUrl = 'https://api.openrouteservice.org';

  private static readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
  private static readonly MAX_CACHE_ENTRIES = 120;
  private static geocodeCache = new Map<string, { data: GeocodeResult[]; timestamp: number }>();
  private static reverseCache = new Map<string, { data: GeocodeResult; timestamp: number }>();

  public static getFromCache<T>(cache: Map<string, { data: T; timestamp: number }>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > OpenRouteService.CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    // Refrescar orden en caché LRU (eliminar e insertar al final)
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
  }

  public static setInCache<T>(cache: Map<string, { data: T; timestamp: number }>, key: string, data: T): void {
    if (cache.size >= OpenRouteService.MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(key, { data, timestamp: Date.now() });
  }

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.EXPO_PUBLIC_ORS_API_KEY || '';
  }

  /**
   * Permite actualizar la clave de API en tiempo de ejecución.
   */
  public setApiKey(key: string): void {
    this.apiKey = key.trim();
  }

  /**
   * Obtiene candidatos de geocodificación y detecta si existe ambigüedad multilocación
   * separada por más de 2.5 km. Enriquece cada candidato con el Landmark o estación de transporte más cercana
   * y conserva la precisión obtenida.
   */
  public async getDisambiguationCandidates(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates,
    maxCandidates = 3
  ): Promise<DisambiguationResult> {
    const rawResults = await this.geocodeDestination(query, userLocation);
    if (!rawResults || rawResults.length === 0) {
      return { isAmbiguous: false, candidates: [] };
    }

    // Filtrar duplicados geográficos muy cercanos (<1000m)
    const uniqueCandidates: GeocodeResult[] = [];
    for (const r of rawResults) {
      const isDuplicate = uniqueCandidates.some(
        (existing) => computeDistanceMeters(existing.coordinates, r.coordinates) < 1000
      );
      if (!isDuplicate) {
        uniqueCandidates.push(r);
      }
    }

    if (uniqueCandidates.length <= 1) {
      const single = uniqueCandidates[0] || rawResults[0];
      const zone = extractZoneFromLabel(single.label);
      const landmark = findNearestLandmark(single.coordinates);
      return {
        isAmbiguous: false,
        candidates: [
          {
            id: single.id,
            name: single.name,
            label: single.label,
            colonia_o_alcaldia: zone,
            landmarkRef: landmark?.name,
            landmarkType: landmark?.type,
            coordinates: single.coordinates,
            distanceMeters: userLocation ? computeDistanceMeters(userLocation, single.coordinates) : undefined,
            precision: single.precision,
          },
        ],
      };
    }

    // Comprobar si hay dispersión geográfica (>2500m entre al menos 2 candidatos)
    let maxSeparation = 0;
    for (let i = 0; i < uniqueCandidates.length; i++) {
      for (let j = i + 1; j < uniqueCandidates.length; j++) {
        const sep = computeDistanceMeters(uniqueCandidates[i].coordinates, uniqueCandidates[j].coordinates);
        if (sep > maxSeparation) {
          maxSeparation = sep;
        }
      }
    }

    const isAmbiguous = maxSeparation > 2500;
    const candidatesToReturn = uniqueCandidates.slice(0, maxCandidates).map((r) => {
      const zone = extractZoneFromLabel(r.label);
      const landmark = findNearestLandmark(r.coordinates);
      const dist = userLocation ? computeDistanceMeters(userLocation, r.coordinates) : undefined;
      return {
        id: r.id,
        name: r.name,
        label: r.label,
        colonia_o_alcaldia: zone,
        landmarkRef: landmark ? landmark.name : undefined,
        landmarkType: landmark ? landmark.type : undefined,
        coordinates: r.coordinates,
        distanceMeters: dist,
        precision: r.precision,
      };
    });

    return {
      isAmbiguous,
      candidates: candidatesToReturn,
    };
  }

  /**
   * Geocodifica un destino en lenguaje natural o estructurado (ej. "Reforma", "Bellas Artes", "Sonora 120, Roma Norte").
   * Estrategia Multi-Tier Resiliente con Degeneración Progresiva:
   *  Tier 0: Catálogo curado de puntos de interés y landmarks emblemáticos de CDMX (0ms, 100% exacto)
   *  Tier 1: OpenRouteService con boundary.circle metropolitano (65km) y layers=address,street,venue
   *  Tier 2: OpenStreetMap Nominatim estructurado con relajación progresiva a nivel tramo de calle en colonia
   *  Tier 3: Photon API de Komoot (OSM global, gratis, sin API key, con bias CDMX)
   *  Tier 4: Fallback aproximado
   */
  public async geocodeDestination(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const structured = parseStructuredAddress(query);
    const trimmed = (
      structured.rawQuery ||
      [structured.street, structured.houseNumber, structured.colonia, structured.city]
        .filter(Boolean)
        .join(', ')
    ).trim();

    if (!trimmed && !structured.street) {
      return [];
    }

    // 1. TIER 0: Búsqueda inmediata en el Catálogo Curado de Alta Fidelidad
    const cacheKey = `${trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}_${userLocation ? `${userLocation.latitude.toFixed(2)},${userLocation.longitude.toFixed(2)}` : 'cdmx'}`;
    const cached = OpenRouteService.getFromCache(OpenRouteService.geocodeCache, cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    // TIER 0A: Comprobar si corresponde a un alias registrado por el usuario
    const queryForAlias = trimmed || structured.street || '';
    if (queryForAlias) {
      const aliasMatch = AliasService.resolveDestinationWithAlias(queryForAlias);
      if (aliasMatch.isAlias && aliasMatch.coordinates) {
        const aliasResult: GeocodeResult = {
          id: aliasMatch.alias?.id || 'alias-resolved',
          name: aliasMatch.resolvedName,
          label: `${aliasMatch.resolvedName} - ${aliasMatch.alias?.address || 'Ubicación guardada'}`,
          coordinates: aliasMatch.coordinates,
          precision: 'exact',
        };
        OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, [aliasResult]);
        return [aliasResult];
      }
    }

    const catalogResults = this.searchFallbackDestinations(trimmed);
    if (catalogResults.length > 0) {
      OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, catalogResults);
      return catalogResults;
    }
    if (structured.street && structured.street !== trimmed) {
      const catalogStreetResults = this.searchFallbackDestinations(structured.street);
      if (catalogStreetResults.length > 0) {
        OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, catalogStreetResults);
        return catalogStreetResults;
      }
    }

    // 2. Concurrencia de baja latencia: Ejecución en paralelo de ORS (Tier 1) y Photon (Tier 3)
    const apiTasks: Promise<{ source: string; results: GeocodeResult[] }>[] = [];
    if (this.apiKey) {
      apiTasks.push(
        this.geocodeWithORS(structured, userLocation)
          .then((results) => ({ source: 'ors', results: results || [] }))
          .catch((err) => {
            console.warn('[orsService] Error en geocodificación ORS:', err);
            return { source: 'ors', results: [] };
          })
      );
    }
    apiTasks.push(
      this.geocodeWithPhoton(structured, userLocation)
        .then((results) => ({ source: 'photon', results: results || [] }))
        .catch((err) => {
          console.warn('[orsService] Error en geocodificación Photon:', err);
          return { source: 'photon', results: [] };
        })
    );

    const apiResponses = await Promise.all(apiTasks);
    const orsMatch = apiResponses.find((r) => r.source === 'ors')?.results || [];
    const photonMatch = apiResponses.find((r) => r.source === 'photon')?.results || [];

    // Validar si ORS devolvió resultados conformes a la colonia (o sin colonia restrictiva)
    if (orsMatch.length > 0) {
      if (structured.colonia) {
        const expectedColonia = structured.colonia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const labelNorm = orsMatch[0].label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (labelNorm.includes(expectedColonia)) {
          OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, orsMatch);
          return orsMatch;
        }
        // Si ORS ignoró la colonia, continuar a Nominatim
      } else {
        OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, orsMatch);
        return orsMatch;
      }
    }

    // Si Photon encontró resultado de precisión exacta respetando la colonia
    if (photonMatch.length > 0 && photonMatch[0].precision === 'exact') {
      if (structured.colonia) {
        const expectedColonia = structured.colonia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const labelNorm = photonMatch[0].label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (labelNorm.includes(expectedColonia)) {
          OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, photonMatch);
          return photonMatch;
        }
      } else {
        OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, photonMatch);
        return photonMatch;
      }
    }

    // 3. TIER 2: OpenStreetMap Nominatim con delimitación por viewbox y relajación progresiva
    try {
      const nominatimResults = await this.geocodeWithNominatim(structured, userLocation);
      if (nominatimResults && nominatimResults.length > 0) {
        OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, nominatimResults);
        return nominatimResults;
      }
    } catch (err) {
      console.warn('[orsService] Error en geocodificación Nominatim:', err);
    }

    // 4. Si Nominatim no encontró coincidencias pero Photon devolvió resultados a nivel de calle
    if (photonMatch.length > 0) {
      OpenRouteService.setInCache(OpenRouteService.geocodeCache, cacheKey, photonMatch);
      return photonMatch;
    }

    // 5. Fallback seguro: Si no hubo red ni coincidencias
    const baseLat = userLocation?.latitude ?? 19.4326;
    const baseLng = userLocation?.longitude ?? -99.1332;

    return [
      {
        id: `approx-${Date.now()}`,
        name: trimmed,
        label: `${trimmed}, Ciudad de México`,
        coordinates: {
          latitude: baseLat,
          longitude: baseLng,
        },
        precision: 'approximate',
      },
    ];
  }

  /**
   * Geocodificación vía OpenRouteService oficial con delimitación geográfica y filtro de capas
   */
  private async geocodeWithORS(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const structured = typeof query === 'string' ? parseStructuredAddress(query) : query;
    const centerLat = userLocation?.latitude ?? 19.4326;
    const centerLon = userLocation?.longitude ?? -99.1332;

    const queryString = structured.houseNumber
      ? `${structured.street} ${structured.houseNumber}, ${structured.colonia ? structured.colonia + ', ' : ''}Ciudad de México`
      : structured.colonia
      ? `${structured.street}, ${structured.colonia}, Ciudad de México`
      : structured.rawQuery || structured.street;

    const isForaneoQuery = /(?:acapulco|cuernavaca|puebla|toluca|pachuca|queretaro|guadalajara|monterrey|cancun|veracruz|oaxaca|merida|leon|guanajuato|morelia|san luis|hidalgo|morelos|jalisco|nuevo leon)/i.test(queryString);

    // Intento 1: Búsqueda con círculo metropolitano (65km) y capas address,street,venue
    if (!isForaneoQuery) {
      try {
        const localParams = new URLSearchParams({
          api_key: this.apiKey,
          text: queryString,
          size: '5',
          layers: 'address,street,venue',
          'boundary.country': 'MEX',
          'boundary.circle.lat': centerLat.toString(),
          'boundary.circle.lon': centerLon.toString(),
          'boundary.circle.radius': '65',
          'focus.point.lat': centerLat.toString(),
          'focus.point.lon': centerLon.toString(),
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const response = await fetch(
          `${this.baseUrl}/geocode/search?${localParams.toString()}`,
          {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.features && Array.isArray(data.features) && data.features.length > 0) {
            return this.parsePeliasFeatures(data.features, queryString);
          }
        }
      } catch (err) {
        console.warn('[orsService] Fallo búsqueda local con círculo en ORS:', err);
      }
    }

    // Intento 2: Búsqueda nacional con focus.point si no se encontraron en círculo local
    try {
      const nationalParams = new URLSearchParams({
        api_key: this.apiKey,
        text: queryString,
        size: '5',
        layers: 'address,street,venue',
        'boundary.country': 'MEX',
        'focus.point.lat': centerLat.toString(),
        'focus.point.lon': centerLon.toString(),
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(
        `${this.baseUrl}/geocode/search?${nationalParams.toString()}`,
        {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.features && Array.isArray(data.features) && data.features.length > 0) {
          return this.parsePeliasFeatures(data.features, queryString);
        }
      }
    } catch (err) {
      console.warn('[orsService] Fallo búsqueda nacional en ORS:', err);
    }

    return [];
  }

  /**
   * Parsea las features devueltas por el geocodificador Pelias de ORS y clasifica su precisión
   */
  private parsePeliasFeatures(features: any[], query: string): GeocodeResult[] {
    return features.map((feature: any, index: number): GeocodeResult => {
      const coords = feature.geometry?.coordinates || [0, 0];
      const props = feature.properties || {};
      const layer = props.layer;
      const hasHouseNumber = Boolean(props.housenumber);

      let precision: GeocodePrecision = 'approximate';
      if (layer === 'address' || layer === 'venue' || hasHouseNumber) {
        precision = 'exact';
      } else if (layer === 'street') {
        precision = 'street';
      } else if (layer === 'interpolated') {
        precision = 'interpolated';
      }

      return {
        id: props.id || `ors-${index}`,
        name: props.name || props.label || query,
        label: props.label || props.name || query,
        coordinates: {
          latitude: coords[1],
          longitude: coords[0],
        },
        distanceMeters: props.distance ? Math.round(props.distance * 1000) : undefined,
        precision,
      };
    });
  }

  /**
   * Geocodificación vía Photon (Komoot / OSM) - Sin costo y sin API Key
   * Corrección crítica: usa lang='default' para evitar el error HTTP 400 de lang='es'
   */
  private async geocodeWithPhoton(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const structured = typeof query === 'string' ? parseStructuredAddress(query) : query;
    const lat = userLocation?.latitude ?? 19.4326;
    const lon = userLocation?.longitude ?? -99.1332;

    const searchParts = [
      structured.street,
      structured.houseNumber,
      structured.crossStreet,
      structured.colonia,
      structured.city || 'Ciudad de México',
    ].filter(Boolean);

    const qStr = searchParts.join(' ');

    const params = new URLSearchParams({
      q: qStr,
      lang: 'default',
      limit: '5',
      lat: lat.toString(),
      lon: lon.toString(),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.features && Array.isArray(data.features) && data.features.length > 0) {
        return data.features.map((feat: any, index: number): GeocodeResult => {
          const coords = feat.geometry?.coordinates || [0, 0];
          const p = feat.properties || {};
          const street = p.street;
          const num = p.housenumber;
          const name = p.name;
          const district = p.district || p.suburb;
          const city = p.city || p.county || p.state || 'Ciudad de México';

          let precision: GeocodePrecision = 'approximate';
          if (num) {
            precision = 'exact';
          } else if (street) {
            precision = 'street';
          }

          let mainName = name;
          if (!mainName && street) {
            mainName = num ? `${street} ${num}` : street;
          }
          if (!mainName) mainName = qStr;

          const labelParts = [
            street && num ? `${street} ${num}` : (name || street),
            district,
            city,
          ].filter(Boolean);

          return {
            id: `photon-${p.osm_id || index}`,
            name: mainName,
            label: labelParts.length > 0 ? labelParts.join(', ') : qStr,
            coordinates: {
              latitude: coords[1],
              longitude: coords[0],
            },
            precision,
          };
        });
      }
    }

    return [];
  }

  /**
   * Geocodificación vía OpenStreetMap Nominatim con degeneración progresiva:
   * 1. Cruces e intersecciones viales si se especifica crossStreet.
   * 2. Búsqueda exacta de predio con houseNumber.
   * 3. Relajación a nivel de tramo de calle en la colonia indicada (Street Segment Fallback)
   *    evitando degradar a centroides genéricos de alcaldía o ciudad.
   */
  private async geocodeWithNominatim(
    query: string | StructuredAddressQuery,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const structured = typeof query === 'string' ? parseStructuredAddress(query) : query;

    const fetchNominatimQuery = async (searchStr: string): Promise<any[]> => {
      try {
        const params = new URLSearchParams({
          q: searchStr,
          format: 'json',
          countrycodes: 'mx',
          addressdetails: '1',
          limit: '5',
          viewbox: '-99.38,19.62,-98.92,19.15',
          bounded: '0',
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'AVAN-Senior-Navigation-App/1.0 (contacto: avan-app@escom.ipn.mx)',
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) return data;
        }
      } catch (err) {
        console.warn(`[orsService] Error consultando Nominatim para "${searchStr}":`, err);
      }
      return [];
    };

    const mapNominatimResult = (
      item: any,
      index: number,
      forcedPrecision?: GeocodePrecision,
      labelOverride?: string
    ): GeocodeResult => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const addr = item.address || {};
      const street = addr.road || addr.pedestrian || addr.street;
      const houseNumber = addr.house_number;
      const suburb = addr.suburb || addr.neighbourhood || addr.quarter;
      const city = addr.city || addr.town || addr.municipality || addr.state || 'Ciudad de México';

      let precision: GeocodePrecision = forcedPrecision || 'approximate';
      if (!forcedPrecision) {
        if (houseNumber || item.class === 'building') {
          precision = 'exact';
        } else if (item.class === 'highway' || street) {
          precision = 'street';
        }
      }

      const mainName =
        item.name ||
        (street ? (houseNumber ? `${street} ${houseNumber}` : street) : item.display_name.split(',')[0]);

      const labelParts = [
        street && houseNumber ? `${street} ${houseNumber}` : (item.name || street),
        suburb,
        city,
      ].filter(Boolean);

      return {
        id: `nominatim-${item.place_id || index}`,
        name: mainName,
        label: labelOverride || (labelParts.length > 0 ? labelParts.join(', ') : item.display_name),
        coordinates: {
          latitude: lat,
          longitude: lon,
        },
        precision,
      };
    };

    // PASO 1: Si se proporcionó cruce vial (esquina/cruce)
    if (structured.crossStreet && structured.street) {
      const intersectionQuery = `${structured.street} ${structured.crossStreet}, ${
        structured.colonia ? structured.colonia + ', ' : ''
      }Ciudad de México`;
      const data = await fetchNominatimQuery(intersectionQuery);
      if (data.length > 0) {
        return data.map((item, idx) => mapNominatimResult(item, idx, 'exact'));
      }
    }

    // PASO 2: Si se proporcionó número exterior
    if (structured.houseNumber && structured.street) {
      // 2A: Intentar dirección completa con número
      const fullQuery = `${structured.street} ${structured.houseNumber}, ${
        structured.colonia ? structured.colonia + ', ' : ''
      }Ciudad de México`;
      const fullData = await fetchNominatimQuery(fullQuery);

      if (fullData.length > 0) {
        const hasExactNumber = fullData.some((d) => d.address?.house_number);
        return fullData.map((item, idx) =>
          mapNominatimResult(item, idx, hasExactNumber ? 'exact' : 'street')
        );
      }

      // 2B: STREET SEGMENT FALLBACK:
      // Si OSM no tiene catalogado el predio exacto, relajar a la calle en la colonia indicada
      const streetInColoniaQuery = `${structured.street}, ${
        structured.colonia ? structured.colonia + ', ' : ''
      }Ciudad de México`;
      const streetData = await fetchNominatimQuery(streetInColoniaQuery);

      if (streetData.length > 0) {
        const labelWithNumber = `${structured.street} ${structured.houseNumber} (aprox.), ${
          structured.colonia || 'Ciudad de México'
        }`;
        return streetData.map((item, idx) =>
          mapNominatimResult(item, idx, 'street', labelWithNumber)
        );
      }
    }

    // PASO 3: Búsqueda de calle o lugar general
    if (structured.street) {
      const queryStr = `${structured.street}, ${
        structured.colonia ? structured.colonia + ', ' : ''
      }Ciudad de México`;
      const streetData = await fetchNominatimQuery(queryStr);
      if (streetData.length > 0) {
        return streetData.map((item, idx) => mapNominatimResult(item, idx));
      }
    }

    // PASO 4: Consulta plana de respaldo
    if (structured.rawQuery) {
      const isStateSpecified = /(?:cdmx|ciudad de mexico|mexico|edomex|estado de mexico|puebla|toluca|cuernavaca)/i.test(
        structured.rawQuery
      );
      const searchString = isStateSpecified ? structured.rawQuery : `${structured.rawQuery}, Ciudad de México`;
      const rawData = await fetchNominatimQuery(searchString);
      if (rawData.length > 0) {
        return rawData.map((item, idx) => mapNominatimResult(item, idx));
      }
    }

    return [];
  }


  /**
   * Búsqueda semántica y de alta fidelidad en el catálogo curado de transporte y landmarks de CDMX (Tier 0)
   */
  private searchFallbackDestinations(query: string): GeocodeResult[] {
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    const qNorm = normalize(query);
    if (!qNorm) return [];

    // Limpieza de términos comunes de transporte para match flexible ("metro politécnico" -> "politecnico")
    const cleanTransportQuery = qNorm
      .replace(/^(?:el\s+|la\s+)?(?:metro|estacion|estación|paradero|terminal|tren|suburbano|metrobus|metrobús)\s+/i, '')
      .replace(/\s+(?:linea|línea)\s+\w+$/i, '')
      .trim();

    // 1. Búsqueda en catálogo exhaustivo de transporte público con puntuación de relevancia
    const scoredTransportMatches = CDMX_TRANSPORT_POIS.map((poi) => {
      const nameNorm = normalize(poi.name);
      const labelNorm = normalize(poi.label);
      let score = 0;

      // Coincidencia exacta con el nombre o con "metro [consulta]"
      if (nameNorm === qNorm || nameNorm === `metro ${cleanTransportQuery}`) {
        score = 100;
      } else if (poi.aliases.some((alias) => normalize(alias) === qNorm || normalize(alias) === cleanTransportQuery)) {
        score = 95;
      } else if (nameNorm.includes(cleanTransportQuery) || (cleanTransportQuery.length > 3 && cleanTransportQuery.includes(nameNorm))) {
        score = 80;
      } else if (poi.aliases.some((alias) => normalize(alias).includes(cleanTransportQuery) || (cleanTransportQuery.length > 3 && cleanTransportQuery.includes(normalize(alias))))) {
        score = 70;
      } else if (labelNorm.includes(cleanTransportQuery)) {
        score = 20;
      }

      return { poi, score };
    })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredTransportMatches.length > 0 && scoredTransportMatches[0].score >= 70) {
      return scoredTransportMatches.map((item) => ({
        id: item.poi.id,
        name: item.poi.name,
        label: item.poi.label,
        coordinates: item.poi.coordinates,
        precision: 'exact' as GeocodePrecision,
      }));
    }

    // 2. Búsqueda en catálogo curado de landmarks y puntos de interés emblemáticos
    const qTokens = qNorm.split(/\s+/).filter((t) => t.length > 2);

    const matches = FALLBACK_DESTINATIONS.filter((item) => {
      const nameNorm = normalize(item.name);
      const labelNorm = normalize(item.label);

      // Coincidencia exacta o contenida
      if (nameNorm.includes(qNorm) || qNorm.includes(nameNorm)) return true;
      if (labelNorm.includes(qNorm)) return true;

      // Coincidencia por palabras clave
      const keywordMatch = item.keywords.some((kw) => {
        const kwNorm = normalize(kw);
        return qNorm.includes(kwNorm) || kwNorm.includes(qNorm);
      });
      if (keywordMatch) return true;

      // Coincidencia por tokens relevantes (ej: "bellas" + "artes")
      const matchedTokens = qTokens.filter(
        (token) => nameNorm.includes(token) || item.keywords.some((kw) => normalize(kw).includes(token))
      );
      return matchedTokens.length >= Math.min(qTokens.length, 2) && matchedTokens.length > 0;
    });

    return matches.map((m) => ({
      id: m.id,
      name: m.name,
      label: m.label,
      coordinates: m.coordinates,
      precision: 'exact' as GeocodePrecision,
    }));
  }

  /**
   * Tier 2: Cálculo de ruta con OSRM (Open Source Routing Machine).
   * 100% gratuito, ultra-rápido (<600ms), sin API key, con geometría de calles reales de OpenStreetMap.
   */
  private async getOsrmDirections(
    start: Coordinates,
    destination: Coordinates
  ): Promise<RouteResult | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=true`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AVAN-Senior-Navigation-App/1.0 (contacto: avan-app@escom.ipn.mx)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn('[orsService] OSRM respondió con código:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
        console.warn('[orsService] OSRM no devolvió rutas válidas:', data.code);
        return null;
      }

      const route = data.routes[0];
      const rawCoords: [number, number][] = route.geometry?.coordinates || [];
      if (rawCoords.length < 2) {
        return null;
      }

      const coordinates: Coordinates[] = rawCoords.map(([lng, lat]) => ({
        latitude: lat,
        longitude: lng,
      }));

      const osrmSteps = route.legs?.[0]?.steps || [];
      const steps: StepInstruction[] = [];

      let currentCoordIndex = 0;
      for (let i = 0; i < osrmSteps.length; i++) {
        const s = osrmSteps[i];
        const stepCoordsCount = s.geometry?.coordinates?.length || 2;
        const startIndex = currentCoordIndex;
        const endIndex = Math.min(coordinates.length - 1, startIndex + Math.max(0, stepCoordsCount - 1));
        currentCoordIndex = endIndex;

        const streetName = s.name ? s.name.trim() : '';
        const { instruction, type } = translateOsrmManeuver(s.maneuver, streetName, i === 0);

        steps.push({
          instruction,
          distance: Math.round(s.distance || 0),
          duration: Math.round(s.duration || 0),
          type,
          name: streetName,
          wayPoints: [startIndex, endIndex],
        });
      }

      console.log(
        `[orsService] Ruta vehicular calculada con Tier 2 OSRM: ${(route.distance / 1000).toFixed(2)} km, ${Math.round(route.duration / 60)} min, ${coordinates.length} puntos de calle.`
      );

      return {
        coordinates,
        distance: Math.round(route.distance || 0),
        duration: Math.round(route.duration || 0),
        steps,
        bbox: [
          Math.min(start.longitude, destination.longitude),
          Math.min(start.latitude, destination.latitude),
          Math.max(start.longitude, destination.longitude),
          Math.max(start.latitude, destination.latitude),
        ],
        isFallback: false,
      };
    } catch (err: any) {
      console.warn('[orsService] Error al consultar Tier 2 OSRM:', err.message || err);
      return null;
    }
  }

  /**
   * Calcula la ruta vehicular entre dos coordenadas usando arquitectura Multi-Tier:
   * 1. Tier 1: OpenRouteService oficial (con timeout de 3.5s).
   * 2. Tier 2: OSRM (Open Source Routing Machine, gratuito, rápido, con geometría de calles reales).
   * 3. Tier 3: Fallback de emergencia local si no hay conexión a internet.
   */
  public async getDirections(
    start: Coordinates,
    destination: Coordinates
  ): Promise<RouteResult> {
    // Tier 1: OpenRouteService (si hay API key configurada)
    if (this.apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        const body = {
          coordinates: [
            [start.longitude, start.latitude],
            [destination.longitude, destination.latitude],
          ],
          instructions: true,
          language: 'es',
          units: 'm',
          elevation: false,
        };

        const response = await fetch(
          `${this.baseUrl}/v2/directions/driving-car/geojson`,
          {
            method: 'POST',
            headers: {
              Authorization: this.apiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json, application/geo+json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const feature = data.features?.[0];

          if (feature && feature.geometry && feature.geometry.coordinates) {
            const rawCoords: [number, number][] = feature.geometry.coordinates;
            const coordinates: Coordinates[] = rawCoords.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }));

            const properties = feature.properties || {};
            const summary = properties.summary || {};
            const segments = properties.segments || [];

            const steps: StepInstruction[] = [];
            segments.forEach((seg: any) => {
              if (Array.isArray(seg.steps)) {
                seg.steps.forEach((step: any) => {
                  steps.push({
                    instruction: step.instruction || 'Continúa recto',
                    distance: step.distance || 0,
                    duration: step.duration || 0,
                    type: step.type ?? 0,
                    modifier: step.modifier,
                    name: step.name || '',
                    wayPoints: step.way_points || [0, 0],
                  });
                });
              }
            });

            console.log(
              `[orsService] Ruta vehicular calculada con Tier 1 ORS: ${(summary.distance / 1000).toFixed(2)} km, ${coordinates.length} puntos.`
            );

            return {
              coordinates,
              distance: summary.distance || 0,
              duration: summary.duration || 0,
              steps,
              bbox: feature.bbox,
              isFallback: false,
            };
          }
        } else {
          console.warn('[orsService] Tier 1 ORS devolvió status:', response.status, response.statusText);
        }
      } catch (error: any) {
        console.warn('[orsService] Tier 1 ORS falló o excedió timeout de 3.5s:', error.message || error);
      }
    }

    // Tier 2: OSRM (Open Source Routing Machine con calles reales de OSM)
    console.log('[orsService] Consultando Tier 2 (OSRM con geometría de calles reales)...');
    const osrmResult = await this.getOsrmDirections(start, destination);
    if (osrmResult) {
      return osrmResult;
    }

    // Tier 3: Fallback de emergencia local si no hay conexión a internet
    console.warn('[orsService] Recurriendo a Tier 3 (Ruta de emergencia local)');
    return this.generateFallbackRoute(start, destination);
  }

  /**
   * Genera una ruta vehicular simulada con trazo tipo cuadrícula urbana y
   * maniobras turn-by-turn en español neutro para AVAN.
   */
  public generateFallbackRoute(
    start: Coordinates,
    destination: Coordinates
  ): RouteResult {
    const dLat = destination.latitude - start.latitude;
    const dLng = destination.longitude - start.longitude;

    // Construcción de polilínea en forma de "S" / retícula urbana
    const waypoints: Coordinates[] = [];
    const stepsCount = 14;

    for (let i = 0; i <= stepsCount; i++) {
      const t = i / stepsCount;
      // Añadir una leve curvatura de calle urbana
      const curve = Math.sin(t * Math.PI) * (dLng * 0.25);

      const lat = start.latitude + dLat * t + (t < 0.5 ? 0 : dLat * 0.05);
      const lng = start.longitude + dLng * t + curve;

      waypoints.push({ latitude: lat, longitude: lng });
    }

    // Estimación de distancia Manhattan urbana en metros (1 grado aprox 111,000m)
    const latMeters = Math.abs(dLat) * 111000;
    const lngMeters = Math.abs(dLng) * 111000 * Math.cos((start.latitude * Math.PI) / 180);
    const estimatedDistance = Math.round((latMeters + lngMeters) * 1.28); // Factor de desvío urbano

    // Duración estimada a 30 km/h promedio en ciudad
    const estimatedDuration = Math.round((estimatedDistance / 30000) * 3600);

    // Instrucciones paso a paso realistas
    const steps: StepInstruction[] = [
      {
        instruction: 'Inicie su recorrido dirigiéndose hacia la avenida principal',
        distance: Math.round(estimatedDistance * 0.15),
        duration: Math.round(estimatedDuration * 0.15),
        type: 11, // Head
        name: 'Avenida Principal',
        wayPoints: [0, 2],
      },
      {
        instruction: 'Continúe recto durante 800 metros',
        distance: Math.round(estimatedDistance * 0.35),
        duration: Math.round(estimatedDuration * 0.35),
        type: 0, // Continue
        name: 'Avenida Principal',
        wayPoints: [2, 6],
      },
      {
        instruction: 'Gire a la derecha en el cruce semaforizado',
        distance: Math.round(estimatedDistance * 0.25),
        duration: Math.round(estimatedDuration * 0.25),
        type: 1, // Turn right
        name: 'Eje Vial',
        wayPoints: [6, 10],
      },
      {
        instruction: 'Gire a la izquierda con dirección a su destino',
        distance: Math.round(estimatedDistance * 0.2),
        duration: Math.round(estimatedDuration * 0.2),
        type: 2, // Turn left
        name: 'Calle de Destino',
        wayPoints: [10, 13],
      },
      {
        instruction: 'Ha llegado a su destino',
        distance: Math.round(estimatedDistance * 0.05),
        duration: Math.round(estimatedDuration * 0.05),
        type: 10, // Arrive
        name: 'Destino',
        wayPoints: [13, 14],
      },
    ];

    const minLat = Math.min(start.latitude, destination.latitude);
    const maxLat = Math.max(start.latitude, destination.latitude);
    const minLng = Math.min(start.longitude, destination.longitude);
    const maxLng = Math.max(start.longitude, destination.longitude);

    return {
      coordinates: waypoints,
      distance: estimatedDistance,
      duration: estimatedDuration,
      steps,
      bbox: [minLng, minLat, maxLng, maxLat],
      isFallback: true,
    };
  }

  /**
   * Geocodificación inversa vía OpenStreetMap / Nominatim:
   * Convierte coordenadas GPS en una dirección legible con calle, número y colonia.
   * Cuenta con caché en memoria LRU para evitar llamadas repetidas en la calzada.
   */
  public async reverseGeocode(coord: Coordinates): Promise<GeocodeResult | null> {
    if (!coord || typeof coord.latitude !== 'number' || typeof coord.longitude !== 'number') {
      return null;
    }

    const cacheKey = `rev_${coord.latitude.toFixed(4)}_${coord.longitude.toFixed(4)}`;
    const cached = OpenRouteService.getFromCache(OpenRouteService.reverseCache, cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const params = new URLSearchParams({
        lat: coord.latitude.toString(),
        lon: coord.longitude.toString(),
        format: 'json',
        addressdetails: '1',
      });

      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AVAN-Senior-Navigation-App/1.0 (contacto: avan-app@escom.ipn.mx)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        if (data && data.address) {
          const addr = data.address;
          const road = addr.road || addr.pedestrian || addr.street || '';
          const houseNumber = addr.house_number || '';
          const suburb = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '';
          const city = addr.city || addr.town || addr.municipality || 'Ciudad de México';

          const mainName = road ? (houseNumber ? `${road} ${houseNumber}` : road) : (data.name || 'Ubicación actual');
          const labelParts = [
            mainName,
            suburb,
            city,
          ].filter(Boolean);

          const result: GeocodeResult = {
            id: `rev-${data.place_id || Date.now()}`,
            name: mainName,
            label: labelParts.join(', '),
            coordinates: {
              latitude: parseFloat(data.lat) || coord.latitude,
              longitude: parseFloat(data.lon) || coord.longitude,
            },
            precision: houseNumber ? 'exact' : 'street',
          };

          OpenRouteService.setInCache(OpenRouteService.reverseCache, cacheKey, result);
          return result;
        }
      }
    } catch (err) {
      console.warn('[orsService] Error en reverseGeocode:', err);
    }

    return null;
  }

  /**
   * Ajusta una coordenada GPS a la calzada vial más cercana usando el endpoint Nearest de OSRM.
   * Elimina el jitter o desviación de GPS cuando el vehículo está circulando.
   */
  public async snapToRoad(
    coord: Coordinates
  ): Promise<{ snappedCoord: Coordinates; distanceMeters: number; streetName?: string } | null> {
    if (!coord || typeof coord.latitude !== 'number' || typeof coord.longitude !== 'number') {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const url = `https://router.project-osrm.org/nearest/v1/driving/${coord.longitude},${coord.latitude}?number=1`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AVAN-Senior-Navigation-App/1.0 (contacto: avan-app@escom.ipn.mx)',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.waypoints && data.waypoints[0]) {
          const wp = data.waypoints[0];
          const [lon, lat] = wp.location;
          return {
            snappedCoord: { latitude: lat, longitude: lon },
            distanceMeters: Math.round(wp.distance || 0),
            streetName: wp.name || undefined,
          };
        }
      }
    } catch (err) {
      console.warn('[orsService] Error en snapToRoad OSRM:', err);
    }

    return null;
  }
}

// Instancia singleton por defecto
export const orsService = new OpenRouteService();

// Exportaciones de conveniencia
export const reverseGeocode = (coord: Coordinates) => orsService.reverseGeocode(coord);
export const snapToRoad = (coord: Coordinates) => orsService.snapToRoad(coord);
