import { transaction, getMetadata } from './library-db';
import { snapshotInput, type Batch, type BatchJob, type BatchReference } from './batch-types';
import type { GenerationInput } from './generation-client';
const B = 'batches', J = 'batchJobs', R = 'batchReferences';
export const listBatches = () => transaction<Batch[]>([B], 'readonly', (tx, done) => { tx.objectStore(B).getAll().onsuccess = event => done((event.target as IDBRequest).result); });
export const putBatch = (batch: Batch) => transaction<void>([B], 'readwrite', (tx, done) => { tx.objectStore(B).put(batch); done(); });
export async function createBatch(name: string) { const batch: Batch = { id: crypto.randomUUID(), name: name.trim() || 'Untitled batch', createdAt: Date.now(), updatedAt: Date.now(), running: false }; await putBatch(batch); return batch; }
export const getJob = (id: string) => transaction<BatchJob | undefined>([J], 'readonly', (tx, done) => { tx.objectStore(J).get(id).onsuccess = event => done((event.target as IDBRequest).result); });
export const putJob = (job: BatchJob) => transaction<void>([J], 'readwrite', (tx, done) => { tx.objectStore(J).put(job); done(); });
export const jobsPage = (id: string, offset = 0, limit = 40) => transaction<{ jobs: BatchJob[]; total: number }>([J], 'readonly', (tx, done) => {
  const jobs: BatchJob[] = []; let total = 0;
  tx.objectStore(J).index('batchOrder').openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])).onsuccess = event => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) { done({ jobs, total }); return; }
    if (total >= offset && jobs.length < limit) jobs.push(cursor.value); total++; cursor.continue();
  };
});
export const allJobs = async (id: string) => (await jobsPage(id, 0, 100)).jobs;
export const referenceBlob = (id: string) => transaction<BatchReference | undefined>([R], 'readonly', (tx, done) => { tx.objectStore(R).get(id).onsuccess = event => done((event.target as IDBRequest).result); });
export async function referenceData(id: string) {
  const reference = await referenceBlob(id); if (!reference) throw new Error('Reference image is missing. Edit or remove this job before starting.');
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('Reference image could not be read.')); reader.readAsDataURL(reference.blob); });
}
export async function appendJobs(batchId: string, inputs: GenerationInput[]) {
  const snapshots = structuredClone(inputs);
  const refs = new Map<string, BatchReference>();
  const jobs: BatchJob[] = [];
  for (const input of snapshots) {
    if (!input.prompt.trim()) throw new Error('Each job needs a prompt.');
    let referenceId: string | undefined;
    if (input.imageDataUrl) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.imageDataUrl));
      referenceId = `${batchId}:${Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')}`;
      if (!refs.has(referenceId)) refs.set(referenceId, { id: referenceId, batchId, blob: await (await fetch(input.imageDataUrl)).blob() });
    }
    jobs.push({ id: crypto.randomUUID(), batchId, order: 0, input: snapshotInput(input), referenceId, status: 'pending', createdAt: Date.now() });
  }
  await transaction<void>([B, J, R], 'readwrite', (tx, done, fail) => {
    tx.objectStore(B).get(batchId).onsuccess = event => {
      const batch = (event.target as IDBRequest).result as Batch | undefined;
      if (!batch || batch.running) { fail(new Error('This batch is unavailable or running.')); return; }
      tx.objectStore(J).index('batchId').getAll(batchId).onsuccess = event => {
        const existing = (event.target as IDBRequest).result as BatchJob[];
        if (existing.length + jobs.length > 100) { fail(new Error('A batch can contain at most 100 jobs. Nothing was added.')); return; }
        const next = Math.max(-1, ...existing.map(job => job.order)) + 1;
        refs.forEach(ref => tx.objectStore(R).put(ref));
        jobs.forEach((job, i) => tx.objectStore(J).put({ ...job, order: next + i }));
        tx.objectStore(B).put({ ...batch, updatedAt: Date.now() }); done();
      };
    };
  });
}
export async function deleteBatch(id: string) {
  await transaction<void>([B, J, R], 'readwrite', (tx, done) => {
    tx.objectStore(B).delete(id);
    for (const store of [J, R]) tx.objectStore(store).index('batchId').openCursor(id).onsuccess = event => { const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result; if (cursor) { cursor.delete(); cursor.continue(); } };
    done();
  });
}
export async function cleanReferences(batchId: string) {
  const used = new Set((await allJobs(batchId)).map(job => job.referenceId).filter(Boolean));
  await transaction<void>([R], 'readwrite', (tx, done) => {
    tx.objectStore(R).index('batchId').openCursor(batchId).onsuccess = event => { const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result; if (cursor) { if (!used.has(cursor.value.id)) cursor.delete(); cursor.continue(); } }; done();
  });
}
export async function removeJob(job: BatchJob) {
  await transaction<void>([J], 'readwrite', (tx, done, fail) => {
    tx.objectStore(J).get(job.id).onsuccess = event => {
      const current = (event.target as IDBRequest).result as BatchJob | undefined;
      if (current?.status !== 'pending') { fail(new Error('Only pending jobs can be removed.')); return; }
      tx.objectStore(J).delete(job.id); done();
    };
  }); await cleanReferences(job.batchId);
}
export async function moveJob(job: BatchJob, direction: number) {
  const jobs = (await allJobs(job.batchId)).filter(value => value.status === 'pending');
  const index = jobs.findIndex(value => value.id === job.id);
  if (index < 0) throw new Error('Only pending jobs can be reordered.');
  job = jobs[index];
  const other = jobs[index + direction]; if (!other) return;
  await transaction<void>([J], 'readwrite', (tx, done) => { tx.objectStore(J).put({ ...job, order: other.order }); tx.objectStore(J).put({ ...other, order: job.order }); done(); });
}
export async function copyJob(job: BatchJob, targetBatch = job.batchId) {
  await appendJobs(targetBatch, [{ ...job.input, imageDataUrl: job.referenceId ? await referenceData(job.referenceId) : undefined }]);
}
export async function duplicateBatch(batch: Batch) {
  const jobs = await allJobs(batch.id);
  const inputs: GenerationInput[] = [];
  for (const job of jobs) inputs.push({ ...job.input, imageDataUrl: job.referenceId ? await referenceData(job.referenceId) : undefined });
  const copy = await createBatch(`${batch.name} copy`);
  try { await appendJobs(copy.id, inputs); } catch (error) { await deleteBatch(copy.id); throw error; } return copy;
}
export async function reconcileBatches() {
  for (const batch of await listBatches()) {
    for (const job of await allJobs(batch.id)) if (job.status === 'running') {
      const record = job.resultId ? await getMetadata(job.resultId) : undefined;
      await putJob({ ...job, status: record ? 'succeeded' : 'unknown', returnedImages: record?.imageCount, cost: record?.cost, finishedAt: Date.now(), error: record ? undefined : 'Interrupted after dispatch. Outcome and charge unknown; not retried.' });
    }
    if (batch.running) await putBatch({ ...batch, running: false });
  }
}

export const referenceExists = (id: string) => transaction<boolean>([R], "readonly", (tx, done) => { tx.objectStore(R).count(id).onsuccess = event => done((event.target as IDBRequest).result > 0); });
export async function editJob(job: BatchJob, input: GenerationInput, removeReference: boolean) {
  let referenceId = removeReference ? undefined : job.referenceId;
  let reference: BatchReference | undefined;
  if (input.imageDataUrl) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.imageDataUrl));
    referenceId = `${job.batchId}:${Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')}`;
    reference = { id: referenceId, batchId: job.batchId, blob: await (await fetch(input.imageDataUrl)).blob() };
  }
  await transaction<void>([J, R], 'readwrite', (tx, done, fail) => {
    tx.objectStore(J).get(job.id).onsuccess = event => {
      const current = (event.target as IDBRequest).result as BatchJob | undefined;
      if (current?.status !== 'pending') { fail(new Error('Only pending jobs can be edited.')); return; }
      if (reference) tx.objectStore(R).put(reference);
      tx.objectStore(J).put({ ...current, input: snapshotInput(input), referenceId }); done();
    };
  }); await cleanReferences(job.batchId);
}
