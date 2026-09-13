"use client";

import {
  Aperture,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import BatchPanel from "./components/batch-panel";
import { appendJobs, createBatch } from "@/lib/batch-db";
import { acquireGeneration, generationBusy, mutateQueue, serverGenerationBusy, subscribeGeneration } from "@/lib/generation-coordinator";
import CivitaiControls from "./components/civitai-controls";
import { CIVITAI_RESOLUTIONS } from "@/lib/civitai";
import ComparisonViewer from "./components/comparison-viewer";
import IterationHistory from "./components/iteration-history";
import { imageCount, type ComparedRecord, type ComparisonPair } from "@/lib/comparison";
import LibraryPanel from "./components/library-panel";
import PresetControls from "./components/preset-controls";
import GenerationActions from "./components/generation-actions";
import { emptyQuery, errorMessage, getMetadata, initializeLibrary, loadGeneration, queryLibrary, saveGeneration, updateGenerations } from "@/lib/library-db";
import { requestGeneration, settingsIssues, type GenerationInput } from "@/lib/generation-client";
import PanelWorkspace from "./components/panel-workspace";
import ImageViewer from "./components/image-viewer";
import type { GenerationRecord, GenerationSettings, ImageModel, SourceReference } from "@/lib/types";

const API_KEY_STORAGE = "nano-studio-api-key";

const DEFAULT_SETTINGS: GenerationSettings = {
  model: "hidream",
  size: "1024x1024",
  n: 1,
  guidance_scale: 7.5,
  num_inference_steps: 30,
};

export default function StudioPage() {
  const [selectedBatch, setSelectedBatch] = useState("");
  const coordinatorBusy = useSyncExternalStore(subscribeGeneration, generationBusy, serverGenerationBusy);
  const manualRecoveryRelease = useRef<(() => void) | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [keyStorageError, setKeyStorageError] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsFallback, setModelsFallback] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [differencesHost, setDifferencesHost] = useState<HTMLDivElement | null>(null);
  const [comparisonRecord, setComparisonRecord] = useState<ComparedRecord | null>(null);
  const [comparison, setComparison] = useState<(ComparisonPair & { session: number }) | null>(null);
  const [draftSource, setDraftSource] = useState<SourceReference | undefined>();
  const [sourceName, setSourceName] = useState("");
  const [focusedVariation, setFocusedVariation] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [libraryStatus, setLibraryStatus] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [unsaved, setUnsaved] = useState<GenerationRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardUnsaved, setDiscardUnsaved] = useState(false);
  const [composeNotice, setComposeNotice] = useState("");
  const [requestSettings, setRequestSettings] = useState<GenerationSettings | null>(null);
  const releaseActive = useRef<(() => void) | null>(null);
  const selectionVersion = useRef(0);
  const generationLock = useRef(false);
  const [active, setActive] = useState<GenerationRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(true);

  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        setApiKey(localStorage.getItem(API_KEY_STORAGE) || "");
      } catch {
        setKeyStorageError("Browser storage is unavailable. Your key can only be used in this tab.");
      }
    });

    fetch("/api/models")
      .then((response) => response.json())
      .then((result) => {
        const nextModels = Array.isArray(result.data) && result.data.length ? result.data : [];
        if (!nextModels.some((model: ImageModel) => model.id === "custom-civitai")) nextModels.push({ id: "custom-civitai", name: "Custom CivitAI", supported_parameters: { resolutions: CIVITAI_RESOLUTIONS, max_images: 4 } });
        setModels(nextModels);
        setModelsFallback(Boolean(result.fallback));
        if (nextModels.length && !nextModels.some((model: ImageModel) => model.id === DEFAULT_SETTINGS.model)) {
          const first = nextModels[0];
          setSettings((current) => current !== DEFAULT_SETTINGS ? current : ({
            ...current,
            model: first.id,
            size: first.supported_parameters?.resolutions?.[0] || "1024x1024",
            n: first.supported_parameters?.fixed_image_count || 1,
          }));
        }
      })
      .catch(() => { setModelsFallback(true); setModels([{ id: "hidream", name: "HiDream", supported_parameters: { resolutions: ["1024x1024"], fixed_image_count: 1, max_images: 1 } }]); })
      .finally(() => setLoadingModels(false));

    let cancelled = false;
    initializeLibrary(message => { if (!cancelled) setLibraryStatus(message); })
      .then(async () => {
        if (cancelled) return;
        setHistoryReady(true); setLibraryStatus("");
        const result = await queryLibrary(emptyQuery);
        if (result.records.length && !cancelled && selectionVersion.current === 0) {
          const loaded = await loadGeneration(result.records[0].id);
          if (cancelled || selectionVersion.current !== 0) loaded.release();
          else { releaseActive.current = loaded.release; setActive(loaded.record); }
        }
      })
      .catch(error => { if (!cancelled) setLibraryError(errorMessage(error)); });
    return () => { cancelled = true; releaseActive.current?.(); releaseActive.current = null; };

  }, []);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 760px)");
    const syncDisclosure = (event: MediaQueryList | MediaQueryListEvent) => setAdvancedOpen(!event.matches);
    syncDisclosure(narrow);
    narrow.addEventListener("change", syncDisclosure);
    return () => narrow.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    if (!active) { releaseActive.current?.(); releaseActive.current = null; }
  }, [active]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === settings.model),
    [models, settings.model],
  );

  const resolutions = selectedModel?.supported_parameters?.resolutions?.length
    ? selectedModel.supported_parameters.resolutions
    : ["1024x1024"];
  const fixedCount = selectedModel?.supported_parameters?.fixed_image_count;
  const maxImages = Math.min(selectedModel?.supported_parameters?.max_images || 4, 4);
  const compatibilityIssues = loadingModels ? [] : settingsIssues(settings, models);
  const price = selectedModel?.pricing?.per_image?.[settings.size];

  function saveApiKey() {
    const key = apiKey.trim();
    if (!key) return;
    setApiKey(key);
    try {
      localStorage.setItem(API_KEY_STORAGE, key);
      setKeyStorageError("");
      setShowKey(false);
      setKeyOpen(false);
    } catch {
      setKeyStorageError("Could not save your key in this browser. You can still use it in this tab.");
    }
  }

  function forgetApiKey() {
    setApiKey("");
    setShowKey(false);
    try {
      localStorage.removeItem(API_KEY_STORAGE);
      setKeyStorageError("");
    } catch {
      setKeyStorageError("Could not remove the saved key. Clear this site's browser storage to forget it permanently.");
    }
  }

  function changeModel(modelId: string) {
    setReferenceImage(undefined);
    const model = models.find((item) => item.id === modelId);
    setSettings((current) => ({
      ...current,
      model: modelId,
      ...(modelId === "custom-civitai" ? { num_inference_steps: 20, guidance_scale: 7.5, scheduler: current.scheduler ?? "Default", strength: current.strength ?? 0.8, showExplicitContent: current.showExplicitContent ?? false } : {}),
      size: model?.supported_parameters?.resolutions?.[0] || "1024x1024",
      n: model?.supported_parameters?.fixed_image_count || Math.min(current.n, model?.supported_parameters?.max_images || 4),
    }));
  }

  function changed() {
    setRevision(value => value + 1);
    if (active && active.id !== unsaved?.id) {
      const id = active.id;
      getMetadata(id).then(info => {
        if (!info) {
          setActive(current => current?.id === id ? null : current);
        } else setActive(current => current?.id === id ? { ...current, ...info } : current);
      }).catch(error => setLibraryError(errorMessage(error)));
    }
  }

  async function selectGeneration(id: string, variationIndex: number | null = null) {
    setComparison(null); setFocusedVariation(variationIndex);
    const version = ++selectionVersion.current;
    setLibraryError("");
    try {
      const loaded = await loadGeneration(id);
      if (version !== selectionVersion.current) { loaded.release(); return; }
      releaseActive.current?.(); releaseActive.current = loaded.release;
      setActive(loaded.record);
    } catch (error) { setLibraryError(errorMessage(error)); }
  }

  function applySettings(input: GenerationInput) {
    setReferenceImage(undefined);
    setDraftSource(undefined); setSourceName("");
    setPrompt(input.prompt); setNegativePrompt(input.negativePrompt || "");
    setSettings(structuredClone(input.settings)); setError("");
    setComposeNotice("Settings restored to Compose. Review them before generating.");
  }

  function startComparison(a: SourceReference, b?: SourceReference) {
    ++selectionVersion.current;
    setComparisonRecord(null);
    releaseActive.current?.(); releaseActive.current = null;
    setActive(null);
    setComparison({ a, b, session: selectionVersion.current });
  }

  function iterateFrom(record: ComparedRecord, reference: SourceReference) {
    if (record.id === unsaved?.id) return;
    applySettings(record);
    setDraftSource({ generationId: reference.generationId, variationIndex: reference.variationIndex });
    setSourceName(record.prompt);
    document.querySelector<HTMLTextAreaElement>(".control-panel textarea")?.focus();
    setComposeNotice("Iteration prepared. Edit the settings, then press Generate image when ready.");
  }

  function exitComparison(reference: SourceReference) {
    if (reference.generationId === unsaved?.id) {
      ++selectionVersion.current; setComparison(null); setActive(unsaved); setFocusedVariation(reference.variationIndex);
    } else if (reference.unresolved) {
      setComparison(null); setLibraryError("Source unavailable.");
    } else void selectGeneration(reference.generationId, reference.variationIndex);
  }

  async function retrySave() {
    if (!unsaved) return;
    setSaving(true);
    try { await saveGeneration(unsaved); manualRecoveryRelease.current?.(); manualRecoveryRelease.current = null; setUnsaved(null); setDiscardUnsaved(false); setLibraryError(""); changed(); }
    catch (error) { setLibraryError(`Image is ready, but saving failed: ${errorMessage(error)}`); }
    finally { setSaving(false); }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (generationLock.current || unsaved || referenceLoading) return;
    setError(""); setComposeNotice("");
    if (!apiKey.trim()) { setKeyOpen(true); setError("Add your NanoGPT API key to expose this image."); return; }
    if (!prompt.trim()) { setError("Describe the image you want to create."); return; }
    const issues = settingsIssues(settings, models);
    if (issues.length) { setError(issues.join(" ")); return; }
    generationLock.current = true;
    let release: () => void;
    try { release = await acquireGeneration(); } catch (error) { generationLock.current = false; setError(errorMessage(error)); return; }
    let holdForRecovery = false;
    setGenerating(true);
    const snapshot = structuredClone({ prompt, negativePrompt, settings, source: draftSource, imageDataUrl: settings.model === "custom-civitai" ? referenceImage : undefined });
    setRequestSettings(snapshot.settings);
    try {
      const record = await requestGeneration(apiKey, snapshot);
      ++selectionVersion.current;
      releaseActive.current?.(); releaseActive.current = null;
      setActive(record); setFocusedVariation(null);
      try { await saveGeneration(record); setRevision(value => value + 1); }
      catch (error) { holdForRecovery = true; manualRecoveryRelease.current = release; setUnsaved(record); setLibraryError(`Image is ready, but saving failed: ${errorMessage(error)}`); }
      if (record.source) startComparison(record.source, { generationId: record.id, variationIndex: 0 });
      else setComparison(null);
    } catch (error) { setError(errorMessage(error)); }
    finally { if (!holdForRecovery) release(); generationLock.current = false; setGenerating(false); setRequestSettings(null); }
  }

  async function deleteGeneration(id: string) {
    try {
      await updateGenerations([id], { deletedAt: active?.deletedAt !== undefined ? undefined : Date.now() });
      changed();
    } catch (error) { setLibraryError(errorMessage(error)); }
  }

  const detailsRecord = comparison ? comparisonRecord : active;

  function startFresh() {
    setReferenceImage(undefined);
    setComposeNotice("");
    setDraftSource(undefined); setSourceName(""); setComparison(null); setFocusedVariation(null);
    ++selectionVersion.current; releaseActive.current?.(); releaseActive.current = null;
    setPrompt("");
    setNegativePrompt("");
    setActive(null);
    setError("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Nano Studio">
          <span className="brand-mark"><Aperture size={19} strokeWidth={1.8} /></span>
          <span>Nano Studio</span>
          <span className="version">Alpha 01</span>
        </div>
        <div className="top-actions">
          <button className="button button-quiet new-button" type="button" onClick={startFresh}>
            <Plus size={16} /> New exposure
          </button>
          <button
            className={`key-status ${apiKey ? "is-connected" : ""}`}
            type="button"
            onClick={() => setKeyOpen((open) => !open)}
            aria-expanded={keyOpen}
          >
            {apiKey ? <Check size={15} /> : <KeyRound size={15} />}
            {apiKey ? "Key connected" : "Connect API key"}
            <ChevronDown size={14} className={keyOpen ? "turn" : ""} />
          </button>
        </div>
      </header>

      {keyOpen && (
        <section className="key-drawer" aria-label="API key settings">
          <div>
            <h2>Connect NanoGPT</h2>
            <p>Your key is saved in this browser on this device and sent only with generation requests. It is never added to history.</p>
          </div>
          <label className="key-field">
            <span>API key</span>
            <span className="field-with-icon">
              <input
                autoFocus
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="nano_sk_••••••••••••"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" onClick={() => setShowKey((shown) => !shown)} aria-label={showKey ? "Hide API key" : "Show API key"}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            {keyStorageError && <span role="alert">{keyStorageError}</span>}
          </label>
          <div className="key-actions">
            <button className="button button-primary key-done" type="button" onClick={saveApiKey} disabled={!apiKey.trim()}>
              Save key
            </button>
            <button className="button button-quiet" type="button" onClick={forgetApiKey}>
              Forget key
            </button>
          </div>
          <button className="icon-button close-key" type="button" onClick={() => setKeyOpen(false)} aria-label="Close API key settings">
            <X size={18} />
          </button>
        </section>
      )}

      {(libraryStatus || libraryError || unsaved) && <div className="storage-banner">
        {libraryStatus && <span role="status">{libraryStatus}</span>}
        {libraryError && <span role="alert">{libraryError}</span>}
        {!historyReady && <button type="button" className="button button-quiet" onClick={async () => {
          setLibraryError("");
          try { await initializeLibrary(setLibraryStatus); setHistoryReady(true); setLibraryStatus(""); changed(); }
          catch (error) { setLibraryError(errorMessage(error)); }
        }}>Retry library</button>}
        {unsaved && <><button type="button" className="button button-quiet" disabled={saving} onClick={retrySave}>{saving ? "Saving…" : "Retry save"}</button><button type="button" className="button button-quiet" onClick={() => { ++selectionVersion.current; releaseActive.current?.(); releaseActive.current = null; setActive(unsaved); setComparison(null); setFocusedVariation(null); }}>View unsaved image</button><span>Download the image from the viewer before closing this tab.</span><button type="button" className="button button-quiet" disabled={saving} onClick={() => setDiscardUnsaved(true)}>Discard unsaved copy</button>{discardUnsaved && <span role="alert">Download it first. Discard this unsaved generation?<button type="button" className="button button-quiet" onClick={() => { setActive(current => current?.id === unsaved.id ? null : current); manualRecoveryRelease.current?.(); manualRecoveryRelease.current = null; setUnsaved(null); setComparison(null); setDiscardUnsaved(false); setLibraryError(""); }}>Confirm discard</button><button type="button" className="button button-quiet" onClick={() => setDiscardUnsaved(false)}>Keep image</button></span>}</>}
      </div>}
      <PanelWorkspace>
        <LibraryPanel ready={historyReady} revision={revision} activeId={active?.id} onOpen={selectGeneration} onChange={changed} onCompare={(a, b) => startComparison({ generationId: a, variationIndex: 0 }, { generationId: b, variationIndex: 0 })} />

        {comparison ? <ComparisonViewer key={comparison.session} initial={comparison} differencesHost={differencesHost} onDetails={setComparisonRecord} unsaved={unsaved} revision={revision} generating={generating} onExit={exitComparison} onIterate={iterateFrom} onChange={changed} /> : <section className={`result-stage ${generating ? "is-generating" : ""}`} aria-live="polite" aria-busy={generating}>
          <div className="stage-toolbar">
            <div className="stage-state">
              <span className={`state-dot ${generating ? "live" : active ? "ready" : ""}`} />
              <span>{generating ? "Exposing image" : active ? "Exposure ready" : "Ready for input"}</span>
            </div>
            {active && !generating && (
              <div className="stage-actions">
                <button className="button button-quiet" type="button" onClick={() => startComparison({ generationId: active.id, variationIndex: focusedVariation ?? 0 })}>Compare</button>
                {focusedVariation !== null && <button className="button button-quiet" type="button" onClick={() => setFocusedVariation(null)}>All variations</button>}
                <button className="icon-button danger-hover" type="button" disabled={active.id === unsaved?.id} onClick={() => deleteGeneration(active.id)} aria-label={active.deletedAt !== undefined ? "Restore current generation" : "Move current generation to Trash"} title={active.deletedAt !== undefined ? "Restore from Trash" : "Move to Trash"}>
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="image-bay">
            <span className="calibration top-left" /><span className="calibration top-right" />
            <span className="calibration bottom-left" /><span className="calibration bottom-right" />
            {generating ? (
              <div className="exposing-state">
                <div className="aperture-loader"><Aperture size={46} strokeWidth={1} /></div>
                <strong>Developing your frame</strong>
                <span>{requestSettings?.model || settings.model} · {requestSettings?.size || settings.size}</span>
                <div className="scan-line" />
              </div>
            ) : active ? (
              <div className={`result-grid count-${focusedVariation === null ? Math.min(active.images.length, 4) : 1}`}>
                {active.images.map((image, index) => (focusedVariation === null || focusedVariation === index) && (
                  <ImageViewer
                    key={`${active.id}-${index}`}
                    src={image}
                    alt={`${active.prompt}, variation ${index + 1}`}
                    filename={`nano-studio-${active.id}-${index + 1}.png`}
                    variation={index + 1}
                    onIterate={() => iterateFrom(active, { generationId: active.id, variationIndex: index })}
                    iterateDisabled={active.id === unsaved?.id}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-stage">
                <div className="lens-guide" aria-hidden="true"><span /><span /><span /></div>
                <h1>Bring an image into focus.</h1>
                <p>Write a prompt, calibrate the model, then expose your first frame.</p>
              </div>
            )}
          </div>

          <footer className="stage-footer">
            <span>{active ? active.settings.model : settings.model}</span>
            <span>{active ? active.settings.size : settings.size}</span>
            {active && <span>Cost {active.cost !== undefined ? `$${active.cost.toFixed(4)}` : "unavailable"}</span>}
            {active && <span className="balance">Balance {active.remainingBalance !== undefined ? `$${active.remainingBalance.toFixed(2)}` : "unavailable"}</span>}

          </footer>
        </section>}

        <form className="control-panel" onSubmit={generate}>
          <div className="panel-heading">
            <div>
              <h2>Compose</h2>
              <p>Describe the frame and tune its exposure.</p>
            </div>
          </div>

          {draftSource && <div className="iteration-draft" role="status"><strong>Iterating from…</strong><button className="button button-quiet" type="button" onClick={() => selectGeneration(draftSource.generationId, draftSource.variationIndex)}>{sourceName} · variation {draftSource.variationIndex + 1}</button><button className="button button-quiet" type="button" onClick={() => { setDraftSource(undefined); setSourceName(""); }}>Remove source</button></div>}
          <PresetControls input={{ prompt, negativePrompt, settings }} onApply={applySettings} revision={revision} onChange={changed} />
          {composeNotice && <p role="status" className="field-note">{composeNotice}</p>}
          {!!compatibilityIssues.length && <div className="compatibility-notice" role="alert"><strong>Review restored settings</strong><ul>{compatibilityIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
          <label className="prompt-field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A quiet coastal road after rain, photographed through a car window…"
              rows={6}
              maxLength={4000}
            />
            <small>{prompt.length.toLocaleString()} / 4,000</small>
          </label>

          <label className="field">
            <span>Model</span>
            <span className="select-wrap">
              <select value={settings.model} onChange={(event) => changeModel(event.target.value)} disabled={loadingModels}>
                {!loadingModels && !selectedModel && <option value={settings.model}>{settings.model} (unavailable)</option>}
                {loadingModels ? <option>Loading image models…</option> : models.map((model) => <option value={model.id} key={model.id}>{model.name || model.id}</option>)}
              </select>
              <ChevronDown size={15} />
            </span>
            {modelsFallback && <small className="field-note warning">Live model catalog unavailable; using the documented default.</small>}
          </label>

          {settings.model === "custom-civitai" && <CivitaiControls settings={settings} onChange={setSettings} image={referenceImage} onImage={setReferenceImage} onLoading={setReferenceLoading} />}

          <div className="field-row">
            <label className="field">
              <span>Resolution</span>
              <span className="select-wrap">
                <select value={settings.size} onChange={(event) => setSettings({ ...settings, size: event.target.value })}>
                  {!resolutions.includes(settings.size) && <option value={settings.size}>{settings.size} (unsupported)</option>}
                  {resolutions.map((size) => <option key={size}>{size}</option>)}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
            <label className="field">
              <span>Images</span>
              <span className="select-wrap">
                <select
                  value={settings.n}
                  onChange={(event) => setSettings({ ...settings, n: Number(event.target.value) })}
                  disabled={Boolean(fixedCount) && settings.n === fixedCount}
                >
                  {(settings.n < 1 || settings.n > maxImages || (fixedCount && settings.n !== fixedCount)) && <option value={settings.n}>{settings.n} (unsupported)</option>}
                  {Array.from({ length: fixedCount || maxImages }, (_, index) => fixedCount || index + 1).filter((value, index, array) => array.indexOf(value) === index).map((value) => <option key={value}>{value}</option>)}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
          </div>

          <details className="advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary><SlidersHorizontal size={15} /> Fine controls <ChevronDown size={15} /></summary>
            <div className="advanced-fields">
              <label className="prompt-field compact">
                <span>Negative prompt</span>
                <textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="Artifacts, text, oversaturation…" rows={2} />
              </label>
              <label className="range-field">
                <span><span>Guidance</span><output>{settings.guidance_scale.toFixed(1)}</output></span>
                <input type="range" min={settings.model === "custom-civitai" ? "1" : "0"} max={settings.model === "custom-civitai" ? "15" : "20"} step="0.5" value={settings.guidance_scale} onChange={(event) => setSettings({ ...settings, guidance_scale: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><span>Inference steps</span><output>{settings.num_inference_steps}</output></span>
                <input type="range" min="1" max={settings.model === "custom-civitai" ? "60" : "100"} value={settings.num_inference_steps} onChange={(event) => setSettings({ ...settings, num_inference_steps: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Seed</span>
                <span className="seed-field">
                  <input
                    type="number"
                    placeholder="Random"
                    value={settings.seed ?? ""}
                    onChange={(event) => setSettings({ ...settings, seed: event.target.value === "" ? undefined : Number(event.target.value) })}
                  />
                  <button type="button" onClick={() => setSettings({ ...settings, seed: Math.floor(Math.random() * 2_147_483_647) })} aria-label="Generate random seed"><RefreshCw size={15} /></button>
                </span>
              </label>
            </div>
          </details>

          {error && <div className="error-message" role="alert"><Zap size={16} /><span>{error}</span></div>}

          <div className="generate-wrap">
            <div className="estimate">
              <span>{price !== undefined ? `Est. $${(price * settings.n).toFixed(3)}` : "Price shown by model when available"}</span>
              <span>{settings.n} frame{settings.n === 1 ? "" : "s"}</span>
            </div>
            <button className="button button-quiet" type="button" disabled={coordinatorBusy || referenceLoading || !prompt.trim() || !!compatibilityIssues.length || !!unsaved} onClick={async () => {
              try { await mutateQueue(async () => { const id = selectedBatch || (await createBatch("New batch")).id; await appendJobs(id, [{ prompt, negativePrompt, settings, source: draftSource, imageDataUrl: settings.model === "custom-civitai" ? referenceImage : undefined }]); setSelectedBatch(id); setComposeNotice("Draft added to batch. No generation request was made."); }); changed(); } catch (error) { setError(errorMessage(error)); }
            }}>Add to batch</button>
            <button className="button button-primary generate-button" type="submit" disabled={coordinatorBusy || generating || referenceLoading || loadingModels || !prompt.trim() || !!compatibilityIssues.length || !!unsaved}>
              {generating ? <><span className="button-loader" /> Exposing…</> : <><Aperture size={18} /> Generate image</>}
            </button>
          </div>
        </form>
        <section className="metadata-panel generation-details" aria-label="Generation details">
          {comparison && detailsRecord && <p className="field-note">Showing comparison B (A while B is empty).</p>}
          {detailsRecord ? (
                <div className="generation-details-content" tabIndex={0} role="region" aria-label="Saved generation details">
                  <GenerationActions key={`${detailsRecord.id}-${JSON.stringify(detailsRecord.tags)}-${detailsRecord.favorite}`} record={detailsRecord} saved={detailsRecord.id !== unsaved?.id} onApply={() => applySettings(detailsRecord)} onChange={changed} />
                  {detailsRecord.deletedAt !== undefined && <p>This generation is in Trash. Restore it from the Library panel.</p>}
                  <IterationHistory key={detailsRecord.id} record={detailsRecord} revision={revision} onOpen={reference => selectGeneration(reference.generationId, reference.variationIndex)} />
                  <dl>
                    <div className="generation-detail-wide"><dt>Prompt</dt><dd>{detailsRecord.prompt}</dd></div>
                    <div className="generation-detail-wide"><dt>Negative prompt</dt><dd>{detailsRecord.negativePrompt || "None"}</dd></div>
                    <div className="generation-detail-wide"><dt>Model</dt><dd>{detailsRecord.settings.model}</dd></div>
                    <div><dt>Requested size / aspect ratio</dt><dd>{detailsRecord.settings.size}</dd></div>
                    <div><dt>Images</dt><dd>{imageCount(detailsRecord)} returned / {detailsRecord.settings.n} requested</dd></div>
                    {detailsRecord.settings.model === "custom-civitai" && <>
                      <div className="generation-detail-wide"><dt>CivitAI checkpoint</dt><dd>{detailsRecord.settings.customCivitaiAir || "Not recorded"}</dd></div>
                      <div><dt>Scheduler</dt><dd>{detailsRecord.settings.scheduler ?? "Default"}</dd></div>
                      <div><dt>Strength</dt><dd>{detailsRecord.settings.strength ?? "Not recorded"}</dd></div>
                      <div><dt>Explicit content</dt><dd>{detailsRecord.settings.showExplicitContent === undefined ? "Not recorded" : detailsRecord.settings.showExplicitContent ? "Allowed" : "Off"}</dd></div>
                    </>}
                    <div><dt>Seed</dt><dd>{detailsRecord.settings.seed ?? "Random — actual seed not recorded"}</dd></div>
                    <div><dt>Inference steps</dt><dd>{detailsRecord.settings.num_inference_steps ?? "Not recorded"}</dd></div>
                    <div><dt>Guidance scale</dt><dd>{detailsRecord.settings.guidance_scale ?? "Not recorded"}</dd></div>
                    <div><dt>Saved at</dt><dd><time dateTime={new Date(detailsRecord.createdAt).toISOString()}>{new Date(detailsRecord.createdAt).toLocaleString()}</time></dd></div>
                    <div><dt>Generation cost</dt><dd>{detailsRecord.cost !== undefined ? `$${detailsRecord.cost.toFixed(4)}` : "Unavailable"}</dd></div>
                    <div><dt>Balance after generation</dt><dd>{detailsRecord.remainingBalance !== undefined ? `$${detailsRecord.remainingBalance.toFixed(2)}` : "Unavailable"}</dd></div>
                    <div className="generation-detail-wide"><dt>Generation ID</dt><dd>{detailsRecord.id}</dd></div>
                  </dl>
                  <p>Settings show the saved request. The model may use its own defaults for unsupported parameters.</p>
                </div>
          ) : <p>Select a generation to see its saved settings and iteration history.</p>}
        </section>
        <section className="metadata-panel differences-panel" aria-label="Generation-setting differences">
          {!comparison && <p>Compare two images to see their saved setting differences.</p>}
          <div ref={setDifferencesHost} />
        </section>
        <BatchPanel selected={selectedBatch} onSelect={setSelectedBatch} input={{ prompt, negativePrompt, settings, source: draftSource, imageDataUrl: settings.model === "custom-civitai" ? referenceImage : undefined }} apiKey={apiKey} models={models} revision={revision} onChange={changed} onOpen={selectGeneration} onCompare={startComparison} />
      </PanelWorkspace>
    </main>
  );
}
