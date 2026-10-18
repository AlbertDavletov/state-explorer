import { validateTimeRange, type TimeRange } from "@state-explorer/core";

function proposal(viewport: TimeRange, start: number, end: number): TimeRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end
    || (start === viewport.start && end === viewport.end)) return null;
  return { start, end };
}

/** Renderer-local navigation math. Unsafe or numerically ineffective gestures are ignored. */
export function zoomViewport(viewport: TimeRange, anchor: number, scale: number): TimeRange | null {
  validateTimeRange(viewport);
  const duration = viewport.end - viewport.start;
  if (!Number.isFinite(duration) || !Number.isFinite(anchor) || anchor < 0 || anchor > 1
    || !Number.isFinite(scale) || scale <= 0 || (duration < 1 && scale < 1)) return null;
  // One millisecond matches Date-based axis precision. Smaller supplied ranges still render.
  const nextDuration = Math.max(Math.min(1, duration), duration * scale);
  if (!Number.isFinite(nextDuration)) return null;
  const change = nextDuration - duration;
  const next = proposal(viewport, viewport.start - change * anchor, viewport.end + change * (1 - anchor));
  return next && next.end - next.start >= Math.min(1, duration) ? next : null;
}

/** Positive fractions move the window toward later times, without intentionally changing duration. */
export function panViewport(viewport: TimeRange, fraction: number): TimeRange | null {
  validateTimeRange(viewport);
  const duration = viewport.end - viewport.start;
  if (!Number.isFinite(duration) || !Number.isFinite(fraction)) return null;
  const shift = duration * fraction;
  return proposal(viewport, viewport.start + shift, viewport.end + shift);
}
