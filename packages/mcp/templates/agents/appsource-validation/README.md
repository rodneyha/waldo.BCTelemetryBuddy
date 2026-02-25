# Agent: AppSource Validation Monitor

## Purpose
Monitors AppSource extension validation failures in your Business Central environments.
Tracks recurring validation errors by extension name, escalates persistent issues
to Teams and email.

Designed for BC ISVs who publish extensions via AppSource and need early warning
when validation starts failing across customer environments.

## BC Telemetry Events Used

| Event ID | Name | Why This Agent Uses It |
|----------|------|----------------------|
| RT0005 | Web service request (error) | Catches API/validation failures related to extension operations |
| LC0010 | Extension install failed | Detects extension installation validation failures |
| LC0011 | Extension install succeeded | Used for baseline comparison (success rate) |
| LC0020 | Extension update failed | Catches upgrade validation failures |

> **Note:** Not all environments emit all events. Run `bctb-mcp` with `get_event_catalog`
> to verify which events are present in your Application Insights resource.

## Customization Points

| What | Default in Template | How to Change |
|------|-------------------|---------------|
| Time window | Last 2 hours per run | Change "last 2 hours of data" to your preferred window |
| Teams escalation threshold | 3 consecutive checks | Change "persist across 3 consecutive checks" |
| Email escalation threshold | 6 consecutive checks | Change "persist across 6 consecutive checks" |
| Ignored tenants | "test" or "sandbox" in company name | Adjust the ignore pattern or remove the line entirely |
| Focus areas | RT0005 error events | Add or change event IDs to match your scenario |

## Expected Behavior

### First Run
```
Agent discovers available events via get_event_catalog.
Samples RT0005 fields via get_event_field_samples.
Queries last 2 hours for validation failures.
State: No previous context — establishes baseline.
Result: Findings logged, no actions taken.
```

### Run 2 (issue detected)
```
Agent reads previous state (has baseline from run 1).
Re-queries telemetry. Finds same error pattern.
State: consecutiveDetections = 2 (below Teams threshold of 3).
Result: Issue tracked, no action yet.
```

### Run 3 (escalation)
```
Agent sees this is the 3rd consecutive detection.
Instruction says "3 consecutive → Teams". Triggers notification.
State: actionsTaken records the Teams notification.
Result: Teams message sent.
```

## Example state.json After 3 Runs

```json
{
  "agentName": "appsource-validation",
  "created": "2026-02-24T10:00:00Z",
  "lastRun": "2026-02-24T12:00:00Z",
  "runCount": 3,
  "status": "active",
  "summary": "Monitoring since Feb 24 10:00Z. Sales Turbo v2.1 has persistent schema validation errors (47→52→61 over 3 runs). Escalated to Teams on run 3. Warehouse Helper v1.0 had 12 permission warnings in run 1, self-resolved by run 2.",
  "activeIssues": [
    {
      "id": "issue-001",
      "fingerprint": "RT0005:schema-validation:sales-turbo-v2.1",
      "title": "Sales Turbo v2.1 — Schema validation failures",
      "firstSeen": "2026-02-24T10:00:00Z",
      "lastSeen": "2026-02-24T12:00:00Z",
      "consecutiveDetections": 3,
      "trend": "increasing",
      "counts": [47, 52, 61],
      "actionsTaken": [
        { "run": 3, "type": "teams-webhook", "timestamp": "2026-02-24T12:00:30Z", "status": "sent" }
      ]
    }
  ],
  "resolvedIssues": [
    {
      "id": "issue-002",
      "fingerprint": "RT0005:permset:warehouse-helper-v1.0",
      "title": "Warehouse Helper v1.0 — Permission set warnings",
      "firstSeen": "2026-02-24T10:00:00Z",
      "resolvedAt": "2026-02-24T11:00:00Z",
      "consecutiveDetections": 1
    }
  ],
  "recentRuns": [
    {
      "runId": 3,
      "timestamp": "2026-02-24T12:00:00Z",
      "durationMs": 45000,
      "toolCalls": ["get_event_catalog", "query_telemetry", "get_tenant_mapping"],
      "findings": "Sales Turbo errors persisting (61, up from 52). Third consecutive detection — triggered Teams notification.",
      "actions": [{ "run": 3, "type": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:30Z" }]
    }
  ]
}
```

## Verifying It Works

1. Run: `bctb-mcp agent run appsource-validation --once`
2. Check console output for tool calls (should see get_event_catalog, query_telemetry)
3. Open `agents/appsource-validation/state.json` — should have findings
4. Open `agents/appsource-validation/runs/` — should have one run log file
5. If no findings after first run, verify:
   - Your App Insights resource has RT0005 or LC* events
   - Run `bctb-mcp` tool `get_event_catalog --status error` to check
