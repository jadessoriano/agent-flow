export interface AppSettings {
  claude_cli_path: string | null;
  theme: string;
  notifications_enabled: boolean;
}

export interface CliDetectResult {
  path: string | null;
  version: string | null;
  source: string | null;
}
