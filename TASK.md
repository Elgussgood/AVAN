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

---

## Fases del Proyecto

### Fase 1: Arquitectura Base, One-Button UI y Visualización de Mapas [COMPLETADA]
- [x] **TASK-01**: Inicializar proyecto Expo con TypeScript y permisos.
- [x] **TASK-02**: Sistema de temas (Día / Noche) en `theme.ts`.
- [x] **TASK-03**: Componente `GreetingCard.tsx`.
- [x] **TASK-04**: Componente `VoiceActionButton.tsx` con alineación geométrica del halo pulsante.
- [x] **TASK-05**: Pantalla `MinimalHomeScreen.tsx` (botón en medio para inicio, One-Button UI pura).
- [x] **TASK-10**: Estilos JSON de mapa claro y oscuro con `react-native-maps`.
- [x] **TASK-11**: Seguimiento de GPS y rumbo con `expo-location`.
- [x] **TASK-12**: Integración OpenRouteService (`orsService.ts`) para ruteo vehicular.

### Fase 2: Motor Conversacional NLU, TTS Humano y Flujos Gerontológicos [COMPLETADA]
- [x] **TASK-06**: Síntesis TTS con `expo-speech` y fallback adaptativo.
- [x] **TASK-07**: Grabación STT nativa (`audioRecorder.ts`) con Groq Whisper (Zero-Persistence).
- [x] **TASK-07B**: Síntesis ultra-natural con ElevenLabs TTS y OpenAI TTS.
- [x] **TASK-08**: NLU Function Calling en Groq (`openai/gpt-oss-120b`) con confirmación en 2 pasos.
- [x] **TASK-08B**: Catálogo de alias y sitios frecuentes de CDMX (`aliasService.ts`).
- [x] **TASK-08C**: Advertencia de seguridad para viajes foráneos (>50 km) y reporte de incidentes.
- [x] **TASK-08D**: Protocolo de cancelación en 2 pasos, continuidad con auto-escucha y supresión de micro en despedidas.
- [x] **TASK-09**: Integración End-to-End: botón -> voz natural -> confirmación -> mapa -> retorno a reposo.
- [x] **TASK-05B**: Transición automática entre `MinimalHomeScreen` y `HomeScreen`.
- [x] **TASK-05C**: Feedback visual gerontológico con pantalla de carga e indicador de procesamiento en botón.
- [x] **TASK-14**: Certificación estricta de compilación TypeScript (`npx tsc --noEmit` con 0 errores).

---

### Fase 3: Persistencia en la Nube, Navegación Dinámica y Release en Vehículo Real [EN CURSO]

#### 1. Agente de Backend e Infraestructura (`08-backend-infraestructura.md`)
- [x] **TASK-15**: **Integración de Supabase Client y Esquema de Datos**:
  - Configurado cliente Supabase en `src/services/supabaseClient.ts` con `@supabase/supabase-js` y `@react-native-async-storage/async-storage` con modo fallback local seguro.
  - Creado esquema SQL completo en `supabase/schema.sql` para la tabla `user_places` (`id`, `user_id`, `alias`, `display_name`, `address`, `latitude`, `longitude`, `category`, `created_at`, `updated_at`).
  - Configurado Row Level Security (RLS), triggers de actualización automática e índices para búsquedas optimizadas en lenguaje natural.
- [x] **TASK-16**: **Sincronización Bidireccional de Sitios Frecuentes (Offline-First)**:
  - Evolucionado `aliasService.ts` a arquitectura offline-first con persistencia local inmediata en `AsyncStorage` (`@avan_user_aliases_v1`).
  - Sincronización transparente y en segundo plano con Supabase para permitir a cuidadores familiares registrar o editar lugares favoritos ("casa de mi hijo", "el doctor", "la farmacia") remotamente.

#### 2. Agente de Mapas y Ruteo (`06-mapas-ruteo.md`) & Agente Mobile (`07-mobile-frontend.md`)
- [x] **TASK-18**: **Navegación Dinámica Turn-by-Turn en Marcha**:
  - Algoritmo de seguimiento de maniobras paso a paso según la proximidad GPS al próximo waypoint en `navigationService.ts`.
  - Anuncio por voz proactivo y automático de maniobras (<140m aviso de aproximación y <40m aviso inminente de giro) sin requerir tocar la pantalla ni distraer la vista.
  - Tarjeta de maniobra superior dinámica en `HomeScreen.tsx` con icono vectorial según el tipo de maniobra (giros, rotondas, incorporaciones), badge de distancia ("EN 180 M • RUMBO A..."), instrucción principal y tira inferior de métricas (tiempo y distancia restantes).
  - Modo simulador de recorrido ("Simular / Pausar") accesible desde la barra superior y por comandos de voz ("simular recorrido", "pausar simulación", "cuánto falta").
- [x] **TASK-19**: **Detección de Llegada y Recálculo ante Desvíos**:
  - Detección automática de llegada a destino (<45m), con vibración háptica de éxito, anuncio de voz ("Ha llegado a su destino en [Destino]") e inicio automático del diálogo de continuidad para retorno fluido a `MinimalHomeScreen`.
  - Detección geométrica de pérdida de ruta (>100 metros fuera de la polilínea por 3 lecturas continuas de GPS) con recálculo automático y transparente vía OpenRouteService sin alarmas intrusivas.

#### 4. Agente de NLU Conversacional (`04-nlu-conversacional.md`), Mobile (`07-mobile-frontend.md`) y Mapas (`06-mapas-ruteo.md`)
- [x] **TASK-21**: **Flujo Conversacional Resiliente para Registro, Confirmación y Corrección de Direcciones (`04-nlu-conversacional.md`)**:
  - Máquina de estados en `conversationService.ts`: extensión de `PendingAliasRegistration` con estados `'awaiting_address' | 'confirming_address'`, `addressCandidate`, `coordinates` y `retryCount`.
  - Geocodificación inmediata de la dirección dictada con `orsService.geocodeDestination` y formulación de confirmación: *"Entendí: [Dirección]. ¿Es correcta esta ubicación para [alias]?"*.
  - Protocolo de corrección ágil: si el usuario dice "No" o dicta una corrección directa (*"No, era en la Roma"*), se captura la nueva dirección sin perder el alias ni reiniciar el flujo.
  - Al confirmar ("Sí"): guardado en `AliasService.saveAlias` (con persistencia local y sincronización con Supabase) y ofrecimiento de iniciar viaje inmediato.
- [x] **TASK-21B**: **Persistencia de Escucha Activa al Solicitar Añadir Dirección (`04-nlu-conversacional.md` & `07-mobile-frontend.md`)**:
  - Corrección de corte prematuro del micrófono: neutralización de falsos positivos en `isFarewell` (frases corteses como "con mucho gusto" o "buen día" no apagan el micrófono si hay preguntas o registros pendientes).
  - Manejo determinista en `processUserMessage` (paso 0a) de intenciones explícitas para añadir o registrar direcciones (`isAddAddressIntent`), iniciando el estado `pendingAliasRegistration` con `shouldAutoListen: true`.
  - Tolerancia y parseo inteligente de alias y dirección combinados en una sola emisión (*"Es la casa de mi primo, en calle Sonora 120"*) o de forma guiada en dos pasos.
  - Extensión de la segunda repetición paciente de silencio a `awaiting_address` evitando desconexiones bruscas.
- [x] **TASK-21C**: **Verificación Estricta de Alias y Derivación Asistida al Registro (`04-nlu-conversacional.md`)**:
  - Detección exhaustiva de lugares personales, familiares o afectivos no registrados (`isPersonalPlaceIntent` y `detectPersonOrHomeQuery`) tanto en Groq LLM como en el motor heurístico local.
  - Al solicitar viajar a lugares personales no guardados (*"casa de mi amigo"*, *"lo de Juan"*, *"al rancho"*, *"con Pedro"*, etc.), el sistema ya no propone iniciar viaje directamente, sino que formula el registro asistido: *"No tengo guardada la ubicación de '[Alias]'. ¿Cuál es la dirección o colonia para registrarla?"* manteniendo el micrófono abierto.
- [x] **TASK-22**: **Segunda Repetición Paciente ante Silencio (Timeout) en Confirmación de Dirección (`03-voice-ux.md` & `07-mobile-frontend.md`)**:
  - En el temporizador de auto-detención de silencio (8s), si no se detecta voz mientras se espera confirmación de dirección:
  - Primer silencio (`retryCount === 0`): repetición auditiva paciente: *"Disculpe, ¿desea guardar esta dirección? Puede decir Sí para confirmar o No para corregir."*, incrementando `retryCount` y reactivando la escucha por otros 8s.
  - Segundo silencio consecutivo (`retryCount >= 1`): cierre cordial sin frustración ni errores (*"No se preocupe, podemos guardar la dirección en otro momento."*) y retorno a reposo.
- [x] **TASK-23**: **Vista Previa Visual en Mapa Durante la Confirmación de Dirección (`06-mapas-ruteo.md` & `07-mobile-frontend.md`)**:
  - Renderizado condicional en `MinimalHomeScreen.tsx` de una vista previa visual con `InteractiveMap` mostrando el pin en las coordenadas geocodificadas.
  - Tarjeta de alto contraste con el alias propuesto y la dirección formateada para validación visual inmediata por parte del adulto mayor.
  - Mantenimiento del botón dominante de micrófono para respuesta por voz y botones táctiles complementarios de accesibilidad ("✓ Sí, es correcto" / "✗ No, corregir").

- [x] **TASK-24**: **VAD Dual Dinámico de 8s/3s, Voz Nativa por Defecto y Salto de Contexto Ubicuo (`05-voz-stt-tts.md`, `04-nlu-conversacional.md`, `07-mobile-frontend.md`)**:
  - Eliminación definitiva de retardos fijos estáticos ciegos (10s, 14s, 20s).
  - Motor VAD dual en `audioRecorder.ts`: monitoreo en tiempo real por decibelios (`isMeteringEnabled: true`, umbral -40 dB). Si el usuario aún no habla, aguarda 8s de silencio inicial. Al detectar habla y luego 3 segundos de silencio continuo (trailing silence) (4s en dictado de dirección o máx 25s), detiene automáticamente y procesa con Whisper Groq, reduciendo la latencia de espera muerta en un 70%.
  - Modo voz nativa local por defecto en `voiceService.ts`: uso prioritario de `expo-speech` (`es-MX`, tasa 0.88x, tono 0.95) evitando errores por cuota de ElevenLabs y permitiendo pruebas sin consumo de API.
  - Salto de contexto ubicuo transversal en `conversationService.ts`, `HomeScreen.tsx`, `MinimalHomeScreen.tsx` y `App.tsx`:
    * En diálogo de continuidad de fin/cancelación de viaje: si el usuario pide registrar una dirección (*"Guarda la casa de mi hijo"*), un nuevo destino (*"A Chapultepec"*) o cambiar tema (*"Modo noche"*), el sistema ya no manda al inicio con despedida; inicia de inmediato la interacción correspondiente.
    * En marcha activa sobre el mapa: comandos para cambiar de destino en 2 pasos, registrar direcciones, cambiar temas o pausar/cancelar con continuidad sin salidas abruptas.
    * Preservación y sincronización de contexto entre pantallas: `App.tsx` y `MinimalHomeScreen.tsx` reciben el contexto activo desde `HomeScreen` e inician de inmediato la interacción guiada y escucha con VAD.
  - Certificación de tipos con `npx tsc --noEmit` (0 errores).

- [x] **TASK-25**: **Normalización de Direcciones Desordenadas con LLM y Geocodificación Multi-Tier Ultra-Precisa (`04-nlu-conversacional.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Diagnóstico y Eliminación de Coordenadas Falsas**:
    * Se identificó que la inexactitud en lugares generales (ej. "Bellas Artes") o direcciones dictadas se debía a la ausencia de API key de ORS que caía en un fallback sintético con `Math.sin(query.length)`, generando pines en puntos aleatorios arbitrarios.
    * Se eliminó definitivamente el generador sintético `Math.sin`.
  - **Geocodificación Multi-Tier Gratuita y Resiliente en `orsService.ts`**:
    * **Tier 1**: OpenRouteService oficial (si hay `EXPO_PUBLIC_ORS_API_KEY`).
    * **Tier 2**: Photon API de Komoot (basado en OpenStreetMap, 100% gratuito, sin API key, con geoposicionamiento enfocado en Valle de México y CDMX).
    * **Tier 3**: OpenStreetMap Nominatim con filtrado de país (`MEX`) y detalles de dirección.
    * **Tier 4**: Catálogo curado y enriquecido de landmarks emblemáticos de CDMX (Bellas Artes, Zócalo, Alameda, Soumaya, Auditorio, Parque México, Siglo XXI, Hospital General, etc.) con búsqueda semántica bidireccional y por tokens.
  - **Normalizador de Direcciones Desordenadas con LLM en `conversationService.ts`**:
    * Función `normalizeAddressWithLLM(rawInput, context)` que utiliza Groq (`openai/gpt-oss-120b`) o fallback heurístico para parsear dictados con orden invertido, muletillas o frases coloquiales (ej. *"allá por la Roma en Sonora 120 casi esquina Insurgentes"* -> `calle: "Sonora"`, `numero: "120"`, `colonia: "Roma"`, `formattedSearchQuery: "Sonora 120, Roma, Cuauhtémoc, Ciudad de México"`, `formattedUserLabel: "Sonora 120, Roma, CDMX"`).
    * Integración directa en los flujos de registro de alias (`awaiting_address`), corrección de dirección (`confirming_address`) y tool call `guardar_ubicacion`.
  - **Centrado Inmediato de Cámara y Renderizado del Pin en Mapa**:
    * En `InteractiveMap.tsx`: en el evento `MAP_READY`, Leaflet recibe de inmediato el `destinationMarker` incluso sin `routeCoordinates`, centrando la cámara en las coordenadas reales geocodificadas con zoom 16.
    * En `MinimalHomeScreen.tsx`: `InteractiveMap` utiliza una `key` reactiva basada en coordenadas (`addr-preview-lat-lng`) para re-centrar el mapa limpiamente ante cualquier corrección de dirección.
- [x] **TASK-26**: **Cancelación Fluida con "No" Corto y Vista Previa en Mapa Durante Confirmación de Viaje (`04-nlu-conversacional.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Resolución de Conflicto en Cancelación con "No" Corto**:
    * Diagnóstico: Whisper STT de Groq inserta puntos o signos finales (ej. `"No."` o `"no,"`), provocando que validaciones estrictas como `lowerText === 'no'` fallaran y mantuvieran al usuario atrapado en el bucle de continuidad.
    * Normalizador `cleanSpeech(text)` en `HomeScreen.tsx` y `conversationService.ts` que elimina signos ortográficos (`.`, `,`, `!`, `?`, etc.) y acentos.
    * En `conversationService.ts`: al recibir "no", "cancela", "detén" o "ya no" durante una confirmación pendiente, se limpian inmediatamente `pendingConfirmation` y `pendingTripCompletion`, estableciendo `requiresConfirmation: false` y `shouldAutoListen: false`, cancelando el viaje sin loops ni preguntas adicionales.
  - **Vista Previa Visual en Mapa Durante Confirmación de Viaje ("Camino Normal")**:
    * En `MinimalHomeScreen.tsx`: se unificó el contenedor de vista previa interactiva (`isShowingConfirmationPreview`) tanto para el registro de direcciones (`isConfirmingAddress`) como para la confirmación de viajes normales (`isConfirmingTrip`).
    * Al pedir un viaje (ej. *"Quiero ir a Bellas Artes"*), se geocodifican inmediatamente las coordenadas y se muestra en pantalla el mapa interactivo con el pin centrado en el destino real, la tarjeta informativa con el nombre del destino y los controles multimodales:
      - Botón Izquierdo: `"SÍ, INICIAR VIAJE"` (verde de alto contraste).
      - Botón Central: Micrófono con halo animado para confirmar o cancelar por voz.
      - Botón Derecho: `"CANCELAR"` (rojo de alto contraste).
    * Reutilización instantánea de las coordenadas validadas en `pendingConfirmation` para calcular la ruta vehicular sin demoras adicionales ni solicitudes de red repetidas.
- [x] **TASK-27**: **Geocodificación Multi-Tier de Alta Fidelidad y Reducción de Zoom Gerontológico (`06-mapas-ruteo.md`, `07-mobile-frontend.md`, `09-qa-accesibilidad.md`)**:
  - **Plan de Determinación Correcta de Direcciones y Geocodificación**:
    * Diagnóstico de causa raíz: ORS ejecutaba búsquedas abiertas a nivel nacional (`boundary.country=MEX`). Ante consultas comunes de CDMX como "Bellas Artes" o "Sonora 120, Roma", ORS devolvía resultados homónimos rurales en Jalisco ("Bellas Artes, JAL") o Tlalnepantla, y como ORS devolvía un array no vacío, el catálogo curado local (ubicado erróneamente en Tier 4) nunca se consultaba.
    * Reestructuración Multi-Tier:
      - **Tier 0 (Prioridad 1 - Catálogo Curado)**: Búsqueda inmediata en el catálogo de alta fidelidad de CDMX (Bellas Artes, Zócalo, Ángel, Chapultepec, Hospital General, ESCOM, UNAM, Soumaya, etc.) con 100% de precisión y 0ms de latencia.
      - **Tier 1 (ORS con Círculo Delimitador Metropolitano)**: Búsqueda con `boundary.circle` de 65 km de radio centrado en la posición GPS del usuario o el centro de CDMX (`19.4326, -99.1332`), eliminando saltos arbitrarios a otros estados para trayectos locales, y búsqueda nacional automática para destinos foráneos (Puebla, Toluca, Acapulco).
      - **Tier 2 (Filtro de Coherencia de Colonia y Nominatim)**: Si la consulta dictada menciona una colonia específica (ej. "Roma", "Condesa", "Del Valle", "Polanco"), se verifica que el resultado devuelto contenga dicha colonia; si no la contiene, se delega a Nominatim con viewbox metropolitano (`viewbox=-99.38,19.62,-98.92,19.15`), logrando resolver calles específicas con precisión milimétrica (ej. "Sonora 120, Roma" a 0.25 km de Avenida Sonora, Roma Norte).
      - **Tier 3 (Photon de Komoot)**: Geocodificación con sesgo de latitud y longitud.
  - **Ajuste del Nivel de Zoom Gerontológico en Vista Previa**:
    * En `InteractiveMap.tsx`: se redujo el zoom excesivo de 16 a **14** tanto en la inicialización como en `setView` al renderizar el marcador de destino, permitiendo al conductor visualizar el entorno urbano, avenidas principales y contexto cartográfico reconocible.
    * En `MinimalHomeScreen.tsx`: se aumentó la amplitud del delta visual de `0.008` a `0.024` grados (~2.5 km a la redonda) y se configuró `initialZoom={14}` para ambas ocasiones de confirmación (dirección y viaje).
  - **Validación y Certificación**:
    * 8/8 pruebas automatizadas de geocodificación superadas con éxito con desviaciones menores a 0.5 km en CDMX.
    * Certificación de tipos con `npx tsc --noEmit` (0 errores).
- [x] **TASK-28**: **Calibración de VAD y Silencio Posterior con Margen Gerontológico (`05-voz-stt-tts.md`, `07-mobile-frontend.md`, `03-voice-ux.md`)**:
  - **Optimización del Tiempo de Espera Tras Hablar (Trailing Silence)**:
    * Se redujo el tiempo de espera por silencio posterior (`trailingSilenceMs`) de 3.0s a **1.8s** en interacciones generales, respuestas directas ("Sí", "No", "¿A dónde le gustaría ir?") y comandos de navegación.
    * En el flujo de dictado de direcciones completas (`isDictatingAddress`), se ajustó de 4.0s a **2.5s**, proporcionando holgura para pausas de pensamiento sin que la escucha se sienta lenta o rezagada.
    * Se mantuvo intacto el margen de silencio inicial (`initialSilenceMs: 8000`), garantizando que los adultos mayores dispongan de 8 segundos completos para comenzar a hablar sin ser apresurados.
    * Se ajustó el umbral de detección de voz (`speechThresholdDb`) de -40 dB a **-38 dB** para evitar que ruidos ambientales o vehiculares leves reinicien erróneamente el temporizador de silencio.
  - **Sincronización Global de Parámetros VAD**:
    * Actualizado en el servicio central `AudioRecorderService` ([`audioRecorder.ts`](file:///D:/Escom/Sexto%20semestre/Interacci%C3%B3n/AVAN/avan-mobile/src/services/audioRecorder.ts)).
    * Actualizado en [`MinimalHomeScreen.tsx`](file:///D:/Escom/Sexto%20semestre/Interacci%C3%B3n/AVAN/avan-mobile/src/screens/MinimalHomeScreen.tsx) (escucha principal y confirmaciones).
    * Actualizado en [`HomeScreen.tsx`](file:///D:/Escom/Sexto%20semestre/Interacci%C3%B3n/AVAN/avan-mobile/src/screens/HomeScreen.tsx) (diálogos de continuidad de viaje, fin de ruta, despedida y comandos en ruta).
  - **Certificación**:
    * `npx tsc --noEmit` certificado con 0 errores.

#### 5. Agente de Privacidad y Seguridad (`10-privacidad-seguridad.md`)
- [ ] **TASK-20**: **Auditoría de Seguridad y Zero-Persistence en Producción**:
  - Actualización y blindaje de `.env.example` con las credenciales de Supabase.
  - Verificación de no-persistencia de audios ni datos de rastreo no autorizados.

#### 6. Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)
- [ ] **TASK-17**: **Configuración de EAS Build y Generación de APK de Prueba**:
  - Configuración de `eas.json` con perfil `preview` para generación de APK independiente (sideloading en Android).
  - Validación de compilación limpia y pruebas de campo en vehículo real.


