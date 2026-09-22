# TASK.md - Plan de Desarrollo de AVAN

## Visión del Producto
Aplicación de navegación simplificada para adultos mayores que conducen su propio vehículo.
- **Flujo de Pantallas**:
  1. **Inicio / Reposo**: Pantalla de *un solo botón en medio* (`MinimalHomeScreen`), libre de mapas y distracciones.
  2. **Diálogo de Voz**: El usuario solicita un destino y el sistema confirma en 2 pasos de forma empática y con voz humana/natural.
  3. **Viaje Activo**: Al confirmar el viaje, se transiciona automáticamente a la vista de mapa (`HomeScreen`), mostrando la ruta activa calculada por OpenRouteService, la flecha de navegación orientada por rumbo y el botón inferior para comandos en marcha.
  4. **Retorno a Inicio**: Al cancelar el viaje o llegar a destino, la app vuelve automáticamente a la vista inicial del botón en medio.

---

## Especificación Visual (Conforme a Mockups de `IMG/mockup_modes.png`)
- **Modo Claro (Día)**:
  - Fondo del Mapa: Claro y de alto contraste (`#F1F4F7`), carreteras blancas con bordes limpios, parques suaves (`#D5ECD5`), sin saturación de POIs.
  - Indicador Superior: Icono de Sol.
  - Tarjeta Superior: Marfil suave (`#FFF9F0`), avatar circular y `"HOLA, [USER NAME]"`.
  - Cursor Vehicular: Flecha chevron azul (`#2B5B84`) orientada por brújula y polilínea azul.
  - Botón de Micrófono: Círculo naranja vibrante (`#FF5722`) de 108dp en navegación y 144dp en inicio.
- **Modo Oscuro (Noche)**:
  - Fondo del Mapa: Azul marino profundo (`#0B111D`), carreteras azul noche (`#172238`), sin deslumbramiento.
  - Indicador Superior: Icono de Luna con estrellas.
  - Tarjeta Superior: Fondo translúcido oscuro con aro de luz cian en el avatar.
  - Cursor Vehicular: Flecha chevron cian neón (`#00E5FF`) y polilínea luminiscente.
  - Botón de Micrófono: Naranja vibrante de alto contraste con resplandor cálido.

---

## Asignación de Tareas por Agente Especializado

### 1. Agente de Voz STT / TTS (`05-voz-stt-tts.md` / `voz_stt_agent`)
- [x] **TASK-06**: Implementar servicio base de voz TTS con `expo-speech`.
- [x] **TASK-07**: Implementar servicio STT (`audioRecorder.ts`) con `expo-file-system` `UploadTask` y Whisper Groq/OpenAI API (Zero-Persistence).
- [x] **TASK-07B**: **Voz Humana y Natural**: `voiceService.ts` integrado con ElevenLabs (`EXAVITQu4vr4xnSDxMaL` - Sarah / Bella) y OpenAI TTS (`tts-1`, voz `nova`), pre-procesamiento de abreviaturas viales, entonación en español neutro/mexicano y fallback a voces del sistema.

### 2. Agente de Mapas y Ruteo (`06-mapas-ruteo.md` / `mapas_ruteo_agent`)
- [x] **TASK-10**: **Mapa Funcional Personalizado**: `react-native-maps` con estilos JSON para Modo Día (#F1F4F7, calles blancas, parques suaves) y Modo Noche (#0B111D, calles azul noche, polilínea cian neón), eliminando distracciones de POIs comerciales.
- [x] **TASK-11**: **Seguimiento de Ubicación GPS y Rumbo**: Conectado `LocationService` y `useLocationTracking` con `expo-location` para posicionamiento y rotación del cursor chevron según el heading.
- [x] **TASK-12**: **Servicio OpenRouteService (`orsService.ts`)**: Geocodificación en lenguaje natural, cálculo de ruta con polilínea e instrucciones turn-by-turn.
- [x] **TASK-13**: **Control de Zoom por Voz**: Métodos imperativos `zoomIn()`, `zoomOut()`, `recenter()` y `fitToCoordinates()` conectados a comandos de voz en marcha.

### 3. Agente Mobile / Frontend (`07-mobile-frontend.md` / `mobile_frontend_agent`)
- [x] **TASK-01**: Inicializar proyecto Expo con TypeScript y configurar permisos.
- [x] **TASK-02**: Sistema de temas (Día / Noche) en `theme.ts`.
- [x] **TASK-03**: Componente `GreetingCard.tsx`.
- [x] **TASK-04**: Componente `VoiceActionButton.tsx` con alineación geométrica del halo pulsante sin desfase.
- [x] **TASK-05**: Pantalla `MinimalHomeScreen.tsx` (botón en medio para inicio, One-Button UI pura).
- [x] **TASK-05B**: **Transición Dinámica de Flujo**: Inicio exclusivo en `MinimalHomeScreen`. Al confirmar viaje por voz, transición automática a `HomeScreen` con mapa activo y cálculo de ruta; al cancelar o finalizar, retorno automático a `MinimalHomeScreen`.
- [x] **TASK-05C**: **Feedback de Procesamiento**: Indicador de carga animado (`ActivityIndicator`) dentro del botón central y color ámbar (`#D97706`) durante la espera del LLM y TTS.

### 4. Agente de NLU / Backend Conversacional (`04-nlu-conversacional.md` / `nlu_conversacional_agent`)
- [x] **TASK-08**: Servicio `conversationService.ts` con Function Calling gerontológico en Groq (`openai/gpt-oss-120b`) y confirmación estricta en 2 pasos.
- [x] **TASK-08B**: **Servicio de Alias (`aliasService.ts`)**: Catálogo precargado de sitios frecuentes en CDMX y registro dinámico de alias por voz.
- [x] **TASK-08C**: **Viajes Foráneos y Tráfico**: Advertencia de seguridad en trayectos >50 km y comandos de tráfico e incidentes en ruta.
- [x] **TASK-08D**: **Flujo de Auto-Escucha en Cancelación y Continuidad**: El micrófono se mantiene escuchando automáticamente tras preguntar si desea viajar a otro lugar.
- [x] **TASK-09**: **Ciclo Completo End-to-End**: Pulsación de botón, grabación de voz con tolerancia de 8s de silencio, transcripción Whisper, análisis NLU determinista, cálculo de ruta real con ORS, renderizado en mapa con flecha vehicular e interacción auditiva natural.

### 5. Agente de Backend / Persistencia (`08-backend-infraestructura.md`)
- [ ] **TASK-15**: Configuración de Supabase para almacenar sitios frecuentes ("casa de mi hijo") y sincronizar apodos en la nube.
- [ ] **TASK-16**: Sincronización y backup de destinos frecuentes con autenticación discreta/familiar.

### 6. Agente de QA / Accesibilidad (`09-qa-accesibilidad.md`)
- [x] **TASK-14**: Certificación de compilación TypeScript (`npx tsc --noEmit` con 0 errores).
- [ ] **TASK-17**: Compilación de APK de prueba con EAS Build (`eas build -p android --profile preview`) para pruebas en vehículo real.

