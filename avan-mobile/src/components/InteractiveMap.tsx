import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
} from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import MapView, {
  Marker,
  Polyline,
  Region,
  LatLng,
  EdgePadding,
  Camera,
} from 'react-native-maps';
import Svg, { Path, Circle } from 'react-native-svg';
import { lightMapStyle, darkMapStyle } from '../theme/mapStyles';
import { lightTheme, darkTheme, ThemeColors } from '../theme/theme';
import { NavigationArrow } from './NavigationArrow';

export interface UserLocation {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number | null;
  altitude?: number | null;
  accuracy?: number | null;
}

export interface InteractiveMapRef {
  zoomIn: () => void;
  zoomOut: () => void;
  recenter: () => void;
  animateToRegion: (region: Region, duration?: number) => void;
  fitToCoordinates: (
    coordinates: LatLng[],
    options?: {
      edgePadding?: EdgePadding;
      animated?: boolean;
    }
  ) => void;
  getCamera: () => Promise<Camera | null>;
}

export interface InteractiveMapProps {
  isDarkMode: boolean;
  userLocation?: UserLocation | null;
  routeCoordinates?: LatLng[];
  destinationMarker?: LatLng | null;
  destinationTitle?: string;
  initialRegion?: Region;
  followUser?: boolean;
  onRegionChangeComplete?: (region: Region) => void;
  onMapPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_REGION: Region = {
  latitude: 19.427025,
  longitude: -99.167665,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

/**
 * Marcador de destino estilizado según la paleta del mockup de AVAN.
 */
const DestinationPin: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  const pinColor = isDarkMode ? '#00E5FF' : '#204669';
  const innerColor = isDarkMode ? '#0B111D' : '#FFFFFF';

  return (
    <View style={[styles.pinContainer, isDarkMode && styles.pinDarkGlow]}>
      <Svg width={36} height={44} viewBox="0 0 36 44">
        {/* Cuerpo del marcador tipo gota / pin */}
        <Path
          d="M18 0 C8.06 0 0 8.06 0 18 C0 31.5 18 44 18 44 C18 44 36 31.5 36 18 C36 8.06 27.94 0 18 0 Z"
          fill={pinColor}
        />
        {/* Círculo interior */}
        <Circle cx="18" cy="18" r="6.5" fill={innerColor} />
      </Svg>
    </View>
  );
};

export const InteractiveMap = forwardRef<InteractiveMapRef, InteractiveMapProps>(
  (
    {
      isDarkMode,
      userLocation,
      routeCoordinates,
      destinationMarker,
      destinationTitle,
      initialRegion,
      followUser = false,
      onRegionChangeComplete,
      onMapPress,
      style,
    },
    ref
  ) => {
    const mapRef = useRef<MapView>(null);
    const currentRegionRef = useRef<Region>(initialRegion || DEFAULT_REGION);
    const currentTheme: ThemeColors = isDarkMode ? darkTheme : lightTheme;

    // Métodos imperativos expuestos para comandos de voz y botones de control
    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        const cur = currentRegionRef.current;
        const newRegion: Region = {
          latitude: cur.latitude,
          longitude: cur.longitude,
          latitudeDelta: Math.max(cur.latitudeDelta * 0.5, 0.0008),
          longitudeDelta: Math.max(cur.longitudeDelta * 0.5, 0.0008),
        };
        currentRegionRef.current = newRegion;
        mapRef.current?.animateToRegion(newRegion, 350);
      },
      zoomOut: () => {
        const cur = currentRegionRef.current;
        const newRegion: Region = {
          latitude: cur.latitude,
          longitude: cur.longitude,
          latitudeDelta: Math.min(cur.latitudeDelta * 2.0, 60),
          longitudeDelta: Math.min(cur.longitudeDelta * 2.0, 60),
        };
        currentRegionRef.current = newRegion;
        mapRef.current?.animateToRegion(newRegion, 350);
      },
      recenter: () => {
        if (!userLocation) return;
        const newRegion: Region = {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        };
        currentRegionRef.current = newRegion;
        mapRef.current?.animateToRegion(newRegion, 500);
      },
      animateToRegion: (region: Region, duration = 500) => {
        currentRegionRef.current = region;
        mapRef.current?.animateToRegion(region, duration);
      },
      fitToCoordinates: (coordinates: LatLng[], options) => {
        mapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: options?.edgePadding || {
            top: 140,
            right: 60,
            bottom: 220,
            left: 60,
          },
          animated: options?.animated !== false,
        });
      },
      getCamera: async () => {
        if (!mapRef.current) return null;
        return await mapRef.current.getCamera();
      },
    }));

    // Si followUser está activo, recentramos suavemente el mapa al cambiar de posición
    useEffect(() => {
      if (followUser && userLocation && mapRef.current) {
        mapRef.current.animateCamera(
          {
            center: {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            },
            heading: userLocation.heading ?? 0,
          },
          { duration: 800 }
        );
      }
    }, [followUser, userLocation?.latitude, userLocation?.longitude, userLocation?.heading]);

    const handleRegionChangeComplete = (region: Region) => {
      currentRegionRef.current = region;
      if (onRegionChangeComplete) {
        onRegionChangeComplete(region);
      }
    };

    const hasRoute = routeCoordinates && routeCoordinates.length >= 2;

    return (
      <View style={[styles.container, style]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          customMapStyle={isDarkMode ? darkMapStyle : lightMapStyle}
          initialRegion={initialRegion || DEFAULT_REGION}
          onRegionChangeComplete={handleRegionChangeComplete}
          onPress={onMapPress}
          showsUserLocation={false}
          showsCompass={false}
          showsTraffic={false}
          showsMyLocationButton={false}
          showsScale={false}
          showsBuildings={false}
          showsIndoors={false}
          rotateEnabled={true}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          {/* Polilínea de la ruta activa */}
          {hasRoute && (
            <>
              {/* Resplandor neón exterior en modo nocturno */}
              {isDarkMode && (
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor="rgba(0, 229, 255, 0.28)"
                  strokeWidth={14}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={2}
                />
              )}
              {/* Trazo principal de la ruta */}
              <Polyline
                coordinates={routeCoordinates}
                strokeColor={isDarkMode ? '#00E5FF' : '#2B5B84'}
                strokeWidth={isDarkMode ? 6 : 6}
                lineCap="round"
                lineJoin="round"
                zIndex={3}
              />
            </>
          )}

          {/* Marcador de Destino */}
          {destinationMarker && (
            <Marker
              coordinate={destinationMarker}
              anchor={{ x: 0.5, y: 1.0 }}
              title={destinationTitle || 'Destino'}
              zIndex={9}
            >
              <DestinationPin isDarkMode={isDarkMode} />
            </Marker>
          )}

          {/* Marcador Vehicular con orientación de rumbo (heading) */}
          {userLocation && (
            <Marker
              coordinate={{
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              flat={true}
              zIndex={10}
            >
              <NavigationArrow
                theme={currentTheme}
                isDarkMode={isDarkMode}
                rotation={userLocation.heading ?? 0}
                size={54}
              />
            </Marker>
          )}
        </MapView>
      </View>
    );
  }
);

InteractiveMap.displayName = 'InteractiveMap';

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDarkGlow: {
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
});
