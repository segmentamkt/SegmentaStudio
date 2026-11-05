import { createClient } from "../../../../lib/supabase/server";
import { getRequestUser, unauthorized } from "../../../../lib/request-user";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MP4 = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.mp4$/i;
const URL_LIFETIME_SECONDS = 3600;

type RenderFile = {
  id: string;
  sessionId: string | null;
  name: string;
  objectKey: string;
  sizeBytes: number;
  createdAt: string | null;
};

export async function GET() {
  const user = await getRequestUser();
  if (!user) return unauthorized();
  try {
    const supabase = await createClient();
    const bucket = supabase.storage.from("kiko-videos");
    const ownerFolder = `${user.userId}/renders`;
    const options = { limit: 100, offset: 0, sortBy: { column: "created_at", order: "desc" } } as const;
    const root = await bucket.list(ownerFolder, options);
    if (root.error) throw root.error;

    const fileFrom = (file: NonNullable<typeof root.data>[number], sessionId: string | null): RenderFile | null => {
      const match = MP4.exec(file.name);
      const sizeBytes = Number(file.metadata?.size || 0);
      if (!file.id || !match || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
      return {
        id: match[1], sessionId, name: file.name,
        objectKey: `${ownerFolder}/${sessionId ? `${sessionId}/` : ""}${file.name}`,
        sizeBytes, createdAt: file.created_at || file.updated_at || null,
      };
    };

    // Earlier renders were stored directly in /renders. Newer ones may live
    // under a project/session folder; both remain accessible in the library.
    const files: RenderFile[] = (root.data || []).map((file) => fileFrom(file, null)).filter((file): file is RenderFile => Boolean(file));
    const sessionFolders = (root.data || []).filter((item) => !item.id && UUID.test(item.name)).slice(0, 25);
    const nested = await Promise.all(sessionFolders.map(async (folder) => {
      const listed = await bucket.list(`${ownerFolder}/${folder.name}`, options);
      if (listed.error) throw listed.error;
      return (listed.data || []).map((file) => fileFrom(file, folder.name)).filter((file): file is RenderFile => Boolean(file));
    }));
    files.push(...nested.flat());
    files.sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
    const latest = files.slice(0, 50);
    if (!latest.length) return Response.json({ outputs: [] }, { headers: { "Cache-Control": "private, no-store" } });

    const keys = latest.map((file) => file.objectKey);
    const [playback, download] = await Promise.all([
      bucket.createSignedUrls(keys, URL_LIFETIME_SECONDS),
      bucket.createSignedUrls(keys, URL_LIFETIME_SECONDS, { download: true }),
    ]);
    if (playback.error) throw playback.error;
    if (download.error) throw download.error;
    const playbackByPath = new Map((playback.data || []).filter((item) => item.path && item.signedUrl && !item.error).map((item) => [item.path, item.signedUrl]));
    const downloadByPath = new Map((download.data || []).filter((item) => item.path && item.signedUrl && !item.error).map((item) => [item.path, item.signedUrl]));
    const outputs = latest.flatMap((file) => {
      const previewUrl = playbackByPath.get(file.objectKey);
      const downloadUrl = downloadByPath.get(file.objectKey);
      return previewUrl && downloadUrl ? [{
        id: file.id, sessionId: file.sessionId, name: file.name, sizeBytes: file.sizeBytes,
        createdAt: file.createdAt, previewUrl, downloadUrl,
      }] : [];
    });
    return Response.json({ outputs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("render output listing failed", error);
    return Response.json({ error: "No pudimos listar las ediciones." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
