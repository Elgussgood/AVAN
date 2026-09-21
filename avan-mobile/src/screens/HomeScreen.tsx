import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Text,
  TouchableOpacity,
} from 'react-native';
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
  userName?: string;
  zoomLevel?: number;
  onZoomChange?: (newZoom: number) => void;
  context?: ConversationContext;
  onContextChange?: (ctx: ConversationContext) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  isDarkMode,
  onToggleTheme,
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
  const targetDestination = destination || destinationName || 'Hospital General';
  const handleExit = onStopTrip || onCancelTrip || (() => {});
  const mapRef = useRef<InteractiveMapRef>(null);
  const { userLocation } = useLocationTracking();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [instruction, setInstruction] = useState<string>(
    propInstruction || 'En 200 metros, continúa recto por la vía principal'
  );

  const contextRef = useRef<ConversationContext>(
    context ||
      ConversationService.createInitialContext(userName, userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      } : undefined)
  );

  const currentTheme = isDarkMode ? darkTheme : lightTheme;

  // Actualizar instrucción si cambia desde props
  useEffect(() => {
    if (propInstruction) {
      setInstruction(propInstruction);
    }
  }, [propInstruction]);

  // Al montar la pantalla o recibir nueva ruta, encuadrar la polilínea en el mapa
  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length > 0 && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(routeCoordinates, {
          edgePadding: { top: 160, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }, 700);
    }
  }, [routeCoordinates]);

  // Al montar la pantalla de navegación activa, dar la bienvenida de inicio de ruta
  useEffect(() => {
    const welcomeMsg = `Iniciando ruta hacia ${targetDestination}. ${instruction}.`;
    VoiceService.speak(welcomeMsg);
  }, [targetDestination]);

  const handleVoicePress = async () => {
    if (voiceState === 'speaking') {
      await VoiceService.stop();
      setVoiceState('idle');
      setStatusMessage('');
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

      // Grabar durante 3.5 segundos o hasta interacción
      setTimeout(async () => {
        setVoiceState('processing');
        setStatusMessage('Procesando...');

        const transcription = await AudioRecorderService.stopAndTranscribe();
        const speechText = transcription?.text || '¿cuánto falta para llegar?';
        const lowerText = speechText.toLowerCase();

        // Manejo directo de comandos de mapa frecuentes en marcha
        if (lowerText.includes('acercar') || lowerText.includes('cerca')) {
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

        if (lowerText.includes('alejar') || lowerText.includes('lejos')) {
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

        if (lowerText.includes('centrar') || lowerText.includes('dónde estoy')) {
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

        if (
          lowerText.includes('cancelar') ||
          lowerText.includes('detener') ||
          lowerText.includes('terminar')
        ) {
          const responseText = 'Cancelando viaje. Volviendo al inicio.';
          setVoiceState('speaking');
          setStatusMessage(responseText);
          await VoiceService.speak(responseText, () => {
            handleExit();
          });
          return;
        }

        // Si es otra consulta, procesar por NLU
        const response = await ConversationService.processUserMessage(
          speechText,
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
            handleExit();
            return;
          }
        }

        setVoiceState('speaking');
        setStatusMessage('Hablando...');

        await VoiceService.speak(response.spokenText, () => {
          setVoiceState('idle');
          setStatusMessage('');
        });
      }, 3500);
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
        routeCoordinates={routeCoordinates}
        destinationMarker={destinationCoords}
        destinationTitle={targetDestination}
        followUser={true}
      />

      {/* 2. Capa Superior: Tarjeta de Navegación Activa y Selector de Modo */}
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topContainer}>
          {/* Barra superior con botón de cancelar y selector de tema */}
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={handleExit}
              style={[
                styles.cancelButton,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.cardBorder,
                },
              ]}
              accessibilityLabel="Cancelar viaje y volver a inicio"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color="#EF4444" />
              <Text style={styles.cancelButtonText}>Finalizar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onToggleTheme}
              style={styles.themeToggle}
              accessibilityLabel={
                isDarkMode ? 'Cambiar a modo día' : 'Cambiar a modo noche'
              }
              accessibilityRole="button"
            >
              <Ionicons
                name={isDarkMode ? 'moon' : 'sunny-outline'}
                size={32}
                color={currentTheme.headerIcon}
              />
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
  themeToggle: {
    padding: 6,
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
