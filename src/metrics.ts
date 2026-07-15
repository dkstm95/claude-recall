export function normalizePercentage(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}

export function normalizeNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

export function normalizeEpochSeconds(value: unknown): number | undefined {
  const normalized = normalizeNonNegativeNumber(value);
  // JavaScript Date supports at most ±8.64e15 milliseconds.
  return normalized === undefined || normalized > 8.64e12 ? undefined : normalized;
}
