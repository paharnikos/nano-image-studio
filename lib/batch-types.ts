import type { GenerationInput } from './generation-client';
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'canceled' | 'discarded';
export type Batch = { id: string; name: string; createdAt: number; updatedAt: number; running: boolean };
export type BatchJob = { id: string; batchId: string; order: number; input: Omit<GenerationInput, 'imageDataUrl'>; referenceId?: string; status: JobStatus; createdAt: number; startedAt?: number; finishedAt?: number; resultId?: string; returnedImages?: number; cost?: number; error?: string };
export type BatchReference = { id: string; batchId: string; blob: Blob };
export function snapshotInput(input: GenerationInput): Omit<GenerationInput, 'imageDataUrl'> {
  return structuredClone({ prompt: input.prompt, negativePrompt: input.negativePrompt, settings: input.settings, source: input.source });
}
export function expandBatch(input: GenerationInput, text: string, separator: 'line' | 'paragraph', mode: 'random' | 'range' | 'list', count: number, start: number, list: string): GenerationInput[] {
  const prompts = text.split(separator === 'line' ? /\r?\n/ : /\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!prompts.length) throw new Error('Enter at least one prompt.');
  let seeds: Array<number | undefined>;
  if (mode === 'list') {
    const parts = list.trim().split(/[\s,]+/);
    if (!list.trim() || parts.some(value => !/^\d+$/.test(value))) throw new Error('Enter comma-separated non-negative integer seeds.');
    seeds = parts.map(Number);
  } else {
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Choose 1–100 repeats or seeds.');
    seeds = Array.from({ length: count }, (_, index) => mode === 'random' ? undefined : start + index);
  }
  if (seeds.some(seed => seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0))) throw new Error('Seeds must be non-negative safe integers.');
  if (prompts.length * seeds.length > 100) throw new Error('A batch can contain at most 100 jobs. Reduce the expansion.');
  return prompts.flatMap(prompt => seeds.map(seed => ({ ...snapshotInput(input), prompt, settings: { ...input.settings, seed }, imageDataUrl: input.imageDataUrl })));
}
