export interface ThemeColors {
  background: string;
  cardBackground: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  buttonOrange: string;
  buttonGlow: string;
  routeColor: string;
  arrowFill: string;
  arrowBorder: string;
  pinColor: string;
  headerIcon: string;
  avatarRing: string;
  mapBg: string;
  mapRoad: string;
  mapRoadBorder: string;
  mapLabel: string;
  mapPark: string;
}

export const lightTheme: ThemeColors = {
  background: '#F1F4F7',
  cardBackground: '#FFF9F0', // Fondo marfil suave como en mockup
  cardBorder: 'rgba(0, 0, 0, 0.08)',
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  buttonOrange: '#FF5722', // Naranja vibrante
  buttonGlow: 'rgba(255, 87, 34, 0.35)',
  routeColor: '#2B5B84', // Azul oscuro de ruta
  arrowFill: '#2B5B84',
  arrowBorder: '#16324A',
  pinColor: '#204669',
  headerIcon: '#111827',
  avatarRing: 'transparent',
  mapBg: '#F3F5F7',
  mapRoad: '#FFFFFF',
  mapRoadBorder: '#D8DEE4',
  mapLabel: '#4A5568',
  mapPark: '#D5ECD5',
};

export const darkTheme: ThemeColors = {
  background: '#0B111D',
  cardBackground: 'rgba(17, 26, 44, 0.88)', // Fondo oscuro translúcido
  cardBorder: 'rgba(56, 189, 248, 0.25)',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  buttonOrange: '#FF5722', // Naranja vibrante alto contraste
  buttonGlow: 'rgba(255, 87, 34, 0.65)',
  routeColor: '#00E5FF', // Cian neón luminoso
  arrowFill: 'transparent',
  arrowBorder: '#00E5FF',
  pinColor: '#00E5FF',
  headerIcon: '#F1F5F9',
  avatarRing: '#00E5FF', // Aro luminoso cian en avatar
  mapBg: '#0D1424',
  mapRoad: '#172238',
  mapRoadBorder: '#233352',
  mapLabel: '#94A3B8',
  mapPark: '#122B27',
};

export const typography = {
  greeting: {
    fontSize: 22,
    fontWeight: '800' as const,
    letterSpacing: 1.5,
  },
  instruction: {
    fontSize: 26,
    fontWeight: '700' as const,
  },
  mapLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
};

export const layout = {
  voiceButtonSize: 108,
  avatarSize: 52,
  borderRadius: 24,
  minTouchTarget: 72,
};
