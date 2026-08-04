export function isCompactEntryFormViewport(width = 0, supportsTouch = false) {
  if (typeof width !== 'number' || Number.isNaN(width)) return supportsTouch;
  return width <= 768 || supportsTouch;
}

export function getEntryFormLayoutMode(width = 0, supportsTouch = false) {
  return isCompactEntryFormViewport(width, supportsTouch) ? 'sheet' : 'dialog';
}
