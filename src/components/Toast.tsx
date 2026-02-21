import { useEffect } from "react";
import { useUIStore } from "../stores/uiStore";

const levelStyles = {
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  info: "border-blue-500/40 bg-blue-500/10 text-blue-300",
};

const levelIcons = {
  error: "\u2717",
  warning: "\u26A0",
  info: "\u2139",
};

export default function ToastStack() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          level={toast.level}
          onDismiss={removeToast}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  message,
  level,
  onDismiss,
}: {
  id: string;
  message: string;
  level: "error" | "warning" | "info";
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 5000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${levelStyles[level]} max-w-sm animate-in slide-in-from-right`}
    >
      <span className="mt-0.5 text-sm">{levelIcons[level]}</span>
      <p className="flex-1 text-xs leading-relaxed">{message}</p>
      <button
        onClick={() => onDismiss(id)}
        className="ml-1 rounded p-0.5 text-zinc-400 hover:text-zinc-200"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
