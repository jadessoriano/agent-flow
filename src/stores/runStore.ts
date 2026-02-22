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

  startRun: async (pipeline, inputs, cliPath, projectPath) => {
    set({ running: true, logs: {}, approvalRequest: null, approvalResponse: null, lastRunInputs: inputs, focusedNodeId: null });
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
    set({ running: true, logs: {}, approvalRequest: null, approvalResponse: null, lastRunInputs: inputs });
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
    const MAX_LOG_LINES = 2000;
    set((s) => {
      const existing = s.logs[event.node_id] || [];
      // Mutate existing array in place to avoid per-line allocation
      existing.push(event.line);
      const trimmed = existing.length > MAX_LOG_LINES
        ? existing.slice(-MAX_LOG_LINES)
        : existing;
      return {
        logs: { ...s.logs, [event.node_id]: trimmed },
      };
    });
  },

  handleNodeLogBatch: (event: NodeLogBatchEvent) => {
    const MAX_LOG_LINES = 2000;
    if (event.lines.length === 0) return;
    set((s) => {
      const existing = s.logs[event.node_id] || [];
      // Concat batch in one operation instead of per-line state updates
      const updated = existing.concat(event.lines);
      return {
        logs: {
          ...s.logs,
          [event.node_id]: updated.length > MAX_LOG_LINES
            ? updated.slice(-MAX_LOG_LINES)
            : updated,
        },
      };
    });
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
