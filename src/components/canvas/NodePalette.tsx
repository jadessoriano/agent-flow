import { useRef, useState, type DragEvent } from "react";
import type { NodeType } from "../../types/pipeline";
import { NODE_TYPE_META } from "../../types/pipeline";
import { useSettingsStore } from "../../stores/settingsStore";
import NodeIcon from "./nodes/NodeIcons";

const allNodeTypes: NodeType[] = [
  "ai-task",
  "shell",
  "git",
  "parallel",
  "loop",
  "approval-gate",
  "sub-pipeline",
  "comment",
];

const iconColors: Record<NodeType, string> = {
  "ai-task": "text-violet-400",
  "shell": "text-emerald-400",
  "git": "text-orange-400",
  "parallel": "text-blue-400",
  "loop": "text-pink-400",
  "approval-gate": "text-amber-400",
  "sub-pipeline": "text-cyan-400",
  "comment": "text-yellow-400",
};

const previewColors: Record<NodeType, { border: string; bg: string; icon: string }> = {
  "ai-task":       { border: "border-violet-400/60", bg: "bg-violet-500/15", icon: "text-violet-400" },
  "shell":         { border: "border-emerald-400/60", bg: "bg-emerald-500/15", icon: "text-emerald-400" },
  "git":           { border: "border-orange-400/60", bg: "bg-orange-500/15", icon: "text-orange-400" },
  "parallel":      { border: "border-blue-400/60", bg: "bg-blue-500/15", icon: "text-blue-400" },
  "loop":          { border: "border-pink-400/60", bg: "bg-pink-500/15", icon: "text-pink-400" },
  "approval-gate": { border: "border-amber-400/60", bg: "bg-amber-500/15", icon: "text-amber-400" },
  "sub-pipeline":  { border: "border-cyan-400/60", bg: "bg-cyan-500/15", icon: "text-cyan-400" },
  "comment":       { border: "border-yellow-400/40", bg: "bg-yellow-500/10", icon: "text-yellow-400" },
};

interface NodePaletteProps {
  onAutoLayout?: () => void;
}

export default function NodePalette({ onAutoLayout }: NodePaletteProps) {
  const previewRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expanded, setExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const mode = useSettingsStore((s) => s.local.mode);
  const isSimple = mode === "simple";

  const basicTypes = allNodeTypes.filter((t) => !NODE_TYPE_META[t].isAdvanced);
  const advancedTypes = allNodeTypes.filter((t) => NODE_TYPE_META[t].isAdvanced);
  const visibleTypes = isSimple ? basicTypes : allNodeTypes;

  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData("application/agentflow-node", nodeType);
    event.dataTransfer.effectAllowed = "move";

    const preview = previewRefs.current[nodeType];
    if (preview) {
      event.dataTransfer.setDragImage(preview, 90, 25);
    }
  };

  const getLabel = (type: NodeType) => {
    const meta = NODE_TYPE_META[type];
    return isSimple ? meta.friendlyLabel : meta.label;
  };

  const renderNodeItem = (type: NodeType) => {
    const meta = NODE_TYPE_META[type];
    const isHovered = hoveredItem === type;
    return (
      <div
        key={type}
        draggable
        onDragStart={(e) => onDragStart(e, type)}
        onMouseEnter={() => setHoveredItem(type)}
        onMouseLeave={() => setHoveredItem(null)}
        className={`flex cursor-grab items-center rounded px-2 py-1.5 active:cursor-grabbing transition-colors duration-150 ${
          isHovered ? "bg-zinc-800" : ""
        }`}
        title={`Drag to add ${getLabel(type)}`}
      >
        <NodeIcon
          type={type}
          className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-200 ${iconColors[type]} ${
            expanded && !isHovered ? "opacity-40" : "opacity-100"
          }`}
        />
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            expanded ? "max-w-[140px] ml-2" : "max-w-0 ml-0"
          }`}
        >
          <span
            className={`text-xs whitespace-nowrap transition-opacity duration-200 ${
              isHovered ? "text-zinc-100 opacity-100" : "text-zinc-500 opacity-50"
            } ${expanded ? "" : "opacity-0"}`}
          >
            {getLabel(type)}
          </span>
          {isSimple && expanded && isHovered && (
            <div className="text-[9px] text-zinc-600 whitespace-nowrap">{meta.description}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Off-screen drag preview elements (styled like actual nodes) */}
      <div style={{ position: "fixed", left: -10000, top: -10000, pointerEvents: "none" }}>
        {allNodeTypes.map((type) => {
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
              <span className="text-xs font-semibold text-zinc-100">{getLabel(type)}</span>
            </div>
          );
        })}
      </div>

      {/* Visible palette */}
      <div
        className="absolute bottom-4 left-4 z-10 rounded-lg border border-zinc-600/50 bg-zinc-900/95 p-1.5 shadow-xl backdrop-blur-sm overflow-hidden transition-all duration-300 ease-in-out"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => { setExpanded(false); setHoveredItem(null); setAdvancedExpanded(false); }}
      >
        <div className="flex flex-col gap-0.5">
          {visibleTypes.map(renderNodeItem)}

          {/* Advanced nodes section in simple mode */}
          {isSimple && expanded && (
            <>
              <div className="my-1 border-t border-zinc-700/50" />
              <button
                onClick={() => setAdvancedExpanded(!advancedExpanded)}
                onMouseEnter={() => setHoveredItem("advanced-section")}
                onMouseLeave={() => setHoveredItem(null)}
                className={`flex w-full items-center rounded px-2 py-1 transition-colors duration-150 ${
                  hoveredItem === "advanced-section" ? "bg-zinc-800" : ""
                }`}
              >
                <svg
                  className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-200 ${advancedExpanded ? "rotate-90" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="ml-1.5 text-[10px] text-zinc-500 whitespace-nowrap">
                  Advanced Nodes
                </span>
              </button>
              {advancedExpanded && advancedTypes.map(renderNodeItem)}
            </>
          )}
        </div>
        {onAutoLayout && (
          <>
            <div className="my-1 border-t border-zinc-700/50" />
            <button
              onClick={onAutoLayout}
              onMouseEnter={() => setHoveredItem("auto-layout")}
              onMouseLeave={() => setHoveredItem(null)}
              className={`flex w-full items-center rounded px-2 py-1.5 transition-colors duration-150 ${
                hoveredItem === "auto-layout" ? "bg-zinc-800" : ""
              }`}
              title="Auto-arrange nodes (left-to-right)"
            >
              <svg
                className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-200 ${
                  expanded && hoveredItem !== "auto-layout" ? "text-zinc-500 opacity-40" : "text-zinc-400 opacity-100"
                }`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
              <span
                className={`text-xs whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${
                  hoveredItem === "auto-layout" ? "text-zinc-200 opacity-100" : "text-zinc-500 opacity-50"
                } ${expanded ? "max-w-[100px] ml-2" : "max-w-0 ml-0 opacity-0"}`}
              >
                Auto Layout
              </span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
