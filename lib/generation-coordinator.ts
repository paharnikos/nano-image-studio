const LOCK = 'nano-studio-generation';
let busy = false;
const listeners = new Set<() => void>();
export const subscribeGeneration = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const generationBusy = () => busy;
export const serverGenerationBusy = () => false;
export const supportsBatchLocks = () => typeof navigator !== 'undefined' && !!navigator.locks;
export async function acquireGeneration(requireLocks = false): Promise<() => void> {
  if (busy) throw new Error('Another generation or unsaved result needs attention first.');
  if (!supportsBatchLocks()) {
    if (requireLocks) throw new Error('Batch execution requires Web Locks. Open the app on localhost or HTTPS in a supported browser.');
    busy = true; listeners.forEach(fn => fn());
    return () => { busy = false; listeners.forEach(fn => fn()); };
  }
  return new Promise((resolve, reject) => {
    navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('Another tab is generating or managing the queue. Try again after it finishes.')); return; }
      busy = true; listeners.forEach(fn => fn());
      await new Promise<void>(done => resolve(() => { busy = false; listeners.forEach(fn => fn()); done(); }));
    }).catch(reject);
  });
}
export async function mutateQueue<T>(action: () => Promise<T>): Promise<T> {
  const release = await acquireGeneration(true);
  try { return await action(); } finally { release(); }
}
