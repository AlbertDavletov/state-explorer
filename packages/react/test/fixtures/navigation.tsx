import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StateTimeline } from "@state-explorer/react";
import type { TimeRange } from "@state-explorer/core";

const at = (minute: number) => Date.parse("2026-09-10T08:20:00Z") + minute * 60_000;
const initial = { start: at(100), end: at(200) };
const entities = [{ id: "a", label: "Alpha" }, { id: "b", label: "Duplicates" }];
const duplicate = { entityId: "b", start: at(120), end: at(220), state: "Repeated" };
const intervals = [
  { entityId: "a", start: at(80), end: at(120), state: "Early" },
  { entityId: "a", start: at(120), end: at(160), state: "Middle" },
  { entityId: "a", start: at(160), end: at(220), state: "Late" },
  { entityId: "b", start: at(80), end: at(120), state: "Early" },
  duplicate, duplicate,
];

function Fixture() {
  const [viewport, setViewport] = useState(initial);
  const [accept, setAccept] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [request, setRequest] = useState<TimeRange | null>(null);
  const [count, setCount] = useState(0);
  const change = (next: TimeRange) => {
    setRequest(next);
    setCount(count => count + 1);
    if (accept) setViewport(next);
  };
  return <main style={{ margin: 20, minHeight: 1600 }}>
    <section aria-label="Timeline container" style={{ width: 900 }}>
      <StateTimeline entities={entities} intervals={intervals} viewport={viewport}
        {...(enabled ? { onViewportChange: change } : {})}
        label="Navigation fixture" getStateAppearance={interval => ({ fill: "#167d91", label: interval.state })} />
    </section>
    <output aria-label="Viewport" data-start={viewport.start} data-end={viewport.end} />
    <output aria-label="Request" data-start={request?.start} data-end={request?.end} data-count={count} />
    <label><input type="checkbox" checked={accept} onChange={event => setAccept(event.target.checked)} />Accept changes</label>
    <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enable navigation</label>
    <button onClick={() => setViewport({ start: at(130), end: at(230) })}>External viewport</button>
    <button onClick={() => setViewport(initial)}>Reset</button>
    <button onClick={() => setViewport({ start: 0, end: 0.1 })}>Tiny viewport</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
