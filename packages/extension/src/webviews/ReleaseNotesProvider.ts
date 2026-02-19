import * as vscode from 'vscode';
import * as path from 'path';

export class ReleaseNotesProvider {
    public static currentPanel: ReleaseNotesProvider | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _hasWorkspace: boolean;
    private _disposables: vscode.Disposable[] = [];

    public static readonly viewType = 'bcTelemetryBuddyReleaseNotes';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, hasWorkspace: boolean = false) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._hasWorkspace = hasWorkspace;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, hasWorkspace: boolean = false) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (ReleaseNotesProvider.currentPanel) {
            ReleaseNotesProvider.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            ReleaseNotesProvider.viewType,
            'Note from waldo',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'images')
                ]
            }
        );

        ReleaseNotesProvider.currentPanel = new ReleaseNotesProvider(panel, extensionUri, hasWorkspace);
    }

    public dispose() {
        ReleaseNotesProvider.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to logo image
        const logoPath = vscode.Uri.joinPath(this._extensionUri, 'images', 'waldo.png');
        const logoUri = webview.asWebviewUri(logoPath);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Note from waldo</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 20px;
            background: var(--vscode-sideBar-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
        }
        .logo {
            width: 80px;
            height: 80px;
            margin-bottom: 15px;
            border-radius: 50%;
        }
        h1 {
            margin: 0 0 5px 0;
            font-size: 18px;
            font-weight: 400;
            color: var(--vscode-descriptionForeground);
        }
        .version {
            font-size: 24px;
            color: var(--vscode-foreground);
            font-weight: 600;
        }
        .section {
            margin-bottom: 30px;
            padding: 25px;
            background: var(--vscode-sideBar-background);
            border-radius: 6px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        h2 {
            margin-top: 0;
            font-size: 20px;
            color: var(--vscode-textLink-foreground);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .emoji {
            font-size: 24px;
        }
        ul {
            margin: 15px 0;
            padding-left: 25px;
        }
        li {
            margin: 8px 0;
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        .highlight {
            background: var(--vscode-editor-selectionBackground);
            padding: 15px;
            border-radius: 4px;
            margin: 15px 0;
            border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground);
        }
        .steps {
            counter-reset: step-counter;
            list-style: none;
            padding-left: 0;
        }
        .steps li {
            counter-increment: step-counter;
            margin: 15px 0;
            padding-left: 35px;
            position: relative;
        }
        .steps li::before {
            content: counter(step-counter);
            position: absolute;
            left: 0;
            top: 0;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 12px;
        }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${logoUri}" alt="waldo" class="logo">
            <h1>Note from waldo</h1>
            <p class="version">BC Telemetry Buddy v3.0.0</p>
        </div>

        <div class="section">
            <h2><span class="emoji">🎉</span> Version 3.0.0 — Aligned & Upgraded!</h2>
            <p>BC Telemetry Buddy v3.0.0 brings a major protocol upgrade and version alignment between the Extension and MCP server. Both are now v3.0.0 — no more version confusion!</p>
        </div>

        <div class="section">
            <h2><span class="emoji">🔄</span> What's New in v3.0.0</h2>
            
            <h3 style="margin-top: 20px; margin-bottom: 10px;">🚀 MCP Protocol Upgrade (2025-06-18)</h3>
            <p>The MCP server now uses the <strong>official Model Context Protocol SDK</strong>, bringing full compatibility with the latest MCP specification:</p>
            <ul>
                <li><strong>Official SDK</strong>: Adopted <code>@modelcontextprotocol/sdk</code> v1.26.0 — the same SDK used by Anthropic's reference implementations</li>
                <li><strong>Protocol 2025-06-18</strong>: Latest MCP specification with tool annotations, logging capabilities, and proper capability negotiation</li>
                <li><strong>Universal Compatibility</strong>: Works with Claude Code, Claude Desktop, Cursor, GitHub Copilot, and all MCP-compliant clients</li>
                <li><strong>Tool Annotations</strong>: Each tool now declares hints like <code>readOnlyHint</code>, <code>destructiveHint</code>, and <code>openWorldHint</code> — helping AI agents make smarter decisions</li>
            </ul>

            <h3 style="margin-top: 20px; margin-bottom: 10px;">🤖 Smarter Chat Participant</h3>
            <p>The <code>@bc-telemetry-buddy</code> chat participant is now model-agnostic:</p>
            <ul>
                <li><strong>Any Copilot Model</strong>: Works with GPT-4o, Claude, and any future models — no more "No GitHub Copilot model available" errors</li>
                <li><strong>Automatic Model Detection</strong>: Uses whatever model you're already chatting with</li>
            </ul>

            <h3 style="margin-top: 20px; margin-bottom: 10px;">🏗️ Cleaner Architecture</h3>
            <p>Under the hood, the codebase is significantly cleaner:</p>
            <ul>
                <li><strong>Single Source of Truth</strong>: All 13 tool definitions in one place — no more triple duplication</li>
                <li><strong>713 Lines Removed</strong>: Dead hand-rolled JSON-RPC code eliminated</li>
                <li><strong>Version Alignment</strong>: Extension and MCP now share the same major version number</li>
            </ul>

            <h3 style="margin-top: 20px; margin-bottom: 10px;">📦 Upgrade the MCP Server</h3>
            <div class="highlight">
                <p><strong>⚠️ Important:</strong> After updating the extension, also update the MCP server:</p>
                <p><code>npm install -g bc-telemetry-buddy-mcp@latest</code></p>
                <p>Or use the Setup Wizard: <code>BC Telemetry Buddy: Setup Wizard</code></p>
            </div>
        </div>

        <div class="section">
            <h2><span class="emoji">⚡</span> ${this._hasWorkspace ? 'Getting Started (2 Simple Steps)' : 'Quick Start (3 Simple Steps)'}</h2>
            <div class="highlight">
                <p><strong>The MCP server needs to be installed separately now!</strong></p>
            </div>
            ${this._hasWorkspace ? `
            <p>Good news! You already have a workspace open. Here's how to get started:</p>
            <div class="highlight">
                <p><strong>⚠️ Important:</strong> If this workspace has old BC Telemetry Buddy settings (<code>bcTelemetryBuddy.*</code> in <code>.vscode/settings.json</code>), you'll see an automatic migration prompt when detected.</p>
            </div>
            <ol class="steps">
                <li>
                    <strong>Run the Setup Wizard</strong><br>
                    Open Command Palette (<code>Ctrl+Shift+P</code>) and run:<br>
                    <code>BC Telemetry Buddy: Setup Wizard</code><br>
                    <em style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">The wizard will guide you through installing the MCP server and configuring your connection. If old settings are detected, migration happens automatically.</em>
                </li>
                <li>
                    <strong>Follow the wizard steps</strong><br>
                    The wizard will:
                    <ul style="margin-top: 8px;">
                        <li>Install <code>bc-telemetry-buddy-mcp</code> from NPM</li>
                        <li>Configure your Azure credentials</li>
                        <li>Optionally install GitHub Copilot chatmodes</li>
                    </ul>
                </li>
            </ol>
            ` : `
            <ol class="steps">
                <li>
                    <strong>Open a workspace folder</strong><br>
                    <code>File → Open Folder</code> (single-folder workspaces only)
                </li>
                <li>
                    <strong>Run the Setup Wizard</strong><br>
                    Open Command Palette (<code>Ctrl+Shift+P</code>) and run:<br>
                    <code>BC Telemetry Buddy: Setup Wizard</code>
                </li>
                <li>
                    <strong>Install the MCP server</strong><br>
                    The Setup Wizard will guide you through installing <code>bc-telemetry-buddy-mcp</code> from NPM and configuring your connection
                </li>
            </ol>
            `}
        </div>

        <div class="section">
            <h2><span class="emoji">📚</span> Resources</h2>
            <ul>
                <li><a href="https://github.com/waldo1001/waldo.BCTelemetryBuddy#readme">Documentation</a> - Full user guide and setup instructions</li>
                <li><a href="https://www.npmjs.com/package/bc-telemetry-buddy-mcp">MCP Package</a> - View the MCP server on NPM</li>
                <li><a href="https://github.com/waldo1001/waldo.BCTelemetryBuddy/issues">Report Issues</a> - Found a bug? Let me know!</li>
            </ul>
        </div>

        <div class="footer">
            <p>Happy telemetry querying! 🚀</p>
            <p style="font-size: 12px; margin-top: 10px;">- waldo</p>
        </div>
    </div>
</body>
</html>`;
    }
}
