import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    value?: number;
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

interface ParsedField extends StructField {
    binary: string;
    value: number;
    hex: string;
    fullHexValue: string;
}

interface HistoryItem {
    timestamp: number;
    structName: string;
    hexValue: string;
    description?: string;
}

export class StructParserPanel {
    public static currentPanel: StructParserPanel | undefined;
    public static readonly viewType = 'structParser';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _structData: StructJson | null = null;
    private _currentParsedData: {
        struct: StructDef;
        fields: ParsedField[];
        hexValue: string;
        binaryValue: string;
    } | null = null;
    private _history: HistoryItem[] = [];

    public static createOrShow(extensionUri: vscode.Uri): StructParserPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (StructParserPanel.currentPanel) {
            StructParserPanel.currentPanel._panel.reveal(column);
            return StructParserPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            StructParserPanel.viewType,
            'Struct Parser',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        StructParserPanel.currentPanel = new StructParserPanel(panel, extensionUri);
        return StructParserPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._loadHistory();
        this._loadStructData();
        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                console.log('[StructParser] Received message:', message.command, message);
                switch (message.command) {
                    case 'parse':
                        this._parseHexValue(message.hexValue, message.structName);
                        return;
                    case 'updateField':
                        this._updateFieldValue(message.fieldPath, message.newValue);
                        return;
                    case 'search':
                        this._searchFields(message.searchTerm);
                        return;
                    case 'importJson':
                        await this._importJsonFile();
                        return;
                    case 'export':
                        this._exportResults(message.format);
                        return;
                    case 'copy':
                        this._copyToClipboard(message.text);
                        return;
                    case 'loadHistory':
                        this._loadHistoryItem(message.index);
                        return;
                    case 'clearHistory':
                        this._clearHistory();
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private _loadHistory() {
        const config = vscode.workspace.getConfiguration('structParser');
        this._history = config.get<HistoryItem[]>('history') || [];
    }

    private _saveHistory() {
        const config = vscode.workspace.getConfiguration('structParser');
        config.update('history', this._history.slice(0, 20), true);
    }

    private _addHistoryItem(structName: string, hexValue: string) {
        const item: HistoryItem = {
            timestamp: Date.now(),
            structName,
            hexValue,
            description: `${structName} = 0x${hexValue}`
        };
        this._history.unshift(item);
        if (this._history.length > 20) {
            this._history = this._history.slice(0, 20);
        }
        this._saveHistory();
    }

    private _clearHistory() {
        this._history = [];
        this._saveHistory();
        this._panel.webview.postMessage({ command: 'historyCleared' });
    }

    private _loadHistoryItem(index: number) {
        const item = this._history[index];
        if (item) {
            this._panel.webview.postMessage({
                command: 'loadHistoryItem',
                structName: item.structName,
                hexValue: item.hexValue
            });
        }
    }

    private async _importJsonFile() {
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
                
                if (!this._structData) {
                    vscode.window.showErrorMessage('Invalid JSON format');
                    return;
                }
                
                const structNames = [...this._structData.structs, ...this._structData.unions].map(s => s.name);
                
                this._panel.webview.postMessage({
                    command: 'jsonImported',
                    structNames: structNames,
                    filePath: result[0].fsPath
                });
                
                vscode.window.showInformationMessage(`Loaded ${structNames.length} structs from ${path.basename(result[0].fsPath)}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
            }
        }
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

    private _parseHexValue(hexValue: string, structName: string) {
        console.log('[StructParser] Parse called:', { hexValue, structName });
        
        if (!this._structData) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: 'No struct data loaded. Please configure structParser.jsonPath in settings.'
            });
            return;
        }

        const structDef = this._structData.structs.find(s => s.name === structName) ||
                         this._structData.unions.find(s => s.name === structName);

        if (!structDef) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: `Struct '${structName}' not found`
            });
            return;
        }

        const hexClean = hexValue.replace(/^0x/i, '');
        let fullValue = BigInt('0x' + hexClean);
        
        const maxValue = (BigInt(1) << BigInt(structDef.size_bits)) - BigInt(1);
        
        if (fullValue > maxValue) {
            fullValue = fullValue & maxValue;
        }
        
        const binaryValue = fullValue.toString(2).padStart(structDef.size_bits, '0');

        const parsedFields = this._parseFields(structDef.fields, binaryValue, fullValue, structDef.size_bits);

        this._currentParsedData = {
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            binaryValue: binaryValue
        };

        this._addHistoryItem(structName, hexValue);

        this._panel.webview.postMessage({
            command: 'parseResult',
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            binaryValue: binaryValue,
            fullHexValue: '0x' + fullValue.toString(16).toUpperCase().padStart(Math.ceil(structDef.size_bits / 4), '0'),
            adjustedValue: fullValue.toString(16).toUpperCase() !== hexClean.toUpperCase()
        });
    }

    private _parseFields(fields: StructField[], binaryValue: string, fullValue: bigint, totalBits: number, parentOffset: number = 0): ParsedField[] {
        return fields.map(field => {
            const absoluteOffset = parentOffset + field.offset;
            const startFromRight = absoluteOffset;
            const endFromRight = absoluteOffset + field.bits;
            const startPos = totalBits - endFromRight;
            const endPos = totalBits - startFromRight;
            const fieldBits = binaryValue.substring(startPos, endPos);
            const fieldValue = parseInt(fieldBits, 2);
            
            const parsedField: ParsedField = {
                ...field,
                binary: fieldBits,
                value: fieldValue,
                hex: '0x' + fieldValue.toString(16).toUpperCase(),
                fullHexValue: '0x' + fullValue.toString(16).toUpperCase()
            };

            if (field.children && field.children.length > 0) {
                parsedField.children = this._parseFields(
                    field.children, 
                    fieldBits, 
                    BigInt(fieldValue), 
                    field.bits,
                    0
                );
            } else if ((field.type === 'struct' || field.type === 'union') && this._structData) {
                const nestedDef = this._structData.structs.find(s => s.name === field.name) ||
                                 this._structData.unions.find(s => s.name === field.name);
                if (nestedDef && nestedDef.fields) {
                    parsedField.children = this._parseFields(
                        nestedDef.fields,
                        fieldBits,
                        BigInt(fieldValue),
                        field.bits,
                        0
                    );
                }
            }

            return parsedField;
        });
    }

    private _updateFieldValue(fieldPath: string[], newValue: number) {
        if (!this._currentParsedData) return;

        let currentFields: (ParsedField | StructField)[] = this._currentParsedData.fields;
        let targetField: ParsedField | null = null;

        for (let i = 0; i < fieldPath.length; i++) {
            const fieldName = fieldPath[i];
            const found = currentFields.find(f => f.name === fieldName);
            
            if (!found) break;
            
            if (i < fieldPath.length - 1 && found.children) {
                currentFields = found.children;
            } else if (i === fieldPath.length - 1) {
                targetField = found as ParsedField;
            }
        }

        if (targetField) {
            const maxValue = (1 << targetField.bits) - 1;
            if (newValue < 0 || newValue > maxValue) {
                vscode.window.showWarningMessage(`Value out of range (0-${maxValue})`);
                return;
            }

            targetField.value = newValue;
            targetField.hex = '0x' + newValue.toString(16).toUpperCase();
            targetField.binary = newValue.toString(2).padStart(targetField.bits, '0');

            this._recalculateHexValue();

            this._panel.webview.postMessage({
                command: 'fieldUpdated',
                fieldPath: fieldPath,
                newValue: newValue,
                newHex: targetField.hex,
                newBinary: targetField.binary,
                fullHexValue: this._currentParsedData ? 
                    '0x' + BigInt('0b' + this._currentParsedData.binaryValue).toString(16).toUpperCase() : ''
            });
        }
    }

    private _recalculateHexValue() {
        if (!this._currentParsedData) return;

        let binaryStr = '';
        const buildBinary = (fields: ParsedField[]) => {
            fields.forEach(field => {
                if (field.children && field.children.length > 0) {
                    buildBinary(field.children as ParsedField[]);
                } else {
                    binaryStr = field.binary + binaryStr;
                }
            });
        };

        buildBinary(this._currentParsedData.fields);
        this._currentParsedData.binaryValue = binaryStr;
    }

    private _searchFields(searchTerm: string) {
        if (!this._currentParsedData) return;

        const results: { path: string[]; field: ParsedField }[] = [];
        
        const searchInFields = (fields: ParsedField[], currentPath: string[]) => {
            fields.forEach(field => {
                const fullPath = [...currentPath, field.name];
                const searchLower = searchTerm.toLowerCase();
                
                if (field.name.toLowerCase().includes(searchLower) ||
                    field.type.toLowerCase().includes(searchLower)) {
                    results.push({ path: fullPath, field });
                }
                
                if (field.children) {
                    searchInFields(field.children as ParsedField[], fullPath);
                }
            });
        };

        searchInFields(this._currentParsedData.fields, []);

        this._panel.webview.postMessage({
            command: 'searchResults',
            results: results
        });
    }

    private _exportResults(format: 'csv' | 'json' | 'markdown') {
        if (!this._currentParsedData) {
            vscode.window.showWarningMessage('No data to export');
            return;
        }

        let content = '';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        switch (format) {
            case 'csv':
                content = this._exportToCsv();
                break;
            case 'json':
                content = JSON.stringify(this._currentParsedData, null, 2);
                break;
            case 'markdown':
                content = this._exportToMarkdown();
                break;
        }

        const defaultUri = vscode.Uri.file(`struct-export-${timestamp}.${format}`);
        vscode.window.showSaveDialog({
            defaultUri,
            filters: {
                [format.toUpperCase()]: [format]
            }
        }).then(uri => {
            if (uri) {
                fs.writeFileSync(uri.fsPath, content);
                vscode.window.showInformationMessage(`Exported to ${path.basename(uri.fsPath)}`);
            }
        });
    }

    private _exportToCsv(): string {
        if (!this._currentParsedData) return '';

        let csv = 'Field,Type,Bits,Value,Hex,Binary\n';
        
        const addFields = (fields: ParsedField[], prefix: string) => {
            fields.forEach(field => {
                const name = prefix ? `${prefix}.${field.name}` : field.name;
                if (field.children && field.children.length > 0) {
                    addFields(field.children as ParsedField[], name);
                } else {
                    csv += `"${name}","${field.type}",${field.bits},${field.value},"${field.hex}","${field.binary}"\n`;
                }
            });
        };

        addFields(this._currentParsedData.fields, '');
        return csv;
    }

    private _exportToMarkdown(): string {
        if (!this._currentParsedData) return '';

        let md = `# Struct Parse Result\n\n`;
        md += `**Struct:** ${this._currentParsedData.struct.name}\n\n`;
        md += `**Hex Value:** ${this._currentParsedData.hexValue}\n\n`;
        md += `| Field | Type | Bits | Value | Hex | Binary |\n`;
        md += `|-------|------|------|-------|-----|--------|\n`;

        const addFields = (fields: ParsedField[], prefix: string) => {
            fields.forEach(field => {
                const name = prefix ? `${prefix}.${field.name}` : field.name;
                if (field.children && field.children.length > 0) {
                    addFields(field.children as ParsedField[], name);
                } else {
                    md += `| ${name} | ${field.type} | ${field.bits} | ${field.value} | ${field.hex} | ${field.binary} |\n`;
                }
            });
        };

        addFields(this._currentParsedData.fields, '');
        return md;
    }

    private _copyToClipboard(text: string) {
        vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('Copied to clipboard!');
    }

    public parseHexValue(hexValue: string) {
        this._panel.webview.postMessage({
            command: 'setHexValue',
            hexValue: hexValue
        });
    }

    public selectStruct(structName: string) {
        this._panel.webview.postMessage({
            command: 'selectStruct',
            structName: structName
        });
    }

    public refreshStructList(structData: StructJson) {
        this._structData = structData;
        const structNames = [...structData.structs, ...structData.unions].map(s => s.name);
        
        this._panel.webview.postMessage({
            command: 'jsonImported',
            structNames: structNames,
            filePath: vscode.workspace.getConfiguration('structParser').get('jsonPath', '')
        });
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Struct Parser';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const structNames = this._structData ? 
            [...this._structData.structs, ...this._structData.unions].map(s => s.name) : [];

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Struct Parser</title>
            <style>
                ${this._getCssStyles()}
            </style>
        </head>
        <body>
            <div class="sp-container">
                <!-- Header -->
                <header class="sp-header">
                    <h1 class="sp-title">🔧 Struct Parser Viewer</h1>
                    <div class="sp-toolbar">
                        <button id="btnExport" class="sp-btn sp-btn-icon" title="Export">📤</button>
                        <button id="btnSettings" class="sp-btn sp-btn-icon" title="Settings">⚙️</button>
                    </div>
                </header>

                <!-- Import Section -->
                <section class="sp-section">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">📁</span>
                        <h2 class="sp-section-title">Struct Definition</h2>
                        <span class="sp-version">v1.0</span>
                    </div>
                    <div class="sp-section-body">
                        <button id="btnImport" class="sp-btn sp-btn-primary sp-btn-block">
                            <span>📂</span> Import JSON File
                        </button>
                        <div id="importStatus" class="sp-badge ${structNames.length > 0 ? 'sp-badge-success' : 'sp-badge-warning'}">
                            ${structNames.length > 0 ? '✓ Loaded ' + structNames.length + ' structs' : '⚠ No struct data loaded'}
                        </div>
                    </div>
                </section>

                <!-- Input Section -->
                <section class="sp-section">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">🔢</span>
                        <h2 class="sp-section-title">Hex Value</h2>
                    </div>
                    <div class="sp-section-body">
                        <div class="sp-input-group">
                            <span class="sp-input-prefix">0x</span>
                            <input type="text" id="hexInput" class="sp-input" placeholder="ABCD1234" maxlength="16">
                            <button id="btnCopyHex" class="sp-btn sp-btn-icon" title="Copy">📋</button>
                        </div>
                        <div class="sp-hint">Enter hex value without 0x prefix</div>
                    </div>
                </section>

                <!-- Struct Selection -->
                <section class="sp-section">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">📐</span>
                        <h2 class="sp-section-title">Select Struct</h2>
                    </div>
                    <div class="sp-section-body">
                        <select id="structSelect" class="sp-select">
                            <option value="">-- Choose a struct --</option>
                            ${structNames.map(name => `<option value="${name.replace(/"/g, '&quot;')}">${name}</option>`).join('')}
                        </select>
                        <button id="btnParse" class="sp-btn sp-btn-primary sp-btn-block sp-mt-md" ${structNames.length === 0 ? 'disabled' : ''}>
                            <span>▶</span> Parse
                        </button>
                    </div>
                </section>

                <!-- History Section -->
                <section class="sp-section" id="historySection" style="display: ${this._history.length > 0 ? 'block' : 'none'}">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">🕐</span>
                        <h2 class="sp-section-title">History</h2>
                        <button id="btnClearHistory" class="sp-btn sp-btn-text">Clear</button>
                    </div>
                    <div class="sp-section-body">
                        <div class="sp-history-list">
                            ${this._history.slice(0, 5).map((item, index) => `
                                <div class="sp-history-item" data-index="${index}">
                                    <span class="sp-history-struct">${item.structName}</span>
                                    <span class="sp-history-value">0x${item.hexValue}</span>
                                    <span class="sp-history-time">${new Date(item.timestamp).toLocaleTimeString()}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </section>

                <!-- Search Section -->
                <section class="sp-section" id="searchSection" style="display: none;">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">🔍</span>
                        <h2 class="sp-section-title">Search Fields</h2>
                        <button id="btnCloseSearch" class="sp-btn sp-btn-icon">✕</button>
                    </div>
                    <div class="sp-section-body">
                        <div class="sp-search">
                            <span class="sp-search-icon">🔍</span>
                            <input type="text" id="searchInput" class="sp-search-input" placeholder="Search by field name or type...">
                        </div>
                        <div id="searchResults" class="sp-search-results"></div>
                    </div>
                </section>

                <!-- Results Section -->
                <section class="sp-section" id="resultsSection" style="display: none;">
                    <div class="sp-section-header">
                        <span class="sp-section-icon">📊</span>
                        <h2 class="sp-section-title">Results</h2>
                        <div class="sp-toolbar">
                            <button id="btnSearch" class="sp-btn sp-btn-icon" title="Search">🔍</button>
                            <button id="btnCopyResults" class="sp-btn sp-btn-icon" title="Copy All">📋</button>
                            <button id="btnExportResults" class="sp-btn sp-btn-icon" title="Export">📤</button>
                        </div>
                    </div>
                    <div class="sp-section-body">
                        <div id="fullValue" class="sp-full-value"></div>
                        <div id="treeRoot" class="sp-tree"></div>
                    </div>
                </section>
            </div>

            <script>
                ${this._getJavaScriptCode()}
            </script>
        </body>
        </html>`;
    }

    private _getCssStyles(): string {
        return `
            /* CSS Reset & Base */
            * { box-sizing: border-box; margin: 0; padding: 0; }
            
            :root {
                --sp-unit: 4px;
                --sp-xs: calc(var(--sp-unit) * 1);
                --sp-sm: calc(var(--sp-unit) * 2);
                --sp-md: calc(var(--sp-unit) * 3);
                --sp-lg: calc(var(--sp-unit) * 4);
                --sp-xl: calc(var(--sp-unit) * 6);
                --sp-radius: 6px;
                --sp-shadow: 0 2px 8px rgba(0,0,0,0.15);
                
                /* Type Colors */
                --sp-type-struct: #4EC9B0;
                --sp-type-union: #C586C0;
                --sp-type-uint: #9CDCFE;
                --sp-type-bool: #569CD6;
                
                /* Status */
                --sp-success: #4EC9B0;
                --sp-warning: #CCA700;
                --sp-error: #F48771;
            }
            
            body {
                font-family: var(--vscode-font-family);
                font-size: 13px;
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                line-height: 1.5;
            }
            
            /* Container */
            .sp-container {
                max-width: 800px;
                margin: 0 auto;
                padding: var(--sp-lg);
            }
            
            /* Header */
            .sp-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: var(--sp-xl);
                padding-bottom: var(--sp-md);
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .sp-title {
                font-size: 18px;
                font-weight: 600;
                color: var(--vscode-foreground);
            }
            
            .sp-toolbar {
                display: flex;
                gap: var(--sp-xs);
            }
            
            /* Section */
            .sp-section {
                margin-bottom: var(--sp-lg);
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
                overflow: hidden;
            }
            
            .sp-section-header {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                padding: var(--sp-md) var(--sp-lg);
                background-color: var(--vscode-panel-background);
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .sp-section-icon {
                font-size: 16px;
            }
            
            .sp-section-title {
                flex: 1;
                font-size: 13px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--vscode-foreground);
            }
            
            .sp-version {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            
            .sp-section-body {
                padding: var(--sp-lg);
            }
            
            /* Buttons */
            .sp-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: var(--sp-sm);
                padding: var(--sp-sm) var(--sp-md);
                font-size: 13px;
                font-weight: 500;
                border: none;
                border-radius: var(--sp-radius);
                cursor: pointer;
                transition: all 0.15s ease;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            
            .sp-btn:hover:not(:disabled) {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .sp-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .sp-btn-primary {
                background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            }
            
            .sp-btn-block {
                width: 100%;
                margin-top: var(--sp-md);
            }
            
            .sp-btn-icon {
                width: 32px;
                height: 32px;
                padding: 0;
                background: transparent;
                color: var(--vscode-foreground);
            }
            
            .sp-btn-icon:hover {
                background-color: var(--vscode-toolbar-hoverBackground);
            }
            
            .sp-btn-text {
                background: transparent;
                color: var(--vscode-textLink-foreground);
                font-size: 12px;
                padding: var(--sp-xs) var(--sp-sm);
            }
            
            /* Input */
            .sp-input-group {
                display: flex;
                align-items: center;
                background-color: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                border-radius: var(--sp-radius);
                overflow: hidden;
            }
            
            .sp-input-prefix {
                padding: var(--sp-sm) var(--sp-md);
                background-color: var(--vscode-panel-background);
                color: var(--vscode-descriptionForeground);
                font-family: var(--vscode-editor-font-family);
                font-weight: 500;
                border-right: 1px solid var(--vscode-input-border);
            }
            
            .sp-input {
                flex: 1;
                padding: var(--sp-sm) var(--sp-md);
                border: none;
                background: transparent;
                color: var(--vscode-input-foreground);
                font-family: var(--vscode-editor-font-family);
                font-size: 14px;
            }
            
            .sp-input:focus {
                outline: none;
            }
            
            .sp-select {
                width: 100%;
                padding: var(--sp-sm) var(--sp-md);
                border: 1px solid var(--vscode-input-border);
                border-radius: var(--sp-radius);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-size: 13px;
            }
            
            .sp-hint {
                margin-top: var(--sp-sm);
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }
            
            /* Badge */
            .sp-badge {
                display: inline-flex;
                align-items: center;
                gap: var(--sp-xs);
                margin-top: var(--sp-sm);
                padding: var(--sp-xs) var(--sp-sm);
                font-size: 12px;
                border-radius: 4px;
            }
            
            .sp-badge-success {
                color: var(--sp-success);
                background-color: rgba(78, 201, 176, 0.15);
            }
            
            .sp-badge-warning {
                color: var(--sp-warning);
                background-color: rgba(204, 167, 0, 0.15);
            }
            
            /* History */
            .sp-history-list {
                display: flex;
                flex-direction: column;
                gap: var(--sp-xs);
            }
            
            .sp-history-item {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                padding: var(--sp-sm) var(--sp-md);
                background-color: var(--vscode-list-hoverBackground);
                border-radius: var(--sp-radius);
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            
            .sp-history-item:hover {
                background-color: var(--vscode-list-activeSelectionBackground);
            }
            
            .sp-history-struct {
                font-weight: 500;
                color: var(--vscode-foreground);
            }
            
            .sp-history-value {
                font-family: var(--vscode-editor-font-family);
                color: var(--vscode-numberLiteral-foreground);
            }
            
            .sp-history-time {
                margin-left: auto;
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            
            /* Search */
            .sp-search {
                position: relative;
                margin-bottom: var(--sp-md);
            }
            
            .sp-search-icon {
                position: absolute;
                left: var(--sp-md);
                top: 50%;
                transform: translateY(-50%);
                color: var(--vscode-descriptionForeground);
            }
            
            .sp-search-input {
                width: 100%;
                padding: var(--sp-sm) var(--sp-md);
                padding-left: 36px;
                border: 1px solid var(--vscode-input-border);
                border-radius: var(--sp-radius);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-size: 13px;
            }
            
            .sp-search-results {
                max-height: 200px;
                overflow-y: auto;
            }
            
            /* Full Value */
            .sp-full-value {
                margin-bottom: var(--sp-lg);
                padding: var(--sp-md);
                background-color: var(--vscode-textBlockQuote-background);
                border-radius: var(--sp-radius);
                font-family: var(--vscode-editor-font-family);
            }
            
            .sp-full-value-label {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                margin-bottom: var(--sp-xs);
            }
            
            .sp-full-value-content {
                font-size: 18px;
                font-weight: 500;
                color: var(--vscode-foreground);
            }
            
            /* Tree */
            .sp-tree {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .sp-field-row {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                padding: var(--sp-sm) var(--sp-md);
                border-radius: var(--sp-radius);
                transition: background-color 0.15s ease;
            }
            
            .sp-field-row:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .sp-field-row.highlighted {
                background-color: var(--vscode-editor-findMatchHighlightBackground);
            }
            
            .sp-expand-icon {
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                cursor: pointer;
                transition: transform 0.2s ease;
            }
            
            .sp-expand-icon.expanded {
                transform: rotate(90deg);
            }
            
            .sp-type-icon {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            
            .sp-type-icon.struct { background-color: var(--sp-type-struct); }
            .sp-type-icon.union { background-color: var(--sp-type-union); }
            .sp-type-icon.uint { background-color: var(--sp-type-uint); }
            .sp-type-icon.bool { background-color: var(--sp-type-bool); }
            
            .sp-field-name {
                font-weight: 600;
                min-width: 100px;
                color: var(--vscode-foreground);
            }
            
            .sp-field-type {
                font-size: 11px;
                min-width: 60px;
                color: var(--vscode-descriptionForeground);
            }
            
            .sp-field-type.struct { color: var(--sp-type-struct); }
            .sp-field-type.union { color: var(--sp-type-union); }
            
            .sp-field-input {
                width: 60px;
                padding: 2px 6px;
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                text-align: right;
            }
            
            .sp-field-input:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
            }
            
            .sp-field-hex {
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                color: var(--vscode-numberLiteral-foreground);
                min-width: 50px;
            }
            
            .sp-field-binary {
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                color: var(--vscode-textPreformat-foreground);
                letter-spacing: 0.5px;
            }
            
            .sp-field-bits {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                margin-left: auto;
            }
            
            .sp-children {
                display: none;
                margin-left: var(--sp-xl);
                border-left: 1px solid var(--vscode-panel-border);
                padding-left: var(--sp-sm);
            }
            
            .sp-children.expanded {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            /* Utilities */
            .sp-mt-md { margin-top: var(--sp-md); }
            .sp-mt-lg { margin-top: var(--sp-lg); }
        `;
    }

    private _getJavaScriptCode(): string {
        return `
            const vscode = acquireVsCodeApi();
            let currentFields = [];
            let expandedNodes = new Set();
            let currentStructName = '';
            let currentHexValue = '';

            // Initialize event listeners
            document.addEventListener('DOMContentLoaded', function() {
                setupEventListeners();
            });

            function setupEventListeners() {
                // Import button
                document.getElementById('btnImport')?.addEventListener('click', () => {
                    vscode.postMessage({ command: 'importJson' });
                });

                // Parse button
                document.getElementById('btnParse')?.addEventListener('click', parseValue);

                // Copy hex button
                document.getElementById('btnCopyHex')?.addEventListener('click', () => {
                    const hexValue = document.getElementById('hexInput').value;
                    vscode.postMessage({ command: 'copy', text: '0x' + hexValue });
                });

                // Search button
                document.getElementById('btnSearch')?.addEventListener('click', () => {
                    document.getElementById('searchSection').style.display = 'block';
                    document.getElementById('searchInput').focus();
                });

                // Close search button
                document.getElementById('btnCloseSearch')?.addEventListener('click', () => {
                    document.getElementById('searchSection').style.display = 'none';
                });

                // Search input
                document.getElementById('searchInput')?.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.trim();
                    if (searchTerm.length >= 2) {
                        vscode.postMessage({ command: 'search', searchTerm });
                    }
                });

                // Export button
                document.getElementById('btnExportResults')?.addEventListener('click', () => {
                    showExportMenu();
                });

                // Copy results button
                document.getElementById('btnCopyResults')?.addEventListener('click', () => {
                    copyAllResults();
                });

                // Clear history button
                document.getElementById('btnClearHistory')?.addEventListener('click', () => {
                    vscode.postMessage({ command: 'clearHistory' });
                });

                // History items
                document.querySelectorAll('.sp-history-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const index = item.getAttribute('data-index');
                        vscode.postMessage({ command: 'loadHistory', index: parseInt(index) });
                    });
                });
            }

            function parseValue() {
                const hexValue = document.getElementById('hexInput').value.trim();
                const structName = document.getElementById('structSelect').value;
                
                if (!hexValue) {
                    vscode.postMessage({ command: 'alert', text: 'Please enter a hex value' });
                    return;
                }
                
                if (!structName) {
                    vscode.postMessage({ command: 'alert', text: 'Please select a struct' });
                    return;
                }
                
                currentStructName = structName;
                currentHexValue = hexValue;
                
                vscode.postMessage({
                    command: 'parse',
                    hexValue: hexValue,
                    structName: structName
                });
            }

            function showExportMenu() {
                const formats = [
                    { label: 'CSV', value: 'csv' },
                    { label: 'JSON', value: 'json' },
                    { label: 'Markdown', value: 'markdown' }
                ];
                
                const format = formats.find(f => confirm('Export as ' + f.label + '?'));
                if (format) {
                    vscode.postMessage({ command: 'export', format: format.value });
                }
            }

            function copyAllResults() {
                const fullValue = document.querySelector('.sp-full-value-content')?.textContent || '';
                vscode.postMessage({ command: 'copy', text: fullValue });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'setHexValue':
                        document.getElementById('hexInput').value = message.hexValue;
                        break;
                    case 'selectStruct':
                        document.getElementById('structSelect').value = message.structName;
                        break;
                    case 'jsonImported':
                        updateStructList(message.structNames, message.filePath);
                        break;
                    case 'parseResult':
                        displayResults(message);
                        break;
                    case 'fieldUpdated':
                        updateFieldDisplay(message);
                        break;
                    case 'searchResults':
                        displaySearchResults(message.results);
                        break;
                    case 'historyCleared':
                        document.getElementById('historySection').style.display = 'none';
                        break;
                    case 'loadHistoryItem':
                        document.getElementById('hexInput').value = message.hexValue;
                        document.getElementById('structSelect').value = message.structName;
                        break;
                }
            });

            function updateStructList(structNames, filePath) {
                const statusDiv = document.getElementById('importStatus');
                statusDiv.textContent = '✓ Loaded ' + structNames.length + ' structs from ' + filePath.split('/').pop();
                statusDiv.className = 'sp-badge sp-badge-success';
                
                const select = document.getElementById('structSelect');
                select.innerHTML = '<option value="">-- Choose a struct --</option>' +
                    structNames.map(name => '<option value="' + name.replace(/"/g, '&quot;') + '">' + name + '</option>').join('');
                
                document.getElementById('btnParse').disabled = false;
            }

            function displayResults(data) {
                currentFields = data.fields;
                
                if (data.error) {
                    document.getElementById('resultsSection').style.display = 'block';
                    document.getElementById('treeRoot').innerHTML = '<div class="sp-badge sp-badge-warning">' + data.error + '</div>';
                    return;
                }
                
                document.getElementById('resultsSection').style.display = 'block';
                
                // Display full value
                const fullValueHtml = '<div class="sp-full-value-label">Full Value' + 
                    (data.adjustedValue ? ' <span style="color: var(--sp-warning)">(adjusted)</span>' : '') + 
                    '</div>' +
                    '<div class="sp-full-value-content">' + data.fullHexValue + ' (' + data.struct.size_bits + '-bit)</div>';
                document.getElementById('fullValue').innerHTML = fullValueHtml;
                
                // Render tree
                document.getElementById('treeRoot').innerHTML = renderTree(data.fields, []);
                
                // Attach event listeners
                attachTreeEventListeners();
            }

            function renderTree(fields, path) {
                let html = '';
                
                fields.forEach(field => {
                    const currentPath = [...path, field.name];
                    const pathStr = currentPath.join('.');
                    const hasChildren = field.children && field.children.length > 0;
                    const isExpanded = expandedNodes.has(pathStr);
                    
                    html += '<div class="sp-field-row" data-path="' + pathStr + '">';
                    
                    if (hasChildren) {
                        html += '<span class="sp-expand-icon ' + (isExpanded ? 'expanded' : '') + '" data-path="' + pathStr + '">▶</span>';
                    } else {
                        html += '<span class="sp-expand-icon" style="visibility: hidden;">▶</span>';
                    }
                    
                    const typeClass = field.type === 'struct' ? 'struct' : field.type === 'union' ? 'union' : 'uint';
                    html += '<span class="sp-type-icon ' + typeClass + '"></span>';
                    html += '<span class="sp-field-name">' + field.name + '</span>';
                    html += '<span class="sp-field-type ' + typeClass + '">' + field.type + '</span>';
                    
                    html += '<input type="number" class="sp-field-input" value="' + field.value + '" ';
                    html += 'min="0" max="' + ((1 << field.bits) - 1) + '" ';
                    html += 'data-path="' + currentPath.join(',') + '" />';
                    
                    html += '<span class="sp-field-hex">' + field.hex + '</span>';
                    html += '<span class="sp-field-binary">' + field.binary + '</span>';
                    html += '<span class="sp-field-bits">' + field.bits + ' bits</span>';
                    
                    html += '</div>';
                    
                    if (hasChildren) {
                        html += '<div class="sp-children ' + (isExpanded ? 'expanded' : '') + '" id="children-' + pathStr + '">';
                        html += renderTree(field.children, currentPath);
                        html += '</div>';
                    }
                });
                
                return html;
            }

            function attachTreeEventListeners() {
                // Expand/collapse
                document.querySelectorAll('.sp-expand-icon').forEach(icon => {
                    icon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const pathStr = icon.getAttribute('data-path');
                        toggleNode(pathStr);
                    });
                });
                
                // Field input change
                document.querySelectorAll('.sp-field-input').forEach(input => {
                    input.addEventListener('change', (e) => {
                        const pathStr = e.target.getAttribute('data-path');
                        const newValue = parseInt(e.target.value);
                        vscode.postMessage({
                            command: 'updateField',
                            fieldPath: pathStr.split(','),
                            newValue: newValue
                        });
                    });
                });
            }

            function toggleNode(pathStr) {
                if (expandedNodes.has(pathStr)) {
                    expandedNodes.delete(pathStr);
                } else {
                    expandedNodes.add(pathStr);
                }
                
                const children = document.getElementById('children-' + pathStr);
                if (children) {
                    children.classList.toggle('expanded');
                }
                
                const icon = document.querySelector('.sp-expand-icon[data-path="' + pathStr + '"]');
                if (icon) {
                    icon.classList.toggle('expanded');
                }
            }

            function updateFieldDisplay(data) {
                const input = document.querySelector('.sp-field-input[data-path="' + data.fieldPath.join(',') + '"]');
                if (input) {
                    input.value = data.newValue;
                }
                
                // Update full value display
                const fullValueContent = document.querySelector('.sp-full-value-content');
                if (fullValueContent && data.fullHexValue) {
                    fullValueContent.textContent = data.fullHexValue;
                }
            }

            function displaySearchResults(results) {
                const container = document.getElementById('searchResults');
                
                if (results.length === 0) {
                    container.innerHTML = '<div class="sp-hint">No fields found</div>';
                    return;
                }
                
                let html = '<div style="display: flex; flex-direction: column; gap: 4px;">';
                results.forEach(result => {
                    html += '<div class="sp-history-item" data-path="' + result.path.join('.') + '">';
                    html += '<span>' + result.path.join('.') + '</span>';
                    html += '<span style="color: var(--vscode-descriptionForeground); margin-left: auto;">' + result.field.type + '</span>';
                    html += '</div>';
                });
                html += '</div>';
                
                container.innerHTML = html;
                
                // Add click handlers
                container.querySelectorAll('.sp-history-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const pathStr = item.getAttribute('data-path');
                        highlightField(pathStr);
                    });
                });
            }

            function highlightField(pathStr) {
                // Expand all parent nodes
                const parts = pathStr.split('.');
                for (let i = 1; i <= parts.length; i++) {
                    const partialPath = parts.slice(0, i).join('.');
                    if (!expandedNodes.has(partialPath)) {
                        expandedNodes.add(partialPath);
                        const children = document.getElementById('children-' + partialPath);
                        if (children) {
                            children.classList.add('expanded');
                        }
                        const icon = document.querySelector('.sp-expand-icon[data-path="' + partialPath + '"]');
                        if (icon) {
                            icon.classList.add('expanded');
                        }
                    }
                }
                
                // Highlight the field
                document.querySelectorAll('.sp-field-row').forEach(row => {
                    row.classList.remove('highlighted');
                });
                
                const targetRow = document.querySelector('.sp-field-row[data-path="' + pathStr + '"]');
                if (targetRow) {
                    targetRow.classList.add('highlighted');
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        `;
    }

    public dispose() {
        StructParserPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
