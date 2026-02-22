export type NodeStatus =
  | "Pending"
  | "Running"
  | "Success"
  | "Failed"
  | "Skipped"
  | "Cancelled";

export interface NodeResult {
  node_id: string;
  status: NodeStatus;
  exit_code: number | null;
  output: string;
  started_at: string | null;
  finished_at: string | null;
  attempt: number;
  cost_usd: number | null;
}

export interface RunState {
  run_id: string;
  pipeline_name: string;
  status: string;
  node_results: Record<string, NodeResult>;
  current_node: string | null;
  total_cost_usd: number;
}

export interface RunStateDelta {
  run_id: string;
  status?: string;
  current_node?: string | null;
  total_cost_usd?: number;
  node_result?: NodeResult;
}

export interface NodeLogEvent {
  run_id: string;
  node_id: string;
  line: string;
}

export interface NodeLogBatchEvent {
  run_id: string;
  node_id: string;
  lines: string[];
}

export interface ApprovalRequest {
  run_id: string;
  node_id: string;
  name: string;
}

// Persisted DB types
export interface RunRow {
  id: string;
  pipeline_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger_input: string | null;
  resumed_from: string | null;
  failed_node_id: string | null;
  pipeline_hash: string | null;
}

export interface RunStepRow {
  id: number;
  run_id: string;
  node_id: string;
  node_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  exit_code: number | null;
  log_output: string | null;
  attempt: number;
  cost_usd: number | null;
  model: string | null;
  approval_state: string | null;
  instructions_hash: string | null;
}

export interface RunCost {
  run_id: string;
  pipeline_name: string;
  started_at: string;
  cost_usd: number;
  duration_secs: number | null;
}

export interface CostSummary {
  total_cost_usd: number;
  runs: RunCost[];
}

export interface UsageStats {
  total_cost_usd: number;
  total_runs: number;
  total_ai_steps: number;
  avg_cost_per_run: number;
  avg_cost_per_ai_step: number;
  avg_duration_secs: number | null;
  runs: RunCost[];
  top_nodes: NodeCostEntry[];
  top_pipelines: PipelineCostEntry[];
}

export interface NodeCostEntry {
  node_name: string;
  node_id: string;
  run_id: string;
  pipeline_name: string;
  cost_usd: number;
  started_at: string;
  duration_secs: number | null;
}

export interface PipelineCostEntry {
  pipeline_name: string;
  total_cost_usd: number;
  run_count: number;
  avg_cost_per_run: number;
  avg_duration_secs: number | null;
}

export interface RunEstimate {
  ai_node_count: number;
  shell_node_count: number;
  other_node_count: number;
  avg_ai_node_cost: number | null;
  estimated_low: number | null;
  estimated_high: number | null;
  has_historical_data: boolean;
}
