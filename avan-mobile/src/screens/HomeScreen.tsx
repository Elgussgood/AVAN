import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  Text,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { lightTheme, darkTheme, typography } from '../theme/theme';
import {
  InteractiveMap,
  InteractiveMapRef,
  UserLocation,
} from '../components/InteractiveMap';
import { VoiceActionButton, VoiceState } from '../components/VoiceActionButton';
import { VoiceService } from '../services/voiceService';
import { AudioRecorderService } from '../services/audioRecorder';
import {
  ConversationService,
  ConversationContext,
} from '../services/conversationService';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { LatLng } from 'react-native-maps';
import * as Haptics from 'expo-haptics';
import { orsService } from '../services/orsService';
import { LocationService } from '../services/locationService';

export interface HomeScreenProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  destinationName?: string;
  destination?: string;
  routeCoordinates?: LatLng[];
  destinationCoords?: LatLng | null;
  instruction?: string;
  remainingDistance?: number;
  remainingDuration?: number;
  onCancelTrip?: () => void;
  onStopTrip?: () => void;
  onToggleView?: () => void;
  onSetThemeMode?: (dark: boolean) => void;
  userName?: string;
  zoomLevel?: number;
  onZoomChange?: (newZoom: number) => void;
  context?: ConversationContext;
  onContextChange?: (ctx: ConversationContext) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  isDarkMode,
  onToggleTheme,
  onSetThemeMode,
  destinationName,
  destination,
  routeCoordinates,
  destinationCoords,
  instruction: propInstruction,
  remainingDistance = 4200,
  remainingDuration = 720,
  onCancelTrip,
  onStopTrip,
  onToggleView,
  userName = 'GUSTAVO',
  zoomLevel,
  onZoomChange,
  context,
  onContextChange,
}) => {
  const [targetDestination, setTargetDestination] = useState<string>(
    destination || destinationName || 'Hospital General'
  );
  const [activeRouteCoords, setActiveRouteCoords] = useState<LatLng[]>(
    routeCoordinates || []
  );
  const [activeDestinationCoords, setActiveDestinationCoords] = useState<LatLng | null>(
    destinationCoords || null
  );

  const mapRef = useRef<InteractiveMapRef>(null);
  const { userLocation } = useLocationTracking();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [instruction, setInstruction] = useState<string>(
    propInstruction || 'En 200 metros, continúa recto por la vía principal'
  );

  const isFinishingTripRef = useRef<boolean>(false);
  const lastExitPressTimeRef = useRef<number>(0);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationVoiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextRef = useRef<ConversationContext>(
    context ||
      ConversationService.createInitialContext(userName, userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      } : undefined)
  );

  const currentTheme = isDarkMode ? darkTheme : lightTheme;

  // Limpiar temporizadores de finalización al desmontar
  useEffect(() => {
    return () => {
      if (finishTimeoutRef.current) {
        clearTimeout(finishTimeoutRef.current);
      }
      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
      }
    };
  }, []);

  // Sincronizar destino y coordenadas si cambian por props
  useEffect(() => {
    if (destination || destinationName) {
      setTargetDestination(destination || destinationName || 'Hospital General');
    }
  }, [destination, destinationName]);

  useEffect(() => {
    if (routeCoordinates) {
      setActiveRouteCoords(routeCoordinates);
    }
  }, [routeCoordinates]);

  useEffect(() => {
    if (destinationCoords !== undefined) {
      setActiveDestinationCoords(destinationCoords);
    }
  }, [destinationCoords]);

  // Actualizar instrucción si cambia desde props
  useEffect(() => {
    if (propInstruction) {
      setInstruction(propInstruction);
    }
  }, [propInstruction]);

  // Al montar la pantalla o recibir nueva ruta, encuadrar la polilínea en el mapa
  useEffect(() => {
    if (activeRouteCoords && activeRouteCoords.length > 0 && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(activeRouteCoords, {
          edgePadding: { top: 160, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }, 700);
    }
  }, [activeRouteCoords]);

  // Al montar la pantalla de navegación activa, dar la bienvenida de inicio de ruta
  useEffect(() => {
    const welcomeMsg = `Iniciando ruta hacia ${targetDestination}. ${instruction}.`;
    VoiceService.speak(welcomeMsg);
  }, [targetDestination]);

  /**
   * Salida forzada inmediata (doble pulsación o pulsación prolongada)
   */
  const handleForcedExit = async () => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }
    await VoiceService.stop();
    isFinishingTripRef.current = false;
    const exitFn = onStopTrip || onCancelTrip || (() => {});
    exitFn();
  };

  /**
   * Cierre con despedida amable y transición a MinimalHomeScreen
   */
  const handleCloseTripWithFarewell = async () => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }

    setVoiceState('speaking');
    const farewellMsg = 'Excelente, que tenga un excelente día.';
    setStatusMessage(farewellMsg);

    await VoiceService.speak(farewellMsg, () => {
      isFinishingTripRef.current = false;
      setVoiceState('idle');
      setStatusMessage('');
      const exitFn = onStopTrip || onCancelTrip || (() => {});
      exitFn();
    });
  };

  /**
   * Procesa un nuevo destino si el usuario desea continuar viajando
   */
  const handleNewDestination = async (destinationInput: string) => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }

    const clean = destinationInput.trim();
    if (!clean || clean.toLowerCase() === 'no') {
      await handleCloseTripWithFarewell();
      return;
    }

    setVoiceState('processing');
    setStatusMessage(`Calculando ruta hacia ${clean}...`);

    try {
      const response = await ConversationService.processUserMessage(
        clean,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      const newDest =
        (response.functionCall?.args && 'destino' in response.functionCall.args
          ? (response.functionCall.args as { destino?: string }).destino
          : undefined) ||
        response.updatedContext.activeRoute?.destination ||
        clean;

      const currentLoc = userLocation
        ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
        : await LocationService.getCurrentLocation();

      const startCoords = {
        latitude: currentLoc.latitude,
        longitude: currentLoc.longitude,
      };

      const geocoded = await orsService.geocodeDestination(newDest, startCoords);
      const targetCoords = geocoded[0]?.coordinates || {
        latitude: 19.4352,
        longitude: -99.1412,
      };

      const routeResult = await orsService.getDirections(startCoords, targetCoords);
      const newRouteCoordinates = routeResult.coordinates.map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
      }));

      const firstInstruction =
        routeResult.steps[0]?.instruction ||
        `Continúa recto hacia ${newDest}`;

      setTargetDestination(newDest);
      setActiveRouteCoords(newRouteCoordinates);
      setActiveDestinationCoords({
        latitude: targetCoords.latitude,
        longitude: targetCoords.longitude,
      });
      setInstruction(firstInstruction);
      isFinishingTripRef.current = false;

      setTimeout(() => {
        mapRef.current?.fitToCoordinates(newRouteCoordinates, {
          edgePadding: { top: 160, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }, 500);

      setVoiceState('speaking');
      const newRouteMsg = `Iniciando ruta hacia ${newDest}. ${firstInstruction}.`;
      setStatusMessage(newRouteMsg);

      await VoiceService.speak(newRouteMsg, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
    } catch (err) {
      console.warn('Error al calcular nueva ruta de continuidad:', err);
      await handleCloseTripWithFarewell();
    }
  };

  /**
   * Evalúa la respuesta del usuario tras la pregunta de continuidad
   */
  const handleFinishContinuityResponse = async (speechText: string) => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }

    const cleanText = speechText.trim().toLowerCase();

    // Si responde "No", "Ninguno", o guarda silencio (vacío)
    if (
      !cleanText ||
      cleanText.includes('no') ||
      cleanText.includes('ningun') ||
      cleanText.includes('nada') ||
      cleanText.includes('ninguno') ||
      cleanText.includes('así está bien') ||
      cleanText.includes('asi esta bien') ||
      cleanText.includes('gracias') ||
      cleanText.includes('ya llegué') ||
      cleanText.includes('ya llegue')
    ) {
      await handleCloseTripWithFarewell();
      return;
    }

    // Si responde "Sí" genérico
    if (
      cleanText === 'sí' ||
      cleanText === 'si' ||
      cleanText === 'claro' ||
      cleanText === 'por favor' ||
      cleanText === 'sí por favor' ||
      cleanText === 'si por favor'
    ) {
      setVoiceState('speaking');
      const askWhereMsg = '¿A dónde le gustaría ir?';
      setStatusMessage(askWhereMsg);

      await VoiceService.speak(askWhereMsg, async () => {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}

        const started = await AudioRecorderService.startRecording();
        if (started) {
          setVoiceState('listening');
          setStatusMessage('Diga su destino...');

          finishTimeoutRef.current = setTimeout(async () => {
            if (AudioRecorderService.isRecording()) {
              setVoiceState('processing');
              setStatusMessage('Procesando...');
              const trans = await AudioRecorderService.stopAndTranscribe();
              await handleNewDestination(trans?.text || '');
            } else {
              await handleCloseTripWithFarewell();
            }
          }, 8000);
        } else {
          await handleCloseTripWithFarewell();
        }
      });
      return;
    }

    // Si nombra un nuevo destino directamente (ej. "Llévame a casa")
    await handleNewDestination(speechText);
  };

  /**
   * T-2.5: Inicia el diálogo de continuidad al finalizar viaje
   */
  const startFinishContinuityDialog = async () => {
    isFinishingTripRef.current = true;
    setVoiceState('speaking');
    const finishMsg = `Hemos finalizado el viaje a ${targetDestination}. ¿Desea viajar a algún otro lugar?`;
    setStatusMessage(finishMsg);

    await VoiceService.speak(finishMsg, async () => {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      const started = await AudioRecorderService.startRecording();
      if (started) {
        setVoiceState('listening');
        setStatusMessage('¿Desea viajar a otro lugar?');

        if (finishTimeoutRef.current) {
          clearTimeout(finishTimeoutRef.current);
        }
        // Temporizador de 8.0 segundos de tolerancia de silencio
        finishTimeoutRef.current = setTimeout(async () => {
          if (AudioRecorderService.isRecording()) {
            setVoiceState('processing');
            setStatusMessage('Procesando...');
            const transcription = await AudioRecorderService.stopAndTranscribe();
            const speechText = transcription?.text || '';
            await handleFinishContinuityResponse(speechText);
          } else {
            await handleFinishContinuityResponse('');
          }
        }, 8000);
      } else {
        await handleCloseTripWithFarewell();
      }
    });
  };

  /**
   * Maneja el clic en botón "Finalizar": un toque inicia diálogo, dos toques fuerzan salida
   */
  const handleFinalizarPress = () => {
    const now = Date.now();
    if (isFinishingTripRef.current || now - lastExitPressTimeRef.current < 1500) {
      handleForcedExit();
      return;
    }
    lastExitPressTimeRef.current = now;
    startFinishContinuityDialog();
  };

  const processNavigationSpeech = async (speechText: string) => {
    const cleanText = speechText.trim();
    if (!cleanText) {
      setVoiceState('idle');
      setStatusMessage('');
      return;
    }

    const lowerText = cleanText.toLowerCase();

    // Manejo directo de comandos de mapa frecuentes en marcha
    if (lowerText.includes('acercar') || lowerText.includes('cerca') || lowerText.includes('mas grande')) {
      mapRef.current?.zoomIn();
      const responseText = 'Acercando el mapa.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (lowerText.includes('alejar') || lowerText.includes('lejos') || lowerText.includes('mas pequeno')) {
      mapRef.current?.zoomOut();
      const responseText = 'Alejando el mapa.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (
      lowerText.includes('centrar') ||
      lowerText.includes('dónde estoy') ||
      lowerText.includes('donde estoy')
    ) {
      mapRef.current?.recenter();
      const responseText = 'Centrando el mapa en tu posición.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (
      lowerText.includes('cuánto falta') ||
      lowerText.includes('cuanto falta') ||
      lowerText.includes('distancia') ||
      lowerText.includes('tiempo')
    ) {
      const km = (remainingDistance / 1000).toFixed(1);
      const mins = Math.max(1, Math.round(remainingDuration / 60));
      const responseText = `Faltan aproximadamente ${km} kilómetros y ${mins} minutos para llegar.`;
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    // T-2.5: Iniciar diálogo de continuidad por voz si el usuario pide terminar/finalizar
    if (
      lowerText.includes('terminar') ||
      lowerText.includes('finalizar') ||
      lowerText.includes('llegamos') ||
      lowerText.includes('ya llegué') ||
      lowerText.includes('ya llegue')
    ) {
      startFinishContinuityDialog();
      return;
    }

    if (lowerText.includes('cancelar') || lowerText.includes('detener')) {
      const responseText = 'Cancelando viaje. Volviendo al inicio.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        handleForcedExit();
      });
      return;
    }

    // Si es otra consulta, procesar por NLU
    setVoiceState('processing');
    setStatusMessage('Pensando...');

    try {
      const response = await ConversationService.processUserMessage(
        cleanText,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      // Ejecutar funciones si las hay
      if (response.functionCall) {
        if (response.functionCall.name === 'ajustar_zoom') {
          const dir = response.functionCall.args.direccion;
          if (dir === 'acercar') mapRef.current?.zoomIn();
          else if (dir === 'alejar') mapRef.current?.zoomOut();
          else if (dir === 'centrar') mapRef.current?.recenter();
        } else if (response.functionCall.name === 'cancelar') {
          await VoiceService.speak(response.spokenText);
          handleForcedExit();
          return;
        }
      }

      setVoiceState('speaking');
      setStatusMessage('Hablando...');

      await VoiceService.speak(response.spokenText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
    } catch (error) {
      console.warn('Error al procesar voz en navegación:', error);
      setVoiceState('idle');
      setStatusMessage('');
    }
  };

  const handleVoicePress = async () => {
    if (voiceState === 'speaking') {
      await VoiceService.stop();
      setVoiceState('idle');
      setStatusMessage('');
      return;
    }

    if (voiceState === 'listening') {
      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
        navigationVoiceTimeoutRef.current = null;
      }

      if (isFinishingTripRef.current) {
        if (finishTimeoutRef.current) {
          clearTimeout(finishTimeoutRef.current);
          finishTimeoutRef.current = null;
        }
        setVoiceState('processing');
        setStatusMessage('Pensando...');
        const transcription = await AudioRecorderService.stopAndTranscribe();
        await handleFinishContinuityResponse(transcription?.text || '');
        return;
      }

      setVoiceState('processing');
      setStatusMessage('Pensando...');
      const transcription = await AudioRecorderService.stopAndTranscribe();
      await processNavigationSpeech(transcription?.text || '');
      return;
    }

    if (voiceState === 'idle') {
      setVoiceState('listening');
      setStatusMessage('Te escucho...');

      const started = await AudioRecorderService.startRecording();
      if (!started) {
        setVoiceState('idle');
        setStatusMessage('Error de micrófono');
        return;
      }

      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
      }

      // Grabar hasta 6 segundos o hasta que el usuario pulse de nuevo para procesar
      navigationVoiceTimeoutRef.current = setTimeout(async () => {
        if (AudioRecorderService.isRecording()) {
          setVoiceState('processing');
          setStatusMessage('Pensando...');

          const transcription = await AudioRecorderService.stopAndTranscribe();
          await processNavigationSpeech(transcription?.text || '');
        }
      }, 6000);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.background }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* 1. Mapa Interactivo Funcional con Estilo Personalizado Día/Noche */}
      <InteractiveMap
        ref={mapRef}
        isDarkMode={isDarkMode}
        userLocation={userLocation}
        routeCoordinates={activeRouteCoords}
        destinationMarker={activeDestinationCoords}
        destinationTitle={targetDestination}
        followUser={true}
      />

      {/* 2. Capa Superior: Tarjeta de Navegación Activa y Selector de Modo */}
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topContainer}>
          {/* Barra superior con botón de finalizar viaje */}
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={handleFinalizarPress}
              onLongPress={handleForcedExit}
              delayLongPress={600}
              style={[
                styles.cancelButton,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.cardBorder,
                },
              ]}
              accessibilityLabel="Finalizar viaje"
              accessibilityHint="Presiona una vez para finalizar con diálogo de continuidad, o dos veces / mantén presionado para salida inmediata"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color="#EF4444" />
              <Text style={styles.cancelButtonText}>Finalizar</Text>
            </TouchableOpacity>
          </View>

          {/* Tarjeta Flotante con Próxima Instrucción Turn-by-Turn */}
          <View
            style={[
              styles.instructionCard,
              {
                backgroundColor: currentTheme.cardBackground,
                borderColor: currentTheme.cardBorder,
              },
              isDarkMode ? styles.darkCardGlow : styles.lightCardShadow,
            ]}
          >
            <View style={styles.instructionIconContainer}>
              <Ionicons
                name="arrow-up-circle"
                size={38}
                color={currentTheme.routeColor}
              />
            </View>

            <View style={styles.instructionTextContainer}>
              <Text
                style={[
                  styles.destinationBadge,
                  { color: currentTheme.textSecondary },
                ]}
              >
                RUMBO A: {targetDestination.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.instructionMainText,
                  { color: currentTheme.textPrimary },
                ]}
                numberOfLines={2}
              >
                {instruction}
              </Text>
            </View>
          </View>
        </View>

        {/* 3. Botón Central Dominante de Voz en la Parte Inferior */}
        <VoiceActionButton
          theme={currentTheme}
          voiceState={voiceState}
          onPress={handleVoicePress}
          statusMessage={statusMessage}
        />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topContainer: {
    paddingHorizontal: 20,
    paddingTop: 45,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 12,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  cancelButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 4,
  },
  instructionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  instructionIconContainer: {
    marginRight: 12,
  },
  instructionTextContainer: {
    flex: 1,
  },
  destinationBadge: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  instructionMainText: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  lightCardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  darkCardGlow: {
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
});
