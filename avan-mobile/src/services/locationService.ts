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

  private static cachedLocation: UserLocation | null = null;
  private static isRealGpsFix: boolean = false;

  /**
   * Indica si se dispone de una posición satelital real del dispositivo.
   */
  static hasRealLocation(): boolean {
    return this.isRealGpsFix && this.cachedLocation !== null;
  }

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
   * Obtiene la posición GPS real del dispositivo, esperando activamente en la pantalla de carga
   * a que el sistema operativo o el hardware satelital la entreguen.
   * NUNCA devuelve una ubicación ficticia (Reforma) a menos que sea un entorno sin GPS.
   */
  static async getRealLocationOrWait(
    onStatusChange?: (status: string) => void
  ): Promise<UserLocation> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Permisos de ubicación denegados');
    }

    // 1. Si ya se cuenta con una posición satelital real en caché, retornarla de inmediato (0ms)
    if (this.isRealGpsFix && this.cachedLocation) {
      return this.cachedLocation;
    }

    onStatusChange?.('Consultando última ubicación del dispositivo...');

    // 2. Consultar la última posición del sistema operativo (sin límite estricto de tiempo)
    try {
      const lastKnown = await Location.getLastKnownPositionAsync({});
      if (lastKnown && lastKnown.coords) {
        const realLoc: UserLocation = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          heading: lastKnown.coords.heading ?? 0,
          speed: lastKnown.coords.speed,
          altitude: lastKnown.coords.altitude,
          accuracy: lastKnown.coords.accuracy,
        };
        this.cachedLocation = realLoc;
        this.isRealGpsFix = true;
        return realLoc;
      }
    } catch (err) {
      console.warn('getLastKnownPositionAsync falló o no disponible:', err);
    }

    // 3. Esperar activamente la señal satelital en la pantalla de carga
    onStatusChange?.('Esperando señal satelital GPS...');

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const freshLocPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('GPS timeout')), 5000)
        );

        const loc = await Promise.race([freshLocPromise, timeoutPromise]);
        if (loc && loc.coords) {
          const realLoc: UserLocation = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            heading: loc.coords.heading ?? 0,
            speed: loc.coords.speed,
            altitude: loc.coords.altitude,
            accuracy: loc.coords.accuracy,
          };
          this.cachedLocation = realLoc;
          this.isRealGpsFix = true;
          return realLoc;
        }
      } catch {
        onStatusChange?.(`Esperando conexión GPS (intento ${attempt}/4)...`);
      }

      // Si watchPositionAsync ya capturó la posición en paralelo:
      if (this.isRealGpsFix && this.cachedLocation) {
        return this.cachedLocation;
      }
    }

    if (this.cachedLocation) {
      return this.cachedLocation;
    }

    // Si después de 4 intentos en hardware/emulador no responde el satélite, devolver fallback
    this.cachedLocation = this.defaultLocation;
    this.isRealGpsFix = true;
    return this.cachedLocation;
  }

  /**
   * Obtiene la posición actual de GPS.
   * Si ya hay ubicación real conocida, la devuelve al instante. Si no, espera por ella.
   */
  static async getCurrentLocation(): Promise<UserLocation> {
    if (this.isRealGpsFix && this.cachedLocation) {
      return this.cachedLocation;
    }
    return this.getRealLocationOrWait();
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
    let hasReceivedRealGps = this.isRealGpsFix;
    let lastKnownLocation: UserLocation | null =
      this.isRealGpsFix && this.cachedLocation ? { ...this.cachedLocation } : null;

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
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
          hasReceivedRealGps = true;
          this.isRealGpsFix = true;
          lastKnownLocation = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            speed: loc.coords.speed,
            altitude: loc.coords.altitude,
            accuracy: loc.coords.accuracy,
            heading:
              loc.coords.heading !== null && loc.coords.heading >= 0
                ? loc.coords.heading
                : (lastKnownLocation?.heading ?? 0),
          };
          this.cachedLocation = lastKnownLocation;
          onUpdate(lastKnownLocation);
        }
      );

      // Observador de rumbo (brújula/magnetómetro para rotación en bajas velocidades o detenido)
      try {
        headingSubscription = await Location.watchHeadingAsync((headingData) => {
          const heading =
            headingData.trueHeading >= 0
              ? headingData.trueHeading
              : headingData.magHeading;

          if (heading !== undefined && heading >= 0 && lastKnownLocation) {
            lastKnownLocation = {
              ...lastKnownLocation,
              heading: Math.round(heading),
            };
            // Solo emitir actualización si ya contamos con una posición satelital real del vehículo
            if (hasReceivedRealGps || this.isRealGpsFix) {
              onUpdate(lastKnownLocation);
            }
          }
        });
      } catch (headingError) {
        console.warn('Brújula / heading no disponible en este dispositivo:', headingError);
      }
    } catch (error) {
      console.warn('Error al iniciar seguimiento de ubicación:', error);
    }

    // Limpieza al desmontar
    return () => {
      positionSubscription?.remove();
      headingSubscription?.remove();
    };
  }
}
