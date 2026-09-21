import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, {
  Path,
  Rect,
  Circle,
  G,
  Polyline,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors, typography } from '../theme/theme';

interface MapBackgroundProps {
  theme: ThemeColors;
  isDarkMode: boolean;
  zoomLevel?: number;
}

export const MapBackground: React.FC<MapBackgroundProps> = ({
  theme,
  isDarkMode,
  zoomLevel = 1.0,
}) => {
  return (
    <View style={[styles.container, { backgroundColor: theme.mapBg }]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [{ scale: zoomLevel }],
          },
        ]}
      >
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 800">
        {/* Calles secundarias (trazado urbano simplificado) */}
        <G stroke={theme.mapRoad} strokeWidth="18" strokeLinecap="round">
          {/* Calles horizontales */}
          <Path d="M-20 180 L420 180" />
          <Path d="M-20 320 L420 320" />
          <Path d="M-20 480 L420 480" />
          <Path d="M-20 620 L420 620" />

          {/* Calles verticales y diagonales */}
          <Path d="M90 -20 L90 820" />
          <Path d="M220 -20 L220 820" />
          <Path d="M330 -20 L330 820" />
          <Path d="M-20 80 L350 400" />
          <Path d="M120 400 L380 820" />
        </G>

        {/* Zona verde / Parque */}
        <Rect
          x="260"
          y="520"
          width="120"
          height="160"
          rx="12"
          fill={theme.mapPark}
        />

        {/* Polilínea de ruta vehicular activa hacia el destino */}
        <Polyline
          points="200,430 250,430 250,300 320,300 320,260"
          fill="none"
          stroke={theme.routeColor}
          strokeWidth={isDarkMode ? 6.5 : 6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Halo luminoso de la ruta en modo oscuro */}
        {isDarkMode && (
          <Polyline
            points="200,430 250,430 250,300 320,300 320,260"
            fill="none"
            stroke="#00E5FF"
            strokeWidth={14}
            strokeOpacity={0.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Círculo indicador de posición en ruta */}
        <Circle cx="200" cy="430" r="5" fill={theme.routeColor} />
      </Svg>

      {/* Etiquetas de calles y puntos de interés de alto contraste */}
      <View style={styles.labelsOverlay} pointerEvents="none">
        {/* Gran Vía */}
        <View style={[styles.labelBadge, { top: 328, left: 140 }]}>
          <Text style={[typography.mapLabel, { color: theme.mapLabel }]}>
            Gran Vía
          </Text>
        </View>

        {/* Centro de Cultura */}
        <View style={[styles.labelBadge, { top: 370, left: 24 }]}>
          <Text style={[typography.mapLabel, { color: theme.mapLabel }]}>
            Centro de Cultura
          </Text>
        </View>

        {/* Parque */}
        <View style={[styles.parkBadge, { top: 540, left: 280 }]}>
          <Ionicons
            name="leaf"
            size={18}
            color={isDarkMode ? '#34D399' : '#15803D'}
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              typography.mapLabel,
              { color: isDarkMode ? '#A7F3D0' : '#166534' },
            ]}
          >
            Parque
          </Text>
        </View>
      </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
  },
  labelsOverlay: {
    ...StyleSheet.absoluteFill,
  },
  labelBadge: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  parkBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
});
