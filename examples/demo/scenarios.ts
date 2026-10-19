import type { Entity, StateInterval, TimeRange } from "@state-explorer/core";
import type { StateAppearance } from "@state-explorer/react";

// All domain vocabulary and colors live in the consuming application.
export const appearances = {
  healthy: { fill: "#167d73", label: "Healthy" },
  degraded: { fill: "#b87916", label: "Degraded" },
  down: { fill: "#c34858", label: "Down" },
  queued: { fill: "#94a3b8", label: "Queued" },
  building: { fill: "#387ab5", label: "Building" },
  testing: { fill: "#8064b4", label: "Testing" },
  deployed: { fill: "#167d73", label: "Deployed" },
  failed: { fill: "#c34858", label: "Failed" },
  online: { fill: "#387ab5", label: "Online" },
  offline: { fill: "#697586", label: "Offline" },
  maintenance: { fill: "#b87916", label: "Maintenance" },
} satisfies Record<string, StateAppearance>;
type DemoState = keyof typeof appearances;
interface Scenario {
  id: string;
  title: string;
  states: DemoState[];
  entities: Entity[];
  intervals: StateInterval<DemoState>[];
  viewport: TimeRange;
}

// Fixed illustrative histories: minutes relative to 10:00 UTC on September 10.
const at = (minute: number) => Date.parse("2026-09-10T10:00:00Z") + minute * 60_000;
export const historyDomain: TimeRange = { start: at(-120), end: at(240) };
const interval = (entityId: string, start: number, end: number, state: DemoState): StateInterval<DemoState> =>
  ({ entityId, start: at(start), end: at(end), state });

export const scenarios: Scenario[] = [
  {
    id: "services", title: "Service health",
    states: ["healthy", "degraded", "down"],
    entities: [{ id: "api", label: "API" }, { id: "auth", label: "Authentication" },
      { id: "payments", label: "Payments" }, { id: "search", label: "Search" }],
    intervals: [
      interval("api", -20, 35, "healthy"), interval("api", 35, 55, "degraded"),
      interval("api", 55, 65, "down"), interval("api", 65, 140, "healthy"),
      interval("auth", -10, 75, "healthy"), interval("auth", 75, 90, "degraded"), interval("auth", 90, 130, "healthy"),
      interval("payments", 0, 50, "healthy"), interval("payments", 50, 70, "down"), interval("payments", 70, 120, "healthy"),
      interval("search", 0, 70, "healthy"), interval("search", 85, 140, "healthy"),
    ],
    viewport: { start: at(0), end: at(120) },
  },
  {
    id: "builds", title: "Build pipelines",
    states: ["queued", "building", "testing", "deployed", "failed"],
    entities: [{ id: "web", label: "Web" }, { id: "api", label: "API" },
      { id: "worker", label: "Worker" }, { id: "mobile", label: "Mobile" }],
    intervals: [
      interval("web", -10, 10, "queued"), interval("web", 10, 45, "building"),
      interval("web", 45, 70, "testing"), interval("web", 70, 135, "deployed"),
      interval("api", 0, 20, "queued"), interval("api", 20, 55, "building"), interval("api", 55, 75, "failed"),
      interval("api", 75, 105, "building"), interval("api", 105, 125, "testing"), interval("api", 125, 150, "deployed"),
      interval("worker", 15, 45, "queued"), interval("worker", 45, 90, "building"),
      interval("worker", 90, 110, "testing"), interval("worker", 110, 150, "deployed"),
      interval("mobile", -20, 40, "queued"), interval("mobile", 40, 100, "building"), interval("mobile", 100, 140, "testing"),
    ],
    viewport: { start: at(0), end: at(120) },
  },
  {
    id: "devices", title: "Device states",
    states: ["online", "offline", "maintenance"],
    entities: [{ id: "a", label: "Device A" }, { id: "b", label: "Device B" }, { id: "c", label: "Device C" }],
    intervals: [
      interval("a", -30, 30, "online"), interval("a", 30, 50, "maintenance"), interval("a", 50, 140, "online"),
      interval("b", -5, 20, "offline"), interval("b", 20, 85, "online"),
      interval("b", 85, 100, "offline"), interval("b", 100, 130, "online"),
      interval("c", -10, 45, "online"), interval("c", 65, 90, "maintenance"), interval("c", 90, 150, "online"),
    ],
    viewport: { start: at(0), end: at(120) },
  },
];

// Earlier and later cycles stay outside the initial detail window. The overview
// shows the whole supplied history, including the original reporting gaps.
for (const scenario of scenarios) {
  const surrounding = scenario.entities.flatMap(entity => {
    const history = scenario.intervals.filter(item => item.entityId === entity.id);
    const first = Math.min(scenario.viewport.start, ...history.map(item => item.start));
    const last = Math.max(...history.map(item => item.end));
    const state = scenario.states[0]!;
    const alternate = scenario.states[1]!;
    return [
      { entityId: entity.id, start: historyDomain.start, end: first - 30 * 60_000, state },
      { entityId: entity.id, start: first - 30 * 60_000, end: first, state: alternate },
      { entityId: entity.id, start: last, end: last + 30 * 60_000, state: alternate },
      { entityId: entity.id, start: last + 30 * 60_000, end: historyDomain.end, state },
    ];
  });
  scenario.intervals = [...scenario.intervals, ...surrounding];
}
