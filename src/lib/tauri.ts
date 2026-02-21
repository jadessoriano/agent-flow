import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo, AgentContent } from "../types/agent";
import type { AppSettings } from "../types/settings";
import type { ProjectInfo, RecentProjects } from "../types/project";
import type { Pipeline, PipelineInfo } from "../types/pipeline";
import type { RunState, RunRow, RunStepRow, CostSummary, UsageStats } from "../types/run";
import type { Pipeline as RunPipeline } from "../types/pipeline";
import type { LogInfo } from "../types/errorLog";

// Agent CRUD
export async function listAgents(projectPath: string): Promise<AgentInfo[]> {
  return invoke("list_agents", { projectPath });
}

export async function readAgent(path: string): Promise<AgentContent> {
  return invoke("read_agent", { path });
}

export async function writeAgent(path: string, content: string): Promise<void> {
  return invoke("write_agent", { path, content });
}

export async function deleteAgent(path: string): Promise<void> {
  return invoke("delete_agent", { path });
}

export async function createAgent(
  projectPath: string,
  name: string,
  content: string,
): Promise<string> {
  return invoke("create_agent", { projectPath, name, content });
}

// Project management
export async function scanProject(projectPath: string): Promise<ProjectInfo> {
  return invoke("scan_project", { projectPath });
}

export async function initProject(projectPath: string): Promise<void> {
  return invoke("init_project", { projectPath });
}

export async function getRecentProjects(): Promise<RecentProjects> {
  return invoke("get_recent_projects");
}

export async function addRecentProject(projectPath: string): Promise<void> {
  return invoke("add_recent_project", { projectPath });
}

export async function removeRecentProject(projectPath: string): Promise<void> {
  return invoke("remove_recent_project", { projectPath });
}

export async function detectProjectFromCwd(): Promise<string | null> {
  return invoke("detect_project_from_cwd");
}

// Pipeline CRUD
export async function listPipelines(
  projectPath: string,
): Promise<PipelineInfo[]> {
  return invoke("list_pipelines", { projectPath });
}

export async function readPipeline(path: string): Promise<Pipeline> {
  return invoke("read_pipeline", { path });
}

export async function writePipeline(
  projectPath: string,
  pipeline: Pipeline,
): Promise<string> {
  return invoke("write_pipeline", { projectPath, pipeline });
}

export async function deletePipeline(
  projectPath: string,
  path: string,
): Promise<void> {
  return invoke("delete_pipeline", { projectPath, path });
}

export async function renamePipeline(
  projectPath: string,
  oldPath: string,
  newName: string,
): Promise<string> {
  return invoke("rename_pipeline", { projectPath, oldPath, newName });
}

export async function generatePipeline(
  prompt: string,
  cliPath: string,
  projectPath: string,
): Promise<Pipeline> {
  return invoke("generate_pipeline", {
    prompt,
    cliPath,
    projectPath,
  });
}

// File watcher
export async function startWatching(projectPath: string): Promise<void> {
  return invoke("start_watching", { projectPath });
}

export async function stopWatching(): Promise<void> {
  return invoke("stop_watching");
}

// Executor
export async function startRun(
  pipeline: Pipeline,
  inputs: Record<string, string>,
  claudeCliPath: string,
  projectPath: string,
): Promise<string> {
  return invoke("start_run", {
    pipeline,
    inputs,
    claude_cli_path: claudeCliPath,
    project_path: projectPath,
  });
}

export async function cancelRun(): Promise<void> {
  return invoke("cancel_run");
}

export async function respondToApproval(approved: boolean): Promise<void> {
  return invoke("respond_to_approval", { approved });
}

export async function getRunState(): Promise<RunState | null> {
  return invoke("get_run_state");
}

export async function listRunHistory(limit?: number): Promise<RunRow[]> {
  return invoke("list_run_history", { limit: limit ?? null });
}

export async function getRunDetails(
  runId: string,
): Promise<[RunRow, RunStepRow[]]> {
  return invoke("get_run_details", { run_id: runId });
}

export async function resumeRun(
  originalRunId: string,
  pipeline: RunPipeline,
  inputs: Record<string, string>,
  claudeCliPath: string,
  projectPath: string,
): Promise<string> {
  return invoke("resume_run", {
    original_run_id: originalRunId,
    pipeline,
    inputs,
    claude_cli_path: claudeCliPath,
    project_path: projectPath,
  });
}

export async function getCostSummary(): Promise<CostSummary> {
  return invoke("get_cost_summary");
}

export async function getUsageStats(): Promise<UsageStats> {
  return invoke("get_usage_stats");
}

export async function getAvgAiCost(): Promise<number | null> {
  return invoke("get_avg_ai_cost");
}

// Settings
export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

export async function detectClaudeCli(): Promise<string | null> {
  return invoke("detect_claude_cli");
}

export async function detectClaudeCliDetailed(): Promise<{
  path: string | null;
  version: string | null;
  source: string | null;
}> {
  return invoke("detect_claude_cli_detailed");
}

// Error log
export async function getErrorLog(limit?: number): Promise<LogInfo> {
  return invoke("get_error_log", { limit: limit ?? null });
}

export async function getFullLog(): Promise<string> {
  return invoke("get_full_log");
}

export async function getLogPath(): Promise<string> {
  return invoke("get_log_path");
}

export async function clearErrorLog(): Promise<void> {
  return invoke("clear_error_log");
}
