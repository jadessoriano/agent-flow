import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";

// ---------------------------------------------------------------------------
// HintOverlay – contextual hint banner that can be permanently dismissed
// ---------------------------------------------------------------------------

interface HintOverlayProps {
  hintId: string;
  content: string;
  position?: "top" | "bottom";
  className?: string;
}

export default function HintOverlay({
  hintId,
  content,
  position = "top",
  className = "",
}: HintOverlayProps) {
  const dismissedHints = useSettingsStore((s) => s.local.dismissed_hints);
  const dismissHint = useSettingsStore((s) => s.dismissHint);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (dismissedHints.includes(hintId)) return null;

  const handleDismiss = () => {
    setVisible(false);
    timerRef.current = setTimeout(() => dismissHint(hintId), 200);
  };

  const positionClasses =
    position === "top" ? "top-0 left-0 right-0" : "bottom-0 left-0 right-0";

  return (
    <div
      className={`${positionClasses} z-40 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      } ${className}`}
    >
      <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2">
        <p className="flex-1 text-xs text-violet-300">{content}</p>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded p-0.5 text-violet-400 hover:text-violet-200"
          aria-label="Dismiss hint"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HelpIcon – small "?" circle that toggles a tooltip on click
// ---------------------------------------------------------------------------

interface HelpIconProps {
  text: string;
}

export function HelpIcon({ text }: HelpIconProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-600 text-[9px] leading-none text-zinc-500 hover:border-zinc-400 hover:text-zinc-300"
        aria-label="Show help"
      >
        ?
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[10px] leading-snug text-zinc-300 shadow-lg"
          style={{ maxWidth: 200, minWidth: 100 }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
