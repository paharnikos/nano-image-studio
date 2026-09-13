import { customCivitaiPayload, normalizeCivitaiAir, CIVITAI_MODEL } from "./civitai";
import type { GenerationRecord, GenerationSettings, ImageModel, SourceReference } from "./types";

export type GenerationInput = { prompt: string; negativePrompt?: string; settings: GenerationSettings; source?: SourceReference; imageDataUrl?: string };

export function settingsIssues(settings: GenerationSettings, models: ImageModel[]): string[] {
  const model = models.find(item => item.id === settings.model);
  if (!model) return ["This model is unavailable. Choose a supported model."];
  const issues: string[] = [];
  const parameters = model.supported_parameters;
  if (!(parameters?.resolutions?.length ? parameters.resolutions : ["1024x1024"]).includes(settings.size)) issues.push("Choose a supported resolution or aspect ratio.");
  const fixed = parameters?.fixed_image_count;
  if (!Number.isInteger(settings.n) || settings.n < 1 || settings.n > Math.min(parameters?.max_images || 4, 4) || (fixed && settings.n !== fixed)) issues.push("Choose a supported image count.");
  if (!Number.isFinite(settings.guidance_scale) || settings.guidance_scale < 0 || settings.guidance_scale > 20) issues.push("Set guidance between 0 and 20.");
  if (!Number.isInteger(settings.num_inference_steps) || settings.num_inference_steps < 1 || settings.num_inference_steps > 100) issues.push("Set inference steps between 1 and 100.");
  if (settings.seed !== undefined && (!Number.isSafeInteger(settings.seed) || settings.seed < 0)) issues.push("Use a non-negative integer seed or leave it random.");
  if (settings.model === CIVITAI_MODEL) { try { customCivitaiPayload({ prompt: "", settings }); } catch (error) { issues.push((error as Error).message); } }
  return issues;
}

export class GenerationRequestError extends Error { constructor(message: string, public uncertain = false) { super(message); } }

export async function requestGeneration(apiKey: string, input: GenerationInput, resultId?: string): Promise<GenerationRecord> {
  // Copy before the first await: subsequent form edits cannot change this request.
  const snapshot = structuredClone(input);
  if (snapshot.settings.model === CIVITAI_MODEL) snapshot.settings.customCivitaiAir = normalizeCivitaiAir(snapshot.settings.customCivitaiAir || "");
  let response: Response;
  try { response = await fetch("/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, prompt: snapshot.prompt, negativePrompt: snapshot.negativePrompt, ...snapshot.settings, imageDataUrl: snapshot.imageDataUrl }),
  });
  } catch { throw new GenerationRequestError("Connection lost after dispatch; the outcome and charge are unknown.", true); }
  const result = await response.json().catch(() => { throw new GenerationRequestError("The response could not be read; outcome unknown.", true); });
  if (!response.ok) throw new GenerationRequestError(result.error || "Generation failed.", response.status >= 500);
  if (!Array.isArray(result.images) || !result.images.length || !result.images.every((image: unknown) => typeof image === "string")) throw new GenerationRequestError("The generation returned no usable images; outcome unknown.", true);
  return {
    id: resultId ?? crypto.randomUUID(), createdAt: Date.now(), prompt: snapshot.prompt.trim(),
    negativePrompt: snapshot.negativePrompt?.trim() || undefined, settings: snapshot.settings,
    source: snapshot.source, images: result.images, cost: typeof result.cost === "number" ? result.cost : undefined,
    remainingBalance: typeof result.remainingBalance === "number" ? result.remainingBalance : undefined,
  };
}
