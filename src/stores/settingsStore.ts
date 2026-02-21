import { create } from "zustand";
import type { AppSettings } from "../types/settings";
import * as api from "../lib/tauri";

interface SettingsState {
  settings: AppSettings;
  loading: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  detectCli: () => Promise<string | null>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    claude_cli_path: null,
    theme: "dark",
  },
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = await api.getSettings();
      set({ settings, loading: false });
      // Auto-detect CLI on startup if no path is saved
      if (!settings.claude_cli_path) {
        const path = await api.detectClaudeCli();
        if (path) {
          const updated = { ...settings, claude_cli_path: path };
          await api.saveSettings(updated);
          set({ settings: updated });
        }
      }
    } catch {
      set({ loading: false });
    }
  },

  updateSettings: async (settings: AppSettings) => {
    await api.saveSettings(settings);
    set({ settings });
  },

  detectCli: async () => {
    const path = await api.detectClaudeCli();
    if (path) {
      const current = useSettingsStore.getState().settings;
      const updated = { ...current, claude_cli_path: path };
      await api.saveSettings(updated);
      set({ settings: updated });
    }
    return path;
  },
}));
