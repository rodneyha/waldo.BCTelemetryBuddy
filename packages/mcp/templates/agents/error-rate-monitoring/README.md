# Agent: Error Rate Monitor

## Purpose
Monitors overall error rates across all Business Central telemetry events.
Detects spikes (absolute count thresholds) and trend-based anomalies
(relative increase compared to historical baseline).

Designed as a "catch-all" monitor — it watches everything with error status,
unlike the AppSource or Performance agents which focus on specific concerns.

## BC Telemetry Events Used

| Event ID | Name | Why This Agent Uses It |
|----------|------|----------------------|
| (all) | All events with error status | Agent uses `get_event_catalog(status: 'error')` to discover all error events dynamically |

> **Key design:** This agent doesn't hardcode event IDs. It discovers error events at runtime
> using the event catalog. This means it automatically picks up new error types.

## Customization Points

| What | Default in Template | How to Change |
|------|-------------------|---------------|
| Absolute count threshold | 100 errors/hour | Change "exceeds 100" |
| Relative increase threshold | 200% increase | Change "increased by more than 200%" |
| First detection | Log only (no action) | Change "Log the finding" if you want immediate action |
| Second detection | Teams notification | Change to preferred action |
| Third detection | Email to dev lead | Change to preferred action |

## Expected Behavior

### First Run
```
Agent calls get_event_catalog(status: 'error') to discover all error events.
Queries error counts per event ID for the last hour.
Establishes baseline error rates per event type.
State: Baseline recorded, no actions.
```

### Subsequent Runs
```
Agent compares current error rates against:
  1. Absolute threshold (100/hour)
  2. Relative threshold (200% increase vs typical rate from previous runs)
Flags events exceeding either threshold.
```

### Health Summary
Each run produces an overall health metric: percentage of events with error status
vs success status. This appears in the run's findings even when no issues are flagged.

## Example state.json After 3 Runs

```json
{
  "agentName": "error-rate-monitoring",
  "runCount": 3,
  "summary": "Overall health: 97.2% success, 2.8% error (stable). RT0005 errors elevated since run 2 (45→127, >200% increase). Web service errors (RT0012) at 23/hour, within normal range. All other error types below thresholds.",
  "activeIssues": [
    {
      "id": "issue-001",
      "fingerprint": "error-rate:RT0005:spike",
      "title": "RT0005 error rate spike (45→127, 282% increase)",
      "consecutiveDetections": 2,
      "trend": "increasing",
      "counts": [45, 127],
      "actionsTaken": [
        { "run": 3, "type": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:20Z" }
      ]
    }
  ]
}
```

## Verifying It Works

1. Run: `bctb-mcp agent run error-rate-monitoring --once`
2. Check `state.json` — should have `summary` with health percentage
3. If no errors found: your environment is healthy (that's good!)
4. To test escalation: lower the threshold in `instruction.md` temporarily
