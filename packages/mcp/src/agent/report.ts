/**
 * Markdown report generator for agent run logs.
 *
 * Converts an AgentRunLog into a human-readable `.md` file
 * that is stored alongside the `.json` audit trail in
 * `agents/<name>/runs/<timestamp>-run<NNNN>.md`.
 */

import { AgentRunLog, AgentAction } from './types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a Markdown string from a completed agent run log.
 *
 * @param runLog  - The run log produced by the runtime.
 * @returns       - Complete Markdown document as a string.
 */
export function generateRunReport(runLog: AgentRunLog): string {
    const lines: string[] = [];

    appendHeader(lines, runLog);
    appendSummaryTable(lines, runLog);
    appendInstruction(lines, runLog);
    appendStateAtStart(lines, runLog);
    appendToolCalls(lines, runLog);
    appendFindings(lines, runLog);
    appendAssessment(lines, runLog);
    appendActions(lines, runLog);
    appendStateChanges(lines, runLog);

    return lines.join('\n') + '\n';
}

// ─── Section Builders ─────────────────────────────────────────────────────────

function appendHeader(lines: string[], runLog: AgentRunLog): void {
    const runIdStr = String(runLog.runId).padStart(4, '0');
    const date = new Date(runLog.timestamp);
    const dateStr = date.toUTCString();

    lines.push(`# Agent Run Report: ${runLog.agentName} — Run #${runIdStr}`);
    lines.push('');
    lines.push(`> Generated: ${dateStr}`);
    lines.push('');
}

function appendSummaryTable(lines: string[], runLog: AgentRunLog): void {
    const durationSec = (runLog.durationMs / 1000).toFixed(1);

    lines.push('## Summary');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| **Run ID** | ${runLog.runId} |`);
    lines.push(`| **Agent** | ${runLog.agentName} |`);
    lines.push(`| **Timestamp** | ${runLog.timestamp} |`);
    lines.push(`| **Duration** | ${durationSec}s |`);
    lines.push(`| **Model** | ${runLog.llm.model} |`);
    lines.push(`| **Total Tokens** | ${runLog.llm.totalTokens} (prompt: ${runLog.llm.promptTokens}, completion: ${runLog.llm.completionTokens}) |`);
    lines.push(`| **Tool Calls** | ${runLog.llm.toolCallCount} |`);
    lines.push('');
}

function appendInstruction(lines: string[], runLog: AgentRunLog): void {
    lines.push('## Instruction');
    lines.push('');
    lines.push('```');
    lines.push(runLog.instruction.trim());
    lines.push('```');
    lines.push('');
}

function appendStateAtStart(lines: string[], runLog: AgentRunLog): void {
    const s = runLog.stateAtStart;

    lines.push('## State at Start');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| **Run Count** | ${s.runCount} |`);
    lines.push(`| **Active Issues** | ${s.activeIssueCount} |`);
    lines.push(`| **Prior Summary** | ${s.summary ? truncate(s.summary, 200) : '_none_'} |`);
    lines.push('');
}

function appendToolCalls(lines: string[], runLog: AgentRunLog): void {
    lines.push('## Tool Calls');
    lines.push('');

    if (runLog.toolCalls.length === 0) {
        lines.push('_No tool calls made._');
        lines.push('');
        return;
    }

    lines.push('| # | Tool | Duration | Result |');
    lines.push('|---|---|---|---|');

    for (const tc of runLog.toolCalls) {
        const durationMs = tc.durationMs < 1000
            ? `${tc.durationMs}ms`
            : `${(tc.durationMs / 1000).toFixed(1)}s`;
        const result = truncate(tc.resultSummary, 120).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        lines.push(`| ${tc.sequence} | \`${tc.tool}\` | ${durationMs} | ${result} |`);
    }

    lines.push('');
}

function appendFindings(lines: string[], runLog: AgentRunLog): void {
    lines.push('## Findings');
    lines.push('');
    lines.push(runLog.findings || '_No findings recorded._');
    lines.push('');
}

function appendAssessment(lines: string[], runLog: AgentRunLog): void {
    lines.push('## Assessment');
    lines.push('');
    lines.push(runLog.assessment || '_No assessment recorded._');
    lines.push('');
}

function appendActions(lines: string[], runLog: AgentRunLog): void {
    lines.push('## Actions Taken');
    lines.push('');

    if (runLog.actions.length === 0) {
        lines.push('_No actions taken._');
        lines.push('');
        return;
    }

    for (const action of runLog.actions) {
        lines.push(`- **${action.type}** (${statusBadge(action)}) — ${formatActionDetails(action)}`);
    }

    lines.push('');
}

function appendStateChanges(lines: string[], runLog: AgentRunLog): void {
    const sc = runLog.stateChanges;
    const hasChanges =
        sc.issuesCreated.length > 0 ||
        sc.issuesUpdated.length > 0 ||
        sc.issuesResolved.length > 0 ||
        sc.summaryUpdated;

    lines.push('## State Changes');
    lines.push('');

    if (!hasChanges) {
        lines.push('_No state changes._');
        lines.push('');
        return;
    }

    if (sc.summaryUpdated) {
        lines.push('- Summary updated');
    }
    for (const id of sc.issuesCreated) {
        lines.push(`- Issue **created**: \`${id}\``);
    }
    for (const id of sc.issuesUpdated) {
        lines.push(`- Issue **updated**: \`${id}\``);
    }
    for (const id of sc.issuesResolved) {
        lines.push(`- Issue **resolved**: \`${id}\``);
    }

    lines.push('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
}

function statusBadge(action: AgentAction): string {
    return action.status === 'sent' ? '✅ sent' : '❌ failed';
}

function formatActionDetails(action: AgentAction): string {
    if (!action.details) return action.type;
    const d = action.details;
    const parts: string[] = [];
    if (d['title']) parts.push(String(d['title']));
    if (d['channel']) parts.push(`channel: ${d['channel']}`);
    if (d['recipient']) parts.push(`to: ${d['recipient']}`);
    return parts.length > 0 ? parts.join(', ') : action.type;
}
