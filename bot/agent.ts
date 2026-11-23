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
  // Pipeline RCA must stay on Azure MCP tools only. Empty allowlist
  // disables host shell/grep/read/glob/ls/task; Agent SDK still injects mcp
  // so bot/tools/* remain available (playground + HTTP unchanged).
  tools: [],
});
