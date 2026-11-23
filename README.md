# mips-pipeline-test-fixer

Agent SDK domain assistant that analyzes Azure Pipelines automation test
failures and proposes fixes.

**Channels (v1):** playground + HTTP only. No Slack / Teams / GitHub /
webhook / schedule.

**Cross-product:** Cursor / ChatGPT / Claude adapters come later. This
repo does not ship OpenAI or Anthropic wrappers.

## Secrets

Set on the host (never paste into chat or commit):

| Name | Purpose |
| --- | --- |
| `AZURE_DEVOPS_ORG_URL` | Org base URL, e.g. `https://dev.azure.com/YourOrg` |
| `AZURE_DEVOPS_PAT` | PAT with Build Read + Test Results Read |
| `AZURE_DEVOPS_FIXTURE_BUILD` | Optional. e.g. `104954` — serve `fixtures/{id}/` JSON (no live Azure) |
| `AZURE_DEVOPS_USE_FIXTURES` | Optional. `1` — prefer pinned fixtures for matching buildIds even if PAT is set |
| `AZURE_DEVOPS_FIXTURE_DIR` | Optional override of fixtures root (default: `./fixtures`) |
| `DNA_AUTOMATION_TEST_ROOT` | Optional path to local `dna-automation-test` checkout (default `~/Documents/dna-automation-test`) |
| `CURSOR_API_KEY` | Cursor credential for model turns (`run` / `eval` / playground) |

If Azure secrets are missing, paste a run URL/id and log snippets; the
agent still analyzes from that text.

## Local loop

```bash
cd ~/Documents/mips-pipeline-test-fixer   # or your clone
npm install                              # once
# secrets: shell exports or local .env (gitignored) — see table above
npx --yes "@grok/agent-sdk@0.7.2" validate --dir .
npx tsc --noEmit -p .
npx --yes "@grok/agent-sdk@0.7.2" tool call get_run_summary --dir . --input '{"runUrlOrId":"https://dev.azure.com/example/Mips/_build/results?buildId=1001"}' --json
npx --yes "@grok/agent-sdk@0.7.2" run --dir . --message "Analyze https://dev.azure.com/example/Mips/_build/results?buildId=1001"
npx --yes "@grok/agent-sdk@0.7.2" eval --dir .
npx --yes "@grok/agent-sdk@0.7.2" dev .
# playground: http://127.0.0.1:3000/playground
```

## Tools

- `get_run_summary` — build / test-run summary
- `list_failed_tests` — failed tests with error + stack
- `get_log_slice` — bounded build log slice
- `resolve_test_source` — map failed test names/stacks → paths in local `dna-automation-test`

## Evals / fixtures

- `evals/` — smoke, RCA shape, Azure-tools-only, tool-budget, log-slice-when-thin, resolve-test-source  
  (`purpose=eval` → inline fixtures, no Azure PAT / no `fixtures/104954` disk reads)
- `fixtures/104954/` — pinned Azure tool JSON for offline smoke of build 104954 (no secrets).  
  Used when `AZURE_DEVOPS_FIXTURE_BUILD=104954`, `AZURE_DEVOPS_USE_FIXTURES=1`, or PAT unset + matching build URL.
