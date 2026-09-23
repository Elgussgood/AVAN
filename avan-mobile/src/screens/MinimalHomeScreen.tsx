import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  Animated,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { lightTheme, darkTheme, ThemeColors } from '../theme/theme';
import { VoiceService } from '../services/voiceService';
import { AudioRecorderService } from '../services/audioRecorderService';
import {
  ConversationService,
  ConversationContext,
} from '../services/conversationService';
import { orsService, StepInstruction } from '../services/orsService';
import { LocationService } from '../services/locationService';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface RouteData {
  routeCoordinates: { latitude: number; longitude: number }[];
  destinationCoords: { latitude: number; longitude: number } | null;
  instruction: string;
  distance: number;
  duration: number;
  steps?: StepInstruction[];
}

export interface MinimalHomeScreenProps {
  onToggleView?: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  onSetThemeMode?: (dark: boolean) => void;
  userName?: string;
  onStartTrip?: (destination: string, routeData?: RouteData) => void;
  context?: ConversationContext;
  onContextChange?: (context: ConversationContext) => void;
}

export const MinimalHomeScreen: React.FC<MinimalHomeScreenProps> = ({
  onToggleView,
  isDarkMode: propIsDarkMode,
  onToggleTheme: propOnToggleTheme,
  onSetThemeMode,
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
  const contextRef = useRef<ConversationContext>(currentContext);

  useEffect(() => {
    contextRef.current = currentContext;
  }, [currentContext]);

  // Mensaje visual de retroalimentación
  const [spokenMessage, setSpokenMessage] = useState<string>('');

  // Estado de carga gerontológico para preparación de viaje
  const [isLoadingTrip, setIsLoadingTrip] = useState<boolean>(false);
  const [loadingDestination, setLoadingDestination] = useState<string>('');

  // Sincronizar contexto entrante
  useEffect(() => {
    if (propContext) {
      setCurrentContext(propContext);
      contextRef.current = propContext;
    }
  }, [propContext]);

  // T-1.1: Saludo temporal autodesvanecible tras 4 segundos
  const greetingOpacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(greetingOpacityAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }).start();
    }, 4000);

    return () => clearTimeout(timer);
  }, [greetingOpacityAnim]);

  // T-2.6: Saludo y guía auditiva al iniciar la app (reproducido solo una vez con retardo de 800ms)
  const hasAnnouncedWelcomeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!hasAnnouncedWelcomeRef.current) {
      hasAnnouncedWelcomeRef.current = true;
      const timer = setTimeout(async () => {
        setVoiceState('speaking');
        await VoiceService.speak(
          `Hola ${userName}. Presione el botón naranja para pedir indicaciones.`,
          () => {
            setVoiceState('idle');
          }
        );
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [userName]);

  // Temporizador para auto-detención y transcripción de voz (8 segundos)
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
    };
  }, []);

  // T-1.3: Animación del halo pulsante y ondas concéntricas
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current; // Segunda onda concéntrica al escuchar
  const haloOpacityAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (voiceState === 'listening') {
      // Ondas concéntricas activas (efecto radar/ecualizador de audio)
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.38,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 750,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.delay(180),
            Animated.timing(pulseAnim2, {
              toValue: 1.55,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim2, {
              toValue: 1.0,
              duration: 570,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.9,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.25,
              duration: 750,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    } else if (voiceState === 'speaking') {
      // Halo oscilante y continuo azul durante la respuesta
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.25,
              duration: 650,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 650,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.8,
              duration: 650,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.4,
              duration: 650,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    } else if (voiceState === 'processing') {
      // Halo rítmico ámbar durante la consulta de IA / TTS
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.22,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.85,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.35,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    } else {
      // Pulso suave y respiratorio en reposo (Naranja)
      animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.12,
              duration: 2200,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(haloOpacityAnim, {
              toValue: 0.55,
              duration: 2200,
              useNativeDriver: true,
            }),
            Animated.timing(haloOpacityAnim, {
              toValue: 0.2,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    }

    animation.start();
    return () => animation.stop();
  }, [voiceState, pulseAnim, pulseAnim2, haloOpacityAnim]);

  /**
   * T-1.3: Sistema Cromático del Botón (Sin Texto)
   * Naranja: Inactivo / Reposo (#FF5722)
   * Verde: Escuchando (#22C55E)
   * Azul: Respondiendo (#3B82F6)
   * Ámbar: Procesando / Consultando IA (#D97706)
   */
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
        return '#FF5722'; // Naranja
    }
  };

  const getHaloColor = (): string => {
    switch (voiceState) {
      case 'listening':
        return 'rgba(34, 197, 94, 0.45)'; // Verde
      case 'speaking':
        return 'rgba(59, 130, 246, 0.45)'; // Azul
      case 'processing':
        return 'rgba(217, 119, 6, 0.45)'; // Ámbar
      case 'idle':
      default:
        return currentTheme.buttonGlow || 'rgba(255, 87, 34, 0.35)'; // Naranja
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

    // T-1.2: Cambio de tema por voz
    const lower = textToProcess.toLowerCase();
    if (lower.includes('modo noche') || lower.includes('modo oscuro')) {
      if (onSetThemeMode) onSetThemeMode(true);
      else if (!isDarkMode && handleToggleTheme) handleToggleTheme();
      const msg = 'Cambiando a modo noche.';
      setSpokenMessage(msg);
      setVoiceState('speaking');
      await VoiceService.speak(msg, () => setVoiceState('idle'));
      return;
    }
    if (lower.includes('modo día') || lower.includes('modo dia') || lower.includes('modo claro')) {
      if (onSetThemeMode) onSetThemeMode(false);
      else if (isDarkMode && handleToggleTheme) handleToggleTheme();
      const msg = 'Cambiando a modo día.';
      setSpokenMessage(msg);
      setVoiceState('speaking');
      await VoiceService.speak(msg, () => setVoiceState('idle'));
      return;
    }

    setVoiceState('processing');

    // Detener grabación de audio
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }

    try {
      const response = await ConversationService.processUserMessage(
        textToProcess,
        contextRef.current
      );

      // Actualizar contexto
      contextRef.current = response.updatedContext;
      setCurrentContext(response.updatedContext);
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      // Si el viaje fue confirmado (Paso 2), activar pantalla de carga gerontológica y calcular ruta
      if (response.functionCall?.name === 'confirmar_viaje') {
        const dest =
          response.functionCall.args.destino ||
          response.updatedContext.activeRoute?.destination ||
          'Hospital General';

        setIsLoadingTrip(true);
        setLoadingDestination(dest);

        const preparingMsg =
          response.spokenText ||
          `Calculando la mejor ruta hacia ${dest}, por favor espere un momento.`;
        setSpokenMessage(preparingMsg);
        setVoiceState('speaking');

        // Reproducir auditivamente mensaje tranquilizador
        await VoiceService.speak(preparingMsg, () => {
          setVoiceState('idle');
        });

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
            steps: routeResult.steps,
          };

          setIsLoadingTrip(false);
          if (onStartTrip) {
            onStartTrip(dest, routeData);
          }
        } catch (error) {
          console.warn('Error al calcular ruta vehicular:', error);
          setIsLoadingTrip(false);
          if (onStartTrip) {
            onStartTrip(dest);
          }
        }
        return;
      }

      setSpokenMessage(response.spokenText);
      setVoiceState('speaking');

      // Reproducción de voz con VoiceService
      await VoiceService.speak(
        response.spokenText,
        async () => {
          // Requerimiento gerontológico: Coherencia estricta entre mensaje y escucha activa
          // Si el asistente emitió una despedida o cortesía de cierre, NUNCA abrir el micrófono.
          const isFarewell =
            /(?:hasta luego|excelente d[ií]a|buen d[ií]a|buenas noches|a su disposici[oó]n|nos vemos|adi[oó]s|que descanse|cu[ií]dese|que le vaya bien|con mucho gusto)/i.test(
              response.spokenText
            );

          const shouldAutoListen =
            !isFarewell &&
            (response.shouldAutoListen !== undefined
              ? response.shouldAutoListen
              : Boolean(response.updatedContext.pendingConfirmation) ||
                (Boolean(response.updatedContext.pendingTripCompletion) && response.spokenText.includes('?')) ||
                response.spokenText.toLowerCase().includes('otro lugar') ||
                response.spokenText.toLowerCase().includes('a dónde desea ir') ||
                response.spokenText.toLowerCase().includes('a donde desea ir') ||
                response.spokenText.toLowerCase().includes('a qué lugar'));

          if (shouldAutoListen) {
            try {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {
              // Ignorar si haptics no está disponible
            }

            const started = await AudioRecorderService.startRecording();
            if (started) {
              setVoiceState('listening');
              if (response.updatedContext.pendingConfirmation) {
                setSpokenMessage(
                  `¿Desea iniciar el viaje a ${response.updatedContext.pendingConfirmation.destination}?`
                );
              } else if (response.updatedContext.pendingTripCompletion) {
                setSpokenMessage('¿Desea viajar a algún otro lugar?');
              } else {
                setSpokenMessage('Diga su nuevo destino con calma...');
              }

              if (recordingTimeoutRef.current) {
                clearTimeout(recordingTimeoutRef.current);
              }
              recordingTimeoutRef.current = setTimeout(async () => {
                if (AudioRecorderService.isRecording()) {
                  setVoiceState('processing');
                  const transcription = await AudioRecorderService.stopAndTranscribe();
                  const speechText = transcription?.text?.trim() || '';
                  if (!speechText) {
                    setVoiceState('idle');
                    setSpokenMessage('No logré escucharle con claridad. Presione el botón para hablar.');
                    await VoiceService.speak('No logré escucharle con claridad. Presione el botón para hablar.');
                    return;
                  }
                  await handleProcessInput(speechText);
                }
              }, 8000);
              return;
            }
          }

          setVoiceState('idle');
        },
        () => {
          setVoiceState('speaking');
        }
      );
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

      const transcription = await AudioRecorderService.stopAndTranscribe();
      const speechText = transcription?.text?.trim() || '';
      if (!speechText) {
        setVoiceState('idle');
        setSpokenMessage('No logré escucharle con claridad. Presione el botón para hablar.');
        await VoiceService.speak('No logré escucharle con claridad. Presione el botón para hablar.');
        return;
      }
      await handleProcessInput(speechText);
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

      // Si hay confirmación pendiente o continuidad, guiar al usuario
      if (contextRef.current.pendingConfirmation) {
        setSpokenMessage(
          `¿Desea iniciar el viaje a ${contextRef.current.pendingConfirmation.destination}?`
        );
      } else if (contextRef.current.pendingTripCompletion) {
        setSpokenMessage('¿Desea viajar a algún otro lugar?');
      } else {
        setSpokenMessage('Diga su destino con calma...');
      }

      // T-1.4: Temporizador de auto-detención calibrado a 8.0 segundos de silencio para adultos mayores
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      recordingTimeoutRef.current = setTimeout(async () => {
        if (AudioRecorderService.isRecording()) {
          setVoiceState('processing');
          const transcription = await AudioRecorderService.stopAndTranscribe();
          const speechText = transcription?.text?.trim() || '';
          if (!speechText) {
            setVoiceState('idle');
            setSpokenMessage('No logré escucharle con claridad. Presione el botón para hablar.');
            await VoiceService.speak('No logré escucharle con claridad. Presione el botón para hablar.');
            return;
          }
          await handleProcessInput(speechText);
        }
      }, 8000);
    }
  };

  /**
   * Texto de estado accesible WCAG AAA para la cabecera central
   */
  const getStatusText = (): string => {
    if (voiceState === 'processing') {
      return 'Pensando...';
    }

    if (currentContext.pendingConfirmation) {
      return `¿Ir a ${currentContext.pendingConfirmation.destination}?`;
    }

    if (currentContext.pendingTripCompletion) {
      return '¿Viajar a otro lugar?';
    }

    switch (voiceState) {
      case 'listening':
        return 'Le escucho...';
      case 'speaking':
        return 'Hablando...';
      case 'idle':
      default:
        return 'Presione para hablar';
    }
  };

  /**
   * Subtexto o instrucción descriptiva
   */
  const getInstructionHint = (): string => {
    if (voiceState === 'processing') {
      return 'Un momento por favor, procesando su solicitud...';
    }

    if (currentContext.pendingConfirmation) {
      return 'Diga "Sí" para confirmar o "Cancelar" para detener';
    }

    if (currentContext.pendingTripCompletion) {
      return 'Diga un nuevo destino o "No" para terminar';
    }

    switch (voiceState) {
      case 'listening':
        return 'Diga a dónde desea ir con calma';
      case 'speaking':
        return spokenMessage || 'Escuche con atención';
      case 'idle':
      default:
        return 'Presione el botón naranja para pedir indicaciones';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.background }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <SafeAreaView style={styles.safeArea}>
        {/* Centro de la pantalla: One-Button UI pura con botón central dominante */}
        <View style={styles.centerContainer}>
          {/* T-1.1: Saludo temporal autodesvanecible tras 4 segundos */}
          <Animated.View style={{ opacity: greetingOpacityAnim }}>
            <Text
              style={[
                styles.greetingText,
                { color: currentTheme.textSecondary },
              ]}
            >
              HOLA, {userName.toUpperCase()}
            </Text>
          </Animated.View>

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

          {/* T-1.3: Botón Gigante del Micrófono (144dp) con sistema cromático y ondas concéntricas */}
          <View style={styles.micButtonWrapper}>
            {/* Primera onda concéntrica / halo animado */}
            <Animated.View
              style={[
                styles.glowHalo,
                {
                  backgroundColor: getHaloColor(),
                  opacity: haloOpacityAnim,
                  transform: [{ scale: pulseAnim }],
                },
              ]}
              pointerEvents="none"
            />

            {/* Segunda onda concéntrica animada al escuchar */}
            {voiceState === 'listening' && (
              <Animated.View
                style={[
                  styles.glowHalo,
                  {
                    backgroundColor: getHaloColor(),
                    opacity: Animated.multiply(haloOpacityAnim, 0.7),
                    transform: [{ scale: pulseAnim2 }],
                  },
                ]}
                pointerEvents="none"
              />
            )}

            {/* Botón circular táctil sin texto de alto contraste */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleVoicePress}
              style={[
                styles.micButton,
                {
                  backgroundColor: getButtonColor(),
                  shadowColor: getButtonColor(),
                },
              ]}
              accessibilityLabel="Botón principal de micrófono"
              accessibilityHint="Presione para hablar y solicitar su viaje"
              accessibilityRole="button"
            >
              {voiceState === 'processing' ? (
                <ActivityIndicator
                  size="large"
                  color="#FFFFFF"
                  style={{ transform: [{ scale: 1.6 }] }}
                />
              ) : (
                <Ionicons
                  name={getButtonIcon()}
                  size={68}
                  color="#FFFFFF"
                />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Espaciador inferior */}
        <View style={styles.bottomSpacer} />
      </SafeAreaView>

      {/* Requerimiento 3: Pantalla / Indicador de Carga Gerontológico */}
      {isLoadingTrip && (
        <View
          style={[
            styles.loadingOverlay,
            { backgroundColor: currentTheme.background },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <View style={styles.loadingContent}>
            <ActivityIndicator
              size="large"
              color={currentTheme.buttonOrange}
              style={styles.loadingSpinner}
            />

            <Text
              style={[
                styles.loadingTitle,
                { color: currentTheme.textPrimary },
              ]}
            >
              Preparando su viaje...
            </Text>

            <Text
              style={[
                styles.loadingSubtitle,
                { color: currentTheme.textSecondary },
              ]}
            >
              {`Calculando la mejor ruta hacia ${loadingDestination}...\nPor favor espere un momento.`}
            </Text>
          </View>
        </View>
      )}
    </View>
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
    marginBottom: 36,
    paddingHorizontal: 12,
    lineHeight: 24,
  },
  micButtonWrapper: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
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
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  },
  bottomSpacer: {
    height: 40,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: 28,
  },
  loadingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 380,
  },
  loadingSpinner: {
    transform: [{ scale: 2.0 }],
    marginBottom: 36,
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
  },
  loadingSubtitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 28,
  },
});
