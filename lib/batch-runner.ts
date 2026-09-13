import { acquireGeneration } from './generation-coordinator';
import { allJobs, listBatches, putBatch, putJob, referenceExists, referenceData } from './batch-db';
import { GenerationRequestError, requestGeneration, settingsIssues } from './generation-client';
import { saveGeneration } from './library-db';
import type { Batch, BatchJob } from './batch-types';
import type { GenerationRecord, ImageModel } from './types';
export type RunnerState = { batchId?: string; active: boolean; pause: boolean; cancel: boolean; error?: string; unsaved?: { job: BatchJob; record: GenerationRecord } };
let state: RunnerState = { active: false, pause: false, cancel: false };
const listeners = new Set<() => void>();
let release: (() => void) | undefined;
let currentBatch: Batch | undefined;
export const runnerSnapshot = () => state;
const initial: RunnerState = { active: false, pause: false, cancel: false };
export const runnerServerSnapshot = () => initial;
export const subscribeRunner = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<RunnerState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
export function pauseBatch(cancel = false) { update({ pause: true, cancel: state.cancel || cancel }); }
export async function validateBatch(batchId: string, models: ImageModel[]) {
  const jobs = (await allJobs(batchId)).filter(job => job.status === 'pending');
  if (!jobs.length) throw new Error('No pending jobs.');
  for (const job of jobs) {
    const errors = settingsIssues(job.input.settings, models);
    if (!job.input.prompt.trim()) errors.push('Prompt is empty.');
    if (errors.length) throw new Error(`Job ${job.order + 1}: ${errors.join(' ')}`);
    if (job.referenceId && !await referenceExists(job.referenceId)) throw new Error(`Job ${job.order + 1}: reference image is missing.`);
  }
  return jobs;
}
async function finish() {
  if (currentBatch) {
    if (state.cancel) for (const job of await allJobs(currentBatch.id)) if (job.status === 'pending') await putJob({ ...job, status: 'canceled', finishedAt: Date.now() });
    await putBatch({ ...currentBatch, running: false, updatedAt: Date.now() });
  }
  update({ active: false }); release?.(); release = undefined;
}
export async function runBatch(batch: Batch, getKey: () => string, getModels: () => ImageModel[], changed: () => void, expectedSignature?: string) {
  if (state.unsaved) throw new Error('Save or discard the unsaved result first.');
  release = await acquireGeneration(true); currentBatch = batch;
  update({ batchId: batch.id, active: true, pause: false, cancel: false, error: undefined });
  try {
    currentBatch = (await listBatches()).find(value => value.id === batch.id);
    if (!currentBatch) throw new Error('Batch is unavailable.');
    if (!getKey().trim()) throw new Error('Connect an API key before starting.');
    const pendingReview = await validateBatch(batch.id, getModels());
    if (expectedSignature !== undefined && JSON.stringify(pendingReview) !== expectedSignature) throw new Error("The queue changed. Review the batch again before starting.");
    await putBatch({ ...currentBatch, running: true }); changed();
    for (const pending of await allJobs(batch.id)) {
      if (state.pause || pending.status !== 'pending') continue;
      const errors = settingsIssues(pending.input.settings, getModels());
      if (errors.length) throw new Error(`Job ${pending.order + 1}: ${errors.join(' ')}`);
      if (!getKey().trim()) throw new Error('API key was removed.');
      const input = { ...pending.input, imageDataUrl: pending.referenceId ? await referenceData(pending.referenceId) : undefined };
      const job: BatchJob = { ...pending, status: 'running', resultId: crypto.randomUUID(), startedAt: Date.now() };
      await putJob(job); changed();
      let record: GenerationRecord;
      try { record = await requestGeneration(getKey(), input, job.resultId); }
      catch (error) {
        const uncertain = !(error instanceof GenerationRequestError) || error.uncertain;
        await putJob({ ...job, status: uncertain ? 'unknown' : 'failed', error: (error as Error).message, finishedAt: Date.now() });
        throw error;
      }
      try { await saveGeneration(record, false, job); changed(); }
      catch (error) { update({ unsaved: { job, record }, pause: true, error: `Image ready, but saving failed: ${(error as Error).message}` }); changed(); break; }
    }
  } catch (error) { update({ error: (error as Error).message, pause: true }); }
  finally {
    if (!state.unsaved) { try { await finish(); } finally { release?.(); release = undefined; update({ active: false }); } }
    else update({ active: false });
    changed();
  }
}
export async function recoverBatchSave(discard: boolean, changed: () => void) {
  const pending = state.unsaved; if (!pending) return;
  if (discard) await putJob({ ...pending.job, status: 'discarded', finishedAt: Date.now(), error: 'Successful image discarded after saving failed.' });
  else await saveGeneration(pending.record, false, pending.job);
  update({ unsaved: undefined, error: undefined });
  try { await finish(); } finally { release?.(); release = undefined; update({ active: false }); changed(); }
}
