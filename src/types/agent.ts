export interface AgentInfo {
  name: string;
  display_name: string;
  path: string;
  description: string;
  origin: "manual" | "pipeline";
}

export interface AgentContent {
  name: string;
  path: string;
  content: string;
}
