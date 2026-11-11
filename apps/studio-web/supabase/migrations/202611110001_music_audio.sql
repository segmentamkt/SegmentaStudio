-- Pista de música: la carpeta privada de Studio también acepta canciones del usuario
-- (MP3, M4A, AAC y WAV) en {uid}/{producción}/music/. Las reglas por dueño no cambian.
update storage.buckets
set allowed_mime_types = array['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/aac','audio/wav']
where id = 'kiko-videos';
