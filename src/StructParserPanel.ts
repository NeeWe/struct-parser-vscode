import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    value?: number;
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

interface ParsedField extends StructField {
    binary: string;
    value: number;
    hex: string;
    fullHexValue: string;
    fields?: ParsedField[];
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
        if (structName && StructParserPanel.panels.has(structName)) {
            const panel = StructParserPanel.panels.get(structName)!;
            panel._panel.reveal(vscode.ViewColumn.One);
            return panel;
        }

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
                        }
                    }
                }
            }
        }
    }

    private _parseHexValue(hexValue: string, structName: string) {
        if (!structName) {
            return;
        }
        
        if (!this._structData) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: 'No struct data loaded. Please configure structParser.jsonPath in settings.'
            });
            return;
        }

        const structDef = this._structData.structs.find(s => s.type === structName) ||
                         this._structData.unions.find(s => s.type === structName);

        if (!structDef) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: `Struct '${structName}' not found`
            });
            return;
        }

        const hexClean = hexValue.replace(/^0x/i, '');
        if (!hexClean) {
            return;
        }
        const inputBits = hexClean.length * 4;
        let fullValue = BigInt('0x' + hexClean);
        
        const structBits = structDef.bits;
        
        let adjustedValue = fullValue;
        let wasAdjusted = false;
        
        if (inputBits < structBits) {
            const padding = structBits - inputBits;
            adjustedValue = fullValue << BigInt(padding);
            wasAdjusted = true;
        } else if (inputBits > structBits) {
            const excess = inputBits - structBits;
            adjustedValue = fullValue >> BigInt(excess);
            wasAdjusted = true;
        }
        
        const maxValue = (BigInt(1) << BigInt(structBits)) - BigInt(1);
        if (adjustedValue > maxValue) {
            adjustedValue = adjustedValue & maxValue;
            wasAdjusted = true;
        }
        
        const binaryValue = adjustedValue.toString(2).padStart(structBits, '0');

        const parsedFields = this._parseFields(structDef.fields, binaryValue, adjustedValue);

        this._currentParsedData = {
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            binaryValue: binaryValue
        };

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

    private _parseFields(fields: StructField[], binaryValue: string, fullValue: bigint): ParsedField[] {
        return fields.map(field => {
            const startPos = field.offset;
            const endPos = field.offset + field.bits;
            const fieldBits = binaryValue.substring(startPos, endPos);
            const fieldValue = fieldBits.length > 0 ? parseInt(fieldBits, 2) : 0;
            const fieldValueBigInt = fieldBits.length > 0 ? BigInt('0b' + fieldBits) : BigInt(0);

            const { fields: _ignored, ...fieldWithoutFields } = field;
            const parsedField: ParsedField = {
                ...fieldWithoutFields,
                binary: fieldBits,
                value: fieldValue,
                hex: '0x' + fieldValueBigInt.toString(16).toUpperCase(),
                fullHexValue: '0x' + fullValue.toString(16).toUpperCase()
            };

            if (field.fields && field.fields.length > 0) {
                parsedField.fields = this._parseFields(field.fields, binaryValue, fullValue);
            }

            return parsedField;
        });
    }

    private _updateFieldValue(fieldPath: string[], newValue: string) {
        if (!this._currentParsedData) return;

        const findField = (fields: ParsedField[], path: string[]): ParsedField | null => {
            const name = path[0];
            const field = fields.find(f => f.name === name);
            if (!field) return null;
            if (path.length === 1) return field;
            if (field.fields) return findField(field.fields as ParsedField[], path.slice(1));
            return null;
        };

        const targetField = findField(this._currentParsedData.fields, fieldPath);
        if (!targetField) return;

        const maxValue = targetField.bits >= 32 ? BigInt('4294967295') : (BigInt(1) << BigInt(targetField.bits)) - BigInt(1);
        const newValueBigInt = BigInt(newValue);
        
        if (newValueBigInt < 0n || newValueBigInt > maxValue) {
            vscode.window.showWarningMessage(`Value out of range (0-${maxValue.toString()})`);
            return;
        }

        const binaryStr = this._currentParsedData.binaryValue;
        const newBits = newValueBigInt.toString(2).padStart(targetField.bits, '0');
        const newBinaryStr =
            binaryStr.substring(0, targetField.offset) +
            newBits +
            binaryStr.substring(targetField.offset + targetField.bits);

        this._currentParsedData.binaryValue = newBinaryStr;

        const newBigInt = BigInt('0b' + newBinaryStr);
        this._currentParsedData.fields = this._parseFields(
            this._currentParsedData.struct.fields,
            newBinaryStr,
            newBigInt
        );

        const structBits = this._currentParsedData.struct.bits;
        const newHexValue = '0x' + newBigInt.toString(16).toUpperCase().padStart(Math.ceil(structBits / 4), '0');
        this._currentParsedData.hexValue = newHexValue;

        this._panel.webview.postMessage({
            command: 'parseResult',
            struct: this._currentParsedData.struct,
            fields: this._currentParsedData.fields,
            hexValue: newHexValue,
            actualHexValue: newHexValue,
            binaryValue: newBinaryStr,
            fullHexValue: newHexValue,
            adjustedValue: false
        });
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
                
                if (field.fields) {
                    searchInFields(field.fields as ParsedField[], fullPath);
                }
            });
        };

        searchInFields(this._currentParsedData.fields, []);

        this._panel.webview.postMessage({
            command: 'searchResults',
            results: results
        });
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
        this._currentParsedData = null;
        const hexDigits = Math.max(1, Math.ceil(struct.bits / 4));
        const hexValue = '0x' + '0'.repeat(hexDigits);
        this._parseHexValue(hexValue, struct.type);
        this._update();
    }

    public refreshStructList(structData: StructJson) {
        this._structData = structData;
    }

    public setHideZero(hideZero: boolean) {
        this._panel.webview.postMessage({
            command: 'setHideZero',
            hideZero
        });
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = this._currentStruct?.type || 'Struct Parser';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const hasStruct = this._currentStruct !== null;
        const structName = this._currentStruct?.type || '';
        const structBits = this._currentStruct?.bits || 0;
        const structBytes = Math.ceil(structBits / 8);
        const isUnion = this._structData?.unions?.some(u => u.type === structName) ?? false;
        const initialHexValue = this._currentParsedData?.hexValue || '';
        const initialFieldsJson = this._currentParsedData ? JSON.stringify(this._currentParsedData.fields) : '[]';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Struct Parser</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }

                body {
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    line-height: 1.5;
                }

                .main {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }

                /* Empty State */
                .empty-state {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 24px;
                    text-align: center;
                }

                .empty-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                    opacity: 0.5;
                }

                .empty-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                }

                .empty-text {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                    max-width: 280px;
                    line-height: 1.5;
                }

                .empty-steps {
                    margin-top: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    text-align: left;
                    width: 100%;
                    max-width: 280px;
                }

                .empty-step {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px;
                    background: var(--vscode-panel-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                }

                .empty-step-num {
                    width: 22px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(78, 201, 176, 0.12);
                    color: #4EC9B0;
                    border-radius: 50%;
                    font-size: 11px;
                    font-weight: 700;
                    flex-shrink: 0;
                }

                .empty-step-text {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }

                /* Content Panel */
                .content-panel {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    overflow: hidden;
                }

                /* Top Bar */
                .main-topbar {
                    padding: 12px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: var(--vscode-panel-background);
                }

                .topbar-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .topbar-struct-icon {
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(78, 201, 176, 0.12);
                    border-radius: 8px;
                    font-size: 18px;
                }

                .topbar-info h2 {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .topbar-info p {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 2px;
                }

                .type-badge {
                    font-size: 10px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: 4px;
                    text-transform: uppercase;
                }

                .type-badge.struct {
                    background: rgba(78, 201, 176, 0.15);
                    color: #4EC9B0;
                }

                .type-badge.union {
                    background: rgba(197, 134, 192, 0.15);
                    color: #C586C0;
                }

                /* Hex Input Section */
                .hex-section {
                    padding: 16px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-panel-background);
                }

                .hex-row {
                    display: flex;
                    gap: 12px;
                    align-items: stretch;
                }

                .hex-input-group {
                    flex: 1;
                    display: flex;
                    align-items: stretch;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    overflow: hidden;
                    transition: border-color 0.15s;
                }

                .hex-input-group:focus-within {
                    border-color: #4EC9B0;
                }

                .hex-prefix {
                    display: flex;
                    align-items: center;
                    padding: 0 14px;
                    background: var(--vscode-editor-background);
                    color: #4EC9B0;
                    font-family: var(--vscode-editor-font-family);
                    font-weight: 700;
                    font-size: 15px;
                    border-right: 1px solid var(--vscode-input-border);
                }

                .hex-input {
                    flex: 1;
                    padding: 10px 14px;
                    background: var(--vscode-input-background);
                    border: none;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 15px;
                    font-weight: 500;
                    letter-spacing: 1px;
                    outline: none;
                }

                .hex-input::placeholder {
                    color: var(--vscode-input-placeholderForeground);
                    font-weight: 400;
                }

                .hex-apply-btn {
                    padding: 10px 20px;
                    background: #4EC9B0;
                    color: #1e1e1e;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s;
                    font-family: var(--vscode-font-family);
                }

                .hex-apply-btn:hover {
                    background: #3DB8A0;
                }

                .hex-info {
                    margin-top: 8px;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    gap: 16px;
                }

                .hex-info .label {
                    color: var(--vscode-descriptionForeground);
                }

                .hex-info .value {
                    color: #4EC9B0;
                    font-family: var(--vscode-editor-font-family);
                    font-weight: 500;
                }

                /* Fields Section */
                .fields-section {
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .fields-header {
                    padding: 10px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: var(--vscode-panel-background);
                }

                .fields-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .fields-count {
                    background: rgba(78, 201, 176, 0.15);
                    color: #4EC9B0;
                    padding: 1px 8px;
                    border-radius: 10px;
                    font-size: 10px;
                    font-weight: 600;
                }

                .collapse-toggle-btn {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: 500;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    background: transparent;
                    color: var(--vscode-descriptionForeground);
                    cursor: pointer;
                    transition: all 0.15s;
                    font-family: var(--vscode-font-family);
                }

                .collapse-toggle-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                    color: var(--vscode-foreground);
                }

                .fields-search {
                    position: relative;
                    display: flex;
                    align-items: center;
                }

                .fields-search svg {
                    position: absolute;
                    left: 7px;
                    color: var(--vscode-descriptionForeground);
                    pointer-events: none;
                }

                .fields-search-input {
                    width: 140px;
                    padding: 3px 8px 3px 26px;
                    border: none;
                    border-bottom: 1px solid transparent;
                    border-radius: 0;
                    background: transparent;
                    color: var(--vscode-foreground);
                    font-size: 11px;
                    outline: none;
                    transition: border-color 0.15s;
                    font-family: var(--vscode-font-family);
                }

                .fields-search-input:focus {
                    border-bottom-color: #4EC9B0;
                }

                .fields-search-input::placeholder {
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.7;
                }

                .fields-tree {
                    flex: 1;
                    overflow-y: auto;
                    padding: 4px 0;
                }

                .fields-tree::-webkit-scrollbar {
                    width: 6px;
                }

                .fields-tree::-webkit-scrollbar-thumb {
                    background: var(--vscode-scrollbarSlider-background);
                    border-radius: 3px;
                }

                /* Tree Node */
                .tree-node {
                    user-select: none;
                }

                .tree-row {
                    display: grid;
                    grid-template-columns: 1fr 120px 50px 50px 120px 100px;
                    column-gap: 16px;
                    align-items: center;
                    padding: 5px 24px;
                    cursor: pointer;
                    transition: background 0.1s;
                    border-left: 2px solid transparent;
                }

                .tree-row:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .tree-row.selected {
                    background: var(--vscode-list-activeSelectionBackground);
                    border-left-color: #4EC9B0;
                }

                .tree-name-group {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                }

                .tree-indent {
                    flex-shrink: 0;
                }

                .tree-expand {
                    width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    transition: transform 0.15s;
                    flex-shrink: 0;
                }

                .tree-expand.expanded {
                    transform: rotate(90deg);
                }

                .tree-expand.leaf {
                    visibility: hidden;
                }

                .tree-icon {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    flex-shrink: 0;
                    margin-left: 6px;
                    margin-right: 10px;
                }

                .tree-icon.struct { background: #4EC9B0; }
                .tree-icon.union { background: #C586C0; }
                .tree-icon.uint { background: #9CDCFE; }
                .tree-icon.bool { background: #569CD6; }
                .tree-icon.anon { background: #666; }

                .tree-name {
                    font-size: 14px;
                    color: var(--vscode-foreground);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                    min-width: 0;
                }

                .tree-type {
                    font-size: 13px;
                    font-weight: 500;
                    padding: 2px 10px;
                    border-radius: 4px;
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    position: relative;
                }

                .tree-type:hover {
                    white-space: normal;
                    overflow: visible;
                    z-index: 10;
                    background: var(--vscode-editor-background) !important;
                    border: 1px solid var(--vscode-editor-border);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    padding: 4px 10px;
                    margin: -2px -10px;
                    border-radius: 4px;
                    max-width: 300px;
                }

                .tree-type.struct {
                    background: rgba(78, 201, 176, 0.12);
                    color: #4EC9B0;
                }

                .tree-type.union {
                    background: rgba(197, 134, 192, 0.12);
                    color: #C586C0;
                }

                .tree-type.uint,
                .tree-type.int {
                    background: rgba(156, 220, 254, 0.1);
                    color: #9CDCFE;
                }

                .tree-type.bool {
                    background: rgba(86, 156, 214, 0.1);
                    color: #569CD6;
                }

                .tree-type.anon {
                    background: rgba(100, 100, 100, 0.2);
                    color: var(--vscode-descriptionForeground);
                }

                .tree-offset {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                    font-family: var(--vscode-editor-font-family);
                    text-align: right;
                    white-space: nowrap;
                }

                .tree-bits {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                    font-family: var(--vscode-editor-font-family);
                    text-align: right;
                    white-space: nowrap;
                }

                .tree-value {
                    width: 100%;
                    padding: 4px 10px;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    font-weight: 500;
                    text-align: right;
                    outline: none;
                    transition: border-color 0.15s;
                    -moz-appearance: textfield;
                    appearance: textfield;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tree-value:hover {
                    overflow: visible;
                    white-space: normal;
                    z-index: 10;
                    position: relative;
                    min-width: 100%;
                    max-width: 300px;
                    background: var(--vscode-editor-background);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                    padding: 6px 12px;
                    margin: -2px -10px;
                }

                .tree-value::-webkit-outer-spin-button,
                .tree-value::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                }

                .tree-value:focus {
                    border-color: #4EC9B0;
                }

                .tree-hex {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    color: #75BEFF;
                    text-align: right;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    position: relative;
                }

                .tree-hex:hover {
                    white-space: normal;
                    overflow: visible;
                    z-index: 10;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-editor-border);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    padding: 4px 10px;
                    margin: -4px -10px;
                    border-radius: 4px;
                    max-width: 300px;
                    text-align: left;
                }

                .tree-spacer-value {
                }

                .tree-spacer-hex {
                }

                .tree-children {
                    overflow: hidden;
                }

                .tree-children.collapsed {
                    display: none;
                }

                .tree-node.zero-hidden {
                    display: none;
                }

                .tree-node.search-hidden {
                    display: none;
                }

                .tree-header {
                    display: grid;
                    grid-template-columns: 1fr 120px 50px 50px 120px 100px;
                    column-gap: 16px;
                    align-items: center;
                    padding: 6px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-panel-background);
                    position: sticky;
                    top: 0;
                    z-index: 1;
                }

                .tree-header .tree-name-group {
                    display: flex;
                    align-items: center;
                    min-width: 0;
                }

                .tree-header .tree-name,
                .tree-header .tree-type,
                .tree-header .tree-offset,
                .tree-header .tree-bits,
                .tree-header .tree-hex {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--vscode-descriptionForeground);
                }

                .tree-header .tree-hex {
                    text-align: right;
                }

                .tree-header .tree-hex:nth-child(5) {
                    text-align: right;
                }

                .tree-header .tree-type {
                    background: none;
                    text-align: center;
                }

                .tree-header .tree-offset,
                .tree-header .tree-bits {
                    text-align: right;
                }

                .tree-header .tree-spacer-value,
                .tree-header .tree-spacer-hex {
                    text-align: right;
                }

                .tree-header .tree-icon {
                    background: none;
                }

                /* Animations */
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .tree-node { animation: fadeIn 0.15s ease; }
            </style>
        </head>
        <body>
            <div class="main">
                <!-- Empty State -->
                <div class="empty-state" id="emptyState" style="display: ${hasStruct ? 'none' : 'flex'}">
                    <div class="empty-icon">\u26A1</div>
                    <div class="empty-title">No Struct Selected</div>
                    <div class="empty-text">Select a struct from the sidebar to view and edit its binary fields</div>
                    <div class="empty-steps">
                        <div class="empty-step">
                            <span class="empty-step-num">1</span>
                            <span class="empty-step-text">Import a JSON file with struct definitions</span>
                        </div>
                        <div class="empty-step">
                            <span class="empty-step-num">2</span>
                            <span class="empty-step-text">Select a struct from the sidebar</span>
                        </div>
                        <div class="empty-step">
                            <span class="empty-step-num">3</span>
                            <span class="empty-step-text">Enter hex value or edit fields directly</span>
                        </div>
                    </div>
                </div>

                <!-- Content Panel -->
                <div class="content-panel" id="contentPanel" style="display: ${hasStruct ? 'flex' : 'none'}">
                    <!-- Top Bar -->
                    <div class="main-topbar">
                        <div class="topbar-left">
                            <div class="topbar-struct-icon">\u26A1</div>
                            <div class="topbar-info">
                                <h2 id="structName">${structName} <span class="type-badge ${isUnion ? 'union' : 'struct'}">${isUnion ? 'union' : 'struct'}</span></h2>
                                <p id="structMeta">${structBits} bits · ${structBytes} bytes</p>
                            </div>
                        </div>
                    </div>

                    <!-- Hex Input -->
                    <div class="hex-section">
                        <div class="hex-row">
                            <div class="hex-input-group">
                                <span class="hex-prefix">0x</span>
                                <input type="text" class="hex-input" id="hexInput" placeholder="Enter hex value..." value="${initialHexValue}">
                            </div>
                            <button class="hex-apply-btn" id="btnParse">Parse</button>
                        </div>
                    </div>

                    <!-- Fields Header -->
                    <div class="fields-header">
                        <div class="fields-title">
                            <span>Parsed Fields</span>
                            <span class="fields-count" id="fieldsCount">0</span>
                        </div>
                        <div class="fields-search">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/></svg>
                            <input type="text" class="fields-search-input" id="fieldsSearchInput" placeholder="Filter fields...">
                        </div>
                        <button class="collapse-toggle-btn" id="collapseToggleBtn" title="Collapse All">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h4v4H3V3zm0 6h4v4H3V9zm6-6h4v4H9V3zm0 6h4v4H9V9z" opacity="0.3"/><path d="M1.5 1h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1zm0 13h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1z"/></svg>
                            <span id="collapseToggleLabel">Collapse All</span>
                        </button>
                    </div>

                    <!-- Column Header -->
                    <div class="tree-header">
                        <div class="tree-name-group">
                            <span class="tree-indent"></span>
                            <span class="tree-expand leaf">\u25B6</span>
                            <span class="tree-icon"></span>
                            <span class="tree-name">Name</span>
                        </div>
                        <span class="tree-type">Type</span>
                        <span class="tree-offset">Offset</span>
                        <span class="tree-bits">Bits</span>
                        <span class="tree-hex">Value</span>
                        <span class="tree-hex">Hex</span>
                    </div>

                    <!-- Fields Tree -->
                    <div class="fields-tree" id="fieldsTree"></div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentStructName = '${structName.replace(/'/g, "\\'")}';
                let currentFields = ${initialFieldsJson};
                let hideZero = false;
                let allCollapsed = false;

                document.getElementById('btnParse')?.addEventListener('click', parseValue);
                document.getElementById('hexInput')?.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') parseValue();
                });

                function expandAll() {
                    const expands = document.querySelectorAll('.tree-expand:not(.leaf)');
                    expands.forEach(el => {
                        const treeNode = el.closest('.tree-node');
                        const children = treeNode?.querySelector(':scope > .tree-children');
                        if (children) {
                            el.classList.add('expanded');
                            children.classList.remove('collapsed');
                        }
                    });
                    allCollapsed = false;
                    const label = document.getElementById('collapseToggleLabel');
                    const btn = document.getElementById('collapseToggleBtn');
                    if (label) label.textContent = 'Collapse All';
                    if (btn) btn.title = 'Collapse All';
                }

                function collapseAll() {
                    const expands = document.querySelectorAll('.tree-expand:not(.leaf)');
                    expands.forEach(el => {
                        const treeNode = el.closest('.tree-node');
                        const children = treeNode?.querySelector(':scope > .tree-children');
                        if (children) {
                            el.classList.remove('expanded');
                            children.classList.add('collapsed');
                        }
                    });
                    allCollapsed = true;
                    const label = document.getElementById('collapseToggleLabel');
                    const btn = document.getElementById('collapseToggleBtn');
                    if (label) label.textContent = 'Expand All';
                    if (btn) btn.title = 'Expand All';
                }

                document.getElementById('collapseToggleBtn')?.addEventListener('click', () => {
                    if (allCollapsed) {
                        expandAll();
                    } else {
                        collapseAll();
                    }
                });

                document.getElementById('fieldsTree')?.addEventListener('click', handleFieldClick);
                document.getElementById('fieldsTree')?.addEventListener('change', handleFieldChange);

                document.getElementById('fieldsSearchInput')?.addEventListener('input', (e) => {
                    const term = e.target.value.trim().toLowerCase();
                    const nodes = document.querySelectorAll('.tree-node[data-value]');
                    if (!term) {
                        nodes.forEach(n => n.classList.remove('search-hidden'));
                        updateFieldsCount();
                        return;
                    }
                    nodes.forEach(node => {
                        const nameEl = node.querySelector(':scope > .tree-row .tree-name');
                        const name = nameEl?.textContent?.toLowerCase() || '';
                        if (name.includes(term)) {
                            node.classList.remove('search-hidden');
                            let parent = node.parentElement?.closest('.tree-node');
                            while (parent) {
                                parent.classList.remove('search-hidden');
                                const expand = parent.querySelector(':scope > .tree-row .tree-expand');
                                const children = parent.querySelector(':scope > .tree-children');
                                if (expand && children) {
                                    expand.classList.add('expanded');
                                    children.classList.remove('collapsed');
                                }
                                parent = parent.parentElement?.closest('.tree-node');
                            }
                        } else {
                            const hasMatchingChild = node.querySelector('.tree-node.search-hidden, .tree-node:not(.search-hidden)');
                            const childMatches = [...(node.querySelectorAll('.tree-node') || [])].some(child => {
                                const childName = child.querySelector(':scope > .tree-row .tree-name')?.textContent?.toLowerCase() || '';
                                return childName.includes(term);
                            });
                            if (childMatches) {
                                node.classList.remove('search-hidden');
                                const expand = node.querySelector(':scope > .tree-row .tree-expand');
                                const children = node.querySelector(':scope > .tree-children');
                                if (expand && children) {
                                    expand.classList.add('expanded');
                                    children.classList.remove('collapsed');
                                }
                            } else {
                                node.classList.add('search-hidden');
                            }
                        }
                    });
                    updateFieldsCount();
                });

                if (currentFields.length > 0) {
                    renderFieldsTree(currentFields);
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

                function handleFieldClick(e) {
                    const expand = e.target.closest('.tree-expand');
                    if (expand && !expand.classList.contains('leaf')) {
                        expand.classList.toggle('expanded');
                        const treeNode = expand.closest('.tree-node');
                        const children = treeNode?.querySelector(':scope > .tree-children');
                        if (children) {
                            children.classList.toggle('collapsed');
                        }
                    }
                }

                function handleFieldChange(e) {
                    if (e.target.classList.contains('tree-value')) {
                        const fieldPath = JSON.parse(e.target.getAttribute('data-path') || '[]');
                        const bits = parseInt(e.target.getAttribute('data-bits'));
                        const raw = e.target.value.trim();
                        
                        // 计算最大值（使用 BigInt 避免溢出）
                        const maxVal = (BigInt(1) << BigInt(bits)) - BigInt(1);
                        
                        // 解析值（支持十进制和十六进制）
                        let newValueBigInt;
                        if (raw.startsWith('0x') || raw.startsWith('0X')) {
                            try {
                                newValueBigInt = BigInt(raw);
                            } catch {
                                e.target.value = e.target.getAttribute('data-orig') || '0';
                                return;
                            }
                        } else {
                            const num = parseInt(raw, 10);
                            if (isNaN(num)) {
                                e.target.value = e.target.getAttribute('data-orig') || '0';
                                return;
                            }
                            newValueBigInt = BigInt(num);
                        }
                        
                        if (newValueBigInt < 0n || newValueBigInt > maxVal) {
                            vscode.postMessage({ command: 'alert', text: 'Value out of range (0-' + maxVal.toString() + ')' });
                            e.target.value = e.target.getAttribute('data-orig') || '0';
                            return;
                        }
                        
                        // 发送字符串形式的值，避免精度丢失
                        vscode.postMessage({ command: 'updateField', fieldPath, newValue: newValueBigInt.toString() });
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
                        case 'setHideZero':
                            hideZero = message.hideZero;
                            applyHideZero();
                            break;
                    }
                });

                function applyHideZero() {
                    const nodes = document.querySelectorAll('.tree-node[data-value]');
                    nodes.forEach(node => {
                        const val = parseInt(node.getAttribute('data-value') || '0', 10);
                        if (hideZero && val === 0) {
                            node.classList.add('zero-hidden');
                        } else {
                            node.classList.remove('zero-hidden');
                        }
                    });
                    updateFieldsCount();
                }

                function updateFieldsCount() {
                    const countEl = document.getElementById('fieldsCount');
                    if (countEl) {
                        const visible = document.querySelectorAll('.tree-node[data-value]:not(.zero-hidden)').length;
                        countEl.textContent = visible;
                    }
                }

                function displayResults(data) {
                    currentFields = data.fields;
                    if (data.error) {
                        vscode.postMessage({ command: 'alert', text: data.error });
                        return;
                    }
                    renderFieldsTree(data.fields);
                    expandAll();
                    document.getElementById('contentPanel').style.display = 'flex';
                    document.getElementById('emptyState').style.display = 'none';
                }

                function renderFieldsTree(fields) {
                    const tree = document.getElementById('fieldsTree');
                    if (!tree) return;

                    let html = '';

                    function renderNode(field, depth = 0, parentPath = []) {
                        const hasChildren = field.fields && field.fields.length > 0;
                        const fieldPath = [...parentPath, field.name];
                        const typeClass = field.type === 'struct' ? 'struct' :
                                        field.type === 'union' ? 'union' :
                                        field.type === 'bool' ? 'bool' : 'uint';
                        const iconClass = hasChildren ? (field.type === 'struct' ? 'struct' : field.type === 'union' ? 'union' : 'anon') : typeClass;
                        const typeLabel = field.type || 'anon';
                        const maxVal = field.bits >= 32 ? 4294967295 : (1 << field.bits) - 1;
                        const pathJson = JSON.stringify(fieldPath).replace(/"/g, '&quot;');

                        html += \`
                            <div class="tree-node" data-value="\${field.value}">
                                <div class="tree-row">
                                    <div class="tree-name-group">
                                        <span class="tree-indent" style="padding-left: \${depth * 20}px"></span>
                                        <span class="tree-expand \${hasChildren ? '' : 'leaf'}">\u25B6</span>
                                        <span class="tree-icon \${iconClass}"></span>
                                        <span class="tree-name">\${field.name}</span>
                                    </div>
                                    <span class="tree-type \${typeClass}">\${typeLabel}</span>
                                    <span class="tree-offset">@\${field.offset}</span>
                                    <span class="tree-bits">\${field.bits}b</span>
                        \`;

                        if (!hasChildren) {
                            html += \`
                                    <input type="text" class="tree-value" value="\${field.value}" data-path="\${pathJson}" data-bits="\${field.bits}" data-orig="\${field.value}" title="max: \${maxVal} (\${field.bits}bits)">
                                    <span class="tree-hex">\${field.hex}</span>
                            \`;
                        } else {
                            html += \`
                                    <input type="text" class="tree-value" value="\${field.value}" data-path="\${pathJson}" data-bits="\${field.bits}" data-orig="\${field.value}" title="max: \${maxVal} (\${field.bits}bits)">
                                    <span class="tree-hex">\${field.hex}</span>
                            \`;
                        }

                        html += \`</div>\`;

                        if (hasChildren) {
                            html += \`<div class="tree-children collapsed">\`;
                            field.fields.forEach(child => renderNode(child, depth + 1, fieldPath));
                            html += \`</div>\`;
                        }

                        html += \`</div>\`;
                    }

                    fields.forEach(field => renderNode(field));
                    tree.innerHTML = html;
                    updateFieldsCount();
                    applyHideZero();
                }
            </script>
        </body>
        </html>`;
    }

    public dispose() {
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
