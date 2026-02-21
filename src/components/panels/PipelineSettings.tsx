import { useState, useEffect } from "react";
import { usePipelineStore } from "../../stores/pipelineStore";
import { useProjectStore } from "../../stores/projectStore";
import { listSecrets, setSecret, deleteSecret } from "../../lib/tauri";
import type { PipelineVariables } from "../../types/pipeline";

export default function PipelineSettings() {
  const currentPipeline = usePipelineStore((s) => s.currentPipeline);
  const updatePipelineMeta = usePipelineStore((s) => s.updatePipelineMeta);
  const currentProject = useProjectStore((s) => s.currentProject);

  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<[string, string][]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  // Secrets state
  const [secrets, setSecrets] = useState<string[]>([]);
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentPipeline) {
      setDescription(currentPipeline.description);
      setVariables(Object.entries(currentPipeline.variables || {}));
    }
  }, [currentPipeline]);

  useEffect(() => {
    if (currentProject) {
      listSecrets(currentProject.path).then(setSecrets).catch(() => {});
    }
  }, [currentProject]);

  if (!currentPipeline) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-500">
        Open a pipeline to configure it
      </div>
    );
  }

  const handleAddVariable = () => {
    if (!newKey.trim()) return;
    setVariables((v) => [...v, [newKey.trim(), newValue]]);
    setNewKey("");
    setNewValue("");
  };

  const handleRemoveVariable = (index: number) => {
    setVariables((v) => v.filter((_, i) => i !== index));
  };

  const handleUpdateVariable = (
    index: number,
    field: "key" | "value",
    val: string,
  ) => {
    setVariables((v) =>
      v.map((pair, i) =>
        i === index
          ? field === "key"
            ? [val, pair[1]]
            : [pair[0], val]
          : pair,
      ),
    );
  };

  const handleSave = () => {
    const vars: PipelineVariables = {};
    variables.forEach(([k, v]) => {
      if (k.trim()) vars[k.trim()] = v;
    });
    updatePipelineMeta({ description, variables: vars });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* Pipeline name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Pipeline
          </label>
          <div className="text-sm font-medium text-zinc-200">
            {currentPipeline.name}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
            placeholder="Describe what this pipeline does..."
          />
        </div>

        {/* Variables */}
        <div>
          <label className="mb-2 block text-xs font-medium text-zinc-400">
            Variables
          </label>
          <p className="mb-2 text-[10px] text-zinc-600">
            Use {"${var_name}"} or {"$var_name"} in node instructions to
            reference variables.
          </p>

          <div className="flex flex-col gap-2">
            {variables.map(([key, value], i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  type="text"
                  value={key}
                  onChange={(e) =>
                    handleUpdateVariable(i, "key", e.target.value)
                  }
                  className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
                  placeholder="key"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) =>
                    handleUpdateVariable(i, "value", e.target.value)
                  }
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
                  placeholder="default value"
                />
                <button
                  onClick={() => handleRemoveVariable(i)}
                  className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  x
                </button>
              </div>
            ))}

            {/* Add new variable */}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddVariable();
                }}
                className="w-28 rounded border border-zinc-600 bg-zinc-850 px-2 py-1 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                placeholder="new key"
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddVariable();
                }}
                className="flex-1 rounded border border-zinc-600 bg-zinc-850 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                placeholder="default value"
              />
              <button
                onClick={handleAddVariable}
                className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Apply */}
        <button
          onClick={handleSave}
          className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          Apply Changes
        </button>

        {/* Secrets */}
        {currentProject && (
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-400">
              Secrets
            </label>
            <p className="mb-2 text-[10px] text-zinc-600">
              Stored in OS keychain. Use {"$secret.KEY_NAME"} in node instructions. Never saved in pipeline JSON.
            </p>

            <div className="flex flex-col gap-2">
              {secrets.map((key) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="w-28 truncate font-mono text-xs text-zinc-200">
                    {key}
                  </span>
                  <span className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
                    {revealedSecrets.has(key) ? "(stored)" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                  </span>
                  <button
                    onClick={() => {
                      setRevealedSecrets((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    className="rounded px-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    {revealedSecrets.has(key) ? "hide" : "show"}
                  </button>
                  <button
                    onClick={async () => {
                      await deleteSecret(currentProject.path, key);
                      setSecrets((s) => s.filter((k) => k !== key));
                    }}
                    className="rounded px-1 text-xs text-zinc-500 hover:text-red-400"
                  >
                    x
                  </button>
                </div>
              ))}

              {/* Add new secret */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value)}
                  placeholder="SECRET_KEY"
                  className="w-28 rounded border border-zinc-600 bg-zinc-850 px-2 py-1 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                />
                <input
                  type="password"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  placeholder="secret value"
                  className="flex-1 rounded border border-zinc-600 bg-zinc-850 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                />
                <button
                  onClick={async () => {
                    if (!newSecretKey.trim() || !newSecretValue) return;
                    await setSecret(currentProject.path, newSecretKey.trim(), newSecretValue);
                    setSecrets((s) => [...s.filter((k) => k !== newSecretKey.trim()), newSecretKey.trim()]);
                    setNewSecretKey("");
                    setNewSecretValue("");
                  }}
                  className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
