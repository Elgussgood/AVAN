import { Ionicons } from '@expo/vector-icons';
import { StepInstruction } from './orsService';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface NavigationProgress {
  currentStepIndex: number;
  currentStep: StepInstruction | null;
  nextStep: StepInstruction | null;
  distanceToNextManeuver: number; // en metros
  remainingDistance: number; // en metros
  remainingDuration: number; // en segundos
  formattedDistanceToManeuver: string;
  formattedRemainingDistance: string;
  formattedRemainingDuration: string;
  maneuverIcon: keyof typeof Ionicons.glyphMap;
  isOffRoute: boolean;
  hasArrived: boolean;
}

/**
 * Calcula la distancia ortodrómica en metros entre dos coordenadas (Fórmula de Haversine).
 */
export function getDistanceMeters(c1: Coordinates, c2: Coordinates): number {
  const R = 6371000; // Radio medio de la Tierra en metros
  const dLat = ((c2.latitude - c1.latitude) * Math.PI) / 180;
  const dLon = ((c2.longitude - c1.longitude) * Math.PI) / 180;
  const lat1 = (c1.latitude * Math.PI) / 180;
  const lat2 = (c2.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Calcula el rumbo o dirección (bearing/heading en grados 0-359) entre dos puntos.
 */
export function getBearing(start: Coordinates, end: Coordinates): number {
  const startLat = (start.latitude * Math.PI) / 180;
  const startLng = (start.longitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;
  const endLng = (end.longitude * Math.PI) / 180;
  const dLng = endLng - startLng;

  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

/**
 * Distancia perpendicular en metros desde un punto a un segmento rectilíneo.
 */
function distanceToSegmentMeters(p: Coordinates, v: Coordinates, w: Coordinates): number {
  const segLength = getDistanceMeters(v, w);
  if (segLength === 0) return getDistanceMeters(p, v);

  const cosLat = Math.cos((v.latitude * Math.PI) / 180);
  const x = (p.longitude - v.longitude) * cosLat;
  const y = p.latitude - v.latitude;
  const dx = (w.longitude - v.longitude) * cosLat;
  const dy = w.latitude - v.latitude;
  const dot = x * dx + y * dy;
  const lenSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, dot / lenSq));

  const projLat = v.latitude + t * (w.latitude - v.latitude);
  const projLon = v.longitude + t * (w.longitude - v.longitude);
  return getDistanceMeters(p, { latitude: projLat, longitude: projLon });
}

/**
 * Calcula la distancia mínima desde un punto a cualquier segmento de una polilínea.
 */
export function getMinDistanceToPolyline(
  point: Coordinates,
  polyline: Coordinates[]
): number {
  if (!polyline || polyline.length === 0) return 0;
  if (polyline.length === 1) return getDistanceMeters(point, polyline[0]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceToSegmentMeters(point, polyline[i], polyline[i + 1]);
    if (d < minDist) {
      minDist = d;
    }
  }
  return minDist;
}

/**
 * Mapea códigos de maniobra de OpenRouteService a iconos comprensibles de Ionicons.
 */
export function getManeuverIconName(type?: number): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 0: // Left
    case 2: // Sharp left
    case 4: // Slight left
    case 12: // Keep left
      return 'arrow-undo';
    case 1: // Right
    case 3: // Sharp right
    case 5: // Slight right
    case 13: // Keep right
      return 'arrow-redo';
    case 6: // Straight / Continue
      return 'arrow-up';
    case 7: // Enter roundabout
    case 8: // Exit roundabout
      return 'sync';
    case 9: // U-turn
      return 'refresh';
    case 10: // Goal / Arrive
      return 'flag';
    case 11: // Depart / Head
    default:
      return 'navigate';
  }
}

/**
 * Formatea distancias en metros a formato legible para adultos mayores (ej. "150 m" o "2.4 km").
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    // Redondear a decenas de metros para evitar fluctuaciones
    const rounded = Math.round(meters / 10) * 10;
    return `${Math.max(10, rounded)} m`;
  }
  const km = (meters / 1000).toFixed(1);
  return `${km} km`;
}

/**
 * Formatea duración en segundos a minutos u horas comprensibles (ej. "6 min" o "1 h 12 min").
 */
export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours} h ${remainingMins} min`;
}

/**
 * Servicio de navegación turn-by-turn en tiempo real.
 */
export class NavigationService {
  static getDistanceMeters = getDistanceMeters;
  static getBearing = getBearing;
  static getMinDistanceToPolyline = getMinDistanceToPolyline;
  static formatDistance = formatDistance;
  static formatDuration = formatDuration;
  static getManeuverIconName = getManeuverIconName;

  /**
   * Evalúa el estado de navegación actual calculando distancias, paso activo y estado de ruta.
   */
  static evaluateProgress(
    userLocation: Coordinates,
    routeCoordinates: Coordinates[],
    destinationCoords: Coordinates | null,
    steps: StepInstruction[],
    currentStepIndex: number
  ): NavigationProgress {
    const defaultProgress: NavigationProgress = {
      currentStepIndex: 0,
      currentStep: null,
      nextStep: null,
      distanceToNextManeuver: 0,
      remainingDistance: 0,
      remainingDuration: 0,
      formattedDistanceToManeuver: '0 m',
      formattedRemainingDistance: '0 km',
      formattedRemainingDuration: '0 min',
      maneuverIcon: 'navigate',
      isOffRoute: false,
      hasArrived: false,
    };

    if (!userLocation || !routeCoordinates || routeCoordinates.length === 0) {
      return defaultProgress;
    }

    // 1. Detección de Llegada a Destino (<45 metros)
    const finalTarget =
      destinationCoords || routeCoordinates[routeCoordinates.length - 1];
    const distToDestination = getDistanceMeters(userLocation, finalTarget);
    const hasArrived = distToDestination <= 45;

    // 2. Detección de Desvío / Pérdida de Ruta (>100 metros fuera de la polilínea)
    const minDistToRoute = getMinDistanceToPolyline(userLocation, routeCoordinates);
    const isOffRoute = minDistToRoute > 100;

    // 3. Paso activo de maniobra
    const validStepIndex = Math.min(
      Math.max(0, currentStepIndex),
      Math.max(0, steps.length - 1)
    );
    const currentStep = steps[validStepIndex] || null;
    const nextStep = steps[validStepIndex + 1] || null;

    // 4. Coordenada objetivo de la próxima maniobra
    let maneuverCoord: Coordinates = finalTarget;
    if (currentStep && currentStep.wayPoints && routeCoordinates.length > 0) {
      const targetWaypointIdx = Math.min(
        currentStep.wayPoints[1],
        routeCoordinates.length - 1
      );
      maneuverCoord = routeCoordinates[targetWaypointIdx] || finalTarget;
    }

    const distanceToNextManeuver = getDistanceMeters(userLocation, maneuverCoord);

    // 5. Cálculo de distancia y duración restante estimada
    let remainingDist = distanceToNextManeuver;
    for (let i = validStepIndex + 1; i < steps.length; i++) {
      remainingDist += steps[i].distance || 0;
    }
    if (remainingDist === 0) {
      remainingDist = distToDestination;
    }

    // Estimación a velocidad urbana de 30 km/h (~8.33 m/s)
    const remainingDuration = Math.round(remainingDist / 8.33);

    return {
      currentStepIndex: validStepIndex,
      currentStep,
      nextStep,
      distanceToNextManeuver,
      remainingDistance: remainingDist,
      remainingDuration,
      formattedDistanceToManeuver: formatDistance(distanceToNextManeuver),
      formattedRemainingDistance: formatDistance(remainingDist),
      formattedRemainingDuration: formatDuration(remainingDuration),
      maneuverIcon: getManeuverIconName(currentStep?.type),
      isOffRoute,
      hasArrived,
    };
  }
}
