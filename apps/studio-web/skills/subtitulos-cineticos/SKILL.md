---
name: segmenta-subtitulos-cineticos
description: Subtítulos cinéticos de Segmenta Studio — UNA palabra visible a la vez, sincronizada con la voz, en blanco y naranja (Montserrat itálica), sin cajas ni texto en las pausas. Úsala cuando el estilo sea «Segmenta cinético» o el modo de subtítulos sea «Cinético: una palabra a la vez».
---

# Subtítulos cinéticos

Skill independiente del motor de Studio. Hace una sola cosa: convertir los subtítulos con tiempos de una toma en una capa animada de palabras que se monta sobre el video con un único `overlay` de FFmpeg. No corta, no colorea, no añade gráficos ni sonidos: eso es trabajo de otras skills.

Código: [`lib/skills/subtitulos-cineticos/`](../../lib/skills/subtitulos-cineticos/) · Pruebas: [`tests/subtitulos-cineticos.test.ts`](../../tests/subtitulos-cineticos.test.ts) · Prueba aislada con un video local: [`scripts/skills/subtitulos-cineticos-preview.ts`](../../scripts/skills/subtitulos-cineticos-preview.ts)

## Contrato

**Entrada**

- `caption_cues` de la toma, en segundos del archivo original. Cada subtítulo puede traer `words` (tiempos reales por palabra del reconocimiento de voz). Los subtítulos importados de SRT/VTT o corregidos con otro número de palabras no los tienen.
- Los tramos que sobreviven al corte de silencios y la velocidad de la toma.
- `style_snapshot.subtitle`: `mode: "palabra"`, `position` (`chest` por defecto; `top`, `center`, `bottom`), `size` (72 = tamaño de referencia) y `uppercase`.

**Salida**

- Lista de palabras (`planKineticCaptions`): texto limpio, inicio, fin de visibilidad, estilo (`normal`, `enfasis`, `ligera`) y si el tiempo fue estimado.
- Capa animada (`buildKineticLayer`): fotogramas PNG con transparencia y una lista `ffconcat` con duraciones exactas.
- En el resultado del render: `caption_count` (palabras mostradas), `caption_mode` y `estimated_caption_words`.

## Reglas de estilo (aprobadas por el usuario; no cambiarlas sin pedido explícito)

1. **Una sola palabra visible a la vez.** Nunca dos líneas, nunca banda inferior ni caja negra.
2. **Sincronía con la voz.** La palabra aparece cuando empieza su sonido. Si la siguiente llega en ≤ 0,30 s se mantiene hasta ella; en una pausa real desaparece 0,14 s después de terminar. **Sin texto en las pausas.**
3. **Colores.** Blanco (Montserrat ExtraBold Italic, 112 px a 1080 de ancho) para el texto; **naranja #FF7A00 con resplandor** (Montserrat Black Italic, 138 px) para cifras, marcas y la palabra clave; palabras funcionales de ≤ 3 letras («de», «la», «y») en trazo fino (Montserrat Light Italic, 92 px). Sombra suave para leer sobre fondos claros.
4. **Resaltado con medida.** Siempre en naranja: números y cifras dichas, marcas (Segmenta, ChatGPT, Meta Ads, Google Ads, Claude, TikTok…) y lo que el usuario escriba entre asteriscos (`*clave*`). Además, una palabra clave por frase o por tramo de 6–7 palabras (≈ 1 de cada 5–8). Si todo resalta, nada resalta.
5. **Ortografía exacta de marcas**: chatgpt → ChatGPT, openai → OpenAI, «meta ads» → Meta Ads. «Meta» como palabra común («mi meta») no se toca.
6. **Animación de la referencia**: entrada con leve rebote y subida (0,15 s); el énfasis entra desde más grande (0,16 s); salida de dos fotogramas.
7. **Posición**: a la altura del pecho, bajo la barbilla (64 % del alto); ancho máximo 80 % del cuadro, la letra se reduce si hace falta.
8. **El texto sale de lo dicho.** La skill no inventa ni reescribe palabras: corrige el texto en el editor; si la corrección conserva el número de palabras, se conservan los tiempos reales.

## Criterio de «perfecto» (revisión antes de entregar)

- [ ] Ninguna palabra visible durante una pausa ni antes de oírse.
- [ ] Nunca hay dos palabras a la vez.
- [ ] `estimated_caption_words = 0` (si no, avisar: esas palabras se repartieron por sílabas).
- [ ] Naranja en ≤ 25 % de las palabras; cifras y marcas siempre en naranja.
- [ ] Marcas bien escritas; ninguna palabra cortada por el borde.
- [ ] La palabra no tapa la cara (si el rostro está bajo, usar posición «Abajo»).

## Límites actuales

- La posición no detecta el rostro: usa el 64 % del alto. Si el presentador está muy abajo en el cuadro, elegir otra posición.
- La sincronía depende del reconocimiento de voz (Whisper base). Revisar nombres propios antes de exportar.
- Durante gráficos a pantalla completa (skill de gráficos, pendiente) no debe haber subtítulos; hoy no existen esos gráficos.
