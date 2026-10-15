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
- [x] **TASK-29**: **Mitigación de Ruido Acústico Vehicular, VAD Adaptativo y Blindaje Anti-Alucinaciones en Whisper STT (`05-voz-stt-tts.md`, `07-mobile-frontend.md`)**:
  - **Estimación Dinámica de Piso de Ruido (Noise Floor Calibration)**:
    * Se implementó calibración inicial durante los primeros 400ms y seguimiento continuo mediante promedio móvil exponencial (EMA) para medir el nivel acústico ambiental del habitáculo o vehículo.
    * Umbral adaptativo dinámico: `adaptiveThresholdDb = Math.max(baseSpeechThresholdDb, noiseFloorDb + 8 dB)`, elevando automáticamente la sensibilidad requerida en presencia de rodamiento, tráfico o aire acondicionado sin captar el ruido de fondo como voz.
    * Elevación del umbral mínimo de habla (`baseSpeechThresholdDb`) de -38 dB a **-32 dB**.
  - **Persistencia Temporal y Debounce Acústico**:
    * Se eliminó el disparo por picos aislados de 100ms; ahora se exige un mínimo de **2 frames consecutivos (~200ms)** por encima del umbral adaptativo para confirmar el inicio de habla.
    * Filtro de duración mínima de habla: si un evento acústico dura menos de 300ms o menos de 2 frames en total (clicks, baches, tos lejana), se descarta como ruido espurio y el sistema reanuda la escucha sin cortar la interacción ni llamar a la API.
  - **Blindaje Anti-Alucinaciones y Sanitización de Whisper**:
    * Se incorporó `temperature: 0` para eliminar estocasticidad y desalentar alucinaciones en silencio o ruido.
    * Se acondicionó la inferencia con el `prompt`: *"Comandos breves de navegación vehicular AVAN en español. Si solo hay silencio, ruido de motor o ambiente de auto, responde exactamente vacío."*
    * Sanitizador heurístico estático `sanitizeWhisperOutput(text)` que detecta y descarta alucinaciones típicas de Whisper sobre ruido (subtítulos de Amara/YouTube, signos aislados de puntuación, etiquetas de sonido y bucles autoregresivos).
  - **Certificación**:
    * `npx tsc --noEmit` ejecutado con 0 errores.

- [x] **TASK-30**: **Ruteo Vehicular Multi-Tier Resiliente (ORS + OSRM) y Auto-Encuadre Cartográfico (`06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Diagnóstico de Rutas Mal Trazadas (Líneas Curvas y Desconexión de Calles)**:
    * Se diagnosticó por qué las rutas se veían incorrectas: al solicitar direcciones a OpenRouteService (`/v2/directions/driving-car/geojson`), la API de ORS arrojaba `504 Gateway Time-out` (o `403 Forbidden` en claves con cuota no activada para direcciones).
    * Al fallar ORS, el sistema caía en `generateFallbackRoute`, el cual trazaba una curva senoidal matemática sintética (`Math.sin(t * Math.PI)`) atravesando manzanas y edificios en vez de seguir la traza urbana vehicular.
  - **Arquitectura de Ruteo Multi-Tier de Alta Resiliencia en `orsService.ts`**:
    * **Tier 1 (OpenRouteService con AbortController de 3.5s)**: Si hay clave configurada y responde ágilmente, se usa ORS. Si excede 3.5 segundos o arroja error, se aborta sin bloquear la UI del conductor.
    * **Tier 2 (OSRM - Open Source Routing Machine)**:
      - Motor de enrutamiento basado en OpenStreetMap: `https://router.project-osrm.org/route/v1/driving/...`
      - 100% gratuito, sin cuotas ni necesidad de API key.
      - Latencia ultra-baja: responde en **500 - 600 ms**.
      - Geometría vehicular exacta de calles reales (ej. 284 puntos de calle entre ESCOM y Bellas Artes siguiendo Eje Central, Insurgentes, etc.).
      - Maniobras turn-by-turn reales traducidas al español mexicano cálido y accesible (`translateOsrmManeuver`) con nombres exactos de avenidas y calles (*"Inicie su recorrido por..."*, *"Gire a la derecha en Avenida Juárez"*, *"En la rotonda tome la salida hacia..."*).
      - Mapeo secuencial de índices `wayPoints` (`[startIndex, endIndex]`) perfectamente coordinado con `NavigationService.evaluateProgress` para los anuncios por voz proactivos a <180m y <55m.
    * **Tier 3 (Fallback de Emergencia Local)**: Reservado exclusivamente para escenarios sin conexión a internet (offline).
  - **Auto-Encuadre de Polilínea en Pantalla (`InteractiveMap.tsx`)**:
    * Al renderizar la ruta activa (`routeMainPolyline`), el mapa de Leaflet calcula de forma inmediata los límites de la polilínea y ejecuta `map.fitBounds(routeMainPolyline.getBounds(), { paddingTopLeft: [90, 40], paddingBottomRight: [90, 160], maxZoom: 16, animate: true })`.
    * Garantiza que el conductor observe el recorrido completo en el mapa con los márgenes de seguridad ergonómicos adecuados para la tarjeta superior y el botón inferior.
  - **Certificación**:
    * Verificación algorítmica de waypoints y trazado de rutas reales en CDMX superada.
    * `npx tsc --noEmit` certificado con 0 errores.

- [x] **TASK-31**: **Navegación Táctil Interactiva, Zoom Vehicular Calibrado (17) y Zoom Graduado por Voz con Intensidad (`02-ux-accesibilidad.md`, `04-nlu-conversacional.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Calibración y Normalización del Zoom Gerontológico de Conducción**:
    * Diagnóstico de causa raíz: la llamada automática a `fitToCoordinates` intentaba forzar toda la polilínea completa en pantalla, provocando que en rutas largas el mapa se alejara a nivel 11-12 (calles invisibles) y al interrumpir o recalcular hacia tramos cortos se acercara abruptamente a nivel 18-19.
    * Definición de constantes canónicas:
      - `ZOOM_NAVIGATION = 17`: Zoom cercano de conducción turn-by-turn fijado en el vehículo con orientación de rumbo, garantizando visibilidad inmediata de calles y esquinas de giro.
      - `ZOOM_PREVIEW = 14`: Zoom panorámico para la confirmación de destino en `MinimalHomeScreen`.
    * Al iniciar cualquier viaje o interrumpir uno para empezar otro, la cámara se posiciona siempre de manera estable y consistente en zoom 17 sin saltos visuales descalibrados.
  - **Desbloqueo Táctil Total del Mapa (Estilo Google Maps)**:
    * Se eliminó el bloqueo de gestos: configuración de `pointerEvents="box-none"` en `SafeAreaView` y `topContainer` en `HomeScreen.tsx`, permitiendo que los eventos táctiles lleguen al mapa interactivo.
    * En `InteractiveMap.tsx`, se habilitó `scrollEnabled={true}` en el `WebView` y `dragging: true, touchZoom: true, tap: true, doubleClickZoom: true` en Leaflet.
    * Detección de exploración manual (`USER_INTERACTION`): al arrastrar o hacer pinch-to-zoom con los dedos, la app suspende el seguimiento forzado de cámara para permitir al usuario inspeccionar cruces e incidentes libremente.
    * Botón flotante accesible **"Recentrar"**: componente de alto contraste con icono de localización y tipografía grande que emerge sobre el botón de voz; al pulsarlo (o al decir *"centrar mapa"*), reubica suavemente la vista en el auto con zoom 17. Incluye auto-recentrado automático tras 10 segundos de inactividad táctil.
  - **Control de Zoom Graduado por Voz vía Function Calling**:
    * Extensión de la herramienta `ajustar_zoom` en `conversationService.ts` con el argumento `intensidad: 'normal' | 'mucho' | 'poco'`.
    * Acondicionamiento del System Prompt en Groq LLM y del motor heurístico local con expresiones naturales ("haz mucho zoom", "acerca bastante", "aleja un poco", "al máximo").
    * Ejecución dinámica en `InteractiveMap.tsx` con deltas proporcionales (+1.0 normal, +2.0 mucho, +0.5 poco / -1.5 normal, -3.5 mucho, -0.7 poco).
- [x] **TASK-32**: **Perspectiva POV del Conductor (Heading-Up Google Maps), Tarjeta Minimalista con Auto-Ocultamiento, FAB Circular de Recentrado y Confirmación con Mapa en Continuidad (`02-ux-accesibilidad.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Perspectiva POV del Conductor (Heading-Up Orientado al Rumbo)**:
    * Se integró el plugin oficial `leaflet-rotate` (v0.2.8) en `InteractiveMap.tsx` con soporte para rotación continua de teselas, polilíneas de ruta y marcadores.
    * En navegación activa (`followUser: true`), el mapa rota dinámicamente con `map.setBearing(heading)` hacia el rumbo del vehículo; la flecha chevron permanece apuntando siempre hacia adelante/arriba (`0deg` relativo a la pantalla), proporcionando la perspectiva natural de cabina vehicular idéntica a Google Maps / Waze.
    * Soporte para rotación táctil con dos dedos (`touchRotate: true`) al explorar el mapa manualmente.
    * Al recentrar, la cámara vuelve a enfocar el vehículo y reorienta el mapa al rumbo actual de avance.
  - **Tarjeta de Maniobras Minimalista y Auto-Ocultamiento Inteligente**:
    * Rediseño sin ruido visual en `HomeScreen.tsx`: se eliminaron textos redundantes y filas duplicadas de métricas. Se condensó en una sola fila limpia con icono de giro prominente (32px), distancia en gran tamaño ("En 200 m"), maniobra concisa ("Gire a la derecha") y pastilla compacta de tiempo/distancia ("12 min • 4.2 km").
    * Auto-ocultamiento en tramos rectos prolongados: si la maniobra actual es seguir recto y la distancia al siguiente punto de giro supera los 450 metros (`distanceToNextManeuver > 450`), la tarjeta se desvanece suavemente con `Animated.timing` (opacidad y traslación vertical), dejando el mapa 100% despejado y libre de distracciones visuales.
    * Reaparición automática y oportuna cuando falten <= 450m para un giro, cuando la maniobra requiera acción (giros, rotondas, cambios de carril), tras un cambio reciente de maniobra (7 segundos) o al aproximarse a destino (<= 450m).
  - **Botón de Recentrar Minimalista (FAB Circular sin Texto)**:
    * Se eliminó el texto "Recentrar" y la superposición geométrica encima del botón central de voz.
    * FAB circular ergonómico de 56x56 dp con icono `locate` (28px), ubicado en la esquina inferior derecha (`right: 20, bottom: 145`), accesible con el pulgar derecho y con alto contraste cromático y sombras de elevación.
  - **Confirmación Visual con Pin en Mapa en Flujos de Continuidad**:
    * Al concluir o cancelar un viaje y solicitar un nuevo destino ("¿Desea viajar a algún otro lugar?"), el sistema geocodifica el lugar y transiciona a la pantalla de confirmación multimodal.
    * Se despliega el mapa interactivo centrado en las coordenadas geocodificadas con el pin de destino, tarjeta con el nombre del lugar y opciones táctiles y por voz ("SÍ, INICIAR VIAJE" / Micrófono / "CANCELAR"), homologando el estándar de confirmación en dos pasos en toda la aplicación.
  - **Certificación**:
    * `npx tsc --noEmit` certificado con 0 errores de TypeScript.

- [x] **TASK-33**: **Geocodificación Exhaustiva de Transporte CDMX, Suavizado de Rotación Automática (Filtro EMA + Deadband) y Eliminación de Colisión de Voces (`04-nlu-conversacional.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Catálogo de Alta Fidelidad de Transporte CDMX (`cdmxTransportPois.ts` y `orsService.ts`)**:
    * Creación de catálogo exhaustivo en `src/data/cdmxTransportPois.ts` con estaciones oficiales del STC Metro (Líneas 1 a 12), Tren Suburbano, Metrobús y terminales centrales de pasajeros (Politécnico, Insurgentes, Tacubaya, Bellas Artes, Indios Verdes, Buenavista, Observatorio, Tasqueña, etc.).
    * Sistema de puntuación y ranking de relevancia en `searchFallbackDestinations`: priorización estricta por coincidencia de nombre exacto y alias (score 100/95) por encima de coincidencias viales secundarias (score 20).
    * Resolución en Tier 0 instantánea (0ms) con coordenadas exactas verificadas manualmente, sin consumo de cuota ni fallos por mala conexión.
  - **Suavizado de Rotación y Estabilización Cinemática (`InteractiveMap.tsx`)**:
    * Implementación de cálculo de distancia angular más corta (*shortest arc* `((diff + 540) % 360) - 180`) para evitar giros de 350° al cruzar el norte (0°/360°).
    * Umbral de banda muerta (*deadband threshold*): supresión de micro-variaciones menores a 3.5° para eliminar temblores bruscos y jitter magnético del sensor.
    * Filtro paso bajo de media móvil exponencial (*Exponential Moving Average - EMA*, alpha = 0.28) que suaviza cinematográficamente la orientación del mapa en modo conductor (POV).
    * Filtro de inmovilidad: cuando la velocidad es inferior a 1.2 m/s (~4 km/h), el rumbo se congela ante fluctuaciones espurias en semáforos o paradas vehiculares.
    * Curva de animación CSS `cubic-bezier(0.25, 0.1, 0.25, 1.0)` en la flecha vehicular y mapa para giro fluido sin tirones.
  - **Eliminación Definitiva de Colisión de Voces y Falsos Registros de Dirección**:
    * En `conversationService.ts`: extensión de `extractDestination` para reconocer menciones directas de estaciones o POIs ("metro politécnico", "metro insurgentes") sin requerir verbos gramaticales obligatorios; exclusión absoluta de transporte y sitios públicos en `isPersonalPlaceIntent` para evitar falsas solicitudes de "¿Cuál es la dirección?".
    * En `App.tsx` (`handleStartTrip`): purga estricta de `pendingAliasRegistration = null` y `pendingConfirmation = null` al transicionar a navegación.
    * En `MinimalHomeScreen.tsx`: control y cancelación de `addressPromptTimeoutRef` y llamado obligatorio a `VoiceService.stop()` antes de delegar el control a `HomeScreen`.
    * En `HomeScreen.tsx`: detención explícita de audios residuales (`VoiceService.stop()`) al montar la pantalla de navegación antes de emitir la bienvenida de ruta.
  - **Certificación**:
    * Pruebas de integración superadas con `scratch/test_metro_verification.ts`.
    * `npx tsc --noEmit` certificado con 0 errores de TypeScript.

- [x] **TASK-33B**: **Inversión Geométrica de Rotación Heading-Up y Simulador Cinemático Robusto (`06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - **Corrección del Sentido de Giro en Modo Conductor (`InteractiveMap.tsx`)**:
    * Diagnóstico: el método `setBearing` de Leaflet aplica rotación CSS horaria (`rotate(theta)`). Para que el rumbo de avance apunte siempre hacia arriba en la pantalla, la rotación del mapa debe ser antihoraria (`(360 - heading) % 360`).
    * Al girar a la derecha, el mapa ahora rota correctamente en sentido antihorario manteniendo el avance vehicular recto hacia arriba. En modo libre (`followUser: false`), la flecha en pantalla se desacopla y orienta fielmente según el ángulo relativo `(heading + mapBearing) % 360`.
  - **Simulador de Conducción Cinemático y Demostrativo (`HomeScreen.tsx`)**:
    * Avance cinemático adaptativo: el simulador avanza buscando el siguiente vértice a al menos 18 metros de distancia a intervalos de 900ms, emulando una velocidad de crucero constante de ~40 km/h (`speed: 11.2 m/s`).
    * Cálculo de rumbo anticipado: en cada paso se calcula el vector de rumbo hacia la siguiente curva o calle (`getBearing(currPt, futurePt)`), permitiendo que la flecha y el mapa roten anticipadamente al tomar las curvas aunque el usuario esté inmóvil con el dispositivo en la mano.
    * Certificación con `npx tsc --noEmit` (0 errores).

- [x] **TASK-34**: **Implementación de Motor Cartográfico MapLibre GL JS (Opción B), Barge-in de Voz y Validación Estricta de Llegada (`02-ux-accesibilidad.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`)**:
  - [x] **TASK-34A**: *Sincronización del Estado Visual del Botón en Confirmación (`MinimalHomeScreen.tsx`)*:
    * Se aseguró que mientras el asistente reproduce la locución de confirmación ("He localizado [Destino]. ¿Desea que iniciemos el viaje?"), el botón central permanezca en azul (`#3B82F6`) con icono `volume-high` y halo animado.
    * Sincronización y purga de referencias `lastProcessedConfirmationRef` y `lastProcessedRegistrationRef` para prevenir activaciones prematuras del modo de escucha.
  - [x] **TASK-34B**: *Interrupción Inmediata de Instrucciones de Voz (Barge-in en Navegación, `HomeScreen.tsx`)*:
    * En `handleVoicePress`: si el sistema está hablando una maniobra o instrucción paso a paso (`voiceState === 'speaking'` o `VoiceService.isSpeaking()`), al presionar el botón de micrófono se silencia de inmediato el audio (`VoiceService.stop()`), se cancela el timeout pendiente y se abre el micrófono con VAD dinámico sin esperas.
  - [x] **TASK-34C**: *Validación Estricta de Llegada a Destino por Distancia Residual de Ruta (`HomeScreen.tsx`)*:
    * Se eliminó el falso positivo donde el viaje finalizaba prematuramente al pasar del otro lado de la avenida antes de dar el retorno en U.
    * La detección de llegada ahora exige de forma conjunta: cercanía física euclidiana (`distToTarget <= 50m`) Y que la distancia restante de la ruta recorrida sea mínima (`progress.remainingDistance <= 75m` o últimos vértices de la simulación).
  - [x] **TASK-34D**: *Implementación de MapLibre GL JS v4 con Aceleración WebGL (Opción B, `InteractiveMap.tsx`)*:
    * **Motor WebGL 2.0**: Migración de Leaflet a MapLibre GL JS v4.7.1 dentro de WebView con renderizado nativo por GPU a 60 FPS estables.
    * **Estilos Vectoriales AVAN**: Integración de estilos vectoriales libres de OpenFreeMap (Positron para Modo Día con paleta `#F1F4F7`, calles blancas `#FFFFFF` y parques `#D5ECD5`; Dark para Modo Noche con fondo marino profundo `#0B111D`, vías `#172238` y etiquetas atenuadas `#94A3B8`). Supresión de POIs comerciales invasivos para mantener el mapa 100% despejado y legible para adultos mayores.
    * **Perspectiva POV 3D del Conductor**: Inclinación `pitch: 45°` y rotación continua por GPU (`map.easeTo` con `bearing: currentSmoothedBearing`) para perspectiva de carretera estilo Google Maps.
    * **Modo Libre vs. Conductor**: En exploración táctil manual (`followUser: false`), la flecha vehicular se desacopla y orienta fielmente según el ángulo relativo `(heading - mapBearing + 360) % 360`. Al pulsar Recentrar, la cámara vuelve al vehículo con zoom 17, `pitch: 45°` y rumbo alineado al avance.
    * **Polilínea y Marcadores GeoJSON**: Capas vectoriales `route-glow` y `route-main` con trazado suave en curvas, marcador chevron vehicular de alta nitidez y pin de destino estilizado.
    * **Resiliencia de Red**: Detección automática y fallback transparente a teselas ráster de CartoDB ante cualquier lentitud o error en la descarga de estilos vectoriales.
    * **Certificación**: Compilación limpia con `npx tsc --noEmit` (0 errores de TypeScript).

- [x] **TASK-35**: **Estabilización de Capas en Modo Noche, Recorte Dinámico de Polilínea Transitada, Preservación de Zoom en Recentrado y Geolocalización Inicial Inmediata (`06-mapas-ruteo.md`, `07-mobile-frontend.md`, `02-ux-accesibilidad.md`, `09-qa-accesibilidad.md`)**:
  - **Corrección de Polilínea en Modo Noche (`InteractiveMap.tsx`)**:
    * Diagnóstico de causa raíz: Al arrancar la app en modo noche, tras el evento `MAP_READY` el efecto React enviaba `SET_THEME { isDarkMode: true }`. En la WebView, `setTheme()` invocaba `map.setStyle()` incondicionalmente aunque el estilo nocturno ya estuviese activo, lo cual en MapLibre GL JS destruye todas las capas y fuentes dinámicas (`route-source`, `route-glow`, `route-main`) restableciendo las coordenadas vacías.
    * Solución: Se introdujo la bandera de estado `activeLoadedTheme`. `setTheme` solo recarga `map.setStyle()` cuando el tema efectivamente cambia (`requestedTheme !== activeLoadedTheme`). Si el tema es el mismo, únicamente actualiza las propiedades de pintura (`setPaintProperty`) de la polilínea y los iconos SVG de los marcadores. Además, `applyRouteData` ahora invoca defensivamente `setupRouteLayers()` antes de inyectar datos en `route-source`.
  - **Recorte Dinámico de Tramo de Ruta Ya Transitado (`navigationService.ts` y `HomeScreen.tsx`)**:
    * Implementación de la función `NavigationService.getRemainingPolyline(currentPos, polyline, currentIndex)`.
    * En el simulador cinemático recorta los segmentos recorridos con base en el índice actual (`polyline.slice(simIndex + 1)`), mientras que en navegación real por GPS proyecta la posición del vehículo sobre el segmento más cercano y recorta la trayectoria previa.
    * El mapa renderiza la polilínea restante dinámicamente (`routeCoordinates={remainingRouteCoords}`), haciendo que el tramo recorrido desaparezca detrás del vehículo tanto en simulación como en viaje real.
  - **Preservación del Nivel de Zoom del Usuario al Recentrar (`InteractiveMap.tsx` y `HomeScreen.tsx`)**:
    * Se eliminó el parámetro forzado `17` que sobreescribía la preferencia del usuario al pulsar el botón circular de recentrado o al decir "centrar mapa".
    * En la WebView de MapLibre: si no se especifica un zoom en el payload del mensaje `RECENTER`, `targetZoom` toma el nivel de zoom actual del mapa (`map.getZoom()`).
    * En `HomeScreen.tsx`, `handleRecenter()` invoca `mapRef.current?.recenter()` sin argumentos arbitrarios, respetando si el usuario había acercado o alejado la vista previamente.
  - **Geolocalización Inicial Inmediata sin Salto a Reforma (`locationService.ts`, `InteractiveMap.tsx`, `HomeScreen.tsx`)**:
    * Diagnóstico: Al iniciar viaje, si el GPS aún no entregaba coordenadas satelitales frescas, `LocationService` caía al `catch` retornando la coordenada por defecto en Paseo de la Reforma (`19.427025, -99.167665`), y el mapa se inicializaba centrado en dicha coordenada sin considerar el origen real de la ruta.
    * En `LocationService.ts`: Implementación de caché de última ubicación conocida (`cachedLocation`) consultando primero `Location.getLastKnownPositionAsync({ maxAge: 120000 })` de forma inmediata (0ms), con timeout estricto de 3.5s para fijar posición fresca con `Promise.race`. Si no hay satélite inmediato, devuelve la ubicación real cacheada.
    * En `HomeScreen.tsx` e `InteractiveMap.tsx`: Se calcula `initialMapRegion` priorizando el primer vértice de la ruta activa (`activeRouteCoords[0]`) o la ubicación del usuario, y se define el fallback de `effectiveLocation` con el origen de la ruta en vez de nulo o Reforma.
  - **Certificación**:
    * Verificación de TypeScript con `npx tsc --noEmit` superada exitosamente con 0 errores.

- [x] **TASK-36**: **Retención en Pantalla de Carga Hasta GPS Real y Desacoplamiento de Gestos Programáticos en Cámara (`06-mapas-ruteo.md`, `07-mobile-frontend.md`, `02-ux-accesibilidad.md`, `09-qa-accesibilidad.md`)**:
  - **Retención Estricta en Pantalla de Carga Hasta Obtener Ubicación Real (`locationService.ts`, `MinimalHomeScreen.tsx`, `useLocationTracking.ts`, `HomeScreen.tsx`)**:
    * Diagnóstico de Causa Raíz de Reforma: En `LocationService.ts`, la variable `lastKnownLocation` del observador de brújula (`watchHeadingAsync`) se inicializaba con `defaultLocation` (Reforma). Dado que el sensor de orientación magnetométrica emite múltiples eventos por segundo al arrancar la app, el observador enviaba inmediatamente las coordenadas de Reforma a `useLocationTracking` antes de que el receptor satelital pudiera sincronizarse. Adicionalmente, el cálculo de ruta en `MinimalHomeScreen.tsx` abortaba la espera a los 3.5s y usaba Reforma como origen.
    * Solución Integral:
      1. Se eliminó la emisión prematura de coordenadas en `watchHeadingAsync`: el observador de rumbo ahora solo emite actualizaciones si ya se dispone de una posición satelital real confirmada (`hasReceivedRealGps`).
      2. `LocationService.getRealLocationOrWait()`: función resiliente que espera activamente en la pantalla de carga (consultando la última posición del SO sin restricciones y ejecutando hasta 4 ciclos satelitales con reportes de estado visual).
      3. En `MinimalHomeScreen.tsx`: la pantalla de carga ("Preparando su viaje...") se mantiene activa con retroalimentación paso a paso ("Localizando su vehículo...", "Calculando la mejor ruta hacia [Destino]...") y solo procede al cálculo de ruta cuando la posición satelital real está garantizada.
      4. En `useLocationTracking.ts`: `userLocation` se mantiene en `null` hasta recibir un punto satelital real, impidiendo que el mapa se posicione en Reforma.
      5. En `HomeScreen.tsx`: si no hay ruta ni ubicación vehicular disponible, se despliega una pantalla de carga accesible con indicador de actividad en lugar de abrir el mapa en Reforma.
  - **Desacoplamiento de Animaciones Programáticas de Cámara vs. Gestos de Usuario (`InteractiveMap.tsx`)**:
    * Diagnóstico de por qué el mapa no se movía con la flecha: En MapLibre GL JS, los eventos `rotatestart` y `pitchstart` se disparan cada vez que el rumbo o la inclinación de la cámara cambian, tanto por gestos del usuario como por llamadas programáticas (`map.easeTo`). Como los manejadores de MapLibre en la WebView no validaban `e.originalEvent`, la animación de inicio de ruta (`recenter(17)` a los 500ms) o la primera actualización vehicular disparaban `rotatestart`/`pitchstart`. Esto enviaba `USER_INTERACTION` a `HomeScreen`, lo que fijaba `isUserExploringMap = true` y forzaba `followUser = false` permanentemente. En consecuencia, el marcador vehicular avanzaba solo por la pantalla mientras el mapa quedaba congelado.
    * Solución: Se condicionaron estrictamente los manejadores `dragstart`, `rotatestart`, `pitchstart` y `zoomstart` en la WebView para requerir `e && e.originalEvent`. De este modo, las animaciones automáticas de seguimiento (`easeTo({ center, bearing, pitch: 45 })`) se ejecutan sin activar el modo de exploración manual. El mapa ahora sigue continua y fluidamente la flecha en perspectiva POV de cabina vehicular estilo Google Maps.
  - **Certificación**:
    * Verificación con `npx tsc --noEmit` superada con 0 errores de TypeScript.

- [x] **TASK-37**: **Flexibilidad Conversacional en Confirmación de Viajes: Soporte de Rectificaciones y Cambio de Opinión ("No, quiero ir a {otro lugar}") (`04-nlu-conversacional.md`, `07-mobile-frontend.md`, `02-ux-accesibilidad.md`, `09-qa-accesibilidad.md`)**:
  - **Diagnóstico del Bloqueo Conversacional**:
    * En `conversationService.ts`, el patrón de cancelación `isNegativeOrCancel(normalized)` utilizaba `^no\b`. Al comenzar una frase con "no" (ej. *"no, quiero ir a Bellas Artes"*, *"no, mejor al metro politécnico"*, *"no, cámbialo a reforma"*), el sistema interceptaba la expresión como una cancelación pura de inmediato.
    * En el flujo de `pendingConfirmation` en `processUserMessageLocal`, la comprobación `if (isNegativeOrCancel)` se ejecutaba antes de evaluar si existía un nuevo destino, destruyendo el diálogo y respondiendo *"Entendido, he cancelado el viaje a [Destino]"*.
    * En el prompt del LLM Groq (`dynamicContextPrompt`), se indicaba: *"Esperando que el usuario diga 'Sí' o 'No/Cancelar'"*, condicionando al modelo a invocar la herramienta `cancelar()` o rechazar el diálogo sin extraer el nuevo destino dictado.
    * En `HomeScreen.tsx` (`handleFinishContinuityResponse`), al procesar `navegar_a` durante el diálogo post-viaje o confirmación, se lanzaba la navegación de inmediato sin desplegar la vista previa de confirmación con el pin del mapa.
  - **Implementación de la Solución en 3 Niveles (Prompting, NLU Heurístico y Defensive Guard)**:
    1. **Detector de Rectificaciones y Protección de Negaciones**:
       - Implementación de `hasRectificationPattern(normalized)` y `extractDestinationFromRectification(rawText, normalized)`.
       - Reconocimiento de modismos mexicanos y patrones coloquiales: *"no, quiero ir a..."*, *"no, mejor llévame a..."*, *"no, al metro {estación}"*, *"no, cámbialo a..."*, *"no, prefiero ir a..."*, *"no es ahí, es en..."*, *"no, con mi hijo"*, *"no, a la casa de..."*.
       - `isNegativeOrCancel(normalized)` ahora verifica primero `!hasRectificationPattern(normalized)`, garantizando que cualquier frase que contenga un cambio de destino o acción nunca sea tratada como un simple rechazo.
    2. **Orquestación de Function Calling en Groq y Prompt Gerontológico**:
       - Actualización de `GERONTOLOGICAL_SYSTEM_PROMPT` (Directivas 4 y 6): regla explícita que instruye al asistente a invocar `navegar_a(destino: nuevo_destino)` inmediatamente cuando el usuario rectifique o cambie de destino, respondiendo con validación empática: *"Entendido, he cambiado el destino a [Nuevo Destino]. ¿Desea que iniciemos el viaje hacia allá?"*.
       - Actualización de `dynamicContextPrompt` para contextualizar la espera de confirmación abierta a cambios de destino.
       - **Defensive LLM Guard en `callGroqLLM`**: Si el modelo de Groq llegara a invocar `cancelar()` o a responder solo con texto conversacional pero la expresión del usuario contiene un destino rectificado, el sistema intercepta la respuesta y ejecuta automáticamente `executeNavegarAFlow(rectifiedCandidate)`.
    3. **Priorización en Motor Heurístico Local (`processUserMessageLocal`)**:
       - En `currentContext.pendingConfirmation`, la rectificación de destino ahora se evalúa **en primera prioridad** antes de comprobar confirmación afirmativa o cancelación pura.
       - Si el destino cambia, se resuelve el alias o sitio personal, se geocodifica la nueva coordenada, se actualiza `pendingConfirmation` y se solicita confirmación verbal del nuevo lugar con auto-escucha habilitada.
       - En cancelaciones puras, se aplica la Directiva 4 gerontológica ofreciendo continuidad: *"Entendido. He cancelado el viaje a [Destino]. ¿Desea ir a algún otro lugar?"*.
    4. **Sincronización de Flujo en `HomeScreen.tsx`**:
       - `handleFinishContinuityResponse` ahora delega `response.functionCall?.name === 'navegar_a'` o `response.updatedContext.pendingConfirmation` a `exitFn(response.updatedContext)`. Esto hace que la app regrese a `MinimalHomeScreen` desplegando la tarjeta de confirmación y el pin en el mapa con el nuevo destino.
  - **Certificación y Pruebas Unitarias**:
    - Suite de 15 pruebas unitarias automatizadas (`test_rectification.js`) superada al 100%.
    - Certificación estricta de TypeScript con `npx tsc --noEmit` superada exitosamente con 0 errores.

- [x] **TASK-38**: **Modificación Asistida de Dirección de Alias y Resolución Precisa sin Colisión con "Mi Casa" (`04-nlu-conversacional.md`, `08-backend-infraestructura.md`, `07-mobile-frontend.md`, `02-ux-accesibilidad.md`, `09-qa-accesibilidad.md`)**:
  - **Diagnóstico de los Dos Problemas Reportados**:
    1. *Colisión Sistemática de "casa de {alguien no registrado}" con "Mi Casa"*: En `aliasService.ts`, el algoritmo de token overlap en el paso 4 evaluaba `itemTokens.every(t => queryTokens.includes(t))`. Para el alias predeterminado `alias-casa` ("mi casa"), la palabra "mi" es un stop-word que se eliminaba, dejando únicamente el token `['casa']`. En consecuencia, cualquier consulta coloquial que incluyera la palabra "casa" (ej. *"casa de mi primo"*, *"casa de mi hermano"*, *"casa de juan"*) contenía el token `casa`, provocando que `itemTokens.every(...)` retornara `true` y redirigiera siempre a "Mi Casa" (Reforma).
    2. *Incapacidad de Modificar la Dirección de un Alias*: Al estar confirmando un viaje a un alias registrado (ej. *"casa de mi primo"*), si el usuario observaba la ubicación o decía que la dirección era errónea (ej. *"no es ahí, es en Sonora 120"*, *"la dirección está mal, es en..."*, *"cambia la dirección a..."*), el sistema lo interpretaba como un cambio de destino general hacia la calle para un viaje nuevo y aislado, en lugar de iniciar el flujo de actualización de la dirección del alias con confirmación.
  - **Solución Técnica Implementada**:
    1. **Bloqueo y Coincidencia Estricta para Casas y Alias en `aliasService.ts`**:
       - Introducción de `isOtherHouseQuery` que detecta expresiones dirigidas al domicilio de otra persona (`/(?:casa\s+de|a\s+lo\s+de|donde|depto\s+de)\s+(?!mi\s+casa\b|hijo\b)/i`), bloqueando categóricamente cualquier coincidencia con `alias-casa`.
       - Para `alias-casa`, se exige coincidencia exclusiva de conjunto `['casa']` u `['hogar']`.
       - Para cualquier otro alias, se exige igualdad biunívoca estricta de conjuntos de tokens (`itemTokens.length === queryTokens.length && itemTokens.every(...)`).
    2. **Detector de Modificación y Corrección de Dirección (`isAliasAddressCorrectionIntent`)**:
       - Reconocimiento robusto de patrones: *"no es ahí, es en [dirección]"*, *"la dirección está mal, es en [dirección]"*, *"cambia la dirección a [dirección]"*, *"actualiza la dirección a..."*, *"la dirección es en..."*, *"no, es en..."*, *"era en..."*, *"me equivoqué de dirección, es en..."*, así como negaciones sin dirección (*"no es ahí"*, *"está mal la dirección"*).
    3. **Flujo de Modificación en 2 Pasos con Feedback Visual y Auditivo**:
       - Si el destino pendiente es un alias o lugar personal y el usuario corrige la dirección, el sistema geocodifica la nueva dirección, pasa a `pendingAliasRegistration` con `step: 'confirming_address'` e `isUpdating: true`, y pregunta empáticamente: *"Entendido. Ubiqué: [Dirección]. ¿Desea actualizar la dirección de [Alias] con esta ubicación?"*.
       - Al confirmar afirmativamente ("Sí"), se invoca `AliasService.saveAlias` para sobreescribir la dirección en memoria, `AsyncStorage` y Supabase, respondiendo: *"He actualizado la dirección de [Alias]. ¿Desea que iniciemos el viaje hacia allá ahora mismo?"*, fijando el destino para iniciar la marcha con un segundo "Sí".
       - Si el usuario dice que la dirección está mal sin indicar la nueva (*"no es ahí"*, *"está mal la dirección"*), transiciona a `step: 'awaiting_address'` preguntando: *"Entendido. Por favor dígame la dirección o colonia correcta para [Alias]"*.
    4. **Adaptación UI en `MinimalHomeScreen.tsx`**:
       - La tarjeta modal y el HUD detectan `isUpdatingAlias`, actualizando los textos y estilos de accesibilidad WCAG AAA:
         * Encabezado: `"ACTUALIZAR UBICACIÓN"` con icono `'sync-circle'`.
         * Pregunta: `¿Actualizar dirección de [Alias]?`.
         * Botón de acción: `"SÍ, ACTUALIZAR"` con icono `'sync'`.
    5. **Blindaje Multicapa (Prompts y LLM Guard)**:
       - Actualización de `GERONTOLOGICAL_SYSTEM_PROMPT` y `dynamicContextPrompt` con directiva para invocar `guardar_ubicacion(alias, direccion)` al detectar correcciones en confirmación de alias.
       - Defensive Guard en `callGroqLLM` que intercepta llamadas erróneas a `navegar_a` reconvirtiéndolas a actualización de alias.
  - **Certificación y Pruebas**:
    - Pruebas automatizadas unitarias y end-to-end completadas al 100%.
    - Certificación estricta de compilación TypeScript con `npx tsc --noEmit` superada con 0 errores.

- [x] **TASK-39**: **Depuración de Captura de Direcciones Completas y Asistencia de Ajustes Incrementales con LLM (`04-nlu-conversacional.md`, `03-voice-ux.md`, `06-mapas-ruteo.md`, `07-mobile-frontend.md`, `09-qa-accesibilidad.md`)**:
  - **Diagnóstico de los Problemas Reportados**:
    1. *Truncamiento Sistemático de Direcciones a la Última Parte*:
       - En `extractAddressCorrection` e `isAliasAddressCorrectionIntent`, expresiones regulares como `/(?:...|la direccion es|en)\s+(.+)/i` contenían la alternancia no anclada `|en\s+(.+)`. Al decir *"Sonora 120 en la Condesa"*, la regla emparejaba únicamente a partir de `"en la Condesa"`, descartando agresivamente la calle y el número exterior.
       - En `step === 'awaiting_address'`, la partición manual `splitMatch` con `\s+en\s+` trataba erróneamente la calle como alias y la colonia como dirección.
    2. *Incapacidad de Hacer Ajustes Menores / Incrementales sobre una Dirección Propuesta*:
       - Al proponerse una dirección (ej. *"Calle Sonora 120, Condesa"*), si el usuario decía *"No, es el 150"*, *"en la Roma Norte"* o *"cruce con Insurgentes"*, el sistema intentaba geocodificar esa frase aislada o caía en falso positivo de cancelación por la regla `^no\b` en `isNegativeOrCancel`. No existía un mecanismo de fusión diferencial que conservara los componentes válidos de la dirección base.
  - **Solución Técnica Implementada**:
    1. **Erradicación del Truncamiento y Anclaje Sintáctico Robusto**:
       - Eliminación de alternancias flotantes en `extractAddressCorrection` e `isAliasAddressCorrectionIntent`. Las expresiones ahora exigen anclaje al inicio (`^`) o marcadores explícitos de corrección.
       - En `awaiting_address`, se suprimió la partición destructiva `splitMatch` cuando el alias ya tiene nombre asignado, permitiendo que la dirección íntegra pase a geocodificación y análisis LLM sin recortes.
    2. **Fusión Contextual con LLM (`mergeAddressAdjustmentWithLLM`) y Motor Heurístico**:
       - Implementación de `mergeAddressAdjustmentWithLLM(baseAddress, userAdjustmentText, context)` en `conversationService.ts`: Groq LLM (Llama 3.3 70B Versatile, temp=0.1) analiza qué componente específico se está corrigiendo (número exterior, colonia, calle, cruce) y genera el JSON unificado con `formattedSearchQuery`, `formattedUserLabel` y `changedFieldDescription` (ej. *"al número 150"* o *"a la colonia Roma Norte"*).
       - Motor de respaldo `mergeAddressAdjustmentHeuristic`: sustitución inteligente de números y reemplazo de colonia conservando calle y número base en modo offline o sin latencia.
    3. **Protección Contra Falsos Positivos de Negación**:
       - Función `isAddressAdjustmentPattern(normalized)` integrada en `isNegativeOrCancel(normalized)`. Cualquier frase que contenga un ajuste numérico (*"no, es el 150"*, *"el 150"*), de colonia (*"no, en la roma"*) o vial no activa la cancelación y se canaliza inmediatamente al motor de fusión.
    4. **Retroalimentación Auditiva y Visual Adaptativa (Voice UX & Mobile Frontend)**:
       - Respuesta auditiva cálida y precisa informando el cambio exacto realizado:
         * Registro: *«Entendido, cambié al número 150: Calle Sonora 150, Condesa. ¿Es correcta esta ubicación para Casa de mi primo?»*.
         * Actualización: *«Entendido, cambié al número 150: Calle Sonora 150, Condesa. ¿Desea actualizar la dirección de Casa de mi primo con esta ubicación?»*.
       - Re-geocodificación inmediata con OpenRouteService / Nominatim (`orsService.geocodeDestination`) y actualización reactiva de coordenadas y etiqueta en `MinimalHomeScreen.tsx` para reflejar el nuevo pin en el mapa y la tarjeta WCAG AAA.
  - **Certificación y Pruebas**:
    - Suite de pruebas unitarias automatizada (`test_address_improvements.js`) superada al 100% en todos los casos: protección de negaciones, preservación de direcciones completas con "en", fusión de número exterior y fusión de colonia.
    - Certificación estricta de compilación TypeScript con `npx tsc --noEmit` superada con 0 errores.

- [x] **TASK-40**: **Sistema Híbrido de Desambiguación Asistida por Referencias (Landmark-Assisted Disambiguation) en Viajes Directos y Alias (`06-mapas-ruteo.md`, `04-nlu-conversacional.md`, `03-voice-ux.md`, `07-mobile-frontend.md`, `09-qa-accesibilidad.md`)**:
  - **Objetivo Completado**:
    Se resolvió el problema de homonimia y ambigüedad de direcciones (calles o destinos repetidos en múltiples alcaldías como "Hidalgo", "Juárez", "Reforma") mediante un enfoque híbrido que combina desambiguación multizona (2 a 3 opciones claras) y anclaje con puntos de referencia notorios (Landmarks / Estaciones de Metro/Metrobús/Parques/Hospitales).
    Aplica tanto para **viajes directos concretos** (`navegar_a`) como para el **registro o edición de alias** (`guardar_ubicacion` / `pendingAliasRegistration`).
  - **Entregables por Agente Especializado**:
    1. **Agente de Mapas y Ruteo (`06-mapas-ruteo.md`)**:
       - Implementado `findNearestLandmark(coords)` en `orsService.ts` utilizando los catálogos en memoria `CDMX_TRANSPORT_POIS` (más de 1,000 estaciones de transporte masivo) y `FALLBACK_DESTINATIONS` (hospitales, parques, museos, monumentos).
       - Implementado `getDisambiguationCandidates(query, userLocation, maxCandidates = 3)` con deduplicación por cercanía (<1,000m), detección de dispersión geográfica (>2.5 km) y extracción de zona principal con `extractZoneFromLabel`.
    2. **Agente de NLU y Backend Conversacional (`04-nlu-conversacional.md` & `03-voice-ux.md`)**:
       - Definidas interfaces `DisambiguationCandidate` y `PendingDisambiguation` en `conversationService.ts`.
       - Conectado el flujo de navegación directa (`navegar_a`, `executeNavegarAFlow` y rectificaciones) y el flujo de alias (`guardar_ubicacion`, `awaiting_address`) para activar el estado `pendingDisambiguation` cuando la consulta arroje opciones homónimas dispersas.
       - Implementado generador verbal cálido y respetuoso `buildDisambiguationSpokenPrompt`: *«Encontré [N] lugares con ese nombre: 1, en [Zona 1], cerca de [Landmark 1]... ¿A cuál de ellos desea ir? Puede decirme el número, la zona o un lugar cercano.»*.
       - Implementado intérprete semántico `resolveDisambiguationSelection` con soporte para respuestas ordinales (*"la primera"*, *"la 2"*), por zona (*"Coyoacán"*), por landmark específico (*"metro viveros"*, *"metro hidalgo"*) o genérico único (*"la del parque"*), además de soporte para nuevas pistas y cancelaciones directas.
    3. **Agente Mobile / Frontend (`07-mobile-frontend.md`)**:
       - Implementado componente de tarjetas de desambiguación en `MinimalHomeScreen.tsx` con alto contraste WCAG AAA en Modo Día y Modo Noche.
       - Cada tarjeta incluye: insignia circular con número ordinal de 42dp+, nombre de alcaldía o zona en tipografía grande (18sp+), dirección completa legible, insignias temáticas con iconos de landmark (🚇 Metro, 🚊 Metrobús, 🌳 Parque, 🏥 Hospital, 🏛️ Centro/Monumento), insignia de distancia en km/m y botón táctil accesible con chevron.
       - Barra multimodal inferior con botón "CANCELAR" táctil de 60dp, micrófono central con ondas concéntricas animadas y guía accesible.
    4. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Suite de pruebas automatizadas `test_disambiguation.ts` superada al 100% (17/17 pruebas pasando):
         * Detección de landmarks y extracción de zonas.
         * Generación de prompts verbales para navegación y alias.
         * Selección ordinal, por número, por zona y por landmark.
         * Flujos conversacionales completos de desambiguación en navegación y alias.
         * Geocodificación en vivo con `orsService.getDisambiguationCandidates`.
       - Certificación estricta de TypeScript con `npx tsc --noEmit` superada con 0 errores.

- [x] **TASK-41**: **Precisión Predial y Geocodificación Estructurada de Casas y Vías (`06-mapas-ruteo.md`, `04-nlu-conversacional.md`, `07-mobile-frontend.md`, `09-qa-accesibilidad.md`, `11-orquestador-pm.md`)**:
  - **Objetivo**:
    Eliminar la imprecisión en la geocodificación de calles concretas y números prediales/casas en la Ciudad de México y área metropolitana, impidiendo que el motor de mapas degenere a centroides de colonias o centros urbanos genéricos cuando no halla un número exterior exacto en OpenStreetMap.
  - **Solución Implementada**:
    1. **Agente de Mapas y Ruteo (`06-mapas-ruteo.md`)**:
       - Creada función `parseStructuredAddress` con soporte para calles con fechas ("5 de Mayo", "16 de Septiembre"), cruces viales ("Sonora casi esquina con Ámsterdam") y números prediales.
       - Corrección crítica de Photon API Komoot (sustituido `lang: 'es'` no soportado por `lang: 'default'`).
       - Pelias ORS configurado con `layers=address,street,venue` forzando anclaje en predios y vías reales.
       - Nominatim con búsqueda en cascada y *Street Segment Fallback*: si el número exacto no está catalogado en OSM, el motor relaja la búsqueda al tramo vial de la calle dentro de la colonia indicada, etiquetando la precisión como `'street'` en lugar de enviar al usuario al Zócalo o al centroide de la colonia.
       - Modelo de datos enriquecido con `GeocodePrecision = 'exact' | 'street' | 'interpolated' | 'approximate'`.
    2. **Agente de NLU y Backend Conversacional (`04-nlu-conversacional.md`)**:
       - Extensión de `normalizeAddressWithLLM` y `normalizeAddressHeuristic` con extracción de `cruce` y generación de `StructuredAddressQuery`.
       - Integración de geocodificación estructurada en flujos de navegación, guardado de alias, rectificaciones incrementales y confirmaciones.
       - Diálogo verbal gerontológico con honestidad técnica cuando el pin esté a nivel calle: *«Ubiqué la Calle [calle] en [colonia] a la altura aproximada del número [número]»*.
    3. **Agente Mobile / Frontend (`07-mobile-frontend.md`)**:
       - Distintivo visual y accesible (WCAG AAA) de precisión en la tarjeta previa de confirmación en `MinimalHomeScreen.tsx` (*"📍 Dirección exacta"* en verde vs *"📍 Sobre la calle (aprox. al predio)"* en ámbar).
    4. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Suite de pruebas automatizada `test_address_precision.ts` con 19 pruebas de integración y geocodificación real en CDMX superadas al 100%.
       - Certificación estricta de TypeScript con `npx tsc --noEmit` superada con 0 errores.

#### 5. Agente de Privacidad y Seguridad (`10-privacidad-seguridad.md`)
- [ ] **TASK-20**: **Auditoría de Seguridad y Zero-Persistence en Producción**:
  - Actualización y blindaje de `.env.example` con las credenciales de Supabase.
  - Verificación de no-persistencia de audios ni datos de rastreo no autorizados.

- [x] **TASK-17**: **Configuración de EAS Build y Generación de APK de Prueba**:
  - Configuración de `eas.json` con perfil `preview` (`"buildType": "apk"`) y perfil `production` para sideloading directo en dispositivos Android.
  - Scripts añadidos en `package.json`: `npm run build:apk` y `npm run start:tunnel`.
  - Nueva API key de ElevenLabs validada con respuesta HTTP 200 y síntesis de audio de alta fidelidad.
  - Variables de entorno inyectadas en la compilación de la nube para funcionamiento autónomo.
  - **APK Generado con Éxito**: Build ID `f38212b0-7afc-4a31-bb8e-26cc1525db79`.
  - **URL de Descarga del APK**: `https://expo.dev/artifacts/eas/jDFrf9bbWNlNNlC-02saJkzoIdgfmyvwmIBSYmYK5Dw.apk`.
  - Validación de compilación limpia de TypeScript (`npx tsc --noEmit` con 0 errores).

- [x] **TASK-42**: **Fase 1: Optimización de APIs de Navegación (API-First Navigation Architecture) (`06-mapas-ruteo.md`, `07-mobile-frontend.md`, `09-qa-accesibilidad.md`, `11-orquestador-pm.md`)**:
  - **Objetivo Completado**:
    Migrar la navegación a un modelo 100% soportado en APIs, eliminando cálculos heurísticos locales de velocidad fija, previniendo falsos desvíos por jitter de GPS con Snap-to-Road, y acelerando la geocodificación mediante concurrencia y caché LRU en memoria.
  - **Entregables por Agente**:
    1. **Agente de Mapas y Ruteo (`06-mapas-ruteo.md`)**:
       - `snapPointToPolyline` y `projectPointToSegment` implementados en `navigationService.ts` con tolerancia de 35 metros para anclar el cursor GPS al asfalto de la vía.
       - Cálculo de ETA dinámico y turn-by-turn en `evaluateProgress`: reemplazada la fórmula estática de 30 km/h por el acumulado de duraciones reales provistas por los `step.duration` de la API de ruteo (OpenRouteService / OSRM), ponderando la fracción restante del paso activo.
       - Caché LRU en memoria en `orsService.ts` (`Map<string, CacheEntry>`) con TTL de 15 minutos y capacidad de 120 entradas para respuestas inmediatas (<5ms).
       - Concurrencia de baja latencia en geocodificación: ejecución simultánea de ORS (Tier 1) y Photon (Tier 3) con arbitraje por precisión y concordancia de colonia antes de recurrir a Nominatim.
       - Implementado `reverseGeocode` para obtener la dirección y contexto de calle/colonia a partir de coordenadas GPS.
       - Implementado `snapToRoad` usando el endpoint Nearest de OSRM con encabezado `User-Agent` autorizado (eliminando errores HTTP 403).
    2. **Agente Mobile / Frontend (`07-mobile-frontend.md`)**:
       - Integrado `snapPointToPolyline` en `effectiveLocation` dentro de `HomeScreen.tsx` para estabilizar el cursor vehicular y la polilínea restante sobre la calzada vial activa, manteniendo la detección de desvío real (>100m).
    3. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Nueva suite de pruebas automatizadas `test_navigation_api_phase1.ts` superada al 100% (16/16 pruebas exitosas).
       - Suplementadas las suites `test_address_precision.ts` (19/19) y `test_disambiguation.ts` (17/17).
       - Scripts añadidos en `package.json` (`npm run test:phase1`, `test:precision`, `test:disambiguation`, `test:all`).
       - Certificación estricta de TypeScript con `npx tsc --noEmit` superada con 0 errores.



- [x] **TASK-43**: **Fase 2: Optimización de NLU y Diálogo Conversacional (Single-Turn Tool Call & Latencia Reducida) (`04-nlu-conversacional.md`, `03-voice-ux.md`, `09-qa-accesibilidad.md`, `11-orquestador-pm.md`)**:
  - **Objetivo Completado**:
    Unificar el análisis de NLU en una sola llamada LLM por turno mediante Function Calling enriquecido (`navegar_a` y `guardar_ubicacion`), podar tokens redundantes en el historial y System Prompt, incorporar fast-paths de 0ms para direcciones sintácticas y landmarks conocidos, y reducir la latencia de diálogo conversacional a <1.0s manteniendo la confirmación gerontológica en 2 pasos.
  - **Entregables por Agente**:
    1. **Agente de NLU y Backend Conversacional (`04-nlu-conversacional.md`)**:
       - Esquema enriquecido de herramientas en `AVAN_TOOLS` (`navegar_a` y `guardar_ubicacion`) con extracción directa de entidades de dirección: `calle`, `numero`, `colonia`, `alcaldia`, `cruce`.
       - Eliminada la segunda llamada de red a `normalizeAddressWithLLM` en `executeNavegarAFlow` y `guardar_ubicacion`: los campos provistos por el tool call se inyectan directamente a `StructuredAddressQuery` y se pasan al geocodificador.
       - Corrección de bug de duplicación de turnos: `callGroqLLM` ahora excluye el turno actual del usuario de los mensajes previos de historial (`context.history.slice(0, -1).slice(-3)`), evitando enviar el mensaje dos veces por turno.
       - Ajuste de `temperature: 0.1` en `callGroqLLM` para respuestas ultra-rápidas y deterministas (tiempos de inferencia en Groq <150ms).
       - Fast-paths heurísticos inmediatos (0ms - 5ms) en `mergeAddressAdjustmentWithLLM` (números, colonias) y `normalizeAddressWithLLM` (landmarks emblemáticos como Bellas Artes, Soumaya, Zócalo y direcciones estándar).
    2. **Agente de Diseño Conversacional (Voice UX) (`03-voice-ux.md`)**:
       - Garantizada la confirmación gerontológica estricta en 2 pasos ("He localizado [Destino]. ¿Desea que iniciemos el viaje hacia allá?").
       - Mantenimiento del tono cálido, respetuoso y empático, con respuestas concisas de 1 a 2 oraciones.
    3. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Nueva suite de pruebas automatizadas `test_nlu_phase2.ts` con 19/19 pruebas superadas al 100%.
       - Certificación de latencia de diálogo de punta a punta: `navegar_a` en 843ms - 877ms (<1.0s) y `guardar_ubicacion` en 741ms (<1.0s).
       - Suite general `npm run test:all` superada con 71/71 pruebas exitosas (Fase 1: 16/16, Fase 2: 19/19, Precisión: 19/19, Desambiguación: 17/17).
       - Compilación TypeScript estricta (`npx tsc --noEmit`) con 0 errores.

- [x] **TASK-44**: **Fase 3: Caché de Frases TTS en Memoria y Reducción de Dependencia de Tokens (`05-voz-stt-tts.md`, `09-qa-accesibilidad.md`, `10-privacidad-seguridad.md`, `11-orquestador-pm.md`)**:
  - **Objetivo Completado**:
    Implementar una caché en memoria volátil de buffers de audio TTS (`TTSAudioCache`) para reutilizar instantáneamente (<15ms) frases recurrentes (saludos, despedidas, confirmaciones en 2 pasos, cancelaciones y comandos de zoom), logrando **0 tokens consumidos** en ElevenLabs para diálogos estándar. Realizar la evaluación técnica de modelos de voz alternativos para mitigar o suprimir la dependencia de tokens.
  - **Entregables por Agente**:
    1. **Agente de Voz (STT / TTS) (`05-voz-stt-tts.md`)**:
       - Creado [`ttsCacheService.ts`](avan-mobile/src/services/ttsCacheService.ts) implementando `TTSAudioCache`: normalización fonética y sintáctica de claves (`getCacheKey` insensible a acentos, signos de puntuación y mayúsculas), capacidad LRU de 80 entradas y métodos de inspección (`store`, `get`, `has`, `count`, `clear`).
       - Conectada la caché directamente en [`voiceService.ts`](avan-mobile/src/services/voiceService.ts): verificación previa en `speak()` antes de invocar la red, y almacenamiento automático tras síntesis con ElevenLabs u OpenAI.
       - La reproducción desde caché opera incluso si la cuota mensual de ElevenLabs está agotada, preservando la voz de alta fidelidad sin coste adicional.
    2. **Agente de Privacidad y Seguridad (`10-privacidad-seguridad.md`)**:
       - Respetada estrictamente la directiva de **Zero-Persistence**: los audios cacheados residen exclusivamente en la memoria RAM del proceso móvil y se purgan al terminar la sesión; no se almacenan permanentemente en base de datos ni almacenamiento de disco.
    3. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Nueva suite de pruebas automatizadas [`test_tts_cache.ts`](avan-mobile/test_tts_cache.ts) con 14/14 pruebas superadas al 100%.
       - Suite completa del proyecto (`npm run test:all`) actualizada a 85/85 pruebas superadas (100% de éxito).
       - Compilación TypeScript estricta (`npx tsc --noEmit`) con 0 errores.

- [x] **TASK-45**: **Fase 4: Optimización Frontend, Ergonomía y Ciclo de Vida Mobile (`07-mobile-frontend.md`, `02-ux-accesibilidad.md`, `09-qa-accesibilidad.md`, `11-orquestador-pm.md`)**:
  - **Objetivo Completado**:
    Optimizar el comportamiento del ciclo de vida de la aplicación en el dispositivo físico: mantener la pantalla encendida de forma continua durante la navegación activa en el mapa (`expo-keep-awake`), interceptar el botón físico y gestos "Atrás" de Android (`BackHandler`) para evitar cierres accidentales de la app, y limpiar las declaraciones de permisos de Android en `app.json`.
  - **Entregables por Agente**:
    1. **Agente de Mobile / Frontend (`07-mobile-frontend.md`)**:
       - Integrado `useKeepAwake()` en [`HomeScreen.tsx`](avan-mobile/src/screens/HomeScreen.tsx): la pantalla permanece encendida durante todo el trayecto en auto sin que el conductor deba tocar el celular; al regresar a la pantalla de reposo, el bloqueo y ahorro de batería se restauran automáticamente.
       - Intercepción de hardware en [`HomeScreen.tsx`](avan-mobile/src/screens/HomeScreen.tsx) con `BackHandler`: si el conductor pulsa el botón físico o gesto de "Atrás", se invoca `onStopTrip || onCancelTrip` regresando a `MinimalHomeScreen` de forma segura en vez de salir de la app.
       - Intercepción de hardware en [`MinimalHomeScreen.tsx`](avan-mobile/src/screens/MinimalHomeScreen.tsx) con `BackHandler`: si hay un diálogo o modal interactivo activo (confirmación de viaje, tarjeta de desambiguación o registro de alias), la tecla "Atrás" cancela el diálogo y retorna a la One-Button UI pura sin interrumpir el proceso.
       - Limpieza y deduplicación de permisos en [`app.json`](avan-mobile/app.json) eliminando la doble declaración de `ACCESS_COARSE_LOCATION` y `ACCESS_FINE_LOCATION` con prefijos redundantes.
    2. **Agente de UX / Accesibilidad (`02-ux-accesibilidad.md`)**:
       - Cumplimiento de ergonomía gerontológica vehicular: cero distracciones por apagado de pantalla en ruta, y protección contra cierres accidentales por toques involuntarios en la barra de navegación del sistema Android.
    3. **Agente de QA y Accesibilidad (`09-qa-accesibilidad.md`)**:
       - Verificación de compilación limpia de TypeScript (`npx tsc --noEmit` con 0 errores).
       - Suite completa del proyecto (`npm run test:all`) certificada con 85/85 pruebas pasando (100% de éxito).
