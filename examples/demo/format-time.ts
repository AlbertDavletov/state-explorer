/** Display policy: floor to the containing UTC second; never change viewport data. */
export function formatTime(time: number): string {
  return new Date(Math.floor(time / 1000) * 1000).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}
