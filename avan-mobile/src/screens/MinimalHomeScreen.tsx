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
  ScrollView,
  BackHandler,
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
  buildDisambiguationSpokenPrompt,
} from '../services/conversationService';
import { orsService, StepInstruction, DisambiguationCandidate, GeocodePrecision } from '../services/orsService';
import { LocationService } from '../services/locationService';
import { AliasService } from '../services/aliasService';
import { InteractiveMap } from '../components/InteractiveMap';

const getLandmarkIcon = (type?: string): { name: any; color: string } => {
  switch (type) {
    case 'metro':
      return { name: 'subway', color: '#E11D48' };
    case 'metrobus':
      return { name: 'bus', color: '#D97706' };
    case 'parque':
      return { name: 'leaf', color: '#16A34A' };
    case 'hospital':
      return { name: 'medkit', color: '#DC2626' };
    case 'museo':
    case 'monumento':
      return { name: 'business', color: '#2563EB' };
    default:
      return { name: 'location', color: '#FF5722' };
  }
};

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
  const [internalDarkMode, setInternalDarkMode] = useState<boolean>(() => {
    if (propIsDarkMode !== undefined) return propIsDarkMode;
    const hour = new Date().getHours();
    return hour >= 19 || hour < 7;
  });
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

  // T-2.6: Saludo y guía auditiva al iniciar la app (reproducido solo una vez con retardo de 800ms)
  const hasAnnouncedWelcomeRef = useRef<boolean>(false);
  const lastProcessedRegistrationRef = useRef<any>(null);
  const lastProcessedConfirmationRef = useRef<any>(null);
  const lastProcessedDisambiguationRef = useRef<any>(null);
  const addressPromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincronizar contexto entrante (incluyendo salto de contexto desde el mapa para registro o confirmación de viaje)
  useEffect(() => {
    if (propContext) {
      setCurrentContext(propContext);
      contextRef.current = propContext;

      if (addressPromptTimeoutRef.current) {
        clearTimeout(addressPromptTimeoutRef.current);
        addressPromptTimeoutRef.current = null;
      }

      // Caso 0: Salto de contexto para desambiguación de direcciones (TASK-40)
      const dis = propContext.pendingDisambiguation;
      if (!dis) {
        lastProcessedDisambiguationRef.current = null;
      } else if (dis !== lastProcessedDisambiguationRef.current) {
        lastProcessedDisambiguationRef.current = dis;
        hasAnnouncedWelcomeRef.current = true; // Suprimir bienvenida genérica para no encimar

        const prompt = buildDisambiguationSpokenPrompt(
          dis.candidates,
          dis.intent,
          dis.aliasName
        );
        setSpokenMessage(prompt);
        setVoiceState('speaking');
        addressPromptTimeoutRef.current = setTimeout(() => {
          VoiceService.speak(prompt, async () => {
            await startListeningWithVAD();
          });
        }, 350);
        return;
      }

      // Caso 1: Salto de contexto para registro de direcciones
      const reg = propContext.pendingAliasRegistration;
      if (!reg) {
        lastProcessedRegistrationRef.current = null;
      } else if (reg !== lastProcessedRegistrationRef.current) {
        lastProcessedRegistrationRef.current = reg;
        hasAnnouncedWelcomeRef.current = true; // Suprimir bienvenida genérica para no encimar

        if (reg.step === 'awaiting_address') {
          const prompt = `Con gusto. ¿Cuál es la dirección o colonia que desea guardar para ${reg.aliasName}?`;
          setSpokenMessage(prompt);
          setVoiceState('speaking');
          addressPromptTimeoutRef.current = setTimeout(() => {
            VoiceService.speak(prompt, async () => {
              await startListeningWithVAD();
            });
          }, 350);
        } else if (reg.step === 'confirming_address' && reg.addressCandidate) {
          const prompt = `Entendí: ${reg.addressCandidate}. ¿Es correcta esta ubicación para ${reg.aliasName}?`;
          setSpokenMessage(prompt);
          setVoiceState('speaking');
          addressPromptTimeoutRef.current = setTimeout(() => {
            VoiceService.speak(prompt, async () => {
              await startListeningWithVAD();
            });
          }, 350);
        }
        return;
      }

      // Caso 2: Confirmación de nuevo viaje con mapa y pin (continuidad desde HomeScreen)
      const conf = propContext.pendingConfirmation;
      if (!conf) {
        lastProcessedConfirmationRef.current = null;
      } else if (conf !== lastProcessedConfirmationRef.current) {
        lastProcessedConfirmationRef.current = conf;
        hasAnnouncedWelcomeRef.current = true; // Suprimir bienvenida genérica para no encimar

        const dest = conf.destination;
        const prompt = conf.isForaneo
          ? `Atención, este es un viaje foráneo en carretera hacia ${dest}. ¿Está seguro de iniciar el viaje ahora?`
          : `He localizado ${dest}. ¿Desea que iniciemos el viaje hacia allá?`;

        setSpokenMessage(prompt);
        setVoiceState('speaking');
        addressPromptTimeoutRef.current = setTimeout(() => {
          VoiceService.speak(prompt, async () => {
            await startListeningWithVAD();
          });
        }, 350);
      }
    }

    return () => {
      if (addressPromptTimeoutRef.current) {
        clearTimeout(addressPromptTimeoutRef.current);
        addressPromptTimeoutRef.current = null;
      }
    };
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

  // Obtener ubicación GPS inicial del usuario para contexto geocodificador inmediato
  useEffect(() => {
    LocationService.getCurrentLocation()
      .then((loc) => {
        if (loc) {
          const coords = { latitude: loc.latitude, longitude: loc.longitude };
          contextRef.current = {
            ...contextRef.current,
            currentLocation: coords,
          };
          setCurrentContext((prev) => ({
            ...prev,
            currentLocation: coords,
          }));
        }
      })
      .catch((err) => {
        console.warn('No se pudo obtener ubicación GPS inicial en MinimalHomeScreen:', err);
      });
  }, []);

  useEffect(() => {
    if (
      !hasAnnouncedWelcomeRef.current &&
      !contextRef.current.pendingAliasRegistration &&
      !contextRef.current.pendingConfirmation
    ) {
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
   * Manejo gerontológico paciente de silencio cuando no se detecta voz (8 segundos)
   */
  const handleSilenceTimeout = async () => {
    const currentCtx = contextRef.current;
    const pendingReg = currentCtx.pendingAliasRegistration;

    // TASK-22: Manejo de Silencio con Segunda Repetición Paciente para Confirmación de Dirección
    if (pendingReg && pendingReg.step === 'confirming_address') {
      const retries = pendingReg.retryCount || 0;

      if (retries === 0) {
        // 1ra Repetición: no cancelar, repetir por voz con calidez gerontológica y dar 8s adicionales
        const updatedCtx: ConversationContext = {
          ...currentCtx,
          pendingAliasRegistration: {
            ...pendingReg,
            retryCount: 1,
          },
        };
        contextRef.current = updatedCtx;
        setCurrentContext(updatedCtx);
        if (onContextChange) onContextChange(updatedCtx);

        const repeatPrompt =
          'Disculpe, ¿desea guardar esta dirección? Puede decir Sí para confirmar o No para corregir.';
        setSpokenMessage(repeatPrompt);
        setVoiceState('speaking');

        await VoiceService.speak(repeatPrompt, async () => {
          await startListeningWithVAD();
        });
        return;
      } else {
        // 2do Silencio Consecutivo: Cierre cordial sin frustración ni errores
        const updatedCtx: ConversationContext = {
          ...currentCtx,
          pendingAliasRegistration: null,
        };
        contextRef.current = updatedCtx;
        setCurrentContext(updatedCtx);
        if (onContextChange) onContextChange(updatedCtx);

        const closePrompt =
          'No se preocupe, podemos guardar la dirección en otro momento. Presione el botón cuando lo necesite.';
        setSpokenMessage(closePrompt);
        setVoiceState('speaking');

        await VoiceService.speak(closePrompt, () => {
          setVoiceState('idle');
        });
        return;
      }
    }

    // Manejo de silencio paciente para awaiting_address
    if (pendingReg && pendingReg.step === 'awaiting_address') {
      const retries = pendingReg.retryCount || 0;

      if (retries === 0) {
        const updatedCtx: ConversationContext = {
          ...currentCtx,
          pendingAliasRegistration: {
            ...pendingReg,
            retryCount: 1,
          },
        };
        contextRef.current = updatedCtx;
        setCurrentContext(updatedCtx);
        if (onContextChange) onContextChange(updatedCtx);

        const repeatPrompt =
          pendingReg.aliasName && pendingReg.aliasName !== 'nueva ubicación'
            ? `Disculpe, ¿cuál es la dirección o colonia para registrar ${pendingReg.aliasName}?`
            : 'Disculpe, ¿podría decirme el nombre del lugar y su dirección?';
        setSpokenMessage(repeatPrompt);
        setVoiceState('speaking');

        await VoiceService.speak(repeatPrompt, async () => {
          await startListeningWithVAD();
        });
        return;
      } else {
        const updatedCtx: ConversationContext = {
          ...currentCtx,
          pendingAliasRegistration: null,
        };
        contextRef.current = updatedCtx;
        setCurrentContext(updatedCtx);
        if (onContextChange) onContextChange(updatedCtx);

        const closePrompt =
          'No se preocupe, podemos registrar la dirección en otro momento. Presione el botón cuando lo necesite.';
        setSpokenMessage(closePrompt);
        setVoiceState('speaking');

        await VoiceService.speak(closePrompt, () => {
          setVoiceState('idle');
        });
        return;
      }
    }

    // Fallback para otros silencios en reposo o confirmación de viaje
    setVoiceState('idle');
    setSpokenMessage('No logré escucharle con claridad. Presione el botón para hablar.');
    await VoiceService.speak('No logré escucharle con claridad. Presione el botón para hablar.');
  };

  /**
   * TASK-24: Inicia la escucha con detección de actividad vocal (VAD dinámico):
   * - 8 segundos de silencio inicial si no habla.
   * - 1.8 segundos de silencio continuo (trailing silence) tras terminar de hablar para procesar de inmediato (2.5s en dictado de dirección).
   */
  const startListeningWithVAD = async (): Promise<boolean> => {
    const currentCtx = contextRef.current;
    const isDictatingAddress =
      currentCtx.pendingAliasRegistration?.step === 'awaiting_address';

    setVoiceState('listening');

    const started = await AudioRecorderService.startRecording({
      isDictatingAddress,
      initialSilenceMs: 8000,
      trailingSilenceMs: isDictatingAddress ? 2500 : 1800,
      maxDurationMs: isDictatingAddress ? 25000 : 15000,
      onSpeechDetected: () => {
        console.log('[MinimalHomeScreen] VAD: Habla detectada en micrófono.');
      },
      onInitialSilenceTimeout: async () => {
        console.log('[MinimalHomeScreen] VAD: Timeout de silencio inicial (8s sin voz).');
        await handleSilenceTimeout();
      },
      onSpeechEnded: async (transcription) => {
        console.log('[MinimalHomeScreen] VAD: Silencio posterior completado (1.8s sin voz). Procesando.');
        setVoiceState('processing');
        const speechText = transcription?.text?.trim() || '';
        if (!speechText) {
          await handleSilenceTimeout();
          return;
        }
        await handleProcessInput(speechText);
      },
    });

    if (!started) {
      setVoiceState('idle');
      return false;
    }
    return true;
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
      if (!contextRef.current.currentLocation) {
        try {
          const loc = await LocationService.getCurrentLocation();
          if (loc) {
            contextRef.current = {
              ...contextRef.current,
              currentLocation: { latitude: loc.latitude, longitude: loc.longitude },
            };
          }
        } catch {
          // Continuar con ubicación por defecto
        }
      }

      const response = await ConversationService.processUserMessage(
        textToProcess,
        contextRef.current
      );

      // Actualizar contexto
      contextRef.current = response.updatedContext;
      setCurrentContext(response.updatedContext);

      // Sincronizar referencias para evitar que el useEffect de propContext duplique el audio
      if (response.updatedContext.pendingConfirmation) {
        lastProcessedConfirmationRef.current = response.updatedContext.pendingConfirmation;
      }
      if (response.updatedContext.pendingAliasRegistration) {
        lastProcessedRegistrationRef.current = response.updatedContext.pendingAliasRegistration;
      }
      if (response.updatedContext.pendingDisambiguation) {
        lastProcessedDisambiguationRef.current = response.updatedContext.pendingDisambiguation;
      }

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
          setSpokenMessage('Localizando su vehículo...');
          const userLocation = await LocationService.getRealLocationOrWait((status) => {
            setSpokenMessage(status);
          });
          const startCoords = {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
          };
          setSpokenMessage(`Calculando la mejor ruta hacia ${dest}...`);

          // 1. Obtener coordenadas destino (aprovechando las ya geocodificadas si están disponibles)
          const args = response.functionCall.args as any;
          let targetCoords: { latitude: number; longitude: number } | null = null;
          if (args?.latitud && args?.longitud) {
            targetCoords = {
              latitude: Number(args.latitud),
              longitude: Number(args.longitud),
            };
          } else if (contextRef.current.pendingConfirmation?.coordinates) {
            targetCoords = contextRef.current.pendingConfirmation.coordinates;
          }

          if (!targetCoords) {
            const geocoded = await orsService.geocodeDestination(dest, startCoords);
            targetCoords = geocoded[0]?.coordinates || {
              latitude: 19.4352,
              longitude: -99.1412,
            };
          }

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
          if (addressPromptTimeoutRef.current) {
            clearTimeout(addressPromptTimeoutRef.current);
            addressPromptTimeoutRef.current = null;
          }
          contextRef.current.pendingAliasRegistration = null;
          contextRef.current.pendingConfirmation = null;
          await VoiceService.stop();

          if (onStartTrip) {
            onStartTrip(dest, routeData);
          }
        } catch (error) {
          console.warn('Error al calcular ruta vehicular:', error);
          setIsLoadingTrip(false);
          if (addressPromptTimeoutRef.current) {
            clearTimeout(addressPromptTimeoutRef.current);
            addressPromptTimeoutRef.current = null;
          }
          contextRef.current.pendingAliasRegistration = null;
          contextRef.current.pendingConfirmation = null;
          await VoiceService.stop();

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
          // Una despedida SOLO aplica si NO se espera respuesta, NO hay preguntas y NO hay flujos pendientes.
          const asksQuestion = response.spokenText.includes('?');
          const isFarewell =
            !response.shouldAutoListen &&
            !asksQuestion &&
            /(?:hasta luego|excelente d[ií]a|buenas noches|a su disposici[oó]n|nos vemos|adi[oó]s|que descanse|cu[ií]dese|que le vaya bien)/i.test(
              response.spokenText
            );

          const shouldAutoListen =
            !isFarewell &&
            (response.shouldAutoListen === true ||
              Boolean(response.updatedContext.pendingConfirmation) ||
              Boolean(response.updatedContext.pendingAliasRegistration) ||
              Boolean(response.updatedContext.pendingDisambiguation) ||
              (Boolean(response.updatedContext.pendingTripCompletion) && asksQuestion) ||
              (response.shouldAutoListen !== false &&
                (asksQuestion ||
                  response.spokenText.toLowerCase().includes('otro lugar') ||
                  response.spokenText.toLowerCase().includes('a dónde desea ir') ||
                  response.spokenText.toLowerCase().includes('a donde desea ir') ||
                  response.spokenText.toLowerCase().includes('a qué lugar') ||
                  response.spokenText.toLowerCase().includes('es correcta'))));

          if (shouldAutoListen) {
            try {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {
              // Ignorar si haptics no está disponible
            }

            if (response.updatedContext.pendingDisambiguation) {
              setSpokenMessage('Diga el número, la zona o toque una opción...');
            } else if (response.updatedContext.pendingConfirmation) {
              setSpokenMessage(
                `¿Desea iniciar el viaje a ${response.updatedContext.pendingConfirmation.destination}?`
              );
            } else if (response.updatedContext.pendingAliasRegistration?.step === 'confirming_address') {
              const isUpdating = Boolean(
                response.updatedContext.pendingAliasRegistration.isUpdating ||
                (response.updatedContext.pendingAliasRegistration.aliasName &&
                  AliasService.getAlias(response.updatedContext.pendingAliasRegistration.aliasName))
              );
              setSpokenMessage(
                isUpdating
                  ? `¿Actualizar dirección para ${response.updatedContext.pendingAliasRegistration.aliasName}?`
                  : `¿Es correcta la ubicación para ${response.updatedContext.pendingAliasRegistration.aliasName}?`
              );
            } else if (response.updatedContext.pendingAliasRegistration?.step === 'awaiting_address') {
              setSpokenMessage(
                `Diga la dirección para ${response.updatedContext.pendingAliasRegistration.aliasName}...`
              );
            } else if (response.updatedContext.pendingTripCompletion) {
              setSpokenMessage('¿Desea viajar a algún otro lugar?');
            } else {
              setSpokenMessage('Diga su nuevo destino con calma...');
            }

            const started = await startListeningWithVAD();
            if (started) {
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

  // CONTROL DEL BOTÓN FÍSICO "ATRÁS" DE ANDROID:
  // Si el usuario presiona el botón físico o gesto de Atrás y existe un diálogo interactivo activo
  // (confirmación de viaje, tarjeta de desambiguación o registro de alias), cancela el diálogo
  // y retorna al estado inicial limpio (One-Button UI pura) sin cerrar la aplicación.
  useEffect(() => {
    const onBackPress = () => {
      const hasActiveModal = Boolean(
        currentContext.pendingConfirmation ||
        currentContext.pendingDisambiguation ||
        currentContext.pendingAliasRegistration
      );

      if (hasActiveModal) {
        handleProcessInput('cancelar');
        return true; // Previene cerrar la aplicación
      }

      return false; // Permite el comportamiento estándar del sistema
    };

    const backSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );

    return () => backSubscription.remove();
  }, [
    currentContext.pendingConfirmation,
    currentContext.pendingDisambiguation,
    currentContext.pendingAliasRegistration,
  ]);

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
      setVoiceState('processing');

      const transcription = await AudioRecorderService.stopAndTranscribe();
      const speechText = transcription?.text?.trim() || '';
      if (!speechText) {
        await handleSilenceTimeout();
        return;
      }
      await handleProcessInput(speechText);
      return;
    }

    if (voiceState === 'idle') {
      // Si hay confirmación pendiente o continuidad, guiar al usuario
      if (contextRef.current.pendingConfirmation) {
        setSpokenMessage(
          `¿Desea iniciar el viaje a ${contextRef.current.pendingConfirmation.destination}?`
        );
      } else if (contextRef.current.pendingAliasRegistration?.step === 'confirming_address') {
        const isUpdating = Boolean(
          contextRef.current.pendingAliasRegistration.isUpdating ||
          (contextRef.current.pendingAliasRegistration.aliasName &&
            AliasService.getAlias(contextRef.current.pendingAliasRegistration.aliasName))
        );
        setSpokenMessage(
          isUpdating
            ? `¿Actualizar dirección para ${contextRef.current.pendingAliasRegistration.aliasName}?`
            : `¿Es correcta la ubicación para ${contextRef.current.pendingAliasRegistration.aliasName}?`
        );
      } else if (contextRef.current.pendingAliasRegistration?.step === 'awaiting_address') {
        setSpokenMessage(
          `Diga la dirección para ${contextRef.current.pendingAliasRegistration.aliasName}...`
        );
      } else if (contextRef.current.pendingTripCompletion) {
        setSpokenMessage('¿Desea viajar a algún otro lugar?');
      } else {
        setSpokenMessage('Diga su destino con calma...');
      }

      await startListeningWithVAD();
    }
  };

  /**
   * Texto de estado accesible WCAG AAA para la cabecera central
   */
  const getStatusText = (): string => {
    if (voiceState === 'processing') {
      return 'Pensando...';
    }

    if (currentContext.pendingAliasRegistration?.step === 'confirming_address') {
      const isUpdating = Boolean(
        currentContext.pendingAliasRegistration.isUpdating ||
        (currentContext.pendingAliasRegistration.aliasName &&
          AliasService.getAlias(currentContext.pendingAliasRegistration.aliasName))
      );
      return isUpdating
        ? `¿Actualizar "${currentContext.pendingAliasRegistration.aliasName}"?`
        : `¿Guardar "${currentContext.pendingAliasRegistration.aliasName}"?`;
    }

    if (currentContext.pendingAliasRegistration?.step === 'awaiting_address') {
      return `¿Dirección para ${currentContext.pendingAliasRegistration.aliasName}?`;
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

    if (currentContext.pendingAliasRegistration?.step === 'confirming_address') {
      return 'Diga "Sí" para confirmar o "No" para corregir';
    }

    if (currentContext.pendingAliasRegistration?.step === 'awaiting_address') {
      return 'Diga la calle, número o colonia con calma';
    }

    if (currentContext.pendingConfirmation) {
      return 'Diga "Sí" para confirmar o "Cancelar" para detener';
    }

    if (currentContext.pendingDisambiguation) {
      return 'Diga el número, la zona o toque una de las opciones';
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

  const isConfirmingAddress =
    currentContext.pendingAliasRegistration?.step === 'confirming_address' &&
    Boolean(currentContext.pendingAliasRegistration.coordinates);

  const isConfirmingTrip =
    Boolean(currentContext.pendingConfirmation) &&
    Boolean(currentContext.pendingConfirmation?.coordinates);

  const isDisambiguating = Boolean(
    currentContext.pendingDisambiguation &&
    currentContext.pendingDisambiguation.candidates &&
    currentContext.pendingDisambiguation.candidates.length > 0
  );
  const disambiguationData = currentContext.pendingDisambiguation;

  const isShowingConfirmationPreview = isConfirmingAddress || isConfirmingTrip;

  // Variables unificadas para confirmación visual en mapa (dirección o viaje)
  const previewCoords = isConfirmingTrip
    ? currentContext.pendingConfirmation!.coordinates!
    : currentContext.pendingAliasRegistration?.coordinates;

  const previewTitle = isConfirmingTrip
    ? currentContext.pendingConfirmation!.destination.toUpperCase()
    : currentContext.pendingAliasRegistration?.aliasName.toUpperCase() || 'UBICACIÓN';

  const previewSubtitle = isConfirmingTrip
    ? (currentContext.pendingConfirmation!.isForaneo
        ? 'Viaje foráneo en carretera (>50 km)'
        : 'Destino seleccionado')
    : currentContext.pendingAliasRegistration?.addressCandidate || 'Dirección seleccionada';

  const previewPrecision: GeocodePrecision | undefined = isConfirmingTrip
    ? currentContext.pendingConfirmation?.precision
    : currentContext.pendingAliasRegistration?.precision;

  const isUpdatingAlias = Boolean(
    !isConfirmingTrip &&
    (currentContext.pendingAliasRegistration?.isUpdating ||
      (currentContext.pendingAliasRegistration?.aliasName &&
        AliasService.getAlias(currentContext.pendingAliasRegistration.aliasName)))
  );

  const headerTitle = isConfirmingTrip
    ? 'CONFIRMAR VIAJE'
    : isUpdatingAlias
    ? 'ACTUALIZAR UBICACIÓN'
    : 'CONFIRMAR UBICACIÓN';
  const headerIcon = isConfirmingTrip
    ? 'navigate-circle'
    : isUpdatingAlias
    ? 'sync-circle'
    : 'location';

  const confirmQuestion = isConfirmingTrip
    ? (currentContext.pendingConfirmation!.isForaneo
        ? '¿Iniciar viaje foráneo hacia allá?'
        : '¿Desea iniciar el viaje hacia allá?')
    : isUpdatingAlias
    ? `¿Actualizar dirección de ${currentContext.pendingAliasRegistration?.aliasName}?`
    : '¿Es correcta esta ubicación?';

  const confirmButtonLabel = isConfirmingTrip
    ? 'SÍ, INICIAR VIAJE'
    : isUpdatingAlias
    ? 'SÍ, ACTUALIZAR'
    : 'SÍ, GUARDAR';
  const confirmButtonIcon = isConfirmingTrip
    ? 'navigate'
    : isUpdatingAlias
    ? 'sync'
    : 'checkmark-circle';
  const confirmButtonHint = isConfirmingTrip
    ? 'Inicia el cálculo de ruta y navegación guiada'
    : isUpdatingAlias
    ? 'Actualiza la dirección guardada para este contacto o lugar'
    : 'Guarda esta ubicación con el nombre asignado';

  const rejectButtonLabel = isConfirmingTrip ? 'CANCELAR' : 'NO, CORREGIR';
  const rejectButtonHint = isConfirmingTrip
    ? 'Cancela el viaje y regresa a la pantalla principal'
    : 'Permite dictar nuevamente la dirección';

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.background }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <SafeAreaView style={styles.safeArea}>
        {isShowingConfirmationPreview && previewCoords ? (
          /* TASK-23: Vista Previa Visual en Mapa Durante la Confirmación (Dirección o Viaje) */
          <View style={styles.confirmingContainer}>
            {/* Cabecera accesible con icono de ubicación o viaje */}
            <View style={styles.previewHeaderRow}>
              <Ionicons name={headerIcon as any} size={24} color={currentTheme.buttonOrange} />
              <Text
                style={[
                  styles.previewHeaderText,
                  { color: currentTheme.textPrimary },
                ]}
              >
                {headerTitle}
              </Text>
            </View>

            {/* Mapa Interactivo con el Pin centrado en las coordenadas geocodificadas */}
            <View
              style={[
                styles.mapPreviewCard,
                {
                  borderColor: isDarkMode ? '#233857' : '#CBD5E1',
                  backgroundColor: isDarkMode ? '#0B111D' : '#F1F4F7',
                },
              ]}
            >
              <InteractiveMap
                key={`preview-${previewCoords.latitude.toFixed(5)}-${previewCoords.longitude.toFixed(5)}`}
                isDarkMode={isDarkMode}
                initialZoom={14}
                initialRegion={{
                  latitude: previewCoords.latitude,
                  longitude: previewCoords.longitude,
                  latitudeDelta: 0.024,
                  longitudeDelta: 0.024,
                }}
                destinationMarker={previewCoords}
                destinationTitle={previewTitle}
                style={StyleSheet.absoluteFill}
              />
            </View>

            {/* Tarjeta de Información de la Dirección o Destino */}
            <View
              style={[
                styles.addressCard,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: isDarkMode ? '#1E293B' : currentTheme.cardBorder,
                },
              ]}
            >
              <Text
                style={[styles.addressAliasText, { color: currentTheme.textPrimary }]}
                numberOfLines={1}
              >
                {previewTitle}
              </Text>
              <Text
                style={[styles.addressDetailText, { color: currentTheme.textSecondary }]}
                numberOfLines={2}
              >
                {previewSubtitle}
              </Text>

              {/* TASK-41: Distintivo de Precisión Gerontológica Accesible (WCAG AAA) */}
              {previewPrecision && (
                <View
                  style={[
                    styles.precisionBadge,
                    previewPrecision === 'exact'
                      ? (isDarkMode ? styles.precisionExactBadgeDark : styles.precisionExactBadge)
                      : previewPrecision === 'street'
                      ? (isDarkMode ? styles.precisionStreetBadgeDark : styles.precisionStreetBadge)
                      : (isDarkMode ? styles.precisionApproxBadgeDark : styles.precisionApproxBadge),
                  ]}
                  accessibilityLabel={
                    previewPrecision === 'exact'
                      ? 'Precisión de geocodificación: Dirección exacta'
                      : previewPrecision === 'street'
                      ? 'Precisión de geocodificación: Sobre la calle, aproximado al predio'
                      : 'Precisión de geocodificación: Zona aproximada'
                  }
                >
                  <Ionicons
                    name={
                      previewPrecision === 'exact'
                        ? 'checkmark-circle'
                        : previewPrecision === 'street'
                        ? 'navigate-circle'
                        : 'location-outline'
                    }
                    size={16}
                    color={
                      previewPrecision === 'exact'
                        ? (isDarkMode ? '#4ADE80' : '#166534')
                        : previewPrecision === 'street'
                        ? (isDarkMode ? '#FDE047' : '#854D0E')
                        : (isDarkMode ? '#60A5FA' : '#1E40AF')
                    }
                  />
                  <Text
                    style={[
                      styles.precisionBadgeText,
                      {
                        color:
                          previewPrecision === 'exact'
                            ? (isDarkMode ? '#4ADE80' : '#166534')
                            : previewPrecision === 'street'
                            ? (isDarkMode ? '#FDE047' : '#854D0E')
                            : (isDarkMode ? '#60A5FA' : '#1E40AF'),
                      },
                    ]}
                  >
                    {previewPrecision === 'exact'
                      ? 'Dirección exacta'
                      : previewPrecision === 'street'
                      ? 'Sobre la calle (aprox. al predio)'
                      : 'Zona aproximada'}
                  </Text>
                </View>
              )}
            </View>

            {/* Pregunta clara de confirmación */}
            <Text
              style={[styles.confirmPromptText, { color: currentTheme.textPrimary }]}
              accessibilityLiveRegion="polite"
            >
              {confirmQuestion}
            </Text>

            {/* Controles Multimodales: Botón Micrófono central + Botones táctiles Sí / No */}
            <View style={styles.confirmationControlsRow}>
              {/* Botón táctil Sí */}
              <TouchableOpacity
                style={[
                  styles.decisionTouchButton,
                  {
                    backgroundColor: isDarkMode ? '#14532D' : '#DCFCE7',
                    borderColor: '#22C55E',
                  },
                ]}
                onPress={() => handleProcessInput('sí')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={confirmButtonLabel}
                accessibilityHint={confirmButtonHint}
              >
                <Ionicons name={confirmButtonIcon as any} size={26} color="#22C55E" />
                <Text
                  style={[
                    styles.decisionTouchText,
                    { color: isDarkMode ? '#4ADE80' : '#15803D' },
                  ]}
                >
                  {confirmButtonLabel}
                </Text>
              </TouchableOpacity>

              {/* Micrófono central accesible */}
              <View style={styles.miniMicWrapper}>
                <Animated.View
                  style={[
                    styles.miniGlowHalo,
                    {
                      backgroundColor: getHaloColor(),
                      opacity: haloOpacityAnim,
                      transform: [{ scale: pulseAnim }],
                    },
                  ]}
                  pointerEvents="none"
                />
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleVoicePress}
                  style={[
                    styles.miniMicButton,
                    {
                      backgroundColor: getButtonColor(),
                      shadowColor: getButtonColor(),
                    },
                  ]}
                  accessibilityLabel="Botón de micrófono para hablar"
                  accessibilityRole="button"
                >
                  {voiceState === 'processing' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name={getButtonIcon()} size={36} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>

              {/* Botón táctil No / Cancelar */}
              <TouchableOpacity
                style={[
                  styles.decisionTouchButton,
                  {
                    backgroundColor: isDarkMode ? '#450A0A' : '#FEE2E2',
                    borderColor: '#EF4444',
                  },
                ]}
                onPress={() => handleProcessInput('no')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={rejectButtonLabel}
                accessibilityHint={rejectButtonHint}
              >
                <Ionicons name="close-circle" size={26} color="#EF4444" />
                <Text
                  style={[
                    styles.decisionTouchText,
                    { color: isDarkMode ? '#F87171' : '#B91C1C' },
                  ]}
                >
                  {rejectButtonLabel}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Subtexto aclaratorio */}
            <Text
              style={[
                styles.voiceOrTouchHint,
                { color: currentTheme.textSecondary },
              ]}
            >
              Hable al micrófono o presione una opción
            </Text>
          </View>
        ) : isDisambiguating && disambiguationData ? (
          /* TASK-40: Vista de Desambiguación Multilocación Asistida por Referencias */
          <View style={styles.disambiguationContainer}>
            {/* Cabecera accesible */}
            <View style={styles.previewHeaderRow}>
              <Ionicons
                name="navigate-circle"
                size={26}
                color={currentTheme.buttonOrange}
              />
              <Text
                style={[
                  styles.previewHeaderText,
                  { color: currentTheme.textPrimary },
                ]}
              >
                {disambiguationData.intent === 'alias_registration'
                  ? `GUARDAR: ${disambiguationData.aliasName?.toUpperCase() || 'UBICACIÓN'}`
                  : 'SELECCIONE EL DESTINO'}
              </Text>
            </View>

            {/* Subtítulo instructivo de alto contraste */}
            <Text
              style={[
                styles.disambiguationSubtitle,
                { color: currentTheme.textSecondary },
              ]}
            >
              Encontré varias ubicaciones con ese nombre. Toque una opción o diga su número:
            </Text>

            {/* Lista deslizable de tarjetas de candidatos */}
            <ScrollView
              style={styles.disambiguationScroll}
              contentContainerStyle={styles.disambiguationScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {disambiguationData.candidates.map((candidate, idx) => {
                const landmarkInfo = getLandmarkIcon(candidate.landmarkType);
                const distanceStr =
                  candidate.distanceMeters !== undefined
                    ? candidate.distanceMeters >= 1000
                      ? `${(candidate.distanceMeters / 1000).toFixed(1)} km`
                      : `${candidate.distanceMeters} m`
                    : null;

                return (
                  <TouchableOpacity
                    key={candidate.id || `disambiguation-${idx}`}
                    style={[
                      styles.candidateCard,
                      {
                        backgroundColor: isDarkMode ? '#131E31' : '#FFFFFF',
                        borderColor: isDarkMode ? '#233857' : '#CBD5E1',
                      },
                    ]}
                    onPress={() => handleProcessInput(`la ${idx + 1}`)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Opción ${idx + 1}: en ${candidate.colonia_o_alcaldia}${
                      candidate.landmarkRef ? `, cerca de ${candidate.landmarkRef}` : ''
                    }`}
                    accessibilityHint="Presione para elegir esta ubicación"
                  >
                    {/* Badge de Número Ordinal Gigante */}
                    <View style={styles.candidateNumberBadge}>
                      <Text style={styles.candidateNumberText}>{idx + 1}</Text>
                    </View>

                    {/* Contenido Central: Zona, Etiqueta y Landmark */}
                    <View style={styles.candidateInfoCol}>
                      <Text
                        style={[
                          styles.candidateZoneText,
                          { color: currentTheme.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {candidate.colonia_o_alcaldia}
                      </Text>

                      <Text
                        style={[
                          styles.candidateLabelText,
                          { color: currentTheme.textSecondary },
                        ]}
                        numberOfLines={2}
                      >
                        {candidate.label}
                      </Text>

                      {/* Fila de Insignias / Pills (Landmark + Distancia) */}
                      <View style={styles.candidatePillsRow}>
                        {candidate.landmarkRef && (
                          <View
                            style={[
                              styles.landmarkPill,
                              {
                                backgroundColor: isDarkMode ? '#1E293B' : '#F1F5F9',
                                borderColor: isDarkMode ? '#334155' : '#E2E8F0',
                              },
                            ]}
                          >
                            <Ionicons
                              name={landmarkInfo.name}
                              size={15}
                              color={landmarkInfo.color}
                              style={{ marginRight: 5 }}
                            />
                            <Text
                              style={[
                                styles.landmarkPillText,
                                { color: currentTheme.textPrimary },
                              ]}
                              numberOfLines={1}
                            >
                              Cerca de {candidate.landmarkRef}
                            </Text>
                          </View>
                        )}

                        {distanceStr && (
                          <View
                            style={[
                              styles.distancePill,
                              {
                                backgroundColor: isDarkMode ? '#1E293B' : '#F1F5F9',
                                borderColor: isDarkMode ? '#334155' : '#E2E8F0',
                              },
                            ]}
                          >
                            <Ionicons
                              name="navigate-outline"
                              size={13}
                              color={currentTheme.buttonOrange}
                              style={{ marginRight: 4 }}
                            />
                            <Text
                              style={[
                                styles.distancePillText,
                                { color: currentTheme.textSecondary },
                              ]}
                            >
                              a {distanceStr}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Flecha lateral indicadora */}
                    <View style={styles.candidateArrowCol}>
                      <Ionicons
                        name="chevron-forward"
                        size={24}
                        color={currentTheme.textSecondary}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Controles Multimodales Inferiores: Micrófono y Botón Cancelar */}
            <View style={styles.disambiguationControlsRow}>
              {/* Botón táctil Cancelar */}
              <TouchableOpacity
                style={[
                  styles.disambiguationCancelButton,
                  {
                    backgroundColor: isDarkMode ? '#450A0A' : '#FEE2E2',
                    borderColor: '#EF4444',
                  },
                ]}
                onPress={() => handleProcessInput('cancelar')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Cancelar selección"
                accessibilityHint="Regresa a la pantalla principal"
              >
                <Ionicons name="close-circle" size={24} color="#EF4444" />
                <Text
                  style={[
                    styles.decisionTouchText,
                    { color: isDarkMode ? '#F87171' : '#B91C1C' },
                  ]}
                >
                  CANCELAR
                </Text>
              </TouchableOpacity>

              {/* Micrófono central accesible */}
              <View style={styles.miniMicWrapper}>
                <Animated.View
                  style={[
                    styles.miniGlowHalo,
                    {
                      backgroundColor: getHaloColor(),
                      opacity: haloOpacityAnim,
                      transform: [{ scale: pulseAnim }],
                    },
                  ]}
                  pointerEvents="none"
                />
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleVoicePress}
                  style={[
                    styles.miniMicButton,
                    {
                      backgroundColor: getButtonColor(),
                      shadowColor: getButtonColor(),
                    },
                  ]}
                  accessibilityLabel="Botón de micrófono para hablar"
                  accessibilityRole="button"
                >
                  {voiceState === 'processing' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name={getButtonIcon()} size={36} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Guía inferior */}
            <Text
              style={[
                styles.voiceOrTouchHint,
                { color: currentTheme.textSecondary, marginBottom: 8 },
              ]}
            >
              Diga "la primera", "Coyoacán" o toque una opción
            </Text>
          </View>
        ) : (
          /* Centro de la pantalla: One-Button UI pura con botón central dominante */
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
        )}

        {/* Espaciador inferior */}
        {!isConfirmingAddress && !isDisambiguating && <View style={styles.bottomSpacer} />}
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
              {spokenMessage || `Calculando la mejor ruta hacia ${loadingDestination}...\nPor favor espere un momento.`}
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
  confirmingContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    justifyContent: 'space-between',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  previewHeaderText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  mapPreviewCard: {
    flex: 1,
    minHeight: 200,
    maxHeight: 280,
    borderRadius: 20,
    borderWidth: 2,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    marginVertical: 6,
  },
  addressCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginVertical: 4,
  },
  addressAliasText: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 2,
  },
  addressDetailText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  precisionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginTop: 8,
    alignSelf: 'center',
  },
  precisionExactBadge: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
  },
  precisionExactBadgeDark: {
    backgroundColor: '#064E3B',
    borderColor: '#059669',
    borderWidth: 1,
  },
  precisionStreetBadge: {
    backgroundColor: '#FEF9C3',
    borderColor: '#FDE047',
    borderWidth: 1,
  },
  precisionStreetBadgeDark: {
    backgroundColor: '#451A03',
    borderColor: '#D97706',
    borderWidth: 1,
  },
  precisionApproxBadge: {
    backgroundColor: '#DBEAFE',
    borderColor: '#93C5FD',
    borderWidth: 1,
  },
  precisionApproxBadgeDark: {
    backgroundColor: '#1E293B',
    borderColor: '#3B82F6',
    borderWidth: 1,
  },
  precisionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  confirmPromptText: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginVertical: 4,
  },
  confirmationControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginVertical: 6,
  },
  decisionTouchButton: {
    flex: 1,
    height: 60,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  decisionTouchText: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
  },
  miniMicWrapper: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  miniGlowHalo: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  miniMicButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  voiceOrTouchHint: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  disambiguationContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  disambiguationSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: 6,
    lineHeight: 20,
  },
  disambiguationScroll: {
    flex: 1,
    marginVertical: 6,
  },
  disambiguationScrollContent: {
    paddingBottom: 10,
  },
  candidateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 2,
    padding: 12,
    marginBottom: 10,
    minHeight: 76,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  candidateNumberBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF5722',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  candidateNumberText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  candidateInfoCol: {
    flex: 1,
  },
  candidateZoneText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  candidateLabelText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
    marginBottom: 6,
  },
  candidatePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  landmarkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  landmarkPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  distancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  distancePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  candidateArrowCol: {
    paddingLeft: 6,
    justifyContent: 'center',
  },
  disambiguationControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginVertical: 6,
  },
  disambiguationCancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 2,
    height: 60,
    marginRight: 12,
  },
});
