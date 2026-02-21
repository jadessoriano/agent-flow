import { create } from "zustand";
import type {
  Pipeline,
  PipelineInfo,
  PipelineNode,
  PipelineEdge,
  NodeType,
} from "../types/pipeline";
import * as api from "../lib/tauri";

let nodeIdCounter = 0;
const MAX_HISTORY = 30;

function nextNodeId(): string {
  return `node-${Date.now()}-${nodeIdCounter++}`;
}

function nextEdgeId(): string {
  return `edge-${Date.now()}-${nodeIdCounter++}`;
}

interface PipelineState {
  pipelines: PipelineInfo[];
  currentPipeline: Pipeline | null;
  currentPipelinePath: string | null;
  savedPipeline: Pipeline | null;
  dirty: boolean;
  loading: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  undoStack: Pipeline[];
  redoStack: Pipeline[];
  clipboardNode: PipelineNode | null;

  loadPipelines: (projectPath: string) => Promise<void>;
  openPipeline: (path: string) => Promise<void>;
  savePipeline: (projectPath: string) => Promise<void>;
  createPipeline: (projectPath: string, name: string) => void;
  createFromTemplate: (projectPath: string, template: Pipeline) => void;
  deletePipeline: (projectPath: string, path: string) => Promise<void>;
  closePipeline: () => void;
  loadGeneratedPipeline: (projectPath: string, pipeline: Pipeline) => Promise<void>;

  // Canvas operations
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNode: (id: string, updates: Partial<PipelineNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (from: string, to: string, condition?: string) => void;
  updateEdge: (id: string, updates: Partial<PipelineEdge>) => void;
  removeEdge: (id: string) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  updateAllNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  updatePipelineMeta: (updates: Partial<Pipeline>) => void;
  copyNode: () => void;
  pasteNode: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  pipelines: [],
  currentPipeline: null,
  currentPipelinePath: null,
  savedPipeline: null,
  dirty: false,
  loading: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  undoStack: [],
  redoStack: [],
  clipboardNode: null,

  loadPipelines: async (projectPath: string) => {
    try {
      const pipelines = await api.listPipelines(projectPath);
      set({ pipelines });
    } catch {
      set({ pipelines: [] });
    }
  },

  openPipeline: async (path: string) => {
    set({ loading: true });
    try {
      const pipeline = await api.readPipeline(path);
      set({
        currentPipeline: pipeline,
        currentPipelinePath: path,
        savedPipeline: structuredClone(pipeline),
        dirty: false,
        loading: false,
        selectedNodeId: null,
        selectedEdgeId: null,
      });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  savePipeline: async (projectPath: string) => {
    const { currentPipeline, currentPipelinePath } = get();
    if (!currentPipeline) return;
    try {
      // Detect name change: if the pipeline was previously saved, check if the name differs
      if (currentPipelinePath) {
        const filename = currentPipelinePath.split("/").pop() ?? currentPipelinePath.split("\\").pop() ?? "";
        const oldSafeName = filename.replace(".pipeline.json", "");
        const newSafeName = currentPipeline.name.replace(/[^a-zA-Z0-9\-_]/g, "-");
        if (oldSafeName && oldSafeName !== newSafeName) {
          // Name changed — use rename to clean up old agent markdown
          const path = await api.renamePipeline(projectPath, currentPipelinePath, currentPipeline.name);
          set({ currentPipelinePath: path, dirty: false, savedPipeline: structuredClone(currentPipeline) });
          get().loadPipelines(projectPath);
          return;
        }
      }
      const path = await api.writePipeline(projectPath, currentPipeline);
      set({ currentPipelinePath: path, dirty: false, savedPipeline: structuredClone(currentPipeline) });
      get().loadPipelines(projectPath);
    } catch (e) {
      throw e;
    }
  },

  createPipeline: (projectPath: string, name: string) => {
    const pipeline: Pipeline = {
      name,
      description: "",
      version: "1.0.0",
      variables: {},
      nodes: [],
      edges: [],
    };
    set({
      currentPipeline: pipeline,
      currentPipelinePath: null,
      dirty: true,
      selectedNodeId: null,
    });
    // Auto-save to create the file
    void (async () => {
      try {
        const path = await api.writePipeline(projectPath, pipeline);
        set({ currentPipelinePath: path, dirty: false });
        const store = usePipelineStore.getState();
        store.loadPipelines(projectPath);
      } catch {
        // ignore
      }
    })();
  },

  deletePipeline: async (projectPath: string, path: string) => {
    await api.deletePipeline(projectPath, path);
    const { currentPipelinePath } = get();
    if (currentPipelinePath === path) {
      set({ currentPipeline: null, currentPipelinePath: null, dirty: false });
    }
    get().loadPipelines(projectPath);
  },

  closePipeline: () => {
    set({
      currentPipeline: null,
      currentPipelinePath: null,
      dirty: false,
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  createFromTemplate: (projectPath: string, template: Pipeline) => {
    const pipeline = structuredClone(template);
    set({
      currentPipeline: pipeline,
      currentPipelinePath: null,
      dirty: true,
      selectedNodeId: null,
    });
    void (async () => {
      try {
        const path = await api.writePipeline(projectPath, pipeline);
        set({ currentPipelinePath: path, dirty: false, savedPipeline: structuredClone(pipeline) });
        const store = usePipelineStore.getState();
        store.loadPipelines(projectPath);
      } catch {
        // ignore
      }
    })();
  },

  loadGeneratedPipeline: async (projectPath: string, pipeline: Pipeline) => {
    try {
      const path = await api.writePipeline(projectPath, pipeline);
      set({
        currentPipeline: pipeline,
        currentPipelinePath: path,
        dirty: false,
        selectedNodeId: null,
        selectedEdgeId: null,
        undoStack: [],
        redoStack: [],
      });
      const store = usePipelineStore.getState();
      store.loadPipelines(projectPath);
    } catch (e) {
      throw e;
    }
  },

  addNode: (type: NodeType, position: { x: number; y: number }) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    const typeLabels: Record<NodeType, string> = {
      "ai-task": "AI Task",
      shell: "Shell Command",
      git: "Git Operation",
      parallel: "Parallel Group",
      "approval-gate": "Approval Gate",
      "sub-pipeline": "Sub-pipeline",
      comment: "Comment",
    };

    const node: PipelineNode = {
      id: nextNodeId(),
      name: typeLabels[type],
      type,
      instructions: "",
      inputs: [],
      outputs: [],
      requires_tools: [],
      position,
    };

    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: [...currentPipeline.nodes, node],
      },
      dirty: true,
      selectedNodeId: node.id,
    });
  },

  updateNode: (id: string, updates: Partial<PipelineNode>) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: currentPipeline.nodes.map((n) =>
          n.id === id ? { ...n, ...updates } : n,
        ),
      },
      dirty: true,
    });
  },

  removeNode: (id: string) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: currentPipeline.nodes.filter((n) => n.id !== id),
        edges: currentPipeline.edges.filter(
          (e) => e.from !== id && e.to !== id,
        ),
      },
      dirty: true,
      selectedNodeId: null,
    });
  },

  addEdge: (from: string, to: string, condition?: string) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    // Prevent duplicate edges
    const exists = currentPipeline.edges.some(
      (e) => e.from === from && e.to === to,
    );
    if (exists) return;

    const edge: PipelineEdge = {
      id: nextEdgeId(),
      from,
      to,
      ...(condition ? { condition } : {}),
    };

    set({
      currentPipeline: {
        ...currentPipeline,
        edges: [...currentPipeline.edges, edge],
      },
      dirty: true,
    });
  },

  updateEdge: (id: string, updates: Partial<PipelineEdge>) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    set({
      currentPipeline: {
        ...currentPipeline,
        edges: currentPipeline.edges.map((e) =>
          e.id === id ? { ...e, ...updates } : e,
        ),
      },
      dirty: true,
    });
  },

  removeEdge: (id: string) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    set({
      currentPipeline: {
        ...currentPipeline,
        edges: currentPipeline.edges.filter((e) => e.id !== id),
      },
      dirty: true,
    });
  },

  updateNodePosition: (id: string, position: { x: number; y: number }) => {
    const { currentPipeline } = get();
    if (!currentPipeline) return;

    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: currentPipeline.nodes.map((n) =>
          n.id === id ? { ...n, position } : n,
        ),
      },
      dirty: true,
    });
  },

  updateAllNodePositions: (positions: Record<string, { x: number; y: number }>) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });
    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: currentPipeline.nodes.map((n) =>
          positions[n.id] ? { ...n, position: positions[n.id] } : n,
        ),
      },
      dirty: true,
    });
  },

  selectNode: (id: string | null) => {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },

  selectEdge: (id: string | null) => {
    set({ selectedEdgeId: id, selectedNodeId: null });
  },

  updatePipelineMeta: (updates: Partial<Pipeline>) => {
    const { currentPipeline, undoStack } = get();
    if (!currentPipeline) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });
    set({
      currentPipeline: { ...currentPipeline, ...updates },
      dirty: true,
    });
  },

  copyNode: () => {
    const { currentPipeline, selectedNodeId } = get();
    if (!currentPipeline || !selectedNodeId) return;
    const node = currentPipeline.nodes.find((n) => n.id === selectedNodeId);
    if (node) {
      set({ clipboardNode: structuredClone(node) });
    }
  },

  pasteNode: () => {
    const { currentPipeline, clipboardNode, undoStack } = get();
    if (!currentPipeline || !clipboardNode) return;
    set({ undoStack: [...undoStack, structuredClone(currentPipeline)].slice(-MAX_HISTORY), redoStack: [] });

    const newNode: PipelineNode = {
      ...structuredClone(clipboardNode),
      id: nextNodeId(),
      name: `${clipboardNode.name} (copy)`,
      position: {
        x: clipboardNode.position.x + 40,
        y: clipboardNode.position.y + 40,
      },
    };

    set({
      currentPipeline: {
        ...currentPipeline,
        nodes: [...currentPipeline.nodes, newNode],
      },
      dirty: true,
      selectedNodeId: newNode.id,
    });
  },

  undo: () => {
    const { currentPipeline, undoStack, redoStack } = get();
    if (undoStack.length === 0 || !currentPipeline) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      currentPipeline: prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, structuredClone(currentPipeline)],
      dirty: true,
    });
  },

  redo: () => {
    const { currentPipeline, undoStack, redoStack } = get();
    if (redoStack.length === 0 || !currentPipeline) return;
    const next = redoStack[redoStack.length - 1];
    set({
      currentPipeline: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, structuredClone(currentPipeline)],
      dirty: true,
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
