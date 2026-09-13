"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { allJobs, appendJobs, copyJob, createBatch, deleteBatch, duplicateBatch, editJob, jobsPage, listBatches, moveJob, putBatch, reconcileBatches, removeJob } from '@/lib/batch-db';
import { expandBatch, type Batch, type BatchJob } from '@/lib/batch-types';
import { generationBusy, mutateQueue, serverGenerationBusy, subscribeGeneration, supportsBatchLocks } from '@/lib/generation-coordinator';
import { pauseBatch, recoverBatchSave, runBatch, runnerServerSnapshot, runnerSnapshot, subscribeRunner, validateBatch } from '@/lib/batch-runner';
import { type GenerationInput, settingsIssues } from '@/lib/generation-client';
import type { ImageModel, SourceReference } from '@/lib/types';
import { errorMessage, getMetadata } from '@/lib/library-db';
import { downloadBlob, exportLibrary } from '@/lib/library-backup';
import { exportBatchJSON, exportBatchZIP } from '@/lib/batch-export';
import CivitaiControls from './civitai-controls';

function JobEditor({ job, models, onSave, onClose }: { job: BatchJob; models: ImageModel[]; onSave: (input: GenerationInput, remove: boolean) => Promise<void>; onClose: () => void }) {
  const [input, setInput] = useState<GenerationInput>(() => structuredClone(job.input));
  const [remove, setRemove] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const settings = input.settings;
  return <section className="batch-editor" aria-label="Edit queued job"><h3>Edit job {job.order + 1}</h3>
    <label>Job prompt<textarea value={input.prompt} onChange={e => setInput({ ...input, prompt: e.target.value })} /></label>
    <label>Job negative prompt<textarea value={input.negativePrompt || ''} onChange={e => setInput({ ...input, negativePrompt: e.target.value })} /></label>
    <label>Job model<select value={settings.model} onChange={e => setInput({ ...input, settings: { ...settings, model: e.target.value } })}>{!models.some(m => m.id === settings.model) && <option>{settings.model}</option>}{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <label>Job resolution<input value={settings.size} onChange={e => setInput({ ...input, settings: { ...settings, size: e.target.value } })} /></label>
    {(['n', 'guidance_scale', 'num_inference_steps', 'seed'] as const).map(key => <label key={key}>{({ n: 'Job image count', guidance_scale: 'Job guidance', num_inference_steps: 'Job steps', seed: 'Job seed (empty = random)' })[key]}<input type="number" value={settings[key] ?? ''} onChange={e => setInput({ ...input, settings: { ...settings, [key]: key === 'seed' && !e.target.value ? undefined : Number(e.target.value) } })} /></label>)}
    {input.source && <p>Iteration source: {input.source.generationId}, variation {input.source.variationIndex + 1} <button type="button" onClick={() => setInput({ ...input, source: undefined })}>Remove source</button></p>}
    {job.referenceId && !remove && <p>Saved reference attached. <button type="button" onClick={() => setRemove(true)}>Remove saved reference</button></p>}
    {settings.model === 'custom-civitai' && <CivitaiControls settings={settings} onChange={settings => setInput({ ...input, settings })} image={input.imageDataUrl} onImage={imageDataUrl => { setInput({ ...input, imageDataUrl }); setRemove(true); }} onLoading={setLoading} />}
    {error && <p role="alert">{error}</p>}
    <button className="button button-primary" type="button" disabled={loading} onClick={async () => { try { const errors = settingsIssues(settings, models); if (!input.prompt.trim()) errors.push('Prompt is empty.'); if ((job.referenceId && !remove || input.imageDataUrl) && settings.model !== 'custom-civitai') errors.push('Remove the reference before choosing a text-only model.'); if (errors.length) throw new Error(errors.join(' ')); await onSave(input, remove); } catch (error) { setError(errorMessage(error)); } }}>Save job</button>
    <button className="button button-quiet" type="button" onClick={onClose}>Close editor</button>
  </section>;
}

export default function BatchPanel({ selected, onSelect, input, apiKey, models, revision, onChange, onOpen, onCompare }: {
  selected: string; onSelect: (id: string) => void; input: GenerationInput; apiKey: string; models: ImageModel[]; revision: number;
  onChange: () => void; onOpen: (id: string) => void; onCompare: (a: SourceReference, b: SourceReference) => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]), [jobs, setJobs] = useState<BatchJob[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [counts, setCounts] = useState({ completed: 0, pending: 0, failed: 0 });
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(''), [working, setWorking] = useState(false);
  const [prompts, setPrompts] = useState(''), [separator, setSeparator] = useState<'line' | 'paragraph'>('line'), [mode, setMode] = useState<'random' | 'range' | 'list'>('random');
  const [count, setCount] = useState(1), [start, setStart] = useState(0), [seeds, setSeeds] = useState('0, 1, 2');
  const [preview, setPreview] = useState<GenerationInput[] | null>(null), [editor, setEditor] = useState<BatchJob | null>(null);
  const [review, setReview] = useState<{ jobs: number; images: number; known: number; unknown: number; signature: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [supported, setSupported] = useState(false);
  const busy = useSyncExternalStore(subscribeGeneration, generationBusy, serverGenerationBusy);
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerServerSnapshot);
  const latest = useRef({ apiKey, models, onChange });
  useEffect(() => { latest.current = { apiKey, models, onChange }; }, [apiKey, models, onChange]);
  const abort = useRef<AbortController | null>(null);
  const batch = batches.find(value => value.id === selected);
  const locked = busy || !!batch?.running || working;
  useEffect(() => {
    Promise.resolve().then(() => setSupported(supportsBatchLocks()));
    if (supportsBatchLocks()) void mutateQueue(reconcileBatches).catch(error => { if (!errorMessage(error).startsWith('Another')) setError(errorMessage(error)); });
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    let canceled = false;
    async function refresh() {
      try {
        const values = await listBatches(); if (canceled) return; setBatches(values);
        if (!selected && values.length) { onSelect(values[0].id); return; }
        if (selected) {
          const result = await jobsPage(selected, page * 40);
          const summary = await allJobs(selected);
          if (!canceled) setCounts({ completed: summary.filter(job => job.status === 'succeeded').length, pending: summary.filter(job => job.status === 'pending').length, failed: summary.filter(job => ['failed', 'unknown', 'discarded'].includes(job.status)).length });
          const entries = await Promise.all(result.jobs.filter(job => job.resultId).map(async job => [job.id, !!await getMetadata(job.resultId!)] as const));
          if (!canceled) { setJobs(result.jobs); setTotal(result.total); setAvailable(Object.fromEntries(entries)); if (page && !result.jobs.length) setPage(0); }
        } else { setJobs([]); setTotal(0); }
      } catch (error) { if (!canceled) setError(errorMessage(error)); }
    }
    void refresh(); const timer = setInterval(refresh, 2000); return () => { canceled = true; clearInterval(timer); };
  }, [selected, page, revision, runner, onSelect]);
  async function action(task: () => Promise<void>) {
    setWorking(true); setError(''); setReview(null);
    try { await mutateQueue(task); onChange(); } catch (error) { setError(errorMessage(error)); } finally { setWorking(false); }
  }
  async function exportResults(zip: boolean) {
    if (!batch) return; setWorking(true); setExporting(zip); setError(''); abort.current = new AbortController();
    try { const blob = zip ? await exportBatchZIP(batch, setStatus, abort.current.signal) : await exportBatchJSON(batch.id, setStatus); downloadBlob(blob, `nano-batch-${batch.id}.${zip ? 'zip' : 'json'}`); setStatus('Export ready. JSON includes saved results only, not queued jobs or references.'); }
    catch (error) { setError(errorMessage(error)); } finally { setWorking(false); setExporting(false); abort.current = null; }
  }
  return <section className="batch-panel metadata-panel" aria-label="Batch queue"><h2>Batch queue</h2>
    <p>One request at a time. Results appear in Library without changing your viewer.</p>
    <label>Saved batches<select value={selected} onChange={e => { onSelect(e.target.value); setPage(0); setEditor(null); setReview(null); setPreview(null); }}><option value="">Choose a batch</option>{batches.map(b => <option value={b.id} key={b.id}>{b.name}{b.running ? ' · running' : ''}</option>)}</select></label>
    <label>Batch name<input value={name} placeholder={batch?.name || 'My batch'} maxLength={120} onChange={e => setName(e.target.value)} /></label>
    <div className="library-actions"><button type="button" className="button button-quiet" disabled={locked} onClick={() => action(async () => { const b = await createBatch(name); onSelect(b.id); })}>New batch</button>
      <button type="button" className="button button-quiet" disabled={!batch || locked || !name.trim()} onClick={() => action(async () => { await putBatch({ ...batch!, name: name.trim(), updatedAt: Date.now() }); })}>Rename batch</button>
      <button type="button" className="button button-quiet" disabled={!batch || locked} onClick={() => action(async () => { onSelect((await duplicateBatch(batch!)).id); })}>Duplicate batch</button>
      <button type="button" className="button button-quiet" disabled={!batch || locked} onClick={() => { if (confirm('Delete this batch and its queued references? Generated Library records will remain.')) void action(async () => { await deleteBatch(selected); onSelect(''); }); }}>Delete batch</button></div>
    {!supported && <p role="alert">Batch execution requires Web Locks on localhost or HTTPS in a supported browser.</p>}
    {batch && <>
      <details><summary>Build from prompt list</summary>
        <label>Batch prompts<textarea value={prompts} onChange={e => { setPrompts(e.target.value); setPreview(null); }} placeholder="One prompt per line" /></label>
        <label>Prompt separator<select aria-label="Prompt separator" value={separator} onChange={e => { setSeparator(e.target.value as typeof separator); setPreview(null); }}><option value="line">One per line</option><option value="paragraph">Blank line (multiline prompts)</option></select></label>
        <label>Seed mode<select aria-label="Seed mode" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setPreview(null); }}><option value="random">Provider-random repeats</option><option value="range">Consecutive seeds</option><option value="list">Explicit seed list</option></select></label>
        {mode === 'list' ? <label>Seeds<input value={seeds} onChange={e => { setSeeds(e.target.value); setPreview(null); }} /></label> : <label>Repeats / seed count<input type="number" min="1" max="100" value={count} onChange={e => { setCount(Number(e.target.value)); setPreview(null); }} /></label>}
        {mode === 'range' && <label>Starting seed<input type="number" min="0" value={start} onChange={e => { setStart(Number(e.target.value)); setPreview(null); }} /></label>}
        <p>Uses current Compose settings and reference. Seeds are request hints; identical images are not guaranteed.</p>
        <button className="button button-quiet" type="button" disabled={locked} onClick={() => { try { setPreview(expandBatch(input, prompts, separator, mode, count, start, seeds)); setError(''); } catch (error) { setError(errorMessage(error)); } }}>Preview jobs</button>
        {preview && <div className="batch-preview"><strong>{preview.length} jobs · {preview.reduce((sum, job) => sum + job.settings.n, 0)} requested images</strong><ol>{preview.map((job, i) => <li key={i}>{job.prompt}<small>Seed {job.settings.seed ?? 'Random — actual seed unknown'}</small></li>)}</ol><button type="button" className="button button-primary" disabled={locked} onClick={() => action(async () => { for (const job of preview) { const errors = settingsIssues(job.settings, models); if (errors.length) throw new Error(errors.join(' ')); } await appendJobs(selected, preview); setPreview(null); })}>Add previewed jobs</button></div>}
      </details>
      <div className="library-actions"><button type="button" className="button button-primary" disabled={locked || !supported} onClick={async () => { try { const pending = await validateBatch(selected, models); let known = 0, unknown = 0; for (const job of pending) { const price = models.find(m => m.id === job.input.settings.model)?.pricing?.per_image?.[job.input.settings.size]; if (price === undefined) unknown++; else known += price * job.input.settings.n; } setReview({ signature: JSON.stringify(pending), jobs: pending.length, images: pending.reduce((sum, job) => sum + job.input.settings.n, 0), known, unknown }); } catch (error) { setError(errorMessage(error)); } }}>Start / Resume</button>
        <button type="button" className="button button-quiet" disabled={!runner.active || runner.batchId !== selected} onClick={() => pauseBatch()}>Pause after current</button><button type="button" className="button button-quiet" disabled={!runner.active || runner.batchId !== selected} onClick={() => pauseBatch(true)}>Cancel remaining</button></div>
      {review && <div className="batch-review" role="region" aria-label="Review batch"><p>{review.jobs} pending jobs · {review.images} requested images. {review.unknown ? 'Known subtotal' : 'Estimated total'} ${review.known.toFixed(4)}{review.unknown ? `; ${review.unknown} jobs have unknown prices.` : '.'} Estimates are not a spending cap.</p><button type="button" className="button button-primary" disabled={locked || !apiKey.trim()} onClick={() => { setReview(null); void runBatch(batch, () => latest.current.apiKey, () => latest.current.models, () => latest.current.onChange(), review.signature).catch(error => setError(errorMessage(error))); }}>Confirm run</button>{!apiKey.trim() && <p>Connect your API key first.</p>}<button type="button" className="button button-quiet" onClick={() => setReview(null)}>Close review</button></div>}
      <div className="library-actions"><button className="button button-quiet" type="button" disabled={working} onClick={() => exportResults(true)}>Export images ZIP</button><button className="button button-quiet" type="button" disabled={working} onClick={() => exportResults(false)}>Export results JSON</button>{exporting && <button type="button" onClick={() => abort.current?.abort()}>Cancel export</button>}</div>
      <p role="status">{total} jobs · {counts.completed} saved · {counts.pending} pending · {counts.failed} need review · {runner.active && runner.batchId === selected ? runner.pause ? 'Stopping after current request' : 'Running' : 'Stopped — manual Start / Resume required'}</p>
      {editor && <JobEditor key={editor.id} job={editor} models={models} onClose={() => setEditor(null)} onSave={async (value, remove) => { if (locked) throw new Error('Pause the batch before editing.'); await mutateQueue(() => editJob(editor, value, remove)); setEditor(null); onChange(); }} />}
      <ol className="batch-jobs" start={page * 40 + 1}>{jobs.map(job => <li key={job.id}><strong>{job.status} · {job.input.prompt}</strong><small>{job.input.settings.model} · seed {job.input.settings.seed ?? 'Random — actual seed unknown'} · {job.input.settings.n} requested / {job.returnedImages ?? 0} returned images · cost {job.cost === undefined ? 'Unknown' : `$${job.cost.toFixed(4)}`}</small>{job.error && <p>{job.error}</p>}
        <div className="library-actions">{job.status === 'pending' ? <><button type="button" disabled={locked} onClick={() => setEditor(job)}>Edit job</button><button type="button" disabled={locked} onClick={() => action(() => moveJob(job, -1))}>Move up</button><button type="button" disabled={locked} onClick={() => action(() => moveJob(job, 1))}>Move down</button><button type="button" disabled={locked} onClick={() => action(() => removeJob(job))}>Remove job</button></> : null}
          <button type="button" disabled={locked || job.status === 'running'} onClick={() => { if (job.status === 'unknown' && !confirm('The previous attempt may have been charged. Queue a new paid attempt?')) return; void action(() => copyJob(job)); }}>{job.status === 'pending' ? 'Duplicate job' : 'Queue another attempt'}</button>
          {job.status === 'succeeded' && (available[job.id] ? <><button type="button" onClick={() => onOpen(job.resultId!)}>Open result</button><button type="button" disabled={working} onClick={async () => { setWorking(true); try { downloadBlob(await exportLibrary([job.resultId!], setStatus), `nano-result-${job.resultId}.json`); } catch (error) { setError(errorMessage(error)); } finally { setWorking(false); } }}>Export result JSON</button>{job.input.source && <button type="button" onClick={() => onCompare(job.input.source!, { generationId: job.resultId!, variationIndex: 0 })}>Compare with source</button>}</> : <span>Result unavailable</span>)}
        </div></li>)}</ol>
      <div className="library-pagination"><button type="button" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous jobs</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 40))}</span><button type="button" disabled={(page + 1) * 40 >= total} onClick={() => setPage(value => value + 1)}>Next jobs</button></div>
    </>}
    {runner.error && <p role="alert">{runner.error}</p>}
    {runner.unsaved && <section className="batch-recovery"><p>Image ready but unsaved. Save or download before closing this tab.</p>{/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="batch-unsaved-preview" src={runner.unsaved.record.images[0]} alt="Unsaved batch result" />{runner.unsaved.record.images.map((url, i) => <a key={i} className="button button-quiet" href={url} download={`unsaved-batch-${i + 1}.png`}>Download unsaved image {i + 1}</a>)}<button type="button" disabled={working} onClick={async () => { setWorking(true); try { await recoverBatchSave(false, onChange); } catch (e) { setError(errorMessage(e)); } finally { setWorking(false); } }}>Retry batch save</button><button type="button" disabled={working} onClick={async () => { if (confirm('Discard the unsaved result? Download it first.')) { setWorking(true); try { await recoverBatchSave(true, onChange); } catch (e) { setError(errorMessage(e)); } finally { setWorking(false); } } }}>Discard unsaved batch result</button></section>}
    {error && <p role="alert" className="library-error">{error}</p>}{status && <p role="status">{status}</p>}
  </section>;
}
