import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { StateTimeline, type StateAppearance, type StateTimelineProps } from "@state-explorer/react";
import { projectTimeline, validateTimeRange, type Entity, type StateInterval, type TimeRange,
  type TimelineRow, type TimelineSegment } from "@state-explorer/core";

interface Device extends Entity<{ region: string }> { serial: number }
interface Interval extends StateInterval<"online", { attempt: number }> { source: string }
const entities: Device[] = [
  { id: "a", label: "First", serial: 1, metadata: { region: "west" } },
  { id: "b", label: "Last", serial: 2, metadata: { region: "east" } },
];
const intervals: Interval[] = [
  { entityId: "a", start: 80, end: 150, state: "online", source: "sensor", metadata: { attempt: 1 } },
  { entityId: "a", start: 150, end: 230, state: "online", source: "retry", metadata: { attempt: 2 } },
  { entityId: "b", start: 100.001, end: 100.002, state: "online", source: "tiny", metadata: { attempt: 3 } },
  { entityId: "b", start: 150, end: 230, state: "online", source: "last", metadata: { attempt: 4 } },
];
const initial: TimeRange = { start: 100, end: 200 };
validateTimeRange(initial);
const rows: TimelineRow<Device, Interval>[] = projectTimeline(entities, intervals, initial);
const segment: TimelineSegment<Interval> = rows[0]!.segments[0]!;
if (segment.interval.source !== "sensor") throw new Error("Projection lost source information");
const appearance: StateAppearance = { fill: "#167d73", label: "Online" };
const props: StateTimelineProps<Device, Interval> = {
  entities, intervals, viewport: initial, getStateAppearance: () => appearance,
};
// Packed declarations must not retain the removed experimental callback.
const noSelectionProp: "onTimeRangeSelect" extends keyof StateTimelineProps<Device, Interval> ? false : true = true;
void noSelectionProp;
// Simple string state also infers without explicit component generic arguments.
function Simple() {
  return <StateTimeline entities={[{ id: "s", label: "Simple" }]}
    intervals={[{ entityId: "s", start: 0, end: 1, state: "ready" }]}
    viewport={{ start: 0, end: 1 }} label="Simple timeline"
    getStateAppearance={interval => ({ fill: "#123456", label: interval.state.toUpperCase() })} />;
}
function Consumer() {
  const [data, setData] = useState({ entities, intervals });
  const [viewport, setViewport] = useState(initial);
  return <main>
    <button>Before</button>
    <section aria-label="Container" style={{ width: 700 }}>
      <StateTimeline {...props} {...data} viewport={viewport} label="External timeline"
        onViewportChange={setViewport}
        getStateAppearance={(interval, entity) => ({ ...appearance,
          label: `${interval.state.toUpperCase()} ${interval.source} ${interval.metadata?.attempt} ${entity.serial} ${entity.metadata?.region}` })} />
    </section>
    <button>After</button>
    <output aria-label="Viewport" aria-live="off" data-start={viewport.start} data-end={viewport.end} />
    <button onClick={() => setData(data => ({ ...data, intervals: [...data.intervals].reverse() }))}>Reorder</button>
    <button onClick={() => setData(data => ({ entities: data.entities.map(entity => ({ ...entity })),
      intervals: data.intervals.map(interval => ({ ...interval })) }))}>Replace</button>
    <button onClick={() => { setData({ entities, intervals }); setViewport(initial); }}>Reset</button>
    <button onClick={() => {
      setData({ entities, intervals: [{ ...intervals[0]!, start: 0.1, end: Number.MAX_VALUE }] });
      setViewport({ start: 0, end: 200 });
    }}>Extreme</button>
    <Simple />
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Consumer /></StrictMode>);
