import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StateTimeline } from "@state-explorer/react";
import type { TimeRange } from "@state-explorer/core";

const entities = [{ id: "a", label: "Dense Alpha" }, { id: "empty", label: "Empty row" },
  { id: "b", label: "Dense Beta" }, { id: "c", label: "Dense Gamma" }];
const duplicate = { entityId: "a", start: 120, end: 160, state: "Duplicate" };
const intervals = [
  { entityId: "a", start: 170, end: 230, state: "Later first" },
  { entityId: "a", start: 80, end: 120, state: "Earlier second" },
  duplicate, duplicate,
  ...["a", "b", "c"].flatMap(entityId => Array.from({ length: 60 }, (_, index) => ({
    entityId, start: 100 + index, end: 100 + index + (index % 2 ? 1 : 0.001), state: `Tiny ${index}`,
  }))),
];
const initial = { start: 100, end: 200 };
function Fixture() {
  const [viewport, setViewport] = useState(initial);
  const [accept, setAccept] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("dense");
  const [request, setRequest] = useState<TimeRange | null>(null);
  return <main style={{ margin: 20 }}>
    <button>Before timeline</button>
    <section aria-label="Container" style={{ width: 900 }}>
      <StateTimeline entities={mode === "empty" ? [] : entities} intervals={mode === "dense" ? intervals : []}
        viewport={viewport} label="Dense timeline"
        getStateAppearance={interval => ({ fill: interval.state === "Duplicate" ? "white" : "#0f172a", label: interval.state })}
        {...(enabled ? { onViewportChange: (next: TimeRange) => { setRequest(next); if (accept) setViewport(next); } } : {})} />
    </section>
    <button>After timeline</button>
    <output aria-label="Viewport" data-start={viewport.start} data-end={viewport.end} />
    <output aria-label="Request" data-start={request?.start} data-end={request?.end} />
    <label><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} />Accept changes</label>
    <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable navigation</label>
    <button onClick={() => setViewport({ start: 160, end: 260 })}>Clip</button>
    <button onClick={() => setViewport({ start: 300, end: 400 })}>Away</button>
    <button onClick={() => setViewport(initial)}>Reset</button>
    <button onClick={() => setMode("empty")}>No entities</button>
    <button onClick={() => setMode("rows")}>Empty rows</button>
    <button onClick={() => setMode("dense")}>Restore intervals</button>
    <button onClick={() => setViewport({ start: -Number.MAX_VALUE, end: Number.MAX_VALUE })}>Collapsed projection</button>
    <button onClick={() => setViewport({ start: 0, end: Number.MIN_VALUE })}>Tiny viewport</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
