import type { TimeRange } from "@state-explorer/core";
import { utcTicks } from "d3-time";

/** Renderer-local ticks. Core accepts times beyond Date's range and precision. */
export function timeTicks({ start, end }: TimeRange, width: number) {
  if (width < 110) return [];
  const calendar = Math.abs(start) <= 8.64e15 && Math.abs(end) <= 8.64e15 && end - start >= 1;
  const times = calendar
    ? utcTicks(new Date(start), new Date(end), Math.max(1, Math.floor(width / 140))).map(Number)
      .filter(time => time >= start && time <= end)
    : [];
  const values = times.length ? times : [start, end];
  const duration = end - start;
  let previous = -Infinity;
  return values.flatMap(time => {
    const position = time === start ? 0 : time === end ? 1 : (time - start) / duration;
    const iso = calendar ? new Date(time).toISOString().split("T") : null;
    const date = iso ? iso[0]! : "Epoch ms";
    const clock = iso ? iso[1]!.replace(/(?:\.000)?Z$/, "") : String(time);
    // D3's count is a hint. Keep a conservative character budget without DOM text measurement.
    const space = Math.max(110, Math.max(date.length, clock.length) * 8 + 16);
    if (width < space) return [];
    const labelX = Math.max(space / 2, Math.min(position * width, width - space / 2));
    if (labelX - space / 2 < previous) return [];
    previous = labelX + space / 2;
    return [{ time, position, labelPosition: labelX / width, date, clock }];
  });
}
