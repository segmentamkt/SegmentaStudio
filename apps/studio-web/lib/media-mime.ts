/** MediaRecorder includes codecs in MIME values; Storage needs the container type. */
export function recordingMimeType(type: string, filename = ""): string {
  if (/\.mov$/i.test(filename)) return "video/quicktime";
  if (/\.webm$/i.test(filename)) return "video/webm";
  if (/\.(mp4|m4v)$/i.test(filename)) return "video/mp4";
  const container = type.split(";", 1)[0].trim().toLowerCase();
  return container === "video/quicktime" || container === "video/webm" ? container : "video/mp4";
}
