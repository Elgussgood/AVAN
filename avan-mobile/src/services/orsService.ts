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

export interface GeocodeResult {
  id: string;
  name: string;
  label: string;
  coordinates: Coordinates;
  distanceMeters?: number;
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

export class OpenRouteService {
  private apiKey: string;
  private baseUrl = 'https://api.openrouteservice.org';

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
   * Geocodifica un destino en lenguaje natural (ej. "Reforma", "Bellas Artes", "Sonora 120, Roma Norte").
   * Estrategia Multi-Tier Resiliente:
   *  Tier 0: Catálogo curado de puntos de interés y landmarks emblemáticos de CDMX (0ms, 100% exacto)
   *  Tier 1: OpenRouteService con boundary.circle metropolitano (65km)
   *  Tier 2: OpenStreetMap Nominatim (con viewbox metropolitano y filtrado MX)
   *  Tier 3: Photon API de Komoot (OSM global, gratis, sin API key, con bias CDMX)
   *  Tier 4: Fallback aproximado
   */
  public async geocodeDestination(
    query: string,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    // 1. TIER 0: Búsqueda inmediata en el Catálogo Curado de Alta Fidelidad
    // Resuelve sitios emblemáticos de CDMX con coordenadas exactas verificadas manualmente
    const catalogResults = this.searchFallbackDestinations(trimmed);
    if (catalogResults.length > 0) {
      return catalogResults;
    }

    // 2. TIER 1: OpenRouteService con delimitación por círculo metropolitano (65km)
    if (this.apiKey) {
      try {
        const orsResults = await this.geocodeWithORS(trimmed, userLocation);
        if (orsResults && orsResults.length > 0) {
          const coloniaMatch = trimmed.match(/\b(roma|condesa|polanco|del valle|narvarte|doctores|juarez|juárez|napoles|nápoles|san angel|san ángel|coyoacan|coyoacán|lindavista|santa fe|centro|anzures|escandon|escandón)\b/i);
          if (coloniaMatch) {
            const expectedColonia = coloniaMatch[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const labelNorm = orsResults[0].label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (labelNorm.includes(expectedColonia)) {
              return orsResults;
            }
            // Si ORS ignoró la colonia (ej. devolvió Tlalnepantla para "Sonora 120, Roma"), continuar a Nominatim
          } else {
            return orsResults;
          }
        }
      } catch (err) {
        console.warn('[orsService] Error en geocodificación ORS, recurriendo a Nominatim:', err);
      }
    }

    // 3. TIER 2: OpenStreetMap Nominatim con delimitación por viewbox
    try {
      const nominatimResults = await this.geocodeWithNominatim(trimmed, userLocation);
      if (nominatimResults && nominatimResults.length > 0) {
        return nominatimResults;
      }
    } catch (err) {
      console.warn('[orsService] Error en geocodificación Nominatim, recurriendo a Photon:', err);
    }

    // 4. TIER 3: Photon API de Komoot (libre, rápido, con bias de CDMX)
    try {
      const photonResults = await this.geocodeWithPhoton(trimmed, userLocation);
      if (photonResults && photonResults.length > 0) {
        return photonResults;
      }
    } catch (err) {
      console.warn('[orsService] Error en geocodificación Photon:', err);
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
      },
    ];
  }

  /**
   * Geocodificación vía OpenRouteService oficial con delimitación geográfica
   */
  private async geocodeWithORS(
    query: string,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const centerLat = userLocation?.latitude ?? 19.4326;
    const centerLon = userLocation?.longitude ?? -99.1332;

    const isForaneoQuery = /(?:acapulco|cuernavaca|puebla|toluca|pachuca|queretaro|guadalajara|monterrey|cancun|veracruz|oaxaca|merida|leon|guanajuato|morelia|san luis|hidalgo|morelos|jalisco|nuevo leon)/i.test(query);

    // Intento 1: Búsqueda con círculo metropolitano (65km) para evitar falsos positivos en otros estados
    if (!isForaneoQuery) {
      try {
        const localParams = new URLSearchParams({
          api_key: this.apiKey,
          text: query,
          size: '5',
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
            return this.parsePeliasFeatures(data.features, query);
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
        text: query,
        size: '5',
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
          return this.parsePeliasFeatures(data.features, query);
        }
      }
    } catch (err) {
      console.warn('[orsService] Fallo búsqueda nacional en ORS:', err);
    }

    return [];
  }

  /**
   * Parsea las features devueltas por el geocodificador Pelias de ORS
   */
  private parsePeliasFeatures(features: any[], query: string): GeocodeResult[] {
    return features.map((feature: any, index: number): GeocodeResult => {
      const coords = feature.geometry?.coordinates || [0, 0];
      const props = feature.properties || {};
      return {
        id: props.id || `ors-${index}`,
        name: props.name || props.label || query,
        label: props.label || props.name || query,
        coordinates: {
          latitude: coords[1],
          longitude: coords[0],
        },
        distanceMeters: props.distance ? Math.round(props.distance * 1000) : undefined,
      };
    });
  }

  /**
   * Geocodificación vía Photon (Komoot / OSM) - Sin costo y sin API Key
   */
  private async geocodeWithPhoton(
    query: string,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const lat = userLocation?.latitude ?? 19.4326;
    const lon = userLocation?.longitude ?? -99.1332;

    const params = new URLSearchParams({
      q: query,
      lang: 'es',
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

          let mainName = name;
          if (!mainName && street) {
            mainName = num ? `${street} ${num}` : street;
          }
          if (!mainName) mainName = query;

          const labelParts = [
            street && num ? `${street} ${num}` : (name || street),
            district,
            city,
          ].filter(Boolean);

          return {
            id: `photon-${p.osm_id || index}`,
            name: mainName,
            label: labelParts.length > 0 ? labelParts.join(', ') : query,
            coordinates: {
              latitude: coords[1],
              longitude: coords[0],
            },
          };
        });
      }
    }

    return [];
  }

  /**
   * Geocodificación vía OpenStreetMap Nominatim - Gratuito
   */
  private async geocodeWithNominatim(
    query: string,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    // Si la consulta no especifica estado o ciudad, anexar Ciudad de México para contexto
    const isStateSpecified = /(?:cdmx|ciudad de mexico|mexico|edomex|estado de mexico|puebla|toluca|cuernavaca|hidalgo|pachuca|queretaro|jalisco|guadalajara|monterrey)/i.test(query);
    const searchString = isStateSpecified ? query : `${query}, Ciudad de México`;

    const params = new URLSearchParams({
      q: searchString,
      format: 'json',
      countrycodes: 'mx',
      addressdetails: '1',
      limit: '5',
      // Viewbox metropolitano de CDMX/Valle de México: [minLon, maxLat, maxLon, minLat]
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
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any, index: number): GeocodeResult => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          const addr = item.address || {};
          const street = addr.road || addr.pedestrian || addr.street;
          const houseNumber = addr.house_number;
          const suburb = addr.suburb || addr.neighbourhood || addr.quarter;
          const city = addr.city || addr.town || addr.municipality || addr.state || 'Ciudad de México';

          const mainName = item.name || (street ? (houseNumber ? `${street} ${houseNumber}` : street) : item.display_name.split(',')[0]);
          const labelParts = [
            street && houseNumber ? `${street} ${houseNumber}` : (item.name || street),
            suburb,
            city,
          ].filter(Boolean);

          return {
            id: `nominatim-${item.place_id || index}`,
            name: mainName,
            label: labelParts.length > 0 ? labelParts.join(', ') : item.display_name,
            coordinates: {
              latitude: lat,
              longitude: lon,
            },
          };
        });
      }
    }

    return [];
  }

  /**
   * Búsqueda semántica y difusa en el catálogo curado de landmarks de CDMX
   */
  private searchFallbackDestinations(query: string): GeocodeResult[] {
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    const qNorm = normalize(query);
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
    }));
  }

  /**
   * Calcula la ruta vehicular entre dos coordenadas usando ORS driving-car.
   * Retorna las coordenadas GeoJSON para Polyline y las maniobras paso a paso.
   */
  public async getDirections(
    start: Coordinates,
    destination: Coordinates
  ): Promise<RouteResult> {
    if (this.apiKey) {
      try {
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
          }
        );

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

            return {
              coordinates,
              distance: summary.distance || 0,
              duration: summary.duration || 0,
              steps,
              bbox: feature.bbox,
              isFallback: false,
            };
          }
        }
      } catch (error) {
        console.warn('OpenRouteService directions error, recurriendo a fallback:', error);
      }
    }

    // Fallback realista para desarrollo
    return this.generateFallbackRoute(start, destination);
  }

  /**
   * Genera una ruta vehicular simulada con trazo tipo cuadrícula urbana y
   * maniobras turn-by-turn en español neutro para AVAN.
   */
  private generateFallbackRoute(
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
}

// Instancia singleton por defecto
export const orsService = new OpenRouteService();
