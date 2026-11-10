# Skills de Segmenta Studio

Cada carpeta contiene la responsabilidad y el contrato de una especialidad. El catálogo ejecutable y sus valores por defecto viven en [`../lib/studio-skills.ts`](../lib/studio-skills.ts). El panel de configuración está en [`../components/skills-studio.tsx`](../components/skills-studio.tsx).

| Skill | Estado en la nube | Resultado actual |
| --- | --- | --- |
| Director | Plan | Prioridad e instrucciones en el manifiesto |
| Sonido | Parcial | Normalización de voz en el render base |
| Efectos visuales | Parcial | Rótulo inicial |
| Recortes | Parcial | Detección de silencios |
| Edición | Render | Zoom y encuadre |
| Color | Render | Saturación |
| Generador de imágenes | Pendiente | Solicitud en el plan; sin generación |
| Superposiciones | Parcial | Título inicial |
| Efectos de sonido | Parcial | Efectos procedimentales por estilo en cortes de tomas y silencios |
| Subtítulos | Parcial | Tarjetas con tiempos de voz; en modo «palabra» delega en Subtítulos cinéticos |
| Subtítulos cinéticos | Render | Una palabra a la vez, sincronizada, blanco/naranja Montserrat ([contrato](subtitulos-cineticos/SKILL.md)) |
| Retoques | Parcial | Contraste |
| Narrativa | Plan | Estructura deseada; orden aprobado |
| Transiciones | Render | Corte, fundido y disolución |
| Clips | Pendiente | Solicitud en el plan; sin extracción |

`applySkillProfilesToContract` valida los perfiles, escribe los campos que consume el renderer y adjunta `skill_manifest`. Una instrucción libre o una skill pendiente no ejecuta por sí misma una IA ni modifica el video. Para que Claude, Gemini u otro modelo hagan una tarea se necesita un puente autenticado y una acción verificable en el motor.
