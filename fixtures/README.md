# Pinned fixtures

`104954/` holds Azure tool JSON captured for build 104954 (UAT-MIPS-Automation-No-Cron).
Never store `AZURE_DEVOPS_PAT` here. Regenerate with:

```bash
set -a && source .env && set +a
npx --yes "@grok/agent-sdk@0.7.2" tool call get_run_summary --dir . --json \
  --input '{"runUrlOrId":"https://dev.azure.com/MODEC-DnA/dna-mops-MIPS/_build/results?buildId=104954"}'
```
