import React, { useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  View,
  Animated,
  Text,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemeColors, layout } from '../theme/theme';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

interface VoiceActionButtonProps {
  theme: ThemeColors;
  voiceState: VoiceState;
  onPress: () => void;
  statusMessage?: string;
}

export const VoiceActionButton: React.FC<VoiceActionButtonProps> = ({
  theme,
  voiceState,
  onPress,
  statusMessage,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (voiceState === 'listening' || voiceState === 'speaking' || voiceState === 'processing') {
      const speed = voiceState === 'processing' ? 500 : 600;
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.16,
            duration: speed,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: speed,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceState]);

  const handlePress = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // Ignorar si haptics no está disponible en simulador web
    }
    onPress();
  };

  const getButtonColor = (): string => {
    switch (voiceState) {
      case 'listening':
        return '#22C55E'; // Verde
      case 'speaking':
        return '#3B82F6'; // Azul
      case 'processing':
        return '#D97706'; // Ámbar accesible
      case 'idle':
      default:
        return theme.buttonOrange || '#FF5722'; // Naranja
    }
  };

  const getHaloColor = (): string => {
    switch (voiceState) {
      case 'listening':
        return 'rgba(34, 197, 94, 0.45)';
      case 'speaking':
        return 'rgba(59, 130, 246, 0.45)';
      case 'processing':
        return 'rgba(217, 119, 6, 0.45)';
      case 'idle':
      default:
        return theme.buttonGlow || 'rgba(255, 87, 34, 0.35)';
    }
  };

  const getButtonIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (voiceState) {
      case 'listening':
        return 'mic';
      case 'speaking':
        return 'volume-high';
      case 'idle':
      default:
        return 'mic-outline';
    }
  };

  return (
    <View style={styles.wrapper}>
      {/* Mensaje de estado accesible sobre el botón */}
      {statusMessage ? (
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder },
          ]}
        >
          {voiceState === 'processing' ? (
            <View style={styles.processingBadgeContent}>
              <ActivityIndicator
                size="small"
                color={theme.textPrimary}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.statusText, { color: theme.textPrimary }]}>
                {statusMessage}
              </Text>
            </View>
          ) : (
            <Text style={[styles.statusText, { color: theme.textPrimary }]}>
              {statusMessage}
            </Text>
          )}
        </View>
      ) : null}

      {/* Contenedor dedicado que centra el halo y el botón perfectamente sin desfase */}
      <View style={styles.buttonContainer}>
        <Animated.View
          style={[
            styles.glowHalo,
            {
              backgroundColor: getHaloColor(),
              transform: [{ scale: pulseAnim }],
            },
          ]}
          pointerEvents="none"
        />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handlePress}
          style={[
            styles.button,
            {
              backgroundColor: getButtonColor(),
              shadowColor: getButtonColor(),
            },
          ]}
          accessibilityLabel="Botón de comunicación por voz"
          accessibilityHint="Presione para hablar con su asistente de viaje"
          accessibilityRole="button"
        >
          {voiceState === 'processing' ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            <Ionicons
              name={getButtonIcon()}
              size={52}
              color="#FFFFFF"
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    zIndex: 20,
  },
  statusBadge: {
    marginBottom: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  processingBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonContainer: {
    width: layout.voiceButtonSize + 48,
    height: layout.voiceButtonSize + 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowHalo: {
    position: 'absolute',
    width: layout.voiceButtonSize + 32,
    height: layout.voiceButtonSize + 32,
    borderRadius: (layout.voiceButtonSize + 32) / 2,
  },
  button: {
    width: layout.voiceButtonSize,
    height: layout.voiceButtonSize,
    borderRadius: layout.voiceButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF5722',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
});
