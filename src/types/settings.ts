export interface AppSettings {
  claude_cli_path: string | null;
  theme: string;
  notifications_enabled: boolean;
}

export type ExperienceMode = "simple" | "advanced";

export interface LocalSettings {
  mode: ExperienceMode;
  dismissed_hints: string[];
  successful_run_count: number;
}

export interface CliDetectResult {
  path: string | null;
  version: string | null;
  source: string | null;
}
