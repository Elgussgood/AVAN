import React, { useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  View,
  Animated,
  Text,
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
    if (voiceState === 'listening' || voiceState === 'speaking') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 600,
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
          <Text style={[styles.statusText, { color: theme.textPrimary }]}>
            {statusMessage}
          </Text>
        </View>
      ) : null}

      {/* Halo y Botón animado */}
      <Animated.View
        style={[
          styles.glowHalo,
          {
            backgroundColor: theme.buttonGlow,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        style={[
          styles.button,
          {
            backgroundColor: theme.buttonOrange,
          },
        ]}
        accessibilityLabel="Botón de comunicación por voz"
        accessibilityHint="Presiona para hablar con tu asistente de viaje"
        accessibilityRole="button"
      >
        <Ionicons
          name={voiceState === 'listening' ? 'mic' : 'mic-outline'}
          size={52}
          color="#FFFFFF"
        />
      </TouchableOpacity>
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
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
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
