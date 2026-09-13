"use client";
import type { ComparedRecord } from "@/lib/comparison";
import { useEffect, useState } from "react";
import { directIterations, errorMessage, getMetadata } from "@/lib/library-db";
import type { GenerationMetadata, SourceReference } from "@/lib/types";

export default function IterationHistory({ record, revision, onOpen }: { record: ComparedRecord; revision: number; onOpen: (reference: SourceReference) => void }) {
  const [parent, setParent] = useState<GenerationMetadata | null>(null);
  const [children, setChildren] = useState<GenerationMetadata[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      record.source && !record.source.unresolved ? getMetadata(record.source.generationId) : Promise.resolve(undefined),
      directIterations(record.id, page * 10),
    ]).then(([parent, result]) => {
      if (cancelled) return;
      setParent(parent || null); setChildren(result.records); setTotal(result.total); setError("");
      if (page && !result.records.length) setPage(Math.max(0, Math.ceil(result.total / 10) - 1));
    }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [record.id, record.source, page, revision]);
  return <div className="iteration-history">
    <strong>Iteration history</strong>
    {record.source ? parent && record.source.variationIndex < parent.imageCount ? <button className="button button-quiet" type="button" onClick={() => onOpen(record.source!)}>Source: {parent.prompt} · variation {record.source.variationIndex + 1}{parent.deletedAt !== undefined ? " · In Trash" : ""}</button> : <p>Source unavailable{record.source.unresolved ? " — not resolved by this backup" : ""}.</p> : <p>Independent generation.</p>}
    <span>{total} direct iteration{total === 1 ? "" : "s"}</span>
    {children.map(child => <button className="button button-quiet" type="button" key={child.id} onClick={() => onOpen({ generationId: child.id, variationIndex: 0 })}>{child.prompt}{child.deletedAt !== undefined ? " · In Trash" : ""}</button>)}
    {total > 10 && <div className="library-pagination"><button className="button button-quiet" type="button" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous iterations</button><span>{page + 1} / {Math.ceil(total / 10)}</span><button className="button button-quiet" type="button" disabled={(page + 1) * 10 >= total} onClick={() => setPage(value => value + 1)}>Next iterations</button></div>}
    {error && <p className="library-error" role="alert">{error}</p>}
  </div>;
}
