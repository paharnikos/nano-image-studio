"use client";
import { useState } from "react";
import { errorMessage, normalizeTags, updateGenerations } from "@/lib/library-db";
import type { ComparedRecord } from "@/lib/comparison";
export default function GenerationActions({ record, onApply, onChange, saved }: { record: ComparedRecord; onApply: () => void; onChange: () => void; saved: boolean }) {
  const [tags, setTags] = useState(record.tags?.join(", ") || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function patch(value: { tags?: string[]; favorite?: boolean }) {
    setBusy(true); setError("");
    try { await updateGenerations([record.id], value); onChange(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <div className="generation-actions">
    <div className="library-actions"><button type="button" className="button button-quiet" onClick={onApply}>Use settings</button><button type="button" className="button button-quiet" aria-pressed={!!record.favorite} disabled={!saved || busy} onClick={() => patch({ favorite: !record.favorite })}>{record.favorite ? "Remove favorite" : "Favorite"}</button></div>
    <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="portrait, evening" disabled={!saved} /></label><button type="button" className="button button-quiet" disabled={!saved || busy} onClick={() => patch({ tags: normalizeTags(tags) })}>Save tags</button>
    {!saved && <small>Save this generation before organizing it.</small>}
    {error && <p className="library-error" role="alert">{error}</p>}
  </div>;
}
