import { useState } from "react";
import type { Pipeline } from "../../types/pipeline";
import { generatePipeline } from "../../lib/tauri";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";

interface GeneratePromptProps {
  open: boolean;
  onGenerated: (pipeline: Pipeline) => void;
  onCancel: () => void;
}

export default function GeneratePrompt({
  open,
  onGenerated,
  onCancel,
}: GeneratePromptProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const currentProject = useProjectStore((s) => s.currentProject);

  if (!open) return null;

  const canGenerate = prompt.trim().length > 0 && !loading && !!currentProject;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    try {
      const pipeline = await generatePipeline(
        prompt.trim(),
        settings.claude_cli_path || "claude",
        currentProject!.path,
      );
      setPrompt("");
      onGenerated(pipeline);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canGenerate) {
      e.preventDefault();
      handleGenerate();
    }
    if (e.key === "Escape" && !loading) {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-700 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <svg
              className="h-5 w-5 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
              />
            </svg>
            Generate Pipeline
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Describe your pipeline in plain English and Claude will create it.
          </p>
        </div>

        <div className="px-6 py-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Lint the code with eslint, run unit tests with pytest, if tests pass deploy to staging via SSH..."
            rows={5}
            disabled={loading}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            autoFocus
          />
          <div className="mt-1 text-[10px] text-zinc-600">
            Ctrl+Enter to generate
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-6 py-4">
          <button
            type="button"
            onClick={() => {
              if (!loading) {
                setPrompt("");
                setError(null);
                onCancel();
              }
            }}
            disabled={loading}
            className="rounded px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex items-center gap-2 rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                  />
                </svg>
                Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
