import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { LogEntry, LogInfo } from "../types/errorLog";

interface ErrorLogState {
  sessionErrors: LogEntry[];
  fileEntries: LogEntry[];
  logPath: string;
  logSizeBytes: number;
  unreadCount: number;

  addError: (level: string, message: string) => void;
  loadFileErrors: (limit?: number) => Promise<void>;
  getFullLog: () => Promise<string>;
  clearLog: () => Promise<void>;
  markRead: () => void;
}

export const useErrorLogStore = create<ErrorLogState>((set) => ({
  sessionErrors: [],
  fileEntries: [],
  logPath: "",
  logSizeBytes: 0,
  unreadCount: 0,

  addError: (level: string, message: string) => {
    const MAX_SESSION_ERRORS = 500;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    set((s) => {
      const updated = [...s.sessionErrors, entry];
      return {
        sessionErrors: updated.length > MAX_SESSION_ERRORS
          ? updated.slice(-MAX_SESSION_ERRORS)
          : updated,
        unreadCount: s.unreadCount + 1,
      };
    });
  },

  loadFileErrors: async (limit?: number) => {
    try {
      const info: LogInfo = await invoke("get_error_log", {
        limit: limit ?? 200,
      });
      set({
        fileEntries: info.entries,
        logPath: info.path,
        logSizeBytes: info.size_bytes,
      });
    } catch (e) {
      console.error("Failed to load error log:", e);
    }
  },

  getFullLog: async () => {
    try {
      return await invoke<string>("get_full_log");
    } catch (e) {
      console.error("Failed to get full log:", e);
      return "";
    }
  },

  clearLog: async () => {
    try {
      await invoke("clear_error_log");
      set({ sessionErrors: [], fileEntries: [], unreadCount: 0, logSizeBytes: 0 });
    } catch (e) {
      console.error("Failed to clear log:", e);
    }
  },

  markRead: () => {
    set({ unreadCount: 0 });
  },
}));
