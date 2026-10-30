# Pruebas

Fecha: 25 de octubre de 2026.

## Suite automatizada

`python3 -m unittest discover -s tests -p 'test*.py' -v`

- 43 pruebas ejecutadas.
- 42 correctas.
- 1 omitida: ruta específica de FFmpeg/FFprobe, porque no están instalados.
- La ruta nativa AVFoundation sí se ejecutó y pasó.

Las pruebas cubren cola durable, dependencias, reintentos, leases, worker zombi, router, caché, presupuesto, colaboración, errores reales de CLI, importación sin alterar originales, radar verificable, creatividad local, aprendizaje de estilo, reversión y video nativo.

## Prueba real del panel

1. `POST /api/video/demo` creó `data/exports/kiko_studio_prueba.mp4`.
2. `POST /api/video/import` guardó una copia intacta en el proyecto.
3. `POST /api/video/process` produjo un MP4 vertical con el texto “Kiko Orator · IA aplicada”.
4. `GET /media/<id>/output` devolvió el archivo completo.
5. Una segunda inspección AVFoundation confirmó:

```json
{"duration":2,"width":1080,"height":1920,"video_codec":"native","playable":true}
```

Tamaño del archivo servido: 789215 bytes.

## Interfaz

La interfaz cargó correctamente y mostró: sistema local activo, un video listo, enlaces al original y al resultado, Codex/Claude/Gemini como aplicaciones verificadas y AVFoundation como motor audiovisual.
