import { allGenerationIds, getImages, getMetadata, listPresets, saveGeneration, savePreset } from "./library-db";
import { cleanGeneration, cleanPreset, identical, validateBackup, type Backup, type BackupPreview } from "./backup-format";
import type { GenerationRecord } from "./types";
import { normalizeRasterBlob } from "./raster";

const toDataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
async function portableRecord(id: string): Promise<GenerationRecord> {
  const info = await getMetadata(id);
  if (!info) throw new Error("A selected generation no longer exists. Refresh and try again.");
  const stored = await getImages(id);
  if (stored.length !== info.imageCount) throw new Error("Some images are missing. Restore this generation from an earlier backup.");
  const images: string[] = [];
  for (const image of stored) {
    let blob = image.blob;
    if (!blob && image.url) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error("An older image link is unavailable. Export the other records separately.");
      blob = await response.blob();
    }
    if (!blob) throw new Error("An image is missing from this generation.");
    images.push(await toDataURL(await normalizeRasterBlob(blob)));
  }
  return cleanGeneration({ ...info, images });
}
export async function exportLibrary(ids: string[] | undefined, progress: (message: string) => void): Promise<Blob> {
  const selected = ids ?? await allGenerationIds();
  const parts: BlobPart[] = ['{"format":"nano-studio","version":2,"generations":['];
  for (const [index, id] of selected.entries()) {
    progress(`Exporting generation ${index + 1} of ${selected.length}…`);
    const record = await portableRecord(id);
    parts.push(new Blob([`${index ? "," : ""}${JSON.stringify(record)}`]));
  }
  // Explicit allowlists ensure credentials and workspace state cannot enter backups.
  parts.push('],"presets":', JSON.stringify(ids ? [] : (await listPresets()).map(cleanPreset)), "}");
  return new Blob(parts, { type: "application/json" });
}
export async function prepareImport(input: unknown, progress: (message: string) => void): Promise<BackupPreview> {
  const preview = validateBackup(input);
  if (typeof createImageBitmap !== "undefined") {
    for (const [index, record] of preview.backup.generations.entries()) {
      progress(`Checking images in generation ${index + 1} of ${preview.backup.generations.length}…`);
      for (const [imageIndex, image] of record.images.entries()) {
        try { const bitmap = await createImageBitmap(await (await fetch(image)).blob()); bitmap.close(); }
        catch { preview.errors.push(`Generation ${record.id}, image ${imageIndex + 1}: image data could not be decoded.`); }
      }
    }
  }
  return preview;
}
async function conflictId(kind: string, source: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(source)));
  return `import-${kind}-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function importLibrary(input: Backup, progress: (message: string) => void) {
  const preview = await prepareImport(input, progress);
  if (preview.errors.length) throw new Error(`Backup contains ${preview.errors.length} invalid entries. Nothing was imported.`);
  const backup = preview.backup;
  let imported = 0, skipped = 0, conflicts = 0;
  try {
    // Resolve all destination IDs and parent references before committing any record.
    const incoming = new Map(backup.generations.map(record => [record.id, record]));
    const destinations = new Map<string, string>();
    const writes: GenerationRecord[] = [];
    async function plan(source: GenerationRecord): Promise<string> {
      const known = destinations.get(source.id);
      if (known) return known;
      let reference = source.source;
      if (reference) {
        const parent = incoming.get(reference.generationId);
        reference = parent && !reference.unresolved
          ? { generationId: await plan(parent), variationIndex: reference.variationIndex }
          : { ...reference, unresolved: true };
      }
      const candidate = { ...source, source: reference };
      let id = source.id;
      if (await getMetadata(id)) {
        let existing: GenerationRecord | undefined;
        try { existing = await portableRecord(id); } catch { /* Preserve an unreadable original. */ }
        if (existing && identical(existing, candidate)) { destinations.set(source.id, id); skipped++; return id; }
        id = await conflictId("generation", source);
        if (incoming.has(id)) id = crypto.randomUUID();
        if (await getMetadata(id)) {
          try {
            if (identical(await portableRecord(id), { ...candidate, id })) { destinations.set(source.id, id); skipped++; return id; }
          } catch { /* Keep both if a previous import is unreadable. */ }
          id = crypto.randomUUID();
        }
        conflicts++;
      }
      destinations.set(source.id, id);
      writes.push({ ...candidate, id });
      return id;
    }
    for (const source of backup.generations) {
      progress(`Planning import ${destinations.size + 1} of ${backup.generations.length}…`);
      await plan(source);
    }
    for (const [index, record] of writes.entries()) {
      progress(`Importing generation ${index + 1} of ${writes.length}…`);
      await saveGeneration(record); imported++;
    }
    const existing = new Map((await listPresets()).map(preset => [preset.id, preset]));
    for (const source of backup.presets) {
      let preset = source;
      if (existing.has(source.id)) {
        if (identical(cleanPreset(existing.get(source.id)), source)) { skipped++; continue; }
        let id = await conflictId("preset", source);
        if (existing.has(id)) {
          if (identical(cleanPreset(existing.get(id)), { ...source, id })) { skipped++; continue; }
          id = crypto.randomUUID();
        }
        preset = { ...source, id }; conflicts++;
      }
      await savePreset(preset); imported++;
    }
    return `${imported} entries imported; ${skipped} identical entries skipped; ${conflicts} conflicts kept as separate copies.`;
  } catch (error) {
    throw new Error(`Import stopped after saving ${imported} entries. Existing records are intact. ${(error as Error).message} Free browser storage and retry; identical entries will be skipped.`);
  }
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
