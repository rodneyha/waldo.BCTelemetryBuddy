Post-deployment monitoring mode.

Compare error rates and performance in the last 2 hours against
the baseline from your previous runs (before deployment).

Flag any metric that has worsened by more than 50% compared to pre-deployment baseline.

If any regression is detected:
- Immediately post to Teams with specific metrics and comparison
- Send an email to the dev lead with "deployment-regression" in the subject

This agent should be started manually after a deployment and paused after 24 hours
of stable operation.
