Monitor Business Central performance across all tenants.

Track these metrics:
- Page load times (RT0006 events) — alert if p95 exceeds 5 seconds
- Report execution times (RT0006, RT0007) — alert if p95 exceeds 30 seconds
- AL method execution times — alert if any single method consistently exceeds 10 seconds

Compare current hour against previous runs to detect degradation.
If performance degrades for 2+ consecutive checks, post to Teams.
If degradation persists for 5+ checks, send an email to the dev lead.

Group findings by tenant and identify which tenants are most affected.
