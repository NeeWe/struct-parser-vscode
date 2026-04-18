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
            
            // Open the main panel if not already open
            vscode.commands.executeCommand('structParser.openViewer');
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
                * { box-sizing: border-box; margin: 0; padding: 0; }
                
                body {
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sidebar-background);
                    padding: 12px;
                }
                
                .ss-container {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
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
                    padding: 6px 12px;
                    font-size: 12px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    transition: background-color 0.15s ease;
                }
                
                .ss-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .ss-search-box {
                    position: relative;
                }
                
                .ss-search-input {
                    width: 100%;
                    padding: 8px 12px;
                    padding-left: 32px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-size: 13px;
                }
                
                .ss-search-input:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                
                .ss-search-icon {
                    position: absolute;
                    left: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                
                .ss-status {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    text-align: center;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    border-radius: 4px;
                }
                
                .ss-status.success {
                    color: var(--vscode-testing-iconPassed);
                }
                
                .ss-list {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    max-height: 400px;
                    overflow-y: auto;
                }
                
                .ss-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.15s ease;
                }
                
                .ss-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .ss-item-icon {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                
                .ss-item-icon.struct { background-color: #4EC9B0; }
                .ss-item-icon.union { background-color: #C586C0; }
                
                .ss-item-name {
                    flex: 1;
                    font-weight: 500;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                
                .ss-item-bits {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    font-family: var(--vscode-editor-font-family);
                }
                
                .ss-empty {
                    text-align: center;
                    padding: 24px 16px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                }
                
                .ss-empty-icon {
                    font-size: 32px;
                    margin-bottom: 8px;
                }
            </style>
        </head>
        <body>
            <div class="ss-container">
                <div class="ss-toolbar">
                    <button id="btnImport" class="ss-btn">📂 Import</button>
                    <button id="btnRefresh" class="ss-btn">🔄 Refresh</button>
                </div>
                
                <div class="ss-search-box">
                    <span class="ss-search-icon">🔍</span>
                    <input type="text" id="searchInput" class="ss-search-input" placeholder="Search struct...">
                </div>
                
                <div id="statusText" class="ss-status ${allStructs.length > 0 ? 'success' : ''}">
                    ${allStructs.length > 0 ? '✓ ' + allStructs.length + ' structs loaded' : '⚠ No struct data'}
                </div>
                
                <div id="structList" class="ss-list">
                    ${allStructs.map(s => `
                        <div class="ss-item" data-name="${s.name.replace(/"/g, '&quot;')}">
                            <span class="ss-item-icon ${s.type}"></span>
                            <span class="ss-item-name">${s.name}</span>
                            <span class="ss-item-bits">${s.size_bits}b</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // Search functionality
                document.getElementById('searchInput').addEventListener('input', (e) => {
                    vscode.postMessage({
                        command: 'search',
                        searchTerm: e.target.value
                    });
                });
                
                // Import button
                document.getElementById('btnImport').addEventListener('click', () => {
                    vscode.postMessage({ command: 'importJson' });
                });
                
                // Refresh button
                document.getElementById('btnRefresh').addEventListener('click', () => {
                    vscode.postMessage({ command: 'refresh' });
                });
                
                // Struct selection
                document.getElementById('structList').addEventListener('click', (e) => {
                    const item = e.target.closest('.ss-item');
                    if (item) {
                        const structName = item.getAttribute('data-name');
                        vscode.postMessage({
                            command: 'selectStruct',
                            structName: structName
                        });
                    }
                });
                
                // Handle messages from extension
                window.addEventListener('message', (event) => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'searchResults':
                            updateStructList(message.results);
                            break;
                        case 'updateData':
                            updateStructList(message.structs);
                            updateStatus(message.hasData, message.structs.length);
                            break;
                    }
                });
                
                function updateStructList(structs) {
                    const list = document.getElementById('structList');
                    if (structs.length === 0) {
                        list.innerHTML = '<div class="ss-empty"><div class="ss-empty-icon">📭</div>No structs found</div>';
                        return;
                    }
                    
                    list.innerHTML = structs.map(s => 
                        '<div class="ss-item" data-name="' + s.name.replace(/"/g, '&quot;') + '">' +
                            '<span class="ss-item-icon ' + s.type + '"></span>' +
                            '<span class="ss-item-name">' + s.name + '</span>' +
                            '<span class="ss-item-bits">' + s.size_bits + 'b</span>' +
                        '</div>'
                    ).join('');
                }
                
                function updateStatus(hasData, count) {
                    const status = document.getElementById('statusText');
                    if (hasData) {
                        status.textContent = '✓ ' + count + ' structs loaded';
                        status.classList.add('success');
                    } else {
                        status.textContent = '⚠ No struct data';
                        status.classList.remove('success');
                    }
                }
            </script>
        </body>
        </html>`;
    }
}
