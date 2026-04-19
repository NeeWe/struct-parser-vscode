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
        const inputBits = hexClean.length * 4; // 每个16进制字符=4bit
        let fullValue = BigInt('0x' + hexClean);
        
        const structBits = structDef.size_bits;
        
        // 处理位宽对齐：不足补0，超出截断
        let adjustedValue = fullValue;
        let wasAdjusted = false;
        
        if (inputBits < structBits) {
            // 输入不足：在低位补0（左移差值）
            const padding = structBits - inputBits;
            adjustedValue = fullValue << BigInt(padding);
            wasAdjusted = true;
            console.log(`[StructParser] Padding ${padding} bits: 0x${hexClean} -> 0x${adjustedValue.toString(16).toUpperCase()}`);
        } else if (inputBits > structBits) {
            // 输入超出：保留高位（右移差值）
            const excess = inputBits - structBits;
            adjustedValue = fullValue >> BigInt(excess);
            wasAdjusted = true;
            console.log(`[StructParser] Truncating ${excess} bits: 0x${hexClean} -> 0x${adjustedValue.toString(16).toUpperCase()}`);
        }
        
        // 确保值不超过结构体范围
        const maxValue = (BigInt(1) << BigInt(structBits)) - BigInt(1);
        if (adjustedValue > maxValue) {
            adjustedValue = adjustedValue & maxValue;
            wasAdjusted = true;
        }
        
        const binaryValue = adjustedValue.toString(2).padStart(structBits, '0');

        const parsedFields = this._parseFields(structDef.fields, binaryValue, adjustedValue, structBits);

        this._currentParsedData = {
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            binaryValue: binaryValue
        };

        // 计算实际使用的16进制值
        const actualHex = '0x' + adjustedValue.toString(16).toUpperCase().padStart(Math.ceil(structBits / 4), '0');

        this._panel.webview.postMessage({
            command: 'parseResult',
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            actualHexValue: actualHex,
            binaryValue: binaryValue,
            fullHexValue: actualHex,
            adjustedValue: wasAdjusted
        });
    }

    private _parseFields(fields: StructField[], binaryValue: string, fullValue: bigint, totalBits: number, parentOffset: number = 0): ParsedField[] {
        return fields.map(field => {
            const absoluteOffset = parentOffset + field.offset;
            
            // offset 是从 MSB（最高位）开始的偏移量
            // absoluteOffset=0 表示从最左边（最高位）开始
            const startPos = absoluteOffset;
            const endPos = absoluteOffset + field.bits;
            const fieldBits = binaryValue.substring(startPos, endPos);
            const fieldValue = parseInt(fieldBits, 2);
            
            console.log(`[StructParser] Field ${field.name}: offset=${field.offset}, absOffset=${absoluteOffset}, bits=${field.bits}, binary=${fieldBits}, value=${fieldValue}`);
            
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
                    // 按照字段顺序拼接（从左到右，从MSB到LSB）
                    binaryStr += field.binary;
                }
            });
        };

        buildBinary(this._currentParsedData.fields);
        this._currentParsedData.binaryValue = binaryStr;
        
        console.log(`[StructParser] Recalculated binary: ${binaryStr} = 0x${BigInt('0b' + binaryStr).toString(16).toUpperCase()}`);
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
                    <div class="sp-field-main">
                        <span class="sp-expand-icon ${hasChildren ? 'expandable' : ''}" data-field="${field.name}">${hasChildren ? '▶' : ''}</span>
                        <span class="sp-type-indicator ${field.type}"></span>
                        <span class="sp-field-name">${field.name}</span>
                        <span class="sp-field-type ${field.type}">${field.type}</span>
                        <span class="sp-field-meta">
                            <span class="sp-field-bits">${field.bits}b</span>
                            <span class="sp-field-offset">@${field.offset}</span>
                        </span>
                    </div>
                    <div class="sp-field-values">
                        <span class="sp-field-dec" id="val-dec-${fieldId}">-</span>
                        <span class="sp-field-hex" id="val-hex-${fieldId}">-</span>
                        <input type="number" class="sp-field-input" id="input-${fieldId}" 
                            min="0" max="${(1 << field.bits) - 1}" placeholder="-" 
                            data-field="${field.name}" data-bits="${field.bits}">
                    </div>
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
                    --bg: var(--vscode-editor-background);
                    --panel-bg: var(--vscode-panel-background);
                    --border: var(--vscode-panel-border);
                    --input-bg: var(--vscode-input-background);
                    --input-border: var(--vscode-input-border);
                    --hover-bg: var(--vscode-list-hoverBackground);
                    --selection-bg: var(--vscode-list-activeSelectionBackground);
                    --toolbar-hover: var(--vscode-toolbar-hoverBackground);
                    --radius-xs: 4px;
                    --radius-sm: 6px;
                    --radius-md: 10px;
                    --radius-lg: 14px;
                    --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.08);
                    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
                    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.16);
                    --shadow-glow: 0 0 20px rgba(78, 201, 176, 0.3);
                    --transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                }

                * { box-sizing: border-box; margin: 0; padding: 0; }

                body {
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    color: var(--text-primary);
                    background-color: var(--bg);
                    line-height: 1.5;
                    padding: 16px;
                }

                .mc-layout {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    max-width: 1000px;
                    margin: 0 auto;
                }

                /* Header Card */
                .mc-header-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    padding: 20px;
                    box-shadow: var(--shadow-sm);
                    display: ${hasStruct ? 'block' : 'none'};
                }

                .mc-header-content {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .mc-header-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .mc-struct-icon {
                    width: 48px;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--primary-bg);
                    border-radius: var(--radius-md);
                    font-size: 24px;
                }

                .mc-struct-name {
                    font-size: 20px;
                    font-weight: 600;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .mc-struct-type {
                    font-size: 11px;
                    font-weight: 500;
                    padding: 3px 10px;
                    border-radius: var(--radius-full);
                    text-transform: uppercase;
                }

                .mc-struct-type.struct {
                    background: var(--primary-bg);
                    color: var(--primary);
                }

                .mc-struct-type.union {
                    background: rgba(197, 134, 192, 0.12);
                    color: var(--secondary);
                }

                .mc-struct-meta {
                    font-size: 13px;
                    color: var(--text-secondary);
                    margin-top: 4px;
                }

                .mc-header-actions {
                    display: flex;
                    gap: 8px;
                }

                /* Input Card */
                .mc-input-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    padding: 20px;
                    box-shadow: var(--shadow-sm);
                }

                .mc-input-row {
                    display: flex;
                    gap: 12px;
                    align-items: stretch;
                }

                .mc-input-group {
                    flex: 1;
                    display: flex;
                    align-items: stretch;
                    background: var(--input-bg);
                    border: 2px solid var(--input-border);
                    border-radius: var(--radius-md);
                    overflow: hidden;
                    transition: all var(--transition);
                }

                .mc-input-group:focus-within {
                    border-color: var(--primary);
                    box-shadow: 0 0 0 4px var(--primary-bg);
                }

                .mc-input-prefix {
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    background: rgba(0, 0, 0, 0.2);
                    color: var(--primary);
                    font-family: var(--vscode-editor-font-family);
                    font-weight: 700;
                    font-size: 16px;
                    border-right: 1px solid var(--input-border);
                }

                .mc-input {
                    flex: 1;
                    padding: 14px 16px;
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 18px;
                    font-weight: 500;
                    letter-spacing: 1px;
                }

                .mc-input:focus {
                    outline: none;
                }

                .mc-input::placeholder {
                    color: var(--text-muted);
                    font-weight: 400;
                }

                .mc-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 14px 24px;
                    font-size: 14px;
                    font-weight: 600;
                    border: none;
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: all var(--transition);
                    font-family: inherit;
                }

                .mc-btn-primary {
                    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
                    color: white;
                    box-shadow: 0 4px 12px rgba(78, 201, 176, 0.35);
                }

                .mc-btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(78, 201, 176, 0.45);
                }

                .mc-btn-primary:active {
                    transform: translateY(0);
                }

                .mc-btn-icon {
                    width: 36px;
                    height: 36px;
                    padding: 0;
                    background: transparent;
                    color: var(--text-secondary);
                    border-radius: var(--radius-sm);
                }

                .mc-btn-icon:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                /* Empty State */
                .mc-empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 24px;
                    text-align: center;
                    min-height: 350px;
                }

                .mc-empty-icon {
                    font-size: 64px;
                    margin-bottom: 20px;
                    opacity: 0.6;
                }

                .mc-empty-title {
                    font-size: 20px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 8px;
                }

                .mc-empty-text {
                    font-size: 14px;
                    color: var(--text-secondary);
                    margin-bottom: 32px;
                    max-width: 320px;
                }

                .mc-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    text-align: left;
                    width: 100%;
                    max-width: 320px;
                    padding: 20px;
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                }

                .mc-step {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .mc-step-num {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--primary-bg);
                    color: var(--primary);
                    border-radius: 50%;
                    font-size: 12px;
                    font-weight: 700;
                    flex-shrink: 0;
                }

                .mc-step-text {
                    font-size: 13px;
                    color: var(--text-primary);
                }

                /* Bit Field Visualization Card */
                .mc-bitmap-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    box-shadow: var(--shadow-sm);
                    display: none;
                }

                .mc-bitmap-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 20px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
                    border-bottom: 1px solid var(--border);
                }

                .mc-bitmap-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .mc-bitmap-icon {
                    font-size: 16px;
                    color: var(--primary);
                }

                .mc-bitmap-full-value {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 14px;
                    color: var(--accent);
                    font-weight: 600;
                }

                .mc-bitmap-body {
                    padding: 16px;
                }

                .mc-bitmap {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.15);
                    border-radius: var(--radius-md);
                }

                .mc-bit-block {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    padding: 8px;
                    border-radius: var(--radius-sm);
                    cursor: pointer;
                    transition: all var(--transition);
                    min-width: 60px;
                }

                .mc-bit-block:hover {
                    transform: translateY(-3px);
                    background: rgba(255, 255, 255, 0.05);
                }

                .mc-bit-block-bar {
                    width: 100%;
                    height: 36px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    font-weight: 700;
                    color: rgba(0, 0, 0, 0.7);
                    transition: all var(--transition);
                    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.2);
                }

                .mc-bit-block-bar:hover {
                    filter: brightness(1.15);
                    transform: scaleY(1.1);
                }

                .mc-bit-block.struct .mc-bit-block-bar { background: linear-gradient(135deg, #4EC9B0, #3DB8A0); }
                .mc-bit-block.union .mc-bit-block-bar { background: linear-gradient(135deg, #C586C0, #B575B0); }
                .mc-bit-block.uint .mc-bit-block-bar { background: linear-gradient(135deg, #9CDCFE, #7BC4F8); }
                .mc-bit-block.bool .mc-bit-block-bar { background: linear-gradient(135deg, #569CD6, #4A8BC4); }

                .mc-bit-block-name {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-primary);
                    max-width: 70px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .mc-bit-block-value {
                    font-size: 10px;
                    color: var(--text-secondary);
                    font-family: var(--vscode-editor-font-family);
                }

                .mc-bit-legend {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid var(--border);
                }

                .mc-bit-legend-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 11px;
                    color: var(--text-secondary);
                }

                .mc-bit-legend-color {
                    width: 14px;
                    height: 14px;
                    border-radius: 3px;
                }

                /* Fields Card */
                .mc-fields-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    box-shadow: var(--shadow-sm);
                    display: none;
                }

                .mc-fields-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 20px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
                    border-bottom: 1px solid var(--border);
                }

                .mc-fields-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .mc-fields-icon {
                    font-size: 16px;
                    color: var(--primary);
                }

                .mc-fields-count {
                    font-size: 11px;
                    padding: 3px 10px;
                    background: var(--primary-bg);
                    color: var(--primary);
                    border-radius: var(--radius-full);
                    font-weight: 600;
                }

                /* Search */
                .mc-search-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border);
                    border-radius: var(--radius-lg);
                    padding: 12px;
                    box-shadow: var(--shadow-sm);
                }

                .mc-search {
                    position: relative;
                }

                .mc-search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 14px;
                    color: var(--text-muted);
                    pointer-events: none;
                }

                .mc-search-input {
                    width: 100%;
                    padding: 10px 36px;
                    border: 1px solid var(--input-border);
                    border-radius: var(--radius-md);
                    background: var(--input-bg);
                    color: var(--text-primary);
                    font-size: 13px;
                    transition: all var(--transition);
                }

                .mc-search-input:focus {
                    outline: none;
                    border-color: var(--primary);
                    box-shadow: 0 0 0 3px var(--primary-bg);
                }

                .mc-search-input::placeholder {
                    color: var(--text-muted);
                }

                /* Fields List */
                .mc-fields-list {
                    max-height: 400px;
                    overflow-y: auto;
                }

                .mc-field-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    border-bottom: 1px solid var(--border);
                    transition: all var(--transition);
                }

                .mc-field-row:last-child {
                    border-bottom: none;
                }

                .mc-field-row:hover {
                    background: var(--hover-bg);
                }

                .mc-field-expand {
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    color: var(--text-muted);
                    cursor: pointer;
                    transition: transform var(--transition);
                }

                .mc-field-expand.expanded {
                    transform: rotate(90deg);
                }

                .mc-field-icon {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                    box-shadow: 0 0 6px currentColor;
                }

                .mc-field-icon.struct { background: var(--primary); color: var(--primary); }
                .mc-field-icon.union { background: var(--secondary); color: var(--secondary); }
                .mc-field-icon.uint { background: #9CDCFE; color: #9CDCFE; }
                .mc-field-icon.bool { background: #569CD6; color: #569CD6; }

                .mc-field-name {
                    flex: 1;
                    min-width: 0;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .mc-field-type-badge {
                    font-size: 10px;
                    font-weight: 600;
                    padding: 3px 8px;
                    border-radius: var(--radius-sm);
                    text-transform: uppercase;
                    font-family: var(--vscode-editor-font-family);
                }

                .mc-field-type-badge.struct {
                    background: var(--primary-bg);
                    color: var(--primary);
                }

                .mc-field-type-badge.union {
                    background: rgba(197, 134, 192, 0.12);
                    color: var(--secondary);
                }

                .mc-field-type-badge.uint,
                .mc-field-type-badge.int {
                    background: rgba(156, 220, 254, 0.12);
                    color: #9CDCFE;
                }

                .mc-field-type-badge.bool {
                    background: rgba(86, 156, 214, 0.12);
                    color: #569CD6;
                }

                .mc-field-value-input {
                    width: 70px;
                    padding: 6px 10px;
                    background: var(--input-bg);
                    border: 1px solid var(--input-border);
                    border-radius: var(--radius-sm);
                    color: var(--text-primary);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    font-weight: 500;
                    text-align: right;
                    transition: all var(--transition);
                }

                .mc-field-value-input:focus {
                    outline: none;
                    border-color: var(--primary);
                    box-shadow: 0 0 0 3px var(--primary-bg);
                }

                .mc-field-hex {
                    min-width: 70px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    color: var(--accent);
                    text-align: right;
                    font-weight: 500;
                }

                .mc-field-binary {
                    min-width: 90px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    color: var(--text-muted);
                    letter-spacing: 0.5px;
                    text-align: right;
                }

                .mc-field-bits {
                    min-width: 50px;
                    font-size: 11px;
                    color: var(--text-secondary);
                    text-align: right;
                }

                .mc-field-copy {
                    width: 28px;
                    height: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    border-radius: var(--radius-sm);
                    color: var(--text-muted);
                    cursor: pointer;
                    opacity: 0;
                    transition: all var(--transition);
                    font-size: 12px;
                }

                .mc-field-row:hover .mc-field-copy {
                    opacity: 1;
                }

                .mc-field-copy:hover {
                    background: var(--hover-bg);
                    color: var(--primary);
                }

                /* Nested fields */
                .mc-field-children {
                    display: none;
                    margin-left: 32px;
                    border-left: 2px solid var(--border);
                    padding-left: 12px;
                }

                .mc-field-children.expanded {
                    display: block;
                }

                /* Highlight */
                .mc-field-row.highlighted {
                    background: var(--primary-bg);
                    border-color: var(--primary-border);
                }

                /* Export section */
                .mc-export-row {
                    display: flex;
                    gap: 8px;
                    padding: 16px 20px;
                    border-top: 1px solid var(--border);
                    justify-content: flex-end;
                }

                /* Animations */
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(-10px); }
                    to { opacity: 1; transform: translateX(0); }
                }

                .mc-animate-fade {
                    animation: fadeIn 0.3s ease;
                }

                .mc-field-row {
                    animation: slideIn 0.2s ease;
                }

                /* Responsive */
                @media (max-width: 768px) {
                    .mc-input-row {
                        flex-direction: column;
                    }

                    .mc-btn-primary {
                        width: 100%;
                    }

                    .mc-field-row {
                        flex-wrap: wrap;
                    }

                    .mc-field-binary {
                        display: none;
                    }
                }
            </style>
        </head>
        <body>
            <div class="mc-layout">
                <!-- Empty State -->
                <div id="emptyState" class="mc-empty-state" style="display: ${hasStruct ? 'none' : 'flex'}">
                    <div class="mc-empty-icon">📊</div>
                    <div class="mc-empty-title">Struct Parser</div>
                    <div class="mc-empty-text">Select a struct from the sidebar to start parsing hex values</div>
                    <div class="mc-steps">
                        <div class="mc-step">
                            <span class="mc-step-num">1</span>
                            <span class="mc-step-text">Import JSON file from sidebar</span>
                        </div>
                        <div class="mc-step">
                            <span class="mc-step-num">2</span>
                            <span class="mc-step-text">Select a struct from the list</span>
                        </div>
                        <div class="mc-step">
                            <span class="mc-step-num">3</span>
                            <span class="mc-step-text">Enter hex value and parse</span>
                        </div>
                    </div>
                </div>

                <!-- Header Card -->
                <div id="headerCard" class="mc-header-card" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="mc-header-content">
                        <div class="mc-header-info">
                            <div class="mc-struct-icon">📐</div>
                            <div>
                                <div class="mc-struct-name">
                                    <span>${structName}</span>
                                    <span class="mc-struct-type ${structType}">${structType}</span>
                                </div>
                                <div class="mc-struct-meta">${structSize} bits total</div>
                            </div>
                        </div>
                        <div class="mc-header-actions">
                            <button id="btnCopyDef" class="mc-btn mc-btn-icon" title="Copy Definition">📋</button>
                        </div>
                    </div>
                </div>

                <!-- Input Card -->
                <div id="inputCard" class="mc-input-card" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="mc-input-row">
                        <div class="mc-input-group">
                            <span class="mc-input-prefix">0x</span>
                            <input type="text" id="hexInput" class="mc-input" placeholder="Enter hex value to parse" maxlength="16">
                        </div>
                        <button id="btnParse" class="mc-btn mc-btn-primary">
                            <span>▶</span>
                            <span>Parse</span>
                        </button>
                    </div>
                </div>

                <!-- Search Card -->
                <div id="searchCard" class="mc-search-card" style="display: ${hasStruct ? 'block' : 'none'}">
                    <div class="mc-search">
                        <span class="mc-search-icon">🔍</span>
                        <input type="text" id="searchInput" class="mc-search-input" placeholder="Search fields...">
                    </div>
                </div>

                <!-- Bit Field Visualization Card -->
                <div id="bitmapCard" class="mc-bitmap-card">
                    <div class="mc-bitmap-header">
                        <div class="mc-bitmap-title">
                            <span class="mc-bitmap-icon">📊</span>
                            <span>Bit Field Visualization</span>
                        </div>
                        <span id="fullValueDisplay" class="mc-bitmap-full-value"></span>
                    </div>
                    <div class="mc-bitmap-body">
                        <div id="bitfieldViz" class="mc-bitmap"></div>
                        <div id="bitLegend" class="mc-bit-legend"></div>
                    </div>
                </div>

                <!-- Fields Card -->
                <div id="fieldsCard" class="mc-fields-card">
                    <div class="mc-fields-header">
                        <div class="mc-fields-title">
                            <span class="mc-fields-icon">📋</span>
                            <span>Parsed Fields</span>
                        </div>
                        <span id="fieldsCount" class="mc-fields-count">0</span>
                    </div>
                    <div id="fieldsList" class="mc-fields-list"></div>
                    <div id="exportRow" class="mc-export-row" style="display: none;">
                        <button id="btnExport" class="mc-btn mc-btn-primary mc-btn-sm">📤 Export Results</button>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentStructName = '${structName.replace(/'/g, "\\'")}';
                let currentFields = [];
                let expandedNodes = new Set();

                document.addEventListener('DOMContentLoaded', function() {
                    setupEventListeners();
                });

                function setupEventListeners() {
                    document.getElementById('btnParse')?.addEventListener('click', parseValue);
                    document.getElementById('hexInput')?.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') parseValue();
                    });
                    document.getElementById('searchInput')?.addEventListener('input', (e) => {
                        filterFields(e.target.value);
                    });
                    document.getElementById('btnCopyDef')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'copy', text: '${structName}' });
                    });
                    document.getElementById('btnExport')?.addEventListener('click', () => {
                        showExportMenu();
                    });
                    document.getElementById('fieldsList')?.addEventListener('click', handleFieldClick);
                    document.getElementById('fieldsList')?.addEventListener('input', handleFieldInput);
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
                    vscode.postMessage({ command: 'parse', hexValue, structName: currentStructName });
                }

                function filterFields(term) {
                    const rows = document.querySelectorAll('.mc-field-row');
                    const lowerTerm = term.toLowerCase();
                    rows.forEach(row => {
                        const name = row.getAttribute('data-name') || '';
                        const type = row.getAttribute('data-type') || '';
                        const match = name.toLowerCase().includes(lowerTerm) || type.toLowerCase().includes(lowerTerm);
                        row.style.display = match ? '' : 'none';
                    });
                }

                function handleFieldClick(e) {
                    const expand = e.target.closest('.mc-field-expand');
                    if (expand) {
                        const fieldName = expand.getAttribute('data-field');
                        const children = document.querySelector('.mc-field-children[data-parent="' + fieldName + '"]');
                        if (children) {
                            children.classList.toggle('expanded');
                            expand.classList.toggle('expanded');
                        }
                    }
                    const copyBtn = e.target.closest('.mc-field-copy');
                    if (copyBtn) {
                        const value = copyBtn.getAttribute('data-value');
                        vscode.postMessage({ command: 'copy', text: value });
                    }
                }

                function handleFieldInput(e) {
                    if (e.target.classList.contains('mc-field-value-input')) {
                        const fieldName = e.target.getAttribute('data-field');
                        const bits = parseInt(e.target.getAttribute('data-bits'));
                        const newValue = parseInt(e.target.value);
                        if (isNaN(newValue)) return;
                        const maxVal = (1 << bits) - 1;
                        if (newValue < 0 || newValue > maxVal) {
                            vscode.postMessage({ command: 'alert', text: 'Value out of range (0-' + maxVal + ')' });
                            return;
                        }
                        vscode.postMessage({ command: 'updateField', fieldPath: [fieldName], newValue });
                    }
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
                            if (message.actualHexValue) {
                                const hexInput = document.getElementById('hexInput');
                                if (hexInput) hexInput.value = message.actualHexValue;
                            }
                            break;
                        case 'fieldUpdated':
                            updateFieldDisplay(message);
                            break;
                    }
                });

                function displayResults(data) {
                    currentFields = data.fields;
                    if (data.error) {
                        vscode.postMessage({ command: 'alert', text: data.error });
                        return;
                    }
                    renderBitFieldVisualization(data.fields, data.binaryValue);
                    renderFieldsList(data.fields);
                    document.getElementById('bitmapCard').style.display = 'block';
                    document.getElementById('fieldsCard').style.display = 'block';
                    document.getElementById('exportRow').style.display = 'flex';
                    document.getElementById('fullValueDisplay').textContent = data.actualHexValue || data.hexValue;
                }

                function renderBitFieldVisualization(fields, binaryValue) {
                    const container = document.getElementById('bitfieldViz');
                    const legend = document.getElementById('bitLegend');
                    if (!container) return;

                    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
                    const colorMap = {};
                    let colorIndex = 0;

                    let html = '';
                    const processedFields = [];

                    function processFields(fields, startBit) {
                        fields.forEach(field => {
                            const typeClass = field.type === 'struct' ? 'struct' :
                                             field.type === 'union' ? 'union' :
                                             field.type === 'bool' ? 'bool' : 'uint';

                            if (!colorMap[field.type]) {
                                colorMap[field.type] = colors[colorIndex % colors.length];
                                colorIndex++;
                            }

                            const bits = field.bits;
                            const value = field.value || 0;
                            const hexVal = field.hex || '0x' + value.toString(16).toUpperCase();

                            processedFields.push({
                                name: field.name,
                                type: field.type,
                                typeClass,
                                bits,
                                value,
                                hex: hexVal,
                                color: colorMap[field.type]
                            });

                            if (field.children && field.children.length > 0) {
                                processFields(field.children, 0);
                            }
                        });
                    }

                    processFields(fields, 0);

                    processedFields.forEach(field => {
                        const widthPercent = Math.max(60, field.bits * 3);
                        html += \`
                            <div class="mc-bit-block \${field.typeClass}" title="\${field.name}: \${field.value} (\${field.hex})">
                                <div class="mc-bit-block-bar" style="background: \${field.color}; min-width: \${widthPercent}px;">
                                    \${field.bits >= 4 ? field.value.toString(2) : ''}
                                </div>
                                <div class="mc-bit-block-name">\${field.name}</div>
                                <div class="mc-bit-block-value">\${field.hex} (\${field.bits}b)</div>
                            </div>
                        \`;
                    });

                    container.innerHTML = html;

                    let legendHtml = '';
                    Object.entries(colorMap).forEach(([type, color]) => {
                        legendHtml += \`
                            <div class="mc-bit-legend-item">
                                <span class="mc-bit-legend-color" style="background: \${color}"></span>
                                <span>\${type}</span>
                            </div>
                        \`;
                    });
                    if (legend) legend.innerHTML = legendHtml;
                }

                function renderFieldsList(fields) {
                    const container = document.getElementById('fieldsList');
                    const countEl = document.getElementById('fieldsCount');
                    if (!container) return;

                    let count = 0;
                    let html = '';

                    function renderFieldRow(field, level = 0) {
                        const hasChildren = field.children && field.children.length > 0;
                        const fieldId = field.name.replace(/[^a-zA-Z0-9]/g, '_');
                        const typeClass = field.type === 'struct' ? 'struct' :
                                        field.type === 'union' ? 'union' :
                                        field.type === 'bool' ? 'bool' : 'uint';
                        const maxVal = (1 << field.bits) - 1;

                        count++;
                        html += \`
                            <div class="mc-field-row" data-name="\${field.name}" data-type="\${field.type}">
                                <div class="mc-field-expand \${hasChildren ? '' : 'no-children'}" data-field="\${field.name}">
                                    \${hasChildren ? '▶' : ''}
                                </div>
                                <span class="mc-field-icon \${typeClass}"></span>
                                <span class="mc-field-name">\${field.name}</span>
                                <span class="mc-field-type-badge \${typeClass}">\${field.type}</span>
                                <input type="number" class="mc-field-value-input" data-field="\${field.name}" data-bits="\${field.bits}" min="0" max="\${maxVal}" value="\${field.value}">
                                <span class="mc-field-hex">\${field.hex}</span>
                                <span class="mc-field-binary">\${field.binary || ''}</span>
                                <span class="mc-field-bits">\${field.bits}b</span>
                                <button class="mc-field-copy" data-value="\${field.hex}">📋</button>
                            </div>
                        \`;

                        if (hasChildren) {
                            html += \`<div class="mc-field-children" data-parent="\${field.name}">\`;
                            field.children.forEach(child => renderFieldRow(child, level + 1));
                            html += \`</div>\`;
                        }
                    }

                    fields.forEach(field => renderFieldRow(field));

                    container.innerHTML = html;
                    if (countEl) countEl.textContent = count;
                }

                function updateFieldDisplay(message) {
                    const simpleFieldId = message.fieldPath[message.fieldPath.length - 1];
                    const rows = document.querySelectorAll('.mc-field-row[data-name="' + simpleFieldId + '"]');
                    rows.forEach(row => {
                        const input = row.querySelector('.mc-field-value-input');
                        const hex = row.querySelector('.mc-field-hex');
                        if (input) input.value = message.newValue;
                        if (hex) hex.textContent = message.newHex;
                    });
                    if (message.fullHexValue) {
                        document.getElementById('fullValueDisplay').textContent = message.fullHexValue;
                        const hexInput = document.getElementById('hexInput');
                        if (hexInput) hexInput.value = message.fullHexValue;
                    }
                }
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
                --sp-radius: 8px;
                --sp-radius-sm: 4px;
                --sp-shadow-sm: 0 1px 2px rgba(0,0,0,0.08);
                --sp-shadow-md: 0 2px 8px rgba(0,0,0,0.12);
                --sp-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                
                /* Type Colors - Enhanced */
                --sp-type-struct: #4EC9B0;
                --sp-type-struct-bg: rgba(78, 201, 176, 0.1);
                --sp-type-union: #C586C0;
                --sp-type-union-bg: rgba(197, 134, 192, 0.1);
                --sp-type-uint: #569CD6;
                --sp-type-uint-bg: rgba(86, 156, 214, 0.1);
                --sp-type-bool: #DCDCAA;
                --sp-type-bool-bg: rgba(220, 220, 170, 0.1);
                
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
                transition: all 0.2s ease;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }
            
            .sp-btn:hover:not(:disabled) {
                background-color: var(--vscode-button-hoverBackground);
                transform: translateY(-1px);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
            }
            
            .sp-btn:active:not(:disabled) {
                transform: translateY(0);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }
            
            .sp-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .sp-btn-primary {
                background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
                font-weight: 600;
                padding: var(--sp-sm) var(--sp-lg);
            }
            
            .sp-btn-primary:hover:not(:disabled) {
                filter: brightness(1.1);
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
                box-shadow: none;
            }
            
            .sp-btn-icon:hover {
                background-color: var(--vscode-toolbar-hoverBackground);
                transform: none;
                box-shadow: none;
            }
            
            .sp-btn-text {
                background: transparent;
                color: var(--vscode-textLink-foreground);
                font-size: 12px;
                padding: var(--sp-xs) var(--sp-sm);
                box-shadow: none;
            }
            
            .sp-btn-text:hover {
                background: transparent;
                transform: none;
                box-shadow: none;
                text-decoration: underline;
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
                padding: 60px 24px;
                text-align: center;
                min-height: 400px;
            }
            
            .sp-empty-state-content {
                max-width: 400px;
            }
            
            .sp-empty-icon {
                margin-bottom: 24px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.6;
            }
            
            .sp-empty-icon svg {
                width: 64px;
                height: 64px;
            }
            
            .sp-empty-text {
                font-size: 20px;
                font-weight: 600;
                color: var(--vscode-foreground);
                margin-bottom: 8px;
            }
            
            .sp-empty-hint {
                font-size: 13px;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 32px;
            }
            
            .sp-empty-steps {
                display: flex;
                flex-direction: column;
                gap: 12px;
                text-align: left;
                padding: 20px;
                background-color: var(--vscode-panel-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: var(--sp-radius);
            }
            
            .sp-step {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .sp-step-number {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                font-size: 12px;
                font-weight: 600;
                flex-shrink: 0;
            }
            
            .sp-step-text {
                font-size: 13px;
                color: var(--vscode-foreground);
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
                transition: border-color 0.2s ease;
            }
            
            .sp-input-group:focus-within {
                border-color: var(--vscode-focusBorder);
            }
            
            .sp-input-prefix {
                padding: var(--sp-sm) var(--sp-md);
                background-color: var(--vscode-panel-background);
                color: var(--vscode-descriptionForeground);
                font-family: var(--vscode-editor-font-family);
                font-weight: 500;
                border-right: 1px solid var(--vscode-input-border);
                user-select: none;
            }
            
            .sp-input {
                flex: 1;
                padding: var(--sp-sm) var(--sp-md);
                border: none;
                background: transparent;
                color: var(--vscode-input-foreground);
                font-family: var(--vscode-editor-font-family);
                font-size: 14px;
                font-weight: 500;
            }
            
            .sp-input:focus {
                outline: none;
            }
            
            .sp-input::placeholder {
                color: var(--vscode-input-placeholderForeground);
                opacity: 0.6;
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
            
            /* ===== Section Header ===== */
            .sp-section-title-wrapper {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
            }
            
            .sp-bit-count {
                font-size: 11px;
                color: var(--vscode-badge-foreground);
                padding: 2px 8px;
                background: var(--vscode-badge-background);
                border-radius: 12px;
                font-weight: 500;
            }
            
            /* ===== Bit Field Visualization ===== */
            .sp-bitfield-viz {
                padding: var(--sp-md);
                background: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-panel-border);
                overflow-x: auto;
            }
            
            .sp-bitfield-bar {
                display: flex;
                height: 32px;
                border-radius: var(--sp-radius-sm);
                overflow: hidden;
                box-shadow: var(--sp-shadow-sm);
            }
            
            .sp-bitfield-segment {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 var(--sp-xs);
                font-size: 10px;
                font-weight: 600;
                color: var(--vscode-editor-background);
                cursor: pointer;
                transition: var(--sp-transition);
                position: relative;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .sp-bitfield-segment:hover {
                filter: brightness(1.2);
                transform: scaleY(1.05);
            }
            
            .sp-bitfield-segment.struct { background: var(--sp-type-struct); }
            .sp-bitfield-segment.union { background: var(--sp-type-union); }
            .sp-bitfield-segment.uint { background: var(--sp-type-uint); }
            .sp-bitfield-segment.bool { background: var(--sp-type-bool); }
            
            .sp-field-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--sp-sm) var(--sp-md);
                background-color: var(--vscode-panel-background);
                border-bottom: 2px solid var(--vscode-panel-border);
                font-size: 11px;
                font-weight: 600;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .sp-field-header-main {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                flex: 2;
            }
            
            .sp-field-header-values {
                display: flex;
                align-items: center;
                gap: var(--sp-md);
                flex: 1;
                justify-content: flex-end;
            }
            
            .sp-field-h-expand { width: 16px; }
            .sp-field-h-type { min-width: 70px; }
            .sp-field-h-name { flex: 1; }
            .sp-field-h-meta { min-width: 80px; text-align: right; }
            .sp-field-h-dec, .sp-field-h-hex, .sp-field-h-input { 
                min-width: 60px; 
                text-align: center; 
            }
            
            .sp-field-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px var(--sp-md);
                border-bottom: 1px solid var(--vscode-panel-border);
                transition: var(--sp-transition);
                gap: var(--sp-md);
            }
            
            .sp-field-row:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .sp-field-row:last-child {
                border-bottom: none;
            }
            
            .sp-field-row:nth-child(even) {
                background-color: rgba(255, 255, 255, 0.02);
            }
            
            .sp-field-row:nth-child(even):hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .sp-field-main {
                display: flex;
                align-items: center;
                gap: var(--sp-sm);
                flex: 2;
                min-width: 0;
            }
            
            .sp-field-values {
                display: flex;
                align-items: center;
                gap: var(--sp-md);
                flex: 1;
                justify-content: flex-end;
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
                color: var(--vscode-descriptionForeground);
                flex-shrink: 0;
            }
            
            .sp-expand-icon.expandable {
                cursor: pointer;
            }
            
            .sp-expand-icon.expandable:hover {
                color: var(--vscode-foreground);
            }
            
            .sp-expand-icon.expanded {
                transform: rotate(90deg);
            }
            
            .sp-type-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex-shrink: 0;
                box-shadow: 0 0 0 2px var(--vscode-editor-background);
            }
            
            .sp-type-indicator.struct { 
                background: var(--sp-type-struct);
                box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 4px var(--sp-type-struct-bg);
            }
            .sp-type-indicator.union { 
                background: var(--sp-type-union);
                box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 4px var(--sp-type-union-bg);
            }
            .sp-type-indicator.uint { 
                background: var(--sp-type-uint);
                box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 4px var(--sp-type-uint-bg);
            }
            .sp-type-indicator.bool { 
                background: var(--sp-type-bool);
                box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 4px var(--sp-type-bool-bg);
            }
            
            .sp-field-name {
                font-weight: 600;
                font-size: 13px;
                color: var(--vscode-foreground);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
                min-width: 0;
            }
            
            .sp-field-type {
                font-size: 11px;
                font-weight: 500;
                padding: 2px 8px;
                border-radius: var(--sp-radius-sm);
                flex-shrink: 0;
                font-family: var(--vscode-editor-font-family);
            }
            
            .sp-field-type.struct { 
                color: var(--sp-type-struct);
                background: var(--sp-type-struct-bg);
            }
            .sp-field-type.union { 
                color: var(--sp-type-union);
                background: var(--sp-type-union-bg);
            }
            .sp-field-type.uint { 
                color: var(--sp-type-uint);
                background: var(--sp-type-uint-bg);
            }
            .sp-field-type.bool { 
                color: var(--sp-type-bool);
                background: var(--sp-type-bool-bg);
            }
            
            .sp-field-meta {
                display: flex;
                align-items: center;
                gap: var(--sp-xs);
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                font-family: var(--vscode-editor-font-family);
                flex-shrink: 0;
            }
            
            .sp-field-bits {
                font-weight: 600;
                color: var(--vscode-foreground);
            }
            
            .sp-field-offset::before {
                content: '@';
                opacity: 0.5;
            }
            
            .sp-field-dec {
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
                font-weight: 600;
                color: var(--vscode-numberLiteral-foreground);
                min-width: 50px;
                text-align: center;
                padding: 4px 8px;
                background: var(--vscode-editor-background);
                border-radius: var(--sp-radius-sm);
            }
            
            .sp-field-hex {
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                font-weight: 500;
                color: var(--vscode-textPreformat-foreground);
                min-width: 60px;
                text-align: center;
                padding: 4px 8px;
                background: var(--vscode-editor-background);
                border-radius: var(--sp-radius-sm);
            }
            
            .sp-field-input {
                width: 80px;
                padding: 6px 10px;
                border: 1px solid var(--vscode-input-border);
                border-radius: var(--sp-radius-sm);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
                font-weight: 500;
                text-align: center;
                transition: var(--sp-transition);
            }
            
            .sp-field-input:hover {
                border-color: var(--vscode-focusBorder);
            }
            
            .sp-field-input:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
                box-shadow: 0 0 0 2px var(--vscode-focusBorder);
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
                border-left: 2px solid var(--vscode-panel-border);
                padding-left: var(--sp-sm);
                background: rgba(0, 0, 0, 0.02);
            }
            
            .sp-children.expanded {
                display: block;
                animation: slideDown 0.2s ease-out;
            }
            
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-8px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
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
                        // 回刷实际使用的16进制值到输入框
                        if (message.actualHexValue) {
                            const hexInput = document.getElementById('hexInput');
                            if (hexInput) {
                                hexInput.value = message.actualHexValue;
                            }
                        }
                        break;
                    case 'fieldUpdated':
                        // 立即更新DEC、HEX列和输入框的值
                        const simpleFieldId = message.fieldPath[message.fieldPath.length - 1].replace(/[^a-zA-Z0-9]/g, '_');
                        
                        console.log('[StructParser] Updating field:', simpleFieldId, message);
                        
                        const decEl = document.getElementById('val-dec-' + simpleFieldId);
                        const hexEl = document.getElementById('val-hex-' + simpleFieldId);
                        const inputEl = document.getElementById('input-' + simpleFieldId);
                        
                        if (decEl) {
                            decEl.textContent = message.newValue;
                            console.log('[StructParser] Updated DEC:', decEl.textContent);
                        }
                        if (hexEl) {
                            hexEl.textContent = message.newHex;
                            console.log('[StructParser] Updated HEX:', hexEl.textContent);
                        }
                        if (inputEl) {
                            inputEl.value = message.newValue;
                            console.log('[StructParser] Updated Input:', inputEl.value);
                        }
                        
                        // 如果有完整的16进制值，也更新输入框
                        if (message.fullHexValue) {
                            const hexInput = document.getElementById('hexInput');
                            if (hexInput) {
                                hexInput.value = message.fullHexValue;
                                console.log('[StructParser] Updated HexInput:', hexInput.value);
                            }
                        }
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
                
                // Render bit field visualization
                renderBitFieldVisualization(data.struct.fields, data.struct.size_bits);
                
                // Show export button
                const exportContainer = document.getElementById('exportContainer');
                if (exportContainer) {
                    exportContainer.style.display = 'block';
                }
            }
            
            function renderBitFieldVisualization(fields, totalBits) {
                const vizContainer = document.getElementById('bitFieldViz');
                if (!vizContainer) return;
                
                let html = '<div class="sp-bitfield-bar">';
                
                fields.forEach(field => {
                    const widthPercent = (field.bits / totalBits * 100).toFixed(2);
                    const typeClass = field.type === 'struct' ? 'struct' : 
                                     field.type === 'union' ? 'union' : 
                                     field.type === 'bool' ? 'bool' : 'uint';
                    
                    html += '<div class="sp-bitfield-segment ' + typeClass + '" ';
                    html += 'style="width: ' + widthPercent + '%" ';
                    html += 'title="' + field.name + ' (' + field.bits + ' bits)" ';
                    html += 'data-field="' + field.name + '">';
                    
                    if (widthPercent > 8) {
                        html += field.name;
                    } else if (widthPercent > 4) {
                        html += field.name.substring(0, 3);
                    }
                    
                    html += '</div>';
                });
                
                html += '</div>';
                vizContainer.innerHTML = html;
                vizContainer.style.display = 'block';
                
                // Add click handlers to segments
                vizContainer.querySelectorAll('.sp-bitfield-segment').forEach(segment => {
                    segment.addEventListener('click', () => {
                        const fieldName = segment.getAttribute('data-field');
                        const fieldRow = document.querySelector('.sp-field-row[data-field="' + fieldName + '"]');
                        if (fieldRow) {
                            fieldRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            fieldRow.style.background = 'var(--vscode-list-activeSelectionBackground)';
                            setTimeout(() => {
                                fieldRow.style.background = '';
                            }, 1000);
                        }
                    });
                });
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
