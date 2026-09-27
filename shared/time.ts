// Day/night cycle. time: 0..1, 0.25 = noon, 0.75 = midnight.
export const DAY_LENGTH = 600; // seconds for a full cycle

export function sunHeight(time: number) { return Math.sin(time * Math.PI * 2); }

// 0 at night .. 1 at full day (before the 0.2 floor used for lighting)
export function dayFactor(time: number) {
  const x = Math.min(1, Math.max(0, (sunHeight(time) + 0.2) / 0.5));
  return x * x * (3 - 2 * x);
}

export function daylight(time: number) { return 0.2 + 0.8 * dayFactor(time); }
