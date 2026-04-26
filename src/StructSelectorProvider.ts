import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getStructSets, saveStructSet, deleteStructSet, getActiveStructSetName, setActiveStructSet, getActiveStructData } from './dataManager';

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

    private _onBitVisChanged: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
    public get onBitVisChanged(): vscode.Event<boolean> { return this._onBitVisChanged.event; }

    private _onStructSetChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public get onStructSetChanged(): vscode.Event<void> { return this._onStructSetChanged.event; }

    private _context: vscode.ExtensionContext;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
        this._loadStructData().catch(err => {
            vscode.window.showErrorMessage(`Failed to load struct data: ${err}`);
        });
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        const opts: any = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        opts.retainContextWhenHidden = true;
        webviewView.webview.options = opts;

        await this._loadStructData();
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'search':
                    this._handleSearch(message.searchTerm);
                    break;
                case 'selectStruct':
                    this._handleSelectStruct(message.structName);
                    break;
                case 'showImportMenu':
                    await this._handleShowImportMenu();
                    break;
                case 'selectStructSet':
                    await this._handleSelectStructSet(message.setName);
                    break;
                case 'clearCache':
                    await this._handleClearCache();
                    break;
                case 'refresh':
                    await this._loadStructData();
                    this._updateWebview();
                    break;
                case 'toggleHideZero':
                    this._hideZero = message.hideZero;
                    this._onHideZeroChanged.fire(this._hideZero);
                    break;
                case 'toggleBitVis':
                    this._onBitVisChanged.fire(message.showBitVis);
                    break;
            }
        });

        this._updateWebview();
    }

    private async _loadStructData() {
        // 1. Try cached struct sets first (globalState)
        const cachedData = getActiveStructData(this._context);
        if (cachedData) {
            this._structData = cachedData;
            return;
        }

        // 2. Fall back to workspace configuration
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
                const data = JSON.parse(content);
                this._structData = data;
                this._lastJsonPath = result[0].fsPath;
                
                // Prompt for a name to save to cache
                const defaultName = path.basename(result[0].fsPath, '.json');
                const setName = await vscode.window.showInputBox({
                    title: 'Save Struct Set',
                    placeHolder: 'Enter a name for this struct set',
                    value: defaultName,
                    prompt: 'This name will be used to identify the struct set in the cache'
                });
                
                if (setName) {
                    saveStructSet(this._context, setName, data, result[0].fsPath);
                    setActiveStructSet(this._context, setName);
                    vscode.window.showInformationMessage(`Saved struct set "${setName}" with ${this._getAllStructs().length} structs`);
                }
                
                this._onStructSetChanged.fire();
                this._updateWebview();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
            }
        }
    }

    private async _handleShowImportMenu() {
        const choice = await vscode.window.showQuickPick([
            { label: '$(file-code) Import from JSON file', description: 'Load a previously exported struct JSON file', value: 'json' },
            { label: '$(terminal) Parse from command.txt', description: 'Parse C structs from a command.txt file', value: 'command' }
        ], {
            title: 'Import Struct Data',
            placeHolder: 'Choose an import source'
        });

        if (!choice) return;

        if (choice.value === 'json') {
            await this._handleImportJson();
        } else if (choice.value === 'command') {
            await vscode.commands.executeCommand('structParser.parseFromCommandTxt');
        }
    }

    private async _handleClearCache() {
        const sets = getStructSets(this._context);
        if (sets.length === 0) {
            vscode.window.showInformationMessage('No cached struct sets to clear');
            return;
        }
        const confirmed = await vscode.window.showInformationMessage(
            `Clear all ${sets.length} cached struct sets?`,
            { modal: true },
            'Yes',
            'No'
        );
        if (confirmed === 'Yes') {
            await this._context.globalState.update('structParser.structSets', undefined);
            await this._context.globalState.update('structParser.activeStructSet', undefined);
            this._structData = null;
            this._onStructSetChanged.fire();
            this._updateWebview();
            vscode.window.showInformationMessage('All cached struct sets cleared');
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

    private async _handleSelectConfig(configName: string) {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPaths = config.get<Array<{name: string, path: string}>>('jsonPaths') || [];
        
        const selectedConfig = jsonPaths.find(c => c.name === configName);
        if (selectedConfig) {
            this._currentJsonConfig = configName;
            await this._loadStructData();
            this._updateWebview();
        }
    }

    private async _handleSelectStructSet(setName: string) {
        const sets = getStructSets(this._context);
        const selected = sets.find(s => s.name === setName);
        if (selected) {
            this._structData = selected.data;
            setActiveStructSet(this._context, setName);
            this._onStructSetChanged.fire();
            this._updateWebview();
        }
    }

    private async _handleDeleteStructSet(setName: string) {
        const confirmed = await vscode.window.showInformationMessage(
            `Delete cached struct set "${setName}"?`,
            { modal: true },
            'Yes',
            'No'
        );
        if (confirmed === 'Yes') {
            deleteStructSet(this._context, setName);
            // If we deleted the active set, reload
            const activeName = getActiveStructSetName(this._context);
            if (!activeName) {
                this._structData = null;
            }
            this._onStructSetChanged.fire();
            this._updateWebview();
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

    private _getJsonConfigs(): Array<{name: string, path: string}> {
        const config = vscode.workspace.getConfiguration('structParser');
        return config.get<Array<{name: string, path: string}>>('jsonPaths') || [];
    }

    private _updateWebview() {
        if (!this._view) return;

        const allStructs = this._getAllStructs();
        const structSets = getStructSets(this._context);
        const activeSetName = getActiveStructSetName(this._context);
        this._view.webview.postMessage({
            command: 'updateData',
            structs: allStructs.map(s => ({ name: s.type, structKind: s.type, bits: s.bits, isUnion: this._structData?.unions?.some((u: StructDef) => u.type === s.type) ?? false })),
            hasData: allStructs.length > 0,
            structSets: structSets.map(s => ({ name: s.name, importedAt: s.importedAt })),
            activeSetName: activeSetName || ''
        });
    }


    public async loadFromPath(jsonPath: string) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf-8');
            this._structData = JSON.parse(content);
            this._lastJsonPath = jsonPath;
            this._updateWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
        }
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

                .current-config {
                    font-size: 10px;
                    color: var(--vscode-descriptionForeground);
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 2px 8px;
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
                    gap: 4px;
                    flex-wrap: wrap;
                }

                .toolbar-btn {
                    flex: 1;
                    min-width: 0;
                    padding: 4px 6px;
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
                    gap: 3px;
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

                .config-select {
                    padding: 4px 8px;
                    font-size: 11px;
                    font-weight: 500;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    min-width: 80px;
                    max-width: 140px;
                    flex: 1;
                }

                .config-select:focus {
                    outline: 1px solid var(--vscode-focusBorder);
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
                    gap: 10px;
                    padding: 7px 16px;
                    cursor: pointer;
                    transition: background 0.12s, border-color 0.12s;
                    border-left: 3px solid transparent;
                    position: relative;
                }

                .struct-item::after {
                    content: '';
                    position: absolute;
                    left: 16px;
                    right: 16px;
                    bottom: 0;
                    height: 1px;
                    background: var(--vscode-panel-border);
                    opacity: 0.4;
                }

                .struct-item:last-child::after {
                    display: none;
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
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                    position: relative;
                }

                .struct-dot.struct { background: #4EC9B0; }
                .struct-dot.union { background: #C586C0; }

                .struct-dot.struct::after, .struct-dot.union::after {
                    content: '';
                    position: absolute;
                    top: -3px;
                    left: -3px;
                    right: -3px;
                    bottom: -3px;
                    border-radius: 50%;
                    opacity: 0.2;
                }

                .struct-dot.struct::after { background: #4EC9B0; }
                .struct-dot.union::after { background: #C586C0; }

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
                    font-weight: 500;
                }

                .struct-item.selected .struct-item-name {
                    color: var(--vscode-foreground);
                }

                .struct-item-meta {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 1px;
                }

                .struct-item-badge {
                    font-size: 9px;
                    font-weight: 600;
                    padding: 2px 6px;
                    border-radius: 3px;
                    text-transform: uppercase;
                    flex-shrink: 0;
                    letter-spacing: 0.3px;
                }

                .struct-item-badge.struct {
                    background: rgba(78, 201, 176, 0.12);
                    color: #4EC9B0;
                }

                .struct-item-badge.union {
                    background: rgba(197, 134, 192, 0.12);
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
                    padding: 2px 10px;
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
                    opacity: 0.4;
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
                    from { opacity: 0; transform: translateY(2px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .struct-item { animation: fadeIn 0.2s ease; }

                .pagination {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 6px 12px;
                    border-top: 1px solid var(--vscode-panel-border);
                    font-size: 11px;
                    background: var(--vscode-sidebar-background);
                }

                .page-btn {
                    background: transparent;
                    border: 1px solid var(--vscode-panel-border);
                    color: var(--vscode-foreground);
                    padding: 2px 10px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    font-family: var(--vscode-font-family);
                }

                .page-btn:hover:not(:disabled) {
                    background: var(--vscode-list-hoverBackground);
                }

                .page-btn:disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }

                .page-info {
                    color: var(--vscode-descriptionForeground);
                    min-width: 60px;
                    text-align: center;
                }
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
                    <button class="toolbar-btn" id="hideZeroBtn" title="Hide zero-value fields">
                        <span>👁</span> Hide Zero
                    </button>
                    <button class="toolbar-btn active" id="bitvisBtn" title="Toggle bit visualization">
                        <span>📊</span> BitView
                    </button>
                    <button class="toolbar-btn" id="importBtn" title="Import struct data">
                        <span>📥</span> Import
                    </button>
                    <select class="config-select" id="structSetSelect" title="Switch between cached struct sets" style="max-width: 160px;">
                        <option value="">Select set...</option>
                        ${getStructSets(this._context).map(set => `
                            <option value="${set.name}" ${getActiveStructSetName(this._context) === set.name ? 'selected' : ''}>${set.name}</option>
                        `).join('')}
                    </select>
                    <button class="toolbar-btn" id="clearCacheBtn" title="Clear all cached struct sets" style="flex:0; padding: 4px 8px;">
                        <span>🗑</span>
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
                            <div class="empty-icon">📂</div>
                            <div class="empty-title">No Structs Found</div>
                            <div class="empty-text">Import a JSON file to get started</div>
                        </div>
                    `}
                </div>

                <div class="pagination" id="pagination">
                    <button class="page-btn" id="prevPage">◀</button>
                    <span class="page-info" id="pageInfo">1 / 1</span>
                    <button class="page-btn" id="nextPage">▶</button>
                </div>

                <div class="sidebar-footer">
                    <span>Structs</span>
                    <span class="sidebar-count" id="structCount">${allStructs.length}</span>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let allStructs = ${JSON.stringify(allStructs)};
                let selectedStruct = null;
                let hideZero = false;
                let showBitVis = true;
                const PAGE_SIZE = 100;
                let currentPage = 1;
                let currentDisplayStructs = [];

                document.getElementById('bitvisBtn').addEventListener('click', () => {
                    showBitVis = !showBitVis;
                    const btn = document.getElementById('bitvisBtn');
                    btn.classList.toggle('active', showBitVis);
                    vscode.postMessage({ command: 'toggleBitVis', showBitVis });
                });

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

                document.getElementById('importBtn').addEventListener('click', () => {
                    vscode.postMessage({ command: 'showImportMenu' });
                });

                document.getElementById('structSetSelect').addEventListener('change', (e) => {
                    const select = e.target;
                    const setName = select.value;
                    if (setName) {
                        vscode.postMessage({ command: 'selectStructSet', setName });
                    }
                });

                document.getElementById('clearCacheBtn').addEventListener('click', () => {
                    vscode.postMessage({ command: 'clearCache' });
                });

                document.getElementById('prevPage').addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        renderPage();
                    }
                });

                document.getElementById('nextPage').addEventListener('click', () => {
                    const totalPages = Math.ceil(currentDisplayStructs.length / PAGE_SIZE) || 1;
                    if (currentPage < totalPages) {
                        currentPage++;
                        renderPage();
                    }
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
                            // Update struct set selector
                            const setSelect = document.getElementById('structSetSelect');
                            if (setSelect && message.structSets) {
                                let html = '<option value="">Select set...</option>';
                                message.structSets.forEach(set => {
                                    const selected = set.name === message.activeSetName ? 'selected' : '';
                                    html += \`<option value="\${set.name}" \${selected}>\${set.name}</option>\`;
                                });
                                setSelect.innerHTML = html;
                                // Always sync to the active set name from backend
                                if (message.activeSetName) {
                                    setSelect.value = message.activeSetName;
                                }
                            }
                            break;
                    }
                });

                function updateStructList(structs) {
                    currentDisplayStructs = structs;
                    currentPage = 1;
                    renderPage();
                }

                function renderPage() {
                    const list = document.getElementById('structList');
                    const countEl = document.getElementById('structCount');
                    const pageInfo = document.getElementById('pageInfo');
                    const prevBtn = document.getElementById('prevPage');
                    const nextBtn = document.getElementById('nextPage');
                    if (!list) return;

                    const total = currentDisplayStructs.length;
                    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
                    const start = (currentPage - 1) * PAGE_SIZE;
                    const end = Math.min(start + PAGE_SIZE, total);
                    const pageData = currentDisplayStructs.slice(start, end);

                    if (pageInfo) pageInfo.textContent = totalPages <= 1 ? '' : \`\${currentPage} / \${totalPages}\`;
                    if (prevBtn) prevBtn.disabled = currentPage <= 1;
                    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                    if (total === 0) {
                        list.innerHTML = \`
                            <div class="empty-state">
                                <div class="empty-icon">🔍</div>
                                <div class="empty-title">No Results</div>
                                <div class="empty-text">Try a different search term</div>
                            </div>
                        \`;
                        if (countEl) countEl.textContent = '0';
                        return;
                    }

                    list.innerHTML = pageData.map(s => \`
                        <div class="struct-item \${selectedStruct === s.structKind ? 'selected' : ''}" data-name="\${s.structKind.replace(/"/g, '&quot;')}" data-is-union="\${s.isUnion}">
                            <span class="struct-dot \${s.isUnion ? 'union' : 'struct'}"></span>
                            <div class="struct-item-content">
                                <div class="struct-item-name">\${s.structKind}</div>
                                <div class="struct-item-meta">\${s.bits} bits · \${Math.ceil(s.bits / 8)} bytes</div>
                            </div>
                            <span class="struct-item-badge \${s.isUnion ? 'union' : 'struct'}">\${s.isUnion ? 'union' : 'struct'}</span>
                        </div>
                    \`).join('');
                    if (countEl) countEl.textContent = total;
                }
            </script>
        </body>
        </html>`;
    }
}
