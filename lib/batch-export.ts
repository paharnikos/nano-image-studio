import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { allJobs } from './batch-db';
import { getMetadata, loadImage } from './library-db';
import { exportLibrary } from './library-backup';
import type { Batch } from './batch-types';
export async function exportBatchJSON(batchId: string, progress: (message: string) => void) {
  const ids: string[] = [];
  for (const job of await allJobs(batchId)) if (job.status === 'succeeded' && job.resultId && await getMetadata(job.resultId)) ids.push(job.resultId);
  if (!ids.length) throw new Error('No saved results are available to export.');
  return exportLibrary(ids, progress);
}
export async function exportBatchZIP(batch: Batch, progress: (message: string) => void, signal: AbortSignal) {
  const parts: BlobPart[] = []; let failure: Error | undefined;
  const zip = new Zip((error, data) => { if (error) failure = error; else parts.push(new Uint8Array(data).buffer); });
  const canceled = () => { if (signal.aborted) { zip.terminate(); throw new Error('Export canceled.'); } if (failure) throw failure; };
  const jobs = await allJobs(batch.id);
  const manifest = [];
  try {
    for (const job of jobs) {
      canceled(); const files: string[] = [], missing: string[] = [];
      const record = job.status === 'succeeded' && job.resultId ? await getMetadata(job.resultId) : undefined;
      if (job.status === 'succeeded' && !record) missing.push('Result unavailable');
      if (record) for (let index = 0; index < record.imageCount; index++) {
        canceled(); progress(`Exporting job ${job.order + 1}, image ${index + 1}…`);
        let added = false;
        let loaded: Awaited<ReturnType<typeof loadImage>> | undefined;
        try {
          loaded = await loadImage({ generationId: record.id, variationIndex: index });
          const response = await fetch(loaded.url, { signal }); if (!response.ok) throw new Error('Image could not be read');
          const blob = await response.blob(); canceled();
          const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[blob.type] || 'png';
          const filename = `job-${String(job.order + 1).padStart(3, '0')}/${index + 1}.${extension}`;
          const entry = new ZipPassThrough(filename); zip.add(entry); added = true;
          const reader = blob.stream().getReader();
          try { while (true) { canceled(); const chunk = await reader.read(); if (chunk.done) break; entry.push(chunk.value); } entry.push(new Uint8Array(), true); }
          finally { reader.releaseLock(); }
          files.push(filename);
        } catch (error) { canceled(); if (added) throw error; missing.push(`Variation ${index + 1}: ${(error as Error).message}`); }
        finally { loaded?.release(); }
      }
      manifest.push({ id: job.id, order: job.order, input: job.input, status: job.status, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, resultId: job.resultId, returnedImages: job.returnedImages, cost: job.cost, error: job.error, files, missing });
    }
    canceled(); const entry = new ZipPassThrough('manifest.json'); zip.add(entry);
    entry.push(strToU8(JSON.stringify({ format: 'nano-studio-batch-results', version: 1, batch: { id: batch.id, name: batch.name }, jobs: manifest }, null, 2)), true);
    zip.end(); canceled(); return new Blob(parts, { type: 'application/zip' });
  } catch (error) { zip.terminate(); throw error; }
}
