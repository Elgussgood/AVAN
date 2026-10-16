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
  zoomIn: (intensity?: 'normal' | 'mucho' | 'poco') => void;
  zoomOut: (intensity?: 'normal' | 'mucho' | 'poco') => void;
  setZoom: (zoom: number) => void;
  recenter: (zoom?: number) => void;
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
  initialZoom?: number;
  followUser?: boolean;
  autoFitRoute?: boolean;
  onUserInteraction?: () => void;
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
 * Genera el documento HTML que ejecuta MapLibre GL JS v4 con aceleración WebGL:
 * 1. Estilo vectorial libre sin clave (OpenFreeMap Positron para Día y Dark para Noche).
 * 2. Paleta cromática adaptada a los mockups de AVAN:
 *    - Día: fondo #F1F4F7, calles #FFFFFF con contorno limpio, parques verdes #D5ECD5.
 *    - Noche: fondo #0B111D, vías #172238 con sutil borde #20334C, áreas verdes oscuras #0E232E.
 * 3. Rotación nativa con bearing de cámara en aceleración GPU de 60 FPS (POV conductor).
 * 4. Inclinación pitch a 45° en navegación activa estilo Google Maps.
 * 5. Fallback automático a teselas ráster de CartoDB si hay interrupción en la carga vectorial.
 */
function generateMapLibreHtml(
  initialLat: number,
  initialLng: number,
  isDarkMode: boolean,
  cartoApiKey: string,
  initialZoom: number = 14,
  autoFitRoute: boolean = false
): string {
  const bgColor = isDarkMode ? '#0B111D' : '#F1F4F7';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
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
    .maplibregl-map {
      background-color: ${bgColor} !important;
    }
    .maplibregl-canvas {
      outline: none;
    }
    .custom-marker {
      background: transparent !important;
      border: none !important;
      cursor: pointer;
    }
    /* Ocultar atribuciones intrusivas para mantener la pantalla 100% despejada para adultos mayores */
    .maplibregl-ctrl-attrib {
      display: none !important;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    (function() {
      var map = null;
      var userMarker = null;
      var destinationMarker = null;
      var isMapLoaded = false;
      var styleFallbackActive = false;
      var currentThemeDark = ${isDarkMode ? 'true' : 'false'};
      var activeLoadedTheme = ${isDarkMode ? "'dark'" : "'light'"};

      var hasCartoKey = ${cartoApiKey ? 'true' : 'false'};
      var CARTO_KEY = ${JSON.stringify(cartoApiKey)};

      // Estilos vectoriales ultra-limpios de OpenFreeMap (sin claves ni límites)
      var LIGHT_VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/positron';
      var DARK_VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/dark';

      // Fallback ráster de CartoDB
      var DARK_CARTO = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' + (CARTO_KEY ? '?api_key=' + encodeURIComponent(CARTO_KEY) : '');
      var LIGHT_CARTO = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png' + (CARTO_KEY ? '?api_key=' + encodeURIComponent(CARTO_KEY) : '');

      var pendingRouteCoords = null;
      var pendingDestination = null;
      var pendingUserLocation = null;
      var currentSmoothedBearing = null;
      var currentTargetZoom = ${initialZoom};

      function getArrowSvg(heading, isDark) {
        var fill = isDark ? 'transparent' : '#2B5B84';
        var stroke = isDark ? '#00E5FF' : '#16324A';
        var strokeW = isDark ? '6.5' : '5';
        var shadow = isDark
          ? 'filter: drop-shadow(0px 0px 8px #00E5FF);'
          : 'filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.35));';

        return '<div id="arrow-rotator" style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; transform: rotate(' + heading + 'deg); transform-origin: center center; transition: transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1);">'
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

      function getRasterFallbackStyle(isDark) {
        var tileUrl = isDark ? DARK_CARTO : LIGHT_CARTO;
        return {
          version: 8,
          sources: {
            'raster-tiles': {
              type: 'raster',
              tiles: [tileUrl],
              tileSize: 256,
              attribution: '© CARTO, © OpenStreetMap'
            }
          },
          layers: [
            {
              id: 'raster-layer',
              type: 'raster',
              source: 'raster-tiles',
              minzoom: 0,
              maxzoom: 20
            }
          ]
        };
      }

      function setupRouteLayers() {
        if (!map) return;

        var lineCoords = (pendingRouteCoords && pendingRouteCoords.length >= 2)
          ? pendingRouteCoords.map(function(c) { return [c.longitude, c.latitude]; })
          : [];

        if (!map.getSource('route-source')) {
          map.addSource('route-source', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: lineCoords
              }
            }
          });
        } else {
          var src = map.getSource('route-source');
          if (src && lineCoords.length >= 2) {
            src.setData({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: lineCoords
              }
            });
          }
        }

        if (!map.getLayer('route-glow')) {
          map.addLayer({
            id: 'route-glow',
            type: 'line',
            source: 'route-source',
            layout: {
              'line-cap': 'round',
              'line-join': 'round'
            },
            paint: {
              'line-color': currentThemeDark ? '#00E5FF' : '#16324A',
              'line-width': currentThemeDark ? 14 : 10,
              'line-opacity': currentThemeDark ? 0.38 : 0.25,
              'line-blur': currentThemeDark ? 4 : 0
            }
          });
        }

        if (!map.getLayer('route-main')) {
          map.addLayer({
            id: 'route-main',
            type: 'line',
            source: 'route-source',
            layout: {
              'line-cap': 'round',
              'line-join': 'round'
            },
            paint: {
              'line-color': currentThemeDark ? '#00E5FF' : '#2B5B84',
              'line-width': 6.5,
              'line-opacity': 1.0
            }
          });
        }
      }

      function init() {
        if (typeof maplibregl === 'undefined') {
          setTimeout(init, 50);
          return;
        }

        try {
          map = new maplibregl.Map({
            container: 'map',
            style: currentThemeDark ? DARK_VECTOR_STYLE : LIGHT_VECTOR_STYLE,
            center: [${initialLng}, ${initialLat}],
            zoom: ${initialZoom},
            bearing: 0,
            pitch: 0,
            attributionControl: false,
            fadeDuration: 150
          });

          map.on('load', function() {
            isMapLoaded = true;
            setupRouteLayers();

            if (pendingRouteCoords) {
              applyRouteData(pendingRouteCoords, pendingDestination);
            }
            if (pendingUserLocation) {
              updateLocation(
                pendingUserLocation.lat,
                pendingUserLocation.lng,
                pendingUserLocation.heading,
                pendingUserLocation.followUser,
                pendingUserLocation.speed
              );
            }

            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
            }
          });

          map.on('style.load', function() {
            setupRouteLayers();
            if (pendingRouteCoords) {
              applyRouteData(pendingRouteCoords, pendingDestination);
            }
          });

          map.on('error', function(e) {
            if (e && e.error && e.error.message && e.error.message.includes('style') && !styleFallbackActive) {
              console.warn('[MapLibre] Fallback a teselas ráster por incidencia de red:', e.error);
              styleFallbackActive = true;
              map.setStyle(getRasterFallbackStyle(currentThemeDark));
            }
          });

          map.on('click', function() {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_PRESS' }));
            }
          });

          // Detección de gestos táctiles de exploración del usuario (solo interacción real, ignorando animaciones automáticas)
          map.on('dragstart', function(e) {
            if (e && e.originalEvent && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'USER_INTERACTION' }));
            }
          });
          map.on('rotatestart', function(e) {
            if (e && e.originalEvent && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'USER_INTERACTION' }));
            }
          });
          map.on('pitchstart', function(e) {
            if (e && e.originalEvent && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'USER_INTERACTION' }));
            }
          });
          map.on('zoomstart', function(e) {
            if (e && e.originalEvent && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'USER_INTERACTION' }));
            }
          });
          map.on('zoom', function(e) {
            if (e && e.originalEvent && map) {
              currentTargetZoom = map.getZoom();
            }
          });

          map.on('moveend', function() {
            var center = map.getCenter();
            var bounds = map.getBounds();
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'REGION_CHANGE',
                region: {
                  latitude: center.lat,
                  longitude: center.lng,
                  latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
                  longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest())
                }
              }));
            }
          });

        } catch (initErr) {
          console.error('[MapLibre] Error de inicialización WebGL:', initErr);
        }
      }

      function updateLocation(lat, lng, heading, followUser, speed) {
        if (!map) return;
        if (!isMapLoaded) {
          pendingUserLocation = { lat: lat, lng: lng, heading: heading, followUser: followUser, speed: speed };
          return;
        }

        var rawHeading = (typeof heading === 'number' && !isNaN(heading)) ? heading : 0;
        var currentSpeed = (typeof speed === 'number' && !isNaN(speed)) ? speed : 0;

        if (currentSmoothedBearing === null) {
          currentSmoothedBearing = rawHeading;
        }

        // 1. Diferencia angular más corta (-180 a +180) para evitar giros de 350° al cruzar el norte
        var angleDiff = ((rawHeading - currentSmoothedBearing + 540) % 360) - 180;

        // 2. Filtro de vehículo detenido / marcha mínima (< 1.2 m/s / ~4 km/h):
        var isStationary = currentSpeed < 1.2;
        if (isStationary && Math.abs(angleDiff) < 22) {
          angleDiff = 0;
        }

        // 3. Umbral de banda muerta (Deadband Threshold):
        if (Math.abs(angleDiff) >= 3.5) {
          var alpha = 0.28;
          currentSmoothedBearing = (currentSmoothedBearing + (angleDiff * alpha) + 360) % 360;
        }

        // Perspectiva POV 3D del conductor (Google Maps):
        // En MapLibre GL JS, bearing: theta orienta el rumbo theta hacia arriba en pantalla.
        // Inclinación pitch: 45° aporta la perspectiva de carretera del parabrisas.
        // Se incluye siempre zoom: currentTargetZoom para que el seguimiento GPS nunca cancele
        // la transición de zoom de RECENTER (17) ni los niveles de intensidad de ZOOM_IN / ZOOM_OUT.
        if (followUser) {
          map.easeTo({
            center: [lng, lat],
            zoom: currentTargetZoom,
            bearing: currentSmoothedBearing,
            pitch: 45,
            duration: 450,
            easing: function(t) { return t; }
          });
        }

        // Si el mapa rota con el rumbo (followUser: true), la flecha vehicular en pantalla apunta hacia arriba (0deg).
        // Si el usuario explora libremente, la flecha indica el rumbo relativo respecto a la rotación actual del mapa:
        var mapBearing = map.getBearing ? map.getBearing() : 0;
        var arrowRot = followUser ? 0 : (((currentSmoothedBearing - mapBearing) % 360 + 360) % 360);

        if (!userMarker) {
          var markerDiv = document.createElement('div');
          markerDiv.className = 'custom-marker';
          markerDiv.innerHTML = getArrowSvg(arrowRot, currentThemeDark);
          userMarker = new maplibregl.Marker({
            element: markerDiv,
            anchor: 'center',
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport'
          }).setLngLat([lng, lat]).addTo(map);
        } else {
          userMarker.setLngLat([lng, lat]);
          var elem = document.getElementById('arrow-rotator');
          if (elem) {
            elem.style.transform = 'rotate(' + arrowRot + 'deg)';
          } else {
            var container = userMarker.getElement();
            if (container) {
              container.innerHTML = getArrowSvg(arrowRot, currentThemeDark);
            }
          }
        }
      }

      function applyRouteData(coords, destination) {
        pendingRouteCoords = coords;
        pendingDestination = destination;

        if (!map || !isMapLoaded) return;

        setupRouteLayers();

        var source = map.getSource('route-source');
        if (source) {
          var lineCoords = (coords && coords.length >= 2)
            ? coords.map(function(c) { return [c.longitude, c.latitude]; })
            : [];

          source.setData({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: lineCoords
            }
          });

          if (lineCoords.length >= 2 && ${autoFitRoute ? 'true' : 'false'}) {
            try {
              var bounds = new maplibregl.LngLatBounds();
              lineCoords.forEach(function(pt) { bounds.extend(pt); });
              map.fitBounds(bounds, {
                padding: { top: 90, bottom: 160, left: 40, right: 40 },
                maxZoom: 16,
                duration: 600
              });
            } catch(e) {}
          }
        }

        if (destination) {
          if (!destinationMarker) {
            var pinDiv = document.createElement('div');
            pinDiv.className = 'custom-marker';
            pinDiv.innerHTML = getPinSvg(currentThemeDark);
            destinationMarker = new maplibregl.Marker({
              element: pinDiv,
              anchor: 'bottom'
            }).setLngLat([destination.longitude, destination.latitude]).addTo(map);
          } else {
            destinationMarker.setLngLat([destination.longitude, destination.latitude]);
          }

          if (!coords || coords.length < 2) {
            currentTargetZoom = ${initialZoom};
            map.easeTo({
              center: [destination.longitude, destination.latitude],
              zoom: currentTargetZoom,
              duration: 500
            });
          }
        } else if (destinationMarker) {
          destinationMarker.remove();
          destinationMarker = null;
        }
      }

      function setTheme(isDark) {
        var requestedTheme = isDark ? 'dark' : 'light';
        var themeChanged = requestedTheme !== activeLoadedTheme;
        currentThemeDark = isDark;
        var bg = isDark ? '#0B111D' : '#F1F4F7';
        document.body.style.backgroundColor = bg;
        var mapEl = document.getElementById('map');
        if (mapEl) mapEl.style.backgroundColor = bg;

        if (map && themeChanged) {
          activeLoadedTheme = requestedTheme;
          var targetStyle = styleFallbackActive
            ? getRasterFallbackStyle(isDark)
            : (isDark ? DARK_VECTOR_STYLE : LIGHT_VECTOR_STYLE);
          map.setStyle(targetStyle);
        } else if (map) {
          if (map.getLayer('route-glow')) {
            map.setPaintProperty('route-glow', 'line-color', isDark ? '#00E5FF' : '#16324A');
            map.setPaintProperty('route-glow', 'line-width', isDark ? 14 : 10);
            map.setPaintProperty('route-glow', 'line-opacity', isDark ? 0.38 : 0.25);
            map.setPaintProperty('route-glow', 'line-blur', isDark ? 4 : 0);
          }
          if (map.getLayer('route-main')) {
            map.setPaintProperty('route-main', 'line-color', isDark ? '#00E5FF' : '#2B5B84');
          }
        }

        if (userMarker) {
          var container = userMarker.getElement();
          if (container) {
            var elem = document.getElementById('arrow-rotator');
            var curRot = 0;
            if (elem && elem.style.transform) {
              var match = elem.style.transform.match(/rotate\(([-\d.]+)deg\)/);
              if (match) curRot = parseFloat(match[1]);
            }
            container.innerHTML = getArrowSvg(curRot, isDark);
          }
        }

        if (destinationMarker) {
          var pContainer = destinationMarker.getElement();
          if (pContainer) {
            pContainer.innerHTML = getPinSvg(isDark);
          }
        }
      }

      function handleMessage(data) {
        if (!data) return;
        switch (data.type) {
          case 'SET_THEME':
            setTheme(data.isDarkMode);
            break;
          case 'UPDATE_LOCATION':
            updateLocation(data.lat, data.lng, data.heading, data.followUser, data.speed);
            break;
          case 'SET_ROUTE':
            applyRouteData(data.coordinates, data.destination);
            break;
          case 'ZOOM_IN':
            if (!map) return;
            var baseInZoom = (typeof currentTargetZoom === 'number' && !isNaN(currentTargetZoom)) ? currentTargetZoom : map.getZoom();
            var inDelta = 1.8;
            if (data && data.intensity === 'mucho') inDelta = 3.2;
            else if (data && data.intensity === 'poco') inDelta = 0.8;
            currentTargetZoom = Math.min(19.5, baseInZoom + inDelta);
            map.easeTo({ zoom: currentTargetZoom, duration: 400 });
            break;
          case 'ZOOM_OUT':
            if (!map) return;
            var baseOutZoom = (typeof currentTargetZoom === 'number' && !isNaN(currentTargetZoom)) ? currentTargetZoom : map.getZoom();
            var outDelta = 1.8;
            if (data && data.intensity === 'mucho') outDelta = 3.8;
            else if (data && data.intensity === 'poco') outDelta = 0.8;
            currentTargetZoom = Math.max(10, baseOutZoom - outDelta);
            map.easeTo({ zoom: currentTargetZoom, duration: 400 });
            break;
          case 'SET_ZOOM':
            if (map && data && typeof data.zoom === 'number') {
              currentTargetZoom = Math.max(10, Math.min(19.5, data.zoom));
              map.easeTo({ zoom: currentTargetZoom, duration: 350 });
            }
            break;
          case 'RECENTER':
            var recenterLng = (data && data.lng !== undefined && data.lng !== null) ? data.lng : (userMarker ? userMarker.getLngLat().lng : null);
            var recenterLat = (data && data.lat !== undefined && data.lat !== null) ? data.lat : (userMarker ? userMarker.getLngLat().lat : null);
            var targetZoom = (data && typeof data.zoom === 'number') ? data.zoom : 17;
            currentTargetZoom = targetZoom;
            if (data && typeof data.heading === 'number' && !isNaN(data.heading)) {
              currentSmoothedBearing = data.heading;
            }
            if (map && recenterLng !== null && recenterLat !== null) {
              map.easeTo({
                center: [recenterLng, recenterLat],
                zoom: currentTargetZoom,
                bearing: currentSmoothedBearing || 0,
                pitch: 45,
                duration: 600
              });
            } else if (map) {
              map.easeTo({
                zoom: currentTargetZoom,
                bearing: currentSmoothedBearing || 0,
                pitch: 45,
                duration: 600
              });
            }
            break;
          case 'FIT_BOUNDS':
            if (map && data.coordinates && data.coordinates.length > 0) {
              var bounds = new maplibregl.LngLatBounds();
              data.coordinates.forEach(function(c) {
                bounds.extend([c.longitude, c.latitude]);
              });
              map.fitBounds(bounds, { padding: 60, duration: 600 });
            }
            break;
          case 'PAN_TO':
            if (map && data.lat !== undefined && data.lng !== undefined) {
              map.panTo([data.lng, data.lat], { duration: 500 });
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
      initialZoom = 14,
      followUser = false,
      autoFitRoute = false,
      onUserInteraction,
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

    const initialLat =
      initialRegion?.latitude ??
      userLocation?.latitude ??
      (routeCoordinates && routeCoordinates[0]?.latitude) ??
      DEFAULT_REGION.latitude;
    const initialLng =
      initialRegion?.longitude ??
      userLocation?.longitude ??
      (routeCoordinates && routeCoordinates[0]?.longitude) ??
      DEFAULT_REGION.longitude;

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
      zoomIn: (intensity?: 'normal' | 'mucho' | 'poco') => {
        sendMessage({ type: 'ZOOM_IN', intensity: intensity || 'normal' });
      },
      zoomOut: (intensity?: 'normal' | 'mucho' | 'poco') => {
        sendMessage({ type: 'ZOOM_OUT', intensity: intensity || 'normal' });
      },
      setZoom: (zoom: number) => {
        sendMessage({ type: 'SET_ZOOM', zoom });
      },
      recenter: (zoom?: number) => {
        sendMessage({
          type: 'RECENTER',
          lat: userLocation?.latitude,
          lng: userLocation?.longitude,
          heading: userLocation?.heading ?? 0,
          zoom: zoom !== undefined ? zoom : 17,
        });
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
          speed: userLocation.speed ?? 0,
          followUser,
        });
      }
    }, [
      isMapReady,
      userLocation?.latitude,
      userLocation?.longitude,
      userLocation?.heading,
      userLocation?.speed,
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
              speed: userLocation.speed ?? 0,
              followUser,
            });
          }
          if ((routeCoordinates && routeCoordinates.length >= 2) || destinationMarker) {
            sendMessage({
              type: 'SET_ROUTE',
              coordinates: routeCoordinates || [],
              destination: destinationMarker || null,
            });
          }
        } else if (data.type === 'USER_INTERACTION' && onUserInteraction) {
          onUserInteraction();
        } else if (data.type === 'REGION_CHANGE' && onRegionChangeComplete) {
          onRegionChangeComplete(data.region);
        } else if (data.type === 'MAP_PRESS' && onMapPress) {
          onMapPress();
        }
      } catch (err) {
        console.warn('Error al procesar mensaje de MapLibre:', err);
      }
    };

    const htmlContent = generateMapLibreHtml(
      initialLat,
      initialLng,
      isDarkMode,
      cartoApiKey,
      initialZoom,
      autoFitRoute
    );

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
