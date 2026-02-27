import { useState } from "react";
import { TEMPLATES, type PipelineTemplate } from "../data/templates";
import { useProjectStore } from "../stores/projectStore";
import { usePipelineStore } from "../stores/pipelineStore";
import { scanProject } from "../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { logError, addToast } from "../lib/errorReporter";
import AboutModal from "./AboutModal";

/* ---------- Icon map (inline SVGs keyed by template.icon) ---------- */

function TemplateIcon({ icon, className }: { icon: string; className?: string }) {
  const cls = className ?? "h-6 w-6";
  switch (icon) {
    case "search":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      );
    case "bug":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-3.828-7.44M12 12.75c-2.883 0-5.647.508-8.207 1.44a23.91 23.91 0 003.828-7.44m8.758 0a24.107 24.107 0 00-4.38-5.5 24.107 24.107 0 00-4.378 5.5m8.757 0a23.878 23.878 0 01-4.378 7.44m-4.38-7.44a23.878 23.878 0 004.38 7.44" />
        </svg>
      );
    case "rocket":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      );
    case "ticket":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      );
    case "tag":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
        </svg>
      );
    case "sparkles":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      );
    case "book":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      );
    case "wrench":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" />
        </svg>
      );
  }
}

/* ---------- Chevron icon for collapsible section ---------- */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

/* ---------- Main component ---------- */

export default function WelcomeScreen() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const openProject = useProjectStore((s) => s.openProject);
  const initProject = useProjectStore((s) => s.initProject);
  const removeRecent = useProjectStore((s) => s.removeRecent);
  const createFromTemplate = usePipelineStore((s) => s.createFromTemplate);
  const currentProject = useProjectStore((s) => s.currentProject);

  /** Open a directory picker, optionally init .claude/, and return the project path. */
  const pickProject = async (): Promise<string | null> => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return null;

    const path = selected as string;
    const info = await scanProject(path);
    if (!info.has_claude_dir) {
      // Auto-init the .claude directory structure for a smoother onboarding
      await initProject(path);
    }
    await openProject(path);
    return path;
  };

  /** Handle "Open Project" (secondary button) */
  const handleOpenProject = async () => {
    try {
      await pickProject();
    } catch (e) {
      logError(`Failed to open project: ${e}`, "WelcomeScreen");
      addToast(`Failed to open project: ${e}`);
    }
  };

  /** Handle "Use Template" on a card */
  const handleUseTemplate = async (template: PipelineTemplate) => {
    setLoadingTemplateId(template.id);
    try {
      let projectPath = currentProject?.path ?? null;

      if (!projectPath) {
        projectPath = await pickProject();
        if (!projectPath) {
          setLoadingTemplateId(null);
          return;
        }
      }

      await createFromTemplate(projectPath, template.pipeline);
    } catch (e) {
      logError(`Failed to load template: ${e}`, "WelcomeScreen");
      addToast(`Failed to load template "${template.name}": ${e}`);
    } finally {
      setLoadingTemplateId(null);
    }
  };

  /** Handle "+ Create from Scratch" */
  const handleCreateBlank = async () => {
    try {
      await pickProject();
    } catch (e) {
      logError(`Failed to open project: ${e}`, "WelcomeScreen");
      addToast(`Failed to open project: ${e}`);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col items-center bg-[var(--bg-primary)] overflow-y-auto">
      <div className="w-full max-w-4xl px-6 py-12">
        {/* ---------- Header ---------- */}
        <div className="mb-10 text-center">
          <div className="mb-3 flex items-center justify-center gap-2.5">
            <svg
              className="h-9 w-9 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
              />
            </svg>
            <h1 className="text-3xl font-bold text-zinc-100">AgentFlow</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Automate your development workflow with AI
          </p>
        </div>

        {/* ---------- Template Gallery ---------- */}
        <div className="mb-8">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Start from a Template
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="group flex flex-col rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4 transition-colors hover:border-violet-500/50 hover:bg-zinc-800"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-500/10 text-violet-400">
                    <TemplateIcon icon={template.icon} className="h-5 w-5" />
                  </div>
                  <span className="inline-flex items-center rounded-full bg-zinc-700/60 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                    {template.nodeCount} {template.nodeCount === 1 ? "node" : "nodes"}
                  </span>
                </div>
                <h3 className="mb-1 text-sm font-semibold text-zinc-100">
                  {template.name}
                </h3>
                <p className="mb-4 flex-1 text-xs leading-relaxed text-zinc-400">
                  {template.description}
                </p>
                <button
                  onClick={() => handleUseTemplate(template)}
                  disabled={loadingTemplateId === template.id}
                  className="mt-auto w-full rounded-md bg-violet-600/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                >
                  {loadingTemplateId === template.id ? "Loading..." : "Use Template"}
                </button>
              </div>
            ))}

            {/* + Create from Scratch */}
            <div
              onClick={handleCreateBlank}
              className="group flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/50 bg-zinc-800/20 p-4 transition-colors hover:border-violet-500/50 hover:bg-zinc-800/40"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-700/40 text-zinc-400 transition-colors group-hover:bg-violet-500/10 group-hover:text-violet-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <h3 className="mb-1 text-sm font-semibold text-zinc-300 group-hover:text-zinc-100">
                Create from Scratch
              </h3>
              <p className="text-xs text-zinc-500">
                Open a blank canvas
              </p>
            </div>
          </div>
        </div>

        {/* ---------- Open Project (secondary) ---------- */}
        <div className="mb-6 flex justify-center">
          <button
            onClick={handleOpenProject}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
              />
            </svg>
            Open Existing Project
          </button>
        </div>

        {/* ---------- Recent Projects (collapsible) ---------- */}
        {recentProjects.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setRecentOpen((prev) => !prev)}
              className="mb-2 flex w-full items-center gap-2 text-left"
            >
              <ChevronIcon open={recentOpen} />
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Recent Projects
              </span>
              <span className="text-[10px] text-zinc-600">
                ({recentProjects.length})
              </span>
            </button>
            {recentOpen && (
              <div className="flex flex-col gap-1 rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-1">
                {recentProjects.map((p) => (
                  <div
                    key={p.path}
                    className="group flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-zinc-700/40"
                  >
                    <button
                      onClick={() => openProject(p.path)}
                      className="flex-1 text-left"
                    >
                      <div className="text-sm font-medium text-zinc-200">
                        {p.name}
                      </div>
                      <div className="truncate text-xs text-zinc-600">
                        {p.path}
                      </div>
                    </button>
                    <button
                      onClick={() => removeRecent(p.path)}
                      className="ml-2 rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-400 group-hover:opacity-100"
                      title="Remove from list"
                    >
                      <svg
                        className="h-3.5 w-3.5"
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- About link ---------- */}
        <div className="text-center">
          <button
            onClick={() => setAboutOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
              />
            </svg>
            What is AgentFlow?
          </button>
        </div>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
