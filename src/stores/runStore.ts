import { create } from "zustand";
import type {
  RunState,
  RunStateDelta,
  NodeResult,
  NodeLogEvent,
  NodeLogBatchEvent,
  ApprovalRequest,
  RunRow,
} from "../types/run";
import * as api from "../lib/tauri";
import { clearDurationCache } from "../lib/format";
import type { Pipeline } from "../types/pipeline";

let approvalTimer: ReturnType<typeof setTimeout> | null = null;
let historyDebounce: ReturnType<typeof setTimeout> | null = null;

/* ── Log throttle buffer ── */
const LOG_FLUSH_INTERVAL = 100; // ms
const MAX_LOG_LINES = 2000;
let logBuffer: Record<string, string[]> = {};
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogBuffer() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  const buf = logBuffer;
  // Check if buffer has any entries
  let hasEntries = false;
  for (const _k in buf) { hasEntries = true; break; }
  if (!hasEntries) return;
  logBuffer = {};

  useRunStore.setState((s) => {
    const newLogs = { ...s.logs };
    for (const [nodeId, lines] of Object.entries(buf)) {
      const existing = newLogs[nodeId] || [];
      const merged = existing.concat(lines);
      newLogs[nodeId] = merged.length > MAX_LOG_LINES
        ? merged.slice(-MAX_LOG_LINES)
        : merged;
    }

    // Check for loop start cost snapshot in buffered lines
    let loopUpdate: { loopCostSnapshot: Record<string, number> } | undefined;
    for (const [nodeId, lines] of Object.entries(buf)) {
      if (nodeId in s.loopCostSnapshot) continue;
      for (const line of lines) {
        const iterMatch = line.match(/^--- Loop iteration 1\/(\d+):/);
        if (iterMatch) {
          if (!loopUpdate) {
            loopUpdate = { loopCostSnapshot: { ...s.loopCostSnapshot } };
          }
          loopUpdate.loopCostSnapshot[nodeId] = s.runState?.total_cost_usd ?? 0;
          break;
        }
      }
    }

    return { logs: newLogs, ...(loopUpdate || {}) };
  });
}

function scheduleLogFlush() {
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(flushLogBuffer, LOG_FLUSH_INTERVAL);
  }
}

/** Strip heavy output strings from a RunState before storing in history. */
function stripForHistory(state: RunState): RunState {
  const stripped: Record<string, NodeResult> = {};
  for (const [id, r] of Object.entries(state.node_results)) {
    stripped[id] = { ...r, output: "" };
  }
  return { ...state, node_results: stripped };
}

interface RunStoreState {
  runState: RunState | null;
  running: boolean;
  logs: Record<string, string[]>;
  approvalRequest: ApprovalRequest | null;
  approvalResponse: "approved" | "rejected" | null;
  lastRunInputs: Record<string, string>;
  runHistory: RunState[];
  persistedHistory: RunRow[];
  focusedNodeId: string | null;
  loopCostSnapshot: Record<string, number>;

  startRun: (
    pipeline: Pipeline,
    inputs: Record<string, string>,
    cliPath: string,
    projectPath: string,
  ) => Promise<void>;
  cancelRun: () => Promise<void>;
  respondToApproval: (approved: boolean) => Promise<void>;
  resumeRun: (
    originalRunId: string,
    pipeline: Pipeline,
    inputs: Record<string, string>,
    cliPath: string,
    projectPath: string,
  ) => Promise<void>;
  handleRunUpdate: (state: RunState) => void;
  handleRunDelta: (delta: RunStateDelta) => void;
  handleNodeLog: (event: NodeLogEvent) => void;
  handleNodeLogBatch: (event: NodeLogBatchEvent) => void;
  handleApprovalRequest: (req: ApprovalRequest) => void;
  clearRun: () => void;
  getNodeLogs: (nodeId: string) => string[];
  loadHistory: () => Promise<void>;
}

export const useRunStore = create<RunStoreState>((set, get) => ({
  runState: null,
  running: false,
  logs: {},
  approvalRequest: null,
  approvalResponse: null,
  lastRunInputs: {},
  runHistory: [],
  persistedHistory: [],

  focusedNodeId: null,
  loopCostSnapshot: {},

  startRun: async (pipeline, inputs, cliPath, projectPath) => {
    logBuffer = {};
    if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    set({ running: true, logs: {}, approvalRequest: null, approvalResponse: null, lastRunInputs: inputs, focusedNodeId: null, loopCostSnapshot: {} });
    try {
      await api.startRun(pipeline, inputs, cliPath, projectPath);
    } catch (e) {
      set({ running: false });
      throw e;
    }
  },

  cancelRun: async () => {
    await api.cancelRun();
  },

  respondToApproval: async (approved) => {
    await api.respondToApproval(approved);
    set({ approvalRequest: null, approvalResponse: approved ? "approved" : "rejected" });
    // Auto-clear after 3 seconds (cancel any previous timer)
    if (approvalTimer) clearTimeout(approvalTimer);
    approvalTimer = setTimeout(() => {
      approvalTimer = null;
      set((s) => s.approvalResponse ? { approvalResponse: null } : {});
    }, 3000);
  },

  resumeRun: async (originalRunId, pipeline, inputs, cliPath, projectPath) => {
    logBuffer = {};
    if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    set({ running: true, logs: {}, approvalRequest: null, approvalResponse: null, lastRunInputs: inputs, loopCostSnapshot: {} });
    try {
      await api.resumeRun(
        originalRunId,
        pipeline,
        inputs,
        cliPath,
        projectPath,
      );
    } catch (e) {
      set({ running: false });
      throw e;
    }
  },

  handleRunUpdate: (state: RunState) => {
    const isFinished = ["success", "failed", "cancelled", "budget_exceeded"].includes(
      state.status,
    );
    if (isFinished) flushLogBuffer();
    set((s) => ({
      runState: state,
      running: !isFinished,
      runHistory: isFinished
        ? [stripForHistory(state), ...s.runHistory].slice(0, 10)
        : s.runHistory,
    }));
    // Refresh persisted history when a run finishes (debounced)
    if (isFinished) {
      if (historyDebounce) clearTimeout(historyDebounce);
      historyDebounce = setTimeout(() => { historyDebounce = null; get().loadHistory(); }, 500);
    }
  },

  handleRunDelta: (delta: RunStateDelta) => {
    if (delta.status && ["success", "failed", "cancelled", "budget_exceeded"].includes(delta.status)) {
      flushLogBuffer();
    }
    set((s) => {
      if (!s.runState || s.runState.run_id !== delta.run_id) return {};
      // Mutate node_results in-place to avoid O(N) spread per delta.
      // This is safe because each RunState object is a unique reference
      // created by this store, and Zustand triggers re-renders on the
      // outer runState reference change (which we always produce below).
      if (delta.node_result) {
        s.runState.node_results[delta.node_result.node_id] = delta.node_result;
      }
      const updated: RunState = {
        ...s.runState,
        status: delta.status ?? s.runState.status,
        current_node: delta.current_node !== undefined ? delta.current_node : s.runState.current_node,
        total_cost_usd: delta.total_cost_usd ?? s.runState.total_cost_usd,
      };
      const isFinished = ["success", "failed", "cancelled", "budget_exceeded"].includes(updated.status);
      return {
        runState: updated,
        running: !isFinished,
        runHistory: isFinished ? [stripForHistory(updated), ...s.runHistory].slice(0, 10) : s.runHistory,
      };
    });
    const current = get().runState;
    if (current && ["success", "failed", "cancelled", "budget_exceeded"].includes(current.status)) {
      if (historyDebounce) clearTimeout(historyDebounce);
      historyDebounce = setTimeout(() => { historyDebounce = null; get().loadHistory(); }, 500);
    }
  },

  handleNodeLog: (event: NodeLogEvent) => {
    const buf = logBuffer[event.node_id];
    if (buf) {
      buf.push(event.line);
    } else {
      logBuffer[event.node_id] = [event.line];
    }
    scheduleLogFlush();
  },

  handleNodeLogBatch: (event: NodeLogBatchEvent) => {
    if (event.lines.length === 0) return;
    const buf = logBuffer[event.node_id];
    if (buf) {
      buf.push(...event.lines);
    } else {
      logBuffer[event.node_id] = event.lines.slice();
    }
    scheduleLogFlush();
  },

  handleApprovalRequest: (req: ApprovalRequest) => {
    set({ approvalRequest: req });
  },

  clearRun: () => {
    clearDurationCache();
    set({ runState: null, logs: {}, approvalRequest: null });
  },

  getNodeLogs: (nodeId: string) => {
    return get().logs[nodeId] || [];
  },

  loadHistory: async () => {
    try {
      const history = await api.listRunHistory(50);
      set({ persistedHistory: history });
    } catch {
      // DB might not be ready yet
    }
  },
}));
