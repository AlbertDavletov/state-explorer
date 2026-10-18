/** Keep fractional and out-of-Date-range times exact rather than rounding for speech. */
export function accessibleTime(time: number): string {
  return Number.isInteger(time) && Math.abs(time) <= 8.64e15
    ? new Date(time).toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC")
    : `${time} epoch milliseconds`;
}
