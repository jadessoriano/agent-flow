import { useRef, type DragEvent } from "react";
import type { NodeType } from "../../types/pipeline";
import { NODE_TYPE_META } from "../../types/pipeline";
import NodeIcon from "./nodes/NodeIcons";

const nodeTypes: NodeType[] = [
  "ai-task",
  "shell",
  "git",
  "parallel",
  "approval-gate",
  "sub-pipeline",
];

const iconColors: Record<NodeType, string> = {
  "ai-task": "text-violet-400",
  "shell": "text-emerald-400",
  "git": "text-orange-400",
  "parallel": "text-blue-400",
  "approval-gate": "text-amber-400",
  "sub-pipeline": "text-cyan-400",
};

const previewColors: Record<NodeType, { border: string; bg: string; icon: string }> = {
  "ai-task":       { border: "border-violet-400/60", bg: "bg-violet-500/15", icon: "text-violet-400" },
  "shell":         { border: "border-emerald-400/60", bg: "bg-emerald-500/15", icon: "text-emerald-400" },
  "git":           { border: "border-orange-400/60", bg: "bg-orange-500/15", icon: "text-orange-400" },
  "parallel":      { border: "border-blue-400/60", bg: "bg-blue-500/15", icon: "text-blue-400" },
  "approval-gate": { border: "border-amber-400/60", bg: "bg-amber-500/15", icon: "text-amber-400" },
  "sub-pipeline":  { border: "border-cyan-400/60", bg: "bg-cyan-500/15", icon: "text-cyan-400" },
};

interface NodePaletteProps {
  onAutoLayout?: () => void;
}

export default function NodePalette({ onAutoLayout }: NodePaletteProps) {
  const previewRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData("application/agentflow-node", nodeType);
    event.dataTransfer.effectAllowed = "move";

    const preview = previewRefs.current[nodeType];
    if (preview) {
      event.dataTransfer.setDragImage(preview, 90, 25);
    }
  };

  return (
    <>
      {/* Off-screen drag preview elements (styled like actual nodes) */}
      <div style={{ position: "fixed", left: -10000, top: -10000 }}>
        {nodeTypes.map((type) => {
          const meta = NODE_TYPE_META[type];
          const colors = previewColors[type];
          return (
            <div
              key={type}
              ref={(el) => { previewRefs.current[type] = el; }}
              className={`flex items-center gap-2 rounded-lg border ${colors.border} ${colors.bg} px-3 py-2 shadow-lg`}
              style={{ width: 180 }}
            >
              <div className={`rounded p-1 ${colors.bg}`}>
                <NodeIcon type={type} className={`h-3.5 w-3.5 ${colors.icon}`} />
              </div>
              <span className="text-xs font-semibold text-zinc-100">{meta.label}</span>
            </div>
          );
        })}
      </div>

      {/* Visible palette */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-zinc-600/50 bg-zinc-900/95 p-2 shadow-xl backdrop-blur-sm">
        <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          Nodes
        </div>
        <div className="flex flex-col gap-0.5">
          {nodeTypes.map((type) => {
            const meta = NODE_TYPE_META[type];
            return (
              <div
                key={type}
                draggable
                onDragStart={(e) => onDragStart(e, type)}
                className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 active:cursor-grabbing"
                title={`Drag to add ${meta.label}`}
              >
                <NodeIcon type={type} className={`h-3.5 w-3.5 ${iconColors[type]}`} />
                <span>{meta.label}</span>
              </div>
            );
          })}
        </div>
        {onAutoLayout && (
          <>
            <div className="my-1.5 border-t border-zinc-700/50" />
            <button
              onClick={onAutoLayout}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Auto-arrange nodes (left-to-right)"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
              <span>Auto Layout</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
