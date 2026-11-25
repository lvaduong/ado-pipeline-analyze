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
  // Empty allowlist keeps host shell/grep/read/glob/ls/edit off.
  // Local re-run is rerun_local_spec. Automation edits are
  // read_automation_source + apply_automation_fix (checkout .ts only).
  // Agent SDK still injects mcp so bot/tools/* stay available.
  tools: [],
});
