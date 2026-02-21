import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useRunStore } from "../../stores/runStore";
import { useUIStore } from "../../stores/uiStore";
import type { Viewport } from "@xyflow/react";
import BaseNode from "./nodes/BaseNode";
import ConditionalEdge from "./edges/ConditionalEdge";
import NodePalette from "./NodePalette";
import { computeLayout } from "../../lib/autoLayout";
import { getCachedLayout, saveCachedLayout, updateCachedNodePosition } from "../../lib/layoutCache";
import type { FlowNodeData } from "./nodes/BaseNode";
import type { NodeType, PipelineNode } from "../../types/pipeline";
import { formatDuration } from "../../lib/format";
import { useEffect, useRef } from "react";

const nodeTypes: NodeTypes = {
  pipelineNode: BaseNode,
};

const edgeTypes: EdgeTypes = {
  conditional: ConditionalEdge,
  flow: ConditionalEdge,
};

function pipelineNodesToFlow(
  nodes: PipelineNode[],
  nodeStatuses?: Record<string, string>,
  nodeCosts?: Record<string, number | null>,
  cachedPositions?: Record<string, { x: number; y: number }> | null,
  nodeDurations?: Record<string, string | undefined>,
): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "pipelineNode",
    position: cachedPositions?.[n.id] ?? n.position,
    data: {
      label: n.name,
      nodeType: n.type,
      instructions: n.instructions,
      inputs: n.inputs,
      outputs: n.outputs,
      agent: n.agent,
      pipelineRef: n.pipeline_ref,
      runStatus: nodeStatuses?.[n.id],
      costUsd: nodeCosts?.[n.id] ?? undefined,
      durationStr: nodeDurations?.[n.id],
    } satisfies FlowNodeData,
  }));
}

function pipelineEdgesToFlow(
  edges: { id: string; from: string; to: string; condition?: string }[],
): Edge[] {
  return edges.map((e) => {
    const strokeColor = e.condition === "success"
      ? "#22c55e"
      : e.condition === "failure"
        ? "#ef4444"
        : "#71717a";
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: e.condition ? "conditional" : "flow",
      data: { condition: e.condition },
      animated: true,
      style: { stroke: strokeColor, strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 16,
        height: 16,
      },
    };
  });
}

export default function Canvas() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const currentPipelinePath = usePipelineStore((s) => s.currentPipelinePath);
  const addNode = usePipelineStore((s) => s.addNode);
  const addPipelineEdge = usePipelineStore((s) => s.addEdge);
  const updateNodePosition = usePipelineStore((s) => s.updateNodePosition);
  const removeNode = usePipelineStore((s) => s.removeNode);
  const removeEdge = usePipelineStore((s) => s.removeEdge);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const selectEdge = usePipelineStore((s) => s.selectEdge);
  const updateAllNodePositions = usePipelineStore((s) => s.updateAllNodePositions);
  const runState = useRunStore((s) => s.runState);
  const openPanel = useUIStore((s) => s.openPanel);
  const setZoomLevel = useUIStore((s) => s.setZoomLevel);
  const fitViewTrigger = useUIStore((s) => s.fitViewTrigger);

  // Build node status and cost maps from run state
  const nodeStatuses = useMemo(() => {
    if (!runState) return undefined;
    const statuses: Record<string, string> = {};
    for (const [nodeId, result] of Object.entries(runState.node_results)) {
      statuses[nodeId] = result.status;
    }
    return statuses;
  }, [runState]);

  const nodeCosts = useMemo(() => {
    if (!runState) return undefined;
    const costs: Record<string, number | null> = {};
    for (const [nodeId, result] of Object.entries(runState.node_results)) {
      costs[nodeId] = result.cost_usd;
    }
    return costs;
  }, [runState]);

  const nodeDurations = useMemo(() => {
    if (!runState) return undefined;
    const durations: Record<string, string | undefined> = {};
    for (const [nodeId, result] of Object.entries(runState.node_results)) {
      if (result.started_at && result.finished_at) {
        const dur = formatDuration(result.started_at, result.finished_at);
        durations[nodeId] = dur || undefined;
      }
    }
    return durations;
  }, [runState]);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const [minimapOverlap, setMinimapOverlap] = useState(false);

  // Check overlap only when movement stops — CSS transition handles the visual smoothing
  const checkMinimapOverlap = useCallback(() => {
    const instance = reactFlowInstance.current;
    const wrapper = reactFlowWrapper.current;
    if (!instance || !wrapper || !currentPipeline) return;

    const minimapEl = wrapper.querySelector(".react-flow__minimap");
    if (!minimapEl) return;

    const mmRect = minimapEl.getBoundingClientRect();
    const NODE_W = 200;
    const NODE_H = 80;

    const overlaps = currentPipeline.nodes.some((node) => {
      const screenPos = instance.flowToScreenPosition(node.position);
      return (
        screenPos.x + NODE_W > mmRect.left &&
        screenPos.x < mmRect.right &&
        screenPos.y + NODE_H > mmRect.top &&
        screenPos.y < mmRect.bottom
      );
    });

    setMinimapOverlap(overlaps);
  }, [currentPipeline]);

  // Track which pipeline path we've already auto-laid out
  const autoLaidOutRef = useRef<string | null>(null);

  // Load cached layout for this pipeline (user-local positions override JSON defaults)
  const cachedPositions = useMemo(
    () => currentPipelinePath ? getCachedLayout(currentPipelinePath) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPipelinePath],
  );

  const initialNodes = useMemo(
    () => (currentPipeline ? pipelineNodesToFlow(currentPipeline.nodes, nodeStatuses, nodeCosts, cachedPositions, nodeDurations) : []),
    [currentPipeline?.nodes, nodeStatuses, nodeCosts, cachedPositions, nodeDurations],
  );

  const initialEdges = useMemo(
    () => (currentPipeline ? pipelineEdgesToFlow(currentPipeline.edges) : []),
    [currentPipeline?.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync from store to local state
  useEffect(() => {
    const cached = currentPipelinePath ? getCachedLayout(currentPipelinePath) : null;
    setNodes(currentPipeline ? pipelineNodesToFlow(currentPipeline.nodes, nodeStatuses, nodeCosts, cached, nodeDurations) : []);
  }, [currentPipeline?.nodes, nodeStatuses, nodeCosts, currentPipelinePath, setNodes, nodeDurations]);

  useEffect(() => {
    setEdges(currentPipeline ? pipelineEdgesToFlow(currentPipeline.edges) : []);
  }, [currentPipeline?.edges, setEdges]);

  // Respond to fitView triggers (e.g., Space key)
  useEffect(() => {
    if (fitViewTrigger > 0) {
      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 });
    }
  }, [fitViewTrigger]);

  // Auto-layout when a pipeline is first opened (no cached layout)
  useEffect(() => {
    if (
      !currentPipeline ||
      !currentPipelinePath ||
      currentPipeline.nodes.length === 0 ||
      autoLaidOutRef.current === currentPipelinePath
    ) return;

    autoLaidOutRef.current = currentPipelinePath;

    const cached = getCachedLayout(currentPipelinePath);
    if (cached) return; // user already has a saved layout

    try {
      const positions = computeLayout(currentPipeline.nodes, currentPipeline.edges);
      updateAllNodePositions(positions);
      saveCachedLayout(currentPipelinePath, positions);
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50);
    } catch (e) {
      console.warn("[AutoLayout] Failed to compute layout:", e);
    }
  }, [currentPipeline, currentPipelinePath, updateAllNodePositions]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({
        ...params,
        type: "flow",
        animated: true,
        style: { stroke: "#71717a", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 16, height: 16 },
      }, eds));
      if (params.source && params.target) {
        addPipelineEdge(params.source, params.target);
      }
    },
    [setEdges, addPipelineEdge],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const pos = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      };
      updateNodePosition(node.id, pos);
      if (currentPipelinePath) {
        updateCachedNodePosition(currentPipelinePath, node.id, pos);
      }
    },
    [updateNodePosition, currentPipelinePath],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      openPanel("nodeConfig");
    },
    [selectNode, openPanel],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      selectEdge(edge.id);
      openPanel("edgeConfig");
    },
    [selectEdge, openPanel],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => removeNode(n.id));
    },
    [removeNode],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((e) => removeEdge(e.id));
    },
    [removeEdge],
  );

  // Drop handler for node palette
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/agentflow-node") as NodeType;
      if (!type || !currentPipeline) return;

      // Convert screen coordinates to flow coordinates (accounts for zoom/pan)
      const position = reactFlowInstance.current
        ? reactFlowInstance.current.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          })
        : { x: event.clientX, y: event.clientY };

      addNode(type, position);
    },
    [addNode, currentPipeline],
  );

  const handleAutoLayout = useCallback(() => {
    if (!currentPipeline || currentPipeline.nodes.length === 0) return;
    try {
      const positions = computeLayout(currentPipeline.nodes, currentPipeline.edges);
      updateAllNodePositions(positions);
      if (currentPipelinePath) {
        saveCachedLayout(currentPipelinePath, positions);
      }
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50);
    } catch (e) {
      console.warn("[AutoLayout] Failed:", e);
    }
  }, [currentPipeline, currentPipelinePath, updateAllNodePositions]);

  if (!currentPipeline) {
    return (
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={[]}
          edges={[]}
          fitView
          minZoom={0.25}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          className="bg-zinc-950"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
          <Controls
            className="!bg-zinc-800 !border-zinc-600/50 !rounded-lg !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600/50 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
            position="bottom-left"
          />
        </ReactFlow>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <svg className="mx-auto mb-3 h-12 w-12 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <p className="text-sm text-zinc-600">Select a pipeline or create a new one</p>
            <p className="mt-1 text-xs text-zinc-700">Use the pipeline selector in the top bar</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { reactFlowInstance.current = instance; checkMinimapOverlap(); }}
        onMoveEnd={(_event: unknown, viewport: Viewport) => { checkMinimapOverlap(); setZoomLevel(viewport.zoom); }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.25}
        maxZoom={2.5}
        zoomOnDoubleClick={false}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-950"
        defaultEdgeOptions={{
          style: { stroke: "#71717a", strokeWidth: 2 },
          type: "flow",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 16, height: 16 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
        <Controls
          className="!bg-zinc-800 !border-zinc-600/50 !rounded-lg !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600/50 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
          position="bottom-right"
        />
        <MiniMap
          nodeColor={(node) => {
            const nd = node.data as unknown as FlowNodeData;
            const colors: Record<string, string> = {
              "ai-task": "#8b5cf6",
              "shell": "#10b981",
              "git": "#f97316",
              "parallel": "#3b82f6",
              "approval-gate": "#f59e0b",
              "sub-pipeline": "#06b6d4",
            };
            return colors[nd?.nodeType] ?? "#71717a";
          }}
          maskColor="rgba(0,0,0,0.7)"
          className={`!rounded-lg !shadow-lg transition-opacity duration-300 hover:!opacity-95 ${
            minimapOverlap
              ? "!bg-zinc-900/40 !border-zinc-700/20 !opacity-25"
              : "!bg-zinc-900/80 !border-zinc-700/50 !opacity-90"
          }`}
          position="top-right"
          pannable
          zoomable
        />
      </ReactFlow>
      <NodePalette onAutoLayout={handleAutoLayout} />
    </div>
  );
}
