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
    public static panels: Map<string, StructParserPanel> = new Map();
    public static readonly viewType = 'structParser';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _structData: StructJson | null = null;
    private _currentStruct: StructDef | null = null;
    private _currentParsedData: {
        struct: StructDef;
        fields: ParsedField[];
        hexValue: string;
        binaryValue: string;
    } | null = null;

    public static createOrShow(extensionUri: vscode.Uri, structName?: string): StructParserPanel {
        // If struct name provided and panel exists, reveal it
        if (structName && StructParserPanel.panels.has(structName)) {
            const panel = StructParserPanel.panels.get(structName)!;
            panel._panel.reveal(vscode.ViewColumn.One);
            return panel;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            StructParserPanel.viewType,
            structName ? structName : 'Struct Parser',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        const parserPanel = new StructParserPanel(panel, extensionUri);

        // Store panel reference if struct name provided
        if (structName) {
            StructParserPanel.panels.set(structName, parserPanel);
            panel.onDidDispose(() => {
                StructParserPanel.panels.delete(structName);
            });
        }

        return parserPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
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
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
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

    public showStructDefinition(struct: StructDef) {
        this._currentStruct = struct;
        this._update();
    }

    public refreshStructList(structData: StructJson) {
        this._structData = structData;
    }

    private _renderFieldList(fields: StructField[], level: number = 0): string {
        let html = '';
        fields.forEach(field => {
            const indent = level * 16;
            const hasChildren = field.children && field.children.length > 0;
            const fieldId = field.name.replace(/[^a-zA-Z0-9]/g, '_');
            
            html += `
                <div class="sp-field-row" style="padding-left: ${indent}px" data-field="${field.name}">
                    <span class="sp-field-name">${hasChildren ? '▼' : '•'} ${field.name}</span>
                    <span class="sp-field-type">${field.type}</span>
                    <span class="sp-field-bits">${field.bits}</span>
                    <span class="sp-field-offset">${field.offset}</span>
                    <span class="sp-field-dec" id="val-dec-${fieldId}">-</span>
                    <span class="sp-field-hex" id="val-hex-${fieldId}">-</span>
                    <input type="number" class="sp-field-input" id="input-${fieldId}" 
                        min="0" max="${(1 << field.bits) - 1}" placeholder="-" 
                        data-field="${field.name}" data-bits="${field.bits}">
                </div>
            `;
            
            if (hasChildren) {
                html += this._renderFieldList(field.children!, level + 1);
            }
        });
        return html;
    }

    private _update() {
        const webview = this._panel.webview;
        // Update panel title to struct name if available
        this._panel.title = this._currentStruct?.name || 'Struct Parser';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const hasStruct = this._currentStruct !== null;
        const structName = this._currentStruct?.name || '';
        const structType = this._currentStruct?.type || '';
        const structSize = this._currentStruct?.size_bits || 0;

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
                <!-- Header with Struct Info -->
                <header class="sp-header-compact" id="headerSection" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="sp-struct-info">
                        <div class="sp-struct-name">
                            <span class="sp-type-icon ${structType}"></span>
                            <span>${structName}</span>
                            <span class="sp-struct-size">${structSize} bits</span>
                        </div>
                    </div>
                </header>

                <!-- Empty State -->
                <div id="emptyState" class="sp-empty-state" style="display: ${hasStruct ? 'none' : 'flex'}">
                    <div class="sp-empty-icon">📋</div>
                    <div class="sp-empty-text">Select a struct from the sidebar</div>
                    <div class="sp-empty-hint">Use the search box to find and select a struct</div>
                </div>

                <!-- Main Input Area -->
                <section class="sp-section sp-section-compact" id="inputSection" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="sp-input-row">
                        <div class="sp-input-group sp-flex-1">
                            <span class="sp-input-prefix">0x</span>
                            <input type="text" id="hexInput" class="sp-input" placeholder="Enter hex value" maxlength="16">
                        </div>
                        <button id="btnParse" class="sp-btn sp-btn-primary">
                            ▶ Parse
                        </button>
                    </div>
                </section>

                <!-- Struct Definition Section -->
                <section class="sp-section sp-section-results" id="definitionSection" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="sp-section-header">
                        <span class="sp-section-title">Struct Definition</span>
                        <div class="sp-toolbar">
                            <button id="btnSearch" class="sp-btn sp-btn-icon" title="Search Fields">🔍</button>
                            <button id="btnCopyDef" class="sp-btn sp-btn-icon" title="Copy Definition">📋</button>
                        </div>
                    </div>
                    <div class="sp-section-body">
                        <div class="sp-field-header">
                            <span class="sp-field-h-name">Field</span>
                            <span class="sp-field-h-type">Type</span>
                            <span class="sp-field-h-bits">Bits</span>
                            <span class="sp-field-h-offset">Offs</span>
                            <span class="sp-field-h-dec">Dec</span>
                            <span class="sp-field-h-hex">Hex</span>
                            <span class="sp-field-h-input">Edit</span>
                        </div>
                        <div id="fieldList" class="sp-field-list">
                            ${hasStruct ? this._renderFieldList(this._currentStruct!.fields) : ''}
                        </div>
                    </div>
                </section>

                <!-- Export Button (Floating) -->
                <div id="exportContainer" style="display: none; padding: var(--sp-sm) 0; text-align: right;">
                    <button id="btnExportResults" class="sp-btn sp-btn-sm" title="Export Results">📤 Export</button>
                </div>
            </div>

            <script>
                // Initialize current struct name from server-rendered value
                let currentStructName = '${structName.replace(/'/g, "\\'")}';
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
                max-width: 900px;
                margin: 0 auto;
                padding: var(--sp-md);
            }
            
            /* Compact Header */
            .sp-header-compact {
                margin-bottom: var(--sp-md);
            }
            
            .sp-header-main {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: var(--sp-xs);
            }
            
            .sp-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--vscode-foreground);
            }
            
            .sp-status-line {
                font-size: 12px;
                padding: var(--sp-xs) 0;
            }
            
            .sp-status-success { color: var(--sp-success); }
            .sp-status-warning { color: var(--sp-warning); }
            
            /* Section */
            .sp-section {
                margin-bottom: var(--sp-md);
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
                overflow: hidden;
            }
            
            .sp-section-compact {
                padding: var(--sp-sm);
            }
            
            .sp-section-results {
                padding: 0;
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
            
            .sp-btn-sm {
                padding: var(--sp-xs) var(--sp-sm);
                font-size: 12px;
            }
            
            .sp-btn-xs {
                padding: 2px var(--sp-xs);
                font-size: 11px;
            }
            
            /* Struct Info Header */
            .sp-struct-info {
                padding: var(--sp-md);
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
            }
            
            .sp-struct-name {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                font-size: 16px;
                font-weight: 600;
            }
            
            .sp-struct-size {
                margin-left: auto;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                font-weight: normal;
            }
            
            /* Empty State */
            .sp-empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 48px 24px;
                text-align: center;
            }
            
            .sp-empty-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            
            .sp-empty-text {
                font-size: 16px;
                font-weight: 500;
                color: var(--vscode-foreground);
                margin-bottom: 8px;
            }
            
            .sp-empty-hint {
                font-size: 13px;
                color: var(--vscode-descriptionForeground);
            }
            
            /* Input Row */
            .sp-input-row {
                display: flex;
                gap: var(--sp-sm);
                align-items: center;
            }
            
            .sp-flex-1 { flex: 1; }
            
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
            
            /* History Bar */
            .sp-history-bar {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                margin-bottom: var(--sp-md);
                padding: var(--sp-xs) var(--sp-sm);
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
            }
            
            .sp-history-label {
                font-size: 12px;
            }
            
            .sp-history-items {
                display: flex;
                gap: var(--sp-xs);
                flex: 1;
                overflow-x: auto;
            }
            
            .sp-history-chip {
                display: flex;
                align-items: center;
                gap: var(--sp-xs);
                padding: 2px var(--sp-sm);
                background-color: var(--vscode-list-hoverBackground);
                border-radius: 12px;
                font-size: 11px;
                cursor: pointer;
                white-space: nowrap;
                transition: background-color 0.15s ease;
            }
            
            .sp-history-chip:hover {
                background-color: var(--vscode-list-activeSelectionBackground);
            }
            
            .sp-history-chip-value {
                color: var(--vscode-numberLiteral-foreground);
                font-family: var(--vscode-editor-font-family);
            }
            
            /* Search Bar */
            .sp-search-bar {
                margin-bottom: var(--sp-md);
                padding: var(--sp-sm);
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
            }
            
            .sp-search-input-wrapper {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
            }
            
            .sp-search-icon {
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
            }
            
            .sp-search-input {
                flex: 1;
                padding: var(--sp-xs) var(--sp-sm);
                border: 1px solid var(--vscode-input-border);
                border-radius: var(--sp-radius);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-size: 13px;
            }
            
            .sp-search-results {
                max-height: 150px;
                overflow-y: auto;
                margin-top: var(--sp-sm);
            }
            
            /* Results Section */
            .sp-results-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--sp-md);
                background-color: var(--vscode-panel-background);
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .sp-results-actions {
                display: flex;
                gap: var(--sp-xs);
            }
            
            /* Full Value */
            .sp-full-value {
                font-family: var(--vscode-editor-font-family);
                font-size: 14px;
                color: var(--vscode-foreground);
            }
            
            .sp-full-value-label {
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 2px;
            }
            
            .sp-full-value-content {
                font-size: 16px;
                font-weight: 500;
                color: var(--vscode-foreground);
            }
            
            /* Field List */
            .sp-field-list {
                display: flex;
                flex-direction: column;
            }
            
            .sp-field-header {
                display: flex;
                align-items: center;
                padding: var(--sp-sm) var(--sp-md);
                background-color: var(--vscode-panel-background);
                border-bottom: 1px solid var(--vscode-panel-border);
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
            }
            
            .sp-field-header > span { flex: 1; text-align: center; }
            .sp-field-h-name { flex: 2; text-align: left; }
            .sp-field-h-type { flex: 1.5; }
            .sp-field-h-bits { flex: 0.8; }
            .sp-field-h-offset { flex: 0.8; }
            .sp-field-h-dec { flex: 1; }
            .sp-field-h-hex { flex: 1; }
            .sp-field-h-input { flex: 1; }
            
            .sp-field-row {
                display: flex;
                align-items: center;
                padding: 6px var(--sp-md);
                border-bottom: 1px solid var(--vscode-panel-border);
                font-size: 12px;
                gap: 8px;
            }
            
            .sp-field-row:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .sp-field-row:last-child {
                border-bottom: none;
            }
            
            .sp-field-row > span,
            .sp-field-row > input { flex: 1; text-align: center; }
            
            .sp-field-name { 
                flex: 2;
                text-align: left;
                font-weight: 500;
                color: var(--vscode-foreground);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .sp-field-type { 
                flex: 1.5;
                color: var(--vscode-symbolIcon-colorForeground);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .sp-field-bits { 
                flex: 0.8;
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            
            .sp-field-offset { 
                flex: 0.8;
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            
            .sp-field-dec { 
                flex: 1;
                text-align: right;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                color: var(--vscode-numberLiteral-foreground);
            }
            
            .sp-field-hex { 
                flex: 1;
                text-align: right;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                color: var(--vscode-textPreformat-foreground);
            }
            
            .sp-field-input {
                flex: 1;
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
            
            /* Tree */
            .sp-tree {
                display: flex;
                flex-direction: column;
                gap: 2px;
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

                // Hex input - Enter key to parse
                document.getElementById('hexInput')?.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        parseValue();
                    }
                });

                // Search button
                document.getElementById('btnSearch')?.addEventListener('click', () => {
                    const searchSection = document.getElementById('searchSection');
                    searchSection.style.display = searchSection.style.display === 'none' ? 'block' : 'none';
                    if (searchSection.style.display === 'block') {
                        document.getElementById('searchInput').focus();
                    }
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

                // History chips
                document.querySelectorAll('.sp-history-chip').forEach(item => {
                    item.addEventListener('click', () => {
                        const index = item.getAttribute('data-index');
                        vscode.postMessage({ command: 'loadHistory', index: parseInt(index) });
                    });
                });
                
                // Field input editing
                document.querySelectorAll('.sp-field-input').forEach(input => {
                    input.addEventListener('change', (e) => {
                        const fieldName = e.target.getAttribute('data-field');
                        const newValue = parseInt(e.target.value);
                        const bits = parseInt(e.target.getAttribute('data-bits'));
                        
                        if (isNaN(newValue) || newValue < 0 || newValue > ((1 << bits) - 1)) {
                            vscode.postMessage({ command: 'alert', text: 'Value out of range for ' + fieldName });
                            return;
                        }
                        
                        vscode.postMessage({
                            command: 'updateField',
                            fieldPath: [fieldName],
                            newValue: newValue
                        });
                    });
                });
            }

            function parseValue() {
                const hexValue = document.getElementById('hexInput')?.value?.trim();
                
                if (!hexValue) {
                    vscode.postMessage({ command: 'alert', text: 'Please enter a hex value' });
                    return;
                }
                
                if (!currentStructName) {
                    vscode.postMessage({ command: 'alert', text: 'Please select a struct from sidebar' });
                    return;
                }
                
                currentHexValue = hexValue;
                
                vscode.postMessage({
                    command: 'parse',
                    hexValue: hexValue,
                    structName: currentStructName
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
                        const hexInput = document.getElementById('hexInput');
                        if (hexInput) hexInput.value = message.hexValue;
                        break;
                    case 'selectStruct':
                        currentStructName = message.structName;
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
                        const historySection = document.getElementById('historySection');
                        if (historySection) historySection.style.display = 'none';
                        break;
                    case 'loadHistoryItem':
                        const hexIn = document.getElementById('hexInput');
                        if (hexIn) hexIn.value = message.hexValue;
                        currentStructName = message.structName;
                        break;
                }
            });

            function displayResults(data) {
                currentFields = data.fields;
                
                if (data.error) {
                    vscode.postMessage({ command: 'alert', text: data.error });
                    return;
                }
                
                // Update field values in Struct Definition section
                updateFieldValues(data.fields);
                
                // Show export button
                const exportContainer = document.getElementById('exportContainer');
                if (exportContainer) {
                    exportContainer.style.display = 'block';
                }
            }
            
            function updateFieldValues(fields) {
                fields.forEach(field => {
                    const fieldId = field.name.replace(/[^a-zA-Z0-9]/g, '_');
                    const decEl = document.getElementById('val-dec-' + fieldId);
                    const hexEl = document.getElementById('val-hex-' + fieldId);
                    const inputEl = document.getElementById('input-' + fieldId);
                    
                    if (decEl) decEl.textContent = field.value;
                    if (hexEl) hexEl.textContent = field.hex;
                    if (inputEl) inputEl.value = field.value;
                    
                    // Recursively update children
                    if (field.children && field.children.length > 0) {
                        updateFieldValues(field.children);
                    }
                });
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
        // Remove from panels map
        for (const [name, panel] of StructParserPanel.panels) {
            if (panel === this) {
                StructParserPanel.panels.delete(name);
                break;
            }
        }
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
