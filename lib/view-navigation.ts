export type ImageSize = { width: number; height: number };
export type ViewNavigation = { zoom: number; x: number; y: number; actual?: boolean };
export const fitNavigation: ViewNavigation = { zoom: 1, x: 0.5, y: 0.5 };
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function fittedScale(image: ImageSize, bounds: ImageSize) {
  return image.width > 0 && image.height > 0 && bounds.width > 0 && bounds.height > 0
    ? Math.min(bounds.width / image.width, bounds.height / image.height) : 1;
}
export function viewGeometry(image: ImageSize, bounds: ImageSize, nav: ViewNavigation) {
  const fit = fittedScale(image, bounds);
  const scale = nav.actual ? 1 : fit * nav.zoom;
  const width = image.width * scale, height = image.height * scale;
  return { fit, scale, width, height,
    left: clamp(width * nav.x - bounds.width / 2, 0, Math.max(0, width - bounds.width)),
    top: clamp(height * nav.y - bounds.height / 2, 0, Math.max(0, height - bounds.height)) };
}
export function scrollCenter(left: number, top: number, geometry: { width: number; height: number }, bounds: ImageSize) {
  return { x: geometry.width > bounds.width ? clamp((left + bounds.width / 2) / geometry.width, 0, 1) : 0.5,
    y: geometry.height > bounds.height ? clamp((top + bounds.height / 2) / geometry.height, 0, 1) : 0.5 };
}
