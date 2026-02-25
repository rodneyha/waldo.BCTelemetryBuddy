# Agent: Performance Monitor

## Purpose
Tracks Business Central page load times, report execution times, and AL method
execution across all tenants. Detects performance degradation trends across
consecutive runs and escalates when thresholds are exceeded.

Designed for BC partners managing multiple customer environments who need
proactive performance alerting before users complain.

## BC Telemetry Events Used

| Event ID | Name | Why This Agent Uses It |
|----------|------|----------------------|
| RT0006 | Web request completed (server) | Page load and server-side execution times |
| RT0007 | Web request completed (client) | Client-side rendering times |
| RT0018 | Report generated | Report execution times and row counts |
| AL0000D3 | AL method timing | Individual AL method execution durations |

> **Note:** Duration fields in BC telemetry are typically timespans (`hh:mm:ss.fffffff`),
> not milliseconds. The agent will use `get_event_field_samples` to verify format.

## Customization Points

| What | Default in Template | How to Change |
|------|-------------------|---------------|
| Page load p95 threshold | 5 seconds | Change "p95 exceeds 5 seconds" |
| Report execution p95 threshold | 30 seconds | Change "p95 exceeds 30 seconds" |
| AL method threshold | 10 seconds consistently | Change "consistently exceeds 10 seconds" |
| Teams escalation | 2 consecutive checks | Change the number |
| Email escalation | 5 consecutive checks | Change the number |

## Expected Behavior

### First Run
```
Agent calls get_event_catalog to discover performance-related events.
Calls get_event_field_samples for RT0006, RT0007, RT0018 to understand duration fields.
Queries telemetry to establish baseline p95 values.
State: Baseline recorded, no actions.
```

### Subsequent Runs
```
Agent compares current p95 values against baseline from previous runs.
Detects degradation by comparing against its own accumulated context.
Tracks trends (improving/stable/degrading) per metric.
```

### Escalation
```
If any metric degrades for 2+ runs → Teams notification with:
  - Which metric degraded
  - Current value vs baseline
  - Most affected tenants
If degradation persists 5+ runs → email to dev lead
```

## Example state.json After 3 Runs (Degradation Detected)

```json
{
  "agentName": "performance",
  "runCount": 3,
  "summary": "Monitoring since Feb 24. Page load p95 baseline: 2.1s. Current: 4.8s (run 3, up from 3.5s in run 2). Degradation started run 2. Reports and AL methods within normal range.",
  "activeIssues": [
    {
      "id": "issue-001",
      "fingerprint": "perf:page-load-p95:degraded",
      "title": "Page load p95 degradation (2.1s → 4.8s)",
      "consecutiveDetections": 2,
      "trend": "increasing",
      "counts": [3500, 4800],
      "actionsTaken": [
        { "run": 3, "type": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:25Z" }
      ]
    }
  ]
}
```

## Verifying It Works

1. Run: `bctb-mcp agent run performance --once`
2. First run should discover events and establish baselines
3. Run again: `bctb-mcp agent run performance --once`
4. Second run should compare against baseline
5. Check `state.json` for `summary` containing baseline metrics
