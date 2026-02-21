export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface LogInfo {
  path: string;
  size_bytes: number;
  entries: LogEntry[];
}
