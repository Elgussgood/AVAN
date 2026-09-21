import React, { useState } from 'react';
import { useColorScheme } from 'react-native';
import { LatLng } from 'react-native-maps';
import { HomeScreen } from './src/screens/HomeScreen';
import { MinimalHomeScreen, RouteData } from './src/screens/MinimalHomeScreen';
import {
  ConversationService,
  ConversationContext,
} from './src/services/conversationService';

export default function App() {
  const systemColorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    systemColorScheme === 'dark'
  );

  // Requisito 1: La app DEBE iniciar en MinimalHomeScreen (One-Button UI pura)
  const [viewMode, setViewMode] = useState<'minimal' | 'map'>('minimal');
  const [currentDestination, setCurrentDestination] = useState<string>('Hospital General');
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [destinationCoords, setDestinationCoords] = useState<LatLng | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [remainingDistance, setRemainingDistance] = useState<number>(0);
  const [remainingDuration, setRemainingDuration] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [conversationContext, setConversationContext] = useState<ConversationContext>(() =>
    ConversationService.createInitialContext('GUSTAVO')
  );

  const handleToggleTheme = () => {
    setIsDarkMode((prev) => !prev);
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
    setZoomLevel(1.0);
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
        userName="GUSTAVO"
        destination={currentDestination}
        routeCoordinates={routeCoordinates}
        destinationCoords={destinationCoords}
        instruction={currentInstruction}
        remainingDistance={remainingDistance}
        remainingDuration={remainingDuration}
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
      userName="GUSTAVO"
      onStartTrip={handleStartTrip}
      context={conversationContext}
      onContextChange={setConversationContext}
    />
  );
}
