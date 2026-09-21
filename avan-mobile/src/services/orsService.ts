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

// Destinos predefinidos para desarrollo y pruebas rápidas en CDMX
const FALLBACK_DESTINATIONS: GeocodeResult[] = [
  {
    id: 'mock-1',
    name: 'Ángel de la Independencia',
    label: 'Paseo de la Reforma, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.427025, longitude: -99.167665 },
  },
  {
    id: 'mock-2',
    name: 'Palacio de Bellas Artes',
    label: 'Av. Juárez S/N, Centro Histórico, Ciudad de México',
    coordinates: { latitude: 19.4352, longitude: -99.1412 },
  },
  {
    id: 'mock-3',
    name: 'Museo Soumaya / Polanco',
    label: 'Blvd. Miguel de Cervantes Saavedra 303, Granada, Miguel Hidalgo',
    coordinates: { latitude: 19.4407, longitude: -99.2047 },
  },
  {
    id: 'mock-4',
    name: 'Parque México / Condesa',
    label: 'Av México s/n, Hipódromo, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4124, longitude: -99.1697 },
  },
  {
    id: 'mock-5',
    name: 'Centro Médico Nacional Siglo XXI',
    label: 'Av. Cuauhtémoc 330, Doctores, Cuauhtémoc, Ciudad de México',
    coordinates: { latitude: 19.4069, longitude: -99.1558 },
  },
  {
    id: 'mock-6',
    name: 'Plaza Satélite',
    label: 'Cto Centro Comercial 2251, Cd. Satélite, Naucalpan de Juárez',
    coordinates: { latitude: 19.5104, longitude: -99.2346 },
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
   * Geocodifica un destino en lenguaje natural (ej. "Reforma", "Bellas Artes", "Hospital").
   * Si no hay API key o la red falla, utiliza el catálogo de fallback realista.
   */
  public async geocodeDestination(
    query: string,
    userLocation?: Coordinates
  ): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    // Si hay API key disponible, intentamos consultar el endpoint oficial de geocodificación
    if (this.apiKey) {
      try {
        const params = new URLSearchParams({
          api_key: this.apiKey,
          text: trimmed,
          size: '5',
          'boundary.country': 'MEX',
        });

        if (userLocation) {
          params.append('focus.point.lat', userLocation.latitude.toString());
          params.append('focus.point.lon', userLocation.longitude.toString());
        }

        const response = await fetch(
          `${this.baseUrl}/geocode/search?${params.toString()}`,
          {
            headers: {
              Accept: 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.features && Array.isArray(data.features) && data.features.length > 0) {
            return data.features.map((feature: any, index: number): GeocodeResult => {
              const coords = feature.geometry?.coordinates || [0, 0];
              const props = feature.properties || {};
              return {
                id: props.id || `ors-${index}`,
                name: props.name || props.label || trimmed,
                label: props.label || props.name || trimmed,
                coordinates: {
                  latitude: coords[1],
                  longitude: coords[0],
                },
                distanceMeters: props.distance ? Math.round(props.distance * 1000) : undefined,
              };
            });
          }
        }
      } catch (error) {
        console.warn('OpenRouteService geocode error, recurriendo a fallback:', error);
      }
    }

    // Fallback: búsqueda en catálogo local o generación inteligente
    return this.getFallbackGeocode(trimmed, userLocation);
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
   * Genera resultados de búsqueda simulados basados en la consulta y ubicación.
   */
  private getFallbackGeocode(
    query: string,
    userLocation?: Coordinates
  ): GeocodeResult[] {
    const qLower = query.toLowerCase();
    const matches = FALLBACK_DESTINATIONS.filter(
      (item) =>
        item.name.toLowerCase().includes(qLower) ||
        item.label.toLowerCase().includes(qLower)
    );

    if (matches.length > 0) {
      return matches;
    }

    // Si no coincide con la lista fija, genera un destino realista cercano al usuario
    const baseLat = userLocation?.latitude ?? 19.427025;
    const baseLng = userLocation?.longitude ?? -99.167665;

    // Desplazamiento verosímil de ~2 km
    const offsetLat = (Math.sin(query.length) * 0.015) + 0.008;
    const offsetLng = (Math.cos(query.length) * 0.015) + 0.008;

    return [
      {
        id: `mock-generated-${Date.now()}`,
        name: query,
        label: `${query}, Ciudad de México`,
        coordinates: {
          latitude: baseLat + offsetLat,
          longitude: baseLng + offsetLng,
        },
        distanceMeters: 2350,
      },
      ...FALLBACK_DESTINATIONS.slice(0, 2),
    ];
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
        instruction: 'Inicia tu recorrido dirigiéndote hacia la avenida principal',
        distance: Math.round(estimatedDistance * 0.15),
        duration: Math.round(estimatedDuration * 0.15),
        type: 11, // Head
        name: 'Avenida Principal',
        wayPoints: [0, 2],
      },
      {
        instruction: 'Continúa recto durante 800 metros',
        distance: Math.round(estimatedDistance * 0.35),
        duration: Math.round(estimatedDuration * 0.35),
        type: 0, // Continue
        name: 'Avenida Principal',
        wayPoints: [2, 6],
      },
      {
        instruction: 'Gira a la derecha en el cruce semaforizado',
        distance: Math.round(estimatedDistance * 0.25),
        duration: Math.round(estimatedDuration * 0.25),
        type: 1, // Turn right
        name: 'Eje Vial',
        wayPoints: [6, 10],
      },
      {
        instruction: 'Gira a la izquierda con dirección a tu destino',
        distance: Math.round(estimatedDistance * 0.2),
        duration: Math.round(estimatedDuration * 0.2),
        type: 2, // Turn left
        name: 'Calle de Destino',
        wayPoints: [10, 13],
      },
      {
        instruction: 'Has llegado a tu destino',
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
