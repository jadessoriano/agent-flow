export type NodeType =
  | "ai-task"
  | "shell"
  | "git"
  | "parallel"
  | "loop"
  | "approval-gate"
  | "sub-pipeline"
  | "comment";

export interface ValidationError {
  nodeId?: string;
  severity: "error" | "warning";
  message: string;
}

export interface SecretInfo {
  name: string;
}

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
  loop_separator?: string;
  max_iterations?: number;
  loop_timeout?: number;
  pipeline_ref?: string;
  requires_tools?: string[];
  model?: string;
  loop_model?: string;
  cache?: boolean;
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
  shared_session?: boolean;
  default_model?: string;
  max_cost_usd?: number;
}

export interface PipelineInfo {
  name: string;
  path: string;
  description: string;
  node_count: number;
}

// Node type metadata for the palette
export interface NodeTypeMeta {
  label: string;
  friendlyLabel: string;
  description: string;
  color: string;
  icon: string;
  isAdvanced: boolean;
}

export const NODE_TYPE_META: Record<NodeType, NodeTypeMeta> = {
  "ai-task":       { label: "AI Task",       friendlyLabel: "AI Step",              description: "Ask Claude to do something with your code",           color: "#8b5cf6", icon: "brain",    isAdvanced: false },
  "shell":         { label: "Shell",         friendlyLabel: "Run Command",          description: "Execute a shell command",                            color: "#22c55e", icon: "terminal", isAdvanced: false },
  "git":           { label: "Git",           friendlyLabel: "Git Action",           description: "Run a git operation",                                color: "#f97316", icon: "git",      isAdvanced: false },
  "parallel":      { label: "Parallel",      friendlyLabel: "Parallel Group",       description: "Run multiple steps at the same time",                color: "#3b82f6", icon: "layers",   isAdvanced: true  },
  "loop":          { label: "Loop",          friendlyLabel: "Repeat",               description: "Repeat steps for each item in a list",               color: "#ec4899", icon: "loop",     isAdvanced: true  },
  "approval-gate": { label: "Approval Gate", friendlyLabel: "Wait for Approval",    description: "Pause and wait for you to approve before continuing", color: "#eab308", icon: "shield",   isAdvanced: false },
  "sub-pipeline":  { label: "Sub-pipeline",  friendlyLabel: "Run Another Pipeline", description: "Run a different pipeline as a step",                 color: "#06b6d4", icon: "workflow", isAdvanced: true  },
  "comment":       { label: "Comment",       friendlyLabel: "Note",                 description: "Add a note to the canvas (doesn't execute)",         color: "#a1a1aa", icon: "message",  isAdvanced: false },
};
