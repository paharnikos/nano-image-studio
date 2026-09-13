import type { GenerationMetadata, GenerationRecord, SourceReference } from "./types";
import type { ImageSize } from "./view-navigation";
export type ComparisonPair = { a: SourceReference; b?: SourceReference };
export type ComparedRecord = GenerationMetadata | GenerationRecord;
export const imageCount = (record: ComparedRecord) => "images" in record ? record.images.length : record.imageCount;
export function comparisonRows(a: ComparedRecord, b: ComparedRecord, dimensionsA?: ImageSize, dimensionsB?: ImageSize) {
  const dimensions = (size?: ImageSize) => size?.width && size?.height ? `${size.width} × ${size.height}` : "Unknown";
  const value = (item: number | undefined) => item === undefined ? "Unknown" : String(item);
  const entries: [string, string, string][] = [
    ["Prompt", a.prompt, b.prompt], ["Negative prompt", a.negativePrompt || "None", b.negativePrompt || "None"],
    ["Model", a.settings.model, b.settings.model], ["Requested size", a.settings.size, b.settings.size],
    ["Actual dimensions", dimensions(dimensionsA), dimensions(dimensionsB)],
    ["Requested images", value(a.settings.n), value(b.settings.n)], ["Seed", value(a.settings.seed), value(b.settings.seed)],
    ["Guidance", value(a.settings.guidance_scale), value(b.settings.guidance_scale)],
    ["Inference steps", value(a.settings.num_inference_steps), value(b.settings.num_inference_steps)],
    ["Saved at", new Date(a.createdAt).toISOString(), new Date(b.createdAt).toISOString()],
    ["Recorded cost", a.cost === undefined ? "Unknown" : `$${a.cost.toFixed(4)}`, b.cost === undefined ? "Unknown" : `$${b.cost.toFixed(4)}`],
  ];
  if (a.settings.model === "custom-civitai" || b.settings.model === "custom-civitai") entries.push(
    ["CivitAI version", a.settings.customCivitaiAir ?? "Unknown", b.settings.customCivitaiAir ?? "Unknown"],
    ["Scheduler", a.settings.scheduler ?? "Default", b.settings.scheduler ?? "Default"],
    ["Strength", value(a.settings.strength), value(b.settings.strength)],
    ["Explicit content", a.settings.showExplicitContent === undefined ? "Unknown" : String(a.settings.showExplicitContent), b.settings.showExplicitContent === undefined ? "Unknown" : String(b.settings.showExplicitContent)],
  );
  return entries.map(([label, a, b]) => ({ label, a, b, changed: a !== b }));
}
