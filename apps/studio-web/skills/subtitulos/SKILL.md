---
name: segmenta-subtitulos
description: Configura subtítulos para videos hablados en Segmenta Studio. Úsala al crear tarjetas legibles a partir del libreto de escenas.
---

# Subtítulos

Entrada: activación, modo, palabras por tarjeta, tamaño, posición y mayúsculas. Salida: `captions` y `style_snapshot.subtitle`.

- Modo **tarjeta**: el renderer reparte tarjetas de varias palabras dentro de cada subtítulo temporizado.
- Modo **palabra**: delega en la skill independiente [Subtítulos cinéticos](../subtitulos-cineticos/SKILL.md), que usa los tiempos reales de cada palabra.

Revisar el texto reconocido (nombres propios y marcas) sigue siendo necesario.
