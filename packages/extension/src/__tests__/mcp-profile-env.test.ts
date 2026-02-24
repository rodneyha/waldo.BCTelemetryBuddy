/**
 * Tests for Issue #97: MCP server should receive BCTB_PROFILE env var
 * 
 * Verifies that buildMcpEnv() includes BCTB_PROFILE when a profile is active,
 * so the MCP server process uses the correct profile instead of always falling
 * back to defaultProfile.
 */

import { buildMcpEnv, BuildMcpEnvParams } from '../services/mcpEnvBuilder';

describe('buildMcpEnv — BCTB_PROFILE (Issue #97)', () => {
    const baseParams: BuildMcpEnvParams = {
        workspacePath: '/test/workspace',
        activeProfile: null,
        authFlow: 'azure_cli',
        hasValidConfig: true,
        accessToken: undefined,
    };

    it('should include BCTB_WORKSPACE_PATH when workspacePath is provided', () => {
        const env = buildMcpEnv(baseParams);
        expect(env.BCTB_WORKSPACE_PATH).toBe('/test/workspace');
    });

    it('should NOT include BCTB_WORKSPACE_PATH when workspacePath is empty', () => {
        const env = buildMcpEnv({ ...baseParams, workspacePath: '' });
        expect(env.BCTB_WORKSPACE_PATH).toBeUndefined();
    });

    it('should include BCTB_PROFILE when activeProfile is set', () => {
        const env = buildMcpEnv({ ...baseParams, activeProfile: 'Customers' });
        expect(env.BCTB_PROFILE).toBe('Customers');
    });

    it('should NOT include BCTB_PROFILE when activeProfile is null', () => {
        const env = buildMcpEnv({ ...baseParams, activeProfile: null });
        expect(env.BCTB_PROFILE).toBeUndefined();
    });

    it('should NOT include BCTB_PROFILE when activeProfile is undefined', () => {
        const env = buildMcpEnv({ ...baseParams, activeProfile: undefined });
        expect(env.BCTB_PROFILE).toBeUndefined();
    });

    it('should include BCTB_ACCESS_TOKEN when vscode_auth and token available', () => {
        const env = buildMcpEnv({
            ...baseParams,
            authFlow: 'vscode_auth',
            accessToken: 'my-token-123',
        });
        expect(env.BCTB_ACCESS_TOKEN).toBe('my-token-123');
    });

    it('should NOT include BCTB_ACCESS_TOKEN when authFlow is not vscode_auth', () => {
        const env = buildMcpEnv({
            ...baseParams,
            authFlow: 'azure_cli',
            accessToken: 'my-token-123',
        });
        expect(env.BCTB_ACCESS_TOKEN).toBeUndefined();
    });

    it('should NOT include BCTB_ACCESS_TOKEN when token is undefined', () => {
        const env = buildMcpEnv({
            ...baseParams,
            authFlow: 'vscode_auth',
            accessToken: undefined,
        });
        expect(env.BCTB_ACCESS_TOKEN).toBeUndefined();
    });

    it('should combine BCTB_WORKSPACE_PATH and BCTB_PROFILE together', () => {
        const env = buildMcpEnv({
            ...baseParams,
            workspacePath: '/my/workspace',
            activeProfile: 'DistriApps',
        });
        expect(env.BCTB_WORKSPACE_PATH).toBe('/my/workspace');
        expect(env.BCTB_PROFILE).toBe('DistriApps');
    });

    it('should handle full scenario: workspace + profile + vscode_auth token', () => {
        const env = buildMcpEnv({
            workspacePath: '/my/workspace',
            activeProfile: 'Production',
            authFlow: 'vscode_auth',
            hasValidConfig: true,
            accessToken: 'token-abc',
        });
        expect(env.BCTB_WORKSPACE_PATH).toBe('/my/workspace');
        expect(env.BCTB_PROFILE).toBe('Production');
        expect(env.BCTB_ACCESS_TOKEN).toBe('token-abc');
    });
});
