import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    children?: StructField[];
}

interface StructDef {
    name: string;
    type: string;
    size_bits: number;
    fields: StructField[];
}

interface StructJson {
    structs: StructDef[];
    unions: StructDef[];
}

export class StructSelectorProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'structSelector';
    
    private _view?: vscode.WebviewView;
    private _structData: StructJson | null = null;
    private _extensionUri: vscode.Uri;
    private _onStructSelected: vscode.EventEmitter<StructDef> = new vscode.EventEmitter<StructDef>();
    public readonly onStructSelected: vscode.Event<StructDef> = this._onStructSelected.event;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._loadStructData();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'search':
                    this._handleSearch(message.searchTerm);
                    break;
                case 'selectStruct':
                    this._handleSelectStruct(message.structName);
                    break;
                case 'importJson':
                    await this._handleImportJson();
                    break;
                case 'refresh':
                    this._loadStructData();
                    this._updateWebview();
                    break;
            }
        });

        // Initial data update
        this._updateWebview();
    }

    private _loadStructData() {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPath = config.get<string>('jsonPath');

        if (jsonPath && fs.existsSync(jsonPath)) {
            try {
                const content = fs.readFileSync(jsonPath, 'utf-8');
                this._structData = JSON.parse(content);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load struct JSON: ${error}`);
            }
        } else {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const possiblePaths = [
                    path.join(workspaceFolders[0].uri.fsPath, 'output.json'),
                    path.join(workspaceFolders[0].uri.fsPath, 'structs.json'),
                ];

                for (const tryPath of possiblePaths) {
                    if (fs.existsSync(tryPath)) {
                        try {
                            const content = fs.readFileSync(tryPath, 'utf-8');
                            this._structData = JSON.parse(content);
                            break;
                        } catch (error) {
                            // Continue to next path
                        }
                    }
                }
            }
        }
    }

    private _handleSearch(searchTerm: string) {
        if (!this._structData || !this._view) return;

        const allStructs = [...this._structData.structs, ...this._structData.unions];
        
        if (!searchTerm.trim()) {
            this._view.webview.postMessage({
                command: 'searchResults',
                results: allStructs.map(s => ({ name: s.name, type: s.type, size_bits: s.size_bits }))
            });
            return;
        }

        const searchLower = searchTerm.toLowerCase();
        const filtered = allStructs.filter(s => 
            s.name.toLowerCase().includes(searchLower)
        );

        this._view.webview.postMessage({
            command: 'searchResults',
            results: filtered.map(s => ({ name: s.name, type: s.type, size_bits: s.size_bits }))
        });
    }

    private _handleSelectStruct(structName: string) {
        if (!this._structData) return;

        const struct = [...this._structData.structs, ...this._structData.unions]
            .find(s => s.name === structName);

        if (struct) {
            this._onStructSelected.fire(struct);
        }
    }

    private async _handleImportJson() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON files': ['json'],
                'All files': ['*']
            },
            title: 'Select Struct Parser JSON File'
        });

        if (result && result[0]) {
            try {
                const content = fs.readFileSync(result[0].fsPath, 'utf-8');
                this._structData = JSON.parse(content);
                
                const config = vscode.workspace.getConfiguration('structParser');
                await config.update('jsonPath', result[0].fsPath, true);
                
                vscode.window.showInformationMessage(`Loaded ${this._getAllStructs().length} structs`);
                this._updateWebview();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
            }
        }
    }

    private _getAllStructs(): StructDef[] {
        if (!this._structData) return [];
        return [...this._structData.structs, ...this._structData.unions];
    }

    private _updateWebview() {
        if (!this._view) return;

        const allStructs = this._getAllStructs();
        this._view.webview.postMessage({
            command: 'updateData',
            structs: allStructs.map(s => ({ name: s.name, type: s.type, size_bits: s.size_bits })),
            hasData: allStructs.length > 0
        });
    }

    public refresh() {
        this._loadStructData();
        this._updateWebview();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const allStructs = this._getAllStructs();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Struct Selector</title>
            <style>
                :root {
                    --primary: #4EC9B0;
                    --primary-hover: #3DB8A0;
                    --primary-bg: rgba(78, 201, 176, 0.12);
                    --primary-border: rgba(78, 201, 176, 0.3);
                    --secondary: #C586C0;
                    --accent: #75BEFF;
                    --text-primary: var(--vscode-foreground);
                    --text-secondary: var(--vscode-descriptionForeground);
                    --text-muted: var(--vscode-textPreformat-foreground);
                    --bg: var(--vscode-sidebar-background);
                    --panel-bg: var(--vscode-panel-background);
                    --border: var(--vscode-panel-border);
                    --input-bg: var(--vscode-input-background);
                    --input-border: var(--vscode-input-border);
                    --hover-bg: var(--vscode-list-hoverBackground);
                    --selection-bg: var(--vscode-list-activeSelectionBackground);
                    --toolbar-hover: var(--vscode-toolbar-hoverBackground);
                    --radius-sm: 6px;
                    --radius-md: 10px;
                    --radius-lg: 14px;
                    --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.08);
                    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
                    --transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                }

                * { box-sizing: border-box; margin: 0; padding: 0; }

                body {
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    color: var(--text-primary);
                    background-color: var(--bg);
                    padding: 16px;
                }

                .ss-container {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                /* Header Card */
                .ss-header {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    padding: 16px;
                    box-shadow: var(--shadow-sm);
                }

                .ss-header-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .ss-header-icon {
                    font-size: 20px;
                }

                .ss-header-text {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .ss-toolbar {
                    display: flex;
                    gap: 8px;
                }

                .ss-btn {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    padding: 8px 12px;
                    font-size: 12px;
                    font-weight: 500;
                    border: none;
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: all var(--transition);
                    font-family: inherit;
                }

                .ss-btn-primary {
                    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
                    color: white;
                    box-shadow: 0 2px 8px rgba(78, 201, 176, 0.3);
                }

                .ss-btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(78, 201, 176, 0.4);
                }

                .ss-btn-secondary {
                    background: var(--panel-bg);
                    color: var(--text-secondary);
                    border: 1px solid var(--border);
                }

                .ss-btn-secondary:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                /* Search Card */
                .ss-search-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    padding: 12px;
                    box-shadow: var(--shadow-sm);
                }

                .ss-search {
                    position: relative;
                }

                .ss-search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 14px;
                    color: var(--text-muted);
                    pointer-events: none;
                }

                .ss-search-input {
                    width: 100%;
                    padding: 10px 36px;
                    border: 1px solid var(--input-border);
                    border-radius: var(--radius-md);
                    background: var(--input-bg);
                    color: var(--text-primary);
                    font-size: 13px;
                    transition: all var(--transition);
                }

                .ss-search-input:focus {
                    outline: none;
                    border-color: var(--primary);
                    box-shadow: 0 0 0 3px var(--primary-bg);
                }

                .ss-search-input::placeholder {
                    color: var(--text-muted);
                }

                .ss-search-clear {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    border-radius: var(--radius-sm);
                    color: var(--text-muted);
                    cursor: pointer;
                    opacity: 0;
                    transition: opacity var(--transition);
                    font-size: 12px;
                }

                .ss-search-input:not(:placeholder-shown) ~ .ss-search-clear {
                    opacity: 1;
                }

                .ss-search-clear:hover {
                    background: var(--toolbar-hover);
                    color: var(--text-primary);
                }

                /* Status Card */
                .ss-status-card {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-md);
                    font-size: 12px;
                }

                .ss-status-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .ss-status-icon {
                    font-size: 14px;
                }

                .ss-status-text {
                    color: var(--text-secondary);
                }

                .ss-status-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 22px;
                    height: 22px;
                    padding: 0 6px;
                    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
                    color: white;
                    border-radius: 9999px;
                    font-size: 11px;
                    font-weight: 600;
                }

                .ss-status-empty .ss-status-icon { color: #FFB347; }
                .ss-status-empty .ss-status-count {
                    background: var(--text-muted);
                }

                /* List Card */
                .ss-list-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    box-shadow: var(--shadow-sm);
                }

                .ss-list-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
                    border-bottom: 1px solid var(--border);
                }

                .ss-list-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .ss-list-icon {
                    font-size: 14px;
                    color: var(--primary);
                }

                .ss-list {
                    display: flex;
                    flex-direction: column;
                    max-height: 350px;
                    overflow-y: auto;
                    padding: 8px;
                }

                .ss-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 12px;
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: all var(--transition);
                    border: 1px solid transparent;
                }

                .ss-item:hover {
                    background: var(--hover-bg);
                    border-color: var(--border);
                }

                .ss-item.selected {
                    background: var(--selection-bg);
                    border-color: var(--primary-border);
                }

                .ss-item-icon {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                    box-shadow: 0 0 6px currentColor;
                }

                .ss-item-icon.struct {
                    background: linear-gradient(135deg, #4EC9B0 0%, #3DB8A0 100%);
                    color: #4EC9B0;
                }

                .ss-item-icon.union {
                    background: linear-gradient(135deg, #C586C0 0%, #B575B0 100%);
                    color: #C586C0;
                }

                .ss-item-content {
                    flex: 1;
                    min-width: 0;
                }

                .ss-item-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .ss-item-meta {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 4px;
                }

                .ss-item-type {
                    font-size: 10px;
                    font-weight: 500;
                    padding: 2px 6px;
                    border-radius: 4px;
                    text-transform: uppercase;
                }

                .ss-item-type.struct {
                    background: rgba(78, 201, 176, 0.15);
                    color: #4EC9B0;
                }

                .ss-item-type.union {
                    background: rgba(197, 134, 192, 0.15);
                    color: #C586C0;
                }

                .ss-item-bits {
                    font-size: 11px;
                    color: var(--text-muted);
                    font-family: var(--vscode-editor-font-family);
                }

                .ss-item-arrow {
                    font-size: 12px;
                    color: var(--text-muted);
                    opacity: 0;
                    transform: translateX(-4px);
                    transition: all var(--transition);
                }

                .ss-item:hover .ss-item-arrow {
                    opacity: 1;
                    transform: translateX(0);
                }

                /* Empty State */
                .ss-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 32px 16px;
                    text-align: center;
                }

                .ss-empty-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                    opacity: 0.6;
                }

                .ss-empty-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    margin-bottom: 4px;
                }

                .ss-empty-text {
                    font-size: 12px;
                    color: var(--text-muted);
                }

                /* Animations */
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .ss-item {
                    animation: fadeIn 0.2s ease;
                }

                .ss-list-item-highlight {
                    background: rgba(78, 201, 176, 0.15);
                }
            </style>
        </head>
        <body>
            <div class="ss-container">
                <div class="ss-header">
                    <div class="ss-header-title">
                        <span class="ss-header-icon">⚡</span>
                        <span class="ss-header-text">Struct Parser</span>
                    </div>
                    <div class="ss-toolbar">
                        <button id="btnImport" class="ss-btn ss-btn-primary">
                            <span>📂</span>
                            <span>Import JSON</span>
                        </button>
                        <button id="btnRefresh" class="ss-btn ss-btn-secondary">
                            <span>🔄</span>
                            <span>Refresh</span>
                        </button>
                    </div>
                </div>

                <div class="ss-search-card">
                    <div class="ss-search">
                        <span class="ss-search-icon">🔍</span>
                        <input type="text" id="searchInput" class="ss-search-input" placeholder="Search structs...">
                        <button id="clearSearch" class="ss-search-clear">✕</button>
                    </div>
                </div>

                <div id="statusCard" class="ss-status-card ${allStructs.length > 0 ? '' : 'ss-status-empty'}">
                    <div class="ss-status-info">
                        <span class="ss-status-icon">${allStructs.length > 0 ? '✓' : '⚠'}</span>
                        <span class="ss-status-text">${allStructs.length > 0 ? 'Structs loaded' : 'No struct data'}</span>
                    </div>
                    <span id="structCount" class="ss-status-count">${allStructs.length}</span>
                </div>

                <div class="ss-list-card">
                    <div class="ss-list-header">
                        <div class="ss-list-title">
                            <span class="ss-list-icon">📋</span>
                            <span>Structures</span>
                        </div>
                    </div>
                    <div id="structList" class="ss-list">
                        ${allStructs.length > 0 ? allStructs.map(s => `
                            <div class="ss-item" data-name="${s.name.replace(/"/g, '&quot;')}">
                                <span class="ss-item-icon ${s.type}"></span>
                                <div class="ss-item-content">
                                    <div class="ss-item-name">${s.name}</div>
                                    <div class="ss-item-meta">
                                        <span class="ss-item-type ${s.type}">${s.type}</span>
                                        <span class="ss-item-bits">${s.size_bits} bits</span>
                                    </div>
                                </div>
                                <span class="ss-item-arrow">›</span>
                            </div>
                        `).join('') : `
                            <div class="ss-empty">
                                <div class="ss-empty-icon">📭</div>
                                <div class="ss-empty-title">No Structs Found</div>
                                <div class="ss-empty-text">Import a JSON file to get started</div>
                            </div>
                        `}
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let allStructs = ${JSON.stringify(allStructs.map(s => ({ name: s.name, type: s.type, size_bits: s.size_bits })))};
                let selectedStruct = null;

                document.getElementById('searchInput').addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    if (term) {
                        const filtered = allStructs.filter(s => s.name.toLowerCase().includes(term));
                        updateStructList(filtered);
                    } else {
                        updateStructList(allStructs);
                    }
                });

                document.getElementById('clearSearch').addEventListener('click', () => {
                    const input = document.getElementById('searchInput');
                    input.value = '';
                    input.dispatchEvent(new Event('input'));
                    input.focus();
                });

                document.getElementById('btnImport').addEventListener('click', () => {
                    vscode.postMessage({ command: 'importJson' });
                });

                document.getElementById('btnRefresh').addEventListener('click', () => {
                    vscode.postMessage({ command: 'refresh' });
                });

                document.getElementById('structList').addEventListener('click', (e) => {
                    const item = e.target.closest('.ss-item');
                    if (item) {
                        document.querySelectorAll('.ss-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        const structName = item.getAttribute('data-name');
                        selectedStruct = structName;
                        vscode.postMessage({
                            command: 'selectStruct',
                            structName: structName
                        });
                    }
                });

                window.addEventListener('message', (event) => {
                    const message = event.data;
                    switch (message.command) {
                        case 'searchResults':
                            allStructs = message.results;
                            updateStructList(message.results);
                            updateStatus(message.results.length > 0, message.results.length);
                            break;
                        case 'updateData':
                            allStructs = message.structs;
                            updateStructList(message.structs);
                            updateStatus(message.hasData, message.structs.length);
                            break;
                    }
                });

                function updateStructList(structs) {
                    const list = document.getElementById('structList');
                    if (structs.length === 0) {
                        list.innerHTML = \`
                            <div class="ss-empty">
                                <div class="ss-empty-icon">🔍</div>
                                <div class="ss-empty-title">No Results</div>
                                <div class="ss-empty-text">Try a different search term</div>
                            </div>
                        \`;
                        return;
                    }

                    list.innerHTML = structs.map(s => \`
                        <div class="ss-item" data-name="\${s.name.replace(/"/g, '&quot;')}">
                            <span class="ss-item-icon \${s.type}"></span>
                            <div class="ss-item-content">
                                <div class="ss-item-name">\${s.name}</div>
                                <div class="ss-item-meta">
                                    <span class="ss-item-type \${s.type}">\${s.type}</span>
                                    <span class="ss-item-bits">\${s.size_bits} bits</span>
                                </div>
                            </div>
                            <span class="ss-item-arrow">›</span>
                        </div>
                    \`).join('');
                }

                function updateStatus(hasData, count) {
                    const card = document.getElementById('statusCard');
                    const icon = card.querySelector('.ss-status-icon');
                    const text = card.querySelector('.ss-status-text');
                    const countEl = document.getElementById('structCount');

                    if (hasData) {
                        card.classList.remove('ss-status-empty');
                        icon.textContent = '✓';
                        text.textContent = 'Structs loaded';
                    } else {
                        card.classList.add('ss-status-empty');
                        icon.textContent = '⚠';
                        text.textContent = 'No struct data';
                    }
                    countEl.textContent = count;
                }
            </script>
        </body>
        </html>`;
    }
}
