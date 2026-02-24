/**
 * Builds the environment variables passed to the MCP server process.
 * 
 * Extracted from provideMcpServerDefinitions() for testability (SRP).
 * The MCP server uses these env vars to configure itself at startup.
 */

export interface BuildMcpEnvParams {
    /** Workspace folder path (sets BCTB_WORKSPACE_PATH) */
    workspacePath: string;
    /** Currently active profile name from ProfileManager (sets BCTB_PROFILE) */
    activeProfile: string | null | undefined;
    /** Authentication flow type from config */
    authFlow: string | undefined;
    /** Whether the config has valid tenantId + applicationInsightsAppId */
    hasValidConfig: boolean;
    /** VS Code auth access token (for vscode_auth flow) */
    accessToken: string | undefined;
}

export interface McpEnvVars {
    BCTB_WORKSPACE_PATH?: string;
    BCTB_PROFILE?: string;
    BCTB_ACCESS_TOKEN?: string;
    [key: string]: string | undefined;
}

/**
 * Build environment variables for the MCP server process.
 * 
 * @returns Record of env vars to pass to the MCP server
 */
export function buildMcpEnv(params: BuildMcpEnvParams): Record<string, string> {
    const env: Record<string, string> = {};

    if (params.workspacePath) {
        env.BCTB_WORKSPACE_PATH = params.workspacePath;
    }

    // Issue #97 fix: Pass the active profile so the MCP server uses it
    // instead of always falling back to defaultProfile from .bctb-config.json
    if (params.activeProfile) {
        env.BCTB_PROFILE = params.activeProfile;
    }

    // Pass VS Code auth token if applicable
    if (params.hasValidConfig && params.authFlow === 'vscode_auth' && params.accessToken) {
        env.BCTB_ACCESS_TOKEN = params.accessToken;
    }

    return env;
}
