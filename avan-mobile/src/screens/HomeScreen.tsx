import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
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
  detectZoomIntensity,
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
  onCancelTrip?: (contextToPass?: ConversationContext) => void;
  onStopTrip?: (contextToPass?: ConversationContext) => void;
  onToggleView?: () => void;
  onSetThemeMode?: (dark: boolean) => void;
  userName?: string;
  zoomLevel?: number;
  onZoomChange?: (newZoom: number) => void;
  context?: ConversationContext;
  onContextChange?: (ctx: ConversationContext) => void;
}

const cleanSpeech = (t: string): string => {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()¿?¡!]/g, '')
    .trim();
};

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

  // 1. PANTALLA SIEMPRE ACTIVA (KEEP AWAKE):
  // Mantiene encendida la pantalla durante todo el viaje vehicular en el mapa.
  // Al salir de HomeScreen, la suscripción se desmonta y restaura el ahorro de batería.
  useKeepAwake();

  // 2. CONTROL DEL BOTÓN FÍSICO "ATRÁS" DE ANDROID:
  // Si el conductor presiona el botón físico o gesto de atrás, finaliza o cancela el viaje de forma segura
  // regresando a MinimalHomeScreen, evitando el cierre abrupto de la aplicación.
  useEffect(() => {
    const onBackPress = () => {
      const exitFn = onStopTrip || onCancelTrip;
      if (exitFn) {
        exitFn();
        return true; // Previene cerrar la app
      }
      return false;
    };

    const backSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress
    );

    return () => backSubscription.remove();
  }, [onStopTrip, onCancelTrip]);

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
  const tripStartTimeRef = useRef<number>(Date.now());
  const offRouteCountRef = useRef<number>(0);
  const isRecalculatingRef = useRef<boolean>(false);

  // Modo de exploración manual del mapa (cuando el usuario interactúa táctilmente)
  const [isUserExploringMap, setIsUserExploringMap] = useState<boolean>(false);
  const recenterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUserMapInteraction = () => {
    setIsUserExploringMap(true);
    if (recenterTimeoutRef.current) {
      clearTimeout(recenterTimeoutRef.current);
    }
    // Auto-recentrar después de 10 segundos de inactividad táctil
    recenterTimeoutRef.current = setTimeout(() => {
      handleRecenter();
    }, 10000);
  };

  const handleRecenter = () => {
    if (recenterTimeoutRef.current) {
      clearTimeout(recenterTimeoutRef.current);
      recenterTimeoutRef.current = null;
    }
    // Restablecer al zoom estándar de conducción vehicular (17) y vista POV orientada al avance
    mapRef.current?.recenter(17);
    setIsUserExploringMap(false);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  };

  const rawEffectiveLocation: UserLocation | null = isSimulating
    ? simulatedLocation
    : (userLocation || (activeRouteCoords && activeRouteCoords.length > 0 ? {
        latitude: activeRouteCoords[0].latitude,
        longitude: activeRouteCoords[0].longitude,
        heading: activeRouteCoords.length > 1
          ? NavigationService.getBearing(activeRouteCoords[0], activeRouteCoords[1])
          : 0,
        speed: 0,
      } : null));

  // Snap-to-Road: Proyección a la calzada vial de la ruta activa para eliminar jitter de GPS
  const effectiveLocation: UserLocation | null = useMemo(() => {
    if (!rawEffectiveLocation) return null;
    if (isSimulating || !activeRouteCoords || activeRouteCoords.length < 2) {
      return rawEffectiveLocation;
    }
    const snap = NavigationService.snapPointToPolyline(
      rawEffectiveLocation,
      activeRouteCoords,
      35 // Tolerancia de 35 metros para estabilizar el cursor en el asfalto
    );
    if (snap.isSnapped) {
      return {
        ...rawEffectiveLocation,
        latitude: snap.snappedPoint.latitude,
        longitude: snap.snappedPoint.longitude,
      };
    }
    return rawEffectiveLocation;
  }, [rawEffectiveLocation, activeRouteCoords, isSimulating]);

  const initialMapRegion = useMemo(() => {
    const lat = (activeRouteCoords && activeRouteCoords[0]?.latitude) ||
      effectiveLocation?.latitude ||
      19.427025;
    const lng = (activeRouteCoords && activeRouteCoords[0]?.longitude) ||
      effectiveLocation?.longitude ||
      -99.167665;
    return {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    };
  }, [activeRouteCoords, effectiveLocation]);

  // Recorte dinámico en tiempo real de los tramos ya transitados (simulación o GPS)
  const remainingRouteCoords = useMemo(() => {
    if (!activeRouteCoords || activeRouteCoords.length === 0) return [];
    if (!effectiveLocation) return activeRouteCoords;
    return NavigationService.getRemainingPolyline(
      effectiveLocation,
      activeRouteCoords,
      isSimulating ? simIndexRef.current : undefined
    );
  }, [activeRouteCoords, effectiveLocation, isSimulating]);

  const [navProgress, setNavProgress] = useState<NavigationProgress>(() => {
    const initialLoc = userLocation
      ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
      : (activeRouteCoords && activeRouteCoords.length > 0
          ? { latitude: activeRouteCoords[0].latitude, longitude: activeRouteCoords[0].longitude }
          : { latitude: 19.427025, longitude: -99.167665 });
    return NavigationService.evaluateProgress(
      initialLoc,
      activeRouteCoords,
      activeDestinationCoords,
      activeSteps,
      0
    );
  });

  const contextRef = useRef<ConversationContext>(
    context ||
      ConversationService.createInitialContext(userName, userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      } : undefined)
  );

  const currentTheme = isDarkMode ? darkTheme : lightTheme;

  // Detección de tramos rectos largos (>450m) para auto-ocultar la tarjeta de instrucciones y evitar ruido visual
  const isStraightManeuver =
    navProgress.currentStep?.type === 6 ||
    navProgress.currentStep?.type === 11 ||
    /contin[uú]e recto|siga derecho|contin[uú]a recto/i.test(instruction);

  const isLongStraightStretch =
    isStraightManeuver && navProgress.distanceToNextManeuver > 450;

  const [justChangedManeuver, setJustChangedManeuver] = useState<boolean>(false);
  const maneuverChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setJustChangedManeuver(true);
    if (maneuverChangeTimerRef.current) clearTimeout(maneuverChangeTimerRef.current);
    maneuverChangeTimerRef.current = setTimeout(() => {
      setJustChangedManeuver(false);
    }, 7000);
  }, [currentStepIndex]);

  const shouldShowInstruction =
    !isLongStraightStretch ||
    navProgress.remainingDistance <= 450 ||
    justChangedManeuver;

  const cardOpacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(cardOpacityAnim, {
      toValue: shouldShowInstruction ? 1 : 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [shouldShowInstruction, cardOpacityAnim]);

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
      if (recenterTimeoutRef.current) {
        clearTimeout(recenterTimeoutRef.current);
      }
      if (maneuverChangeTimerRef.current) {
        clearTimeout(maneuverChangeTimerRef.current);
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
      tripStartTimeRef.current = Date.now();
      hasArrivedRef.current = false;
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

  // Al iniciar la navegación activa o actualizar ruta, fijar la cámara en el vehículo a zoom de conducción cercano (17)
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.recenter(17);
      }, 500);
    }
  }, [activeRouteCoords]);

  // Al montar la pantalla de navegación activa, dar la bienvenida de inicio de ruta
  useEffect(() => {
    let isCancelled = false;
    // Asegurar que la locución inicial tome la maniobra de salida y nunca "Ha llegado a su destino"
    const validInitialInstruction =
      instruction && !instruction.toLowerCase().includes('ha llegado')
        ? instruction
        : activeSteps[0]?.instruction && !activeSteps[0].instruction.toLowerCase().includes('ha llegado')
        ? activeSteps[0].instruction
        : activeSteps[1]?.instruction || `Continúe recto hacia ${targetDestination}`;

    const welcomeMsg = `Iniciando ruta hacia ${targetDestination}. ${validInitialInstruction}.`;

    // Detener de forma estricta cualquier audio residual previo para evitar colisión de voces
    VoiceService.stop().then(() => {
      if (!isCancelled) {
        VoiceService.speak(welcomeMsg);
      }
    });

    return () => {
      isCancelled = true;
    };
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

      // Avance cinemático adaptativo: avanzar a un punto a al menos 18 metros adelante para fluidez demostrativa
      const currentPos = activeRouteCoords[simIndexRef.current];
      let nextIndex = simIndexRef.current + 1;

      while (
        nextIndex < activeRouteCoords.length - 1 &&
        getDistanceMeters(currentPos, activeRouteCoords[nextIndex]) < 18
      ) {
        nextIndex++;
      }

      simIndexRef.current = nextIndex;

      if (simIndexRef.current >= activeRouteCoords.length) {
        if (simulationTimerRef.current) {
          clearInterval(simulationTimerRef.current);
          simulationTimerRef.current = null;
        }
        setIsSimulating(false);
        return;
      }

      const currPt = activeRouteCoords[simIndexRef.current];
      const prevPt = activeRouteCoords[Math.max(0, simIndexRef.current - 1)];
      const futurePt = activeRouteCoords[Math.min(activeRouteCoords.length - 1, simIndexRef.current + 1)];

      // Cálculo de rumbo anticipado hacia la siguiente curva o calle
      let bearing = getBearing(currPt, futurePt);
      if (!bearing || (currPt.latitude === futurePt.latitude && currPt.longitude === futurePt.longitude)) {
        bearing = getBearing(prevPt, currPt);
      }

      setSimulatedLocation({
        latitude: currPt.latitude,
        longitude: currPt.longitude,
        heading: bearing,
        speed: 11.2, // ~40 km/h: velocidad de avance vehicular que ignora sensores estacionarios y rota el mapa
      });
    }, 900);
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

    // 1. Evaluación del estado y distancias del turn-by-turn a lo largo de la ruta
    const progress = NavigationService.evaluateProgress(
      currentCoords,
      activeRouteCoords,
      activeDestinationCoords,
      activeSteps,
      currentStepIndex
    );
    setNavProgress(progress);

    // 2. Detección automática de llegada a destino con validación estricta de ruta:
    // Evita finalizar prematuramente al arrancar el viaje (guardia de 12 segundos) o si el vehículo
    // pasa del otro lado de la avenida antes de dar el retorno en U. Requiere proximidad física Y que la distancia restante de ruta sea mínima.
    const elapsedSinceStartSec = (Date.now() - tripStartTimeRef.current) / 1000;
    const isNewTripGracePeriod = elapsedSinceStartSec < 12; // Mínimo 12 segundos tras arrancar antes de admitir llegada
    const distToTarget = getDistanceMeters(currentCoords, targetCoord);
    const hasEnoughRoutePoints = activeRouteCoords.length >= 2;
    const isAtEndOfRoute =
      hasEnoughRoutePoints &&
      (progress.remainingDistance <= 60 ||
        (isSimulating && simIndexRef.current >= activeRouteCoords.length - 2));

    if (
      (!isNewTripGracePeriod || (isSimulating && simIndexRef.current >= activeRouteCoords.length - 1)) &&
      distToTarget <= 50 &&
      isAtEndOfRoute &&
      !hasArrivedRef.current
    ) {
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

    // 3. Detección de pérdida de ruta (>100 metros fuera de la polilínea)
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

    // Actualizar instrucción visible (protegida contra falsa llegada al arrancar)
    if (progress.currentStep?.instruction) {
      const stepInst = progress.currentStep.instruction;
      if (!isNewTripGracePeriod || !stepInst.toLowerCase().includes('ha llegado')) {
        setInstruction(stepInst);
      }
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
  const handleForcedExit = async (contextToPass?: ConversationContext) => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (AudioRecorderService.isRecording()) {
      await AudioRecorderService.stopRecording();
    }
    await VoiceService.stop();
    isFinishingTripRef.current = false;
    const exitFn = onStopTrip || onCancelTrip;
    if (exitFn) {
      exitFn(contextToPass);
    }
  };

  /**
   * Cierre con despedida amable y transición a MinimalHomeScreen
   */
  const handleCloseTripWithFarewell = async (contextToPass?: ConversationContext) => {
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
      const exitFn = onStopTrip || onCancelTrip;
      if (exitFn) {
        exitFn(contextToPass);
      }
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

      setIsUserExploringMap(false);
      setTimeout(() => {
        mapRef.current?.recenter(17);
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
    setStatusMessage('Procesando solicitud...');

    try {
      const response = await ConversationService.processUserMessage(
        clean,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      // Si el NLU detectó que se desea registrar una dirección o alias
      if (
        response.updatedContext.pendingAliasRegistration ||
        response.functionCall?.name === 'guardar_ubicacion'
      ) {
        isFinishingTripRef.current = false;
        const exitFn = onStopTrip || onCancelTrip;
        if (exitFn) {
          exitFn(response.updatedContext);
        }
        return;
      }

      // Si el NLU requiere confirmación (Paso 1 del protocolo en 2 pasos):
      // Mostrar la vista previa de confirmación con el pin en el mapa igual que en el resto de la app
      if (response.updatedContext.pendingConfirmation) {
        isFinishingTripRef.current = false;
        const exitFn = onStopTrip || onCancelTrip;
        if (exitFn) {
          exitFn(response.updatedContext);
        }
        return;
      }

      // Si devuelve una pregunta sin confirmación directa
      if (response.spokenText.includes('?')) {
        setVoiceState('speaking');
        setStatusMessage(response.spokenText);

        await VoiceService.speak(response.spokenText, async () => {
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}

          setVoiceState('listening');
          setStatusMessage('Diga "Sí" o "No"...');

          await AudioRecorderService.startRecording({
            initialSilenceMs: 8000,
            trailingSilenceMs: 1800,
            onInitialSilenceTimeout: async () => {
              await handleCloseTripWithFarewell();
            },
            onSpeechEnded: async (trans) => {
              setVoiceState('processing');
              setStatusMessage('Pensando...');
              await handleFinishContinuityResponse(trans?.text || '');
            },
          });
        });
        return;
      }

      // Si ya vino confirmado o como navegar_a
      if (response.functionCall?.name === 'confirmar_viaje' || response.functionCall?.name === 'navegar_a') {
        const confirmedDest =
          response.functionCall.args.destino ||
          response.updatedContext.activeRoute?.destination ||
          clean;
        isFinishingTripRef.current = false;
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
      isFinishingTripRef.current = false;
      await startNavigationToDestination(dest);
    } catch (err) {
      console.warn('Error al procesar nuevo destino:', err);
      await handleCloseTripWithFarewell();
    }
  };

  /**
   * Escucha continua con VAD durante el diálogo de continuidad de fin/cancelación de viaje
   */
  const startFinishContinuityListen = async () => {
    isFinishingTripRef.current = true;
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }

    const started = await AudioRecorderService.startRecording({
      initialSilenceMs: 8000,
      trailingSilenceMs: 1800,
      onSpeechDetected: () => {
        if (finishTimeoutRef.current) {
          clearTimeout(finishTimeoutRef.current);
          finishTimeoutRef.current = null;
        }
      },
      onInitialSilenceTimeout: async () => {
        await handleFinishContinuityResponse('');
      },
      onSpeechEnded: async (transcription) => {
        setVoiceState('processing');
        setStatusMessage('Procesando...');
        await handleFinishContinuityResponse(transcription?.text || '');
      },
    });

    if (started) {
      setVoiceState('listening');
      setStatusMessage('¿Desea viajar a otro lugar?');
    } else {
      await handleCloseTripWithFarewell();
    }
  };

  /**
   * Evalúa la respuesta del usuario tras la pregunta de continuidad o fin de viaje
   */
  const handleFinishContinuityResponse = async (speechText: string) => {
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }

    const cleanText = speechText.trim();
    if (!cleanText) {
      await handleCloseTripWithFarewell();
      return;
    }

    const normText = cleanSpeech(cleanText);
    const lowerText = cleanText.toLowerCase();

    // Caso A: Hay una confirmación pendiente en 2 pasos
    if (contextRef.current.pendingConfirmation) {
      const pendingDest = contextRef.current.pendingConfirmation.destination;

      // Si responde cancelando o rechazando (tolerante a signos de puntuación de Whisper)
      if (
        normText === 'no' ||
        normText === 'no gracias' ||
        normText === 'cancelar' ||
        normText === 'cancela' ||
        normText === 'detener' ||
        normText === 'deten' ||
        normText === 'ya no' ||
        normText === 'ninguno' ||
        normText === 'nada'
      ) {
        contextRef.current = {
          ...contextRef.current,
          pendingConfirmation: null,
        };
        await handleCloseTripWithFarewell();
        return;
      }

      // Procesar respuesta con ConversationService para permitir salto de contexto
      setVoiceState('processing');
      setStatusMessage('Procesando...');

      const response = await ConversationService.processUserMessage(
        speechText,
        contextRef.current
      );
      contextRef.current = response.updatedContext;
      if (onContextChange) {
        onContextChange(response.updatedContext);
      }

      if (response.functionCall?.name === 'confirmar_viaje') {
        const dest = response.functionCall.args.destino || pendingDest;
        isFinishingTripRef.current = false;
        await startNavigationToDestination(dest);
        return;
      }

      // Si solicitó o cambió a un nuevo destino (navegar_a o confirmación pendiente en 2 pasos):
      // Salir a MinimalHomeScreen para desplegar la vista previa de confirmación con el pin en el mapa
      if (
        response.functionCall?.name === 'navegar_a' ||
        response.updatedContext.pendingConfirmation
      ) {
        isFinishingTripRef.current = false;
        const exitFn = onStopTrip || onCancelTrip;
        if (exitFn) {
          exitFn(response.updatedContext);
        }
        return;
      }

      // Salto de contexto hacia guardar ubicación
      if (
        response.updatedContext.pendingAliasRegistration ||
        response.functionCall?.name === 'guardar_ubicacion'
      ) {
        isFinishingTripRef.current = false;
        const exitFn = onStopTrip || onCancelTrip;
        if (exitFn) {
          exitFn(response.updatedContext);
        }
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
      isFinishingTripRef.current = false;
      await startNavigationToDestination(pendingDest);
      return;
    }

    // Caso B: Pregunta inicial "¿Desea viajar a algún otro lugar?"
    const isAddAddress =
      normText.includes('guardar') ||
      normText.includes('registrar') ||
      normText.includes('agregar') ||
      normText.includes('nueva direcci') ||
      normText.includes('otra direcci') ||
      normText.includes('casa de') ||
      normText.includes('oficina') ||
      normText.includes('rancho') ||
      normText.includes('trabajo');

    // Negación pura (tolerante a puntos finales y variaciones)
    const isPureRejection =
      normText === 'no' ||
      normText === 'no gracias' ||
      normText === 'no ya no' ||
      normText === 'nada' ||
      normText === 'ninguno' ||
      normText === 'ningun lugar' ||
      normText === 'ningun' ||
      normText === 'asi esta bien' ||
      normText === 'gracias' ||
      normText === 'ya llegue';

    if (isPureRejection && !isAddAddress) {
      await handleCloseTripWithFarewell();
      return;
    }

    // Comandos de tema
    if (lowerText.includes('modo noche') || lowerText.includes('tema oscuro')) {
      if (onSetThemeMode) onSetThemeMode(true);
      else if (!isDarkMode) onToggleTheme();
      const msg = 'Cambiando a modo noche. ¿Desea viajar a algún otro lugar?';
      setVoiceState('speaking');
      setStatusMessage(msg);
      await VoiceService.speak(msg, async () => {
        await startFinishContinuityListen();
      });
      return;
    }

    if (lowerText.includes('modo día') || lowerText.includes('modo dia') || lowerText.includes('tema claro')) {
      if (onSetThemeMode) onSetThemeMode(false);
      else if (isDarkMode) onToggleTheme();
      const msg = 'Cambiando a modo día. ¿Desea viajar a algún otro lugar?';
      setVoiceState('speaking');
      setStatusMessage(msg);
      await VoiceService.speak(msg, async () => {
        await startFinishContinuityListen();
      });
      return;
    }

    // Si responde "Sí" genérico (sin destino todavía)
    if (
      lowerText === 'sí' ||
      lowerText === 'si' ||
      lowerText === 'claro' ||
      lowerText === 'por favor' ||
      lowerText === 'sí por favor' ||
      lowerText === 'si por favor'
    ) {
      setVoiceState('speaking');
      const askWhereMsg = '¿A dónde le gustaría ir?';
      setStatusMessage(askWhereMsg);

      await VoiceService.speak(askWhereMsg, async () => {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}

        if (finishTimeoutRef.current) {
          clearTimeout(finishTimeoutRef.current);
          finishTimeoutRef.current = null;
        }

        const started = await AudioRecorderService.startRecording({
          initialSilenceMs: 8000,
          trailingSilenceMs: 1800,
          onInitialSilenceTimeout: async () => {
            await handleCloseTripWithFarewell();
          },
          onSpeechEnded: async (trans) => {
            setVoiceState('processing');
            setStatusMessage('Procesando...');
            await handleFinishContinuityResponse(trans?.text || '');
          },
        });

        if (started) {
          setVoiceState('listening');
          setStatusMessage('Diga su destino...');
        } else {
          await handleCloseTripWithFarewell();
        }
      });
      return;
    }

    // NLU transversal para cualquier otra petición (nuevo destino, registrar dirección, etc.)
    await handleNewDestination(speechText);
  };

  /**
   * T-2.5: Inicia el diálogo de continuidad al finalizar o detener viaje
   */
  const startFinishContinuityDialog = async (customMsg?: string) => {
    isFinishingTripRef.current = true;
    setVoiceState('speaking');
    const finishMsg =
      customMsg ||
      `Hemos finalizado el viaje a ${targetDestination}. ¿Desea viajar a algún otro lugar?`;
    setStatusMessage(finishMsg);

    await VoiceService.speak(finishMsg, async () => {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      await startFinishContinuityListen();
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

    // Manejo directo de comandos de mapa frecuentes en marcha con detección de intensidad
    const zoomIntensity = detectZoomIntensity(lowerText);

    if (
      lowerText.includes('acercar') ||
      lowerText.includes('acerca') ||
      lowerText.includes('cerca') ||
      lowerText.includes('mas grande') ||
      lowerText.includes('haz zoom') ||
      lowerText.includes('ampliar') ||
      lowerText.includes('amplia') ||
      (lowerText.includes('zoom') && !lowerText.includes('alejar') && !lowerText.includes('menos zoom'))
    ) {
      mapRef.current?.zoomIn(zoomIntensity);
      const responseText =
        zoomIntensity === 'mucho'
          ? 'Acercando ampliamente el mapa.'
          : zoomIntensity === 'poco'
          ? 'Acercando un poco el mapa.'
          : 'Acercando el mapa.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (
      lowerText.includes('alejar') ||
      lowerText.includes('aleja') ||
      lowerText.includes('lejos') ||
      lowerText.includes('mas pequeno') ||
      lowerText.includes('menos zoom') ||
      lowerText.includes('reducir') ||
      lowerText.includes('vista general') ||
      lowerText.includes('vista amplia')
    ) {
      mapRef.current?.zoomOut(zoomIntensity);
      const responseText =
        zoomIntensity === 'mucho'
          ? 'Alejando ampliamente el mapa para mostrar el panorama general.'
          : zoomIntensity === 'poco'
          ? 'Alejando un poco el mapa.'
          : 'Alejando el mapa.';
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
      lowerText.includes('centra') ||
      lowerText.includes('dónde estoy') ||
      lowerText.includes('donde estoy') ||
      lowerText.includes('ubicar') ||
      lowerText.includes('ubicame') ||
      lowerText.includes('mi ubicacion') ||
      lowerText.includes('mi ubicación')
    ) {
      handleRecenter();
      const responseText = 'Centrando el mapa en su vehículo con la vista estándar.';
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

    // T-2.5: Iniciar diálogo de continuidad por voz si el usuario pide terminar/finalizar/cancelar o dice "no"
    const normText = cleanSpeech(cleanText);
    if (
      normText === 'no' ||
      normText === 'no gracias' ||
      normText === 'ya no' ||
      normText === 'cancelar' ||
      normText === 'cancela' ||
      normText === 'cancelar viaje' ||
      normText === 'cancela el viaje' ||
      normText === 'detener' ||
      normText === 'deten' ||
      normText === 'detener viaje' ||
      normText === 'deten el viaje' ||
      normText === 'detente' ||
      normText === 'terminar' ||
      normText === 'terminar viaje' ||
      normText === 'finalizar' ||
      normText === 'finalizar viaje' ||
      normText === 'alto' ||
      normText === 'para' ||
      normText === 'parar' ||
      normText === 'llegamos' ||
      normText === 'ya llegue'
    ) {
      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
        navigationVoiceTimeoutRef.current = null;
      }
      startFinishContinuityDialog(`Hemos detenido el viaje a ${targetDestination}. ¿Desea viajar a algún otro lugar?`);
      return;
    }

    // Comandos de cambio de tema durante la marcha
    if (lowerText.includes('modo noche') || lowerText.includes('tema oscuro')) {
      if (onSetThemeMode) onSetThemeMode(true);
      else if (!isDarkMode) onToggleTheme();
      const responseText = 'Cambiando a modo noche.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
      });
      return;
    }

    if (lowerText.includes('modo día') || lowerText.includes('modo dia') || lowerText.includes('tema claro')) {
      if (onSetThemeMode) onSetThemeMode(false);
      else if (isDarkMode) onToggleTheme();
      const responseText = 'Cambiando a modo día.';
      setVoiceState('speaking');
      setStatusMessage(responseText);
      await VoiceService.speak(responseText, () => {
        setVoiceState('idle');
        setStatusMessage('');
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
          const intensidad = response.functionCall.args.intensidad || 'normal';
          if (dir === 'acercar') mapRef.current?.zoomIn(intensidad);
          else if (dir === 'alejar') mapRef.current?.zoomOut(intensidad);
          else if (dir === 'centrar') handleRecenter();
        } else if (response.functionCall.name === 'cancelar') {
          startFinishContinuityDialog(`Hemos detenido el viaje a ${targetDestination}. ¿Desea viajar a algún otro lugar?`);
          return;
        } else if (response.functionCall.name === 'confirmar_viaje' || response.functionCall.name === 'navegar_a') {
          // Si el NLU requiere confirmación (Paso 1 del protocolo en 2 pasos):
          // Mostrar la confirmación visual con el pin en el mapa igual que en el resto de la app
          if (response.updatedContext.pendingConfirmation) {
            const exitFn = onStopTrip || onCancelTrip;
            if (exitFn) {
              exitFn(response.updatedContext);
            }
            return;
          }

          const confirmedDest =
            response.functionCall.args.destino ||
            response.updatedContext.activeRoute?.destination ||
            targetDestination;

          setVoiceState('speaking');
          setStatusMessage(response.spokenText);
          await VoiceService.speak(response.spokenText);
          await startNavigationToDestination(confirmedDest);
          return;
        } else if (
          response.functionCall.name === 'guardar_ubicacion' ||
          response.updatedContext.pendingAliasRegistration
        ) {
          // Salto de contexto hacia registro de dirección
          const exitFn = onStopTrip || onCancelTrip;
          if (exitFn) {
            exitFn(response.updatedContext);
          }
          return;
        }
      }

      // Si el contexto trae pendingConfirmation o pendingAliasRegistration
      if (
        response.updatedContext.pendingConfirmation ||
        response.updatedContext.pendingAliasRegistration
      ) {
        const exitFn = onStopTrip || onCancelTrip;
        if (exitFn) {
          exitFn(response.updatedContext);
        }
        return;
      }

      setVoiceState('speaking');
      setStatusMessage('Hablando...');

      const lowerSpoken = response.spokenText.toLowerCase();
      const asksQuestion = response.spokenText.includes('?');
      const isFarewell =
        !response.shouldAutoListen &&
        !asksQuestion &&
        (lowerSpoken.includes('excelente día') ||
          lowerSpoken.includes('hasta luego') ||
          lowerSpoken.includes('adiós') ||
          lowerSpoken.includes('que descanse'));

      const needsAutoListen =
        response.shouldAutoListen ??
        ((Boolean(response.updatedContext.pendingConfirmation) ||
          Boolean(response.updatedContext.pendingAliasRegistration) ||
          asksQuestion) &&
          !isFarewell);

      await VoiceService.speak(response.spokenText, async () => {
        if (needsAutoListen) {
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}

          if (navigationVoiceTimeoutRef.current) {
            clearTimeout(navigationVoiceTimeoutRef.current);
            navigationVoiceTimeoutRef.current = null;
          }

          const isDictatingAddress =
            response.updatedContext.pendingAliasRegistration?.step === 'awaiting_address';

          const started = await AudioRecorderService.startRecording({
            isDictatingAddress,
            initialSilenceMs: 8000,
            trailingSilenceMs: isDictatingAddress ? 2500 : 1800,
            maxDurationMs: isDictatingAddress ? 25000 : 15000,
            onSpeechDetected: () => {
              if (navigationVoiceTimeoutRef.current) {
                clearTimeout(navigationVoiceTimeoutRef.current);
                navigationVoiceTimeoutRef.current = null;
              }
            },
            onInitialSilenceTimeout: async () => {
              setVoiceState('idle');
              setStatusMessage('');
            },
            onSpeechEnded: async (transcription) => {
              setVoiceState('processing');
              setStatusMessage('Pensando...');
              await processNavigationSpeech(transcription?.text || '');
            },
          });

          if (started) {
            setVoiceState('listening');
            setStatusMessage(
              response.updatedContext.pendingConfirmation
                ? 'Diga "Sí" o "No"...'
                : 'Le escucho...'
            );
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

  const startListeningInNavigation = async () => {
    if (navigationVoiceTimeoutRef.current) {
      clearTimeout(navigationVoiceTimeoutRef.current);
      navigationVoiceTimeoutRef.current = null;
    }

    const isDictatingAddress =
      contextRef.current.pendingAliasRegistration?.step === 'awaiting_address';

    const started = await AudioRecorderService.startRecording({
      isDictatingAddress,
      initialSilenceMs: 8000,
      trailingSilenceMs: isDictatingAddress ? 2500 : 1800,
      maxDurationMs: isDictatingAddress ? 25000 : 15000,
      onSpeechDetected: () => {
        if (navigationVoiceTimeoutRef.current) {
          clearTimeout(navigationVoiceTimeoutRef.current);
          navigationVoiceTimeoutRef.current = null;
        }
      },
      onInitialSilenceTimeout: async () => {
        setVoiceState('idle');
        setStatusMessage('');
      },
      onSpeechEnded: async (transcription) => {
        setVoiceState('processing');
        setStatusMessage('Pensando...');
        await processNavigationSpeech(transcription?.text || '');
      },
    });

    if (!started) {
      setVoiceState('idle');
      setStatusMessage('Error de micrófono');
      return;
    }

    setVoiceState('listening');
    setStatusMessage('Le escucho...');
  };

  const handleVoicePress = async () => {
    // Interrupción Inmediata (Barge-in): Si el sistema está hablando una maniobra o instrucción,
    // silenciar inmediatamente la voz y comenzar a escuchar al usuario sin esperas
    if (voiceState === 'speaking' || VoiceService.isSpeaking()) {
      await VoiceService.stop();
      if (navigationVoiceTimeoutRef.current) {
        clearTimeout(navigationVoiceTimeoutRef.current);
        navigationVoiceTimeoutRef.current = null;
      }
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      await startListeningInNavigation();
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
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      await startListeningInNavigation();
    }
  };

  // Pantalla de carga activa mientras se obtiene señal GPS real (evita renderizar mapa en Reforma)
  if (!effectiveLocation && (!activeRouteCoords || activeRouteCoords.length === 0)) {
    return (
      <View style={[styles.container, styles.loadingScreenContainer, { backgroundColor: currentTheme.background }]}>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        <ActivityIndicator
          size="large"
          color={currentTheme.buttonOrange}
          style={{ transform: [{ scale: 1.6 }], marginBottom: 28 }}
        />
        <Text style={[styles.loadingScreenTitle, { color: currentTheme.textPrimary }]}>
          Obteniendo su ubicación actual...
        </Text>
        <Text style={[styles.loadingScreenSubtitle, { color: currentTheme.textSecondary }]}>
          Conectando con el satélite GPS para iniciar su navegación.{'\n'}Por favor espere un momento.
        </Text>
      </View>
    );
  }

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
        routeCoordinates={remainingRouteCoords}
        destinationMarker={activeDestinationCoords}
        destinationTitle={targetDestination}
        initialRegion={initialMapRegion}
        initialZoom={17}
        followUser={!isUserExploringMap}
        autoFitRoute={false}
        onUserInteraction={handleUserMapInteraction}
      />

      {/* 2. Capa Superior: Tarjeta de Navegación Activa y Selector de Modo */}
      <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
        <View style={styles.topContainer} pointerEvents="box-none">
          {/* Barra superior con botón de finalizar viaje y botón de simulación */}
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={handleFinalizarPress}
              onLongPress={() => handleForcedExit()}
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

          {/* Tarjeta Flotante Minimalista Turn-by-Turn con Auto-Ocultamiento Inteligente en Avenidas Rectas */}
          {shouldShowInstruction && (
            <Animated.View
              style={[
                styles.instructionCard,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.cardBorder,
                  opacity: cardOpacityAnim,
                  transform: [
                    {
                      translateY: cardOpacityAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-14, 0],
                      }),
                    },
                  ],
                },
                isDarkMode ? styles.darkCardGlow : styles.lightCardShadow,
              ]}
              pointerEvents={shouldShowInstruction ? 'auto' : 'none'}
            >
              <View style={styles.instructionSimpleRow}>
                {/* Icono de Giro Prominente */}
                <View
                  style={[
                    styles.maneuverIconCircle,
                    {
                      backgroundColor: isDarkMode ? '#1E293B' : '#E2E8F0',
                    },
                  ]}
                >
                  <Ionicons
                    name={(navProgress.maneuverIcon as any) || 'arrow-up-circle'}
                    size={32}
                    color={currentTheme.routeColor}
                  />
                </View>

                {/* Texto Esencial Sin Ruido Visual: Distancia y Maniobra */}
                <View style={styles.instructionSimpleTextCol}>
                  <Text
                    style={[
                      styles.maneuverDistanceText,
                      { color: currentTheme.textPrimary },
                    ]}
                  >
                    {navProgress.formattedDistanceToManeuver
                      ? `En ${navProgress.formattedDistanceToManeuver}`
                      : 'Continúe'}
                  </Text>
                  <Text
                    style={[
                      styles.maneuverActionText,
                      { color: currentTheme.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {instruction.replace(/^En \d+ metros?,?\s*/i, '')}
                  </Text>
                </View>

                {/* Pastilla Compacta de Tiempo y Distancia Restante */}
                <View
                  style={[
                    styles.etaBadge,
                    {
                      backgroundColor: isDarkMode ? 'rgba(0, 229, 255, 0.12)' : 'rgba(43, 91, 132, 0.1)',
                      borderColor: currentTheme.routeColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.etaBadgeTime,
                      { color: isDarkMode ? '#00E5FF' : currentTheme.routeColor },
                    ]}
                  >
                    {navProgress.formattedRemainingDuration || '—'}
                  </Text>
                  <Text
                    style={[
                      styles.etaBadgeDist,
                      { color: currentTheme.textSecondary },
                    ]}
                  >
                    {navProgress.formattedRemainingDistance || '—'}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}
        </View>

        {/* Botón flotante minimalista circular de recentrado (sin texto, ubicado a la derecha, sin encimarse con el micrófono) */}
        {isUserExploringMap && (
          <TouchableOpacity
            style={[
              styles.recenterFab,
              {
                backgroundColor: currentTheme.cardBackground,
                borderColor: currentTheme.routeColor,
              },
              isDarkMode ? styles.darkCardGlow : styles.lightCardShadow,
            ]}
            onPress={handleRecenter}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Recentrar mapa"
            accessibilityHint="Centra la vista en su vehículo y reanuda el seguimiento en perspectiva de conducción"
          >
            <Ionicons name="locate" size={28} color={currentTheme.routeColor} />
          </TouchableOpacity>
        )}

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
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  instructionSimpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  maneuverIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  instructionSimpleTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  maneuverDistanceText: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  maneuverActionText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 2,
  },
  etaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  etaBadgeTime: {
    fontSize: 14,
    fontWeight: '800',
  },
  etaBadgeDist: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
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
  recenterFab: {
    position: 'absolute',
    right: 20,
    bottom: 145,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    elevation: 8,
  },
  loadingScreenContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingScreenTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  loadingScreenSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
  },
});
