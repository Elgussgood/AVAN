/**
 * Decodificador del "Encoded Polyline Algorithm Format" de Google Maps Platform.
 * Sin dependencias nativas: seguro para Expo / React Native.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Decodifica una polilínea comprimida.
 * @param encoded Cadena codificada (overview_polyline.points / polyline.points)
 * @param precision 5 (Google Directions, por defecto) o 6
 * Es tolerante a cadenas truncadas o corruptas: devuelve los puntos válidos
 * decodificados hasta ese momento (nunca lanza excepciones).
 */
export function decodePolyline(encoded: string, precision: 5 | 6 = 5): LatLng[] {
  if (!encoded || typeof encoded !== 'string') return [];

  const factor = Math.pow(10, precision);
  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= len) return null; // cadena truncada
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < len) {
    const dLat = readValue();
    if (dLat === null) break;
    const dLng = readValue();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    const latitude = lat / factor;
    const longitude = lng / factor;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) break; // dato corrupto
    coordinates.push({ latitude, longitude });
  }

  return coordinates;
}

/** Codifica coordenadas (útil para pruebas de ida y vuelta). */
export function encodePolyline(points: LatLng[], precision: 5 | 6 = 5): string {
  const factor = Math.pow(10, precision);
  let prevLat = 0;
  let prevLng = 0;
  let out = '';

  const write = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };

  for (const p of points) {
    const lat = Math.round(p.latitude * factor);
    const lng = Math.round(p.longitude * factor);
    write(lat - prevLat);
    write(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
