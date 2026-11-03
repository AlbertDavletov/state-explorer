import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StateTimeline } from "@state-explorer/react";

const entities = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
const intervals = [
  { entityId: "a", start: 0, end: 350, state: "Early" },
  { entityId: "a", start: 500, end: 501, state: "Brief" },
  { entityId: "a", start: 650, end: 1000, state: "Late" },
  { entityId: "b", start: 0, end: 1000, state: "Steady" },
];
createRoot(document.getElementById("root")!).render(<StrictMode>
  <main style={{ margin: 20 }}>
    <button>Before timeline</button>
    <StateTimeline entities={entities} intervals={intervals} viewport={{ start: 0, end: 1000 }}
      label="Touch inspection" getStateAppearance={interval => ({ fill: "#167d73", label: interval.state })} />
    <button>After timeline</button>
  </main>
</StrictMode>);
