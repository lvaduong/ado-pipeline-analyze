# Pinned fixtures

`104954/` holds Azure tool JSON captured for build 104954 (UAT-MIPS-Automation-No-Cron).
Never store `AZURE_DEVOPS_PAT` here.

## Files

| File | Tool / input |
| --- | --- |
| `get_run_summary.json` | `get_run_summary` |
| `list_failed_tests_default.json` | `list_failed_tests` (default / run 33786) |
| `list_failed_tests_33786.json` | parallel run |
| `list_failed_tests_33794.json` | exclusive run |
| `get_log_slice_list.json` | `get_log_slice` without `logId` |
| `get_log_slice_19.json` | parallel job end-slice (round 5) |
| `get_log_slice_37.json` | exclusive job end-slice (round 5) |
| `prompt.txt` | hillclimb / smoke prompt |

## When tools use them

1. **`purpose === "eval"`** — inline `EVAL_FIXTURE_*` in `bot/lib/azure-devops.ts` (not these files). No PAT.
2. **Pinned path (no live Azure)** — any of:
   - `AZURE_DEVOPS_FIXTURE_BUILD=104954`
   - `AZURE_DEVOPS_USE_FIXTURES=1` and URL buildId has a `fixtures/{id}/` folder
   - `AZURE_DEVOPS_PAT` unset and `fixtures/{buildId}/` exists (auto offline)
3. **Live** — PAT set and fixtures not forced → real Azure DevOps REST.

Optional: `AZURE_DEVOPS_FIXTURE_DIR` overrides the fixtures root (default: repo `fixtures/`).

## Regenerate (needs PAT + network)

```bash
set -a && source .env && set +a
npx --yes "@grok/agent-sdk@0.7.2" tool call get_run_summary --dir . --json \
  --input '{"runUrlOrId":"https://dev.azure.com/MODEC-DnA/dna-mops-MIPS/_build/results?buildId=104954"}'
# similarly list_failed_tests (per runId) and get_log_slice (list + chosen logIds)
```

Log slices for 104954 were also materialized from `hillclimb-traces/round5-104954.ndjson` (logIds 19 + 37).
