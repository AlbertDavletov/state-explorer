/** An application-defined entity, independent of its state history. */
export interface Entity<TMetadata = unknown> {
  id: string;
  label: string;
  metadata?: TMetadata;
}

/** A nonempty half-open range [start, end), in finite Unix epoch milliseconds. */
export interface TimeRange {
  start: number;
  end: number;
}

/** A state held by one entity over a TimeRange. State and metadata are opaque. */
export interface StateInterval<TState, TMetadata = unknown> extends TimeRange {
  entityId: string;
  state: TState;
  metadata?: TMetadata;
}

/**
 * Validate time bounds on a typed range or state interval without changing it.
 * Throws RangeError for nonfinite bounds or start >= end.
 * This is not a parser for untrusted data or a validator for interval collections.
 */
export function validateTimeRange(range: TimeRange): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new RangeError("Time bounds must be finite epoch milliseconds.");
  }
  if (range.start >= range.end) {
    throw new RangeError("Time range start must be less than end.");
  }
}

/** Clipped time bounds and horizontal coordinates, retaining the source interval. */
export interface TimelineSegment<TInterval extends StateInterval<unknown>> extends TimeRange {
  interval: TInterval;
  xStart: number;
  xEnd: number;
}

/** One row per input entity; its array index is its row position. */
export interface TimelineRow<TEntity extends Entity, TInterval extends StateInterval<unknown>> {
  entity: TEntity;
  segments: TimelineSegment<TInterval>[];
}

/**
 * Project typed intervals into [0, 1] coordinates within a half-open viewport.
 * Rows preserve entity order (including empty rows); segments preserve input order.
 * Overlaps are projected independently, without merging or assigning precedence.
 * Throws RangeError for invalid viewport/interval bounds, including hidden intervals.
 * Throws Error for duplicate entity IDs or unknown interval entity references.
 * Output containers are new; source entities and intervals are shared, not cloned.
 */
export function projectTimeline<TEntity extends Entity, TInterval extends StateInterval<unknown>>(
  entities: readonly TEntity[],
  intervals: readonly TInterval[],
  viewport: TimeRange,
): TimelineRow<TEntity, TInterval>[] {
  validateTimeRange(viewport);
  const rows: TimelineRow<TEntity, TInterval>[] = [];
  const rowsById = new Map<string, TimelineRow<TEntity, TInterval>>();
  for (const entity of entities) {
    if (rowsById.has(entity.id)) {
      throw new Error(`Duplicate entity ID: ${entity.id}`);
    }
    const row: TimelineRow<TEntity, TInterval> = { entity, segments: [] };
    rows.push(row);
    rowsById.set(entity.id, row);
  }

  const duration = viewport.end - viewport.start;
  const project = (time: number): number => {
    // Finite endpoints can still have an overflowing difference. Scale only then.
    if (!Number.isFinite(duration)) {
      return (time / 2 - viewport.start / 2) / (viewport.end / 2 - viewport.start / 2);
    }
    return (time - viewport.start) / duration;
  };

  for (const interval of intervals) {
    validateTimeRange(interval);
    const row = rowsById.get(interval.entityId);
    if (row === undefined) {
      throw new Error(`Unknown entity ID: ${interval.entityId}`);
    }
    const start = Math.max(interval.start, viewport.start);
    const end = Math.min(interval.end, viewport.end);
    if (start >= end) continue;
    row.segments.push({ interval, start, end, xStart: project(start), xEnd: project(end) });
  }
  return rows;
}
