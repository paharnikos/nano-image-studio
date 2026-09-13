import type { GenerationSettings } from './types';

export const CIVITAI_MODEL = 'custom-civitai';
export const CIVITAI_RESOLUTIONS = ['1024x1024', '1024x768', '768x1024', '512x512', '1920x1088', '1088x1920'];
export function normalizeCivitaiAir(value: string): string | undefined {
  if (typeof value !== 'string') return;
  const input = value.trim();
  const air = /^(?:civitai:)?([1-9]\d*)@([1-9]\d*)$/.exec(input);
  if (air) return `civitai:${air[1]}@${air[2]}`;
  try {
    const url = new URL(input);
    if (!['civitai.com', 'www.civitai.com'].includes(url.hostname) || url.protocol !== 'https:') return;
    const model = /^\/models\/([1-9]\d*)(?:\/|$)/.exec(url.pathname)?.[1];
    const version = url.searchParams.get('modelVersionId');
    if (model && version && /^[1-9]\d*$/.test(version)) return `civitai:${model}@${version}`;
  } catch { /* Plain identifiers are handled above. */ }
}
export function civitaiIssues(settings: Pick<GenerationSettings, 'customCivitaiAir' | 'scheduler' | 'strength' | 'showExplicitContent'>): string[] {
  const issues: string[] = [];
  if (!settings.customCivitaiAir || !normalizeCivitaiAir(settings.customCivitaiAir)) issues.push('Choose a CivitAI version or enter its exact AIR (civitai:modelId@versionId).');
  if (settings.scheduler !== undefined && (typeof settings.scheduler !== 'string' || !settings.scheduler.trim() || settings.scheduler.length > 100)) issues.push('Enter a valid scheduler or use Default.');
  if (settings.strength !== undefined && (!Number.isFinite(settings.strength) || settings.strength < 0.1 || settings.strength > 1)) issues.push('Strength must be between 0.1 and 1.');
  if (settings.showExplicitContent !== undefined && typeof settings.showExplicitContent !== 'boolean') issues.push('Explicit-content preference must be true or false.');
  return issues;
}

export function customCivitaiPayload(input: { prompt: string; negativePrompt?: string; settings: GenerationSettings; imageDataUrl?: string }) {
  const { settings } = input;
  const errors = civitaiIssues(settings);
  if (!Number.isInteger(settings.num_inference_steps) || settings.num_inference_steps < 1 || settings.num_inference_steps > 60) errors.push('Custom CivitAI steps must be 1–60.');
  if (!Number.isFinite(settings.guidance_scale) || settings.guidance_scale < 1 || settings.guidance_scale > 15) errors.push('Custom CivitAI CFG scale must be 1–15.');
  if (!CIVITAI_RESOLUTIONS.includes(settings.size)) errors.push('Unsupported Custom CivitAI resolution.');
  if (!Number.isInteger(settings.n) || settings.n < 1 || settings.n > 4) errors.push('Choose 1–4 output images.');
  if (settings.seed !== undefined && (!Number.isSafeInteger(settings.seed) || settings.seed < 0)) errors.push('Invalid seed.');
  if (errors.length) throw new Error(errors.join(' '));
  return {
    prompt: input.negativePrompt?.trim() ? `${input.prompt}\n\nAvoid: ${input.negativePrompt.trim()}` : input.prompt,
    model: CIVITAI_MODEL, response_format: "b64_json", customCivitaiAir: normalizeCivitaiAir(settings.customCivitaiAir!)!,
    showExplicitContent: settings.showExplicitContent ?? false,
    steps: settings.num_inference_steps, CFGScale: settings.guidance_scale,
    scheduler: settings.scheduler?.trim() || 'Default', strength: settings.strength ?? 0.8,
    resolution: settings.size, nImages: settings.n,
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
    ...(input.imageDataUrl ? { imageDataUrl: input.imageDataUrl } : {}),
  };
}
