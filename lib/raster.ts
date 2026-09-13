/** Identify the raster bytes, since some providers label JPEG data as PNG. */
export function rasterMime(bytes: Uint8Array): string | undefined {
  const header = String.fromCharCode(...bytes.slice(0, 64));
  if (header.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (header.startsWith("\xff\xd8\xff")) return "image/jpeg";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  if (/^GIF8[79]a/.test(header)) return "image/gif";
  if (header.slice(4, 8) === "ftyp" && /avif|avis/.test(header.slice(8, 32))) return "image/avif";
  return undefined;
}
export async function normalizeRasterBlob(blob: Blob): Promise<Blob> {
  const mime = rasterMime(new Uint8Array(await blob.slice(0, 64).arrayBuffer()));
  return mime && mime !== blob.type ? new Blob([blob], { type: mime }) : blob;
}
