export type OutputMeasurement = { output: number; durationMs: number }

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function outputMeasurement(
  output: number | null,
  durationMs: unknown
): OutputMeasurement | null {
  return output !== null &&
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0
    ? { output, durationMs }
    : null
}

export function recordTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : null
}
