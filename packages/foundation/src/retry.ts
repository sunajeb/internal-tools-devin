export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(2 ** Math.max(attempt, 0) * 5_000, 15 * 60_000);
  return base + Math.floor(random() * Math.min(base * 0.2, 30_000));
}
