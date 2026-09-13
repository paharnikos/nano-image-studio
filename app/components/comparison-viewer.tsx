"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Download, Maximize, Minimize, Star, ZoomIn, ZoomOut } from "lucide-react";
import ImageViewer from "./image-viewer";
import { emptyQuery, errorMessage, getMetadata, loadImage, queryLibrary, updateGenerations } from "@/lib/library-db";
import { comparisonRows, imageCount, type ComparedRecord, type ComparisonPair } from "@/lib/comparison";
import { clamp, fitNavigation, type ImageSize, type ViewNavigation } from "@/lib/view-navigation";
import type { GenerationMetadata, GenerationRecord, SourceReference } from "@/lib/types";

type Metrics = ImageSize & { scale: number; fit: number };
type Loaded = { key: string; url: string; record: ComparedRecord };
function useComparisonImage(reference: SourceReference | undefined, unsaved: GenerationRecord | null, revision: number) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = reference ? `${reference.generationId}:${reference.variationIndex}:${!!reference.unresolved}` : "";
  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    const run = async () => {
      if (unsaved?.id === reference.generationId) {
        const url = unsaved.images[reference.variationIndex];
        if (!url) throw new Error("This variation is unavailable.");
        return { url, record: unsaved, release: () => {} };
      }
      return loadImage(reference);
    };
    run().then(result => {
      if (cancelled) { result.release(); return; }
      release = result.release; setLoaded({ ...result, key }); setFailure(null);
    }).catch(error => { if (!cancelled) setFailure({ key, message: errorMessage(error) }); });
    return () => { cancelled = true; release?.(); };
  // Primitive identity keeps metadata-only edits from reloading full-resolution images.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unsaved]);
  useEffect(() => {
    if (!reference || reference.generationId === unsaved?.id) return;
    let cancelled = false;
    getMetadata(reference.generationId).then(record => {
      if (cancelled) return;
      if (!record) { setFailure({ key, message: "Source unavailable. This generation was permanently deleted." }); }
      else setLoaded(old => old?.key === key ? { ...old, record } : old);
    }).catch(error => { if (!cancelled) setFailure({ key, message: errorMessage(error) }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return { loaded: loaded?.key === key && failure?.key !== key ? loaded : null, error: failure?.key === key ? failure.message : "" };
}

function ImagePicker({ onChoose, onClose, sameGeneration }: { onChoose: (reference: SourceReference) => void; onClose: () => void; sameGeneration?: SourceReference }) {
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState<GenerationMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    queryLibrary({ ...emptyQuery, search, trash }, page * 40).then(result => { if (!cancelled) { setRecords(result.records); setTotal(result.total); } }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [search, trash, page]);
  return <div className="comparison-picker" aria-label="Choose comparison image">
    <div className="library-actions"><input autoFocus aria-label="Search comparison images" placeholder="Search prompts…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /><label className="library-check"><input type="checkbox" checked={trash} onChange={event => { setTrash(event.target.checked); setPage(0); }} />In Trash</label><button className="button button-quiet" type="button" onClick={onClose}>Close picker</button></div>
    {sameGeneration && <button className="button button-quiet" type="button" onClick={() => onChoose(sameGeneration)}>Use the other pane’s generation</button>}
    {error && <p role="alert">{error}</p>}
    <div className="comparison-picker-list">{records.map(record => <button className="button button-quiet" type="button" key={record.id} onClick={() => onChoose({ generationId: record.id, variationIndex: 0 })}><span>{record.prompt}</span><small>{record.settings.model} · {record.imageCount} variations</small></button>)}{!records.length && <p>No matching generations.</p>}</div>
    <div className="library-pagination"><button type="button" className="button button-quiet" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 40))}</span><button type="button" className="button button-quiet" disabled={(page + 1) * 40 >= total} onClick={() => setPage(value => value + 1)}>Next</button></div>
  </div>;
}

export default function ComparisonViewer({ initial, unsaved, revision, generating, onExit, onIterate, onChange, differencesHost, onDetails }: {
  differencesHost: HTMLDivElement | null; onDetails: (record: ComparedRecord | null) => void;
  initial: ComparisonPair; unsaved: GenerationRecord | null; revision: number; generating: boolean;
  onExit: (reference: SourceReference) => void; onIterate: (record: ComparedRecord, reference: SourceReference) => void; onChange: () => void;
}) {
  const [pair, setPair] = useState(initial);
  const [linked, setLinked] = useState(true);
  const [views, setViews] = useState<[ViewNavigation, ViewNavigation]>([fitNavigation, fitNavigation]);
  const [metrics, setMetrics] = useState<[Metrics | undefined, Metrics | undefined]>([undefined, undefined]);
  const [picker, setPicker] = useState<0 | 1 | null>(initial.b ? null : 1);
  const [differencesOnly, setDifferencesOnly] = useState(true);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const a = useComparisonImage(pair.a, unsaved, revision);
  const b = useComparisonImage(pair.b, unsaved, revision);
  const detailRecord = b.loaded?.record ?? a.loaded?.record ?? null;
  useEffect(() => { onDetails(detailRecord); }, [detailRecord, onDetails]);
  const entries = [a, b];
  const refs = [pair.a, pair.b];
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  function navigate(side: number, view: ViewNavigation) {
    setViews(old => linked ? [view, view] : side === 0 ? [view, old[1]] : [old[0], view]);
  }
  function zoom(side: number, multiplier: number) {
    const current = views[side];
    navigate(side, { ...current, actual: false, zoom: clamp((current.actual ? 1 / (metrics[side]?.fit || 1) : current.zoom) * multiplier, 0.05, 32) });
  }
  function choose(side: number, reference: SourceReference) {
    const current = side === 0 ? pair.a : pair.b;
    if (current?.generationId === reference.generationId && current.variationIndex === reference.variationIndex && !!current.unresolved === !!reference.unresolved) { setPicker(null); return; }
    setPair(old => side === 0 ? { ...old, a: reference } : { ...old, b: reference });
    setMetrics(old => side === 0 ? [undefined, old[1]] : [old[0], undefined]);
    setPicker(null);
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setError("Fullscreen is unavailable in this browser."); }
  }
  const rows = a.loaded && b.loaded ? comparisonRows(a.loaded.record, b.loaded.record, metrics[0], metrics[1]) : [];
  const differences = (<details className="comparison-differences" open><summary>Generation-setting differences</summary><div className="comparison-table-scroll"><label className="library-check"><input type="checkbox" checked={differencesOnly} onChange={event => setDifferencesOnly(event.target.checked)} /> Differences only</label><p>Saved request settings; the provider may use different effective values. Unrecorded random seeds are unknown.</p><table><thead><tr><th>Setting</th><th>A</th><th>B</th></tr></thead><tbody>{rows.filter(row => !differencesOnly || row.changed).map(row => <tr key={row.label} className={row.changed ? "is-different" : ""}><th scope="row">{row.label}</th><td>{row.a}</td><td>{row.b}</td></tr>)}</tbody></table>{!rows.length ? <p>Choose two available images to compare their settings.</p> : differencesOnly && !rows.some(row => row.changed) && <p>No saved setting differences.</p>}</div></details>);
  return <section className="result-stage comparison-stage" ref={root} aria-label="Image comparison">
    <div className="comparison-shell">
      <div className="comparison-header">
        <div className="library-actions">
          <strong>Compare A / B</strong>
          <button type="button" className="button button-quiet" aria-pressed={linked} onClick={() => {
            if (!linked) { const view = { ...views[0], actual: false, zoom: views[0].actual ? 1 / (metrics[0]?.fit || 1) : views[0].zoom }; setViews([view, view]); }
            setLinked(value => !value);
          }}>{linked ? "Unlink views" : "Link views"}</button>
          <button type="button" className="button button-quiet" onClick={() => setViews([fitNavigation, fitNavigation])}>Fit both</button>
          <button type="button" className="button button-quiet" title="Sets both panes to native resolution and unlinks navigation" onClick={() => { setLinked(false); setViews(old => [{ ...old[0], actual: true }, { ...old[1], actual: true }]); }}>Actual size</button>
          {linked && <><button type="button" className="icon-button" aria-label="Zoom both out" disabled={views[0].zoom <= 0.05} onClick={() => zoom(0, 1 / 1.25)}><ZoomOut size={16} /></button><output aria-label="Shared zoom">{views[0].zoom.toFixed(2)}× fit</output><button type="button" className="icon-button" aria-label="Zoom both in" disabled={views[0].zoom >= 32} onClick={() => zoom(0, 1.25)}><ZoomIn size={16} /></button></>}
          <button type="button" className="button button-quiet" disabled={!pair.b} onClick={() => { if (pair.b) { setPair({ a: pair.b, b: pair.a }); setViews([views[1], views[0]]); setMetrics([metrics[1], metrics[0]]); } }}><ArrowLeftRight size={14} />Swap</button>
          <button type="button" className="icon-button" aria-label={fullscreen ? "Exit comparison fullscreen" : "Fullscreen comparison"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
          <button type="button" className="button button-quiet" onClick={() => onExit(pair.b || pair.a)}>Exit comparison</button>
        </div>
        {generating && <p role="status">Generating iteration… Your source and request settings are captured.</p>}
        {error && <p className="library-error" role="alert">{error}</p>}
        {picker !== null && <ImagePicker key={picker} sameGeneration={refs[picker === 0 ? 1 : 0]} onChoose={reference => choose(picker, reference)} onClose={() => setPicker(null)} />}
      </div>
      <div className="comparison-panes">
        {entries.map((entry, side) => {
          const reference = refs[side]; const image = entry.loaded; const label = side === 0 ? "A" : "B";
          return <div className="comparison-pane" key={label} aria-label={`Comparison ${label}`}>
            <header className="comparison-pane-header"><strong>{label}</strong><span className="comparison-model">{image?.record.settings.model || "Choose image"}</span><button className="button button-quiet" type="button" onClick={() => setPicker(side as 0 | 1)}>Replace {label}</button>
              {image && reference && <>
                <label>Variation <select aria-label={`Variation ${label}`} value={reference.variationIndex} onChange={event => choose(side, { ...reference, variationIndex: Number(event.target.value) })}>{Array.from({ length: imageCount(image.record) }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
                <span className="comparison-metrics">{metrics[side]?.width ? `${metrics[side]!.width} × ${metrics[side]!.height} · ${Math.round(metrics[side]!.scale * 100)}%` : "Loading dimensions…"}</span>
                {image.record.deletedAt !== undefined && <span>In Trash</span>}
                {!linked && <><button className="icon-button" type="button" aria-label={`Zoom ${label} out`} onClick={() => zoom(side, 1 / 1.25)}><ZoomOut size={14} /></button><button className="icon-button" type="button" aria-label={`Zoom ${label} in`} onClick={() => zoom(side, 1.25)}><ZoomIn size={14} /></button></>}
                <a className="icon-button" aria-label={`Download ${label}`} href={image.url} download={`nano-studio-${reference.generationId}-${reference.variationIndex + 1}.png`}><Download size={14} /></a>
                <button className="icon-button" type="button" aria-label={`Favorite ${label}`} aria-pressed={!!image.record.favorite} disabled={image.record.id === unsaved?.id} onClick={async () => { try { await updateGenerations([image.record.id], { favorite: !image.record.favorite }); onChange(); } catch (error) { setError(errorMessage(error)); } }}><Star size={14} fill={image.record.favorite ? "currentColor" : "none"} /></button>
                <button className="button button-quiet" type="button" disabled={image.record.id === unsaved?.id} onClick={() => onIterate(image.record, reference)}>Iterate from {label}</button>
                {image.record.id === unsaved?.id && <small>Unsaved — save before iterating.</small>}
              </>}
            </header>
            {entry.error ? <p role="alert" className="comparison-empty">{entry.error}</p> : image && reference ? <ImageViewer key={`${reference.generationId}:${reference.variationIndex}`} src={image.url} alt={`${label}: ${image.record.prompt}, variation ${reference.variationIndex + 1}`} filename={`nano-studio-${reference.generationId}.png`} variation={reference.variationIndex + 1} comparison navigation={views[side]} onNavigate={view => navigate(side, view)} onMetrics={value => setMetrics(old => side === 0 ? [value, old[1]] : [old[0], value])} /> : <div className="comparison-empty">{reference ? "Loading image…" : <button type="button" className="button button-quiet" onClick={() => setPicker(side as 0 | 1)}>Choose image {label}</button>}</div>}
          </div>;
        })}
      </div>
      {fullscreen ? differences : differencesHost ? createPortal(differences, differencesHost) : null}
    </div>
  </section>;
}
