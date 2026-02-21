export interface ProjectInfo {
  path: string;
  name: string;
  has_claude_dir: boolean;
  agent_count: number;
}

export interface RecentProject {
  path: string;
  name: string;
  last_opened: number;
}

export interface RecentProjects {
  projects: RecentProject[];
}
