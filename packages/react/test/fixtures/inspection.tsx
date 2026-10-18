import { createRoot } from "react-dom/client";
import { StateTimeline, type StateAppearance } from "@state-explorer/react";
import type { Entity, StateInterval } from "@state-explorer/core";

// Stable regression data, independent of the public showcase.
type Phase = "queued" | "running" | "paused";
const appearance: Record<Phase, StateAppearance> = {
  queued: { fill: "#64748b", label: "Queued" },
  running: { fill: "#167d91", label: "Running" },
  paused: { fill: "#b86812", label: "Paused" },
};
const entities: Entity[] = [
  { id: "build", label: "Build pipeline" },
  { id: "export", label: "Data export" },
  { id: "sync", label: "Device sync" },
  { id: "idle", label: "Scheduled job" },
];
// One unit in the compact fixture below is one minute from 08:20 UTC.
const at = (minute: number) => Date.parse("2026-09-10T08:20:00Z") + minute * 60_000;
const intervals = ([
  { entityId: "build", start: 80, end: 120, state: "queued" },
  { entityId: "build", start: 120, end: 160, state: "running" },
  { entityId: "build", start: 160, end: 175, state: "paused" },
  { entityId: "build", start: 175, end: 220, state: "running" },
  { entityId: "export", start: 100, end: 140, state: "queued" },
  { entityId: "export", start: 140, end: 180, state: "running" },
  { entityId: "export", start: 180, end: 200, state: "paused" },
  { entityId: "sync", start: 110, end: 190, state: "running" },
  { entityId: "idle", start: 220, end: 250, state: "queued" },
] satisfies StateInterval<Phase>[]).map(interval => ({ ...interval,
  start: at(interval.start), end: at(interval.end) }));

createRoot(document.getElementById("root")!).render(
  <main style={{ margin: 40 }}>
    <section aria-label="Timeline container" style={{ width: "100%", maxWidth: 1200 }}>
      <StateTimeline entities={entities} intervals={intervals} viewport={{ start: at(100), end: at(200) }}
        label="Example job state history" getStateAppearance={interval => appearance[interval.state]} />
    </section>
  </main>,
);
