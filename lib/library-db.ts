import type { BatchJob } from "./batch-types";
import type { GenerationMetadata, GenerationRecord, PromptPreset, SourceReference } from "./types";

import { normalizeRasterBlob } from "./raster";

const DB = "nano-studio";
const META = "metadata";
const IMAGES = "images";
const THUMBS = "thumbnails";
const PRESETS = "presets";
const LEGACY = "generations";
export type StoredImage = { id: string; generationId: string; index: number; blob?: Blob; url?: string };
export type LibraryQuery = { search: string; favorite: boolean; tags: string[]; model: string; trash: boolean; oldest: boolean };
export const emptyQuery: LibraryQuery = { search: "", favorite: false, tags: [], model: "", trash: false, oldest: false };
export const normalizeTags = (text: string) => [...new Set(text.split(",").map(tag => tag.trim().toLowerCase()).filter(Boolean))];
export const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.name === "QuotaExceededError") return "Browser storage is full. Export a backup, then permanently delete unwanted items from Trash and retry.";
  return error instanceof Error && error.message ? error.message : "Browser storage is unavailable or the operation was interrupted. Try again or download your unsaved image.";
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 4);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("batches")) db.createObjectStore("batches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("batchJobs")) {
        const jobs = db.createObjectStore("batchJobs", { keyPath: "id" });
        jobs.createIndex("batchId", "batchId"); jobs.createIndex("batchOrder", ["batchId", "order"]);
      }
      if (!db.objectStoreNames.contains("batchReferences")) db.createObjectStore("batchReferences", { keyPath: "id" }).createIndex("batchId", "batchId");
      if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) {
        const store = db.createObjectStore(META, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      const meta = request.transaction!.objectStore(META);
      if (!meta.indexNames.contains("sourceGenerationId")) meta.createIndex("sourceGenerationId", "source.generationId");
      if (!db.objectStoreNames.contains(IMAGES)) {
        const store = db.createObjectStore(IMAGES, { keyPath: "id" });
        store.createIndex("generationId", "generationId");
      }
      for (const name of [THUMBS, PRESETS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Close other Nano Studio tabs, then retry the library upgrade.")); };
  });
}

export async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let failure: unknown;
    const fail = (error: unknown) => { failure = error; tx.abort(); };
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = () => { db.close(); reject(failure || tx.error || new Error("Storage write was interrupted. Please retry.")); };
    tx.onerror = () => { /* onabort reports the transaction failure. */ };
    try { run(tx, next => { value = next; }, fail); } catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
function get<T>(store: string, id: string): Promise<T | undefined> {
  return transaction([store], "readonly", (tx, result) => { tx.objectStore(store).get(id).onsuccess = event => result((event.target as IDBRequest).result); });
}

export function metadata(record: GenerationRecord): GenerationMetadata {
  return { source: record.source, id: record.id, createdAt: record.createdAt, prompt: record.prompt, negativePrompt: record.negativePrompt,
    settings: { ...record.settings }, imageCount: record.images.length, favorite: record.favorite, tags: record.tags,
    deletedAt: record.deletedAt, cost: record.cost, remainingBalance: record.remainingBalance };
}

async function storeImage(source: string, id: string, index: number): Promise<StoredImage> {
  if (!source.startsWith("data:")) return { id: `${id}:${index}`, generationId: id, index, url: source };
  const response = await fetch(source);
  return { id: `${id}:${index}`, generationId: id, index, blob: await normalizeRasterBlob(await response.blob()) };
}
async function thumbnail(image: StoredImage): Promise<Blob | undefined> {
  if (!image.blob || typeof createImageBitmap === "undefined") return undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(image.blob);
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || undefined), "image/webp", 0.75));
  } catch { return undefined; } finally { bitmap?.close(); }
}

export async function saveGeneration(record: GenerationRecord, migrating = false, batchJob?: BatchJob) {
  const images = await Promise.all(record.images.map((source, index) => storeImage(source, record.id, index)));
  const thumb = await thumbnail(images[0]);
  await transaction<void>([META, IMAGES, THUMBS, LEGACY, ...(batchJob ? ["batchJobs"] : [])], "readwrite", (tx, done, fail) => {
    const write = () => {
      tx.objectStore(META).put(metadata(record));
      if (batchJob) tx.objectStore("batchJobs").put({ ...batchJob, status: "succeeded", finishedAt: Date.now(), returnedImages: record.images.length, cost: record.cost, resultId: record.id, error: undefined });
      images.forEach(image => tx.objectStore(IMAGES).put(image));
      if (thumb) tx.objectStore(THUMBS).put({ id: record.id, blob: thumb });
      tx.objectStore(LEGACY).delete(record.id);
      done();
    };
    if (migrating) {
      tx.objectStore(META).get(record.id).onsuccess = event => {
        if ((event.target as IDBRequest).result) { tx.objectStore(LEGACY).delete(record.id); done(); }
        else { try { write(); } catch (error) { fail(error); } }
      };
    } else write();
  });
}

let initializing: Promise<void> | undefined;
export function initializeLibrary(progress?: (message: string) => void) {
  if (initializing) return initializing;
  initializing = (async () => {
    let count = 0;
    while (true) {
      const record = await transaction<GenerationRecord | undefined>([LEGACY], "readonly", (tx, done) => {
        tx.objectStore(LEGACY).openCursor().onsuccess = event => done((event.target as IDBRequest<IDBCursorWithValue | null>).result?.value);
      });
      if (!record) break;
      progress?.(`Upgrading saved generation ${++count}…`);
      // Each record is committed atomically before its legacy copy is removed.
      await saveGeneration(record, true);
    }
  })().finally(() => { initializing = undefined; });
  return initializing;
}

export async function queryLibrary(query: LibraryQuery, offset = 0) {
  return transaction<{ records: GenerationMetadata[]; total: number; tags: string[]; models: string[] }>([META], "readonly", (tx, done) => {
    const records: GenerationMetadata[] = [], tags = new Set<string>(), models = new Set<string>();
    let total = 0;
    tx.objectStore(META).index("createdAt").openCursor(null, query.oldest ? "next" : "prev").onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) { done({ records, total, tags: [...tags].sort(), models: [...models].sort() }); return; }
      const record = cursor.value as GenerationMetadata;
      if ((record.deletedAt !== undefined) === query.trash) {
        record.tags?.forEach(tag => tags.add(tag)); models.add(record.settings.model);
        if ((!query.favorite || record.favorite) && (!query.model || record.settings.model === query.model) &&
          query.tags.every(tag => record.tags?.includes(tag)) &&
          `${record.prompt}\n${record.negativePrompt || ""}`.toLowerCase().includes(query.search.toLowerCase())) {
          if (total >= offset && records.length < 40) records.push(record);
          total++;
        }
      }
      cursor.continue();
    };
  });
}

export const getMetadata = (id: string) => get<GenerationMetadata>(META, id);
export const getThumbnail = (id: string) => get<{ id: string; blob: Blob }>(THUMBS, id);
export async function getImages(id: string): Promise<StoredImage[]> {
  return transaction([IMAGES], "readonly", (tx, done) => {
    tx.objectStore(IMAGES).index("generationId").getAll(id).onsuccess = event => done(((event.target as IDBRequest).result as StoredImage[]).sort((a, b) => a.index - b.index));
  });
}
export async function loadGeneration(id: string): Promise<{ record: GenerationRecord; release: () => void }> {
  const info = await getMetadata(id);
  if (!info) throw new Error("This generation is no longer in the library.");
  const stored = await getImages(id);
  if (stored.length !== info.imageCount) throw new Error("Some images are missing. Restore this generation from a backup.");
  const urls: string[] = [];
  const images = stored.map(image => {
    if (image.blob) { const url = URL.createObjectURL(image.blob); urls.push(url); return url; }
    return image.url || "";
  });
  return { record: { ...info, images }, release: () => urls.forEach(url => URL.revokeObjectURL(url)) };
}
export async function updateGenerations(ids: string[], patch: Partial<Pick<GenerationMetadata, "favorite" | "tags" | "deletedAt">>, appendTags = false) {
  await transaction<void>([META], "readwrite", (tx, done) => {
    const store = tx.objectStore(META);
    ids.forEach(id => { store.get(id).onsuccess = event => {
      const old = (event.target as IDBRequest).result as GenerationMetadata | undefined;
      if (old) store.put({ ...old, ...patch, ...(appendTags ? { tags: [...new Set([...(old.tags || []), ...(patch.tags || [])])] } : {}) });
    }; }); done();
  });
}
export async function permanentlyDelete(ids: string[]) {
  await transaction<void>([META, IMAGES, THUMBS], "readwrite", (tx, done) => {
    ids.forEach(id => { tx.objectStore(META).get(id).onsuccess = event => {
      const record = (event.target as IDBRequest).result as GenerationMetadata | undefined;
      if (!record || record.deletedAt === undefined) return;
      tx.objectStore(META).delete(id); tx.objectStore(THUMBS).delete(id);
      tx.objectStore(IMAGES).index("generationId").openCursor(id).onsuccess = event => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
    }; }); done();
  });
}
export const listPresets = () => transaction<PromptPreset[]>([PRESETS], "readonly", (tx, done) => {
  tx.objectStore(PRESETS).getAll().onsuccess = event => done((event.target as IDBRequest).result);
});
export const savePreset = (preset: PromptPreset) => transaction<void>([PRESETS], "readwrite", (tx, done) => { tx.objectStore(PRESETS).put(preset); done(); });
export const deletePreset = (id: string) => transaction<void>([PRESETS], "readwrite", (tx, done) => { tx.objectStore(PRESETS).delete(id); done(); });
export const allGenerationIds = () => transaction<string[]>([META], "readonly", (tx, done) => { tx.objectStore(META).getAllKeys().onsuccess = event => done((event.target as IDBRequest).result); });


/** Read only the selected variation, never the rest of its generation. */
export async function loadImage(reference: SourceReference) {
  if (reference.unresolved) throw new Error("Source unavailable. Its original generation was not included in the import.");
  const info = await getMetadata(reference.generationId);
  if (!info) throw new Error("Source unavailable. This generation may have been permanently deleted.");
  if (!Number.isInteger(reference.variationIndex) || reference.variationIndex < 0 || reference.variationIndex >= info.imageCount) throw new Error("This variation is unavailable.");
  const image = await get<StoredImage>(IMAGES, `${reference.generationId}:${reference.variationIndex}`);
  if (!image || (!image.blob && !image.url)) throw new Error("This image is missing. Restore it from a backup.");
  const url = image.blob ? URL.createObjectURL(image.blob) : image.url!;
  return { record: info, url, release: () => { if (image.blob) URL.revokeObjectURL(url); } };
}

export async function directIterations(id: string, offset = 0) {
  return transaction<{ records: GenerationMetadata[]; total: number }>([META], "readonly", (tx, done) => {
    const records: GenerationMetadata[] = [];
    let total = 0;
    tx.objectStore(META).index("sourceGenerationId").openCursor(id).onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) { done({ records, total }); return; }
      const record = cursor.value as GenerationMetadata;
      if (!record.source?.unresolved) {
        if (total >= offset && records.length < 10) records.push(record);
        total++;
      }
      cursor.continue();
    };
  });
}
