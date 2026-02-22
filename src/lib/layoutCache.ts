const STORAGE_KEY = "agentflow-layouts";
const MAX_CACHED_LAYOUTS = 20;

type PositionMap = Record<string, { x: number; y: number }>;
type LayoutEntry = { positions: PositionMap; accessedAt: number };

// In-memory cache — avoids repeated JSON.parse of localStorage on every read
let memCache: Record<string, LayoutEntry> | null = null;

function getAll(): Record<string, LayoutEntry> {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { memCache = {}; return memCache; }
    const parsed = JSON.parse(raw);
    // Migrate legacy format (plain PositionMap values without accessedAt)
    const entries: Record<string, LayoutEntry> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (val && typeof val === "object" && "accessedAt" in (val as Record<string, unknown>)) {
        entries[key] = val as LayoutEntry;
      } else {
        entries[key] = { positions: val as PositionMap, accessedAt: Date.now() };
      }
    }
    memCache = entries;
    return memCache;
  } catch {
    memCache = {};
    return memCache;
  }
}

function saveAll(data: Record<string, LayoutEntry>) {
  memCache = data;
  // Evict oldest entries if over cap
  const keys = Object.keys(data);
  if (keys.length > MAX_CACHED_LAYOUTS) {
    keys
      .sort((a, b) => data[a].accessedAt - data[b].accessedAt)
      .slice(0, keys.length - MAX_CACHED_LAYOUTS)
      .forEach((k) => delete data[k]);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Get cached node positions for a pipeline.
 * Returns null if no cache exists.
 */
export function getCachedLayout(pipelinePath: string): PositionMap | null {
  const all = getAll();
  const entry = all[pipelinePath];
  if (!entry) return null;
  // Touch accessedAt on read
  entry.accessedAt = Date.now();
  saveAll(all);
  return entry.positions;
}

/**
 * Save node positions to the local layout cache.
 */
export function saveCachedLayout(pipelinePath: string, positions: PositionMap) {
  const all = getAll();
  all[pipelinePath] = { positions, accessedAt: Date.now() };
  saveAll(all);
}

/**
 * Update a single node's position in the cache.
 */
export function updateCachedNodePosition(
  pipelinePath: string,
  nodeId: string,
  position: { x: number; y: number },
) {
  const all = getAll();
  if (!all[pipelinePath]) all[pipelinePath] = { positions: {}, accessedAt: Date.now() };
  all[pipelinePath].positions[nodeId] = position;
  all[pipelinePath].accessedAt = Date.now();
  saveAll(all);
}

/**
 * Remove cached layout for a pipeline.
 */
export function removeCachedLayout(pipelinePath: string) {
  const all = getAll();
  delete all[pipelinePath];
  saveAll(all);
}
