"use client";
import { useEffect, useRef, useState } from 'react';
import { normalizeCivitaiAir } from '@/lib/civitai';
import type { GenerationSettings } from '@/lib/types';

export default function CivitaiControls({ settings, onChange, image, onImage, onLoading }: { settings: GenerationSettings; onChange: (settings: GenerationSettings) => void; image: string | undefined; onImage: (image: string | undefined) => void; onLoading: (loading: boolean) => void }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLoading(false); }; }, [onLoading]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  return <fieldset className="civitai-controls"><legend>Custom CivitAI</legend>
    <label className="field"><span>Checkpoint AIR or version URL</span><input value={settings.customCivitaiAir || ''} placeholder="civitai:1025051@1476374" onChange={event => onChange({ ...settings, customCivitaiAir: event.target.value })} onBlur={() => { const air = normalizeCivitaiAir(settings.customCivitaiAir || ''); if (air) onChange({ ...settings, customCivitaiAir: air }); }} /></label>
    <p className="field-note">Use an exact checkpoint version, such as civitai:1025051@1476374, or a CivitAI URL containing modelVersionId. A model ID alone does not identify a version. Availability is determined by NanoGPT when you generate.</p>
    <label className="field"><span>Scheduler</span><input value={settings.scheduler ?? 'Default'} placeholder="Default" maxLength={100} onChange={event => onChange({ ...settings, scheduler: event.target.value || 'Default' })} /></label>
    <label className="library-check"><input type="checkbox" checked={settings.showExplicitContent ?? false} onChange={event => onChange({ ...settings, showExplicitContent: event.target.checked })} /> Allow explicit content</label>
    <label className="field"><span>Reference image (optional)</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={loading} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setError(''); setLoading(true); onLoading(true);
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 30 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP no larger than 30 MB.');
        const bitmap = await createImageBitmap(file);
        const valid = bitmap.width >= 8 && bitmap.height >= 8 && bitmap.width <= 16384 && bitmap.height <= 16384;
        bitmap.close(); if (!valid) throw new Error('Reference dimensions must be 8–16,384 pixels.');
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); });
        if (mounted.current) onImage(data);
      } catch (error) { setError((error as Error).message); } finally { if (mounted.current) { setLoading(false); onLoading(false); } }
    }} /></label>
    {loading && <p role="status">Reading reference…</p>}
    {image && <div><span className="field-note">Reference image attached.</span><button className="button button-quiet" type="button" onClick={() => onImage(undefined)}>Remove reference</button></div>}
    <label className="field"><span>Strength {settings.strength ?? 0.8}</span><input aria-label="Reference strength" type="range" min="0.1" max="1" step="0.05" value={settings.strength ?? 0.8} onChange={event => onChange({ ...settings, strength: Number(event.target.value) })} /></label>
    <p className="field-note">Strength applies only with a reference image. References stay in this draft and are not saved in presets or backups; attach them again when reusing settings.</p>
    {error && <p role="alert" className="library-error">{error}</p>}
  </fieldset>;
}
