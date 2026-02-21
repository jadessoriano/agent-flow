import { TEMPLATES, type PipelineTemplate } from "../../data/templates";

interface TemplatePickerModalProps {
  open: boolean;
  onSelect: (template: PipelineTemplate) => void;
  onClose: () => void;
}

export default function TemplatePickerModal({ open, onSelect, onClose }: TemplatePickerModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-850 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Choose a Template</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="flex flex-col gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-left hover:border-violet-500/50 hover:bg-zinc-700"
            >
              <div className="text-sm font-medium text-zinc-100">{t.name}</div>
              <div className="text-xs text-zinc-400">{t.description}</div>
              <div className="mt-1 text-[10px] text-zinc-500">{t.nodeCount} nodes</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
