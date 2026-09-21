import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors, typography, layout } from '../theme/theme';

export interface GreetingCardProps {
  userName: string;
  theme: ThemeColors;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onToggleView?: () => void;
  destination?: string;
}

export const GreetingCard: React.FC<GreetingCardProps> = ({
  userName,
  theme,
  isDarkMode,
  onToggleTheme,
  onToggleView,
  destination,
}) => {
  return (
    <View style={styles.container}>
      {/* Barra superior con botón para alternar a vista sólo micrófono y selector de sol/luna */}
      <View style={[styles.topBar, onToggleView ? styles.topBarBetween : styles.topBarEnd]}>
        {onToggleView && (
          <TouchableOpacity
            onPress={onToggleView}
            style={[
              styles.viewToggle,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.cardBorder,
              },
            ]}
            accessibilityLabel="Cambiar a vista sólo micrófono"
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name="mic-outline"
              size={20}
              color={theme.textPrimary}
              style={styles.viewToggleIcon}
            />
            <Text style={[styles.viewToggleText, { color: theme.textPrimary }]}>
              Sólo Micrófono
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onToggleTheme}
          style={styles.themeToggle}
          accessibilityLabel={isDarkMode ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons
            name={isDarkMode ? 'moon' : 'sunny-outline'}
            size={32}
            color={theme.headerIcon}
          />
        </TouchableOpacity>
      </View>

      {/* Tarjeta flotante con saludo */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.cardBorder,
          },
          isDarkMode ? styles.darkCardGlow : styles.lightCardShadow,
        ]}
      >
        {/* Avatar con aro luminoso en modo oscuro */}
        <View
          style={[
            styles.avatarContainer,
            isDarkMode && {
              borderColor: theme.avatarRing,
              borderWidth: 2.5,
              shadowColor: theme.avatarRing,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.8,
              shadowRadius: 8,
            },
          ]}
        >
          <Image
            source={{
              uri: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
            }}
            style={styles.avatarImage}
          />
        </View>

        {/* Texto de saludo o destino en mayúsculas y alto contraste */}
        <View style={styles.textContainer}>
          <Text
            style={[
              typography.greeting,
              {
                color: theme.textPrimary,
              },
            ]}
            numberOfLines={1}
          >
            {destination ? `RUMBO A: ${destination.toUpperCase()}` : `HOLA, ${userName.toUpperCase()}`}
          </Text>
          {destination ? (
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: theme.buttonOrange,
                marginTop: 2,
              }}
              numberOfLines={1}
            >
              Navegación activa · {userName}
            </Text>
          ) : null}
        </View>

        {/* Pin de destino a la derecha */}
        <View style={styles.pinContainer}>
          <Ionicons name="location-sharp" size={26} color={theme.pinColor} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 50,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  topBarEnd: {
    justifyContent: 'flex-end',
  },
  topBarBetween: {
    justifyContent: 'space-between',
  },
  viewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  viewToggleIcon: {
    marginRight: 6,
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '700',
  },
  themeToggle: {
    padding: 6,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  lightCardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  darkCardGlow: {
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarContainer: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: layout.avatarSize / 2,
    overflow: 'hidden',
    backgroundColor: '#CCC',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    flex: 1,
    paddingHorizontal: 14,
  },
  pinContainer: {
    paddingLeft: 4,
  },
});
