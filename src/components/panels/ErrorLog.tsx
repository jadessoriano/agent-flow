import { useEffect, useState } from "react";
import { useErrorLogStore } from "../../stores/errorLogStore";
import { buildGitHubIssueUrl, formatErrorsForExport } from "../../lib/errorReporter";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ErrorLog() {
  const sessionErrors = useErrorLogStore((s) => s.sessionErrors);
  const fileEntries = useErrorLogStore((s) => s.fileEntries);
  const logPath = useErrorLogStore((s) => s.logPath);
  const logSizeBytes = useErrorLogStore((s) => s.logSizeBytes);
  const loadFileErrors = useErrorLogStore((s) => s.loadFileErrors);
  const getFullLog = useErrorLogStore((s) => s.getFullLog);
  const clearLog = useErrorLogStore((s) => s.clearLog);
  const markRead = useErrorLogStore((s) => s.markRead);

  const [tab, setTab] = useState<"session" | "file">("session");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    markRead();
  }, [markRead]);

  useEffect(() => {
    if (tab === "file") {
      loadFileErrors();
    }
  }, [tab, loadFileErrors]);

  const entries = tab === "session" ? sessionErrors : fileEntries;

  const handleCopy = async () => {
    const text = formatErrorsForExport(entries);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyFullLog = async () => {
    const log = await getFullLog();
    await navigator.clipboard.writeText(log);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGitHubIssue = () => {
    const text = formatErrorsForExport(entries.slice(-20));
    const url = buildGitHubIssueUrl({ title: "Error report", errorLog: text });
    window.open(url, "_blank");
  };

  const handleClear = () => {
    if (confirm("Clear all error logs?")) {
      clearLog();
    }
  };

  const levelBadge = (level: string) => {
    const upper = level.toUpperCase();
    if (upper.includes("ERROR"))
      return "bg-red-500/20 text-red-400";
    if (upper.includes("WARN"))
      return "bg-amber-500/20 text-amber-400";
    return "bg-blue-500/20 text-blue-400";
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setTab("session")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "session"
              ? "border-b-2 border-violet-400 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Session ({sessionErrors.length})
        </button>
        <button
          onClick={() => setTab("file")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === "file"
              ? "border-b-2 border-violet-400 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Log File
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={handleCopyFullLog}
          className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Copy Full Log
        </button>
        <button
          onClick={handleGitHubIssue}
          className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          GitHub Issue
        </button>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          className="rounded px-2 py-1 text-[10px] text-red-400/70 hover:bg-zinc-800 hover:text-red-400"
        >
          Clear
        </button>
      </div>

      {/* Log path info (file tab only) */}
      {tab === "file" && logPath && (
        <div className="border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-600">
          <div className="truncate">{logPath}</div>
          <div>{formatSize(logSizeBytes)}</div>
        </div>
      )}

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
            {tab === "session"
              ? "No errors this session."
              : "No errors or warnings in log file."}
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="border-b border-zinc-800/50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${levelBadge(entry.level)}`}
                >
                  {entry.level}
                </span>
                {entry.timestamp && (
                  <span className="text-[10px] text-zinc-600">
                    {entry.timestamp}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-zinc-400 break-all">
                {entry.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
