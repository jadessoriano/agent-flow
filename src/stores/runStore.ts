import { create } from "zustand";
import type {
  RunState,
  NodeLogEvent,
  ApprovalRequest,
  RunRow,
} from "../types/run";
import * as api from "../lib/tauri";
import type { Pipeline } from "../types/pipeline";

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
  handleNodeLog: (event: NodeLogEvent) => void;
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
    // Auto-clear after 3 seconds
    setTimeout(() => {
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
    const isFinished = ["success", "failed", "cancelled"].includes(
      state.status,
    );
    set((s) => ({
      runState: state,
      running: !isFinished,
      runHistory: isFinished
        ? [state, ...s.runHistory].slice(0, 50)
        : s.runHistory,
    }));
    // Refresh persisted history when a run finishes
    if (isFinished) {
      get().loadHistory();
    }
  },

  handleNodeLog: (event: NodeLogEvent) => {
    set((s) => ({
      logs: {
        ...s.logs,
        [event.node_id]: [...(s.logs[event.node_id] || []), event.line],
      },
    }));
  },

  handleApprovalRequest: (req: ApprovalRequest) => {
    set({ approvalRequest: req });
  },

  clearRun: () => {
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
