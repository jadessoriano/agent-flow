import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useSettingsStore } from "../../../stores/settingsStore";

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConditionalEdgeData {
  condition?: string;
  synthetic?: boolean;
  synthLabel?: string;
  synthColor?: string;
  graphMidY?: number;
  nodeRects?: NodeRect[];
  /**
   * Pre-computed routing offset from central lane assignment.
   * Negative = route above, positive = route below, 0 = default bezier.
   */
  routeOffset?: number;
  /** When true, always draw a direct bezier — skip backward edge detection */
  directPath?: boolean;
  dimmed?: boolean;
  [key: string]: unknown;
}

/**
 * Build a looping path for backward edges (source is to the right of target).
 * Uses the routeOffset to determine direction and magnitude of the arc.
 */
function getBackwardEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  routeOffset: number,
): [string, number, number] {
  const dx = Math.abs(sourceX - targetX);
  const dy = Math.abs(sourceY - targetY);
  const offset = Math.max(50, dx * 0.3);
  const baseLoopHeight = Math.max(80, dy * 0.5 + 60);

  const midX = (sourceX + targetX) / 2;
  const magnitude = Math.abs(routeOffset);
  const loopHeight = baseLoopHeight + magnitude;

  let arcY: number;
  if (routeOffset > 0) {
    // Route below
    arcY = Math.max(sourceY, targetY) + loopHeight;
  } else {
    // Route above (default)
    arcY = Math.min(sourceY, targetY) - loopHeight;
  }

  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${sourceY}`,
    `  ${sourceX + offset},${arcY}`,
    `  ${midX},${arcY}`,
    `C ${targetX - offset},${arcY}`,
    `  ${targetX - offset},${targetY}`,
    `  ${targetX},${targetY}`,
  ].join(" ");

  return [path, midX, arcY];
}

/**
 * Build a custom bezier for forward edges that need to avoid obstacles.
 * Uses routeOffset to curve the edge above or below the straight path.
 */
function getAvoidancePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  routeOffset: number,
): [string, number, number] {
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  const cpY = midY + routeOffset;
  const dx = Math.abs(targetX - sourceX);
  const cpSpread = Math.max(60, dx * 0.25);

  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + cpSpread},${sourceY}`,
    `  ${midX},${cpY}`,
    `  ${midX},${cpY}`,
    `S ${targetX - cpSpread},${targetY}`,
    `  ${targetX},${targetY}`,
  ].join(" ");

  return [path, midX, cpY];
}

function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as ConditionalEdgeData | undefined;
  const condition = edgeData?.condition;
  const isSynthetic = edgeData?.synthetic === true;
  const isDimmed = edgeData?.dimmed === true;
  const routeOffset = edgeData?.routeOffset ?? 0;
  const isSimple = useSettingsStore.getState().local.mode === "simple";

  // Fully hide synthetic edges when dimmed (hover-focus on a different node).
  // CSS alone can't reach the SVG marker <defs>, so we bail out here.
  if (isSynthetic && isDimmed) return null;

  // Detect backward edge: source is to the right of (or very close to) target
  // directPath edges (reversed synthetic edges) skip backward detection
  const isBackward = !edgeData?.directPath && sourceX > targetX - 20;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isBackward) {
    [edgePath, labelX, labelY] = getBackwardEdgePath(
      sourceX, sourceY, targetX, targetY, routeOffset,
    );
  } else if (routeOffset !== 0) {
    [edgePath, labelX, labelY] = getAvoidancePath(
      sourceX, sourceY, targetX, targetY, routeOffset,
    );
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  let strokeColor = isSynthetic
    ? (edgeData?.synthColor ?? "#ec4899")
    : "#a1a1aa"; // zinc-400 — brighter for dark canvas visibility
  if (!isSynthetic) {
    if (condition === "success") strokeColor = "#22c55e";
    if (condition === "failure") strokeColor = "#ef4444";
  }

  const arrowColor = selected ? "#a78bfa" : strokeColor;
  const markerId = `af-arrow-${id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="16"
          markerHeight="16"
          viewBox="-10 -10 20 20"
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
          refX="0"
          refY="0"
        >
          <polyline
            stroke={arrowColor}
            fill={arrowColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1"
            points="-5,-4 0,0 -5,4 -5,-4"
          />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke: arrowColor,
          strokeWidth: selected ? 2.5 : isSynthetic ? 1.5 : 2,
          strokeDasharray: isSynthetic ? "6,4" : undefined,
          opacity: isSynthetic ? 0.7 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            opacity: edgeData?.dimmed ? 0.1 : undefined,
            transition: "opacity 0.35s ease-in-out",
          }}
        >
          {isSynthetic && edgeData?.synthLabel ? (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${strokeColor}20`, color: strokeColor }}
            >
              {edgeData.synthLabel}
            </span>
          ) : condition ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                condition === "success"
                  ? "bg-green-500/20 text-green-400"
                  : condition === "failure"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {isSimple
                ? condition === "success" ? "If successful" : condition === "failure" ? "If failed" : condition
                : condition}
            </span>
          ) : (
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {isSimple ? "Then" : "then →"}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(ConditionalEdge, (prev, next) => {
  const pd = prev.data as ConditionalEdgeData | undefined;
  const nd = next.data as ConditionalEdgeData | undefined;
  return (
    prev.id === next.id &&
    prev.sourceX === next.sourceX &&
    prev.sourceY === next.sourceY &&
    prev.targetX === next.targetX &&
    prev.targetY === next.targetY &&
    prev.sourcePosition === next.sourcePosition &&
    prev.targetPosition === next.targetPosition &&
    pd?.condition === nd?.condition &&
    pd?.synthetic === nd?.synthetic &&
    pd?.synthLabel === nd?.synthLabel &&
    pd?.synthColor === nd?.synthColor &&
    pd?.routeOffset === nd?.routeOffset &&
    pd?.directPath === nd?.directPath &&
    pd?.dimmed === nd?.dimmed &&
    prev.selected === next.selected
  );
});
