import { useState, useMemo, memo } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useUIStore } from "../../stores/uiStore";
import { logError, addToast } from "../../lib/errorReporter";

export default memo(function AgentLibrary() {
  const agents = useAgentStore((s) => s.agents);
  const loading = useAgentStore((s) => s.loading);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const currentProject = useProjectStore((s) => s.currentProject);
  const openPanel = useUIStore((s) => s.openPanel);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => agents.filter(
    (a) =>
      (a.display_name ?? a.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.description ?? "").toLowerCase().includes(search.toLowerCase()),
  ), [agents, search]);

  const handleSelect = async (path: string) => {
    await selectAgent(path);
    openPanel("editor");
  };

  const handleCreate = async () => {
    if (!currentProject || !newName.trim()) return;
    const { createAgent } = useAgentStore.getState();
    const defaultContent = `# ${newName.trim()}\n\nDescribe what this agent does.\n`;
    try {
      const path = await createAgent(
        currentProject.path,
        newName.trim(),
        defaultContent,
      );
      setShowCreate(false);
      setNewName("");
      await selectAgent(path);
      openPanel("editor");
    } catch (e) {
      logError(`Agent creation failed: ${e}`, "AgentLibrary");
      addToast(`Agent creation failed: ${e}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {/* Create new */}
      {showCreate ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name..."
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500"
          >
            Create
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setNewName("");
            }}
            className="rounded px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-violet-500 hover:text-violet-400"
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
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          New Agent
        </button>
      )}

      {/* Agent list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">
          Loading agents...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-500">
          {agents.length === 0
            ? "No agents yet. Create your first one!"
            : "No agents match your search."}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((agent) => (
            <button
              key={agent.path}
              onClick={() => handleSelect(agent.path)}
              className="rounded-lg px-3 py-2.5 text-left hover:bg-zinc-800"
            >
              <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                {agent.display_name ?? agent.name}
                {agent.origin === "pipeline" && (
                  <span className="rounded bg-cyan-900/50 px-1.5 py-0.5 text-[10px] text-cyan-400">
                    pipeline
                  </span>
                )}
              </div>
              {agent.description && (
                <div className="mt-0.5 text-xs text-zinc-500 line-clamp-2">
                  {agent.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
