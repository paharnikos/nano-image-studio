export type PanelBox = { x: number; y: number; width: number; height: number };
export const panelMinimums = [200, 340, 320, 320, 340, 340];
const gap = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function primaryLayout(width: number, height: number): PanelBox[] {
  width = Math.max(340, Math.min(2000, width));
  height = Math.max(540, Math.min(2000, height));
  if (width >= 1000) return [
    { x: 0, y: 0, width: 218, height },
    { x: 226, y: 0, width: width - 594, height },
    { x: width - 360, y: 0, width: 360, height },
  ];
  if (width >= 700) return [
    { x: 0, y: height + gap, width, height: 320 },
    { x: 0, y: 0, width: width - 328, height },
    { x: width - 320, y: 0, width: 320, height },
  ];
  return [
    { x: 0, y: 2 * (height + gap), width, height: 320 },
    { x: 0, y: height + gap, width, height },
    { x: 0, y: 0, width, height },
  ];
}

export function autoLayout(width: number, height: number): PanelBox[] {
  const primary = primaryLayout(width, height);
  const bottom = Math.max(...primary.map(box => box.y + box.height)) + gap;
  const available = Math.max(340, Math.min(2000, width));
  const split = available >= 700;
  const panelWidth = split ? (available - gap) / 2 : available;
  return [...primary,
    { x: 0, y: bottom, width: panelWidth, height: 440 },
    { x: split ? panelWidth + gap : 0, y: split ? bottom : bottom + 448, width: panelWidth, height: 440 },
    { x: 0, y: bottom + (split ? 448 : 896), width: available, height: 600 },
  ];
}

function nearest(value: number, targets: number[], min: number, max: number) {
  let result = clamp(value, min, max);
  let distance = 13;
  for (const target of targets) {
    const next = Math.abs(target - value);
    if (target >= min && target <= max && next < distance) { result = target; distance = next; }
  }
  return result;
}

export function adjustPanel(boxes: PanelBox[], index: number, mode: "move" | "resize", start: PanelBox, dx: number, dy: number, bounds: { width: number; height: number }, snap: boolean): PanelBox[] {
  const box = mode === "move"
    ? { ...start, x: clamp(start.x + dx, 0, 3000), y: clamp(start.y + dy, 0, 10000) }
    : { ...start, width: clamp(start.width + dx, panelMinimums[index], 2000), height: clamp(start.height + dy, 320, 2000) };
  if (snap) {
    const xs = mode === "move" ? [0, bounds.width - box.width] : [bounds.width];
    const ys = mode === "move" ? [0, bounds.height - box.height] : [bounds.height];
    boxes.forEach((other, i) => {
      if (i === index) return;
      if (box.y <= other.y + other.height + 12 && box.y + box.height >= other.y - 12) xs.push(...(mode === "move"
        ? [other.x, other.x + other.width - box.width, other.x - box.width - gap, other.x + other.width + gap]
        : [other.x - gap, other.x + other.width]));
      if (box.x <= other.x + other.width + 12 && box.x + box.width >= other.x - 12) ys.push(...(mode === "move"
        ? [other.y, other.y + other.height - box.height, other.y - box.height - gap, other.y + other.height + gap]
        : [other.y - gap, other.y + other.height]));
    });
    if (mode === "move") {
      box.x = nearest(box.x, xs, 0, 3000);
      box.y = nearest(box.y, ys, 0, 10000);
    } else {
      box.width = nearest(box.width, xs.map(x => x - box.x), panelMinimums[index], 2000);
      box.height = nearest(box.height, ys.map(y => y - box.y), 320, 2000);
    }
  }
  return boxes.map((existing, i) => i === index ? box : existing);
}
