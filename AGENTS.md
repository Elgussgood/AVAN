# Directivas del Equipo de Desarrollo y Agentes Especializados de AVAN

Este proyecto cuenta con un equipo multidisciplinario de agentes especializados cuyas directivas, herramientas permitidas y restricciones se encuentran detalladas individualmente en el directorio [`.antigravity/agents/`](./.antigravity/agents/):

## Perfiles de Agentes

1. [**Agente de Producto / Requisitos**](./.antigravity/agents/01-producto-requisitos.md): Historias de usuario para adultos mayores, criterios de aceptación, alcance MVP vs. futuro.
2. [**Agente de UX / Accesibilidad**](./.antigravity/agents/02-ux-accesibilidad.md): Interfaz de un solo botón, tipografía grande, alto contraste WCAG AAA, ergonomía gerontológica.
3. [**Agente de Diseño Conversacional (Voice UX)**](./.antigravity/agents/03-voice-ux.md): Flujos de diálogo, confirmación en 2 pasos, tono cálido y paciente, manejo de silencios.
4. [**Agente de NLU y Backend Conversacional**](./.antigravity/agents/04-nlu-conversacional.md): Extracción de intenciones y entidades con Function Calling (`navegar_a`, `ajustar_zoom`, `confirmar_viaje`, `cancelar`).
5. [**Agente de Voz (STT / TTS)**](./.antigravity/agents/05-voz-stt-tts.md): Transcripción con Whisper (Groq/OpenAI), voz natural humana y Zero-Persistence de audios.
6. [**Agente de Mapas y Ruteo**](./.antigravity/agents/06-mapas-ruteo.md): Personalización de `react-native-maps` (Día/Noche), OpenRouteService y control de cámara.
7. [**Agente de Mobile / Frontend**](./.antigravity/agents/07-mobile-frontend.md): Arquitectura en React Native / Expo, One-Button UI pura en `MinimalHomeScreen` y transición a `HomeScreen`.
8. [**Agente de Backend e Infraestructura**](./.antigravity/agents/08-backend-infraestructura.md): Supabase para lugares frecuentes ("casa de mi hijo") y APIs seguras.
9. [**Agente de QA y Accesibilidad**](./.antigravity/agents/09-qa-accesibilidad.md): Validación de tipos TypeScript, contraste y accesibilidad para adultos mayores.
10. [**Agente de Privacidad y Seguridad**](./.antigravity/agents/10-privacidad-seguridad.md): Cero persistencia de biometría de voz y protección de claves en `.env`.
11. [**Agente Orquestador / Tech Lead**](./.antigravity/agents/11-orquestador-pm.md): Coordinación de agentes, sincronización de tareas en `TASK.md` y compilación limpia.

## Reglas Generales de Ejecución
- No alterar archivos fuera del alcance de la tarea en curso.
- Ejecutar `npx tsc --noEmit` tras cada cambio crítico en el frontend.
- Cero persistencia de audios o datos biométricos de voz.
- Prohibido hacer commits directos con `--force`.
