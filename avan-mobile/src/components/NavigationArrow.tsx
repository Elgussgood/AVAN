import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ThemeColors } from '../theme/theme';

interface NavigationArrowProps {
  theme: ThemeColors;
  isDarkMode: boolean;
  size?: number;
  rotation?: number; // Grados de rotación según rumbo (heading)
}

export const NavigationArrow: React.FC<NavigationArrowProps> = ({
  theme,
  isDarkMode,
  size = 76,
  rotation = 0,
}) => {
  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          transform: [{ rotate: `${rotation}deg` }],
        },
        isDarkMode && styles.darkGlow,
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Flecha chevron estilizada conforme a los mockups */}
        <Path
          d="M50 8 L88 88 L50 68 L12 88 Z"
          fill={theme.arrowFill}
          stroke={theme.arrowBorder}
          strokeWidth={isDarkMode ? 5.5 : 4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkGlow: {
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 8,
  },
});
