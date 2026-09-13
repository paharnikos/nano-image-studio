"use client";

import { Children, type ReactNode, useEffect, useRef, useState } from "react";
import { Grip, GripVertical, RotateCcw, LayoutGrid, Magnet } from "lucide-react";

import { adjustPanel, autoLayout, panelMinimums as minimums, type PanelBox as Box } from "@/lib/panel-layout";
const KEY = "nano-studio-panel-layout-v1";
const names = ["Library", "Image viewer", "Compose", "Generation details", "Generation-setting differences", "Batch queue"];

export default function PanelWorkspace({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1100, height: 700 });
  const [saved, setSaved] = useState<Box[] | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [front, setFront] = useState(1);
  const [notice, setNotice] = useState("");
  const gesture = useRef<{ index: number; mode: "move" | "resize"; x: number; y: number; box: Box } | null>(null);
  const defaults = autoLayout(bounds.width, bounds.height);
  const boxes = saved ?? defaults;
  const latest = useRef(boxes);
  useEffect(() => { latest.current = boxes; }, [boxes]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: Math.max(340, entry.contentRect.width), height: Math.max(540, entry.contentRect.height - 48) });
    });
    if (host.current) observer.observe(host.current);
    Promise.resolve().then(() => {
      try {
        const value = JSON.parse(localStorage.getItem(KEY) || "null");
        if (Array.isArray(value) && (value.length === 3 || value.length === 5 || value.length === names.length) && value.every((box, index) =>
          box && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
          box.x >= 0 && box.x <= 3000 && box.y >= 0 && box.y <= 10000 &&
          box.width >= minimums[index] && box.width <= 2000 && box.height >= 320 && box.height <= 2000)) {
          if (value.length === 3) {
            const bottom = Math.max(...value.map(box => box.y + box.height)) + 8;
            value.push({ x: 0, y: bottom, width: 480, height: 440 }, { x: 488, y: bottom, width: 540, height: 440 });
          }
          if (value.length === 5) value.push({ x: 0, y: Math.max(...value.map(box => box.y + box.height)) + 8, width: 700, height: 600 });
          setSaved(value);
        }
      } catch { /* A missing or invalid layout uses the defaults. */ }
    });
    return () => observer.disconnect();
  }, []);

  function persist(value: Box[]) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); setNotice(""); }
    catch { setNotice("Layout changed for this session. Browser storage is unavailable."); }
  }

  function update(index: number, mode: "move" | "resize", start: Box, dx: number, dy: number, snap = snapping) {
    const value = adjustPanel(latest.current, index, mode, start, dx, dy, bounds, snap);
    latest.current = value;
    setSaved(value);
    return value;
  }

  function handle(index: number, mode: "move" | "resize") {
    return {
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { index, mode, x: event.clientX, y: event.clientY, box: { ...latest.current[index] } };
        setFront(index);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current;
        if (current?.index === index && current.mode === mode) update(index, mode, current.box, event.clientX - current.x, event.clientY - current.y, snapping && !event.altKey);
      },
      onPointerUp: () => { if (gesture.current) persist(latest.current); gesture.current = null; },
      onPointerCancel: () => { if (gesture.current) persist(latest.current); gesture.current = null; },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!delta[event.key]) return;
        event.preventDefault();
        const [x, y] = delta[event.key];
        const step = event.shiftKey ? 40 : 10;
        persist(update(index, mode, latest.current[index], x * step, y * step, false));
      },
    };
  }

  return (
    <div className="panel-workspace" ref={host}>
      <div className="layout-toolbar">
        <span>Drag headers · resize corners · Alt bypasses snap</span>
        <div className="layout-actions">
        <button className="button button-quiet" type="button" aria-pressed={snapping} onClick={() => setSnapping(value => !value)}><Magnet size={14} /> Snap {snapping ? "on" : "off"}</button>
        <button className="button button-quiet" type="button" onClick={() => {
          const value = autoLayout(bounds.width, bounds.height);
          latest.current = value; setSaved(value); persist(value);
          host.current?.scrollTo({ left: 0, top: 0 });
        }}><LayoutGrid size={14} /> Auto-layout</button>
        <button className="button button-quiet" type="button" onClick={() => {
          setSaved(null); latest.current = defaults; host.current?.scrollTo({ left: 0, top: 0 });
          try { localStorage.removeItem(KEY); setNotice("Layout reset."); }
          catch { setNotice("Layout reset for this session. Browser storage is unavailable."); }
        }}><RotateCcw size={14} /> Reset layout</button>
        </div>
      </div>
      {notice && <p className="layout-notice" role="status">{notice}</p>}
      <div className="panel-canvas" style={{ width: Math.max(bounds.width, ...boxes.map(box => box.x + box.width)), height: Math.max(bounds.height, ...boxes.map(box => box.y + box.height)) }}>
        {Children.toArray(children).map((child, index) => (
          <div className="movable-panel" data-panel-index={index} key={names[index]} style={{ left: boxes[index].x, top: boxes[index].y, width: boxes[index].width, height: boxes[index].height, zIndex: front === index ? 2 : 1 }} onPointerDownCapture={event => setFront(Number((event.target as HTMLElement).closest<HTMLElement>(".movable-panel")?.dataset.panelIndex ?? index))} onFocusCapture={event => setFront(Number((event.target as HTMLElement).closest<HTMLElement>(".movable-panel")?.dataset.panelIndex ?? index))}>
            <button type="button" className="panel-drag-handle" aria-label={`Move ${names[index]} panel. Drag or use arrow keys.`} title="Drag to move. Arrow keys move; Shift moves faster." {...handle(index, "move")}><GripVertical size={16} />{names[index]}</button>
            <div className="panel-content">{child}</div>
            <button type="button" className="panel-resize-handle" aria-label={`Resize ${names[index]} panel. Drag or use arrow keys.`} title="Drag to resize. Arrow keys resize; Shift resizes faster." {...handle(index, "resize")}><Grip size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
