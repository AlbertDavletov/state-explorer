import { createRoot } from "react-dom/client";
import { useState } from "react";
import { StateTimeline } from "@state-explorer/react";
import type { TimeRange } from "@state-explorer/core";
import { appearances, historyDomain, scenarios } from "./scenarios.js";
import { formatTime } from "./format-time.js";
import "./styles.css";

function Demo() {
  const [scenario, setScenario] = useState(scenarios[0]!);
  const [viewport, setViewport] = useState<TimeRange>(scenario.viewport);
  return (
    <div className="showcase" data-demo-preview="">
      <div className="toolbar">
        <label htmlFor="scenario">Explore a scenario
          <select id="scenario" value={scenario.id} onChange={event => {
            const next = scenarios.find(item => item.id === event.target.value)!;
            setScenario(next); setViewport(next.viewport);
          }}>
            {scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setViewport(scenario.viewport)}>Reset view</button>
      </div>
      <div className="readout">
        <h2>Visible time range</h2>
        <output aria-label="Visible time range" aria-live="off" data-start={viewport.start} data-end={viewport.end}>
          <span>{formatTime(viewport.start)}</span>{" → "}<span>{formatTime(viewport.end)}</span>
        </output>
      </div>
      <ul className="legend" aria-label="State legend">
        {scenario.states.map(state => <li key={state}>
          <span aria-hidden="true" style={{ background: appearances[state].fill }} />{appearances[state].label}
        </li>)}
      </ul>
      <section aria-label="Timeline container" className="timeline-container">
        <StateTimeline entities={scenario.entities} intervals={scenario.intervals} domain={historyDomain} viewport={viewport}
          onViewportChange={setViewport}
          label={`${scenario.title} timeline`} getStateAppearance={interval => appearances[interval.state]} />
      </section>
      <p className="caption">Drag the blue window to move through time; drag its edges to zoom.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
