"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Download, Search, Star, Trash2, Upload } from "lucide-react";
import { emptyQuery, errorMessage, getThumbnail, normalizeTags, permanentlyDelete, queryLibrary, updateGenerations, type LibraryQuery } from "@/lib/library-db";
import { downloadBlob, exportLibrary, importLibrary, prepareImport } from "@/lib/library-backup";
import { type BackupPreview } from "@/lib/backup-format";
import type { GenerationMetadata } from "@/lib/types";

function Thumbnail({ id }: { id: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    let disposed = false, objectURL = "";
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      getThumbnail(id).then(result => {
        if (!disposed && result) { objectURL = URL.createObjectURL(result.blob); setUrl(objectURL); }
      }).catch(() => undefined);
    });
    if (element.current) observer.observe(element.current);
    return () => { disposed = true; observer.disconnect(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [id]);
  return <span className="library-thumb" ref={element}>{url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" />
  ) : <Archive size={18} />}</span>;
}

export default function LibraryPanel({ ready, revision, activeId, onOpen, onChange, onCompare }: {
  ready: boolean; revision: number; activeId?: string; onOpen: (id: string) => void; onChange: () => void; onCompare: (a: string, b: string) => void;
}) {
  const [query, setQuery] = useState<LibraryQuery>(emptyQuery);
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState<GenerationMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<{ tags: string[]; models: string[] }>({ tags: [], models: [] });
  const [selected, setSelected] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    queryLibrary(query, page * 40).then(result => {
      if (cancelled) return;
      setRecords(result.records); setTotal(result.total); setFacets({ tags: result.tags, models: result.models });
      if (page > 0 && !result.records.length) setPage(Math.max(0, Math.ceil(result.total / 40) - 1));
    }).catch(error => { if (!cancelled) setError(errorMessage(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, page, revision, ready]);
  function filter(patch: Partial<LibraryQuery>) { setQuery(old => ({ ...old, ...patch })); setPage(0); setSelected([]); setConfirmDelete(false); }
  async function action(task: () => Promise<void>) {
    setBusy(true); setError(""); setStatus("");
    try { await task(); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); onChange(); }
  }
  async function exportBackup(ids?: string[]) {
    await action(async () => { const blob = await exportLibrary(ids, setStatus); downloadBlob(blob, `nano-studio-${new Date().toISOString().slice(0, 10)}.json`); setStatus("Backup downloaded. It contains no API key."); });
  }
  return (
    <aside className="history-rail library-panel" aria-label="Generation library">
      <div className="library-heading"><h2>Library</h2><span>{total} results</span></div>
      <div className="library-controls">
        <div className="library-actions">
          <button type="button" className="button button-quiet" aria-pressed={!query.trash} onClick={() => filter({ trash: false })}>Library</button>
          <button type="button" className="button button-quiet" aria-pressed={query.trash} onClick={() => filter({ trash: true })}><Trash2 size={14} /> Trash</button>
        </div>
        <label className="library-search"><Search size={14} /><input aria-label="Search prompts" placeholder="Search prompts…" value={query.search} onChange={event => filter({ search: event.target.value })} /></label>
        <label className="library-check"><input type="checkbox" checked={query.favorite} onChange={event => filter({ favorite: event.target.checked })} /> Favorites only</label>
        <details className="library-extra-filters"><summary>Filters and sorting{query.model || query.tags.length ? " (active)" : ""}</summary>
        <label>Model<select value={query.model} onChange={event => filter({ model: event.target.value })}><option value="">All models</option>{facets.models.map(model => <option key={model}>{model}</option>)}</select></label>
        <label>Sort<select value={query.oldest ? "oldest" : "newest"} onChange={event => filter({ oldest: event.target.value === "oldest" })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        {!!facets.tags.length && <details className="library-filter-tags"><summary>Filter tags {query.tags.length ? `(${query.tags.length})` : ""}</summary><div>{facets.tags.map(tag => <label className="library-check" key={tag}><input type="checkbox" checked={query.tags.includes(tag)} onChange={event => filter({ tags: event.target.checked ? [...query.tags, tag] : query.tags.filter(item => item !== tag) })} />{tag}</label>)}</div><small>Matches every selected tag.</small></details>}
        <button className="button button-quiet" type="button" onClick={() => filter({ ...emptyQuery, trash: query.trash })}>Clear filters</button>
        </details>
        <div className="library-actions">
          <button type="button" className="button button-quiet" disabled={busy || !ready} onClick={() => exportBackup()}><Download size={14} /> Backup all</button>
          <button type="button" className="button button-quiet" disabled={busy || !ready} onClick={() => input.current?.click()}><Upload size={14} /> Import</button>
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) action(async () => { setPreview(null); setStatus("Validating backup…"); const result = await prepareImport(JSON.parse(await file.text()), setStatus); setPreview(result); setStatus(""); });
          }} />
        </div>
        {preview && <section className="import-preview" aria-label="Backup import preview">
          <strong>Import preview</strong><p>{preview.generationCount} generations · {preview.presetCount} presets · {preview.errors.length} invalid entries</p>
          {preview.errors.length > 0 ? <><ul>{preview.errors.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p>Fix invalid entries and choose the file again. Nothing has been imported.</p></> : <p>Identical entries are skipped. Conflicting IDs are kept as separate copies.</p>}
          <div className="library-actions"><button className="button button-primary" type="button" disabled={busy || !!preview.errors.length} onClick={() => action(async () => { const message = await importLibrary(preview.backup, setStatus); setPreview(null); setStatus(message); })}>Import backup</button><button className="button button-quiet" type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>
        </section>}
        {!!selected.length && <div className="library-selection">
          <strong>{selected.length} selected</strong>
          {selected.length === 2 && <button className="button button-quiet" type="button" onClick={() => onCompare(selected[0], selected[1])}>Compare selected</button>}
          <label>Add tags<input placeholder="landscape, study" value={tagText} onChange={event => setTagText(event.target.value)} /></label>
          <div className="library-actions">
            <button className="button button-quiet" type="button" disabled={busy || !normalizeTags(tagText).length} onClick={() => action(async () => { await updateGenerations(selected, { tags: normalizeTags(tagText) }, true); setTagText(""); })}>Add tags</button>
            <button className="button button-quiet" type="button" disabled={busy} onClick={() => exportBackup(selected)}>Export selected</button>
            <button className="button button-quiet" type="button" disabled={busy} onClick={() => action(async () => { await updateGenerations(selected, { deletedAt: query.trash ? undefined : Date.now() }); setSelected([]); })}>{query.trash ? "Restore" : "Move to Trash"}</button>
            {query.trash && <button className="button button-quiet" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete permanently</button>}
            <button className="button button-quiet" type="button" onClick={() => { setSelected([]); setConfirmDelete(false); }}>Clear selection</button>
          </div>
          {confirmDelete && <div role="alert"><p>Permanently delete {selected.length} selected generations and their images? This cannot be undone.</p><button className="button button-primary" type="button" disabled={busy} onClick={() => action(async () => { await permanentlyDelete(selected); setSelected([]); setConfirmDelete(false); })}>Confirm permanent deletion</button><button className="button button-quiet" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
        </div>}
      </div>
      {error && <p className="library-error" role="alert">{error}</p>}
      {status && <p className="library-status" role="status">{status}</p>}
      {!ready ? <p className="library-status">Opening library…</p> : <>
        <label className="library-check"><input type="checkbox" disabled={!records.length || loading || busy} checked={records.length > 0 && records.every(record => selected.includes(record.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...records.map(record => record.id)])] : selected.filter(id => !records.some(record => record.id === id)))} /> Select this page</label>
        <div className="library-records" aria-busy={loading}>
          {!records.length && <p>{query.trash ? "Trash is empty or no records match." : "No generations match. Generate an image or clear your filters."}</p>}
          {records.map(record => <div className={`library-record ${activeId === record.id ? "is-active" : ""}`} key={record.id}>
            <input type="checkbox" aria-label={`Select ${record.prompt}`} checked={selected.includes(record.id)} disabled={busy} onChange={event => setSelected(event.target.checked ? [...selected, record.id] : selected.filter(id => id !== record.id))} />
            <button type="button" className="library-open" onClick={() => onOpen(record.id)} aria-label={`Open generation: ${record.prompt}`}><Thumbnail id={record.id} /><span><strong>{record.prompt}</strong><small>{new Date(record.createdAt).toLocaleDateString()} · {record.imageCount} images</small>{!!record.tags?.length && <small>{record.tags.join(", ")}</small>}</span></button>
            <button type="button" className="icon-button" disabled={busy} aria-label={`${record.favorite ? "Unfavorite" : "Favorite"} ${record.prompt}`} aria-pressed={!!record.favorite} onClick={() => action(() => updateGenerations([record.id], { favorite: !record.favorite }))}><Star size={15} fill={record.favorite ? "currentColor" : "none"} /></button>
          </div>)}
        </div>
        <div className="library-pagination"><button className="button button-quiet" type="button" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 40))}</span><button className="button button-quiet" type="button" disabled={(page + 1) * 40 >= total || loading} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </>}
    </aside>
  );
}
