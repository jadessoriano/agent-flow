import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export interface ConditionalEdgeData {
  condition?: string;
  [key: string]: unknown;
}

/**
 * Build a looping path for backward edges (source is to the right of target).
 * Routes the edge above both nodes so it doesn't cut through them.
 */
function getBackwardEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const dx = Math.abs(sourceX - targetX);
  const dy = Math.abs(sourceY - targetY);
  const offset = Math.max(50, dx * 0.3);
  const loopHeight = Math.max(80, dy * 0.5 + 60);

  // Top of the loop — label goes here
  const topY = Math.min(sourceY, targetY) - loopHeight;
  const midX = (sourceX + targetX) / 2;

  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${sourceY}`,
    `  ${sourceX + offset},${topY}`,
    `  ${midX},${topY}`,
    `C ${targetX - offset},${topY}`,
    `  ${targetX - offset},${targetY}`,
    `  ${targetX},${targetY}`,
  ].join(" ");

  return [path, midX, topY];
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

  // Detect backward edge: source is to the right of (or very close to) target
  const isBackward = sourceX > targetX - 20;

  const [edgePath, labelX, labelY] = isBackward
    ? getBackwardEdgePath(sourceX, sourceY, targetX, targetY)
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

  let strokeColor = "#71717a"; // zinc-500
  if (condition === "success") strokeColor = "#22c55e";
  if (condition === "failure") strokeColor = "#ef4444";

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
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          {condition ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                condition === "success"
                  ? "bg-green-500/20 text-green-400"
                  : condition === "failure"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {condition}
            </span>
          ) : (
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">
              then →
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(ConditionalEdge, (prev, next) =>
  prev.id === next.id &&
  prev.sourceX === next.sourceX &&
  prev.sourceY === next.sourceY &&
  prev.targetX === next.targetX &&
  prev.targetY === next.targetY &&
  prev.sourcePosition === next.sourcePosition &&
  prev.targetPosition === next.targetPosition &&
  (prev.data as ConditionalEdgeData | undefined)?.condition ===
    (next.data as ConditionalEdgeData | undefined)?.condition &&
  prev.selected === next.selected
);
