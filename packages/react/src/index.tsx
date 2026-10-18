import { projectTimeline, type Entity, type StateInterval, type TimeRange } from "@state-explorer/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { timeTicks } from "./time-axis.js";
import { panViewport, zoomViewport } from "./navigation.js";
import { accessibleTime } from "./accessible-time.js";
import { OverviewNavigator } from "./overview-navigator.js";
import { boundViewport, validateDomain } from "./navigator.js";

export interface StateAppearance {
  /** An SVG fill color supplied by the application. */
  fill: string;
  /** Human-readable state name used in the segment's accessible description. */
  label: string;
}

export interface StateTimelineProps<TEntity extends Entity, TInterval extends StateInterval<unknown>> {
  entities: readonly TEntity[];
  intervals: readonly TInterval[];
  viewport: TimeRange;
  /** Complete bounded history; enables the overview. Must contain viewport. */
  domain?: TimeRange;
  /** Proposes a new viewport; rendering changes only when the application supplies it. */
  onViewportChange?: (viewport: TimeRange) => void;
  getStateAppearance: (interval: TInterval, entity: TEntity) => StateAppearance;
  /** Accessible name for the whole timeline. */
  label?: string;
}

const rowHeight = 48;
const top = 60;
const visuallyHidden = { position: "absolute", width: 1, height: 1, padding: 0,
  overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" } as const;

/** SVG rendering and interval inspection. Core validation errors propagate. */
export function StateTimeline<TEntity extends Entity, TInterval extends StateInterval<unknown>>({
  entities, intervals, viewport, domain, onViewportChange, getStateAppearance, label = "State timeline",
}: StateTimelineProps<TEntity, TInterval>) {
  if (domain) validateDomain(domain, viewport);
  const rows = projectTimeline(entities, intervals, viewport);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(0, entry.contentRect.width));
    });
    observer.observe(containerRef.current!);
    return () => observer.disconnect();
  }, []);
  const labelWidth = Math.min(180, width * 0.35);
  const plotWidth = Math.max(0, width - labelWidth - Math.min(20, width * 0.05));
  const toX = (position: number) => labelWidth + position * plotWidth;
  const ticks = timeTicks(viewport, plotWidth);
  const tooltipWidth = Math.min(280, width);
  const height = top + Math.max(rows.length, 1) * rowHeight + 12;
  const pointerPosition = (clientX: number, clientY: number) => {
    const bounds = svgRef.current!.getBoundingClientRect();
    if (!bounds.width || !bounds.height || plotWidth <= 0) return null;
    const x = (clientX - bounds.left) * width / bounds.width;
    const y = (clientY - bounds.top) * height / bounds.height;
    return { position: Math.max(0, Math.min(1, (x - labelWidth) / plotWidth)),
      inside: x >= labelWidth && x <= toX(1) && y >= top && y <= height - 12 };
  };
  useEffect(() => {
    if (!onViewportChange || plotWidth <= 0) return;
    const svg = svgRef.current!;
    const wheel = (event: WheelEvent) => {
      if (!onViewportChange) return;
      if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.altKey) return;
      const point = pointerPosition(event.clientX, event.clientY);
      if (!point?.inside) return;
      // Shift-wheel may arrive on either axis. Line/page units are approximate CSS pixels.
      const delta = (event.shiftKey && event.deltaX !== 0 ? event.deltaX : event.deltaY)
        * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotWidth : 1);
      if (!Number.isFinite(delta) || delta === 0) return;
      const next = event.shiftKey
        ? panViewport(viewport, Math.max(-1, Math.min(1, delta / plotWidth)))
        : zoomViewport(viewport, point.position,
          Math.exp(Math.max(-100, Math.min(100, delta)) * 0.002));
      const bounded = next && domain ? boundViewport(viewport, next, domain) : next;
      if (!bounded) return;
      event.preventDefault();
      onViewportChange(bounded);
    };
    // React's delegated wheel listener can be passive. Cancel only handled plot gestures.
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [viewport, domain?.start, domain?.end, onViewportChange, width, height, labelWidth, plotWidth]);

  // Input positions stay stable as clipping changes visible indices; retain duplicate occurrences.
  const sourceIndices = new Map<TInterval, number[]>();
  intervals.forEach((interval, index) => {
    const indices = sourceIndices.get(interval);
    if (indices) indices.push(index);
    else sourceIndices.set(interval, [index]);
  });
  type Target = { entity: TEntity; interval: TInterval | null; index: number };
  const entries = rows.map((row, rowIndex) => row.segments.length
    ? row.segments.map(segment => ({ entity: row.entity, interval: segment.interval,
      index: sourceIndices.get(segment.interval)!.shift()!, segment, rowIndex }))
    : [{ entity: row.entity, interval: null, index: -1, segment: null, rowIndex }]);
  const same = (a: Target | null | undefined, b: Target) => a?.entity === b.entity
    && a.interval === b.interval && a.index === b.index;
  const [hovered, setHovered] = useState<Target | null>(null);
  const [focused, setFocused] = useState<Target | null>(null);
  // undefined chooses the initial entry; null deliberately retains the chart fallback.
  const [tabTarget, setTabTarget] = useState<Target | null>();
  const ownsFocus = useRef(false);
  const [chartFocused, setChartFocused] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(true);
  useEffect(() => {
    // Capture modality before native or programmatic SVG focus changes. Keep
    // inspection focus intact; only its visual indicator depends on modality.
    const pointer = () => setKeyboardFocus(false);
    const keyboard = (event: KeyboardEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) setKeyboardFocus(true);
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
  const [dismissed, setDismissed] = useState(false);
  const instructionsId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const resolve = (target: Target | null) => {
    return target ? entries.flat().find(entry => same(target, entry)) ?? null : null;
  };
  const tabEntry = tabTarget === undefined ? entries[0]?.[0] : resolve(tabTarget);
  // Source collections may change on any render. Clear only identities no longer present.
  useEffect(() => {
    if (hovered && !resolve(hovered)) setHovered(null);
    if (tabTarget && !resolve(tabTarget)) setTabTarget(null);
    if (focused && !resolve(focused)) {
      setFocused(null);
      // Do not steal focus from an application control that accepted the change.
      if (ownsFocus.current && (document.activeElement === document.body
        || svgRef.current?.contains(document.activeElement))) svgRef.current?.focus();
    }
  });
  // Keep only source identities in interaction state; derive content from current props.
  const inspected = resolve(hovered) ?? resolve(focused);
  const active = dismissed || !inspected?.segment ? null : inspected;
  const activeAppearance = active?.interval && getStateAppearance(active.interval, active.entity);
  const hasActive = active !== null;
  useEffect(() => {
    if (!hasActive) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [hasActive]);
  const focusEntry = (entry: (typeof entries)[number][number] | undefined) => {
    if (!entry) return;
    const node = entry.interval
      ? svgRef.current?.querySelector<SVGElement>(`[data-source-index="${entry.index}"]`)
      : svgRef.current?.querySelector<SVGElement>(`[data-empty-row="${entry.rowIndex}"]`);
    node?.focus();
  };
  const focusTarget = (target: Target) => {
    const source = { entity: target.entity, interval: target.interval, index: target.index };
    setFocused(source); setTabTarget(source); setHovered(null); setDismissed(false);
  };
  const focusEntryNow = resolve(focused);
  const instructions = `Viewport ${accessibleTime(viewport.start)} to ${accessibleTime(viewport.end)}; end exclusive. ${rows.length ? `${rows.length} entities.` : "No entities."} Left and Right: intervals in input order. Up and Down: previous or next row, first interval. Home and End: first or last interval in row. Tab: leave timeline. Escape: dismiss inspection.`
    + (onViewportChange ? " Plus or equals: zoom in. Minus: zoom out. Shift Left or Right: pan." : "");

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === "Tab") return;
    if (key === "Escape") {
      event.preventDefault(); setDismissed(true); return;
    }
    if (onViewportChange) {
      const next = key === "+" || key === "=" ? zoomViewport(viewport, 0.5, 0.8)
        : key === "-" ? zoomViewport(viewport, 0.5, 1.25)
        : event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")
          ? panViewport(viewport, key === "ArrowLeft" ? -0.1 : 0.1) : null;
      if (next) {
        event.preventDefault();
        const bounded = domain ? boundViewport(viewport, next, domain) : next;
        if (bounded) onViewportChange(bounded);
        return;
      }
    }
    if (event.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const rowIndex = focusEntryNow?.rowIndex ?? 0;
    const row = entries[rowIndex];
    const index = row?.findIndex(entry => same(focused, entry)) ?? -1;
    if (key === "ArrowUp" || key === "ArrowDown") {
      focusEntry(entries[focusEntryNow ? rowIndex + (key === "ArrowUp" ? -1 : 1) : 0]?.[0]);
    } else {
      focusEntry(row?.[key === "Home" ? 0 : key === "End" ? row.length - 1
        : index < 0 ? 0 : Math.max(0, Math.min(row.length - 1, index + (key === "ArrowLeft" ? -1 : 1)))]);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", minWidth: 0, fontFamily: "system-ui, sans-serif" }}>
    <span id={instructionsId} style={visuallyHidden}>{instructions}</span>
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width="100%" height={height}
      tabIndex={tabEntry ? -1 : 0} aria-describedby={instructionsId}
      onFocusCapture={() => { ownsFocus.current = true; }}
      onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        ownsFocus.current = false;
      }}
      onFocus={event => {
        if (event.target === event.currentTarget) { setChartFocused(true); setTabTarget(null); setFocused(null); }
      }}
      onBlur={() => setChartFocused(false)}
      onKeyDown={handleKeyDown}
      viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined} role="group" aria-label={label}
      fontFamily="system-ui, sans-serif" fontSize={13}
      style={{ outline: "none", display: "block", visibility: width > 0 ? "visible" : "hidden", background: "white", color: "#243247" }}>
      <g aria-hidden="true" fill="currentColor">
        {labelWidth >= 45 && <text x={12} y={28}>UTC</text>}
        <line x1={toX(0)} x2={toX(1)} y1={48} y2={48} stroke="#94a3b8" />
        {ticks.map(tick => <g key={tick.time} data-time={tick.time}>
          <line x1={toX(tick.position)} x2={toX(tick.position)} y1={42} y2={54} stroke="#94a3b8" />
          <text x={toX(tick.labelPosition)} y={16} textAnchor="middle" fontSize={12}>{tick.date}</text>
          <text x={toX(tick.labelPosition)} y={32} textAnchor="middle" fontSize={12}>{tick.clock}</text>
        </g>)}
      </g>
      {rows.length === 0 && <text x={12} y={top + 24} fill="currentColor">No entities</text>}
      {rows.map((row, rowIndex) => (
        <g key={row.entity.id} role="group" aria-label={row.segments.length ? row.entity.label : `${row.entity.label}; no visible intervals`}
          data-empty-row={row.segments.length ? undefined : rowIndex}
          tabIndex={row.segments.length ? undefined : same(tabEntry, entries[rowIndex]![0]!) ? 0 : -1}
          style={{ outline: "none" }}
          onFocus={event => { if (event.target === event.currentTarget) focusTarget(entries[rowIndex]![0]!); }}
          onBlur={event => { if (event.target === event.currentTarget) setFocused(null); }}
          transform={`translate(0 ${top + rowIndex * rowHeight})`}>
          <svg width={Math.max(0, labelWidth - 12)} height={rowHeight} overflow="hidden" aria-hidden="true">
            <text x={12} y={25} fill="currentColor">{row.entity.label}</text>
          </svg>
          <line x1={toX(0)} x2={toX(1)} y1={20} y2={20}
            stroke="#e2e8f0" strokeWidth={28} aria-hidden="true" />
          {row.segments.map((segment, segmentIndex) => {
            const target = entries[rowIndex]![segmentIndex]!;
            const sourceIndex = target.index;
            const appearance = getStateAppearance(segment.interval, row.entity);
            return (
              <rect key={sourceIndex} x={toX(segment.xStart)}
                y={6} width={toX(segment.xEnd) - toX(segment.xStart)} height={28}
                fill={appearance.fill} role="img"
                data-source-index={sourceIndex} tabIndex={same(tabEntry, target) ? 0 : -1}
                style={{ outline: "none" }}
                aria-label={`${row.entity.label}: ${appearance.label}; original start ${accessibleTime(segment.interval.start)}; end ${accessibleTime(segment.interval.end)}, exclusive`}
                onPointerEnter={() => {
                  setHovered({ entity: target.entity, interval: target.interval, index: target.index }); setDismissed(false);
                }}
                onPointerLeave={event => {
                  if (!(event.relatedTarget instanceof Node) || !tooltipRef.current?.contains(event.relatedTarget)) {
                    setHovered(null);
                  }
                }}
                onFocus={() => focusTarget(target)}
                onBlur={() => setFocused(null)} />
            );
          })}
        </g>
      ))}
      {keyboardFocus && (focusEntryNow || chartFocused) && <g data-focus-outline="" aria-hidden="true" pointerEvents="none" fill="none">
        {["white", "#1d4ed8"].map((stroke, index) => <rect key={stroke}
          x={focusEntryNow ? toX(focusEntryNow.segment?.xStart ?? 0) : 3}
          y={focusEntryNow ? top + focusEntryNow.rowIndex * rowHeight + 4 : 3}
          width={focusEntryNow ? Math.max(2, toX(focusEntryNow.segment?.xEnd ?? 1) - toX(focusEntryNow.segment?.xStart ?? 0)) : Math.max(0, width - 6)}
          height={focusEntryNow ? 32 : height - 6} stroke={stroke} strokeWidth={index === 0 ? 4 : 2} />)}
      </g>}
    </svg>
    {domain && <OverviewNavigator entities={entities} intervals={intervals} domain={domain} viewport={viewport}
      width={width} labelWidth={labelWidth} plotWidth={plotWidth} label={label}
      onViewportChange={onViewportChange} getStateAppearance={getStateAppearance} />}
    {width > 0 && active && activeAppearance && (
      <div ref={tooltipRef} role="tooltip" aria-hidden="true" onPointerLeave={() => setHovered(null)}
        style={{ position: "absolute", zIndex: 1, width: tooltipWidth, paddingTop: 6,
          left: Math.max(0, Math.min(toX(active.segment!.xStart), width - tooltipWidth)),
          top: top + active.rowIndex * rowHeight + 34 }}>
        <div style={{ padding: Math.min(12, width / 4), borderRadius: 4, background: "#172334", color: "white",
          fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere", boxShadow: "0 2px 8px #0003" }}>
          <strong>{active.entity.label}</strong>
          <div>State: {activeAppearance.label}</div>
          <div>Original start: {accessibleTime(active.interval!.start)}</div>
          <div>Original end: {accessibleTime(active.interval!.end)}</div>
          <div>End exclusive</div>
        </div>
      </div>
    )}
    </div>
  );
}
