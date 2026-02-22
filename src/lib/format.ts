const durationCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

export function formatDuration(startedAt: string, finishedAt: string): string {
  const key = startedAt + "|" + finishedAt;
  const cached = durationCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    const diffMs = end - start;
    if (diffMs < 0 || isNaN(diffMs)) {
      durationCache.set(key, "");
      return "";
    }
    const result = formatMs(diffMs);
    if (durationCache.size >= MAX_CACHE_SIZE) durationCache.clear();
    durationCache.set(key, result);
    return result;
  } catch {
    durationCache.set(key, "");
    return "";
  }
}

export function clearDurationCache() {
  durationCache.clear();
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatElapsed(startedAt: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    if (diffMs < 0 || isNaN(diffMs)) return "";
    return formatMs(diffMs);
  } catch {
    return "";
  }
}
