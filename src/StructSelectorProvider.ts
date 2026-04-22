import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    fields?: StructField[];
}

interface StructDef {
    name: string;
    type: string;
    bits: number;
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
    private _lastJsonPath: string | null = null;
    private _currentJsonConfig: string | null = null;
    private _extensionUri: vscode.Uri;
    private _onStructSelected: vscode.EventEmitter<StructDef> = new vscode.EventEmitter<StructDef>();
    public get onStructSelected(): vscode.Event<StructDef> { return this._onStructSelected.event; }

    private _hideZero: boolean = false;
    private _onHideZeroChanged: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
    public get onHideZeroChanged(): vscode.Event<boolean> { return this._onHideZeroChanged.event; }

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._loadStructData().catch(err => {
            vscode.window.showErrorMessage(`Failed to load struct data: ${err}`);
        });
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
                case 'config':
                    await this._handleConfig();
                    break;
                case 'refresh':
                    await this._loadStructData();
                    this._updateWebview();
                    break;
                case 'toggleHideZero':
                    this._hideZero = message.hideZero;
                    this._onHideZeroChanged.fire(this._hideZero);
                    break;
            }
        });

        this._updateWebview();
    }

    private async _loadStructData() {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPaths = config.get<Array<{name: string, path: string}>>('jsonPaths') || [];
        const legacyJsonPath = config.get<string>('jsonPath') || '';

        // Handle legacy config
        let jsonPath: string | null = null;
        if (jsonPaths.length > 0) {
            if (this._currentJsonConfig) {
                // Use previously selected config
                const selectedConfig = jsonPaths.find(c => c.name === this._currentJsonConfig);
                if (selectedConfig) {
                    jsonPath = selectedConfig.path;
                }
            }
            
            if (!jsonPath && jsonPaths.length === 1) {
                // Only one config, use it
                jsonPath = jsonPaths[0].path;
                this._currentJsonConfig = jsonPaths[0].name;
            }
            
            if (!jsonPath && jsonPaths.length > 1) {
                // Multiple configs, let user choose
                const items = jsonPaths.map(c => ({
                    label: c.name,
                    description: c.path,
                    path: c.path,
                    name: c.name
                }));
                
                const selected = await vscode.window.showQuickPick(items, {
                    title: 'Select Struct JSON Configuration',
                    placeHolder: 'Choose a JSON file to load'
                });
                
                if (selected) {
                    jsonPath = selected.path;
                    this._currentJsonConfig = selected.name;
                }
            }
        } else if (legacyJsonPath) {
            // Use legacy config
            jsonPath = legacyJsonPath;
        }

        // 如果配置路径没有变化，且已经有数据，直接返回，避免重复加载
        if (jsonPath === this._lastJsonPath && this._structData) {
            return;
        }

        if (jsonPath && fs.existsSync(jsonPath)) {
            try {
                const content = fs.readFileSync(jsonPath, 'utf-8');
                this._structData = JSON.parse(content);
                this._lastJsonPath = jsonPath;
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
                            this._lastJsonPath = tryPath;
                            break;
                        } catch (error) {
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
                results: allStructs.map(s => ({ name: s.type, structKind: s.type, bits: s.bits, isUnion: this._structData?.unions?.some((u: StructDef) => u.type === s.type) ?? false }))
            });
            return;
        }

        const searchLower = searchTerm.toLowerCase();
        const filtered = allStructs.filter(s => 
            s.type.toLowerCase().includes(searchLower)
        );

        this._view.webview.postMessage({
            command: 'searchResults',
            results: filtered.map(s => ({ name: s.type, structKind: s.type, bits: s.bits, isUnion: this._structData?.unions?.some((u: StructDef) => u.type === s.type) ?? false }))
        });
    }

    private _handleSelectStruct(structName: string) {
        if (!this._structData) return;

        const struct = [...this._structData.structs, ...this._structData.unions]
            .find(s => s.type === structName);

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
                this._lastJsonPath = result[0].fsPath;
                
                const config = vscode.workspace.getConfiguration('structParser');
                await config.update('jsonPath', result[0].fsPath, true);
                
                vscode.window.showInformationMessage(`Loaded ${this._getAllStructs().length} structs`);
                this._updateWebview();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
            }
        }
    }

    private async _handleConfig() {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPaths = config.get<Array<{name: string, path: string}>>('jsonPaths') || [];
        
        const action = await vscode.window.showQuickPick([
            { label: 'Add JSON Configuration', description: 'Add a new JSON file to the list' },
            { label: 'Edit JSON Configuration', description: 'Modify existing configurations' },
            { label: 'Remove JSON Configuration', description: 'Remove a configuration from the list' },
            { label: 'Clear All Configurations', description: 'Remove all configurations' },
            { label: 'Cancel', description: 'Exit without making changes' }
        ], {
            title: 'Struct Parser Configuration',
            placeHolder: 'Choose an action'
        });
        
        if (!action || action.label === 'Cancel') {
            return;
        }
        
        switch (action.label) {
            case 'Add JSON Configuration': {
                const name = await vscode.window.showInputBox({
                    title: 'Add JSON Configuration',
                    placeHolder: 'Enter a name for this configuration',
                    prompt: 'This will help you identify the JSON file later'
                });
                
                if (!name) return;
                
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'JSON files': ['json'],
                        'All files': ['*']
                    },
                    title: 'Select JSON File'
                });
                
                if (result && result[0]) {
                    const newConfig = [...jsonPaths, { name, path: result[0].fsPath }];
                    await config.update('jsonPaths', newConfig, true);
                    vscode.window.showInformationMessage(`Added configuration: ${name}`);
                    await this._loadStructData();
                    this._updateWebview();
                }
                break;
            }
            
            case 'Edit JSON Configuration': {
                if (jsonPaths.length === 0) {
                    vscode.window.showInformationMessage('No configurations to edit');
                    return;
                }
                
                const selected = await vscode.window.showQuickPick(jsonPaths.map(c => ({
                    label: c.name,
                    description: c.path,
                    config: c
                })), {
                    title: 'Edit JSON Configuration',
                    placeHolder: 'Select a configuration to edit'
                });
                
                if (!selected) return;
                
                const newName = await vscode.window.showInputBox({
                    title: 'Edit Configuration Name',
                    placeHolder: 'Enter a new name for this configuration',
                    value: selected.config.name
                });
                
                if (newName === undefined) return;
                
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'JSON files': ['json'],
                        'All files': ['*']
                    },
                    title: 'Select New JSON File',
                    defaultUri: vscode.Uri.file(selected.config.path)
                });
                
                if (result && result[0]) {
                    const updatedConfigs = jsonPaths.map(c => 
                        c.name === selected.config.name 
                            ? { name: newName || selected.config.name, path: result[0].fsPath }
                            : c
                    );
                    await config.update('jsonPaths', updatedConfigs, true);
                    vscode.window.showInformationMessage(`Updated configuration: ${newName || selected.config.name}`);
                    await this._loadStructData();
                    this._updateWebview();
                }
                break;
            }
            
            case 'Remove JSON Configuration': {
                if (jsonPaths.length === 0) {
                    vscode.window.showInformationMessage('No configurations to remove');
                    return;
                }
                
                const selected = await vscode.window.showQuickPick(jsonPaths.map(c => ({
                    label: c.name,
                    description: c.path,
                    name: c.name
                })), {
                    title: 'Remove JSON Configuration',
                    placeHolder: 'Select a configuration to remove'
                });
                
                if (!selected) return;
                
                const confirmed = await vscode.window.showInformationMessage(
                    `Are you sure you want to remove the configuration "${selected.name}"?`,
                    { modal: true },
                    'Yes',
                    'No'
                );
                
                if (confirmed === 'Yes') {
                    const updatedConfigs = jsonPaths.filter(c => c.name !== selected.name);
                    await config.update('jsonPaths', updatedConfigs, true);
                    vscode.window.showInformationMessage(`Removed configuration: ${selected.name}`);
                    await this._loadStructData();
                    this._updateWebview();
                }
                break;
            }
            
            case 'Clear All Configurations': {
                if (jsonPaths.length === 0) {
                    vscode.window.showInformationMessage('No configurations to clear');
                    return;
                }
                
                const confirmed = await vscode.window.showInformationMessage(
                    'Are you sure you want to clear all JSON configurations?',
                    { modal: true },
                    'Yes',
                    'No'
                );
                
                if (confirmed === 'Yes') {
                    await config.update('jsonPaths', [], true);
                    vscode.window.showInformationMessage('All configurations cleared');
                    await this._loadStructData();
                    this._updateWebview();
                }
                break;
            }
        }
    }

    private _getAllStructs(): StructDef[] {
        if (!this._structData) return [];
        const all = [...this._structData.structs, ...this._structData.unions];
        const seen = new Set<string>();
        return all.filter(s => {
            if (seen.has(s.type)) return false;
            seen.add(s.type);
            return true;
        });
    }

    private _updateWebview() {
        if (!this._view) return;

        const allStructs = this._getAllStructs();
        this._view.webview.postMessage({
            command: 'updateData',
            structs: allStructs.map(s => ({ name: s.type, structKind: s.type, bits: s.bits, isUnion: this._structData?.unions?.some((u: StructDef) => u.type === s.type) ?? false })),
            hasData: allStructs.length > 0
        });
    }

    public async refresh() {
        await this._loadStructData();
        this._updateWebview();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const allStructs = this._getAllStructs().map(s => ({
            name: s.type,
            structKind: s.type,
            bits: s.bits,
            isUnion: this._structData?.unions?.some((u: StructDef) => u.type === s.type) ?? false
        }));

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
                }

                .sidebar {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }

                .sidebar-header {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sidebar-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    color: var(--vscode-descriptionForeground);
                }

                .sidebar-search {
                    padding: 8px 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }

                .search-box {
                    position: relative;
                }

                .search-box svg {
                    position: absolute;
                    left: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--vscode-descriptionForeground);
                    width: 14px;
                    height: 14px;
                }

                .search-input {
                    width: 100%;
                    padding: 6px 8px 6px 28px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-size: 12px;
                    outline: none;
                    transition: border-color 0.15s;
                    font-family: var(--vscode-font-family);
                }

                .search-input:focus {
                    border-color: #4EC9B0;
                }

                .search-input::placeholder {
                    color: var(--vscode-input-placeholderForeground);
                }

                .sidebar-toolbar {
                    padding: 6px 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 6px;
                }

                .toolbar-btn {
                    flex: 1;
                    padding: 5px 8px;
                    font-size: 11px;
                    font-weight: 500;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    background: transparent;
                    color: var(--vscode-descriptionForeground);
                    cursor: pointer;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    font-family: var(--vscode-font-family);
                }

                .toolbar-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                    color: var(--vscode-foreground);
                }

                .toolbar-btn.active {
                    background: rgba(78, 201, 176, 0.15);
                    color: #4EC9B0;
                    border-color: rgba(78, 201, 176, 0.3);
                }

                .struct-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 4px 0;
                }

                .struct-list::-webkit-scrollbar {
                    width: 6px;
                }

                .struct-list::-webkit-scrollbar-thumb {
                    background: var(--vscode-scrollbarSlider-background);
                    border-radius: 3px;
                }

                .struct-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 16px;
                    cursor: pointer;
                    transition: background 0.1s;
                    border-left: 2px solid transparent;
                }

                .struct-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .struct-item.selected {
                    background: var(--vscode-list-activeSelectionBackground);
                    border-left-color: #4EC9B0;
                }

                .struct-item.selected .struct-item-name {
                    color: var(--vscode-foreground);
                }

                .struct-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }

                .struct-dot.struct { background: #4EC9B0; }
                .struct-dot.union { background: #C586C0; }

                .struct-item-content {
                    flex: 1;
                    min-width: 0;
                }

                .struct-item-name {
                    font-size: 13px;
                    color: var(--vscode-foreground);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .struct-item-meta {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 1px;
                }

                .struct-item-badge {
                    font-size: 9px;
                    font-weight: 600;
                    padding: 1px 5px;
                    border-radius: 3px;
                    text-transform: uppercase;
                    flex-shrink: 0;
                }

                .struct-item-badge.struct {
                    background: rgba(78, 201, 176, 0.15);
                    color: #4EC9B0;
                }

                .struct-item-badge.union {
                    background: rgba(197, 134, 192, 0.15);
                    color: #C586C0;
                }

                .sidebar-footer {
                    padding: 8px 12px;
                    border-top: 1px solid var(--vscode-panel-border);
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .sidebar-count {
                    background: var(--vscode-input-background);
                    padding: 1px 8px;
                    border-radius: 10px;
                    font-size: 10px;
                    font-weight: 600;
                    color: var(--vscode-descriptionForeground);
                }

                .empty-state {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 20px;
                    text-align: center;
                }

                .empty-icon {
                    font-size: 36px;
                    margin-bottom: 12px;
                    opacity: 0.5;
                }

                .empty-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 6px;
                }

                .empty-text {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    max-width: 200px;
                    line-height: 1.5;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .struct-item { animation: fadeIn 0.15s ease; }
            </style>
        </head>
        <body>
            <div class="sidebar">
                <div class="sidebar-header">
                    <span class="sidebar-title">Struct Parser</span>
                </div>

                <div class="sidebar-search">
                    <div class="search-box">
                        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/></svg>
                        <input type="text" class="search-input" placeholder="Search structs..." id="searchInput">
                    </div>
                </div>

                <div class="sidebar-toolbar">
                    <button class="toolbar-btn" id="hideZeroBtn">
                        <span>\uD83D\uDC41</span> Hide Zero
                    </button>
                    <button class="toolbar-btn" id="importJsonBtn">
                        <span>\uD83D\uDCE4</span> Import
                    </button>
                    <button class="toolbar-btn" id="configBtn">
                        <span>\u2699</span> Config
                    </button>
                </div>

                <div class="struct-list" id="structList">
                    ${allStructs.length > 0 ? allStructs.map(s => `
                        <div class="struct-item" data-name="${s.structKind.replace(/"/g, '&quot;')}" data-is-union="${s.isUnion}">
                            <span class="struct-dot ${s.isUnion ? 'union' : 'struct'}"></span>
                            <div class="struct-item-content">
                                <div class="struct-item-name">${s.structKind}</div>
                                <div class="struct-item-meta">${s.bits} bits · ${Math.ceil(s.bits / 8)} bytes</div>
                            </div>
                            <span class="struct-item-badge ${s.isUnion ? 'union' : 'struct'}">${s.isUnion ? 'union' : 'struct'}</span>
                        </div>
                    `).join('') : `
                        <div class="empty-state">
                            <div class="empty-icon">\uD83D\uDCE5</div>
                            <div class="empty-title">No Structs Found</div>
                            <div class="empty-text">Import a JSON file to get started</div>
                        </div>
                    `}
                </div>

                <div class="sidebar-footer">
                    <span>Structs loaded</span>
                    <span class="sidebar-count" id="structCount">${allStructs.length}</span>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let allStructs = ${JSON.stringify(allStructs)};
                let selectedStruct = null;
                let hideZero = false;

                document.getElementById('searchInput').addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    if (term) {
                        const filtered = allStructs.filter(s => s.structKind.toLowerCase().includes(term));
                        updateStructList(filtered);
                    } else {
                        updateStructList(allStructs);
                    }
                });

                document.getElementById('hideZeroBtn').addEventListener('click', () => {
                    hideZero = !hideZero;
                    const btn = document.getElementById('hideZeroBtn');
                    btn.classList.toggle('active', hideZero);
                    vscode.postMessage({ command: 'toggleHideZero', hideZero });
                });

                document.getElementById('importJsonBtn').addEventListener('click', () => {
                    vscode.postMessage({ command: 'importJson' });
                });

                document.getElementById('configBtn').addEventListener('click', () => {
                    vscode.postMessage({ command: 'config' });
                });

                document.getElementById('structList').addEventListener('click', (e) => {
                    const item = e.target.closest('.struct-item');
                    if (item) {
                        document.querySelectorAll('.struct-item').forEach(el => el.classList.remove('selected'));
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
                            break;
                        case 'updateData':
                            allStructs = message.structs;
                            updateStructList(message.structs);
                            const countEl = document.getElementById('structCount');
                            if (countEl) countEl.textContent = message.structs.length;
                            break;
                    }
                });

                function updateStructList(structs) {
                    const list = document.getElementById('structList');
                    const countEl = document.getElementById('structCount');
                    if (!list) return;

                    if (structs.length === 0) {
                        list.innerHTML = \`
                            <div class="empty-state">
                                <div class="empty-icon">\uD83D\uDD0D</div>
                                <div class="empty-title">No Results</div>
                                <div class="empty-text">Try a different search term</div>
                            </div>
                        \`;
                        if (countEl) countEl.textContent = '0';
                        return;
                    }

                    list.innerHTML = structs.map(s => \`
                        <div class="struct-item \${selectedStruct === s.structKind ? 'selected' : ''}" data-name="\${s.structKind.replace(/"/g, '&quot;')}" data-is-union="\${s.isUnion}">
                            <span class="struct-dot \${s.isUnion ? 'union' : 'struct'}"></span>
                            <div class="struct-item-content">
                                <div class="struct-item-name">\${s.structKind}</div>
                                <div class="struct-item-meta">\${s.bits} bits · \${Math.ceil(s.bits / 8)} bytes</div>
                            </div>
                            <span class="struct-item-badge \${s.isUnion ? 'union' : 'struct'}">\${s.isUnion ? 'union' : 'struct'}</span>
                        </div>
                    \`).join('');
                    if (countEl) countEl.textContent = structs.length;
                }
            </script>
        </body>
        </html>`;
    }
}
