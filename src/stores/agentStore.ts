import { create } from "zustand";
import type { AgentInfo, AgentContent } from "../types/agent";
import * as api from "../lib/tauri";

interface AgentState {
  agents: AgentInfo[];
  selectedAgent: AgentContent | null;
  loading: boolean;
  selecting: boolean;
  saving: boolean;

  loadAgents: (projectPath: string) => Promise<void>;
  selectAgent: (path: string) => Promise<void>;
  saveAgent: (path: string, content: string) => Promise<void>;
  deleteAgent: (path: string, projectPath: string) => Promise<void>;
  createAgent: (
    projectPath: string,
    name: string,
    content: string,
  ) => Promise<string>;
  clearSelection: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgent: null,
  loading: false,
  selecting: false,
  saving: false,

  loadAgents: async (projectPath: string) => {
    if (get().loading) return; // prevent re-entrant refresh loop
    set({ loading: true });
    try {
      const agents = await api.listAgents(projectPath);
      set({ agents, loading: false });
    } catch {
      set({ loading: false, agents: [] });
    }
  },

  selectAgent: async (path: string) => {
    set({ selecting: true });
    try {
      const agent = await api.readAgent(path);
      set({ selectedAgent: agent, selecting: false });
    } catch {
      set({ selecting: false });
    }
  },

  saveAgent: async (path: string, content: string) => {
    set({ saving: true });
    try {
      await api.writeAgent(path, content);
      // Update selected agent content
      const current = get().selectedAgent;
      if (current && current.path === path) {
        set({ selectedAgent: { ...current, content }, saving: false });
      } else {
        set({ saving: false });
      }
    } catch {
      set({ saving: false });
    }
  },

  deleteAgent: async (path: string, projectPath: string) => {
    await api.deleteAgent(path);
    set({ selectedAgent: null });
    // Reload agents list
    get().loadAgents(projectPath);
  },

  createAgent: async (
    projectPath: string,
    name: string,
    content: string,
  ) => {
    const newPath = await api.createAgent(projectPath, name, content);
    // Reload agents list
    get().loadAgents(projectPath);
    return newPath;
  },

  clearSelection: () => {
    set({ selectedAgent: null });
  },
}));
