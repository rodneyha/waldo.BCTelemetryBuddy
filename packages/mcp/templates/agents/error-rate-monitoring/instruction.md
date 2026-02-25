Monitor overall error rates across Business Central environments.

Check all events with error status. Group by event ID and tenant.

Flag any event type where:
- Error count in the last hour exceeds 100, OR
- Error rate increased by more than 200% compared to the typical rate you've seen in previous runs

For flagged issues:
- First detection: Log the finding (no action)
- Second consecutive detection: Post to Teams with affected tenants and error details
- Third consecutive detection: Send an email to the dev lead

Summarize overall health: percentage of events in error vs success state.
