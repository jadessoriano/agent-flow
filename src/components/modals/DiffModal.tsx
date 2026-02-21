import type { Pipeline } from "../../types/pipeline";
import { computePipelineDiff, type DiffEntry } from "../../lib/pipelineDiff";

interface DiffModalProps {
  open: boolean;
  saved: Pipeline;
  current: Pipeline;
  onClose: () => void;
}

const typeColors: Record<DiffEntry["type"], string> = {
  added: "text-green-400",
  removed: "text-red-400",
  changed: "text-amber-400",
};

const typeLabels: Record<DiffEntry["type"], string> = {
  added: "+",
  removed: "-",
  changed: "~",
};

const categoryBadgeColors: Record<DiffEntry["category"], string> = {
  node: "bg-violet-500/20 text-violet-400",
  edge: "bg-blue-500/20 text-blue-400",
  variable: "bg-emerald-500/20 text-emerald-400",
  meta: "bg-zinc-500/20 text-zinc-400",
};

export default function DiffModal({ open, saved, current, onClose }: DiffModalProps) {
  if (!open) return null;

  const entries = computePipelineDiff(saved, current);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-850 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Unsaved Changes</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <p className="text-sm text-zinc-500">No changes detected.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 rounded border border-zinc-700/50 bg-zinc-800 px-3 py-2">
                  <span className={`mt-0.5 font-mono text-xs font-bold ${typeColors[entry.type]}`}>
                    {typeLabels[entry.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200">{entry.description}</div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${categoryBadgeColors[entry.category]}`}>
                    {entry.category}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-zinc-700 px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="text-green-400">{entries.filter((e) => e.type === "added").length} added</span>
            <span className="text-zinc-600">|</span>
            <span className="text-amber-400">{entries.filter((e) => e.type === "changed").length} changed</span>
            <span className="text-zinc-600">|</span>
            <span className="text-red-400">{entries.filter((e) => e.type === "removed").length} removed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
