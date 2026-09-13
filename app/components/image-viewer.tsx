"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Maximize, Minimize, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { clamp, fitNavigation, scrollCenter, viewGeometry, type ImageSize, type ViewNavigation } from "@/lib/view-navigation";

type Props = {
  src: string; alt: string; filename: string; variation: number;
  navigation?: ViewNavigation; onNavigate?: (navigation: ViewNavigation) => void;
  onMetrics?: (metrics: ImageSize & { scale: number; fit: number }) => void;
  comparison?: boolean; onIterate?: () => void; iterateDisabled?: boolean;
};
export default function ImageViewer({ src, alt, filename, variation, navigation, onNavigate, onMetrics, comparison, onIterate, iterateDisabled }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<ImageSize>({ width: 0, height: 0 });
  const [size, setSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [local, setLocal] = useState<ViewNavigation>(fitNavigation);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const nav = navigation ?? local;
  const geometry = viewGeometry(size, bounds, nav);
  const expectedScroll = useRef({ left: 0, top: 0 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const metricsCallback = useRef(onMetrics);
  useEffect(() => { metricsCallback.current = onMetrics; }, [onMetrics]);
  function navigate(next: ViewNavigation) { if (onNavigate) onNavigate(next); else setLocal(next); }

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => { observer.disconnect(); document.removeEventListener("fullscreenchange", sync); };
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollLeft = geometry.left; element.scrollTop = geometry.top;
    // Ignore programmatic scroll events to avoid feedback loops between A and B.
    expectedScroll.current = { left: element.scrollLeft, top: element.scrollTop };
  }, [geometry.left, geometry.top, geometry.width, geometry.height]);
  useEffect(() => {
    metricsCallback.current?.({ ...size, scale: geometry.scale, fit: geometry.fit });
  }, [size, geometry.scale, geometry.fit]);

  async function toggleFullscreen() {
    setError("");
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { setError("Fullscreen is unavailable in this browser."); }
  }
  function zoom(factor: number) { navigate({ ...nav, actual: false, zoom: clamp((nav.actual ? 1 / geometry.fit : nav.zoom) * factor, 0.05, 32) }); }
  return (
    <div className="image-viewer" ref={root}>
      {!comparison && <div className="viewer-toolbar" role="group" aria-label={`Variation ${variation} image controls`}>
        <button type="button" className="icon-button" title="Fit to image" aria-label="Fit to image" onClick={() => navigate(fitNavigation)}><Scan size={16} /></button>
        <button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" disabled={!size.width || nav.zoom <= 0.05} onClick={() => zoom(1 / 1.25)}><ZoomOut size={16} /></button>
        <button type="button" className="zoom-readout" title="Actual size (100%)" aria-label={`Zoom ${Math.round(geometry.scale * 100)} percent. Show actual size`} disabled={!size.width} onClick={() => navigate({ ...nav, actual: true })}>{size.width ? `${Math.round(geometry.scale * 100)}%` : "—"}</button>
        <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" disabled={!size.width || nav.zoom >= 32} onClick={() => zoom(1.25)}><ZoomIn size={16} /></button>
        <button type="button" className="icon-button" title={fullscreen ? "Exit full screen (Esc)" : "Fit to screen"} aria-label={fullscreen ? "Exit full screen" : "Fit to screen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
        <a className="icon-button" href={src} download={filename} title={`Download variation ${variation}`} aria-label={`Download variation ${variation}`}><Download size={16} /></a>
        {onIterate && <button className="button button-quiet" type="button" disabled={iterateDisabled} onClick={onIterate}>Iterate from this</button>}
      </div>}
      {error && <p className="viewer-error" role="alert">{error}</p>}
      <div className="viewer-viewport" ref={viewport} tabIndex={0} role="region" aria-label={`Variation ${variation}. Drag, scroll, or use arrow keys to explore the image.`}
        onScroll={event => {
          const element = event.currentTarget;
          if (Math.abs(element.scrollLeft - expectedScroll.current.left) < 1 && Math.abs(element.scrollTop - expectedScroll.current.top) < 1) return;
          expectedScroll.current = { left: element.scrollLeft, top: element.scrollTop };
          navigate({ ...nav, ...scrollCenter(element.scrollLeft, element.scrollTop, geometry, bounds) });
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          const left = clamp(drag.current.left + drag.current.x - event.clientX, 0, Math.max(0, geometry.width - bounds.width));
          const top = clamp(drag.current.top + drag.current.y - event.clientY, 0, Math.max(0, geometry.height - bounds.height));
          navigate({ ...nav, ...scrollCenter(left, top, geometry, bounds) });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => {
          const delta: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
          if (!delta[event.key]) return;
          event.preventDefault();
          const [x, y] = delta[event.key];
          navigate({ ...nav, ...scrollCenter(clamp(geometry.left + x, 0, Math.max(0, geometry.width - bounds.width)), clamp(geometry.top + y, 0, Math.max(0, geometry.height - bounds.height)), geometry, bounds) });
        }}>
        <div className="viewer-canvas" style={{ width: size.width ? geometry.width : "100%", height: size.height ? geometry.height : "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} draggable={false} onLoad={event => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setError(""); }} onError={() => setError("This image could not be loaded.")} />
        </div>
      </div>
    </div>
  );
}
