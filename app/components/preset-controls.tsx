"use client";
import { customCivitaiPayload } from "@/lib/civitai";
import { useEffect, useState } from "react";
import { deletePreset, errorMessage, listPresets, savePreset } from "@/lib/library-db";
import type { GenerationInput } from "@/lib/generation-client";
import type { PromptPreset } from "@/lib/types";

export default function PresetControls({ input, onApply, revision, onChange }: { input: GenerationInput; onApply: (input: GenerationInput) => void; revision: number; onChange: () => void }) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listPresets().then(values => { if (!cancelled) setPresets(values.sort((a, b) => a.name.localeCompare(b.name))); }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [revision]);
  async function action(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); onChange(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const preset = presets.find(item => item.id === selected);
  return <details className="preset-controls"><summary>Prompt presets</summary>
    <label className="field"><span>Saved presets</span><select value={selected} onChange={event => { setSelected(event.target.value); setName(presets.find(item => item.id === event.target.value)?.name || ""); }}><option value="">Choose a preset</option>{presets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="field"><span>Preset name</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Evening portraits" /></label>
    <div className="library-actions">
      <button className="button button-quiet" type="button" disabled={!preset || busy} onClick={() => preset && onApply(preset)}>Apply preset</button>
      <button className="button button-quiet" type="button" disabled={!name.trim() || !input.prompt.trim() || busy} onClick={() => action(async () => { if (input.settings.model === "custom-civitai") customCivitaiPayload(input); const id = crypto.randomUUID(); await savePreset({ ...structuredClone(input), id, name: name.trim(), createdAt: Date.now() }); setSelected(id); })}>Save current as new</button>
      <button className="button button-quiet" type="button" disabled={!preset || !name.trim() || busy} onClick={() => action(async () => { if (preset) await savePreset({ ...preset, name: name.trim() }); })}>Rename</button>
      <button className="button button-quiet" type="button" disabled={!preset || busy} onClick={() => action(async () => { if (preset) await deletePreset(preset.id); setSelected(""); setName(""); })}>Delete preset</button>
    </div>
    {error && <p role="alert" className="library-error">{error}</p>}
  </details>;
}
