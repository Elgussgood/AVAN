import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface EdgePadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface Camera {
  center: LatLng;
  heading: number;
  pitch: number;
  zoom?: number;
  altitude?: number;
}

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
 * Genera el documento HTML que ejecuta Leaflet.js con:
 * 1. OpenStreetMap 100% libre sin marca de agua por defecto (con filtro dark mode nocturno).
 * 2. Si el usuario cuenta con EXPO_PUBLIC_CARTO_API_KEY, usa las capas oficiales de CartoDB sin marcas de agua.
 */
function generateLeafletHtml(
  initialLat: number,
  initialLng: number,
  isDarkMode: boolean,
  cartoApiKey: string
): string {
  const bgColor = isDarkMode ? '#0B111D' : '#F1F4F7';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    html, body, #map {
      width: 100%;
      height: 100%;
      background-color: ${bgColor};
      overflow: hidden;
    }
    .leaflet-container {
      background-color: ${bgColor} !important;
    }
    .custom-div-icon {
      background: transparent !important;
      border: none !important;
    }
    /* Filtro nocturno de alto contraste para teselas libres de OpenStreetMap */
    .dark-tiles .leaflet-tile {
      filter: brightness(0.65) invert(1) contrast(1.35) hue-rotate(195deg) saturate(0.35) !important;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function() {
      var map = null;
      var tileLayer = null;
      var userMarker = null;
      var routeGlowPolyline = null;
      var routeMainPolyline = null;
      var destinationMarker = null;
      var currentThemeDark = ${isDarkMode ? 'true' : 'false'};

      var hasCartoKey = ${cartoApiKey ? 'true' : 'false'};
      var CARTO_KEY = ${JSON.stringify(cartoApiKey)};

      var DARK_CARTO = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' + (CARTO_KEY ? '?api_key=' + encodeURIComponent(CARTO_KEY) : '');
      var LIGHT_CARTO = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' + (CARTO_KEY ? '?api_key=' + encodeURIComponent(CARTO_KEY) : '');
      var OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      function getArrowSvg(heading, isDark) {
        var fill = isDark ? 'transparent' : '#2B5B84';
        var stroke = isDark ? '#00E5FF' : '#16324A';
        var strokeW = isDark ? '6.5' : '5';
        var shadow = isDark
          ? 'filter: drop-shadow(0px 0px 8px #00E5FF);'
          : 'filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.35));';

        return '<div id="arrow-rotator" style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; transform: rotate(' + heading + 'deg); transform-origin: center center; transition: transform 0.2s ease-out;">'
          + '<svg width="48" height="48" viewBox="0 0 100 100" style="overflow: visible;">'
          + '<path d="M50 8 L88 88 L50 68 L12 88 Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '" stroke-linejoin="round" stroke-linecap="round" style="' + shadow + '" />'
          + '</svg>'
          + '</div>';
      }

      function getPinSvg(isDark) {
        var fill = isDark ? '#00E5FF' : '#204669';
        var inner = isDark ? '#0B111D' : '#FFFFFF';
        var shadow = isDark
          ? 'filter: drop-shadow(0px 0px 10px #00E5FF);'
          : 'filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.35));';

        return '<div style="width: 36px; height: 44px; display: flex; align-items: center; justify-content: center;">'
          + '<svg width="36" height="44" viewBox="0 0 36 44" style="overflow: visible;">'
          + '<path d="M18 0 C8.06 0 0 8.06 0 18 C0 31.5 18 44 18 44 C18 44 36 31.5 36 18 C36 8.06 27.94 0 18 0 Z" fill="' + fill + '" style="' + shadow + '" />'
          + '<circle cx="18" cy="18" r="6.5" fill="' + inner + '" />'
          + '</svg>'
          + '</div>';
      }

      function init() {
        if (typeof L === 'undefined') {
          setTimeout(init, 50);
          return;
        }

        map = L.map('map', {
          zoomControl: false,
          attributionControl: false,
          fadeAnimation: true,
          zoomAnimation: true,
        }).setView([${initialLat}, ${initialLng}], 15);

        var initialTilesUrl = hasCartoKey
          ? (currentThemeDark ? DARK_CARTO : LIGHT_CARTO)
          : OSM_TILES;

        var subdomains = hasCartoKey ? 'abcd' : 'abc';

        tileLayer = L.tileLayer(initialTilesUrl, {
          subdomains: subdomains,
          maxZoom: 19
        }).addTo(map);

        var mapEl = document.getElementById('map');
        if (currentThemeDark && !hasCartoKey && mapEl) {
          mapEl.classList.add('dark-tiles');
        }

        map.on('click', function() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_PRESS' }));
          }
        });

        map.on('moveend', function() {
          var center = map.getCenter();
          var bounds = map.getBounds();
          var latDelta = Math.abs(bounds.getNorth() - bounds.getSouth());
          var lngDelta = Math.abs(bounds.getEast() - bounds.getWest());
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'REGION_CHANGE',
              region: {
                latitude: center.lat,
                longitude: center.lng,
                latitudeDelta: latDelta,
                longitudeDelta: lngDelta
              }
            }));
          }
        });

        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
        }
      }

      function updateLocation(lat, lng, heading, followUser) {
        if (!map) return;
        var rot = heading || 0;

        if (!userMarker) {
          var icon = L.divIcon({
            className: 'custom-div-icon',
            html: getArrowSvg(rot, currentThemeDark),
            iconSize: [56, 56],
            iconAnchor: [28, 28]
          });
          userMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
        } else {
          userMarker.setLatLng([lat, lng]);
          var elem = document.getElementById('arrow-rotator');
          if (elem) {
            elem.style.transform = 'rotate(' + rot + 'deg)';
          } else {
            userMarker.setIcon(L.divIcon({
              className: 'custom-div-icon',
              html: getArrowSvg(rot, currentThemeDark),
              iconSize: [56, 56],
              iconAnchor: [28, 28]
            }));
          }
        }

        if (followUser) {
          map.panTo([lat, lng], { animate: true, duration: 0.6 });
        }
      }

      function setRoute(coords, destination) {
        if (!map) return;

        if (routeGlowPolyline) {
          map.removeLayer(routeGlowPolyline);
          routeGlowPolyline = null;
        }
        if (routeMainPolyline) {
          map.removeLayer(routeMainPolyline);
          routeMainPolyline = null;
        }
        if (destinationMarker) {
          map.removeLayer(destinationMarker);
          destinationMarker = null;
        }

        if (coords && coords.length >= 2) {
          var latlngs = coords.map(function(c) { return [c.latitude, c.longitude]; });

          if (currentThemeDark) {
            routeGlowPolyline = L.polyline(latlngs, {
              color: 'rgba(0, 229, 255, 0.3)',
              weight: 14,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);

            routeMainPolyline = L.polyline(latlngs, {
              color: '#00E5FF',
              weight: 6,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);
          } else {
            routeMainPolyline = L.polyline(latlngs, {
              color: '#2B5B84',
              weight: 6,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);
          }
        }

        if (destination) {
          var pinIcon = L.divIcon({
            className: 'custom-div-icon',
            html: getPinSvg(currentThemeDark),
            iconSize: [36, 44],
            iconAnchor: [18, 44]
          });
          destinationMarker = L.marker([destination.latitude, destination.longitude], {
            icon: pinIcon,
            zIndexOffset: 900
          }).addTo(map);
        }
      }

      function setTheme(isDark) {
        currentThemeDark = isDark;
        var bg = isDark ? '#0B111D' : '#F1F4F7';
        document.body.style.backgroundColor = bg;
        var mapEl = document.getElementById('map');
        if (mapEl) {
          mapEl.style.backgroundColor = bg;
          if (isDark && !hasCartoKey) {
            mapEl.classList.add('dark-tiles');
          } else {
            mapEl.classList.remove('dark-tiles');
          }
        }

        if (tileLayer) {
          if (hasCartoKey) {
            tileLayer.setUrl(isDark ? DARK_CARTO : LIGHT_CARTO);
          } else {
            tileLayer.setUrl(OSM_TILES);
          }
        }

        if (userMarker) {
          var elem = document.getElementById('arrow-rotator');
          var curRot = 0;
          if (elem && elem.style.transform) {
            var match = elem.style.transform.match(/rotate\\(([-\\d.]+)deg\\)/);
            if (match) curRot = parseFloat(match[1]);
          }
          userMarker.setIcon(L.divIcon({
            className: 'custom-div-icon',
            html: getArrowSvg(curRot, isDark),
            iconSize: [56, 56],
            iconAnchor: [28, 28]
          }));
        }

        if (destinationMarker) {
          destinationMarker.setIcon(L.divIcon({
            className: 'custom-div-icon',
            html: getPinSvg(isDark),
            iconSize: [36, 44],
            iconAnchor: [18, 44]
          }));
        }

        if (routeMainPolyline) {
          var latlngs = routeMainPolyline.getLatLngs();
          if (routeGlowPolyline) {
            map.removeLayer(routeGlowPolyline);
            routeGlowPolyline = null;
          }
          map.removeLayer(routeMainPolyline);
          routeMainPolyline = null;

          if (isDark) {
            routeGlowPolyline = L.polyline(latlngs, {
              color: 'rgba(0, 229, 255, 0.3)',
              weight: 14,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);
            routeMainPolyline = L.polyline(latlngs, {
              color: '#00E5FF',
              weight: 6,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);
          } else {
            routeMainPolyline = L.polyline(latlngs, {
              color: '#2B5B84',
              weight: 6,
              lineCap: 'round',
              lineJoin: 'round'
            }).addTo(map);
          }
        }
      }

      function handleMessage(data) {
        if (!data || !map) return;
        switch (data.type) {
          case 'SET_THEME':
            setTheme(data.isDarkMode);
            break;
          case 'UPDATE_LOCATION':
            updateLocation(data.lat, data.lng, data.heading, data.followUser);
            break;
          case 'SET_ROUTE':
            setRoute(data.coordinates, data.destination);
            break;
          case 'ZOOM_IN':
            map.zoomIn();
            break;
          case 'ZOOM_OUT':
            map.zoomOut();
            break;
          case 'RECENTER':
            if (data.lat !== undefined && data.lng !== undefined) {
              map.panTo([data.lat, data.lng], { animate: true, duration: 0.6 });
            }
            break;
          case 'FIT_BOUNDS':
            if (data.coordinates && data.coordinates.length > 0) {
              var bounds = data.coordinates.map(function(c) { return [c.latitude, c.longitude]; });
              map.fitBounds(bounds, { padding: [60, 60], animate: true });
            }
            break;
          case 'PAN_TO':
            if (data.lat !== undefined && data.lng !== undefined) {
              map.panTo([data.lat, data.lng], { animate: true, duration: 0.6 });
            }
            break;
        }
      }

      window.handleAvanMessage = handleMessage;
      window.addEventListener('message', function(e) {
        try {
          var data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          handleMessage(data);
        } catch (err) {}
      });
      document.addEventListener('message', function(e) {
        try {
          var data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          handleMessage(data);
        } catch (err) {}
      });

      init();
    })();
  </script>
</body>
</html>`;
}

export const InteractiveMap = forwardRef<InteractiveMapRef, InteractiveMapProps>(
  (
    {
      isDarkMode,
      userLocation,
      routeCoordinates,
      destinationMarker,
      initialRegion,
      followUser = false,
      onRegionChangeComplete,
      onMapPress,
      style,
    },
    ref
  ) => {
    const webViewRef = useRef<WebView>(null);
    const [isMapReady, setIsMapReady] = useState<boolean>(false);

    // Clave opcional de CartoDB si el usuario la provee vía variable de entorno
    const cartoApiKey =
      typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CARTO_API_KEY
        ? process.env.EXPO_PUBLIC_CARTO_API_KEY.trim()
        : '';

    const initialLat = initialRegion?.latitude ?? DEFAULT_REGION.latitude;
    const initialLng = initialRegion?.longitude ?? DEFAULT_REGION.longitude;

    const sendMessage = useCallback((msg: object) => {
      const json = JSON.stringify(msg);
      webViewRef.current?.injectJavaScript(`
        if (window.handleAvanMessage) {
          window.handleAvanMessage(${json});
        }
        true;
      `);
    }, []);

    // Expone la API imperativa de control para botones y comandos de voz
    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        sendMessage({ type: 'ZOOM_IN' });
      },
      zoomOut: () => {
        sendMessage({ type: 'ZOOM_OUT' });
      },
      recenter: () => {
        if (userLocation) {
          sendMessage({
            type: 'RECENTER',
            lat: userLocation.latitude,
            lng: userLocation.longitude,
          });
        }
      },
      animateToRegion: (region: Region) => {
        sendMessage({
          type: 'PAN_TO',
          lat: region.latitude,
          lng: region.longitude,
        });
      },
      fitToCoordinates: (coordinates: LatLng[]) => {
        sendMessage({
          type: 'FIT_BOUNDS',
          coordinates,
        });
      },
      getCamera: async () => {
        return null;
      },
    }));

    // Sincronización del tema Día / Noche
    useEffect(() => {
      if (isMapReady) {
        sendMessage({ type: 'SET_THEME', isDarkMode });
      }
    }, [isDarkMode, isMapReady, sendMessage]);

    // Sincronización de ubicación y rumbo en tiempo real
    useEffect(() => {
      if (isMapReady && userLocation) {
        sendMessage({
          type: 'UPDATE_LOCATION',
          lat: userLocation.latitude,
          lng: userLocation.longitude,
          heading: userLocation.heading ?? 0,
          followUser,
        });
      }
    }, [
      isMapReady,
      userLocation?.latitude,
      userLocation?.longitude,
      userLocation?.heading,
      followUser,
      sendMessage,
    ]);

    // Sincronización de la polilínea de ruta y marcador de destino
    useEffect(() => {
      if (isMapReady) {
        sendMessage({
          type: 'SET_ROUTE',
          coordinates: routeCoordinates || [],
          destination: destinationMarker || null,
        });
      }
    }, [isMapReady, routeCoordinates, destinationMarker, sendMessage]);

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'MAP_READY') {
          setIsMapReady(true);
          // Enviar estado inicial acumulado
          if (userLocation) {
            sendMessage({
              type: 'UPDATE_LOCATION',
              lat: userLocation.latitude,
              lng: userLocation.longitude,
              heading: userLocation.heading ?? 0,
              followUser,
            });
          }
          if (routeCoordinates && routeCoordinates.length >= 2) {
            sendMessage({
              type: 'SET_ROUTE',
              coordinates: routeCoordinates,
              destination: destinationMarker || null,
            });
          }
        } else if (data.type === 'REGION_CHANGE' && onRegionChangeComplete) {
          onRegionChangeComplete(data.region);
        } else if (data.type === 'MAP_PRESS' && onMapPress) {
          onMapPress();
        }
      } catch (err) {
        console.warn('Error al procesar mensaje de Leaflet:', err);
      }
    };

    const htmlContent = generateLeafletHtml(initialLat, initialLng, isDarkMode, cartoApiKey);

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: isDarkMode ? '#0B111D' : '#F1F4F7' },
          style,
        ]}
      >
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent }}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          geolocationEnabled={false}
          originWhitelist={['*']}
          onMessage={handleMessage}
        />
      </View>
    );
  }
);

InteractiveMap.displayName = 'InteractiveMap';

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  webViewContainer: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  webView: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
});
