import { useEffect, useState, memo } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { detectClaudeCliDetailed } from "../../lib/tauri";
import { logWarning, addToast } from "../../lib/errorReporter";

export default memo(function Settings() {
  const settings = useSettingsStore((s) => s.settings);
  const loading = useSettingsStore((s) => s.loading);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [cliPath, setCliPath] = useState(settings.claude_cli_path ?? "");
  const [detecting, setDetecting] = useState(false);
  const [detectInfo, setDetectInfo] = useState<{
    version: string | null;
    source: string | null;
  } | null>(null);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setCliPath(settings.claude_cli_path ?? "");
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({
      ...settings,
      claude_cli_path: cliPath || null,
    });
  };

  const handleDetect = async () => {
    setDetecting(true);
    setDetectInfo(null);
    try {
      const result = await detectClaudeCliDetailed();
      if (result.path) {
        setCliPath(result.path);
        setDetectInfo({ version: result.version, source: result.source });
      } else {
        setDetectInfo(null);
        logWarning("Claude CLI not found during detection", "Settings");
        addToast(
          "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
          "warning",
        );
      }
    } finally {
      setDetecting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-zinc-500">Loading settings...</div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Global Settings
        </h3>
      </div>

      {/* Claude CLI Path */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Claude Code CLI Path
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={cliPath}
            onChange={(e) => setCliPath(e.target.value)}
            placeholder="/usr/bin/claude"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            {detecting ? "..." : "Detect"}
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Path to the Claude Code CLI executable. Click Detect to auto-find it.
        </p>
        {detectInfo && (
          <div className="mt-2 rounded border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-xs">
            {detectInfo.source && (
              <div className="text-zinc-400">
                Found via: <span className="text-green-400">{detectInfo.source}</span>
              </div>
            )}
            {detectInfo.version && (
              <div className="text-zinc-400">
                Version: <span className="text-zinc-300">{detectInfo.version}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Theme */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Theme
        </label>
        <select
          value={settings.theme}
          onChange={(e) => {
            const updated = { ...settings, theme: e.target.value };
            updateSettings(updated);
          }}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
        >
          <option value="dark">Dark</option>
        </select>
      </div>

      {/* Notifications */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Desktop Notifications
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const updated = {
                ...settings,
                notifications_enabled: !settings.notifications_enabled,
              };
              updateSettings(updated);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.notifications_enabled ? "bg-violet-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                settings.notifications_enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm text-zinc-400">
            {settings.notifications_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Get notified when pipelines complete or need approval
        </p>
      </div>

      {/* Check for Updates */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Updates
        </label>
        <button
          onClick={async () => {
            try {
              const { checkForUpdate } = await import("../../lib/updater");
              const info = await checkForUpdate();
              if (info) {
                addToast(`Update available: v${info.version}`, "info");
              } else {
                addToast("You're on the latest version", "info");
              }
            } catch {
              addToast("Could not check for updates", "warning");
            }
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Check for Updates
        </button>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
      >
        Save Settings
      </button>
    </div>
  );
});
