import { useEffect } from "react";
import { usePipelineStore } from "../stores/pipelineStore";
import { useRunStore } from "../stores/runStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { useUIStore } from "../stores/uiStore";

export function useKeyboardShortcuts() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const savePipeline = usePipelineStore((s) => s.savePipeline);
  const selectedNodeId = usePipelineStore((s) => s.selectedNodeId);
  const removeNode = usePipelineStore((s) => s.removeNode);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const undo = usePipelineStore((s) => s.undo);
  const redo = usePipelineStore((s) => s.redo);
  const copyNode = usePipelineStore((s) => s.copyNode);
  const pasteNode = usePipelineStore((s) => s.pasteNode);
  const running = useRunStore((s) => s.running);
  const startRun = useRunStore((s) => s.startRun);
  const cancelRun = useRunStore((s) => s.cancelRun);
  const settings = useSettingsStore((s) => s.settings);
  const closePanel = useUIStore((s) => s.closePanel);
  const openPanel = useUIStore((s) => s.openPanel);
  const triggerFitView = useUIStore((s) => s.triggerFitView);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;

      // Escape — close panel
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
        return;
      }

      // Ctrl+R — run pipeline
      if (isMod && e.key === "r") {
        e.preventDefault();
        if (!currentPipeline || !currentProject) return;
        if (running) {
          cancelRun();
        } else {
          openPanel("liveLog");
          startRun(
            currentPipeline,
            {},
            settings.claude_cli_path || "claude",
            currentProject.path,
          );
        }
        return;
      }

      // Space — zoom to fit (when not focused on input)
      if (
        e.key === " " &&
        !isMod &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        triggerFitView();
        return;
      }

      // Delete/Backspace — delete selected node (handled by React Flow)
      // We don't override here since React Flow's deleteKeyCode handles it

      // Ctrl+C — copy node (guarded against input/textarea focus)
      if (
        isMod &&
        e.key === "c" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        if (selectedNodeId) {
          e.preventDefault();
          copyNode();
          return;
        }
      }

      // Ctrl+V — paste node (guarded against input/textarea focus)
      if (
        isMod &&
        e.key === "v" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        pasteNode();
        return;
      }

      // Ctrl+Z — undo
      if (isMod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y — redo
      if (isMod && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+E — export pipeline
      if (isMod && e.key === "e") {
        e.preventDefault();
        if (currentPipeline) {
          const json = JSON.stringify(currentPipeline, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${currentPipeline.name}.pipeline.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentPipeline,
    currentProject,
    running,
    selectedNodeId,
    savePipeline,
    removeNode,
    selectNode,
    startRun,
    cancelRun,
    settings,
    closePanel,
    openPanel,
    triggerFitView,
    undo,
    redo,
    copyNode,
    pasteNode,
  ]);
}
