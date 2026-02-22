import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualLogPaneProps {
  lines: string[];
  isRunning: boolean;
  activeLogRef: React.RefObject<HTMLPreElement | null>;
}

export default function VirtualLogPane({ lines, isRunning, activeLogRef }: VirtualLogPaneProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const prevLengthRef = useRef(lines.length);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 20,
  });

  // Auto-scroll to bottom when new lines arrive (unless user scrolled away)
  useEffect(() => {
    if (lines.length > prevLengthRef.current && !userScrolledRef.current) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
    prevLengthRef.current = lines.length;
  }, [lines.length, virtualizer]);

  // Track user scroll — if they scroll up, stop auto-scrolling
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolledRef.current = !atBottom;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      ref={(node) => {
        (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        // Forward to activeLogRef so outer LiveLog auto-scroll still works
        if (activeLogRef && "current" in activeLogRef) {
          (activeLogRef as React.MutableRefObject<HTMLPreElement | null>).current = node as unknown as HTMLPreElement;
        }
      }}
      className={`${isRunning ? "max-h-96" : "max-h-60"} overflow-y-auto`}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <span className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
              {lines[virtualRow.index]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
