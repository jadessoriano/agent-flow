import { useErrorLogStore } from "../stores/errorLogStore";
import { useUIStore } from "../stores/uiStore";

export function logError(message: string, context?: string) {
  const fullMessage = context ? `${message} [${context}]` : message;
  console.error("[AgentFlow]", fullMessage);
  useErrorLogStore.getState().addError("ERROR", fullMessage);
}

export function logWarning(message: string, context?: string) {
  const fullMessage = context ? `${message} [${context}]` : message;
  console.warn("[AgentFlow]", fullMessage);
  useErrorLogStore.getState().addError("WARN", fullMessage);
}

export function addToast(
  message: string,
  level: "error" | "warning" | "info" = "error",
) {
  useUIStore.getState().addToast(message, level);
}

export function buildGitHubIssueUrl(opts: {
  title: string;
  errorLog?: string;
  appVersion?: string;
}): string {
  const params = new URLSearchParams();
  params.set("title", `[Bug] ${opts.title}`);

  let body = "## Description\n\n_Describe what happened_\n\n";
  body += "## Steps to Reproduce\n\n1. \n2. \n3. \n\n";
  if (opts.errorLog) {
    body += "## Error Log\n\n```\n" + opts.errorLog.slice(0, 3000) + "\n```\n\n";
  }
  if (opts.appVersion) {
    body += `## Environment\n\n- AgentFlow version: ${opts.appVersion}\n`;
  }
  params.set("body", body);
  params.set("labels", "bug");

  return `https://github.com/anthropics/agent-flow/issues/new?${params.toString()}`;
}

export function formatErrorsForExport(
  entries: Array<{ timestamp: string; level: string; message: string }>,
): string {
  const header = `AgentFlow Error Report\nGenerated: ${new Date().toISOString()}\n${"=".repeat(50)}\n\n`;
  const lines = entries
    .map((e) => `[${e.timestamp || "N/A"}] [${e.level}] ${e.message}`)
    .join("\n");
  return header + lines;
}
