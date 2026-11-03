import { projectTimeline, type Entity, type StateInterval, type TimeRange } from "@state-explorer/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { StateAppearance } from "./index.js";
import { accessibleTime } from "./accessible-time.js";
import { navigateOverview, type NavigatorAction } from "./navigator.js";
import { timeTicks } from "./time-axis.js";

interface Props<TEntity extends Entity, TInterval extends StateInterval<unknown>> {
  entities: readonly TEntity[];
  intervals: readonly TInterval[];
  domain: TimeRange;
  viewport: TimeRange;
  width: number;
  labelWidth: number;
  plotWidth: number;
  label: string;
  onViewportChange: ((range: TimeRange) => void) | undefined;
  getStateAppearance: (interval: TInterval, entity: TEntity) => StateAppearance;
}

const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden",
  clipPath: "inset(50%)", whiteSpace: "nowrap" } as const;
const modes: NavigatorAction[] = ["move", "start", "end"];
const names = { move: "Move viewport", start: "Resize viewport start", end: "Resize viewport end" };

/** Internal raw SVG overview; the parent owns the viewport. */
export function OverviewNavigator<TEntity extends Entity, TInterval extends StateInterval<unknown>>({
  entities, intervals, domain, viewport, width, labelWidth, plotWidth, label, onViewportChange, getStateAppearance,
}: Props<TEntity, TInterval>) {
  const rows = projectTimeline(entities, intervals, domain);
  const windowSegment = projectTimeline([{ id: "viewport", label: "Viewport" }],
    [{ ...viewport, entityId: "viewport", state: null }], domain)[0]!.segments[0]!;
  const svg = useRef<SVGSVGElement>(null);
  const instructionId = useId();
  const [focused, setFocused] = useState<NavigatorAction | null>(null);
  const keyboardFocus = useRef(true);
  type Drag = { id: number; action: NavigatorAction; x: number; pixels: number; capture: SVGSVGElement;
    domainStart: number; domainEnd: number; width: number; plotWidth: number };
  const drag = useRef<Drag | null>(null);
  const cancel = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.capture.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id);
  };
  useEffect(() => {
    cancel();
  }, [domain.start, domain.end, width, plotWidth, Boolean(onViewportChange)]);
  useEffect(() => {
    // Track modality before focus() runs: programmatic focus can inherit a
    // previous :focus-visible match, including when clicking the same control.
    const pointer = () => { keyboardFocus.current = false; setFocused(null); };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") cancel();
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      keyboardFocus.current = true;
      const active = document.activeElement;
      const action = active?.getAttribute("data-navigator-control") as NavigatorAction | null;
      if (active && svg.current?.contains(active) && action && modes.includes(action)) setFocused(action);
    };
    window.addEventListener("blur", cancel);
    const node = svg.current!;
    // Measure once at contact, then only on actual layout changes. Subpixel
    // rounding must not cancel an otherwise stable controlled drag.
    const observer = new ResizeObserver(() => {
      const current = drag.current;
      if (current && Math.abs(current.pixels - current.plotWidth * node.getBoundingClientRect().width / current.width) > 0.5) cancel();
    });
    observer.observe(node);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      cancel();
      observer.disconnect();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);

  const top = 32;
  const overviewHeight = Math.max(48, rows.length * 10 + 8);
  const height = top + overviewHeight + 48;
  const toX = (position: number) => labelWidth + position * plotWidth;
  const left = toX(windowSegment.xStart);
  const right = toX(windowSegment.xEnd);
  const windowWidth = Math.max(0, right - left);
  const span = domain.end - domain.start;
  const duration = viewport.end - viewport.start;
  const minimumDuration = (pixels: number) => Math.min(span, Math.max(1, span * Math.min(1, 48 / Math.max(1, pixels))));
  const minimum = Math.min(duration, minimumDuration(plotWidth));
  const values = {
    move: { now: viewport.start, min: domain.start, max: domain.end - duration },
    start: { now: viewport.start, min: domain.start, max: viewport.end - minimum },
    end: { now: viewport.end, min: viewport.start + minimum, max: domain.end },
  };
  const rangeText = `${accessibleTime(viewport.start)} to ${accessibleTime(viewport.end)}; end exclusive`;
  const valueText = (action: NavigatorAction) => action === "move" ? rangeText
    : `${accessibleTime(values[action].now)}; ${action === "end" ? "exclusive end" : "start"}. Viewport ${rangeText}`;
  const measure = () => {
    const bounds = svg.current?.getBoundingClientRect();
    return bounds && width > 0 ? plotWidth * bounds.width / width : 0;
  };
  const begin = (event: PointerEvent<SVGRectElement>, action: NavigatorAction) => {
    if (!onViewportChange || drag.current || !event.isPrimary || event.button !== 0
      || event.ctrlKey || event.metaKey || event.altKey) return;
    const bounds = svg.current!.getBoundingClientRect();
    const pixels = width > 0 ? plotWidth * bounds.width / width : 0;
    if (pixels <= 0) return;
    if (event.pointerType === "touch") {
      // SVG hit testing may snap a subpixel window's center onto an edge.
      // Resolve the disjoint regions from the contact, not the rounded hit.
      const x = (event.clientX - bounds.left) * width / bounds.width;
      action = x < left + innerHandle ? "start" : x > right - innerHandle ? "end" : "move";
    }
    // Resolve once at contact; accepted geometry changes never switch Drag.action.
    event.preventDefault();
    svg.current!.querySelector<SVGRectElement>(`[data-navigator-control="${action}"]`)!.focus({ preventScroll: true });
    svg.current!.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, action, x: event.clientX, pixels, capture: svg.current!,
      domainStart: domain.start, domainEnd: domain.end, width, plotWidth };
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (!onViewportChange || !event.currentTarget.hasPointerCapture(current.id)
      || current.width !== width || current.plotWidth !== plotWidth
      || current.domainStart !== domain.start || current.domainEnd !== domain.end) { cancel(); return; }
    const delta = (event.clientX - current.x) / current.pixels;
    current.x = event.clientX;
    const next = navigateOverview(viewport, domain, current.action, delta, minimumDuration(current.pixels));
    if (next) onViewportChange(next);
  };
  const keyDown = (event: KeyboardEvent<SVGRectElement>, action: NavigatorAction) => {
    if (event.key === "Tab" || event.key === "Escape") { cancel(); return; }
    if (!onViewportChange || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const direction = ["ArrowLeft", "ArrowDown"].includes(event.key) ? -1
      : ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    cancel();
    const delta = event.key === "Home" ? -1 : event.key === "End" ? 1
      : direction * (event.shiftKey ? 0.1 : 0.01);
    const next = navigateOverview(viewport, domain, action, delta, minimumDuration(measure()));
    if (next) onViewportChange(next);
  };
  // Keep at least the middle two thirds for moving, with at most 10px of
  // inward resize reach. Expand the rest outward to 44px where space permits.
  // The same disjoint regions serve SVG mouse hits and touch coordinates.
  const innerHandle = Math.min(10, windowWidth / 6);
  const startOutside = Math.min(44 - innerHandle, left);
  const endOutside = Math.min(44 - innerHandle, Math.max(0, width - right));
  const targets = {
    move: { x: left, width: windowWidth },
    start: { x: left - startOutside, width: startOutside + innerHandle },
    end: { x: right - innerHandle, width: endOutside + innerHandle },
  };
  // SVG shape touch-action is not consistently honored by gesture arbitration.
  // Use a CSS box ancestor: horizontal gestures belong to us, vertical scroll
  // and browser pinch zoom remain available, including over the controls.
  return <div style={{ position: "relative", marginTop: 8,
    touchAction: onViewportChange ? "pan-y pinch-zoom" : "auto", userSelect: "none", WebkitUserSelect: "none" }}>
    {/* Chromium can omit aria-valuetext on SVG sliders; descriptions retain readable current values. */}
    {modes.map(action => <span key={action} id={`${instructionId}-${action}`} style={hidden}>
      Current value: {valueText(action)}.
    </span>)}
    <span id={instructionId} style={hidden}>
      Full history {accessibleTime(domain.start)} to {accessibleTime(domain.end)}; end exclusive.
      Drag the window to pan or either edge to resize. Arrow keys adjust by 1 percent of history;
      Shift adjusts by 10 percent. Home and End reach the available bounds. Tab visits window, start, end.
      Escape stops a drag; accepted changes remain. Detail wheel zoom can inspect finer periods.
    </span>
    <svg ref={svg} data-overview-navigator="" width="100%" height={height}
      viewBox={width > 0 ? `0 0 ${width} ${height}` : undefined}
      role="group" aria-label={`${label} overview navigator`} aria-describedby={instructionId}
      fontSize={12} style={{ display: "block", visibility: width > 0 ? "visible" : "hidden", overflow: "hidden" }}
      onPointerMove={move}
      onPointerUp={event => { if (event.pointerId === drag.current?.id) { move(event); cancel(); } }}
      onPointerCancel={event => { if (event.pointerId === drag.current?.id) cancel(); }}
      onLostPointerCapture={event => { if (event.pointerId === drag.current?.id) cancel(); }}>
      <g aria-hidden="true" pointerEvents="none">
        <text x={12} y={18} fill="#334155">Full history</text>
        <rect data-overview-track="" x={toX(0)} y={top} width={plotWidth} height={overviewHeight} rx={3} fill="#e2e8f0" />
        {rows.map((row, rowIndex) => <g key={row.entity.id}>
          {row.segments.map((segment, index) => <rect key={index} data-overview-segment=""
            x={toX(segment.xStart)} y={top + 4 + rowIndex * 10}
            width={Math.max(0, segment.xEnd - segment.xStart) * plotWidth} height={8}
            fill={getStateAppearance(segment.interval, row.entity).fill} />)}
        </g>)}
        <rect x={toX(0)} y={top} width={Math.max(0, left - toX(0))} height={overviewHeight} fill="white" fillOpacity={0.65} />
        <rect x={right} y={top} width={Math.max(0, toX(1) - right)} height={overviewHeight} fill="white" fillOpacity={0.65} />
        {timeTicks(domain, plotWidth).map(tick => <g key={tick.time}>
          <line x1={toX(tick.position)} x2={toX(tick.position)} y1={top + overviewHeight} y2={top + overviewHeight + 5} stroke="#64748b" />
          <text x={toX(tick.labelPosition)} y={top + overviewHeight + 20} textAnchor="middle" fill="#475569">{tick.date}</text>
          <text x={toX(tick.labelPosition)} y={top + overviewHeight + 36} textAnchor="middle" fill="#475569">{tick.clock}</text>
        </g>)}
      </g>
      {modes.map(action => <rect key={action} data-navigator-control={action}
        x={targets[action].x} y={top} width={targets[action].width} height={overviewHeight}
        role="slider" tabIndex={onViewportChange ? 0 : -1} aria-disabled={!onViewportChange}
        aria-label={names[action]} aria-describedby={`${instructionId}-${action} ${instructionId}`} aria-orientation="horizontal"
        aria-valuemin={values[action].min} aria-valuemax={values[action].max} aria-valuenow={values[action].now}
        aria-valuetext={valueText(action)}
        fill={action === "move" ? "#2563eb" : "transparent"} fillOpacity={action === "move" ? 0.08 : 1}
        stroke={action === "move" ? "#1d4ed8" : "none"} strokeWidth={2}
        style={{ outline: "none", cursor: !onViewportChange ? "default" : action === "move" ? "grab" : "ew-resize" }}
        onFocus={() => setFocused(keyboardFocus.current ? action : null)} onBlur={() => setFocused(null)}
        onPointerDown={event => begin(event, action)} onKeyDown={event => keyDown(event, action)} />)}
      <g aria-hidden="true" pointerEvents="none">
        {[left, right].map((x, index) => <g key={index}>
          <rect x={x - 4} y={top + overviewHeight / 2 - 14} width={8} height={28} rx={2} fill="#1d4ed8" stroke="white" strokeWidth={1} />
          <line x1={x} x2={x} y1={top + overviewHeight / 2 - 7} y2={top + overviewHeight / 2 + 7} stroke="white" />
        </g>)}
        {focused && ["white", "#0f172a"].map((stroke, index) => <rect key={stroke} data-navigator-focus=""
          x={targets[focused].x} y={top - 2} width={Math.max(2, targets[focused].width)} height={overviewHeight + 4}
          fill="none" stroke={stroke} strokeWidth={index === 0 ? 6 : 2} />)}
      </g>
    </svg>
  </div>;
}
