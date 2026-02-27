import { create } from "zustand";
import type { AppSettings } from "../types/settings";
import type { ExperienceMode, LocalSettings } from "../types/settings";
import * as api from "../lib/tauri";

function loadLocalSettings(): LocalSettings {
  const rawMode = localStorage.getItem("af-mode");
  const mode: ExperienceMode = rawMode === "simple" || rawMode === "advanced" ? rawMode : "simple";

  let dismissed_hints: string[] = [];
  try {
    const raw = localStorage.getItem("af-dismissed-hints");
    if (raw) dismissed_hints = JSON.parse(raw);
    if (!Array.isArray(dismissed_hints)) dismissed_hints = [];
  } catch {
    dismissed_hints = [];
  }

  return {
    mode,
    dismissed_hints,
    successful_run_count: parseInt(localStorage.getItem("af-run-count") || "0", 10) || 0,
  };
}

interface SettingsState {
  settings: AppSettings;
  local: LocalSettings;
  loading: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  detectCli: () => Promise<string | null>;
  setMode: (mode: ExperienceMode) => void;
  dismissHint: (id: string) => void;
  incrementRunCount: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    claude_cli_path: null,
    theme: "dark",
    notifications_enabled: true,
  },
  local: loadLocalSettings(),
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

  setMode: (mode: ExperienceMode) => {
    localStorage.setItem("af-mode", mode);
    set({ local: { ...get().local, mode } });
  },

  dismissHint: (id: string) => {
    const current = get().local;
    if (current.dismissed_hints.includes(id)) return;
    const updated = [...current.dismissed_hints, id];
    localStorage.setItem("af-dismissed-hints", JSON.stringify(updated));
    set({ local: { ...current, dismissed_hints: updated } });
  },

  incrementRunCount: () => {
    const current = get().local;
    const count = current.successful_run_count + 1;
    localStorage.setItem("af-run-count", String(count));
    set({ local: { ...current, successful_run_count: count } });
  },
}));
