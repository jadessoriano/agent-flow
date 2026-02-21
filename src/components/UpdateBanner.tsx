interface UpdateBannerProps {
  version: string;
  onUpdate?: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ version, onUpdate, onDismiss }: UpdateBannerProps) {
  const handleUpdate = async () => {
    if (onUpdate) {
      onUpdate();
    } else {
      try {
        const { installUpdate } = await import("../lib/updater");
        await installUpdate();
      } catch {
        // Update failed silently
      }
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-violet-500/30 bg-violet-500/10 px-4 py-2">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="text-xs text-violet-200">
          AgentFlow <strong>v{version}</strong> is available
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleUpdate}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-500"
        >
          Update Now
        </button>
        <button
          onClick={onDismiss}
          className="rounded p-1 text-violet-300 hover:bg-violet-500/20 hover:text-violet-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
