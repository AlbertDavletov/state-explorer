import { useState } from "react";
import { StateTimeline } from "@state-explorer/react";
import type { Entity, StateInterval, TimeRange } from "@state-explorer/core";

const start = Date.parse("2026-09-10T10:00:00Z");
const end = Date.parse("2026-09-10T12:00:00Z");
const hour = 60 * 60_000;
const domain = { start: start - 2 * hour, end: end + 2 * hour };
const entities: Entity[] = [{ id: "api", label: "API" }, { id: "worker", label: "Worker" }];
const intervals: StateInterval<"healthy" | "degraded">[] = [
  { entityId: "api", start: domain.start, end: start, state: "healthy" },
  { entityId: "api", start, end: start + hour, state: "degraded" },
  { entityId: "api", start: start + hour, end, state: "healthy" },
  { entityId: "api", start: end, end: domain.end, state: "degraded" },
  { entityId: "worker", start: domain.start, end: domain.end, state: "healthy" },
];
const appearance = {
  healthy: { fill: "#167d73", label: "Healthy" },
  degraded: { fill: "#b87916", label: "Degraded" },
};

export default function Example() {
  const [viewport, setViewport] = useState<TimeRange>({ start, end });
  return <div style={{ width: "100%", maxWidth: 900 }}>
    <StateTimeline entities={entities} intervals={intervals} viewport={viewport} domain={domain}
      onViewportChange={setViewport}
      label="Service state history" getStateAppearance={interval => appearance[interval.state]} />
  </div>;
}
