import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { StateTimeline } from "@state-explorer/react";
import type { TimeRange } from "@state-explorer/core";

const initial = { start: 200, end: 600 };
const entities = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
const intervals = [
  { entityId: "a", start: 0, end: 200, state: "Early" },
  { entityId: "a", start: 200, end: 500, state: "Middle" },
  { entityId: "a", start: 700, end: 1000, state: "Late" },
  { entityId: "b", start: 0, end: 1000, state: "Steady" },
];
function Fixture() {
  const [viewport, setViewport] = useState(initial);
  const [domain, setDomain] = useState({ start: 0, end: 1000 });
  const [mode, setMode] = useState("accept");
  const [enabled, setEnabled] = useState(true);
  const [request, setRequest] = useState<TimeRange | null>(null);
  const [requests, setRequests] = useState(0);
  const change = (next: TimeRange) => {
    setRequest(next); setRequests(value => value + 1);
    if (mode === "accept") setViewport(next);
    if (mode === "transform") setViewport({ start: Math.round(next.start / 10) * 10, end: Math.round(next.end / 10) * 10 });
  };
  return <main style={{ margin: 20 }}>
    <button>Before timeline</button>
    <section aria-label="Timeline container" style={{ width: 900, maxWidth: "100%" }}>
      <StateTimeline entities={entities} intervals={intervals} domain={domain} viewport={viewport}
        {...(enabled ? { onViewportChange: change } : {})}
        label="Navigator fixture" getStateAppearance={interval => ({ fill: "#167d73", label: interval.state })} />
    </section>
    <button>After timeline</button>
    <output aria-label="Viewport" data-start={viewport.start} data-end={viewport.end} />
    <output aria-label="Request" data-start={request?.start} data-end={request?.end} data-count={requests} />
    <label>Parent mode<select value={mode} onChange={event => setMode(event.target.value)}>
      <option value="accept">Accept</option><option value="reject">Reject</option><option value="transform">Round to 10 ms</option>
    </select></label>
    <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enable navigation</label>
    <button onClick={() => setViewport(initial)}>Reset</button>
    <button onClick={() => setViewport({ start: 100, end: 300 })}>External viewport</button>
    <button onClick={() => setViewport({ start: 499, end: 500 })}>Fine viewport</button>
    <button onClick={() => setDomain({ start: 0, end: 1200 })}>Extend domain</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
