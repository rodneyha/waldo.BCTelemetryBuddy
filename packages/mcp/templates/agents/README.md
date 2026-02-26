# Example Agent Instructions

These are ready-to-use agent instruction templates for common BC telemetry monitoring scenarios. Copy any template folder to your workspace's `agents/` directory and customize the `instruction.md` to fit your environment.

## Available Templates

| Template | Use Case | Key Events | Escalation Pattern |
|----------|----------|------------|-------------------|
| [appsource-validation](appsource-validation/) | ISVs publishing to AppSource | RT0005, LC0010, LC0020 | 3 checks → Teams, 6 checks → email |
| [performance-monitoring](performance-monitoring/) | Track page/report/AL performance | RT0006, RT0007, RT0018 | 2 checks → Teams, 5 checks → email |
| [error-rate-monitoring](error-rate-monitoring/) | Catch-all error rate monitoring | All error events (dynamic) | 1st: log, 2nd: Teams, 3rd: email |
| [post-deployment-check](post-deployment-check/) | Short-lived post-deploy watch | All errors + performance | Immediate Teams + email |

## Quick Start

1. Choose a template
2. Copy the folder to your workspace: `cp -r templates/agents/performance-monitoring agents/`
3. Edit `agents/performance-monitoring/instruction.md` to adjust thresholds
4. Run: `bctb-mcp agent run performance-monitoring --once`
5. Check output in `agents/performance-monitoring/state.json`

## Writing Your Own Agent Instructions

See each template's README for the customization points. Key principles:

- **Be specific about event IDs** when you know which ones matter
- **Be specific about thresholds** — the LLM will follow them literally
- **Describe escalation steps** clearly — "If X for Y consecutive checks, do Z"
- **Describe what to ignore** — test tenants, known-noisy events, etc.
- **Keep it under 500 words** — the LLM processes this on every run
