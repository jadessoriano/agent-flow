import { useState, useEffect, useCallback, useRef } from "react";
import { detectClaudeCliDetailed } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";
import { useSettingsStore } from "../../stores/settingsStore";

interface SetupWizardProps {
  open: boolean;
  projectPath: string | null;
  cliPath: string | null;
  onComplete: () => void;
  onCancel: () => void;
}

type StepStatus = "pending" | "checking" | "passed" | "failed";

const STEP_LABELS = [
  "Claude CLI",
  "Authentication",
  "Project",
  "Confirmation",
] as const;

const AUTO_ADVANCE_MS = 1000;

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-5 w-5 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-violet-400"
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
  );
}

function XIcon() {
  return (
    <svg
      className="h-5 w-5 text-red-400"
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
  );
}

export default function SetupWizard({
  open: isOpen,
  projectPath: initialProjectPath,
  cliPath: initialCliPath,
  onComplete,
  onCancel,
}: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [cliStatus, setCliStatus] = useState<StepStatus>("pending");
  const [cliPathDetected, setCliPathDetected] = useState<string | null>(
    initialCliPath,
  );
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<StepStatus>("pending");
  const [projectStatus, setProjectStatus] = useState<StepStatus>("pending");
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(
    initialProjectPath,
  );
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(
    null,
  );

  const openProject = useProjectStore((s) => s.openProject);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const settings = useSettingsStore((s) => s.settings);

  // Reset state only when the modal transitions from closed to open
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setStep(0);
      setCliStatus("pending");
      setCliPathDetected(initialCliPath);
      setCliVersion(null);
      setAuthStatus("pending");
      setProjectStatus("pending");
      setSelectedProjectPath(initialProjectPath);
      setSelectedProjectName(
        initialProjectPath
          ? initialProjectPath.split("/").pop() ??
              initialProjectPath.split("\\").pop() ??
              null
          : null,
      );
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Step 0: CLI Detection ----
  const checkCli = useCallback(async () => {
    setCliStatus("checking");
    try {
      const result = await detectClaudeCliDetailed();
      if (result.path) {
        setCliPathDetected(result.path);
        setCliVersion(result.version);
        setCliStatus("passed");
      } else {
        setCliStatus("failed");
      }
    } catch {
      setCliStatus("failed");
    }
  }, []);

  useEffect(() => {
    if (isOpen && step === 0 && cliStatus === "pending") {
      checkCli();
    }
  }, [isOpen, step, cliStatus, checkCli]);

  // Auto-advance from step 0 when CLI is found
  useEffect(() => {
    if (step === 0 && cliStatus === "passed") {
      const timer = setTimeout(() => setStep(1), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [step, cliStatus]);

  // ---- Step 1: Authentication Check ----
  // Reuse CLI version from step 0 — a valid version implies the CLI is functional
  const checkAuth = useCallback(() => {
    setAuthStatus("checking");
    if (cliVersion) {
      setAuthStatus("passed");
    } else {
      setAuthStatus("failed");
    }
  }, [cliVersion]);

  useEffect(() => {
    if (isOpen && step === 1 && authStatus === "pending") {
      checkAuth();
    }
  }, [isOpen, step, authStatus, checkAuth]);

  // Auto-advance from step 1 when auth is good
  useEffect(() => {
    if (step === 1 && authStatus === "passed") {
      const timer = setTimeout(() => setStep(2), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [step, authStatus]);

  // ---- Step 2: Project Selection ----
  useEffect(() => {
    if (isOpen && step === 2 && projectStatus === "pending") {
      if (selectedProjectPath) {
        const name =
          selectedProjectPath.split("/").pop() ??
          selectedProjectPath.split("\\").pop() ??
          selectedProjectPath;
        setSelectedProjectName(name);
        setProjectStatus("passed");
      } else {
        setProjectStatus("failed");
      }
    }
  }, [isOpen, step, projectStatus, selectedProjectPath]);

  // Auto-advance from step 2 when project is selected
  useEffect(() => {
    if (step === 2 && projectStatus === "passed") {
      const timer = setTimeout(() => setStep(3), AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [step, projectStatus]);

  const handleSelectProject = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = selected as string;
    const name =
      path.split("/").pop() ?? path.split("\\").pop() ?? path;
    setSelectedProjectPath(path);
    setSelectedProjectName(name);
    setProjectStatus("passed");

    // Persist the project selection
    try {
      await openProject(path);
    } catch {
      // Project store handles errors internally
    }
  };

  // ---- Step 3: Confirmation ----
  const handleStartPipeline = async () => {
    // Persist CLI path to settings if it changed
    if (cliPathDetected && cliPathDetected !== settings.claude_cli_path) {
      try {
        await updateSettings({
          ...settings,
          claude_cli_path: cliPathDetected,
        });
      } catch {
        // Non-critical
      }
    }
    onComplete();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">
            Setup Required
          </h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 border-b border-zinc-800 px-6 py-3">
          {STEP_LABELS.map((label, i) => {
            const isCompleted = i < step;
            const isActive = i === step;
            return (
              <div key={label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      isCompleted
                        ? "bg-green-500"
                        : isActive
                          ? "bg-violet-500"
                          : "bg-zinc-600"
                    }`}
                  />
                  <span
                    className={`text-[10px] ${
                      isActive
                        ? "font-medium text-zinc-200"
                        : isCompleted
                          ? "text-green-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div
                    className={`mb-3 h-px w-8 ${
                      isCompleted ? "bg-green-500/50" : "bg-zinc-700"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {/* ---- Step 0: CLI Detection ---- */}
          {step === 0 && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                {cliStatus === "checking" && <Spinner />}
                {cliStatus === "passed" && (
                  <CheckIcon className="text-green-400" />
                )}
                {cliStatus === "failed" && <XIcon />}
                {cliStatus === "pending" && <Spinner />}
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-100">
                  Claude Code CLI
                </h3>
                {cliStatus === "checking" && (
                  <p className="mt-1 text-xs text-zinc-400">
                    Detecting Claude Code CLI...
                  </p>
                )}
                {cliStatus === "passed" && (
                  <div className="mt-1">
                    <p className="text-xs text-green-400">
                      Found at {cliPathDetected}
                    </p>
                    {cliVersion && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Version {cliVersion}
                      </p>
                    )}
                  </div>
                )}
                {cliStatus === "failed" && (
                  <div className="mt-2 flex flex-col items-center gap-3">
                    <p className="text-xs text-zinc-400">
                      Claude Code CLI was not found on this system.
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500"
                      >
                        Install Claude Code
                      </a>
                      <button
                        onClick={() => {
                          setCliStatus("pending");
                          checkCli();
                        }}
                        className="rounded-lg border border-zinc-600 px-4 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
                      >
                        I've installed it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- Step 1: Authentication ---- */}
          {step === 1 && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                {authStatus === "checking" && <Spinner />}
                {authStatus === "passed" && (
                  <CheckIcon className="text-green-400" />
                )}
                {authStatus === "failed" && <XIcon />}
                {authStatus === "pending" && <Spinner />}
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-100">
                  Authentication
                </h3>
                {authStatus === "checking" && (
                  <p className="mt-1 text-xs text-zinc-400">
                    Checking authentication...
                  </p>
                )}
                {authStatus === "passed" && (
                  <p className="mt-1 text-xs text-green-400">
                    Authenticated and ready
                  </p>
                )}
                {authStatus === "failed" && (
                  <div className="mt-2 flex flex-col items-center gap-3">
                    <p className="text-xs text-zinc-400">
                      Claude Code does not appear to be signed in. Please sign in
                      via the CLI first.
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500"
                      >
                        Sign in to Claude
                      </a>
                      <button
                        onClick={async () => {
                          setAuthStatus("checking");
                          try {
                            const result = await detectClaudeCliDetailed();
                            if (result.version) {
                              setCliVersion(result.version);
                              setAuthStatus("passed");
                            } else {
                              setAuthStatus("failed");
                            }
                          } catch {
                            setAuthStatus("failed");
                          }
                        }}
                        className="rounded-lg border border-zinc-600 px-4 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
                      >
                        I've signed in
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- Step 2: Project Selection ---- */}
          {step === 2 && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                {projectStatus === "checking" && <Spinner />}
                {projectStatus === "passed" && (
                  <CheckIcon className="text-green-400" />
                )}
                {projectStatus === "failed" && (
                  <svg
                    className="h-5 w-5 text-zinc-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                )}
                {projectStatus === "pending" && <Spinner />}
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-100">
                  Project Selection
                </h3>
                {projectStatus === "passed" && selectedProjectName && (
                  <div className="mt-1">
                    <p className="text-xs text-green-400">
                      {selectedProjectName}
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-500 truncate max-w-xs">
                      {selectedProjectPath}
                    </p>
                  </div>
                )}
                {projectStatus === "failed" && (
                  <div className="mt-2 flex flex-col items-center gap-3">
                    <p className="text-xs text-zinc-400">
                      Which project folder should AgentFlow work on?
                    </p>
                    <button
                      onClick={handleSelectProject}
                      className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500"
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
                      Choose Folder
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- Step 3: Confirmation ---- */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                  <CheckIcon className="text-green-400" />
                </div>
              </div>
              <h3 className="text-center text-sm font-medium text-zinc-100">
                Ready to Run
              </h3>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-xs font-medium text-zinc-500">
                      CLI
                    </span>
                    <span className="text-xs text-zinc-300 break-all">
                      {cliPathDetected ?? "Not detected"}
                    </span>
                  </div>
                  <div className="h-px bg-zinc-700" />
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-xs font-medium text-zinc-500">
                      Project
                    </span>
                    <span className="text-xs text-zinc-300 break-all">
                      {selectedProjectPath ?? "Not selected"}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleStartPipeline}
                className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
              >
                Start Pipeline
              </button>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3">
          <button
            onClick={onCancel}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && step < 3 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
              >
                Back
              </button>
            )}
            {step < 3 && (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={
                  (step === 0 && cliStatus !== "passed") ||
                  (step === 1 && authStatus !== "passed") ||
                  (step === 2 && projectStatus !== "passed")
                }
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
