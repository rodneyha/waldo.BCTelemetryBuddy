/**
 * Agent Runtime — the core ReAct loop that drives autonomous telemetry monitoring.
 *
 * Architecture:
 * 1. Loads the agent's instruction and previous state
 * 2. Sends both to an LLM along with available tool definitions
 * 3. LLM reasons → calls tools → observes results → repeats
 * 4. Produces findings, assessment, and actions
 * 5. Updates state and writes run log
 *
 * Design:
 * - DIP: LLM is injected via LLMProvider interface (Azure OpenAI is just one impl)
 * - SRP: Runtime handles only the loop; context, actions, prompts are separate modules
 * - OCP: New LLM providers = implement interface, no runtime changes
 */

import { ToolHandlers } from '../tools/toolHandlers.js';
import { TOOL_DEFINITIONS } from '../tools/toolDefinitions.js';
import { AgentContextManager } from './context.js';
import { ActionDispatcher } from './actions.js';
import {
    buildAgentPrompt,
    AGENT_SYSTEM_PROMPT,
    parseAgentOutput,
    filterToolsByScope,
    toolDefinitionsToOpenAI
} from './prompts.js';
import {
    AgentRuntimeConfig,
    AgentRunLog,
    ChatMessage,
    ToolCallEntry
} from './types.js';

export class AgentRuntime {
    private readonly toolHandlers: ToolHandlers;
    private readonly contextManager: AgentContextManager;
    private readonly actionDispatcher: ActionDispatcher;
    private readonly config: AgentRuntimeConfig;

    constructor(
        toolHandlers: ToolHandlers,
        contextManager: AgentContextManager,
        actionDispatcher: ActionDispatcher,
        config: AgentRuntimeConfig
    ) {
        this.toolHandlers = toolHandlers;
        this.contextManager = contextManager;
        this.actionDispatcher = actionDispatcher;
        this.config = config;
    }

    /**
     * Execute a single monitoring pass for the named agent.
     * Returns the run log for audit trail.
     */
    async run(agentName: string): Promise<AgentRunLog> {
        const startTime = Date.now();

        // 1. Load instruction and state
        const instruction = this.contextManager.loadInstruction(agentName);
        const state = this.contextManager.loadState(agentName);

        // Check if agent is paused
        if (state.status === 'paused') {
            throw new Error(`Agent '${agentName}' is paused. Use 'agent resume' to reactivate.`);
        }

        // 2. Build initial messages
        const filteredTools = filterToolsByScope(TOOL_DEFINITIONS, this.config.toolScope);
        const tools = toolDefinitionsToOpenAI(filteredTools);
        const messages: ChatMessage[] = [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user', content: buildAgentPrompt(instruction, state) }
        ];

        // 3. ReAct loop
        const toolCallLog: ToolCallEntry[] = [];
        let totalToolCalls = 0;
        let llmStats = { promptTokens: 0, completionTokens: 0 };

        while (totalToolCalls < this.config.maxToolCalls) {
            const response = await this.config.llmProvider.chat(messages, {
                tools,
                maxTokens: this.config.maxTokens
            });

            llmStats.promptTokens += response.usage.promptTokens;
            llmStats.completionTokens += response.usage.completionTokens;

            if (response.toolCalls && response.toolCalls.length > 0) {
                // LLM wants to call tools — add assistant message to conversation
                messages.push(response.assistantMessage);

                for (const call of response.toolCalls) {
                    totalToolCalls++;
                    const callStart = Date.now();

                    let resultStr: string;
                    try {
                        const args = JSON.parse(call.function.arguments);
                        const result = await this.toolHandlers.executeToolCall(
                            call.function.name,
                            args
                        );
                        resultStr = typeof result === 'string'
                            ? result
                            : JSON.stringify(result, null, 2);
                    } catch (error: any) {
                        resultStr = JSON.stringify({
                            error: error.message || 'Tool execution failed'
                        });
                    }

                    messages.push({
                        role: 'tool',
                        content: resultStr,
                        tool_call_id: call.id
                    });

                    toolCallLog.push({
                        sequence: totalToolCalls,
                        tool: call.function.name,
                        args: (() => {
                            try { return JSON.parse(call.function.arguments); }
                            catch { return {}; }
                        })(),
                        resultSummary: resultStr.substring(0, 500),
                        durationMs: Date.now() - callStart
                    });
                }
            } else {
                // LLM is done reasoning — parse final output
                const output = parseAgentOutput(response.content);

                // 4. Execute actions
                const executedActions = await this.actionDispatcher.dispatch(
                    output.actions,
                    agentName
                );

                // 5. Update state
                const updatedState = this.contextManager.updateState(
                    agentName,
                    state,
                    output,
                    executedActions,
                    Date.now() - startTime,
                    toolCallLog.map(tc => tc.tool)
                );

                // 6. Build run log
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
                        model: this.config.llmProvider.modelName,
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

                // 7. Persist
                this.contextManager.saveRunLog(agentName, runLog);
                this.contextManager.saveState(agentName, updatedState);

                return runLog;
            }
        }

        // Safety: max tool calls reached
        throw new Error(`Agent '${agentName}' exceeded max tool calls (${this.config.maxToolCalls})`);
    }
}
