import * as Location from 'expo-location';
import { UserLocation } from '../components/InteractiveMap';

/**
 * Servicio de seguimiento GPS y brújula (heading) en tiempo real con expo-location.
 */
export class LocationService {
  private static defaultLocation: UserLocation = {
    latitude: 19.427025,
    longitude: -99.167665,
    heading: 342,
    speed: 0,
  };

  /**
   * Solicita permisos de ubicación en primer plano al usuario.
   */
  static async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === Location.PermissionStatus.GRANTED;
    } catch (error) {
      console.warn('Error al solicitar permisos de ubicación:', error);
      return false;
    }
  }

  /**
   * Obtiene la posición actual de GPS.
   */
  static async getCurrentLocation(): Promise<UserLocation> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return this.defaultLocation;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        heading: loc.coords.heading ?? 0,
        speed: loc.coords.speed,
        altitude: loc.coords.altitude,
        accuracy: loc.coords.accuracy,
      };
    } catch (error) {
      console.warn('Error al obtener ubicación actual:', error);
      return this.defaultLocation;
    }
  }

  /**
   * Suscribe a actualizaciones continuas de posición GPS y rumbo (heading).
   * Retorna una función de limpieza (unsubscribe) para cancelar los observadores.
   */
  static async watchLocationAndHeading(
    onUpdate: (location: UserLocation) => void
  ): Promise<() => void> {
    let positionSubscription: Location.LocationSubscription | null = null;
    let headingSubscription: Location.LocationSubscription | null = null;
    let lastKnownLocation: UserLocation = { ...this.defaultLocation };

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        onUpdate(this.defaultLocation);
        return () => {};
      }

      // Observador de posición GPS (alta precisión para navegación vehicular)
      positionSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000, // Cada 1 segundo
          distanceInterval: 1, // Cada 1 metro
        },
        (loc) => {
          lastKnownLocation = {
            ...lastKnownLocation,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            speed: loc.coords.speed,
            altitude: loc.coords.altitude,
            accuracy: loc.coords.accuracy,
            heading:
              loc.coords.heading !== null && loc.coords.heading >= 0
                ? loc.coords.heading
                : lastKnownLocation.heading,
          };
          onUpdate(lastKnownLocation);
        }
      );

      // Observador de rumbo (brújula/magnetómetro para rotación en bajas velocidades o detenido)
      try {
        headingSubscription = await Location.watchHeadingAsync((headingData) => {
          const heading = headingData.trueHeading >= 0
            ? headingData.trueHeading
            : headingData.magHeading;

          if (heading !== undefined && heading >= 0) {
            lastKnownLocation = {
              ...lastKnownLocation,
              heading: Math.round(heading),
            };
            onUpdate(lastKnownLocation);
          }
        });
      } catch (headingError) {
        // En algunos dispositivos o emuladores el magnetómetro no está disponible
        console.warn('Brújula / heading no disponible en este dispositivo:', headingError);
      }
    } catch (error) {
      console.warn('Error al iniciar seguimiento de ubicación:', error);
      onUpdate(this.defaultLocation);
    }

    // Limpieza al desmontar
    return () => {
      positionSubscription?.remove();
      headingSubscription?.remove();
    };
  }
}
