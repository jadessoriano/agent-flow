import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  BackgroundVariant,
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
import { useProjectStore } from "../../stores/projectStore";
import { useRunStore } from "../../stores/runStore";
import { useUIStore } from "../../stores/uiStore";
import type { Viewport } from "@xyflow/react";
import BaseNode from "./nodes/BaseNode";
import ConditionalEdge from "./edges/ConditionalEdge";
import NodePalette from "./NodePalette";
import { computeLayoutAsync } from "../../lib/autoLayoutAsync";
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
};

const MINIMAP_NODE_COLORS: Record<string, string> = {
  "ai-task": "#8b5cf6",
  "shell": "#10b981",
  "git": "#f97316",
  "parallel": "#3b82f6",
  "loop": "#ec4899",
  "approval-gate": "#f59e0b",
  "sub-pipeline": "#06b6d4",
  "comment": "#a1a1aa",
};

function minimapNodeColor(node: Node): string {
  const nd = node.data as unknown as FlowNodeData;
  return MINIMAP_NODE_COLORS[nd?.nodeType] ?? "#71717a";
}

/** Build a map of child node ID → parent node info for loop/parallel groups */
function buildChildParentMap(
  nodes: PipelineNode[],
  cachedPositions?: Record<string, { x: number; y: number }> | null,
): Map<string, { name: string; type: NodeType; side: "left" | "right" }> {
  const map = new Map<string, { name: string; type: NodeType; side: "left" | "right" }>();
  for (const node of nodes) {
    if ((node.type === "loop" || node.type === "parallel") && node.children?.length) {
      const parentPos = cachedPositions?.[node.id] ?? node.position;
      for (const cid of node.children) {
        const childPos = cachedPositions?.[cid] ?? nodes.find((n) => n.id === cid)?.position;
        const childIsLeft = childPos != null && childPos.x + 200 < parentPos.x + 100;
        map.set(cid, { name: node.name, type: node.type, side: childIsLeft ? "right" : "left" });
      }
    }
  }
  return map;
}

/** Color for synthetic edges by parent node type */
const SYNTH_EDGE_COLORS: Partial<Record<NodeType, string>> = {
  loop: "#ec4899",     // pink
  parallel: "#3b82f6", // blue
};

/** Build sets of node IDs that have incoming/outgoing connections (edges + implicit children) */
function buildConnectionSets(
  nodes: PipelineNode[],
  edges: { from: string; to: string }[],
): { incoming: Set<string>; outgoing: Set<string> } {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of edges) {
    outgoing.add(e.from);
    incoming.add(e.to);
  }
  // Implicit connections: loop/parallel parent → children
  for (const node of nodes) {
    if ((node.type === "loop" || node.type === "parallel") && node.children?.length) {
      outgoing.add(node.id);
      for (const cid of node.children) incoming.add(cid);
    }
  }
  return { incoming, outgoing };
}

function pipelineNodesToFlow(
  nodes: PipelineNode[],
  nodeStatuses?: Record<string, string>,
  nodeCosts?: Record<string, number | null>,
  cachedPositions?: Record<string, { x: number; y: number }> | null,
  nodeDurations?: Record<string, string | undefined>,
  childParentMap?: Map<string, { name: string; type: NodeType; side: "left" | "right" }>,
  connectionSets?: { incoming: Set<string>; outgoing: Set<string> },
  compact?: boolean,
): Node[] {
  return nodes.map((n) => {
    const parent = childParentMap?.get(n.id);
    return {
      id: n.id,
      type: "pipelineNode",
      position: cachedPositions?.[n.id] ?? n.position,
      style: { cursor: "pointer" },
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
        groupParentName: parent?.name,
        groupParentType: parent?.type,
        groupParentSide: parent?.side,
        hasIncoming: connectionSets?.incoming.has(n.id),
        hasOutgoing: connectionSets?.outgoing.has(n.id),
        compact: compact || false,
      } satisfies FlowNodeData,
    };
  });
}

/** Compute Y midpoint of all nodes for backward edge routing decisions */
function computeGraphMidY(
  nodes: PipelineNode[],
  cachedPositions?: Record<string, { x: number; y: number }> | null,
): number {
  if (nodes.length === 0) return 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const y = cachedPositions?.[n.id]?.y ?? n.position.y;
    if (y < minY) minY = y;
    if (y + 80 > maxY) maxY = y + 80;
  }
  return (minY + maxY) / 2;
}

const NODE_W = 200;
const NODE_H = 80;

/** Estimate the handle position for a node */
function handlePos(
  nodeId: string,
  side: "source" | "target",
  nodeMap: Map<string, { x: number; y: number }>,
): { x: number; y: number } | null {
  const pos = nodeMap.get(nodeId);
  if (!pos) return null;
  return side === "source"
    ? { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 }
    : { x: pos.x, y: pos.y + NODE_H / 2 };
}

/** Check if a straight line between two points crosses any node bounding boxes */
function hasNodeObstacle(
  sx: number, sy: number, tx: number, ty: number,
  nodeRects: { x: number; y: number; w: number; h: number }[],
  excludeNodes: Set<string>,
  nodeIds: string[],
): boolean {
  const pad = 15;
  const minX = Math.min(sx, tx) + pad;
  const maxX = Math.max(sx, tx) - pad;
  if (maxX <= minX) return false;

  const edgeMinY = Math.min(sy, ty) - 15;
  const edgeMaxY = Math.max(sy, ty) + 15;

  for (let i = 0; i < nodeRects.length; i++) {
    if (excludeNodes.has(nodeIds[i])) continue;
    const r = nodeRects[i];
    if (r.x + r.w < minX || r.x > maxX) continue;
    if (r.y + r.h < edgeMinY || r.y > edgeMaxY) continue;
    return true;
  }
  return false;
}

/**
 * Compute route offsets for edges that need rerouting (backward or obstacle).
 * Assigns different lanes to avoid edge-to-edge crossings where possible.
 *
 * Returns a Map of edgeId → routeOffset.
 */
function computeRouteOffsets(
  edges: { id: string; from: string; to: string; condition?: string }[],
  nodeMap: Map<string, { x: number; y: number }>,
  nodeRects: { x: number; y: number; w: number; h: number }[],
  nodeIds: string[],
  graphMidY: number,
): Map<string, number> {
  const offsets = new Map<string, number>();

  // Classify edges that need rerouting
  type RerouteInfo = { id: string; sx: number; sy: number; tx: number; ty: number; kind: "backward" | "obstacle" };
  const toReroute: RerouteInfo[] = [];

  for (const e of edges) {
    const src = handlePos(e.from, "source", nodeMap);
    const tgt = handlePos(e.to, "target", nodeMap);
    if (!src || !tgt) continue;

    const isBackward = src.x > tgt.x - 20;
    if (isBackward) {
      toReroute.push({ id: e.id, sx: src.x, sy: src.y, tx: tgt.x, ty: tgt.y, kind: "backward" });
      continue;
    }

    const exclude = new Set([e.from, e.to]);
    if (hasNodeObstacle(src.x, src.y, tgt.x, tgt.y, nodeRects, exclude, nodeIds)) {
      toReroute.push({ id: e.id, sx: src.x, sy: src.y, tx: tgt.x, ty: tgt.y, kind: "obstacle" });
    }
  }

  if (toReroute.length === 0) return offsets;

  // Candidate lanes: alternating above/below with increasing distance
  // [-60, +60, -120, +120, -180, +180, ...]
  const MAX_LANES = 8;
  const LANE_STEP = 60;
  const lanes: number[] = [];
  for (let i = 1; i <= MAX_LANES; i++) {
    lanes.push(-i * LANE_STEP);
    lanes.push(i * LANE_STEP);
  }

  // Track which lanes are already used (by approximate Y region)
  // Key: a bucket representing the horizontal span, Value: set of used lane offsets
  const usedLanes = new Map<string, Set<number>>();

  function spanKey(sx: number, tx: number): string {
    // Bucket by 200px horizontal chunks to detect overlapping edges
    const lo = Math.floor(Math.min(sx, tx) / 200);
    const hi = Math.floor(Math.max(sx, tx) / 200);
    return `${lo}-${hi}`;
  }

  // Sort: backward edges first, then by horizontal span (wider first)
  // so wider spans get first pick of lanes
  toReroute.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "backward" ? -1 : 1;
    return Math.abs(b.sx - b.tx) - Math.abs(a.sx - a.tx);
  });

  for (const info of toReroute) {
    const key = spanKey(info.sx, info.tx);
    const used = usedLanes.get(key) ?? new Set();

    // For backward edges, prefer routing to the side with more space
    const edgeMidY = (info.sy + info.ty) / 2;
    const preferBelow = edgeMidY < graphMidY;

    // Try lanes in preference order
    let bestLane = preferBelow ? LANE_STEP : -LANE_STEP;
    const sortedLanes = [...lanes].sort((a, b) => {
      // Prefer the direction with more space
      const aPreferred = preferBelow ? (a > 0 ? 0 : 1) : (a < 0 ? 0 : 1);
      const bPreferred = preferBelow ? (b > 0 ? 0 : 1) : (b < 0 ? 0 : 1);
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      // Then prefer smaller magnitude (closer to nodes)
      return Math.abs(a) - Math.abs(b);
    });

    for (const lane of sortedLanes) {
      if (!used.has(lane)) {
        bestLane = lane;
        break;
      }
    }

    used.add(bestLane);
    usedLanes.set(key, used);
    offsets.set(info.id, bestLane);
  }

  return offsets;
}

function pipelineEdgesToFlow(
  edges: { id: string; from: string; to: string; condition?: string }[],
  nodes?: PipelineNode[],
  graphMidY?: number,
  cachedPositions?: Record<string, { x: number; y: number }> | null,
): Edge[] {
  // Build node position map and bounding boxes
  const nodeMap = new Map<string, { x: number; y: number }>();
  const nodeRects: { x: number; y: number; w: number; h: number }[] = [];
  const nodeIds: string[] = [];
  if (nodes) {
    for (const n of nodes) {
      const pos = cachedPositions?.[n.id] ?? n.position;
      nodeMap.set(n.id, pos);
      nodeRects.push({ x: pos.x, y: pos.y, w: NODE_W, h: NODE_H });
      nodeIds.push(n.id);
    }
  }

  // Compute centralized route offsets for edges that need rerouting
  const routeOffsets = computeRouteOffsets(edges, nodeMap, nodeRects, nodeIds, graphMidY ?? 0);

  const flowEdges: Edge[] = edges.map((e) => {
    const strokeColor = e.condition === "success"
      ? "#22c55e"
      : e.condition === "failure"
        ? "#ef4444"
        : "#a1a1aa";
    return {
      id: e.id,
      source: e.from,
      sourceHandle: "right",
      target: e.to,
      targetHandle: "left",
      type: "conditional",
      data: {
        condition: e.condition,
        graphMidY,
        routeOffset: routeOffsets.get(e.id) ?? 0,
      },
      style: { stroke: strokeColor, strokeWidth: 2 },
    };
  });

  // Generate synthetic dashed edges for loop/parallel children
  // Uses the closest pair of handles based on relative node positions
  if (nodes) {
    for (const node of nodes) {
      if ((node.type === "loop" || node.type === "parallel") && node.children?.length) {
        const color = SYNTH_EDGE_COLORS[node.type] ?? "#71717a";
        const label = node.type === "loop" ? "each item \u21BB" : "branch \u2225";
        const parentPos = nodeMap.get(node.id);
        for (const cid of node.children) {
          const childPos = nodeMap.get(cid);
          // If child is to the left of parent, connect parent's left → child's right
          const childIsLeft = parentPos && childPos && childPos.x + NODE_W < parentPos.x + NODE_W / 2;
          flowEdges.push({
            id: `_synth_${node.id}_${cid}`,
            source: node.id,
            sourceHandle: childIsLeft ? "left-out" : "right",
            target: cid,
            targetHandle: childIsLeft ? "right-in" : "left",
            type: "conditional",
            deletable: false,
            selectable: false,
            data: { synthetic: true, synthLabel: label, synthColor: color, directPath: childIsLeft || false },
            style: {
              stroke: color,
              strokeWidth: 1.5,
              strokeDasharray: "6,4",
              opacity: 0.7,
            },
          });
        }
      }
    }
  }

  return flowEdges;
}

export default function Canvas() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const currentPipelinePath = usePipelineStore((s) => s.currentPipelinePath);
  const createFromTemplate = usePipelineStore((s) => s.createFromTemplate);
  const addNode = usePipelineStore((s) => s.addNode);
  const currentProject = useProjectStore((s) => s.currentProject);
  const addPipelineEdge = usePipelineStore((s) => s.addEdge);
  const updateNodePosition = usePipelineStore((s) => s.updateNodePosition);
  const removeNode = usePipelineStore((s) => s.removeNode);
  const removeEdge = usePipelineStore((s) => s.removeEdge);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const selectEdge = usePipelineStore((s) => s.selectEdge);
  const pushUndoSnapshot = usePipelineStore((s) => s.pushUndoSnapshot);
  const updateAllNodePositions = usePipelineStore((s) => s.updateAllNodePositions);
  const runState = useRunStore((s) => s.runState);
  const running = useRunStore((s) => s.running);
  const openPanel = useUIStore((s) => s.openPanel);
  const setZoomLevel = useUIStore((s) => s.setZoomLevel);
  const fitViewTrigger = useUIStore((s) => s.fitViewTrigger);
  const focusNodeId = useUIStore((s) => s.focusNodeId);
  const clearFocusNode = useUIStore((s) => s.clearFocusNode);
  const compactCanvas = useUIStore((s) => s.compactCanvas);
  const toggleCompactCanvas = useUIStore((s) => s.toggleCompactCanvas);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const [minimapOverlap, setMinimapOverlap] = useState(false);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const [hoveredNodeId, _setHoveredNodeId] = useState<string | null>(null);
  const isPanningRef = useRef(false);
  /** Track whether dim/highlight classes are currently applied to avoid no-op setNodes/setEdges */
  const highlightAppliedRef = useRef(false);

  // Guarded setter: skip if value unchanged or panning
  const setHoveredNodeId = useCallback((id: string | null) => {
    if (id === hoveredNodeIdRef.current) return;
    hoveredNodeIdRef.current = id;
    _setHoveredNodeId(id);
  }, []);

  // Check overlap only when movement stops — CSS transition handles the visual smoothing
  const checkMinimapOverlap = useCallback(() => {
    const instance = reactFlowInstance.current;
    const wrapper = reactFlowWrapper.current;
    if (!instance || !wrapper || !currentPipeline) return;

    const minimapEl = wrapper.querySelector(".react-flow__minimap");
    if (!minimapEl) return;

    const mmRect = minimapEl.getBoundingClientRect();

    const overlaps = currentPipeline.nodes.some((node) => {
      const screenPos = instance.flowToScreenPosition(node.position);
      return (
        screenPos.x + NODE_W > mmRect.left &&
        screenPos.x < mmRect.right &&
        screenPos.y + NODE_H > mmRect.top &&
        screenPos.y < mmRect.bottom
      );
    });

    // Only update state when value actually changes to avoid unnecessary re-renders
    setMinimapOverlap((prev) => prev === overlaps ? prev : overlaps);
  }, [currentPipeline]);

  // Track which pipeline path we've already auto-laid out
  const autoLaidOutRef = useRef<string | null>(null);

  // Load cached layout for this pipeline (user-local positions override JSON defaults)
  const cachedPositions = useMemo(
    () => currentPipelinePath ? getCachedLayout(currentPipelinePath) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPipelinePath],
  );

  const childParentMap = useMemo(
    () => (currentPipeline ? buildChildParentMap(currentPipeline.nodes, cachedPositions) : new Map()),
    [currentPipeline?.nodes, cachedPositions],
  );

  const connectionSets = useMemo(
    () => (currentPipeline ? buildConnectionSets(currentPipeline.nodes, currentPipeline.edges) : { incoming: new Set<string>(), outgoing: new Set<string>() }),
    [currentPipeline?.nodes, currentPipeline?.edges],
  );

  // Cached parent↔child maps for hover highlight (only depends on pipeline nodes, not hoveredNodeId)
  const { hoverParentToChildren, hoverChildToParent } = useMemo(() => {
    if (!currentPipeline) return { hoverParentToChildren: new Map<string, string[]>(), hoverChildToParent: new Map<string, string>() };
    const hoverParentToChildren = new Map<string, string[]>();
    const hoverChildToParent = new Map<string, string>();
    for (const node of currentPipeline.nodes) {
      if ((node.type === "loop" || node.type === "parallel") && node.children?.length) {
        hoverParentToChildren.set(node.id, node.children);
        for (const cid of node.children) {
          hoverChildToParent.set(cid, node.id);
        }
      }
    }
    return { hoverParentToChildren, hoverChildToParent };
  }, [currentPipeline?.nodes]);

  const initialNodes = useMemo(
    () => (currentPipeline ? pipelineNodesToFlow(currentPipeline.nodes, undefined, undefined, cachedPositions, undefined, childParentMap, connectionSets, compactCanvas) : []),
    [currentPipeline?.nodes, cachedPositions, childParentMap, connectionSets, compactCanvas],
  );

  const graphMidY = useMemo(
    () => (currentPipeline ? computeGraphMidY(currentPipeline.nodes, cachedPositions) : 0),
    [currentPipeline?.nodes, cachedPositions],
  );

  const initialEdges = useMemo(
    () => (currentPipeline ? pipelineEdgesToFlow(currentPipeline.edges, currentPipeline.nodes, graphMidY, cachedPositions) : []),
    [currentPipeline?.edges, currentPipeline?.nodes, graphMidY, cachedPositions],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync pipeline structure to local state (only when nodes change, NOT on run status).
  // Use positions from pipeline nodes directly (correct after undo/redo),
  // falling back to cached positions only on initial pipeline load.
  useEffect(() => {
    const cached = currentPipelinePath ? getCachedLayout(currentPipelinePath) : null;
    setNodes(currentPipeline ? pipelineNodesToFlow(currentPipeline.nodes, undefined, undefined, cached, undefined, childParentMap, connectionSets, compactCanvas) : []);
  }, [currentPipeline?.nodes, currentPipelinePath, setNodes, childParentMap, connectionSets, compactCanvas]);

  // Update run status/cost/duration in-place (avoids full node rebuild on every run-update)
  // Only apply results when the run belongs to the currently open pipeline
  const runBelongsToPipeline =
    runState != null &&
    currentPipeline != null &&
    runState.pipeline_name === currentPipeline.name;
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => {
        const d = node.data as unknown as FlowNodeData;
        const result = runBelongsToPipeline ? runState?.node_results[node.id] : undefined;
        const newStatus = result?.status;
        const newCost = result?.cost_usd ?? undefined;
        const newDur = result?.started_at && result?.finished_at
          ? (formatDuration(result.started_at, result.finished_at) || undefined)
          : undefined;
        if (d.runStatus === newStatus && d.costUsd === newCost && d.durationStr === newDur) {
          return node; // no change — keep same reference
        }
        return {
          ...node,
          data: { ...d, runStatus: newStatus, costUsd: newCost, durationStr: newDur },
        };
      }),
    );
  }, [runState, runBelongsToPipeline, setNodes]);

  useEffect(() => {
    setEdges(currentPipeline ? pipelineEdgesToFlow(currentPipeline.edges, currentPipeline.nodes, graphMidY, cachedPositions) : []);
  }, [currentPipeline?.edges, currentPipeline?.nodes, graphMidY, cachedPositions, setEdges]);

  // Hover highlight: compute which nodes and edges should stay bright
  const highlightSets = useMemo(() => {
    if (!hoveredNodeId || !currentPipeline) return null;

    const highlightedNodes = new Set<string>();
    const highlightedEdges = new Set<string>();

    highlightedNodes.add(hoveredNodeId);

    // If hovered node is a parent → highlight all its children
    const children = hoverParentToChildren.get(hoveredNodeId);
    if (children) {
      for (const cid of children) highlightedNodes.add(cid);
    }

    // If hovered node is a child → highlight its parent and all siblings
    const parentId = hoverChildToParent.get(hoveredNodeId);
    if (parentId) {
      highlightedNodes.add(parentId);
      const siblings = hoverParentToChildren.get(parentId);
      if (siblings) {
        for (const sib of siblings) highlightedNodes.add(sib);
      }
    }

    // Also highlight directly connected nodes via explicit edges
    for (const e of currentPipeline.edges) {
      if (highlightedNodes.has(e.from) && highlightedNodes.has(e.to)) {
        highlightedEdges.add(e.id);
      } else if (e.from === hoveredNodeId || e.to === hoveredNodeId) {
        highlightedNodes.add(e.from);
        highlightedNodes.add(e.to);
        highlightedEdges.add(e.id);
      }
    }

    // Highlight synthetic edges between highlighted nodes
    for (const [parentId, childIds] of hoverParentToChildren) {
      if (highlightedNodes.has(parentId)) {
        for (const cid of childIds) {
          if (highlightedNodes.has(cid)) {
            highlightedEdges.add(`_synth_${parentId}_${cid}`);
          }
        }
      }
    }

    return { nodes: highlightedNodes, edges: highlightedEdges };
  }, [hoveredNodeId, currentPipeline, hoverParentToChildren, hoverChildToParent]);

  // Apply dim/highlight classes to React Flow nodes and edges
  useEffect(() => {
    if (!highlightSets) {
      // No hover — only clean up if we previously applied highlights
      if (!highlightAppliedRef.current) return;
      highlightAppliedRef.current = false;

      setNodes((nds) => nds.map((n) => {
        if (!n.className) return n;
        return { ...n, className: undefined };
      }));
      setEdges((eds) => eds.map((e) => {
        const d = e.data as Record<string, unknown> | undefined;
        if (!e.className && !d?.dimmed) return e;
        return { ...e, className: undefined, data: { ...d, dimmed: false } };
      }));
      return;
    }

    highlightAppliedRef.current = true;
    setNodes((nds) => nds.map((n) => {
      const cls = highlightSets.nodes.has(n.id) ? "af-highlighted" : "af-dimmed";
      if (n.className === cls) return n;
      return { ...n, className: cls };
    }));
    setEdges((eds) => eds.map((e) => {
      const isHighlighted = highlightSets.edges.has(e.id);
      const isSynth = e.id.startsWith("_synth_");
      const cls = isHighlighted ? "af-highlighted" : isSynth ? "af-dimmed-hidden" : "af-dimmed";
      if (e.className === cls) return e;
      return {
        ...e,
        className: cls,
        data: { ...(e.data as Record<string, unknown>), dimmed: !isHighlighted },
      };
    }));
  }, [highlightSets, setNodes, setEdges]);

  // Respond to fitView triggers (e.g., Space key)
  useEffect(() => {
    if (fitViewTrigger > 0) {
      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 });
    }
  }, [fitViewTrigger]);

  // Focus on a specific node when requested (e.g., from validation toast click)
  useEffect(() => {
    if (!focusNodeId || !currentPipeline) return;
    const instance = reactFlowInstance.current;
    if (!instance) return;

    // Select the node and open its config
    selectNode(focusNodeId);
    openPanel("nodeConfig");

    // Zoom to the node
    const node = currentPipeline.nodes.find((n) => n.id === focusNodeId);
    if (node) {
      const cachedPos = currentPipelinePath ? getCachedLayout(currentPipelinePath)?.[focusNodeId] : null;
      const pos = cachedPos ?? node.position;
      instance.setCenter(pos.x + 100, pos.y + 40, { zoom: 1.2, duration: 400 });
    }

    clearFocusNode();
  }, [focusNodeId, currentPipeline, currentPipelinePath, selectNode, openPanel, clearFocusNode]);

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

    let cancelled = false;
    computeLayoutAsync(currentPipeline.nodes, currentPipeline.edges)
      .then((positions) => {
        if (cancelled) return;
        updateAllNodePositions(positions);
        saveCachedLayout(currentPipelinePath, positions);
        setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50);
      })
      .catch((e) => {
        if (!cancelled) console.warn("[AutoLayout] Failed to compute layout:", e);
      });
    return () => { cancelled = true; };
  }, [currentPipeline, currentPipelinePath, updateAllNodePositions]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({
        ...params,
        type: "conditional",
        style: { stroke: "#a1a1aa", strokeWidth: 2 },
      }, eds));
      if (params.source && params.target) {
        addPipelineEdge(params.source, params.target);
      }
    },
    [setEdges, addPipelineEdge],
  );

  const onNodeDragStart = useCallback(() => {
    pushUndoSnapshot();
  }, [pushUndoSnapshot]);

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
      deleted
        .filter((e) => !e.id.startsWith("_synth_")) // synthetic edges are not deletable
        .forEach((e) => removeEdge(e.id));
    },
    [removeEdge],
  );

  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!isPanningRef.current) setHoveredNodeId(node.id);
  }, [setHoveredNodeId]);

  const onNodeMouseLeave = useCallback(() => {
    if (!isPanningRef.current) setHoveredNodeId(null);
  }, [setHoveredNodeId]);

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

  const handleAutoLayout = useCallback(async () => {
    if (!currentPipeline || currentPipeline.nodes.length === 0) return;
    pushUndoSnapshot();
    try {
      const positions = await computeLayoutAsync(currentPipeline.nodes, currentPipeline.edges);
      updateAllNodePositions(positions);
      if (currentPipelinePath) {
        saveCachedLayout(currentPipelinePath, positions);
      }
      setTimeout(() => reactFlowInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50);
    } catch (e) {
      console.warn("[AutoLayout] Failed:", e);
    }
  }, [currentPipeline, currentPipelinePath, updateAllNodePositions, pushUndoSnapshot]);

  if (!currentPipeline) {
    const handleCreateSample = () => {
      if (!currentProject) return;
      import("../../data/templates").then(({ TEMPLATES }) => {
        if (TEMPLATES.length > 0) {
          createFromTemplate(currentProject.path, TEMPLATES[0].pipeline);
        }
      });
    };

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
            {usePipelineStore.getState().pipelines.length === 0 ? (
              <>
                <p className="text-sm text-zinc-500">No pipelines yet</p>
                <p className="mt-1 text-xs text-zinc-600">Get started by creating your first pipeline</p>
                <ul className="mt-3 text-xs text-zinc-600 text-left inline-block">
                  <li className="mb-1">- Drag nodes from the palette to build workflows</li>
                  <li className="mb-1">- Connect nodes to define execution order</li>
                  <li className="mb-1">- Run pipelines to automate tasks with AI</li>
                </ul>
                <button
                  onClick={handleCreateSample}
                  className="pointer-events-auto mt-4 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500"
                >
                  Create Sample Pipeline
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-600">Select a pipeline or create a new one</p>
                <p className="mt-1 text-xs text-zinc-700">Use the pipeline selector in the top bar</p>
              </>
            )}
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
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { reactFlowInstance.current = instance; checkMinimapOverlap(); }}
        onMoveStart={() => { isPanningRef.current = true; setHoveredNodeId(null); }}
        onMoveEnd={(_event: unknown, viewport: Viewport) => { isPanningRef.current = false; checkMinimapOverlap(); if (Math.abs(viewport.zoom - useUIStore.getState().zoomLevel) > 0.01) setZoomLevel(viewport.zoom); }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!running}
        nodesConnectable={!running}
        fitView
        minZoom={0.25}
        maxZoom={2.5}
        zoomOnDoubleClick={false}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-950"
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: "#a1a1aa", strokeWidth: 2 },
          type: "conditional",
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
        <Controls
          className="!bg-zinc-800 !border-zinc-600/50 !rounded-lg !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600/50 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700"
          position="bottom-right"
        >
          <ControlButton onClick={toggleCompactCanvas} title={compactCanvas ? "Expand nodes" : "Compact nodes"}>
            {compactCanvas ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </ControlButton>
        </Controls>
        <MiniMap
          nodeColor={minimapNodeColor}
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
