import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Animated,
  useColorScheme,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { lightTheme, darkTheme, ThemeColors } from '../theme/theme';
import { VoiceService } from '../services/voiceService';
import { AudioRecorderService } from '../services/audioRecorderService';
import {
  ConversationService,
  ConversationContext,
} from '../services/conversationService';
import { orsService } from '../services/orsService';
import { LocationService } from '../services/locationService';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface RouteData {
  routeCoordinates: { latitude: number; longitude: number }[];
  destinationCoords: { latitude: number; longitude: number } | null;
  instruction: string;
  distance: number;
  duration: number;
}

export interface MinimalHomeScreenProps {
  onToggleView?: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  userName?: string;
  onStartTrip?: (destination: string, routeData?: RouteData) => void;
  context?: ConversationContext;
  onContextChange?: (context: ConversationContext) => void;
}

export const MinimalHomeScreen: React.FC<MinimalHomeScreenProps> = ({
  onToggleView,
  isDarkMode: propIsDarkMode,
  onToggleTheme: propOnToggleTheme,
  userName = 'GUSTAVO',
  onStartTrip,
  context: propContext,
  onContextChange,
}) => {
  const systemColorScheme = useColorScheme();
  const [internalDarkMode, setInternalDarkMode] = useState<boolean>(
    systemColorScheme === 'dark'
  );
  const isDarkMode = propIsDarkMode !== undefined ? propIsDarkMode : internalDarkMode;
  const handleToggleTheme =
    propOnToggleTheme || (() => setInternalDarkMode((prev) => !prev));

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const currentTheme: ThemeColors = isDarkMode ? darkTheme : lightTheme;

  // Contexto conversacional persistente
  const [currentContext, setCurrentContext] = useState<ConversationContext>(() => {
    return propContext || ConversationService.createInitialContext(userName);
  });

  // Mensaje visual de retroalimentación
  const [spokenMessage, setSpokenMessage] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState<boolean>(false);
  const [manualText, setManualText] = useState<string>('');

  // Sincronizar contexto entrante
  useEffect(() => {
    if (propContext) {
      setCurrentContext(propContext);
    }
  }, [propContext]);

  // Temporizador para auto-detención y transcripción de voz
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
    };
  }, []);

  // Animación del halo pulsante
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const haloOpacityAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (voiceState === 'listening' || voiceState === 'speaking') {
      // Pulso activo y continuo cuando el micrófono escucha o habla
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.35,
              duration: 700,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 700,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.85,
              duration: 700,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.35,
              duration: 700,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    } else {
      // Pulso suave y respiratorio en reposo para guiar la atención sin saturar
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.14,
              duration: 1600,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 1600,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.6,
              duration: 1600,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.25,
              duration: 1600,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    }

    animation.start();
    return () => animation.stop();
  }, [voiceState, pulseAnim, haloOpacityAnim]);

  /**
   * Procesa un comando de voz o texto a través de ConversationService
   */
  const handleProcessInput = async (inputText: string) => {
    const textToProcess = inputText.trim();
    if (!textToProcess) return;

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Ignorar si haptics no está disponible
    }

    setVoiceState('processing');

    // Detener grabación de audio
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }

    try {
      const response = await ConversationService.processUserMessage(
        textToProcess,
        currentContext
      );

      // Actualizar contexto
      setCurrentContext(response.updatedContext);
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      setSpokenMessage(response.spokenText);
      setVoiceState('speaking');

      // Reproducción de voz con VoiceService
      await VoiceService.speak(
        response.spokenText,
        () => {
          setVoiceState('idle');
        },
        () => {
          setVoiceState('speaking');
        }
      );

      // Si el viaje fue confirmado (Paso 2), calcular ruta real y transicionar a HomeScreen
      if (response.functionCall?.name === 'confirmar_viaje') {
        const dest =
          response.functionCall.args.destino ||
          response.updatedContext.activeRoute?.destination ||
          'Hospital General';

        setSpokenMessage(`Calculando la mejor ruta hacia ${dest}...`);

        try {
          const userLocation = await LocationService.getCurrentLocation();
          const startCoords = {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
          };

          // 1. Geocodificar destino
          const geocoded = await orsService.geocodeDestination(dest, startCoords);
          const targetCoords = geocoded[0]?.coordinates || {
            latitude: 19.4352,
            longitude: -99.1412,
          };

          // 2. Calcular ruta vehicular con ORS
          const routeResult = await orsService.getDirections(startCoords, targetCoords);
          const routeCoordinates = routeResult.coordinates.map((c) => ({
            latitude: c.latitude,
            longitude: c.longitude,
          }));

          const firstInstruction =
            routeResult.steps[0]?.instruction ||
            `Continúa recto hacia ${dest}`;

          const routeData: RouteData = {
            routeCoordinates,
            destinationCoords: {
              latitude: targetCoords.latitude,
              longitude: targetCoords.longitude,
            },
            instruction: firstInstruction,
            distance: routeResult.distance,
            duration: routeResult.duration,
          };

          setTimeout(() => {
            if (onStartTrip) {
              onStartTrip(dest, routeData);
            }
          }, 800);
        } catch (error) {
          console.warn('Error al calcular ruta vehicular:', error);
          if (onStartTrip) {
            onStartTrip(dest);
          }
        }
      }
    } catch (error) {
      console.warn('Error al procesar mensaje conversacional:', error);
      setVoiceState('idle');
    }
  };

  /**
   * Manejador de pulsación del botón central dominante de micrófono
   */
  const handleVoicePress = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // Ignorar si haptics no está disponible
    }

    if (voiceState === 'speaking') {
      await VoiceService.stop();
      setVoiceState('idle');
      return;
    }

    if (voiceState === 'listening') {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      setVoiceState('processing');

      // Si hay una confirmación pendiente, confirmar con "Sí"
      if (currentContext.pendingConfirmation) {
        await handleProcessInput('Sí');
      } else {
        const transcription = await AudioRecorderService.stopAndTranscribe();
        const speechText = transcription?.text || 'Hospital General';
        await handleProcessInput(speechText);
      }
      return;
    }

    if (voiceState === 'idle') {
      // Iniciar grabación de audio y pasar a estado listening
      const started = await AudioRecorderService.startRecording();
      if (!started) {
        setVoiceState('idle');
        return;
      }
      setVoiceState('listening');

      // Si hay confirmación pendiente, guiar al usuario
      if (currentContext.pendingConfirmation) {
        setSpokenMessage(
          `¿Desea iniciar el viaje a ${currentContext.pendingConfirmation.destination}?`
        );
      } else {
        setSpokenMessage('Diga su destino con calma...');
      }

      // Temporizador de auto-detención de 4.5 segundos para adultos mayores
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      recordingTimeoutRef.current = setTimeout(async () => {
        if (AudioRecorderService.isRecording()) {
          setVoiceState('processing');
          const transcription = await AudioRecorderService.stopAndTranscribe();
          const speechText =
            transcription?.text ||
            (currentContext.pendingConfirmation ? 'Sí' : 'Bellas Artes');
          await handleProcessInput(speechText);
        }
      }, 4500);
    }
  };

  /**
   * Texto de estado accesible WCAG AAA para la cabecera central
   */
  const getStatusText = (): string => {
    if (currentContext.pendingConfirmation) {
      return `¿Ir a ${currentContext.pendingConfirmation.destination}?`;
    }

    switch (voiceState) {
      case 'listening':
        return 'Te escucho...';
      case 'speaking':
        return 'Hablando...';
      case 'processing':
        return 'Procesando...';
      case 'idle':
      default:
        return 'Presiona para hablar';
    }
  };

  /**
   * Subtexto o instrucción descriptiva
   */
  const getInstructionHint = (): string => {
    if (currentContext.pendingConfirmation) {
      return 'Diga "Sí" para confirmar o "Cancelar" para detener';
    }

    switch (voiceState) {
      case 'listening':
        return 'Diga a dónde desea ir o elija una opción abajo';
      case 'speaking':
        return spokenMessage || 'Escuche con atención';
      case 'processing':
        return 'Calculando la mejor ruta...';
      case 'idle':
      default:
        return 'Toca el botón naranja para pedir indicaciones';
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <SafeAreaView style={styles.safeArea}>
        {/* 1. Barra Superior Discreta */}
        <View style={styles.topBar}>
          {onToggleView ? (
            <TouchableOpacity
              onPress={onToggleView}
              style={[
                styles.viewToggleButton,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.cardBorder,
                },
              ]}
              accessibilityLabel="Cambiar a vista con mapa"
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons
                name="map-outline"
                size={22}
                color={currentTheme.textPrimary}
                style={styles.viewToggleIcon}
              />
              <Text
                style={[
                  styles.viewToggleText,
                  { color: currentTheme.textPrimary },
                ]}
              >
                Ver Mapa
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.topBarSpacer} />
          )}

          {/* Selector de Modo Día / Modo Noche */}
          <TouchableOpacity
            onPress={handleToggleTheme}
            style={styles.themeToggle}
            accessibilityLabel={
              isDarkMode ? 'Cambiar a modo día' : 'Cambiar a modo noche'
            }
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name={isDarkMode ? 'moon' : 'sunny-outline'}
              size={32}
              color={currentTheme.headerIcon}
            />
          </TouchableOpacity>
        </View>

        {/* 2. Centro de la pantalla: One-Button UI pura con botón central dominante */}
        <View style={styles.centerContainer}>
          {/* Saludo accesible de alto contraste */}
          <Text
            style={[
              styles.greetingText,
              { color: currentTheme.textSecondary },
            ]}
          >
            HOLA, {userName.toUpperCase()}
          </Text>

          {/* Mensaje de estado accesible WCAG AAA */}
          <Text
            style={[
              styles.statusPrompt,
              { color: currentTheme.textPrimary },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole="header"
          >
            {getStatusText()}
          </Text>

          {/* Instrucción clara de orientación */}
          <Text
            style={[
              styles.instructionHint,
              { color: currentTheme.textSecondary },
            ]}
            numberOfLines={2}
          >
            {getInstructionHint()}
          </Text>

          {/* Botón Gigante del Micrófono (144dp) con halo animado */}
          <View style={styles.micButtonWrapper}>
            {/* Halo animado con escala y opacidad reactiva */}
            <Animated.View
              style={[
                styles.glowHalo,
                {
                  backgroundColor: currentTheme.buttonGlow,
                  opacity: haloOpacityAnim,
                  transform: [{ scale: pulseAnim }],
                },
              ]}
              pointerEvents="none"
            />

            {/* Botón circular táctil de alto contraste */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleVoicePress}
              style={[
                styles.micButton,
                {
                  backgroundColor: currentTheme.buttonOrange,
                },
              ]}
              accessibilityLabel="Botón principal de micrófono"
              accessibilityHint="Presiona para hablar y solicitar tu viaje"
              accessibilityRole="button"
            >
              <Ionicons
                name={
                  voiceState === 'listening'
                    ? 'mic'
                    : voiceState === 'speaking'
                    ? 'volume-high'
                    : 'mic-outline'
                }
                size={68}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          {/* 3. Comandos rápidos accesibles (Píldoras táctiles >= 48dp de alto contraste) */}
          <View style={styles.actionChipsContainer}>
            {currentContext.pendingConfirmation ? (
              // Opciones del Paso 2: Confirmación explícita
              <View style={styles.confirmationRow}>
                <TouchableOpacity
                  style={[
                    styles.actionChip,
                    styles.confirmChip,
                    { backgroundColor: '#16A34A' },
                  ]}
                  onPress={() => handleProcessInput('Sí')}
                  accessibilityLabel="Confirmar inicio del viaje"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color="#FFFFFF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.confirmChipText}>Sí, iniciar viaje</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionChip,
                    styles.cancelChip,
                    {
                      backgroundColor: currentTheme.cardBackground,
                      borderColor: currentTheme.cardBorder,
                    },
                  ]}
                  onPress={() => handleProcessInput('Cancelar')}
                  accessibilityLabel="Cancelar viaje"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={24}
                    color={currentTheme.textPrimary}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.actionChipText,
                      { color: currentTheme.textPrimary },
                    ]}
                  >
                    Cancelar
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              // Sugerencias de destinos frecuentes en reposo o al escuchar
              <View style={styles.chipsWrap}>
                <TouchableOpacity
                  style={[
                    styles.actionChip,
                    {
                      backgroundColor: currentTheme.cardBackground,
                      borderColor: currentTheme.cardBorder,
                    },
                  ]}
                  onPress={() => handleProcessInput('Llevarme a Bellas Artes')}
                  accessibilityLabel="Pedir ruta a Bellas Artes"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="navigate-outline"
                    size={20}
                    color={currentTheme.buttonOrange}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.actionChipText,
                      { color: currentTheme.textPrimary },
                    ]}
                  >
                    Bellas Artes
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionChip,
                    {
                      backgroundColor: currentTheme.cardBackground,
                      borderColor: currentTheme.cardBorder,
                    },
                  ]}
                  onPress={() =>
                    handleProcessInput('Quiero ir al Hospital General')
                  }
                  accessibilityLabel="Pedir ruta a Hospital General"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="medkit-outline"
                    size={20}
                    color={currentTheme.buttonOrange}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.actionChipText,
                      { color: currentTheme.textPrimary },
                    ]}
                  >
                    Hospital General
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Alternar entrada de texto accesible para pruebas o soporte multimodal */}
            <TouchableOpacity
              onPress={() => setShowManualInput((prev) => !prev)}
              style={styles.keyboardToggle}
              accessibilityLabel="Escribir o dictar manualmente un comando"
              accessibilityRole="button"
            >
              <Ionicons
                name={showManualInput ? 'chevron-up' : 'keypad-outline'}
                size={20}
                color={currentTheme.textSecondary}
              />
              <Text
                style={[
                  styles.keyboardToggleText,
                  { color: currentTheme.textSecondary },
                ]}
              >
                {showManualInput ? 'Ocultar teclado' : 'Escribir destino'}
              </Text>
            </TouchableOpacity>

            {showManualInput && (
              <View
                style={[
                  styles.manualInputWrapper,
                  {
                    backgroundColor: currentTheme.cardBackground,
                    borderColor: currentTheme.cardBorder,
                  },
                ]}
              >
                <TextInput
                  value={manualText}
                  onChangeText={setManualText}
                  placeholder="Ej: Ir a Bellas Artes, Sí, Cancelar..."
                  placeholderTextColor={currentTheme.textSecondary}
                  style={[
                    styles.textInputField,
                    { color: currentTheme.textPrimary },
                  ]}
                  onSubmitEditing={() => {
                    handleProcessInput(manualText);
                    setManualText('');
                  }}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    { backgroundColor: currentTheme.buttonOrange },
                  ]}
                  onPress={() => {
                    handleProcessInput(manualText);
                    setManualText('');
                  }}
                  accessibilityLabel="Enviar comando escrito"
                  accessibilityRole="button"
                >
                  <Ionicons name="send" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* 4. Espaciador inferior */}
        <View style={styles.bottomSpacer} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

const BUTTON_SIZE = 144;
const HALO_SIZE = BUTTON_SIZE + 50;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    minHeight: 56,
  },
  topBarSpacer: {
    width: 48,
  },
  viewToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    minHeight: 48,
  },
  viewToggleIcon: {
    marginRight: 8,
  },
  viewToggleText: {
    fontSize: 16,
    fontWeight: '700',
  },
  themeToggle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  greetingText: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  statusPrompt: {
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 38,
  },
  instructionHint: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 12,
    lineHeight: 24,
  },
  micButtonWrapper: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  glowHalo: {
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
  },
  micButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF5722',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  },
  actionChipsContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
    width: '100%',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1.5,
    minHeight: 48,
  },
  confirmChip: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    minHeight: 52,
  },
  confirmChipText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  cancelChip: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 52,
  },
  actionChipText: {
    fontSize: 16,
    fontWeight: '700',
  },
  keyboardToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  keyboardToggleText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  manualInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
  },
  textInputField: {
    flex: 1,
    height: 48,
    fontSize: 16,
    fontWeight: '600',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  bottomSpacer: {
    height: 16,
  },
});
