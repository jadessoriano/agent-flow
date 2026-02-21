import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeType } from "../../../types/pipeline";
import { NODE_TYPE_META } from "../../../types/pipeline";
import NodeIcon from "./NodeIcons";

export interface FlowNodeData {
  label: string;
  nodeType: NodeType;
  instructions?: string;
  inputs?: string[];
  outputs?: string[];
  runStatus?: string;
  agent?: string;
  pipelineRef?: string;
  costUsd?: number;
  durationStr?: string;
  [key: string]: unknown;
}

const colorMap: Record<NodeType, { border: string; bg: string; badge: string; icon: string; glow: string }> = {
  "ai-task":        { border: "border-violet-400/60", bg: "bg-violet-500/15", badge: "bg-violet-500", icon: "text-violet-400", glow: "shadow-violet-500/10" },
  "shell":          { border: "border-emerald-400/60", bg: "bg-emerald-500/15", badge: "bg-emerald-500", icon: "text-emerald-400", glow: "shadow-emerald-500/10" },
  "git":            { border: "border-orange-400/60", bg: "bg-orange-500/15", badge: "bg-orange-500", icon: "text-orange-400", glow: "shadow-orange-500/10" },
  "parallel":       { border: "border-blue-400/60",   bg: "bg-blue-500/15",   badge: "bg-blue-500", icon: "text-blue-400", glow: "shadow-blue-500/10" },
  "approval-gate":  { border: "border-amber-400/60", bg: "bg-amber-500/15", badge: "bg-amber-500", icon: "text-amber-400", glow: "shadow-amber-500/10" },
  "sub-pipeline":   { border: "border-cyan-400/60",   bg: "bg-cyan-500/15",   badge: "bg-cyan-500", icon: "text-cyan-400", glow: "shadow-cyan-500/10" },
  "comment":        { border: "border-yellow-400/40", bg: "bg-yellow-500/10", badge: "bg-yellow-500", icon: "text-yellow-400", glow: "shadow-yellow-500/10" },
};

export default function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData;
  const nodeType = nodeData.nodeType;
  const meta = NODE_TYPE_META[nodeType];
  const colors = colorMap[nodeType];

  const runStatus = nodeData.runStatus;
  const runStatusRing = runStatus === "Running"
    ? "ring-2 ring-blue-400/60 shadow-lg shadow-blue-500/20 animate-pulse"
    : runStatus === "Success"
      ? "ring-2 ring-green-400/50 shadow-lg shadow-green-500/20"
      : runStatus === "Failed"
        ? "ring-2 ring-red-400/50 shadow-lg shadow-red-500/20"
        : runStatus === "Cancelled"
          ? "ring-2 ring-yellow-400/50"
          : "";

  const isComment = nodeType === "comment";

  return (
    <div
      className={`${isComment ? "min-w-[220px] max-w-[300px]" : "min-w-[180px] max-w-[240px]"} rounded-lg border ${colors.border} ${colors.bg} shadow-lg ${colors.glow} ${
        selected && !runStatus ? "ring-2 ring-violet-400/70 shadow-xl shadow-violet-500/25" : ""
      } ${runStatusRing}`}
    >
      {/* Input handle */}
      {!isComment && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-zinc-500 !bg-zinc-700 hover:!border-zinc-400 hover:!bg-zinc-600"
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`rounded p-1 ${colors.badge}/20`}>
          <NodeIcon type={nodeType} className={`h-3.5 w-3.5 ${colors.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-xs font-semibold text-zinc-100">
            {nodeData.label}
          </div>
          <div className="text-[10px] text-zinc-400">{meta.label}</div>
        </div>
      </div>

      {/* Agent badge */}
      {nodeData.agent && (
        <div className="border-t border-zinc-600/30 px-3 py-1">
          <div className="flex items-center gap-1 text-[10px] text-violet-300">
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
            {nodeData.agent}
          </div>
        </div>
      )}

      {/* Pipeline reference badge (sub-pipeline nodes) */}
      {nodeData.pipelineRef && (
        <div className="border-t border-zinc-600/30 px-3 py-1">
          <div className="flex items-center gap-1 text-[10px] text-cyan-300">
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.07-9.07l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
            </svg>
            {nodeData.pipelineRef}
          </div>
        </div>
      )}

      {/* Instructions preview */}
      {nodeData.instructions && (
        <div className="border-t border-zinc-600/30 px-3 py-1.5">
          <div className="line-clamp-2 text-[10px] text-zinc-400">
            {nodeData.instructions}
          </div>
        </div>
      )}

      {/* Run status indicator */}
      {runStatus && (
        <div className="border-t border-zinc-600/30 px-3 py-1">
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-medium ${
              runStatus === "Running" ? "text-blue-400" :
              runStatus === "Success" ? "text-green-400" :
              runStatus === "Failed" ? "text-red-400" :
              runStatus === "Cancelled" ? "text-yellow-400" :
              runStatus === "Skipped" ? "text-zinc-600" : "text-zinc-500"
            }`}>
              {runStatus}
            </span>
            {nodeData.durationStr && (
              <span className="text-[10px] text-zinc-500">
                {nodeData.durationStr}
              </span>
            )}
            {nodeData.costUsd != null && nodeData.costUsd > 0 && (
              <span className="text-[10px] font-medium text-violet-400">
                ${nodeData.costUsd < 0.01 ? nodeData.costUsd.toFixed(4) : nodeData.costUsd.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Output handle */}
      {!isComment && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-zinc-500 !bg-zinc-700 hover:!border-zinc-400 hover:!bg-zinc-600"
        />
      )}
    </div>
  );
}
