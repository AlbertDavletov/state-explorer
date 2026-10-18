import { validateTimeRange, type TimeRange } from "@state-explorer/core";

export type NavigatorAction = "move" | "start" | "end";

/** Optional bounded navigation is stricter than the unbounded core time model. */
export function validateDomain(domain: TimeRange, viewport: TimeRange): void {
  validateTimeRange(domain);
  validateTimeRange(viewport);
  if (!Number.isFinite(domain.end - domain.start)) throw new RangeError("Domain duration must be finite.");
  if (viewport.start < domain.start || viewport.end > domain.end) {
    throw new RangeError("Viewport must be contained within domain.");
  }
}

function changed(viewport: TimeRange, start: number, end: number): TimeRange | null {
  return Number.isFinite(start) && Number.isFinite(end) && start < end
    && (start !== viewport.start || end !== viewport.end) ? { start, end } : null;
}

/** Fit a proposal into the domain, translating before shortening its duration. */
export function boundViewport(viewport: TimeRange, next: TimeRange, domain: TimeRange): TimeRange | null {
  validateDomain(domain, viewport);
  const duration = next.end - next.start;
  if (!Number.isFinite(next.start) || !Number.isFinite(next.end) || duration <= 0) return null;
  if (duration >= domain.end - domain.start) return changed(viewport, domain.start, domain.end);
  const start = Math.max(domain.start, Math.min(domain.end - duration, next.start));
  return changed(viewport, start, Math.min(domain.end, start + duration));
}

/** Pure time arithmetic; callers convert pixels to a normalized delta and minimum duration. */
export function navigateOverview(viewport: TimeRange, domain: TimeRange, action: NavigatorAction,
  delta: number, minimumDuration: number): TimeRange | null {
  validateDomain(domain, viewport);
  if (!Number.isFinite(delta) || delta === 0 || !Number.isFinite(minimumDuration) || minimumDuration <= 0) return null;
  const shift = Math.max(-1, Math.min(1, delta)) * (domain.end - domain.start);
  const duration = viewport.end - viewport.start;
  // Preserve finer externally supplied/detail-zoomed windows; permit moving or expanding them.
  const minimum = Math.min(duration, minimumDuration);
  if (action === "start") {
    return changed(viewport, Math.max(domain.start, Math.min(viewport.end - minimum, viewport.start + shift)), viewport.end);
  }
  if (action === "end") {
    return changed(viewport, viewport.start, Math.min(domain.end, Math.max(viewport.start + minimum, viewport.end + shift)));
  }
  // Clamp before addition to avoid overflowing a large timestamp plus a large shift.
  const start = Math.max(domain.start, Math.min(domain.end - duration, viewport.start + shift));
  return changed(viewport, start, Math.min(domain.end, start + duration));
}
