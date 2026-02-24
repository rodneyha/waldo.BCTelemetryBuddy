# Agentic Autonomous Telemetry Monitoring — Technical Design

> **GitHub Issue**: [#98 — Feature: Agentic Autonomous Telemetry Monitoring](https://github.com/waldo1001/waldo.BCTelemetryBuddy/issues/98)
>
> **Status**: Design  
> **Created**: 2026-02-24  

---

## 1. Problem Statement

BCTelemetryBuddy has a complete set of MCP tools for querying Business Central telemetry (KQL execution, event discovery, tenant mapping, query management). These tools work when a human or an LLM asks them to — but there is no autonomous, scheduled monitoring capability.

Users need:
- **Autonomous agents** that run on a schedule and follow up on issues without human intervention.
- **Prompt-defined behavior** — each agent's purpose is described in natural language, not JSON rules.
- **Accumulated context** — agents remember what they found previously and build on it.
- **Pipeline integration** — agents run inside GitHub Actions or Azure DevOps Pipelines.
- **Closed-loop issue lifecycle** — detection → investigation → escalation → resolution.

---

## 2. Architecture Overview

### 2.1 Core Principle

```
An agent = instruction (prompt) + accumulated context + existing MCP tools + LLM reasoning
```

The agent runtime is a **ReAct loop** that:
1. Reads the agent's instruction and previous state
2. Sends both to Azure OpenAI along with available tool definitions
3. The LLM reasons about what to do, calls tools, observes results, repeats
4. Produces findings, assessment, and actions
5. Writes updated state to disk
6. The CI/CD pipeline commits the state back to Git

### 2.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCHEDULER (pick one)                                               │
│  ┌────────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────────┐   │
│  │ GitHub      │ │ Azure     │ │ Azure        │ │ Container     │   │
│  │ Actions     │ │ DevOps    │ │ Functions    │ │ App           │   │
│  │ (cron)      │ │ Pipeline  │ │ (timer)      │ │ (loop)        │   │
│  └──────┬──────┘ └─────┬─────┘ └──────┬───────┘ └──────┬────────┘  │
│         └───────────────┴──────────────┴────────────────┘           │
│                              │                                      │
│                    bctb-mcp agent run <name> --once                  │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│  NEW CODE (~500 LOC total)   │                                      │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │  Agent Runtime (src/agent/runtime.ts)                          │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │ while (true) {                                           │  │  │
│  │  │   response = await azureOpenAI.chat(messages, { tools }) │  │  │
│  │  │   if (response.toolCalls)                                │  │  │
│  │  │     for (call of toolCalls)                              │  │  │
│  │  │       result = toolHandlers.executeToolCall(call)         │  │  │
│  │  │       messages.push({ role: 'tool', content: result })   │  │  │
│  │  │   else                                                   │  │  │
│  │  │     break  // LLM is done reasoning                      │  │  │
│  │  │ }                                                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│  ┌──────────────┐  ┌────────▼────────┐  ┌────────────────────────┐ │
│  │ Context Mgr   │  │ Action Dispatch │  │ CLI Commands           │ │
│  │ (context.ts)  │  │ (actions.ts)    │  │ (cli additions)        │ │
│  │ ~150 LOC      │  │ ~100 LOC        │  │ ~100 LOC               │ │
│  └──────────────┘  └─────────────────┘  └────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  EXISTING CODE (zero changes needed)                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ToolHandlers.executeToolCall()                                │  │
│  │  ├── query_telemetry         → KustoService                    │  │
│  │  ├── get_event_catalog       → KustoService                    │  │
│  │  ├── get_event_field_samples → KustoService                    │  │
│  │  ├── get_event_schema        → KustoService                    │  │
│  │  ├── get_tenant_mapping      → KustoService                    │  │
│  │  ├── save_query              → QueriesService                  │  │
│  │  ├── search_queries          → QueriesService                  │  │
│  │  ├── get_saved_queries       → QueriesService                  │  │
│  │  ├── get_categories          → QueriesService                  │  │
│  │  ├── get_recommendations     → (inline logic)                  │  │
│  │  ├── get_external_queries    → ReferencesService               │  │
│  │  ├── list_profiles           → Config                          │  │
│  │  └── switch_profile          → Config                          │  │
│  │                                                                │  │
│  │  AuthService · CacheService · Config · Profiles                │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Workspace Layout

All agent state lives in the workspace directory (the same Git repo that holds queries and config).

```
workspace/
├── .bctb-config.json              ← existing: connection profiles + NEW agents section
├── queries/                       ← existing: saved KQL queries
│   └── Monitoring/                ← convention: detection queries saved here by agents
├── agents/                        ← NEW: all agent definitions and state
│   ├── appsource-validation/
│   │   ├── instruction.md         ← the prompt that defines this agent
│   │   ├── state.json             ← current state + rolling context
│   │   └── runs/                  ← individual run outputs (audit trail)
│   │       ├── 2026-02-24T10-00Z.json
│   │       ├── 2026-02-24T11-00Z.json
│   │       └── 2026-02-24T12-00Z.json
│   └── performance/
│       ├── instruction.md
│       ├── state.json
│       └── runs/
└── .bctb/
    └── cache/                     ← existing: query result cache (NOT committed)
```

---

## 4. File Specifications

### 4.1 `instruction.md` — Agent Definition

Plain markdown file. The user writes this. It is the **only input** required to create an agent.

```markdown
Monitor AppSource validation telemetry for my extensions.

Check for validation failures (RT0005 events with error status),
categorize by extension name and failure type.

If failures persist across 3 consecutive checks, post to the Teams channel.
If failures persist across 6 consecutive checks, create an Azure DevOps work item.

Focus on the last 2 hours of data each run.
Ignore test tenants (any tenant with "test" or "sandbox" in the company name).
```

**Design rules:**
- No required structure or schema — free-form natural language.
- The LLM receives this verbatim as its instruction.
- Changing behavior = editing this file. No code changes, no config changes.
- The file is version-controlled — instruction history is Git history.

### 4.2 `state.json` — Agent Memory

Read at the start of each run, written at the end. This is how the agent "remembers" across runs.

```typescript
interface AgentState {
    // Metadata
    agentName: string;
    created: string;               // ISO 8601
    lastRun: string;               // ISO 8601
    runCount: number;
    status: 'active' | 'paused';

    // Rolling memory (written by LLM)
    summary: string;               // LLM-written digest of all previous runs

    // Structured issue tracking
    activeIssues: AgentIssue[];
    resolvedIssues: AgentIssue[];  // pruned after 30 days

    // Recent run detail (sliding window of last N runs)
    recentRuns: AgentRunSummary[];
}

interface AgentIssue {
    id: string;                    // e.g., "issue-001"
    fingerprint: string;           // deterministic dedup key
    title: string;
    firstSeen: string;             // ISO 8601
    lastSeen: string;              // ISO 8601
    consecutiveDetections: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    counts: number[];              // count per run (last N)
    actionsTaken: AgentAction[];
}

interface AgentRunSummary {
    runId: number;
    timestamp: string;             // ISO 8601
    durationMs: number;
    toolCalls: string[];           // tool names called
    findings: string;              // LLM-written summary of this run
    actions: AgentAction[];
}

type ActionType = 'teams-webhook' | 'devops-workitem' | 'pipeline-trigger';

interface AgentAction {
    run: number;
    type: ActionType;              // unified field name (matches RequestedAction.type)
    timestamp: string;
    status: 'sent' | 'failed';
    details?: Record<string, any>;
}

// What the LLM outputs in its JSON response (see Output Format in prompts)
interface RequestedAction {
    type: ActionType;
    title: string;
    message: string;
    severity: 'high' | 'medium' | 'low';
    investigationId?: string;      // optional, for pipeline triggers
}

// The runtime converts RequestedAction → AgentAction by adding run, timestamp, status.
// The `run` field is set by updateState(), NOT by ActionDispatcher.
```

**Bounded memory strategy:**
- `recentRuns` is a sliding window (configurable, default: 5).
- When a run falls off the window, the LLM is asked to update `summary` to incorporate it.
- `resolvedIssues` are pruned after 30 days.
- This keeps `state.json` bounded regardless of how many runs have occurred.

### 4.3 `runs/<timestamp>.json` — Audit Trail

One file per run, **append-only, never modified**. Full detail for debugging and auditing.

**Cleanup policy:** No automatic cleanup. Run files accumulate in Git. Git’s built-in compression (packfiles) handles this efficiently. Users can prune old run files manually or via a cron job if needed, but this is not a priority for the runtime.

```typescript
interface AgentRunLog {
    // Identity
    runId: number;
    agentName: string;
    timestamp: string;
    durationMs: number;

    // Input
    instruction: string;           // snapshot of instruction.md at run time
    stateAtStart: {
        summary: string;
        activeIssueCount: number;
        runCount: number;
    };

    // LLM interaction
    llm: {
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        toolCallCount: number;
    };

    // Tool calls (detailed)
    toolCalls: {
        sequence: number;
        tool: string;
        args: Record<string, any>;
        resultSummary: string;     // truncated for readability
        durationMs: number;
    }[];

    // Output
    assessment: string;            // LLM's assessment of the situation
    findings: string;              // what was found this run
    actions: AgentAction[];        // actions taken

    // State changes
    stateChanges: {
        issuesCreated: string[];   // issue IDs
        issuesUpdated: string[];
        issuesResolved: string[];
        summaryUpdated: boolean;
    };
}
```

**Run file naming convention:** `YYYY-MM-DDTHH-MMZ.json` (UTC, hyphens instead of colons for filesystem compatibility).

---

## 5. Agent Runtime — Detailed Design

### 5.1 Module: `src/agent/runtime.ts`

The core ReAct loop. This is the central piece of new code.

```typescript
// Pseudocode — actual implementation will follow this structure

import { ToolHandlers } from '../tools/toolHandlers.js';
import { TOOL_DEFINITIONS } from '../tools/toolDefinitions.js';
import { AgentContextManager } from './context.js';
import { ActionDispatcher } from './actions.js';
import { buildAgentPrompt, AGENT_SYSTEM_PROMPT, parseAgentOutput } from './prompts.js';

// LLM Provider Interface — decouples runtime from any specific LLM SDK.
// Azure OpenAI is the default (and only v1) implementation.
// Future: OpenAI, Anthropic, Ollama — just implement this interface.
interface LLMProvider {
    chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
}

interface AgentRuntimeConfig {
    // LLM — provider abstraction, NOT hardcoded Azure strings
    llmProvider: LLMProvider;        // injected by CLI command from config + env vars

    // Limits
    maxToolCalls: number;            // default: 20 — safety limit
    maxTokens: number;               // default: 4096 — response limit
    contextWindowRuns: number;       // default: 5 — sliding window size

    // Tool scope — controls which MCP tools the agent can use
    // 'read-only': excludes save_query, switch_profile (default)
    // 'full': all 13 tools (opt-in per agent)
    toolScope: 'read-only' | 'full';
}

export class AgentRuntime {
    private toolHandlers: ToolHandlers;
    private contextManager: AgentContextManager;
    private actionDispatcher: ActionDispatcher;
    private config: AgentRuntimeConfig;

    constructor(
        toolHandlers: ToolHandlers,
        contextManager: AgentContextManager,
        actionDispatcher: ActionDispatcher,
        config: AgentRuntimeConfig
    ) { ... }

    /**
     * Execute a single monitoring pass for the named agent.
     * Returns the run log.
     */
    async run(agentName: string): Promise<AgentRunLog> {
        const startTime = Date.now();

        // 1. Load instruction and state
        const instruction = this.contextManager.loadInstruction(agentName);
        const state = this.contextManager.loadState(agentName);

        // 2. Build initial messages
        // Filter tools by scope (read-only excludes save_query, switch_profile)
        const filteredTools = filterToolsByScope(TOOL_DEFINITIONS, this.config.toolScope);
        const tools = toolDefinitionsToOpenAI(filteredTools);
        const messages = [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user', content: buildAgentPrompt(instruction, state) }
        ];

        // 3. ReAct loop
        const toolCallLog: ToolCallEntry[] = [];
        let totalToolCalls = 0;
        let llmStats = { promptTokens: 0, completionTokens: 0 };

        while (totalToolCalls < this.config.maxToolCalls) {
            const response = await this.config.llmProvider.chat(messages, { tools, maxTokens: this.config.maxTokens });
            llmStats.promptTokens += response.usage.promptTokens;
            llmStats.completionTokens += response.usage.completionTokens;

            if (response.toolCalls && response.toolCalls.length > 0) {
                // LLM wants to call tools
                messages.push(response.assistantMessage);

                for (const call of response.toolCalls) {
                    totalToolCalls++;
                    const callStart = Date.now();

                    const result = await this.toolHandlers.executeToolCall(
                        call.function.name,
                        JSON.parse(call.function.arguments)
                    );

                    const resultStr = typeof result === 'string'
                        ? result
                        : JSON.stringify(result, null, 2);

                    messages.push({
                        role: 'tool',
                        content: resultStr,
                        tool_call_id: call.id
                    });

                    toolCallLog.push({
                        sequence: totalToolCalls,
                        tool: call.function.name,
                        args: JSON.parse(call.function.arguments),
                        resultSummary: resultStr.substring(0, 500),
                        durationMs: Date.now() - callStart
                    });
                }
            } else {
                // LLM is done reasoning — parse final output
                const output = parseAgentOutput(response.content);

                // 4. Execute actions (Phase 1: log-only stub; Phase 2: real HTTP calls)
                const executedActions = await this.actionDispatcher.dispatch(
                    output.actions
                );

                // 5. Update state (pass run metadata for AgentRunSummary construction)
                const updatedState = this.contextManager.updateState(
                    agentName,
                    state,
                    output,
                    executedActions,
                    Date.now() - startTime,                    // runDurationMs
                    toolCallLog.map(tc => tc.tool)             // toolCallNames
                );

                // 6. Save run log
                const runLog: AgentRunLog = {
                    runId: state.runCount + 1,
                    agentName,
                    timestamp: new Date().toISOString(),
                    durationMs: Date.now() - startTime,
                    instruction,
                    stateAtStart: {
                        summary: state.summary,
                        activeIssueCount: state.activeIssues.length,
                        runCount: state.runCount
                    },
                    llm: {
                        model: 'llm-provider',             // provider name — no longer hardcoded
                        promptTokens: llmStats.promptTokens,
                        completionTokens: llmStats.completionTokens,
                        totalTokens: llmStats.promptTokens + llmStats.completionTokens,
                        toolCallCount: totalToolCalls
                    },
                    toolCalls: toolCallLog,
                    assessment: output.assessment,
                    findings: output.findings,
                    actions: executedActions,
                    stateChanges: output.stateChanges
                };

                this.contextManager.saveRunLog(agentName, runLog);
                this.contextManager.saveState(agentName, updatedState);

                return runLog;
            }
        }

        // Safety: max tool calls reached
        throw new Error(`Agent ${agentName} exceeded max tool calls (${this.config.maxToolCalls})`);
    }
}

// --- Error handling notes ---
// If the LLM returns content but it's not valid JSON (refusal, hallucination, etc.):
//   parseAgentOutput throws → the run fails → no state is written → run log is NOT saved.
//   The CLI should catch this, log the error, and exit non-zero so the pipeline can retry.
//   Future: add retry logic (up to 2 retries with the same messages + a "please output valid JSON" nudge).
```

### 5.2 Module: `src/agent/context.ts`

Manages reading/writing agent files. Follows the same patterns as existing `QueriesService` and `CacheService`.

```typescript
export class AgentContextManager {
    private workspacePath: string;
    private agentsDir: string;
    private contextWindowSize: number;

    constructor(workspacePath: string, contextWindowSize: number = 5) {
        this.workspacePath = workspacePath;
        this.agentsDir = path.join(workspacePath, 'agents');
        this.contextWindowSize = contextWindowSize;
    }

    // --- Read operations ---

    loadInstruction(agentName: string): string {
        const filePath = path.join(this.agentsDir, agentName, 'instruction.md');
        return fs.readFileSync(filePath, 'utf-8');
    }

    loadState(agentName: string): AgentState {
        const filePath = path.join(this.agentsDir, agentName, 'state.json');
        if (!fs.existsSync(filePath)) {
            return this.createInitialState(agentName);
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    listAgents(): AgentInfo[] {
        // Scan agents/ directory for subdirectories with instruction.md
    }

    getRunHistory(agentName: string, limit?: number): AgentRunLog[] {
        // Read runs/ directory, parse JSON files, return sorted by timestamp
    }

    // --- Write operations ---

    createAgent(agentName: string, instruction: string): void {
        const agentDir = path.join(this.agentsDir, agentName);
        fs.mkdirSync(agentDir, { recursive: true });
        fs.mkdirSync(path.join(agentDir, 'runs'), { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'instruction.md'), instruction, 'utf-8');
        fs.writeFileSync(
            path.join(agentDir, 'state.json'),
            JSON.stringify(this.createInitialState(agentName), null, 2),
            'utf-8'
        );
    }

    saveState(agentName: string, state: AgentState): void {
        const filePath = path.join(this.agentsDir, agentName, 'state.json');
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    }

    saveRunLog(agentName: string, runLog: AgentRunLog): void {
        const runsDir = path.join(this.agentsDir, agentName, 'runs');
        fs.mkdirSync(runsDir, { recursive: true });
        const timestamp = runLog.timestamp.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
        const filePath = path.join(runsDir, `${timestamp}.json`);
        fs.writeFileSync(filePath, JSON.stringify(runLog, null, 2), 'utf-8');
    }

    updateState(
        agentName: string,
        previousState: AgentState,
        output: AgentOutput,
        executedActions: AgentAction[],
        runDurationMs: number,
        toolCallNames: string[]
    ): AgentState {
        // 1. Update summary (LLM-written — output.summary replaces previous)
        // 2. Update active/resolved issues based on output
        // 3. Build AgentRunSummary from output + executedActions + runDurationMs + toolCallNames
        // 4. Push new run to recentRuns, trim to window size
        // 5. Increment runCount, update lastRun
        // 6. Set `run` field on executedActions to the new runId
        // 7. Prune resolvedIssues past TTL
        // See Section 7 for compaction logic
    }

    private createInitialState(agentName: string): AgentState {
        return {
            agentName,
            created: new Date().toISOString(),
            lastRun: '',
            runCount: 0,
            status: 'active',
            summary: '',
            activeIssues: [],
            resolvedIssues: [],
            recentRuns: []
        };
    }
}
```

### 5.3 Module: `src/agent/actions.ts`

Executes external actions requested by the agent. Each action type is a simple HTTP call.

```typescript
export interface ActionConfig {
    'teams-webhook'?: { url: string };
    'devops-workitem'?: {
        orgUrl: string;      // e.g., "https://dev.azure.com/contoso"
        project: string;
        pat: string;
        workItemType?: string; // default: "Bug"
    };
    'pipeline-trigger'?: {
        orgUrl: string;
        project: string;
        pipelineId: number;
        pat: string;
    };
}

export class ActionDispatcher {
    private config: ActionConfig;

    constructor(config: ActionConfig) { ... }

    /**
     * Dispatch requested actions.
     * Returns AgentAction[] WITHOUT the `run` field — that's set by updateState().
     * Phase 1: log-only stub (no HTTP calls). Phase 2: real implementations.
     */
    async dispatch(
        requestedActions: RequestedAction[]
    ): Promise<AgentAction[]> {
        const executed: AgentAction[] = [];

        for (const action of requestedActions) {
            try {
                switch (action.type) {
                    case 'teams-webhook':
                        await this.sendTeamsNotification(action);
                        break;
                    case 'devops-workitem':
                        await this.createDevOpsWorkItem(action);
                        break;
                    case 'pipeline-trigger':
                        await this.triggerPipeline(action);
                        break;
                }
                executed.push({ run: 0, type: action.type, status: 'sent', timestamp: new Date().toISOString() });
            } catch (error) {
                executed.push({ run: 0, type: action.type, status: 'failed', timestamp: new Date().toISOString() });
            }
        }

        return executed;
    }

    private async sendTeamsNotification(action: RequestedAction): Promise<void> {
        // POST to Teams Incoming Webhook URL — Adaptive Card format
        const url = this.config['teams-webhook']?.url;
        if (!url) throw new Error('Teams webhook URL not configured');

        const severityColor = action.severity === 'high' ? 'attention'
            : action.severity === 'medium' ? 'warning' : 'good';

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'message',
                attachments: [{
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: {
                        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
                        type: 'AdaptiveCard',
                        version: '1.4',
                        body: [
                            { type: 'TextBlock', text: action.title, weight: 'Bolder', size: 'Medium', color: severityColor },
                            { type: 'TextBlock', text: action.message, wrap: true },
                            { type: 'FactSet', facts: [
                                { title: 'Severity', value: action.severity },
                            ]}
                        ]
                    }
                }]
            })
        });
    }

    private async createDevOpsWorkItem(action: RequestedAction): Promise<void> {
        // POST to Azure DevOps REST API
        // POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/${type}?api-version=7.0
        const config = this.config['devops-workitem'];
        if (!config) throw new Error('DevOps work item config not set');

        const type = config.workItemType || 'Bug';
        const url = `${config.orgUrl}/${config.project}/_apis/wit/workitems/$${type}?api-version=7.0`;

        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json-patch+json',
                'Authorization': `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`
            },
            body: JSON.stringify([
                { op: 'add', path: '/fields/System.Title', value: action.title },
                { op: 'add', path: '/fields/System.Description', value: action.message },
                { op: 'add', path: '/fields/System.Tags', value: `bctb-agent;${agentName}` }
            ])
        });
    }

    private async triggerPipeline(action: RequestedAction): Promise<void> {
        // POST to Azure DevOps Pipeline Run API
        const config = this.config['pipeline-trigger'];
        if (!config) throw new Error('Pipeline trigger config not set');

        const url = `${config.orgUrl}/${config.project}/_apis/pipelines/${config.pipelineId}/runs?api-version=7.0`;

        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`
            },
            body: JSON.stringify({
                resources: { repositories: { self: { refName: 'refs/heads/main' } } },
                templateParameters: {
                    agentName,
                    investigationId: action.investigationId || ''
                }
            })
        });
    }
}
```

### 5.4 Module: `src/agent/prompts.ts`

System prompt and prompt builder for the agent.

```typescript
export const AGENT_SYSTEM_PROMPT = `
You are a telemetry monitoring agent for Microsoft Dynamics 365 Business Central.
You run on a schedule and monitor telemetry data using the tools provided.

## Your Behavior

1. READ your instruction carefully — it defines what you monitor and how you respond.
2. READ your previous state — it tells you what you found before and what issues are active.
3. USE TOOLS to gather current telemetry data:
   - Always start with get_event_catalog if this is your first run or if you need to discover events.
   - Use get_event_field_samples before writing queries for unfamiliar events.
   - Use get_tenant_mapping if your instruction involves specific customers.
   - Use query_telemetry to execute KQL queries.
4. ASSESS findings by comparing with previous state:
   - Is this a new issue or a continuation of an existing one?
   - Is the situation improving, stable, or worsening?
   - Does this require escalation per your instruction?
5. DECIDE on actions based on your instruction:
   - Only take actions explicitly described in your instruction.
   - Track consecutive detections accurately.
6. REPORT your findings, assessment, and actions in the structured output format.

## Output Format

You MUST respond with a JSON object matching this structure:

{
  "summary": "Updated rolling summary incorporating this run's findings",
  "findings": "What you found this run (human-readable)",
  "assessment": "Your interpretation and reasoning",
  "activeIssues": [
    {
      "id": "issue-XXX",
      "fingerprint": "deterministic-key",
      "title": "Short description",
      "consecutiveDetections": 3,
      "trend": "increasing",
      "counts": [47, 52, 61],
      "lastSeen": "2026-02-24T12:00:00Z"
    }
  ],
  "resolvedIssues": ["issue-YYY"],
  "actions": [
    {
      "type": "teams-webhook",
      "title": "Alert title",
      "message": "Alert body",
      "severity": "high"
    }
  ],
  "stateChanges": {
    "issuesCreated": ["issue-XXX"],
    "issuesUpdated": ["issue-ZZZ"],
    "issuesResolved": ["issue-YYY"],
    "summaryUpdated": true
  }
}

## Rules

- Do NOT invent data. Only report what you find in real telemetry.
- Do NOT take actions that are not described in your instruction.
- Do NOT re-alert for issues that have already been escalated (check actionsTaken in state).
- Keep summaries concise — each run's findings should be 1-3 sentences.
- Use deterministic fingerprints so the same issue is tracked consistently across runs.
`;

export function buildAgentPrompt(instruction: string, state: AgentState): string {
    const now = new Date().toISOString();
    const runNumber = state.runCount + 1;

    let prompt = `## Your Instruction\n\n${instruction}\n\n`;
    prompt += `## Current Time\n\n${now} (Run #${runNumber})\n\n`;

    if (state.runCount === 0) {
        prompt += `## Previous State\n\nThis is your FIRST RUN. No previous context.\n\n`;
    } else {
        prompt += `## Previous State\n\n`;
        prompt += `### Summary\n${state.summary}\n\n`;

        if (state.activeIssues.length > 0) {
            prompt += `### Active Issues (${state.activeIssues.length})\n`;
            prompt += '```json\n' + JSON.stringify(state.activeIssues, null, 2) + '\n```\n\n';
        }

        if (state.recentRuns.length > 0) {
            prompt += `### Recent Runs (last ${state.recentRuns.length})\n`;
            for (const run of state.recentRuns) {
                prompt += `- **Run ${run.runId}** (${run.timestamp}): ${run.findings}\n`;
                if (run.actions.length > 0) {
                    prompt += `  Actions: ${run.actions.map(a => a.action).join(', ')}\n`;
                }
            }
            prompt += '\n';
        }
    }

    prompt += `## Task\n\nExecute your instruction now. Use tools to gather data, assess the situation, and take any actions required by your instruction.\n`;

    return prompt;
}

export function parseAgentOutput(content: string): AgentOutput {
    // Extract JSON from LLM response (may be wrapped in markdown code fences)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                      content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
        throw new Error('Agent did not produce valid JSON output');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    return JSON.parse(jsonStr);
}
```

---

## 6. CLI Commands

Add to the existing CLI in `src/cli.ts` (Commander.js).

### 6.1 `agent start`

```bash
bctb-mcp agent start "Monitor AppSource validation..." --name appsource-validation
```

Creates:
- `agents/appsource-validation/instruction.md`
- `agents/appsource-validation/state.json` (empty initial state)
- `agents/appsource-validation/runs/` (empty directory)

### 6.2 `agent run`

```bash
# Single pass (for pipelines) — Phase 1 MVP
bctb-mcp agent run appsource-validation --once

# Run all active agents — Phase 1 MVP
bctb-mcp agent run-all --once

# Continuous (for containers/services) — Phase 3+ (deferred)
# bctb-mcp agent run appsource-validation --interval 60m
# Requires: sleep loop, graceful shutdown (SIGTERM/SIGINT), signal handling.
# Not needed for pipeline-based usage (the scheduler handles repetition).
```

### 6.3 `agent list`

```bash
bctb-mcp agent list
```

Output:
```
Agents:
  appsource-validation   active    3 runs    last: 2026-02-24T12:00Z    1 active issue
  performance            active    7 runs    last: 2026-02-24T12:00Z    0 active issues
  contoso-health         paused    12 runs   last: 2026-02-23T18:00Z    2 active issues
```

### 6.4 `agent history`

```bash
bctb-mcp agent history appsource-validation --limit 5
```

Output:
```
Run History (appsource-validation):
  #3  2026-02-24T12:00Z  45s  3 tools  "Sales Turbo errors persist (61). Sent Teams alert."
  #2  2026-02-24T11:00Z  38s  1 tool   "Sales Turbo up to 52. Warehouse resolved."
  #1  2026-02-24T10:00Z  52s  3 tools  "Initial scan. Found 2 issue patterns."
```

### 6.5 `agent edit` (Phase 3+)

```bash
bctb-mcp agent edit appsource-validation
```

Opens `instruction.md` in `$EDITOR`. Alternatively, users just edit the file directly in VS Code.

> **Deferred to Phase 3+.** No existing CLI commands open editors. For Phase 1-2, users edit instruction.md directly in VS Code or any text editor.

### 6.6 `agent pause` / `agent resume`

```bash
bctb-mcp agent pause appsource-validation
bctb-mcp agent resume appsource-validation
```

Sets `status` field in `state.json`. `run-all` skips paused agents.

---

## 7. Context Compaction

### Problem
If an agent runs hourly for 30 days, that's 720 runs. The `state.json` can't hold all of them.

### Solution: Sliding Window + LLM Summarization

```
recentRuns window = 5 (configurable)

Run 1: recentRuns = [1]
Run 2: recentRuns = [1, 2]
Run 3: recentRuns = [1, 2, 3]
Run 4: recentRuns = [1, 2, 3, 4]
Run 5: recentRuns = [1, 2, 3, 4, 5]
Run 6: recentRuns = [2, 3, 4, 5, 6]  ← run 1 drops off, gets folded into summary
```

When a run drops off the window, the agent's output format includes an updated `summary` field that incorporates the dropped run's information. The LLM naturally does this because it sees the previous summary + the new findings and writes a new summary.

### Resolved Issue Pruning

Issues in `resolvedIssues` are kept for 30 days (so the agent can reference recent resolutions), then pruned by the context manager.

---

## 8. Configuration

### 8.1 Additions to `.bctb-config.json`

```json
{
    "connectionName": "My BC",
    "tenantId": "...",
    "authFlow": "client_credentials",
    "clientId": "...",
    "clientSecret": "...",
    "applicationInsightsAppId": "...",
    "kustoClusterUrl": "...",

    "agents": {
        "llm": {
            "provider": "azure-openai",
            "endpoint": "https://my-instance.openai.azure.com",
            "deployment": "gpt-4o",
            "apiVersion": "2024-10-21"
        },
        "defaults": {
            "maxToolCalls": 20,
            "maxTokens": 4096,
            "contextWindowRuns": 5,
            "resolvedIssueTTLDays": 30,
            "toolScope": "read-only"
        },
        "actions": {
            "teams-webhook": {
                "url": "https://outlook.office.com/webhook/..."
            },
            "devops-workitem": {
                "orgUrl": "https://dev.azure.com/contoso",
                "project": "BC-Ops",
                "workItemType": "Bug"
            },
            "pipeline-trigger": {
                "orgUrl": "https://dev.azure.com/contoso",
                "project": "BC-Ops",
                "pipelineId": 42
            }
        }
    }
}
```

**Secrets handling:**
- `agents.llm.apiKey` → set via `AZURE_OPENAI_KEY` environment variable (not in config file)
- `agents.actions.devops-workitem.pat` → set via `DEVOPS_PAT` environment variable
- Same pattern as existing `clientSecret` handling

### 8.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name (e.g., "gpt-4o") |
| `TEAMS_WEBHOOK_URL` | Teams Incoming Webhook URL |
| `DEVOPS_PAT` | Azure DevOps Personal Access Token |
| `DEVOPS_ORG_URL` | Azure DevOps org URL (override) |

Environment variables override config file values (same pattern as existing config).

### 8.3 Config Loading Strategy for Agent CLI

**Problem:** `loadConfigFromFile()` returns `MCPConfig` which does NOT include the `agents` section. The agent CLI needs both the MCPConfig (for ToolHandlers initialization) and the agents config (LLM settings, action config, defaults).

**Solution:** The agent CLI reads the raw JSON file separately to extract the `agents` section, then uses the existing `loadConfigFromFile()` for MCPConfig. This avoids modifying the core MCPConfig interface.

```typescript
// In CLI agent commands:

// 1. Load MCPConfig via existing function (for ToolHandlers initialization)
const mcpConfig = loadConfigFromFile(options.config, options.profile);

// 2. Load raw JSON to extract agents section (NOT part of MCPConfig)
const rawConfig = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf-8'));
const agentsConfig: AgentConfigSection = rawConfig.agents;
if (!agentsConfig?.llm) {
    throw new Error('No agents.llm section in config. See: bctb-mcp init');
}

// 3. Construct LLM provider from agents config + env vars
const llmProvider = new AzureOpenAIProvider({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || agentsConfig.llm.endpoint,
    apiKey: process.env.AZURE_OPENAI_KEY || '',            // MUST be env var
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || agentsConfig.llm.deployment,
    apiVersion: agentsConfig.llm.apiVersion || '2024-10-21'
});

// 4. Build AgentRuntimeConfig from agents.defaults + overrides
const runtimeConfig: AgentRuntimeConfig = {
    llmProvider,
    maxToolCalls: agentsConfig.defaults?.maxToolCalls ?? 20,
    maxTokens: agentsConfig.defaults?.maxTokens ?? 4096,
    contextWindowRuns: agentsConfig.defaults?.contextWindowRuns ?? 5,
    toolScope: agentsConfig.defaults?.toolScope ?? 'read-only'
};

// 5. Initialize ToolHandlers and services from MCPConfig (existing code, unchanged)
const services = initializeServices(mcpConfig, true);
const toolHandlers = new ToolHandlers(mcpConfig, services, true);

// 6. Create context manager and action dispatcher
const contextManager = new AgentContextManager(mcpConfig.workspacePath, runtimeConfig.contextWindowRuns);
const actionDispatcher = new ActionDispatcher(agentsConfig.actions ?? {});

// 7. Run agent
const runtime = new AgentRuntime(toolHandlers, contextManager, actionDispatcher, runtimeConfig);
await runtime.run(agentName);
```

**Key design points:**
- MCPConfig is NOT modified — no breaking changes to existing config loading.
- The `agents` section is a separate concern, loaded from raw JSON only by agent CLI commands.
- Secrets (API key, PAT) come from environment variables, never from the config file.
- The same `loadConfigFromFile` handles profile resolution, so `--profile` works naturally for the MCPConfig part.

### 8.4 Agent State and Profiles

**Question:** If `--profile` changes the MCPConfig (different App Insights, different tenant), should agent state be separate per profile?

**Answer:** Agent state is per-agent-folder, NOT per-profile. The agent's `instruction.md` defines what it monitors, and the state tracks findings. If you need to monitor different environments separately, create separate agents (e.g., `performance-prod`, `performance-staging`). This is simpler and more explicit than implicit profile-scoped state.

The `--profile` flag on `agent run` selects which MCPConfig (which App Insights/tenant connection) to use — the agent folder stays the same. If the same agent folder is run with different profiles, findings will be mixed in the same state.json, which may or may not be desirable. The recommendation is: **one agent per environment**.

---

## 9. Pipeline Templates

Each pipeline template ships with a `README.md` in its folder (see Section 10.3 for the README template standard). The YAML below is the pipeline file; the README provides setup instructions, secret configuration, customization guide, and troubleshooting.

### 9.1 GitHub Actions

File: `templates/github-actions/telemetry-agent.yml`
Companion: `templates/github-actions/README.md` (see Section 10.3 for format)

```yaml
name: Telemetry Monitoring Agents

on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:
    inputs:
      agent:
        description: 'Agent to run (blank = all)'
        required: false
        type: string

permissions:
  contents: write

jobs:
  run-agents:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout workspace (includes agent state)
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install BC Telemetry Buddy MCP
        run: npm install -g bc-telemetry-buddy-mcp

      - name: Run agent(s)
        run: |
          if [ -n "${{ inputs.agent }}" ]; then
            bctb-mcp agent run "${{ inputs.agent }}" --once
          else
            bctb-mcp agent run-all --once
          fi
        env:
          BCTB_AUTH_FLOW: client_credentials
          BCTB_TENANT_ID: ${{ secrets.BCTB_TENANT_ID }}
          BCTB_CLIENT_ID: ${{ secrets.BCTB_CLIENT_ID }}
          BCTB_CLIENT_SECRET: ${{ secrets.BCTB_CLIENT_SECRET }}
          BCTB_APP_INSIGHTS_ID: ${{ secrets.BCTB_APP_INSIGHTS_ID }}
          BCTB_KUSTO_CLUSTER_URL: ${{ secrets.BCTB_KUSTO_CLUSTER_URL }}
          AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          AZURE_OPENAI_KEY: ${{ secrets.AZURE_OPENAI_KEY }}
          AZURE_OPENAI_DEPLOYMENT: gpt-4o
          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}
          DEVOPS_PAT: ${{ secrets.DEVOPS_PAT }}

      - name: Commit updated agent state
        run: |
          git config user.name "bctb-agent"
          git config user.email "bctb-agent@noreply.github.com"
          git add agents/
          if git diff --cached --quiet; then
            echo "No state changes"
          else
            git commit -m "agent: run $(date -u +%Y-%m-%dT%H:%M)Z"
            git push
          fi
```

### 9.2 Azure DevOps Pipeline

File: `templates/azure-devops/azure-pipelines.yml`
Companion: `templates/azure-devops/README.md` (see Section 10.3 for format)

```yaml
trigger: none

schedules:
  - cron: '0 * * * *'
    displayName: 'Hourly agent run'
    branches:
      include: [main]
    always: true

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: bctb-secrets

steps:
  - checkout: self
    persistCredentials: true

  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g bc-telemetry-buddy-mcp
    displayName: 'Install BCTB MCP'

  - script: bctb-mcp agent run-all --once
    displayName: 'Run all agents'
    env:
      BCTB_AUTH_FLOW: client_credentials
      BCTB_TENANT_ID: $(BCTB_TENANT_ID)
      BCTB_CLIENT_ID: $(BCTB_CLIENT_ID)
      BCTB_CLIENT_SECRET: $(BCTB_CLIENT_SECRET)
      BCTB_APP_INSIGHTS_ID: $(BCTB_APP_INSIGHTS_ID)
      BCTB_KUSTO_CLUSTER_URL: $(BCTB_KUSTO_CLUSTER_URL)
      AZURE_OPENAI_ENDPOINT: $(AZURE_OPENAI_ENDPOINT)
      AZURE_OPENAI_KEY: $(AZURE_OPENAI_KEY)
      AZURE_OPENAI_DEPLOYMENT: gpt-4o
      TEAMS_WEBHOOK_URL: $(TEAMS_WEBHOOK_URL)
      DEVOPS_PAT: $(DEVOPS_PAT)

  - script: |
      git config user.name "bctb-agent"
      git config user.email "bctb-agent@noreply.github.com"
      git add agents/
      git diff --cached --quiet || git commit -m "agent: run $(date -u +%Y-%m-%dT%H:%M)Z"
      git push origin HEAD:main
    displayName: 'Commit agent state'
```

---

## 10. Template Documentation Requirements

Every template that ships with the package — whether pipeline YAML or agent instruction — MUST include comprehensive documentation so a user can adopt it without reading the design doc or source code.

### 10.1 Required Elements for Every Template

Each template file MUST contain:

| Element | Purpose | Format |
|---------|---------|--------|
| **Header block** | What this template does, who it's for | Comment block at top of file |
| **Prerequisites** | What the user needs before using this | Numbered checklist |
| **Required secrets / variables** | Every env var explained with where to get them | Table with name, description, how to obtain |
| **Customization guide** | What to change and why | Inline comments + section |
| **Expected behavior** | What happens when it runs successfully | Narrative description |
| **Example output** | What a successful run looks like | Sample console output or state.json |
| **Troubleshooting** | Common failure modes and fixes | FAQ-style list |

### 10.2 Pipeline Template Documentation Standard

Each pipeline YAML file ships inside a folder with a README:

```
templates/
├── github-actions/
│   ├── telemetry-agent.yml        ← the workflow file
│   └── README.md                  ← setup guide
├── azure-devops/
│   ├── azure-pipelines.yml        ← the pipeline file
│   └── README.md                  ← setup guide
└── agents/
    ├── README.md                  ← overview of all example agents
    ├── appsource-validation/
    │   ├── instruction.md         ← the agent instruction
    │   └── README.md              ← agent-specific documentation
    ├── performance-monitoring/
    │   ├── instruction.md
    │   └── README.md
    ├── error-rate-monitoring/
    │   ├── instruction.md
    │   └── README.md
    └── post-deployment-check/
        ├── instruction.md
        └── README.md
```

### 10.3 Pipeline README Template

Each pipeline README MUST follow this structure:

```markdown
# [GitHub Actions / Azure DevOps] — BC Telemetry Monitoring Agents

## What This Does
One paragraph: what the pipeline automates and how it fits into your workflow.

## Prerequisites
1. BC Telemetry Buddy MCP installed (`npm install -g bc-telemetry-buddy-mcp`)
2. Azure AD App Registration with Application Insights Reader role
3. Azure OpenAI deployment (GPT-4o recommended)
4. (Optional) Teams Incoming Webhook URL for notifications
5. (Optional) Azure DevOps PAT for work item creation

## Setup Guide

### Step 1: Create Your Workspace Repository
- Create a new Git repo (or use an existing one)
- Add `.bctb-config.json` with your telemetry connection details
- Create at least one agent: `bctb-mcp agent start "your instruction" --name my-agent`

### Step 2: Configure Secrets
Add these secrets to your [GitHub repo settings / Azure DevOps variable group]:

| Secret Name | Required | Description | How to Obtain |
|-------------|----------|-------------|---------------|
| `BCTB_TENANT_ID` | Yes | Azure AD tenant ID | Azure Portal → Azure Active Directory → Overview |
| `BCTB_CLIENT_ID` | Yes | App Registration client ID | Azure Portal → App Registrations → your app → Overview |
| `BCTB_CLIENT_SECRET` | Yes | App Registration client secret | Azure Portal → App Registrations → Certificates & secrets |
| `BCTB_APP_INSIGHTS_ID` | Yes | Application Insights App ID | Azure Portal → App Insights → API Access → Application ID |
| `BCTB_KUSTO_CLUSTER_URL` | Yes | Kusto/Log Analytics cluster URL | Azure Portal → Log Analytics → Overview |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI endpoint | Azure Portal → Azure OpenAI → your resource → Keys and Endpoint |
| `AZURE_OPENAI_KEY` | Yes | Azure OpenAI API key | Same as above |
| `TEAMS_WEBHOOK_URL` | No | Teams Incoming Webhook for notifications | Teams → Channel → Connectors → Incoming Webhook |
| `DEVOPS_PAT` | No | Azure DevOps PAT for work item creation | Azure DevOps → User Settings → Personal Access Tokens |

### Step 3: Copy the Pipeline File
- Copy `telemetry-agent.yml` to `.github/workflows/` (GitHub) or root (Azure DevOps)
- Customize the schedule (default: hourly)
- Push to `main`

### Step 4: Verify
- Trigger the pipeline manually (workflow_dispatch / manual run)
- Check the agent output in the pipeline logs
- Verify `agents/<name>/state.json` was committed

## Customization

### Change the Schedule
```yaml
# GitHub Actions — cron syntax (UTC)
schedule:
  - cron: '0 */2 * * *'  # every 2 hours
  - cron: '0 8 * * 1-5'  # weekdays at 8am UTC
```

### Run a Specific Agent
Use the manual trigger (workflow_dispatch) and specify the agent name.

### Add a New Agent
1. `bctb-mcp agent start "your instruction" --name new-agent`
2. Commit the new `agents/new-agent/` folder
3. The pipeline will pick it up automatically on next run

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "No config file found" | `.bctb-config.json` missing or not at repo root | Ensure config is committed and at workspace root |
| "Authentication failed" | Wrong credentials or expired secret | Refresh `BCTB_CLIENT_SECRET` in pipeline secrets |
| "Agent exceeded max tool calls" | LLM got stuck in a loop | Check instruction clarity; increase `maxToolCalls` in config |
| "No state changes" (every run) | Agent finding nothing | Check `BCTB_APP_INSIGHTS_ID` points to correct resource |
| Git push fails | Branch protection or permissions | Ensure pipeline has write access (`contents: write` on GitHub) |
```

### 10.4 Agent Instruction README Template

Each agent instruction ships with a README that explains what it monitors, what BC events it depends on, how to customize it, and what to expect.

```markdown
# Agent: [Name]

## Purpose
One paragraph: what this agent monitors and why.

## BC Telemetry Events Used
This agent relies on the following Business Central telemetry events.
Use `bctb-mcp` tools or the MCP Inspector to verify these events exist in your environment.

| Event ID | Name | Why This Agent Uses It |
|----------|------|----------------------|
| RT0005   | ...  | ...                  |

## Customization Points
Things you'll likely want to change in `instruction.md`:

| What | Default | How to Change |
|------|---------|---------------|
| Time window | Last 2 hours | Change "last 2 hours" to your preferred window |
| Escalation threshold | 3 consecutive checks | Change the number in "persist across N consecutive checks" |
| Notification channel | Teams webhook | Change "post to Teams" to your preferred action |

## Expected Behavior

### First Run
The agent performs initial discovery — it calls `get_event_catalog`, explores relevant events,
and establishes a baseline. No actions are taken on the first run.

### Subsequent Runs
The agent compares current telemetry against its accumulated context.
If it detects issues matching the instruction's criteria, it tracks them as active issues.

### Escalation
When an issue persists across the configured number of consecutive checks,
the agent takes the action specified in the instruction (Teams notification, DevOps work item, etc.).

### Resolution
When an issue is no longer detected, the agent marks it as resolved and
(optionally) sends a resolution notification.

## Example: What state.json Looks Like After 3 Runs

[Include a realistic state.json example specific to this agent's domain]

## Verifying It Works
1. Run manually: `bctb-mcp agent run <name> --once`
2. Check `agents/<name>/state.json` for findings
3. Check `agents/<name>/runs/` for the detailed run log
4. If no findings: verify your Application Insights resource contains the relevant event IDs
```

---

## 11. Example Agent Instructions (Fully Documented)

### 11.1 AppSource Validation Monitor

#### `templates/agents/appsource-validation/README.md`

```markdown
# Agent: AppSource Validation Monitor

## Purpose
Monitors AppSource extension validation failures in your Business Central environments.
Tracks recurring validation errors by extension name, escalates persistent issues
to Teams and Azure DevOps.

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
| DevOps escalation threshold | 6 consecutive checks | Change "persist across 6 consecutive checks" |
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
        { "run": 3, "action": "teams-webhook", "timestamp": "2026-02-24T12:00:30Z", "status": "sent" }
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
      "actions": [{ "run": 3, "action": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:30Z" }]
    },
    {
      "runId": 2,
      "timestamp": "2026-02-24T11:00:00Z",
      "durationMs": 38000,
      "toolCalls": ["query_telemetry"],
      "findings": "Sales Turbo errors still active (52, up from 47). Warehouse Helper resolved (0 errors).",
      "actions": []
    },
    {
      "runId": 1,
      "timestamp": "2026-02-24T10:00:00Z",
      "durationMs": 52000,
      "toolCalls": ["get_event_catalog", "get_event_field_samples", "query_telemetry"],
      "findings": "Initial scan. Found Sales Turbo schema errors (47) and Warehouse Helper permission warnings (12).",
      "actions": []
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
```

#### `templates/agents/appsource-validation/instruction.md`

```markdown
Monitor AppSource validation telemetry for my extensions.

Check for validation failures (RT0005 events with error status),
categorize by extension name and failure type.

If failures persist across 3 consecutive checks, post to the Teams channel.
If failures persist across 6 consecutive checks, create an Azure DevOps work item.

Focus on the last 2 hours of data each run.
Ignore test tenants (any tenant with "test" or "sandbox" in the company name).
```

---

### 11.2 Performance Monitor

#### `templates/agents/performance-monitoring/README.md`

```markdown
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
| DevOps escalation | 5 consecutive checks | Change the number |

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
If degradation persists 5+ runs → DevOps work item
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
        { "run": 3, "action": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:25Z" }
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
```

#### `templates/agents/performance-monitoring/instruction.md`

```markdown
Monitor Business Central performance across all tenants.

Track these metrics:
- Page load times (RT0006 events) — alert if p95 exceeds 5 seconds
- Report execution times (RT0006, RT0007) — alert if p95 exceeds 30 seconds
- AL method execution times — alert if any single method consistently exceeds 10 seconds

Compare current hour against previous runs to detect degradation.
If performance degrades for 2+ consecutive checks, post to Teams.
If degradation persists for 5+ checks, create a DevOps work item.

Group findings by tenant and identify which tenants are most affected.
```

---

### 11.3 Error Rate Monitor

#### `templates/agents/error-rate-monitoring/README.md`

```markdown
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
| Third detection | DevOps work item | Change to preferred action |

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
        { "run": 3, "action": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T12:00:20Z" }
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
```

#### `templates/agents/error-rate-monitoring/instruction.md`

```markdown
Monitor overall error rates across Business Central environments.

Check all events with error status. Group by event ID and tenant.

Flag any event type where:
- Error count in the last hour exceeds 100, OR
- Error rate increased by more than 200% compared to the typical rate you've seen in previous runs

For flagged issues:
- First detection: Log the finding (no action)
- Second consecutive detection: Post to Teams with affected tenants and error details
- Third consecutive detection: Create a DevOps work item

Summarize overall health: percentage of events in error vs success state.
```

---

### 11.4 Post-Deployment Watch

#### `templates/agents/post-deployment-check/README.md`

```markdown
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
| Notification | Teams + DevOps immediately | Remove either action if not needed |
| DevOps tag | "deployment-regression" | Change the tag name |
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
If any metric worsened by >50%: immediate Teams + DevOps alert.
The "deployment-regression" tag on the work item makes it easy to triage.
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
        { "run": 4, "action": "teams-webhook", "status": "sent", "timestamp": "2026-02-24T14:15:20Z" },
        { "run": 4, "action": "devops-workitem", "status": "sent", "timestamp": "2026-02-24T14:15:22Z" }
      ]
    }
  ]
}
```

## Verifying It Works

1. Run twice to build baseline: `bctb-mcp agent run post-deployment-check --once` (×2)
2. Check `state.json` — summary should contain baseline metrics
3. If testing without a real deployment: temporarily lower the regression threshold
   to 10% in `instruction.md` to trigger detection on normal variance
```

#### `templates/agents/post-deployment-check/instruction.md`

```markdown
Post-deployment monitoring mode.

Compare error rates and performance in the last 2 hours against
the baseline from your previous runs (before deployment).

Flag any metric that has worsened by more than 50% compared to pre-deployment baseline.

If any regression is detected:
- Immediately post to Teams with specific metrics and comparison
- Create a DevOps work item with "deployment-regression" tag

This agent should be started manually after a deployment and paused after 24 hours
of stable operation.
```

---

### 11.5 Agent Templates Overview README

File: `templates/agents/README.md`

```markdown
# Example Agent Instructions

These are ready-to-use agent instruction templates for common BC telemetry monitoring scenarios. Copy any template folder to your workspace's `agents/` directory and customize the `instruction.md` to fit your environment.

## Available Templates

| Template | Use Case | Key Events | Escalation Pattern |
|----------|----------|------------|-------------------|
| [appsource-validation](appsource-validation/) | ISVs publishing to AppSource | RT0005, LC0010, LC0020 | 3 checks → Teams, 6 checks → DevOps |
| [performance-monitoring](performance-monitoring/) | Track page/report/AL performance | RT0006, RT0007, RT0018 | 2 checks → Teams, 5 checks → DevOps |
| [error-rate-monitoring](error-rate-monitoring/) | Catch-all error rate monitoring | All error events (dynamic) | 1st: log, 2nd: Teams, 3rd: DevOps |
| [post-deployment-check](post-deployment-check/) | Short-lived post-deploy watch | All errors + performance | Immediate Teams + DevOps |

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
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Module | Tests |
|--------|-------|
| `context.ts` | Create agent, load/save state, sliding window compaction, resolved issue pruning |
| `actions.ts` | Mock HTTP calls for Teams webhook, DevOps work item, pipeline trigger |
| `prompts.ts` | Prompt building with various state configurations, output parsing |
| `runtime.ts` | Mock LLM responses to test ReAct loop, tool call dispatch, error handling, max tool call limit |
| CLI commands | Agent start, list, history, pause/resume |

### 12.2 Integration Tests

- End-to-end: create agent → run with mocked LLM → verify state.json updated correctly
- Multi-run: run agent 3 times → verify context accumulation and sliding window
- Action execution: verify Teams webhook receives correct payload (mock server)

### 12.3 Test Infrastructure

Same as existing: Jest, mocked `fs` for file operations, mocked `fetch` for HTTP calls.

---

## 13. New Dependencies

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| None strictly required | Azure OpenAI can be called via native `fetch` | Zero |
| `@azure/openai` (optional) | Typed Azure OpenAI SDK — better DX but adds dependency | ~200KB |

**Recommendation:** Use native `fetch` (available in Node 20+) with typed interfaces. Avoids adding a dependency. The Azure OpenAI REST API is simple enough that a thin wrapper suffices.

---

## 14. Implementation Phases

### Phase 1: Core Runtime (MVP)
- [ ] `AgentContextManager` — create, load, save state
- [ ] `AgentRuntime` — ReAct loop with Azure OpenAI
- [ ] `parseAgentOutput` — extract structured output from LLM
- [ ] CLI: `agent start`, `agent run --once`
- [ ] Unit tests for all above
- **Result:** An agent can be created and run manually from the command line.

### Phase 2: Actions & CLI
- [ ] `ActionDispatcher` — Teams webhook, DevOps work item
- [ ] CLI: `agent list`, `agent history`, `agent pause/resume`, `agent run-all`
- [ ] Context compaction (sliding window + LLM summary)
- [ ] Resolved issue pruning
- [ ] Unit + integration tests
- **Result:** Full CLI, agents can notify and create work items.

### Phase 3: Pipeline Templates & Examples
- [ ] GitHub Actions workflow template with README
- [ ] Azure DevOps Pipeline template with README
- [ ] Example agent instructions (4 templates, each with README per Section 10.4)
- [ ] Agent templates overview README (Section 11.5)
- [ ] All templates meet documentation standard (Section 10.1)
- [ ] End-to-end test with mocked pipeline context
- **Result:** Users can set up autonomous monitoring in their CI/CD.

### Phase 4: Polish & Documentation
- [ ] Update UserGuide.md with agent documentation
- [ ] Update MCP README with agent features
- [ ] Add `agents` section to config-schema.json
- [ ] Pipeline trigger action
- [ ] Error handling hardening (LLM failures, API timeouts, malformed state)
- **Result:** Production-ready, documented feature.

---

## 15. Cost Estimates

| Component | Monthly Cost |
|-----------|-------------|
| Azure OpenAI (GPT-4o, ~3500 tokens/run, hourly) | ~$5-10 |
| GitHub Actions (1440 min/month, free tier: 2000) | Free |
| Azure DevOps Pipeline (1440 min/month, free tier: 1800) | Free |
| Teams webhook | Free |
| Azure DevOps work items | Free |
| **Total** | **~$5-10/month** |

---

## 16. Security Considerations

- **LLM API key**: Stored as pipeline secret, never in config file or state.json.
- **DevOps PAT**: Same — pipeline secret only.
- **State files**: May contain telemetry summaries. Ensure the Git repo is private if telemetry is sensitive.
- **Tool call safety**: All MCP tools are read-only except `save_query`. The agent cannot modify telemetry data.
- **Max tool calls**: Configurable limit prevents runaway LLM loops.
- **No arbitrary code execution**: The agent can only call predefined MCP tools and predefined action types.

---

## 17. Open Questions — RESOLVED

1. **Should agents be able to call each other?** ~~Recommendation: Not in v1.~~ **CONFIRMED: Not in v1.**
2. **Should the VS Code extension have agent management UI?** ~~Recommendation: CLI-first, extension later.~~ **CONFIRMED: CLI-first, extension later.**
3. **Should agents support multiple profiles?** ~~Recommendation: Yes, via `--profile` flag on `agent run`.~~ **CONFIRMED: Yes, via `--profile` flag. See Section 8.4 for state-vs-profile scoping.** One agent per environment is recommended.
4. **Compaction strategy**: ~~Recommendation: Part of the LLM call.~~ **CONFIRMED: Part of the LLM call** (the LLM already sees the previous summary + new findings and writes an updated summary).
