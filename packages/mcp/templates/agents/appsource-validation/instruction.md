Monitor AppSource validation telemetry for my extensions.

Check for validation failures (RT0005 events with error status),
categorize by extension name and failure type.

If failures persist across 3 consecutive checks, post to the Teams channel.
If failures persist across 6 consecutive checks, send an email to the dev lead.

Focus on the last 2 hours of data each run.
Ignore test tenants (any tenant with "test" or "sandbox" in the company name).
