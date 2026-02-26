# Agent: Post-Deployment Watch

## Purpose
Short-lived monitoring agent activated after an extension deployment.
Compares error rates and performance against the pre-deployment baseline
built up in previous runs. Detects deployment regressions and alerts immediately.

Unlike other agents which run indefinitely, this one is designed to be:
- Started manually after a deployment
- Run frequently (e.g., every 15-30 minutes)
- Paused after 24 hours of stable operation

## BC Telemetry Events Used

| Event ID | Name | Why This Agent Uses It |
|----------|------|----------------------|
| (all error events) | All events with error status | Detects error rate regressions |
| RT0006, RT0007 | Web request timing | Detects performance regressions |
| LC0010, LC0020 | Extension install/update failures | Detects deployment-specific failures |

## Customization Points

| What | Default in Template | How to Change |
|------|-------------------|---------------|
| Time window | Last 2 hours | Change "last 2 hours" — shorter for faster detection |
| Regression threshold | 50% worsening | Change "worsened by more than 50%" |
| Notification | Teams + email immediately | Remove either action if not needed |
| Email tag | "deployment-regression" in subject | Change the tag name |
| Auto-pause period | 24 hours of stable operation | Change the duration |

## How to Use

### Step 1: Before Deployment
Run the agent a few times to establish a baseline:
```bash
bctb-mcp agent run post-deployment-check --once
# Wait an hour
bctb-mcp agent run post-deployment-check --once
```

### Step 2: Deploy Your Extension

### Step 3: Start Frequent Monitoring
Option A — run in pipeline with 15-minute schedule:
```yaml
schedules:
  - cron: '*/15 * * * *'
```

Option B — run continuously:
```bash
bctb-mcp agent run post-deployment-check --interval 15m
```

### Step 4: After 24 Hours of Stability
```bash
bctb-mcp agent pause post-deployment-check
```

## Expected Behavior

### Pre-Deployment Runs (Baseline)
```
Agent queries error rates and performance metrics.
Builds baseline in state.json summary.
No actions taken (nothing to compare against yet).
```

### Post-Deployment Runs
```
Agent compares current metrics against baseline from pre-deployment runs.
If any metric worsened by >50%: immediate Teams + email alert.
The "deployment-regression" tag in the email subject makes it easy to triage.
```

### Stable (No Regression)
```
Agent finds metrics within 50% of baseline.
Logs "no regression detected" in findings.
After 24 hours of consistent stability, user pauses the agent.
```

## Example state.json (Regression Detected)

```json
{
  "agentName": "post-deployment-check",
  "runCount": 5,
  "summary": "Baseline (runs 1-3): error rate 2.1%, page load p95 2.3s. Post-deployment (runs 4-5): error rate 5.8% (+176%), page load p95 2.5s (+8%). Error rate regression detected and escalated on run 4.",
  "activeIssues": [
    {
      "id": "issue-001",
      "fingerprint": "deploy-regression:error-rate",
      "title": "Post-deployment error rate regression (2.1% → 5.8%)",
      "consecutiveDetections": 2,
      "trend": "stable",
      "counts": [5.8, 5.7],
      "actionsTaken": [
        { "run": 4, "type": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T14:15:20Z" },
        { "run": 4, "type": "email-smtp", "status": "sent", "timestamp": "2026-02-24T14:15:22Z" }
      ]
    }
  ]
}
```

## Verifying It Works

1. Run twice to build baseline: `bctb-mcp agent run post-deployment-check --once` (x2)
2. Check `state.json` — summary should contain baseline metrics
3. If testing without a real deployment: temporarily lower the regression threshold
   to 10% in `instruction.md` to trigger detection on normal variance
