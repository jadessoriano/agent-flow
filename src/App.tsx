import { useEffect, useRef, useState, memo } from "react";
import { useProjectStore } from "./stores/projectStore";
import { usePipelineStore } from "./stores/pipelineStore";
import { useAgentStore } from "./stores/agentStore";
import { useRunStore } from "./stores/runStore";
import { useSettingsStore } from "./stores/settingsStore";
import { startWatching, stopWatching } from "./lib/tauri";
import { listen } from "@tauri-apps/api/event";
import type { RunState, RunStateDelta, NodeLogEvent, NodeLogBatchEvent, ApprovalRequest } from "./types/run";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import WelcomeScreen from "./components/WelcomeScreen";
import TopBar from "./components/topbar/TopBar";
import Canvas from "./components/canvas/Canvas";
import SidePanel from "./components/panels/SidePanel";
import BottomBar from "./components/bottombar/BottomBar";
import ToastStack from "./components/Toast";
import UpdateBanner from "./components/UpdateBanner";

// Memoize heavy children so they don't re-render when App re-renders
const MemoCanvas = memo(Canvas);
const MemoTopBar = memo(TopBar);
const MemoBottomBar = memo(BottomBar);
const MemoSidePanel = memo(SidePanel);

export default function App() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectLoading = useProjectStore((s) => s.loading);
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects);
  const detectFromCwd = useProjectStore((s) => s.detectFromCwd);
  const handleRunUpdate = useRunStore((s) => s.handleRunUpdate);
  const handleRunDelta = useRunStore((s) => s.handleRunDelta);
  const handleNodeLog = useRunStore((s) => s.handleNodeLog);
  const handleNodeLogBatch = useRunStore((s) => s.handleNodeLogBatch);
  const handleApprovalRequest = useRunStore((s) => s.handleApprovalRequest);
  const loadHistory = useRunStore((s) => s.loadHistory);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const settings = useSettingsStore((s) => s.settings);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);

  useKeyboardShortcuts();

  useEffect(() => {
    loadRecentProjects();
    detectFromCwd();
    loadSettings();
    loadHistory();

    // Check for updates on startup (skip in dev to avoid error spam)
    if (!import.meta.env.DEV) {
      import("./lib/updater").then(({ checkForUpdate }) => {
        checkForUpdate().then((info) => {
          if (info) setUpdateInfo(info);
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [loadRecentProjects, detectFromCwd, loadSettings, loadHistory]);

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const dirty = usePipelineStore.getState().dirty;
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Listen for executor events
  useEffect(() => {
    const unlisteners = [
      listen<RunState>("run-update", (e) => {
        handleRunUpdate(e.payload);
        // Desktop notification when run completes (only when app is backgrounded)
        const s = e.payload.status;
        if ((s === "success" || s === "failed" || s === "cancelled") && !document.hasFocus()) {
          const notifEnabled = useSettingsStore.getState().settings.notifications_enabled;
          if (notifEnabled) {
            import("./lib/notifications").then(({ notifyRunComplete }) => {
              notifyRunComplete(e.payload.pipeline_name, s);
            }).catch(() => {});
          }
        }
      }),
      listen<RunStateDelta>("run-update-delta", (e) => handleRunDelta(e.payload)),
      listen<NodeLogEvent>("node-log", (e) => handleNodeLog(e.payload)),
      listen<NodeLogBatchEvent>("node-log-batch", (e) => handleNodeLogBatch(e.payload)),
      listen<ApprovalRequest>("approval-requested", (e) => {
        handleApprovalRequest(e.payload);
        // Desktop notification for approval gates
        if (!document.hasFocus()) {
          const notifEnabled = useSettingsStore.getState().settings.notifications_enabled;
          if (notifEnabled) {
            import("./lib/notifications").then(({ notifyApprovalNeeded }) => {
              notifyApprovalNeeded(e.payload.name);
            }).catch(() => {});
          }
        }
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [handleRunUpdate, handleRunDelta, handleNodeLog, handleNodeLogBatch, handleApprovalRequest]);

  // Start file watcher and load data when project changes.
  // Use getState() inside the effect so the function refs don't trigger re-runs.
  useEffect(() => {
    if (!currentProject) return;

    const refreshData = () => {
      useAgentStore.getState().loadAgents(currentProject.path);
      usePipelineStore.getState().loadPipelines(currentProject.path);
    };

    refreshData();
    startWatching(currentProject.path).catch(() => {});

    // Listen for file changes and refresh (debounced to prevent rapid-fire)
    const unlisten = listen("file-changed", () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refreshData, 500);
    });

    return () => {
      unlisten.then((fn) => fn());
      stopWatching().catch(() => {});
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentProject]);

  if (projectLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-sm text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!currentProject) {
    return <WelcomeScreen />;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" data-theme={settings.theme}>
      <MemoTopBar />
      {updateInfo && (
        <UpdateBanner
          version={updateInfo.version}
          onDismiss={() => setUpdateInfo(null)}
        />
      )}
      <div className="relative flex-1 overflow-hidden">
        <MemoCanvas />
        <MemoSidePanel />
      </div>
      <MemoBottomBar />
      <ToastStack />
    </div>
  );
}
