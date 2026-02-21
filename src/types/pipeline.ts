export type NodeType =
  | "ai-task"
  | "shell"
  | "git"
  | "parallel"
  | "approval-gate"
  | "sub-pipeline";

export interface RetryPolicy {
  max: number;
  delay: number;
}

export interface PipelineNode {
  id: string;
  name: string;
  type: NodeType;
  instructions: string;
  agent?: string;
  inputs: string[];
  outputs: string[];
  retry?: RetryPolicy;
  timeout?: number;
  children?: string[];
  pipeline_ref?: string;
  requires_tools?: string[];
  position: { x: number; y: number };
}

export interface PipelineEdge {
  id: string;
  from: string;
  to: string;
  condition?: "success" | "failure" | string;
}

export interface PipelineVariables {
  [key: string]: string;
}

export interface Pipeline {
  name: string;
  description: string;
  version: string;
  variables: PipelineVariables;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface PipelineInfo {
  name: string;
  path: string;
  description: string;
  node_count: number;
}

// Node type metadata for the palette
export const NODE_TYPE_META: Record<
  NodeType,
  { label: string; color: string; icon: string }
> = {
  "ai-task": { label: "AI Task", color: "#8b5cf6", icon: "brain" },
  shell: { label: "Shell", color: "#22c55e", icon: "terminal" },
  git: { label: "Git", color: "#f97316", icon: "git" },
  parallel: { label: "Parallel", color: "#3b82f6", icon: "layers" },
  "approval-gate": {
    label: "Approval Gate",
    color: "#eab308",
    icon: "shield",
  },
  "sub-pipeline": {
    label: "Sub-pipeline",
    color: "#06b6d4",
    icon: "workflow",
  },
};
