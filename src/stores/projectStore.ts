import { create } from "zustand";
import type { ProjectInfo, RecentProject } from "../types/project";
import * as api from "../lib/tauri";

interface ProjectState {
  currentProject: ProjectInfo | null;
  recentProjects: RecentProject[];
  loading: boolean;

  openProject: (path: string) => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  removeRecent: (path: string) => Promise<void>;
  initProject: (path: string) => Promise<void>;
  detectFromCwd: () => Promise<void>;
  closeProject: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  recentProjects: [],
  loading: true,

  openProject: async (path: string) => {
    set({ loading: true });
    try {
      const info = await api.scanProject(path);
      await api.addRecentProject(path);
      set({ currentProject: info, loading: false });
      // Refresh recent list
      get().loadRecentProjects();
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  loadRecentProjects: async () => {
    try {
      const data = await api.getRecentProjects();
      set({ recentProjects: data.projects });
    } catch {
      // Ignore errors on load
    }
  },

  removeRecent: async (path: string) => {
    await api.removeRecentProject(path);
    set((s) => ({
      recentProjects: s.recentProjects.filter((p) => p.path !== path),
    }));
  },

  initProject: async (path: string) => {
    await api.initProject(path);
    // Re-open to refresh info
    await get().openProject(path);
  },

  detectFromCwd: async () => {
    set({ loading: true });
    try {
      const path = await api.detectProjectFromCwd();
      if (path) {
        await get().openProject(path);
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  closeProject: () => {
    set({ currentProject: null });
  },
}));
