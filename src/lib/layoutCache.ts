const STORAGE_KEY = "agentflow-layouts";

type PositionMap = Record<string, { x: number; y: number }>;

function getAll(): Record<string, PositionMap> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, PositionMap>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Get cached node positions for a pipeline.
 * Returns null if no cache exists.
 */
export function getCachedLayout(pipelinePath: string): PositionMap | null {
  const all = getAll();
  return all[pipelinePath] ?? null;
}

/**
 * Save node positions to the local layout cache.
 */
export function saveCachedLayout(pipelinePath: string, positions: PositionMap) {
  const all = getAll();
  all[pipelinePath] = positions;
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
  if (!all[pipelinePath]) all[pipelinePath] = {};
  all[pipelinePath][nodeId] = position;
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
