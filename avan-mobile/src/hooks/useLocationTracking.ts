import { useState, useEffect } from 'react';
import { LocationService } from '../services/locationService';
import { UserLocation } from '../components/InteractiveMap';

/**
 * Hook para conectar el seguimiento GPS en tiempo real y orientación por brújula.
 */
export function useLocationTracking() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let isMounted = true;

    async function initTracking() {
      const granted = await LocationService.requestPermissions();
      if (!isMounted) return;
      setHasPermission(granted);

      // Solo establecer ubicación inicial si ya se cuenta con una posición satelital real verificada
      if (LocationService.hasRealLocation()) {
        const initial = await LocationService.getCurrentLocation();
        if (isMounted) setUserLocation(initial);
      }

      unsubscribe = await LocationService.watchLocationAndHeading((loc) => {
        if (isMounted) {
          setUserLocation(loc);
        }
      });
    }

    initTracking();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return {
    userLocation,
    hasPermission,
  };
}
