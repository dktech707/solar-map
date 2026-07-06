/** Coerce a possibly-null numeric input to a finite number, else the fallback. */
export function coerceNumber(value: number | null, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

/** Clamp a finite value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
