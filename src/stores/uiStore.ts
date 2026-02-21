import { create } from "zustand";

export type PanelView = "library" | "editor" | "settings" | "nodeConfig" | "edgeConfig" | "pipelineSettings" | "liveLog" | "runHistory" | "costDashboard" | "errorLog" | null;

export interface Toast {
  id: string;
  message: string;
  level: "error" | "warning" | "info";
}

interface UIState {
  panelView: PanelView;
  panelOpen: boolean;
  zoomLevel: number;
  fitViewTrigger: number;
  toasts: Toast[];

  openPanel: (view: PanelView) => void;
  closePanel: () => void;
  togglePanel: (view: PanelView) => void;
  setZoomLevel: (level: number) => void;
  triggerFitView: () => void;
  addToast: (message: string, level?: "error" | "warning" | "info") => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>((set, get) => ({
  panelView: null,
  panelOpen: false,
  zoomLevel: 1,
  fitViewTrigger: 0,
  toasts: [],

  openPanel: (view: PanelView) => {
    set({ panelView: view, panelOpen: true });
  },

  closePanel: () => {
    set({ panelOpen: false });
  },

  togglePanel: (view: PanelView) => {
    const { panelView, panelOpen } = get();
    if (panelOpen && panelView === view) {
      set({ panelOpen: false });
    } else {
      set({ panelView: view, panelOpen: true });
    }
  },

  setZoomLevel: (level: number) => {
    set({ zoomLevel: level });
  },

  triggerFitView: () => {
    set((s) => ({ fitViewTrigger: s.fitViewTrigger + 1 }));
  },

  addToast: (message: string, level: "error" | "warning" | "info" = "error") => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, level }] }));
  },

  removeToast: (id: string) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
