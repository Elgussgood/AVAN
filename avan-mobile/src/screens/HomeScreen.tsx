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
import { orsService, StepInstruction } from '../services/orsService';
import { LocationService } from '../services/locationService';
import {
  NavigationService,
  NavigationProgress,
  getDistanceMeters,
  getBearing,
} from '../services/navigationService';

export interface HomeScreenProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  destinationName?: string;
  destination?: string;
  routeCoordinates?: LatLng[];
  destinationCoords?: LatLng | null;
  instruction?: string;
  steps?: StepInstruction[];
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
  steps,
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

  const [activeSteps, setActiveSteps] = useState<StepInstruction[]>(() => {
    if (steps && steps.length > 0) return steps;
    return [
      {
        instruction: propInstruction || `Continúe recto hacia ${targetDestination}`,
        distance: remainingDistance || 2400,
        duration: remainingDuration || 480,
        type: 6,
        name: 'Vía Principal',
        wayPoints: [0, Math.max(1, (routeCoordinates?.length || 2) - 1)],
      },
    ];
  });
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  // Modo simulación de recorrido para pruebas dinámicas
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedLocation, setSimulatedLocation] = useState<UserLocation | null>(null);

  const mapRef = useRef<InteractiveMapRef>(null);
  const { userLocation } = useLocationTracking();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [instruction, setInstruction] = useState<string>(
    propInstruction || 'En 200 metros, continúe recto por la vía principal'
  );

  const isFinishingTripRef = useRef<boolean>(false);
  const lastExitPressTimeRef = useRef<number>(0);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationVoiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simIndexRef = useRef<number>(0);
  const hasAnnouncedApproachRef = useRef<Set<number>>(new Set());
  const hasAnnouncedImminentRef = useRef<Set<number>>(new Set());
  const hasArrivedRef = useRef<boolean>(false);
  const offRouteCountRef = useRef<number>(0);
  const isRecalculatingRef = useRef<boolean>(false);

  const [navProgress, setNavProgress] = useState<NavigationProgress>(() => {
    const initialLoc = userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
      : { latitude: 19.427025, longitude: -99.167665 };
    return NavigationService.evaluateProgress(
      initialLoc,
      activeRouteCoords,
      activeDestinationCoords,
      activeSteps,
      0
    );
  });

  const effectiveLocation: UserLocation | null = isSimulating
    ? simulatedLocation
    : userLocation;

  const contextRef = useRef<ConversationContext>(
    context ||
      ConversationService.createInitialContext(userName, userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      } : undefined)
  );

  const currentTheme = isDarkMode ? darkTheme : lightTheme;

  // Limpiar temporizadores al desmontar
  useEffect(() => {
    return () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
      if (finishTimeoutRef.current) {
        clearTimeout(finishTimeoutRef.current);
      }
      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
      }
    };
  }, []);

  // Sincronizar steps si cambian desde props
  useEffect(() => {
    if (steps && steps.length > 0) {
      setActiveSteps(steps);
      setCurrentStepIndex(0);
      hasAnnouncedApproachRef.current.clear();
      hasAnnouncedImminentRef.current.clear();
    }
  }, [steps]);

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
   * Control del simulador de recorrido para pruebas dinámicas
   */
  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
      setIsSimulating(false);
      VoiceService.speak('Simulación pausada.');
      return;
    }

    if (!activeRouteCoords || activeRouteCoords.length < 2) {
      VoiceService.speak('No hay una ruta trazada para simular.');
      return;
    }

    hasArrivedRef.current = false;
    setIsSimulating(true);

    if (simIndexRef.current >= activeRouteCoords.length - 1) {
      simIndexRef.current = 0;
      setCurrentStepIndex(0);
      hasAnnouncedApproachRef.current.clear();
      hasAnnouncedImminentRef.current.clear();
    }

    const firstInstruction =
      activeSteps[currentStepIndex]?.instruction ||
      instruction ||
      `Continúe recto hacia ${targetDestination}`;
    VoiceService.speak(
      `Iniciando recorrido simulado hacia ${targetDestination}. ${firstInstruction}.`
    );

    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    simulationTimerRef.current = setInterval(() => {
      // Si la voz está enunciando una maniobra, pausar el avance para que la persona mayor la escuche con claridad
      if (VoiceService.isSpeaking()) {
        return;
      }

      simIndexRef.current += 1;
      if (simIndexRef.current >= activeRouteCoords.length) {
        if (simulationTimerRef.current) {
          clearInterval(simulationTimerRef.current);
          simulationTimerRef.current = null;
        }
        setIsSimulating(false);
        return;
      }

      const prevPt = activeRouteCoords[Math.max(0, simIndexRef.current - 1)];
      const currPt = activeRouteCoords[simIndexRef.current];
      const bearing = getBearing(prevPt, currPt);

      setSimulatedLocation({
        latitude: currPt.latitude,
        longitude: currPt.longitude,
        heading: bearing,
        speed: 9.7, // ~35 km/h
      });
    }, 1200);
  };

  /**
   * TASK-19: Recálculo automático de ruta ante desvíos (>100 metros fuera de la polilínea)
   */
  const handleRecalculateOffRoute = async (
    currentCoords: { latitude: number; longitude: number },
    targetCoord: { latitude: number; longitude: number }
  ) => {
    try {
      const msg = `Recalculando la mejor ruta hacia ${targetDestination}, por favor continúe con precaución.`;
      VoiceService.speak(msg);

      const routeResult = await orsService.getDirections(currentCoords, targetCoord);
      const newCoords = routeResult.coordinates.map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
      }));

      setActiveRouteCoords(newCoords);
      setActiveSteps(routeResult.steps);
      setCurrentStepIndex(0);
      hasAnnouncedApproachRef.current.clear();
      hasAnnouncedImminentRef.current.clear();
      offRouteCountRef.current = 0;
      isRecalculatingRef.current = false;
    } catch (err) {
      console.warn('Error al recalcular ruta tras desvío:', err);
      isRecalculatingRef.current = false;
    }
  };

  /**
   * TASK-18 & TASK-19: Ciclo de navegación turn-by-turn en tiempo real y detección de llegada
   */
  useEffect(() => {
    const loc = effectiveLocation;
    if (!loc || !activeRouteCoords || activeRouteCoords.length === 0) return;

    const currentCoords = { latitude: loc.latitude, longitude: loc.longitude };
    const targetCoord =
      activeDestinationCoords || activeRouteCoords[activeRouteCoords.length - 1];

    // 1. Detección automática de llegada a destino (<45 metros)
    const distToTarget = getDistanceMeters(currentCoords, targetCoord);
    if (distToTarget <= 45 && !hasArrivedRef.current) {
      hasArrivedRef.current = true;
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
      setIsSimulating(false);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}

      const arrivalMsg = `Ha llegado a su destino en ${targetDestination}.`;
      setVoiceState('speaking');
      setStatusMessage(arrivalMsg);
      VoiceService.speak(arrivalMsg, () => {
        startFinishContinuityDialog();
      });
      return;
    }

    // 2. Detección de pérdida de ruta (>100 metros fuera de la polilínea)
    const minDist = NavigationService.getMinDistanceToPolyline(
      currentCoords,
      activeRouteCoords
    );
    if (minDist > 100) {
      offRouteCountRef.current += 1;
      if (offRouteCountRef.current >= 3 && !isRecalculatingRef.current) {
        isRecalculatingRef.current = true;
        handleRecalculateOffRoute(currentCoords, targetCoord);
      }
    } else {
      offRouteCountRef.current = 0;
    }

    // 3. Evaluación del estado y distancias del turn-by-turn
    const progress = NavigationService.evaluateProgress(
      currentCoords,
      activeRouteCoords,
      activeDestinationCoords,
      activeSteps,
      currentStepIndex
    );
    setNavProgress(progress);

    // Actualizar instrucción visible
    if (progress.currentStep?.instruction) {
      setInstruction(progress.currentStep.instruction);
    }

    // 4. Anuncios proactivos por voz sin intervención manual:
    if (progress.currentStep) {
      // B) Aviso inminente (a 55m o menos del punto de giro)
      if (
        progress.distanceToNextManeuver <= 55 &&
        !hasAnnouncedImminentRef.current.has(currentStepIndex)
      ) {
        hasAnnouncedImminentRef.current.add(currentStepIndex);
        hasAnnouncedApproachRef.current.add(currentStepIndex);
        const msg = `${progress.currentStep.instruction} ahora.`;
        VoiceService.speak(msg);
      } else if (
        // A) Aviso de aproximación (a 180m o menos del punto de giro)
        progress.distanceToNextManeuver <= 180 &&
        !hasAnnouncedApproachRef.current.has(currentStepIndex)
      ) {
        hasAnnouncedApproachRef.current.add(currentStepIndex);
        const roundedMeters = Math.max(
          50,
          Math.round(progress.distanceToNextManeuver / 10) * 10
        );
        const msg = `En ${roundedMeters} metros, ${progress.currentStep.instruction}.`;
        VoiceService.speak(msg);
      }
    }

    // 5. Progresión de maniobra (si estamos a menos de 25m del punto de giro)
    if (
      progress.distanceToNextManeuver <= 25 &&
      currentStepIndex < activeSteps.length - 1
    ) {
      // Si se avanza al siguiente paso y no se había anunciado la maniobra inminente, anunciarla inmediatamente
      if (
        progress.currentStep &&
        !hasAnnouncedImminentRef.current.has(currentStepIndex)
      ) {
        hasAnnouncedImminentRef.current.add(currentStepIndex);
        VoiceService.speak(`${progress.currentStep.instruction} ahora.`);
      }
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    activeRouteCoords,
    currentStepIndex,
    activeSteps,
  ]);

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
   * Calcula y activa la nueva ruta hacia un destino confirmado en el mapa
   */
  const startNavigationToDestination = async (newDest: string) => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (navigationVoiceTimeoutRef.current) {
      clearTimeout(navigationVoiceTimeoutRef.current);
      navigationVoiceTimeoutRef.current = null;
    }

    setVoiceState('processing');
    setStatusMessage(`Calculando ruta hacia ${newDest}...`);

    try {
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
      if (routeResult.steps && routeResult.steps.length > 0) {
        setActiveSteps(routeResult.steps);
      }
      setCurrentStepIndex(0);
      hasArrivedRef.current = false;
      hasAnnouncedApproachRef.current.clear();
      hasAnnouncedImminentRef.current.clear();
      isFinishingTripRef.current = false;

      contextRef.current = {
        ...contextRef.current,
        pendingConfirmation: null,
        activeRoute: {
          destination: newDest,
          inProgress: true,
          startTime: Date.now(),
        },
      };
      if (onContextChange) {
        onContextChange(contextRef.current);
      }

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
      console.warn('Error al calcular nueva ruta de navegación:', err);
      await handleCloseTripWithFarewell();
    }
  };

  /**
   * Procesa un nuevo destino si el usuario desea continuar viajando (Paso 1: intención y confirmación)
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
    setStatusMessage('Procesando destino...');

    try {
      const response = await ConversationService.processUserMessage(
        clean,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      // Si el NLU requiere confirmación (Paso 1 del protocolo en 2 pasos) o devuelve una pregunta
      if (response.updatedContext.pendingConfirmation || response.spokenText.includes('?')) {
        setVoiceState('speaking');
        setStatusMessage(response.spokenText);

        await VoiceService.speak(response.spokenText, async () => {
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}

          const started = await AudioRecorderService.startRecording();
          if (started) {
            setVoiceState('listening');
            setStatusMessage('Diga "Sí" o "No"...');

            if (finishTimeoutRef.current) {
              clearTimeout(finishTimeoutRef.current);
            }
            finishTimeoutRef.current = setTimeout(async () => {
              if (AudioRecorderService.isRecording()) {
                setVoiceState('processing');
                setStatusMessage('Pensando...');
                const trans = await AudioRecorderService.stopAndTranscribe();
                await handleFinishContinuityResponse(trans?.text || '');
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

      // Si ya vino confirmado
      if (response.functionCall?.name === 'confirmar_viaje') {
        const confirmedDest =
          response.functionCall.args.destino ||
          response.updatedContext.activeRoute?.destination ||
          clean;
        await startNavigationToDestination(confirmedDest);
        return;
      }

      if (response.functionCall?.name === 'cancelar') {
        await handleCloseTripWithFarewell();
        return;
      }

      // Fallback si devuelve un destino directo sin confirmación pendiente
      const dest =
        response.updatedContext.activeRoute?.destination ||
        clean;
      await startNavigationToDestination(dest);
    } catch (err) {
      console.warn('Error al procesar nuevo destino:', err);
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

    // Caso A: Hay una confirmación pendiente en 2 pasos
    if (contextRef.current.pendingConfirmation) {
      const pendingDest = contextRef.current.pendingConfirmation.destination;

      // Si responde cancelando o rechazando
      if (
        !cleanText ||
        cleanText === 'no' ||
        cleanText.includes('cancelar') ||
        cleanText.includes('detener') ||
        cleanText.includes('ya no') ||
        cleanText.includes('ninguno') ||
        cleanText.includes('nada')
      ) {
        contextRef.current = {
          ...contextRef.current,
          pendingConfirmation: null,
        };
        await handleCloseTripWithFarewell();
        return;
      }

      // Procesar respuesta con ConversationService
      setVoiceState('processing');
      setStatusMessage('Confirmando destino...');

      const response = await ConversationService.processUserMessage(
        speechText,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      if (response.functionCall?.name === 'confirmar_viaje') {
        const dest =
          response.functionCall.args.destino ||
          pendingDest;
        await startNavigationToDestination(dest);
        return;
      }

      if (response.functionCall?.name === 'cancelar') {
        await handleCloseTripWithFarewell();
        return;
      }

      // Si nombró otro destino
      if (response.updatedContext.pendingConfirmation) {
        await handleNewDestination(speechText);
        return;
      }

      // Si fue afirmativo genérico
      await startNavigationToDestination(pendingDest);
      return;
    }

    // Caso B: Pregunta inicial "¿Desea viajar a algún otro lugar?"
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

    // Si responde "Sí" genérico (sin destino todavía)
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
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

    // Si nombra un nuevo destino directamente (ej. "Zócalo" o "Llévame al Zócalo")
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
      const responseText = 'Centrando el mapa en su posición.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (
      lowerText.includes('simular') ||
      lowerText.includes('simulacion') ||
      lowerText.includes('simulación')
    ) {
      toggleSimulation();
      return;
    }

    if (
      lowerText.includes('cuánto falta') ||
      lowerText.includes('cuanto falta') ||
      lowerText.includes('distancia') ||
      lowerText.includes('tiempo')
    ) {
      const distStr = navProgress.formattedRemainingDistance || `${(remainingDistance / 1000).toFixed(1)} km`;
      const timeStr = navProgress.formattedRemainingDuration || `${Math.max(1, Math.round(remainingDuration / 60))} minutos`;
      const responseText = `Faltan aproximadamente ${distStr} y ${timeStr} para llegar a ${targetDestination}.`;
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
        } else if (response.functionCall.name === 'confirmar_viaje') {
          const confirmedDest =
            response.functionCall.args.destino ||
            response.updatedContext.activeRoute?.destination ||
            targetDestination;

          setVoiceState('speaking');
          setStatusMessage(response.spokenText);
          await VoiceService.speak(response.spokenText);
          await startNavigationToDestination(confirmedDest);
          return;
        }
      }

      setVoiceState('speaking');
      setStatusMessage('Hablando...');

      const lowerSpoken = response.spokenText.toLowerCase();
      const isFarewell =
        lowerSpoken.includes('excelente día') ||
        lowerSpoken.includes('buen día') ||
        lowerSpoken.includes('hasta luego') ||
        lowerSpoken.includes('adiós') ||
        lowerSpoken.includes('cancelando viaje');

      const needsAutoListen =
        (Boolean(response.updatedContext.pendingConfirmation) ||
          response.spokenText.includes('?')) &&
        !isFarewell;

      await VoiceService.speak(response.spokenText, async () => {
        if (needsAutoListen) {
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}

          const started = await AudioRecorderService.startRecording();
          if (started) {
            setVoiceState('listening');
            setStatusMessage(
              response.updatedContext.pendingConfirmation
                ? 'Diga "Sí" o "No"...'
                : 'Le escucho...'
            );

            if (navigationVoiceTimeoutRef.current) {
              clearTimeout(navigationVoiceTimeoutRef.current);
            }
            navigationVoiceTimeoutRef.current = setTimeout(async () => {
              if (AudioRecorderService.isRecording()) {
                setVoiceState('processing');
                setStatusMessage('Pensando...');
                const transcription =
                  await AudioRecorderService.stopAndTranscribe();
                await processNavigationSpeech(transcription?.text || '');
              } else {
                setVoiceState('idle');
                setStatusMessage('');
              }
            }, 8000);
          } else {
            setVoiceState('idle');
            setStatusMessage('');
          }
        } else {
          setVoiceState('idle');
          setStatusMessage('');
        }
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
      setStatusMessage('Le escucho...');

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
        userLocation={effectiveLocation}
        routeCoordinates={activeRouteCoords}
        destinationMarker={activeDestinationCoords}
        destinationTitle={targetDestination}
        followUser={true}
      />

      {/* 2. Capa Superior: Tarjeta de Navegación Activa y Selector de Modo */}
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topContainer}>
          {/* Barra superior con botón de finalizar viaje y botón de simulación */}
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
              accessibilityHint="Presione una vez para finalizar con diálogo de continuidad, o dos veces / mantenga presionado para salida inmediata"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color="#EF4444" />
              <Text style={styles.cancelButtonText}>Finalizar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleSimulation}
              style={[
                styles.simButton,
                {
                  backgroundColor: isSimulating ? '#FF9800' : currentTheme.cardBackground,
                  borderColor: isSimulating ? '#FF9800' : currentTheme.cardBorder,
                },
              ]}
              accessibilityLabel={isSimulating ? "Pausar simulación" : "Simular recorrido"}
              accessibilityRole="button"
            >
              <Ionicons
                name={isSimulating ? "pause" : "play"}
                size={18}
                color={isSimulating ? '#FFFFFF' : currentTheme.buttonOrange}
              />
              <Text
                style={[
                  styles.simButtonText,
                  { color: isSimulating ? '#FFFFFF' : currentTheme.buttonOrange },
                ]}
              >
                {isSimulating ? 'Pausar' : 'Simular'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tarjeta Flotante con Próxima Instrucción Turn-by-Turn y Métricas de Ruta */}
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
            <View style={styles.instructionTopRow}>
              <View style={styles.instructionIconContainer}>
                <Ionicons
                  name={(navProgress.maneuverIcon as any) || "arrow-up-circle"}
                  size={38}
                  color={currentTheme.routeColor}
                />
              </View>

              <View style={styles.instructionTextContainer}>
                <View style={styles.badgeRow}>
                  <Text
                    style={[
                      styles.destinationBadge,
                      { color: currentTheme.textSecondary },
                    ]}
                  >
                    {navProgress.formattedDistanceToManeuver ? `${navProgress.formattedDistanceToManeuver.toUpperCase()} • ` : ''}RUMBO A: {targetDestination.toUpperCase()}
                  </Text>
                  {isSimulating && (
                    <View style={styles.simulatingPill}>
                      <Text style={styles.simulatingPillText}>SIMULANDO</Text>
                    </View>
                  )}
                </View>
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

            {/* Fila de Métricas del Viaje (Distancia y Tiempo Restantes) */}
            <View
              style={[
                styles.instructionMetricsRow,
                { borderTopColor: isDarkMode ? '#1E293B' : '#E2E8F0' },
              ]}
            >
              <View style={styles.metricItem}>
                <Ionicons name="time-outline" size={16} color={currentTheme.textSecondary} />
                <Text style={[styles.metricText, { color: currentTheme.textSecondary }]}>
                  {navProgress.formattedRemainingDuration || 'Calculando...'}
                </Text>
              </View>
              <View style={[styles.metricDivider, { backgroundColor: isDarkMode ? '#334155' : '#E2E8F0' }]} />
              <View style={styles.metricItem}>
                <Ionicons name="navigate-outline" size={16} color={currentTheme.textSecondary} />
                <Text style={[styles.metricText, { color: currentTheme.textSecondary }]}>
                  {navProgress.formattedRemainingDistance || 'Calculando...'}
                </Text>
              </View>
              <View style={[styles.metricDivider, { backgroundColor: isDarkMode ? '#334155' : '#E2E8F0' }]} />
              <View style={styles.metricItem}>
                <Ionicons name="flag-outline" size={16} color={currentTheme.textSecondary} />
                <Text
                  style={[styles.metricText, { color: currentTheme.textSecondary, maxWidth: 120 }]}
                  numberOfLines={1}
                >
                  {targetDestination}
                </Text>
              </View>
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
    justifyContent: 'space-between',
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
  simButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  simButtonText: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 5,
  },
  instructionCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  instructionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  instructionIconContainer: {
    marginRight: 12,
  },
  instructionTextContainer: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  destinationBadge: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  simulatingPill: {
    backgroundColor: '#FF9800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  simulatingPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  instructionMainText: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 25,
  },
  instructionMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 6,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricText: {
    fontSize: 13,
    fontWeight: '600',
  },
  metricDivider: {
    width: 1,
    height: 12,
    opacity: 0.6,
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
