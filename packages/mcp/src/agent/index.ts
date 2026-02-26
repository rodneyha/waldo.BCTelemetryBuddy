/**
 * Agent module — public API for the Agentic Autonomous Telemetry Monitoring feature.
 *
 * Re-exports all agent classes, interfaces, and functions needed by the CLI
 * and external consumers.
 */

export { AgentRuntime } from './runtime.js';
export { AgentContextManager } from './context.js';
export { ActionDispatcher } from './actions.js';
export {
    AGENT_SYSTEM_PROMPT,
    buildAgentPrompt,
    parseAgentOutput,
    filterToolsByScope,
    toolDefinitionsToOpenAI
} from './prompts.js';
export * from './types.js';
export { generateRunReport } from './report.js';
