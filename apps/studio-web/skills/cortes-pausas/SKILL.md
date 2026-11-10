---
name: segmenta-cortes-pausas
description: Cortes y pausas de Segmenta Studio — quita la cuenta regresiva, las esperas y las colas fuera del guion, conserva las pausas naturales de hasta 0,7 s y acorta las largas a 0,45 s, sin cortar nunca una palabra ni cambiar la velocidad de la voz. Úsala cuando el estilo sea «Segmenta cinético» o el modo de pausas sea «Naturales».
---

# Cortes y pausas

Skill independiente del motor de Studio. Decide qué partes de cada toma se conservan; no toca el texto, el color ni los gráficos. Sus tramos alimentan al resto del render (y a los Subtítulos cinéticos, que usan el mismo mapa de tiempos).

Código: [`lib/skills/cortes-pausas/`](../../lib/skills/cortes-pausas/) · Pruebas: [`tests/cortes-pausas.test.ts`](../../tests/cortes-pausas.test.ts) · Prueba con un video local: [`scripts/skills/subtitulos-cineticos-preview.ts`](../../scripts/skills/subtitulos-cineticos-preview.ts) (`--libreto "texto"`, `--pausas compacto` para comparar)

## Contrato

**Entrada (por toma)**

- Ventana del recorte manual (`trim_start_seconds`/`trim_end_seconds`): siempre manda.
- Audio de la toma → detección de voz con **umbral adaptativo** (`voice.ts`).
- Palabras reconocidas con tiempos (`caption_cues[].words`), si existen.
- Libreto aprobado de la escena (`script`, leído de la base de datos, nunca del navegador).
- `dead_air.mode: "natural"` (estilo «Segmenta cinético» o ajuste «Pausas → Naturales» de la skill Recortes).

**Salida**

- Tramos a conservar en segundos del archivo original.
- Informe por toma en el resultado del render (`cut_report`): palabras descartadas al inicio y al final, pausas acortadas, segundos retirados, cómo se halló el guion (`libreto`, `vocabulario`, `audio`) y avisos.

## Reglas (aprobadas por el usuario; no cambiarlas sin pedido explícito)

1. **Nada fuera del guion.** Se elimina todo lo dicho antes de la primera palabra del guion (cuenta regresiva «3, 2, 1», «¿ya?», «acción», «grabando») y después de la última («corta», «¿quedó?»). Nunca debe oírse ni el «uno».
2. **Márgenes**: 0,15 s antes de la primera palabra y 0,25 s después de la última, sin invadir una palabra descartada.
3. **Pausas naturales**: las pausas internas de hasta 0,70 s quedan intactas (respiración, coma, sentido).
4. **Pausas largas**: más de 0,70 s → 0,45 s (0,25 s tras la voz + 0,20 s antes de la siguiente frase).
5. **Nunca se corta voz**: solo se recorta dentro de silencios medidos; una palabra reconocida dentro de un silencio (voz muy baja) se respeta aunque la pausa quede algo más larga. «Y sí» (isla de 0,31 s + pausa de 0,54 s) es la prueba obligatoria.
6. **El audio manda sobre el reconocimiento**: Whisper estira el final de las palabras dentro de las pausas; los tiempos se ajustan al silencio medido (también para los subtítulos cinéticos).
7. **Umbral adaptativo**: máx(ruido de fondo + 11 dB, pico − 38 dB) en ventanas de 10 ms; islas a ≤ 0,14 s se unen; ninguna isla de voz ≥ 0,05 s se descarta.
8. **Voz a 1,0×**: la skill nunca cambia velocidad ni tono.

### Cómo encuentra el guion

1. **Con libreto**: busca la primera secuencia que coincide con el inicio del libreto (tolera errores de reconocimiento: «lechón»/«lechona») y la última que coincide con su final. Así, «tres, dos, uno · Uno. OpenAI…» conserva el segundo «Uno».
2. **Sin libreto**: descarta una cuenta regresiva de al menos dos números descendentes y palabras de preparación inequívocas; «ya», «listo», «eso» solo si se dicen como pregunta. Un número suelto al inicio («Uno.», «Tres razones…») se conserva con un aviso.
3. **Sin palabras reconocidas**: solo el audio (primera y última isla de voz).

## Criterio de «perfecto» (revisión antes de entregar)

- [ ] El arranque no tiene ningún resto de cuenta regresiva ni de «¿ya?».
- [ ] Ninguna palabra empieza o termina cortada (escuchar cada unión).
- [ ] No suena atropellado: pausas cortas intactas, largas a 0,45 s.
- [ ] `cut_report` sin avisos pendientes (o revisados).
- [ ] La duración final coincide con la suma de los tramos.

## Límites actuales

- Un error grueso del reconocimiento puede impedir anclar el libreto; entonces se usan las reglas sin libreto y se avisa.
- No detecta todavía tomas repetidas dentro del mismo archivo ni muletillas en medio del guion («eh», «este»): se conservan.
- El modo «compacto» (otros estilos) sigue usando el detector anterior de umbral fijo, que puede tratar sílabas suaves como silencio.
