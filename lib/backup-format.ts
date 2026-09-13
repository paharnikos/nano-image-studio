import { normalizeCivitaiAir } from "./civitai";
import type { GenerationRecord, GenerationSettings, PromptPreset, SourceReference } from "./types";
import { rasterMime } from "./raster";

export type Backup = { format: "nano-studio"; version: 1 | 2; generations: GenerationRecord[]; presets: PromptPreset[] };
export type BackupPreview = { backup: Backup; errors: string[]; generationCount: number; presetCount: number };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, name: string, allowEmpty = false): string => {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${name} must be text.`);
  return value;
};
const number = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
};
const date = (value: unknown) => {
  const result = number(value, "Timestamp");
  if (result < 0 || result > 8.64e15) throw new Error("Invalid timestamp.");
  return result;
};
function settings(value: unknown): GenerationSettings {
  const input = object(value);
  const n = number(input.n, "Image count");
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("Image count must be 1–4.");
  const seed = input.seed === undefined ? undefined : number(input.seed, "Seed");
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0)) throw new Error("Invalid seed.");
  const customCivitaiAir = input.customCivitaiAir === undefined ? undefined : normalizeCivitaiAir(text(input.customCivitaiAir, "CivitAI AIR"));
  if (input.customCivitaiAir !== undefined && !customCivitaiAir) throw new Error("Invalid CivitAI AIR.");
  const scheduler = input.scheduler === undefined ? undefined : text(input.scheduler, "Scheduler");
  if (scheduler && scheduler.length > 100) throw new Error("Scheduler is too long.");
  const strength = input.strength === undefined ? undefined : number(input.strength, "Strength");
  if (strength !== undefined && (strength < 0.1 || strength > 1)) throw new Error("Strength must be between 0.1 and 1.");
  if (input.showExplicitContent !== undefined && typeof input.showExplicitContent !== "boolean") throw new Error("Invalid explicit-content preference.");
  return { customCivitaiAir, scheduler, strength, showExplicitContent: input.showExplicitContent as boolean | undefined, model: text(input.model, "Model"), size: text(input.size, "Size"), n, seed,
    guidance_scale: number(input.guidance_scale, "Guidance"), num_inference_steps: number(input.num_inference_steps, "Steps") };
}
export function cleanPreset(value: unknown): PromptPreset {
  const input = object(value);
  return { id: text(input.id, "ID"), name: text(input.name, "Preset name"), createdAt: date(input.createdAt),
    prompt: text(input.prompt, "Prompt"), negativePrompt: input.negativePrompt === undefined ? undefined : text(input.negativePrompt, "Negative prompt", true), settings: settings(input.settings) };
}
function cleanSource(value: unknown): SourceReference | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  const variationIndex = number(input.variationIndex, "Source variation index");
  if (!Number.isInteger(variationIndex) || variationIndex < 0 || variationIndex > 3) throw new Error("Source variation index must be 0–3.");
  if (input.unresolved !== undefined && typeof input.unresolved !== "boolean") throw new Error("Invalid unresolved source flag.");
  return { generationId: text(input.generationId, "Source generation ID"), variationIndex, ...(input.unresolved ? { unresolved: true } : {}) };
}

export function cleanGeneration(value: unknown): GenerationRecord {
  const input = object(value);
  if (!Array.isArray(input.images) || !input.images.length || input.images.length > 4) throw new Error("Expected 1–4 images.");
  const images = input.images.map(image => {
    if (typeof image !== "string" || !/^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error("Images must be embedded raster image data, not links.");
    const encoded = image.slice(image.indexOf(",") + 1);
    let header: string;
    try { header = atob(encoded.slice(0, 128)); atob(encoded); } catch { throw new Error("Invalid base64 image data."); }
    const type = image.slice(5, image.indexOf(";"));
    if (rasterMime(Uint8Array.from(header, character => character.charCodeAt(0))) !== type) throw new Error("Image data does not match its declared format.");
    return image;
  });
  if (input.tags !== undefined && (!Array.isArray(input.tags) || !input.tags.every(tag => typeof tag === "string"))) throw new Error("Tags must be text labels.");
  if (input.favorite !== undefined && typeof input.favorite !== "boolean") throw new Error("Favorite must be true or false.");
  return { source: cleanSource(input.source), id: text(input.id, "ID"), createdAt: date(input.createdAt), prompt: text(input.prompt, "Prompt"),
    negativePrompt: input.negativePrompt === undefined ? undefined : text(input.negativePrompt, "Negative prompt", true),
    settings: settings(input.settings), images,
    tags: [...new Set(((input.tags || []) as string[]).map(tag => tag.trim().toLowerCase()).filter(Boolean))], favorite: input.favorite === true,
    deletedAt: input.deletedAt === undefined ? undefined : date(input.deletedAt),
    cost: input.cost === undefined ? undefined : number(input.cost, "Cost"),
    remainingBalance: input.remainingBalance === undefined ? undefined : number(input.remainingBalance, "Balance") };
}
export function validateBackup(value: unknown): BackupPreview {
  const input = object(value);
  if (input.format !== "nano-studio" || (input.version !== 1 && input.version !== 2)) throw new Error("Unsupported backup format or version. Choose a Nano Studio version 1 or 2 JSON backup.");
  if (!Array.isArray(input.generations) || !Array.isArray(input.presets)) throw new Error("Backup must contain generations and presets arrays.");
  const errors: string[] = [], generations: GenerationRecord[] = [], presets: PromptPreset[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.generations.entries()) {
    try { const record = cleanGeneration(input.version === 1 ? { ...object(item), source: undefined } : item); if (seen.has(record.id)) throw new Error("Duplicate generation ID in backup."); seen.add(record.id); generations.push(record); }
    catch (error) { errors.push(`Generation ${index + 1}: ${(error as Error).message}`); }
  }
  seen.clear();
  for (const [index, item] of input.presets.entries()) {
    try { const preset = cleanPreset(item); if (seen.has(preset.id)) throw new Error("Duplicate preset ID in backup."); seen.add(preset.id); presets.push(preset); }
    catch (error) { errors.push(`Preset ${index + 1}: ${(error as Error).message}`); }
  }
  const byId = new Map(generations.map(record => [record.id, record]));
  for (const record of generations) {
    const source = record.source;
    if (!source) continue;
    if (source.generationId === record.id) errors.push(`Generation ${record.id}: source cannot reference itself.`);
    const parent = byId.get(source.generationId);
    if (parent && !source.unresolved && source.variationIndex >= parent.images.length) errors.push(`Generation ${record.id}: source variation does not exist.`);
    const visited = new Set<string>([record.id]);
    let current: GenerationRecord | undefined = record;
    while (current?.source && !current.source.unresolved) {
      const parentId: string = current.source.generationId;
      if (visited.has(parentId)) { errors.push(`Generation ${record.id}: cyclic source references.`); break; }
      visited.add(parentId); current = byId.get(parentId);
    }
  }
  return { backup: { format: "nano-studio", version: 2, generations, presets }, errors, generationCount: input.generations.length, presetCount: input.presets.length };
}
export function identical(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
