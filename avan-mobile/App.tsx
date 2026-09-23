import React, { useState } from 'react';
import { useColorScheme } from 'react-native';
import { LatLng } from 'react-native-maps';
import { HomeScreen } from './src/screens/HomeScreen';
import { MinimalHomeScreen, RouteData } from './src/screens/MinimalHomeScreen';
import { StepInstruction } from './src/services/orsService';
import {
  ConversationService,
  ConversationContext,
} from './src/services/conversationService';

export default function App() {
  // Modo Día/Noche automático según la hora (19:00 a 06:30 es noche)
  const isNightHour = (): boolean => {
    const hour = new Date().getHours();
    return hour >= 19 || hour < 7;
  };

  const systemColorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return isNightHour() || systemColorScheme === 'dark';
  });

  // Requisito 1: La app DEBE iniciar en MinimalHomeScreen (One-Button UI pura)
  const [viewMode, setViewMode] = useState<'minimal' | 'map'>('minimal');
  const [currentDestination, setCurrentDestination] = useState<string>('Hospital General');
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [destinationCoords, setDestinationCoords] = useState<LatLng | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [remainingDistance, setRemainingDistance] = useState<number>(0);
  const [remainingDuration, setRemainingDuration] = useState<number>(0);
  const [routeSteps, setRouteSteps] = useState<StepInstruction[]>([]);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [conversationContext, setConversationContext] = useState<ConversationContext>(() =>
    ConversationService.createInitialContext('GUSTAVO')
  );

  const handleToggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  const handleSetThemeMode = (dark: boolean) => {
    setIsDarkMode(dark);
  };

  const handleToggleView = () => {
    setViewMode((prev) => (prev === 'minimal' ? 'map' : 'minimal'));
  };

  /**
   * Transición automática a HomeScreen cuando se confirma el viaje (Paso 2)
   * con cálculo real de la ruta en el mapa
   */
  const handleStartTrip = (destination: string, routeData?: RouteData) => {
    setCurrentDestination(destination);
    if (routeData) {
      setRouteCoordinates(routeData.routeCoordinates);
      setDestinationCoords(routeData.destinationCoords);
      setCurrentInstruction(routeData.instruction);
      setRemainingDistance(routeData.distance);
      setRemainingDuration(routeData.duration);
      setRouteSteps(routeData.steps || []);
    }
    setZoomLevel(1.0);
    setViewMode('map');
  };

  /**
   * Detener la navegación y regresar automáticamente a MinimalHomeScreen
   */
  const handleStopTrip = () => {
    setCurrentDestination('');
    setRouteCoordinates([]);
    setDestinationCoords(null);
    setCurrentInstruction('');
    setRemainingDistance(0);
    setRemainingDuration(0);
    setRouteSteps([]);
    setZoomLevel(1.0);
    setConversationContext(ConversationService.createInitialContext('GUSTAVO'));
    setViewMode('minimal');
  };

  const handleZoomChange = (newZoom: number) => {
    setZoomLevel(newZoom);
  };

  if (viewMode === 'map') {
    return (
      <HomeScreen
        onToggleView={handleToggleView}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        onSetThemeMode={handleSetThemeMode}
        userName="GUSTAVO"
        destination={currentDestination}
        routeCoordinates={routeCoordinates}
        destinationCoords={destinationCoords}
        instruction={currentInstruction}
        remainingDistance={remainingDistance}
        remainingDuration={remainingDuration}
        steps={routeSteps}
        zoomLevel={zoomLevel}
        onZoomChange={handleZoomChange}
        onStopTrip={handleStopTrip}
        context={conversationContext}
        onContextChange={setConversationContext}
      />
    );
  }

  return (
    <MinimalHomeScreen
      onToggleView={handleToggleView}
      isDarkMode={isDarkMode}
      onToggleTheme={handleToggleTheme}
      onSetThemeMode={handleSetThemeMode}
      userName="GUSTAVO"
      onStartTrip={handleStartTrip}
      context={conversationContext}
      onContextChange={setConversationContext}
    />
  );
}
