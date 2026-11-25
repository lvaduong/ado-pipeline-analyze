import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  model: {
    // Token-light for this project: fast + low reasoning (not high).
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "low" },
      { id: "fast", value: "true" },
    ],
  },
  // Empty allowlist keeps host shell/grep/read/glob/ls/task off.
  // Local re-run is only the authored server tool rerun_local_spec
  // (fixed cwd + one UAT spec command). Agent SDK still injects mcp
  // so bot/tools/* remain available (playground + HTTP unchanged).
  tools: [],
});
