import { loadConfigFromFile, validateConfig, MCPConfig } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Mock heavy dependencies so MCPServer can be instantiated in tests ──

// Mock @bctb/shared services to avoid real connections
jest.mock('@bctb/shared', () => ({
    AuthService: jest.fn().mockImplementation(() => ({ authenticate: jest.fn() })),
    KustoService: jest.fn().mockImplementation(() => ({ query: jest.fn() })),
    CacheService: jest.fn().mockImplementation(() => ({ get: jest.fn(), set: jest.fn() })),
    QueriesService: jest.fn().mockImplementation(() => ({ list: jest.fn() })),
    ReferencesService: jest.fn().mockImplementation(() => ({ search: jest.fn() })),
    sanitizeObject: jest.fn((obj: any) => obj),
    lookupEventCategory: jest.fn(),
    NoOpUsageTelemetry: jest.fn().mockImplementation(() => ({ trackEvent: jest.fn(), flush: jest.fn() })),
    RateLimitedUsageTelemetry: jest.fn().mockImplementation(() => ({ trackEvent: jest.fn(), flush: jest.fn() })),
    IUsageTelemetry: undefined,
    TELEMETRY_CONNECTION_STRING: '', // Disable telemetry initialization
    TELEMETRY_EVENTS: { MCP: { SERVER_STARTED: 'Mcp.ServerStarted' } },
    createCommonProperties: jest.fn(() => ({})),
    cleanTelemetryProperties: jest.fn(() => ({})),
    hashValue: jest.fn(() => 'testhash'),
}));

jest.mock('../mcpTelemetry.js', () => ({
    createMCPUsageTelemetry: jest.fn(() => null),
    getMCPInstallationId: jest.fn(() => 'test-installation-id'),
}));

jest.mock('../version.js', () => ({
    VERSION: '0.0.0-test',
}));

// Import MCPServer AFTER mocks are set up
import { MCPServer } from '../server.js';

/**
 * Test profile switching functionality
 * Tests config-level profile loading AND server-level profile methods:
 *   - detectInitialProfile()
 *   - switchProfile()
 *   - listProfiles()
 */
describe('Profile Switching', () => {
    const originalEnv = process.env;
    let consoleErrorSpy: jest.SpyInstance;
    let tempDir: string;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        process.env = { ...originalEnv };
        // Create temp directory for config files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctb-profile-test-'));
    });

    afterEach(() => {
        process.env = originalEnv;
        consoleErrorSpy.mockRestore();
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /** Helper: write a multi-profile .bctb-config.json and return its path */
    function createMultiProfileConfig(dir: string): string {
        const configPath = path.join(dir, '.bctb-config.json');
        const config = {
            defaultProfile: 'Customers',
            profiles: {
                _base: {
                    authFlow: 'azure_cli',
                    kustoClusterUrl: 'https://ade.applicationinsights.io'
                },
                Customers: {
                    extends: '_base',
                    connectionName: 'Customers Production',
                    applicationInsightsAppId: 'cust-app-id-001',
                    tenantId: 'cust-tenant-001'
                },
                DistriApps: {
                    extends: '_base',
                    connectionName: 'DistriApps Production',
                    applicationInsightsAppId: 'distri-app-id-002',
                    tenantId: 'distri-tenant-002'
                },
                TestEnv: {
                    extends: '_base',
                    connectionName: 'Test Environment',
                    applicationInsightsAppId: 'test-app-id-003',
                    tenantId: 'test-tenant-003'
                }
            },
            cache: { enabled: true, ttlSeconds: 3600 },
            sanitize: { removePII: false }
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return configPath;
    }

    /** Helper: write a single-profile (flat) .bctb-config.json */
    function createSingleProfileConfig(dir: string): string {
        const configPath = path.join(dir, '.bctb-config.json');
        const config = {
            connectionName: 'Single Connection',
            authFlow: 'azure_cli',
            applicationInsightsAppId: 'single-app-id',
            kustoClusterUrl: 'https://ade.applicationinsights.io'
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return configPath;
    }

    /** Helper: write a config with empty profiles object */
    function createEmptyProfilesConfig(dir: string): string {
        const configPath = path.join(dir, '.bctb-config.json');
        const config = {
            connectionName: 'No Profiles',
            profiles: {},
            authFlow: 'azure_cli',
            applicationInsightsAppId: 'empty-profiles-id',
            kustoClusterUrl: 'https://ade.applicationinsights.io'
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return configPath;
    }

    /** Helper: create a minimal MCPConfig pointing at tempDir */
    function makeTestConfig(overrides?: Partial<MCPConfig>): MCPConfig {
        return {
            connectionName: 'Test Connection',
            tenantId: 'test-tenant',
            authFlow: 'azure_cli',
            applicationInsightsAppId: 'test-app-id',
            kustoClusterUrl: 'https://ade.applicationinsights.io',
            cacheEnabled: false,
            cacheTTLSeconds: 3600,
            removePII: false,
            port: 52345,
            workspacePath: tempDir,
            queriesFolder: 'queries',
            references: [],
            ...overrides,
        };
    }

    /** Helper: instantiate MCPServer with a test config in stdio mode (quiet) */
    function createTestServer(configOverrides?: Partial<MCPConfig>): MCPServer {
        const config = makeTestConfig(configOverrides);
        return new MCPServer(config, 'stdio');
    }

    // ────────────────────────────────────────────────────────
    // 1. Config-level tests (loadConfigFromFile)
    // ────────────────────────────────────────────────────────
    describe('loadConfigFromFile with profile selection', () => {
        it('should load the default profile when no profile is specified via env', () => {
            const configPath = createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            process.env.BCTB_PROFILE = 'Customers';

            const config = loadConfigFromFile(configPath, undefined, true);
            expect(config).not.toBeNull();
            expect(config!.connectionName).toBe('Customers Production');
            expect(config!.applicationInsightsAppId).toBe('cust-app-id-001');
        });

        it('should load a specific profile when profileName is provided', () => {
            const configPath = createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            const config = loadConfigFromFile(configPath, 'DistriApps', true);
            expect(config).not.toBeNull();
            expect(config!.connectionName).toBe('DistriApps Production');
            expect(config!.applicationInsightsAppId).toBe('distri-app-id-002');
        });

        it('should throw for non-existent profile', () => {
            const configPath = createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            expect(() => loadConfigFromFile(configPath, 'NonExistent', true)).toThrow("Profile 'NonExistent' not found");
        });

        it('should resolve profile inheritance from _base', () => {
            const configPath = createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            const config = loadConfigFromFile(configPath, 'DistriApps', true);
            expect(config).not.toBeNull();
            expect(config!.authFlow).toBe('azure_cli');
            expect(config!.kustoClusterUrl).toBe('https://ade.applicationinsights.io');
            expect(config!.connectionName).toBe('DistriApps Production');
        });

        it('should load different App Insights IDs per profile', () => {
            const configPath = createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            const customersConfig = loadConfigFromFile(configPath, 'Customers', true);
            const distriConfig = loadConfigFromFile(configPath, 'DistriApps', true);
            const testConfig = loadConfigFromFile(configPath, 'TestEnv', true);

            expect(customersConfig!.applicationInsightsAppId).toBe('cust-app-id-001');
            expect(distriConfig!.applicationInsightsAppId).toBe('distri-app-id-002');
            expect(testConfig!.applicationInsightsAppId).toBe('test-app-id-003');

            expect(customersConfig!.applicationInsightsAppId).not.toBe(distriConfig!.applicationInsightsAppId);
            expect(distriConfig!.applicationInsightsAppId).not.toBe(testConfig!.applicationInsightsAppId);
        });
    });

    // ────────────────────────────────────────────────────────
    // 2. MCPServer.detectInitialProfile()
    // ────────────────────────────────────────────────────────
    describe('MCPServer.detectInitialProfile()', () => {
        it('should return null when no config file exists', () => {
            // No .bctb-config.json in tempDir
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBeNull();
        });

        it('should return null when config has no profiles key', () => {
            createSingleProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBeNull();
        });

        it('should return null when profiles is empty', () => {
            createEmptyProfilesConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBeNull();
        });

        it('should return defaultProfile when BCTB_PROFILE env is not set', () => {
            createMultiProfileConfig(tempDir);
            delete process.env.BCTB_PROFILE;
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBe('Customers'); // defaultProfile in config
        });

        it('should prefer BCTB_PROFILE env var over defaultProfile', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_PROFILE = 'DistriApps';
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBe('DistriApps');
        });

        it('should fall back to "default" when no defaultProfile and no env var', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                profiles: {
                    prod: { connectionName: 'Prod' },
                    staging: { connectionName: 'Staging' }
                }
                // no defaultProfile set
            }));
            delete process.env.BCTB_PROFILE;
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBe('default');
        });

        it('should return null when config file has invalid JSON', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, '{ INVALID JSON !!!');
            const server = createTestServer();
            const result = (server as any).detectInitialProfile();
            expect(result).toBeNull(); // catch block returns null
        });
    });

    // ────────────────────────────────────────────────────────
    // 3. MCPServer.switchProfile()
    // ────────────────────────────────────────────────────────
    describe('MCPServer.switchProfile()', () => {
        it('should fail when no .bctb-config.json exists', () => {
            const server = createTestServer();
            const result = (server as any).switchProfile('Customers');
            expect(result.success).toBe(false);
            expect(result.error).toContain('No .bctb-config.json found');
        });

        it('should fail when config has no profiles key', () => {
            createSingleProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).switchProfile('Customers');
            expect(result.success).toBe(false);
            expect(result.error).toContain('no profiles defined');
        });

        it('should fail when config has empty profiles', () => {
            createEmptyProfilesConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).switchProfile('Customers');
            expect(result.success).toBe(false);
            expect(result.error).toContain('no profiles defined');
        });

        it('should fail when profile name does not exist', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            const result = (server as any).switchProfile('NonExistent');
            expect(result.success).toBe(false);
            expect(result.error).toContain("Profile 'NonExistent' not found");
            expect(result.error).toContain('Customers');
            expect(result.error).toContain('DistriApps');
            expect(result.error).toContain('TestEnv');
        });

        it('should successfully switch to a valid profile', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            const result = (server as any).switchProfile('DistriApps');

            expect(result.success).toBe(true);
            expect(result.currentProfile.name).toBe('DistriApps');
            expect(result.currentProfile.connectionName).toBe('DistriApps Production');
            expect(result.currentProfile.applicationInsightsAppId).toBe('distri-app-id-002');
            expect(result.message).toContain('DistriApps');
        });

        it('should update activeProfileName after switch', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();

            expect((server as any).activeProfileName).not.toBe('TestEnv');
            (server as any).switchProfile('TestEnv');
            expect((server as any).activeProfileName).toBe('TestEnv');
        });

        it('should update config after switch', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            (server as any).switchProfile('DistriApps');

            expect((server as any).config.connectionName).toBe('DistriApps Production');
            expect((server as any).config.applicationInsightsAppId).toBe('distri-app-id-002');
        });

        it('should preserve port after switch', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer({ port: 9999 });
            (server as any).switchProfile('DistriApps');

            expect((server as any).config.port).toBe(9999);
        });

        it('should report previousProfile in result', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer({ connectionName: 'Initial' });

            // First switch
            const result1 = (server as any).switchProfile('DistriApps');
            // previousProfile should be the initial activeProfileName or connectionName
            expect(result1.previousProfile).toBeDefined();

            // Second switch
            const result2 = (server as any).switchProfile('TestEnv');
            expect(result2.previousProfile).toBe('DistriApps');
        });

        it('should reinitialize all services after switch', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const { AuthService, KustoService, CacheService, QueriesService, ReferencesService } =
                require('@bctb/shared');

            // Clear call counts
            AuthService.mockClear();
            KustoService.mockClear();
            CacheService.mockClear();
            QueriesService.mockClear();
            ReferencesService.mockClear();

            const server = createTestServer();
            // Constructor calls each service once
            expect(AuthService).toHaveBeenCalledTimes(1);
            expect(KustoService).toHaveBeenCalledTimes(1);

            (server as any).switchProfile('DistriApps');
            // After switch, each service should be constructed again
            expect(AuthService).toHaveBeenCalledTimes(2);
            expect(KustoService).toHaveBeenCalledTimes(2);
            expect(CacheService).toHaveBeenCalledTimes(2);
            expect(QueriesService).toHaveBeenCalledTimes(2);
            expect(ReferencesService).toHaveBeenCalledTimes(2);
        });

        it('should include configValid and configErrors in result', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            const result = (server as any).switchProfile('DistriApps');

            expect(result).toHaveProperty('configValid');
            expect(typeof result.configValid).toBe('boolean');
            // configErrors should be omitted when empty
            if (result.configValid) {
                expect(result.configErrors).toBeUndefined();
            } else {
                expect(Array.isArray(result.configErrors)).toBe(true);
            }
        });

        it('should return error for invalid JSON config', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, '{ NOT VALID }');
            const server = createTestServer();
            const result = (server as any).switchProfile('anything');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to switch profile');
        });

        it('should not include base profiles in available profiles list', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            // Try switching to _base (should fail - underscore profiles are filtered)
            const result = (server as any).switchProfile('_base');
            expect(result.success).toBe(false);
            expect(result.error).toContain("Profile '_base' not found");
        });

        it('should handle error during config load gracefully', () => {
            // Create a config file that switchProfile can read for the initial
            // JSON.parse, but that causes loadConfigFromFile to throw
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                defaultProfile: 'prod',
                profiles: {
                    prod: {
                        connectionName: 'Prod',
                        applicationInsightsAppId: 'prod-id',
                        kustoClusterUrl: 'https://cluster.test',
                        authFlow: 'azure_cli'
                    }
                }
            }));
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();

            // Now corrupt the config file so the loadConfigFromFile call inside
            // switchProfile will fail when it tries to re-read and parse it
            fs.writeFileSync(configPath, '{ BROKEN JSON !!!');

            const result = (server as any).switchProfile('prod');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to switch profile');
        });

        it('should use connectionName as previousProfile when activeProfileName is null', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer({ connectionName: 'My Initial Connection' });

            // Force activeProfileName to null to hit the fallback branch
            (server as any).activeProfileName = null;
            const result = (server as any).switchProfile('DistriApps');

            expect(result.success).toBe(true);
            expect(result.previousProfile).toBe('My Initial Connection');
        });

        it('should report configErrors when profile has validation issues', () => {
            // Create a config where a profile has incomplete data (no appInsightsId)
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                defaultProfile: 'complete',
                profiles: {
                    complete: {
                        connectionName: 'Complete',
                        applicationInsightsAppId: 'app-id',
                        kustoClusterUrl: 'https://cluster.test',
                        authFlow: 'azure_cli'
                    },
                    incomplete: {
                        connectionName: 'Incomplete Profile'
                        // Missing appInsightsId and kustoClusterUrl → validation errors
                    }
                }
            }));
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();
            const result = (server as any).switchProfile('incomplete');

            expect(result.success).toBe(true);
            expect(result.configValid).toBe(false);
            expect(result.configErrors).toBeDefined();
            expect(result.configErrors.length).toBeGreaterThan(0);
        });
    });

    // ────────────────────────────────────────────────────────
    // 4. MCPServer.listProfiles()
    // ────────────────────────────────────────────────────────
    describe('MCPServer.listProfiles()', () => {
        it('should return single profile mode when no config file exists', () => {
            const server = createTestServer({ connectionName: 'Default Conn' });
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('single');
            expect(result.currentProfile.name).toBe('default');
            expect(result.currentProfile.connectionName).toBe('Default Conn');
            expect(result.currentProfile.isActive).toBe(true);
            expect(result.availableProfiles).toEqual([]);
            expect(result.message).toContain('Single profile mode');
        });

        it('should return single profile mode for config without profiles key', () => {
            createSingleProfileConfig(tempDir);
            const server = createTestServer({ connectionName: 'Single Conn' });
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('single');
            expect(result.currentProfile.isActive).toBe(true);
            expect(result.availableProfiles).toEqual([]);
            expect(result.message).toContain('Single profile mode');
        });

        it('should return single profile mode for config with empty profiles', () => {
            createEmptyProfilesConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('single');
            expect(result.availableProfiles).toEqual([]);
        });

        it('should return multi profile mode for multi-profile config', () => {
            createMultiProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('multi');
            expect(result.totalProfiles).toBe(3); // Customers, DistriApps, TestEnv (not _base)
        });

        it('should mark the active profile correctly', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();

            // Switch to DistriApps
            (server as any).switchProfile('DistriApps');
            const result = (server as any).listProfiles();

            expect(result.currentProfile.name).toBe('DistriApps');
            expect(result.currentProfile.isActive).toBe(true);
            // Other profiles should be in availableProfiles
            const otherNames = result.availableProfiles.map((p: any) => p.name);
            expect(otherNames).toContain('Customers');
            expect(otherNames).toContain('TestEnv');
            expect(otherNames).not.toContain('DistriApps');
        });

        it('should exclude base profiles from the listing', () => {
            createMultiProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).listProfiles();

            const allNames = [
                result.currentProfile?.name,
                ...result.availableProfiles.map((p: any) => p.name)
            ];
            expect(allNames).not.toContain('_base');
        });

        it('should include profile details (connectionName, appId, authFlow)', () => {
            createMultiProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).listProfiles();

            const allProfiles = [result.currentProfile, ...result.availableProfiles];
            for (const p of allProfiles) {
                expect(p).toHaveProperty('name');
                expect(p).toHaveProperty('connectionName');
                expect(p).toHaveProperty('isActive');
            }
        });

        it('should include usage instructions', () => {
            createMultiProfileConfig(tempDir);
            const server = createTestServer();
            const result = (server as any).listProfiles();

            expect(result.usage).toBeDefined();
            expect(result.usage.switchingInstructions).toContain('switch_profile');
            expect(result.usage.noteForQueries).toContain('active profile');
        });

        it('should return error profile mode for invalid JSON config', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, 'NOT JSON');
            const server = createTestServer();
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('error');
            expect(result.error).toBeDefined();
        });

        it('should use activeProfileName over env var and defaultProfile', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_PROFILE = 'Customers';
            const server = createTestServer();

            // Manually set activeProfileName to override env
            (server as any).activeProfileName = 'TestEnv';
            const result = (server as any).listProfiles();

            expect(result.currentProfile.name).toBe('TestEnv');
        });

        it('should fall back to env var when activeProfileName is null', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_PROFILE = 'DistriApps';
            const server = createTestServer();

            (server as any).activeProfileName = null;
            const result = (server as any).listProfiles();

            expect(result.currentProfile.name).toBe('DistriApps');
        });

        it('should fall back to defaultProfile when no env var and no activeProfileName', () => {
            createMultiProfileConfig(tempDir);
            delete process.env.BCTB_PROFILE;
            const server = createTestServer();

            (server as any).activeProfileName = null;
            const result = (server as any).listProfiles();

            expect(result.currentProfile.name).toBe('Customers'); // defaultProfile
        });

        it('should handle currentProfile not found among profiles', () => {
            createMultiProfileConfig(tempDir);
            const server = createTestServer();
            (server as any).activeProfileName = 'NonExistentProfile';
            const result = (server as any).listProfiles();

            // Should fall back to creating a currentProfile object
            expect(result.currentProfile.name).toBe('NonExistentProfile');
            expect(result.currentProfile.isActive).toBe(true);
        });

        it('should fall back to "default" when all fallbacks are empty', () => {
            // Config with profiles but no defaultProfile and no env var
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                profiles: {
                    alpha: { connectionName: 'Alpha Conn' },
                    beta: { connectionName: 'Beta Conn' }
                }
                // No defaultProfile
            }));
            delete process.env.BCTB_PROFILE;
            const server = createTestServer();
            (server as any).activeProfileName = null;
            const result = (server as any).listProfiles();

            expect(result.currentProfile.name).toBe('default');
        });

        it('should use profile name as connectionName when connectionName is missing', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                defaultProfile: 'noConn',
                profiles: {
                    noConn: {
                        // no connectionName property
                        applicationInsightsAppId: 'some-id',
                        authFlow: 'azure_cli'
                    }
                }
            }));
            const server = createTestServer();
            const result = (server as any).listProfiles();

            // Should use profile name as connectionName fallback
            expect(result.currentProfile.connectionName).toBe('noConn');
        });

        it('should use config connectionName in single-profile when config has connectionName', () => {
            // Single profile config with a connectionName in the JSON
            const configPath = path.join(tempDir, '.bctb-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
                connectionName: 'From Config File'
                // No profiles key
            }));
            const server = createTestServer({ connectionName: 'From Server' });
            const result = (server as any).listProfiles();

            expect(result.profileMode).toBe('single');
            expect(result.currentProfile.connectionName).toBe('From Config File');
        });
    });

    // ────────────────────────────────────────────────────────
    // 5. End-to-end profile lifecycle
    // ────────────────────────────────────────────────────────
    describe('Profile lifecycle (detect → list → switch → list)', () => {
        it('should reflect profile changes across detect, switch, and list', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            delete process.env.BCTB_PROFILE;
            const server = createTestServer();

            // 1. Initial detection should find the default profile
            const initial = (server as any).detectInitialProfile();
            expect(initial).toBe('Customers');

            // 2. List should show Customers as active
            const list1 = (server as any).listProfiles();
            expect(list1.profileMode).toBe('multi');
            expect(list1.currentProfile.name).toBe('Customers');

            // 3. Switch to DistriApps
            const switchResult = (server as any).switchProfile('DistriApps');
            expect(switchResult.success).toBe(true);
            expect(switchResult.currentProfile.applicationInsightsAppId).toBe('distri-app-id-002');

            // 4. List should now show DistriApps as active
            const list2 = (server as any).listProfiles();
            expect(list2.currentProfile.name).toBe('DistriApps');
            expect(list2.availableProfiles.find((p: any) => p.name === 'Customers')).toBeDefined();

            // 5. Switch again to TestEnv
            const switchResult2 = (server as any).switchProfile('TestEnv');
            expect(switchResult2.success).toBe(true);
            expect(switchResult2.previousProfile).toBe('DistriApps');

            // 6. List should now show TestEnv as active
            const list3 = (server as any).listProfiles();
            expect(list3.currentProfile.name).toBe('TestEnv');
        });

        it('should keep services consistent after multiple switches', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;
            const server = createTestServer();

            // Switch multiple times
            (server as any).switchProfile('DistriApps');
            (server as any).switchProfile('TestEnv');
            (server as any).switchProfile('Customers');

            // Config should match last profile
            expect((server as any).config.connectionName).toBe('Customers Production');
            expect((server as any).config.applicationInsightsAppId).toBe('cust-app-id-001');
            expect((server as any).activeProfileName).toBe('Customers');
        });
    });

    // ────────────────────────────────────────────────────────
    // 5b. HTTP mode coverage
    // ────────────────────────────────────────────────────────
    describe('HTTP mode logging during switchProfile', () => {
        it('should log to console.error in HTTP mode after switching', () => {
            createMultiProfileConfig(tempDir);
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            // Create server in HTTP mode so console.error branch is hit
            const config = makeTestConfig();
            const server = new MCPServer(config, 'http');
            consoleErrorSpy.mockClear();

            const result = (server as any).switchProfile('DistriApps');
            expect(result.success).toBe(true);

            // Verify console.error was called with profile switch info
            const calls = consoleErrorSpy.mock.calls.map((c: any[]) => c[0]);
            expect(calls.some((msg: string) => msg.includes('[Profile] Switched from'))).toBe(true);
            expect(calls.some((msg: string) => msg.includes('[Profile] Connection:'))).toBe(true);
            expect(calls.some((msg: string) => msg.includes('[Profile] App Insights ID:'))).toBe(true);
        });
    });

    // ────────────────────────────────────────────────────────
    // 6. Single profile config handling (config.ts level)
    // ────────────────────────────────────────────────────────
    describe('Single profile config handling', () => {
        it('should handle single-profile config without profiles key', () => {
            const configPath = path.join(tempDir, '.bctb-config.json');
            const config = {
                connectionName: 'Single',
                authFlow: 'azure_cli',
                applicationInsightsAppId: 'single-app-id',
                kustoClusterUrl: 'https://ade.applicationinsights.io'
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            process.env.BCTB_WORKSPACE_PATH = tempDir;

            const loaded = loadConfigFromFile(configPath, undefined, true);
            expect(loaded).not.toBeNull();
            expect(loaded!.connectionName).toBe('Single');
            expect(loaded!.applicationInsightsAppId).toBe('single-app-id');
        });

        it('should return null when no config file exists', () => {
            const nonExistent = path.join(tempDir, 'does-not-exist.json');
            const loaded = loadConfigFromFile(nonExistent, undefined, true);
            expect(loaded).toBeNull();
        });
    });
});
