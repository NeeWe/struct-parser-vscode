import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getActiveStructData } from './dataManager';

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
    public static context: vscode.ExtensionContext | undefined;

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

    // HTML-once 模式：只在第一次设置 webview.html，后续通过 postMessage 更新状态
    // 避免每次切换 struct 都重建 2000+ 行 HTML 字符串
    private _htmlInitialized = false;
    private _webviewReady = false;
    private _pendingMessage: any = null;

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
                    case 'webviewReady':
                        // WebView 已加载完成，可以发送待处理的消息
                        this._webviewReady = true;
                        if (this._pendingMessage) {
                            this._panel.webview.postMessage(this._pendingMessage);
                            this._pendingMessage = null;
                        }
                        return;
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
        // 1. 优先从 globalState 缓存读取激活结构集
        if (StructParserPanel.context) {
            const cachedData = getActiveStructData(StructParserPanel.context);
            if (cachedData) {
                this._structData = cachedData;
                return;
            }
        }

        // 2. 回落到 workspace 配置
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPath = config.get<string>('jsonPath');

        if (jsonPath && fs.existsSync(jsonPath)) {
            try {
                const content = fs.readFileSync(jsonPath, 'utf-8');
                this._structData = JSON.parse(content);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load struct JSON: ${error}`);
            }
        }
    }

    private _findStructDef(structName: string): StructDef | undefined {
        const fromCurrent = this._currentStruct?.type === structName ? this._currentStruct : undefined;
        if (fromCurrent) return fromCurrent;

        if (this._structData) {
            return this._structData.structs.find(s => s.type === structName) ||
                   this._structData.unions.find(s => s.type === structName);
        }
        return undefined;
    }

    private _computeParsedData(
        hexValue: string,
        structDef: StructDef
    ): { parsedFields: ParsedField[]; hexValue: string; binaryValue: string; actualHex: string; wasAdjusted: boolean } | null {
        const hexClean = hexValue.replace(/^0x/i, '');
        if (!hexClean) return null;

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
        const actualHex = '0x' + adjustedValue.toString(16).toUpperCase().padStart(Math.ceil(structBits / 4), '0');

        return { parsedFields, hexValue, binaryValue, actualHex, wasAdjusted };
    }

    private _parseHexValue(hexValue: string, structName: string) {
        if (!structName) return;

        const structDef = this._findStructDef(structName);
        if (!structDef) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: `Struct '${structName}' not found. Please import/configure a JSON file.`
            });
            return;
        }

        const result = this._computeParsedData(hexValue, structDef);
        if (!result) return;

        const { parsedFields, binaryValue, actualHex, wasAdjusted } = result;

        this._currentParsedData = {
            struct: structDef,
            fields: parsedFields,
            hexValue,
            binaryValue
        };

        this._panel.webview.postMessage({
            command: 'parseResult',
            struct: structDef,
            fields: parsedFields,
            hexValue,
            actualHexValue: actualHex,
            binaryValue,
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
        const hexValue = '0x' + '0'.repeat(Math.max(1, Math.ceil(struct.bits / 4)));
        const result = this._computeParsedData(hexValue, struct);
        if (result) {
            this._currentParsedData = {
                struct,
                fields: result.parsedFields,
                hexValue: result.hexValue,
                binaryValue: result.binaryValue
            };
        } else {
            this._currentParsedData = null;
        }
        this._update();
    }

    public refreshStructList(structData: StructJson) {
        this._structData = structData;
    }

    public refreshStructData() {
        this._loadStructData();
        // If we have a current struct, try to re-show it with new data
        if (this._currentStruct) {
            const structName = this._currentStruct.type;
            const refreshed = this._findStructDef(structName);
            if (refreshed) {
                this._currentStruct = refreshed;
                if (this._currentParsedData) {
                    this._parseHexValue(this._currentParsedData.hexValue, structName);
                } else {
                    this._update();
                }
            }
        } else {
            this._update();
        }
    }

    public setHideZero(hideZero: boolean) {
        this._panel.webview.postMessage({
            command: 'setHideZero',
            hideZero
        });
    }

    public setBitVisVisible(visible: boolean) {
        this._panel.webview.postMessage({
            command: 'setBitVisVisible',
            visible
        });
    }

    private _buildShowStructMsg(): any {
        const structName = this._currentStruct?.type || '';
        const structBits = this._currentStruct?.bits || 0;
        const isUnion = this._structData?.unions?.some(u => u.type === structName) ?? false;
        const hexValue = this._currentParsedData?.hexValue || '';
        const fields = this._currentParsedData?.fields || [];
        return {
            command: 'showStruct',
            structName,
            structBits,
            isUnion,
            hexValue,
            fields,
            adjustedValue: false
        };
    }

    private _update() {
        this._panel.title = this._currentStruct?.type || 'Struct Parser';
        if (!this._htmlInitialized) {
            // 第一次设置 HTML，后续不再重建
            this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
            this._htmlInitialized = true;
            // 如果已有待显示的 struct，缓存等 webviewReady 再发
            if (this._currentStruct) {
                this._pendingMessage = this._buildShowStructMsg();
            }
        } else {
            const msg = this._buildShowStructMsg();
            if (this._webviewReady) {
                this._panel.webview.postMessage(msg);
            } else {
                // WebView 尚未就绪，缓存消息
                this._pendingMessage = msg;
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // HTML-once: 所有状态变量均通过 postMessage 动态更新，不嵌入模板
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
                    font-size: var(--vscode-font-size, 13px);
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

                /* ===== Empty State ===== */
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
                    opacity: 0.4;
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

                /* ===== Content Panel ===== */
                .content-panel {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    overflow: hidden;
                }

                /* ===== Top Bar ===== */
                .main-topbar {
                    padding: 12px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: var(--vscode-panel-background);
                    flex-shrink: 0;
                }

                .topbar-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    min-width: 0;
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

                /* ===== Bit Visualization Grid (32-bit rows) ===== */
                .bitvis-section {
                    padding: 10px 24px 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-panel-background);
                    flex-shrink: 0;
                    max-height: 360px;
                    overflow-y: auto;
                }

                .bitvis-section::-webkit-scrollbar {
                    width: 4px;
                }

                .bitvis-section::-webkit-scrollbar-thumb {
                    background: var(--vscode-scrollbarSlider-background);
                    border-radius: 2px;
                }

                .bitvis-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    flex-shrink: 0;
                }

                .bitvis-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--vscode-descriptionForeground);
                }

                .bitvis-legend {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    align-items: center;
                }

                .bitvis-legend-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                }

                .bitvis-legend-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 2px;
                    flex-shrink: 0;
                }

                /* === 32-bit row === */
                .bitvis-row {
                    position: relative;
                    width: 100%;
                    height: 48px;
                    margin-bottom: 0;
                    border-radius: 0;
                    background: var(--vscode-editor-background);
                    border: none;
                    overflow: hidden;
                    flex-shrink: 0;
                }

                .bitvis-row-header {
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--vscode-descriptionForeground);
                    background: var(--vscode-panel-background);
                    border-right: 1px solid var(--vscode-panel-border);
                    z-index: 5;
                    font-family: var(--vscode-editor-font-family);
                    flex-shrink: 0;
                }

                .bitvis-row-body {
                    position: absolute;
                    left: 29px;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    display: flex;
                    flex-direction: column;
                }

                .bitvis-byte-lines {
                    position: absolute;
                    left: 29px;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    z-index: 1;
                    pointer-events: none;
                }

                .bitvis-byte-line {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 1px;
                    background: var(--vscode-panel-border);
                    opacity: 0.25;
                }

                .bitvis-byte-line.major {
                    opacity: 0.4;
                }

                /* Bit numbers row */
                .bitvis-bits {
                    position: absolute;
                    left: 0;
                    right: 0;
                    top: 0;
                    height: 18px;
                    z-index: 2;
                }

                .bitvis-bit-label {
                    position: absolute;
                    top: 0;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.55;
                    padding-left: 2px;
                }

                /* Field blocks area */
                .bitvis-field-area {
                    position: absolute;
                    left: 0;
                    right: 0;
                    top: 0;
                    height: 100%;
                    z-index: 3;
                }

                .bitvis-field-block {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    border-radius: 0;
                    cursor: pointer;
                    transition: all 0.12s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    z-index: 3;
                    min-width: 3px;
                    opacity: 0.85;
                    height: 100%;
                }

                .bitvis-field-block:hover {
                    opacity: 1;
                    z-index: 6;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                    transform: scaleY(1.1);
                }

                .bitvis-field-block-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: rgba(255,255,255,0.93);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    padding: 0 4px;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.35);
                }

                .bitvis-field-block-type {
                    font-size: 10px;
                    color: rgba(255,255,255,0.65);
                    white-space: nowrap;
                    padding: 0 2px;
                    flex-shrink: 0;
                }

                /* Union indicator for stacked fields */
                .bitvis-union-indicator {
                    position: absolute;
                    right: 3px;
                    top: 3px;
                    font-size: 8px;
                    font-weight: 700;
                    color: rgba(255,255,255,0.8);
                    background: rgba(0,0,0,0.3);
                    border-radius: 2px;
                    padding: 1px 4px;
                    z-index: 4;
                    pointer-events: none;
                }

                /* Stacked rows for union - height set dynamically by JS */
                .bitvis-row.has-union {
                    margin-bottom: 0;
                    border: none;
                }

                .bitvis-field-block.union-variant {
                    opacity: 0.75;
                    border-top: 1px dashed rgba(255,255,255,0.25);
                }

                .bitvis-field-block.union-variant:hover {
                    opacity: 0.95;
                }

                /* ===== Hex Input Section ===== */
                .hex-section {
                    padding: 10px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-panel-background);
                    flex-shrink: 0;
                }

                .hex-row {
                    display: flex;
                    gap: 8px;
                    align-items: stretch;
                }

                .hex-input-group {
                    flex: 1;
                    display: flex;
                    align-items: stretch;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    overflow: hidden;
                    transition: border-color 0.15s, box-shadow 0.15s;
                }

                .hex-input-group:focus-within {
                    border-color: #4EC9B0;
                    box-shadow: 0 0 0 1px rgba(78, 201, 176, 0.2);
                }

                .hex-prefix {
                    display: flex;
                    align-items: center;
                    padding: 0 12px;
                    background: var(--vscode-editor-background);
                    color: #4EC9B0;
                    font-family: var(--vscode-editor-font-family);
                    font-weight: 700;
                    font-size: 14px;
                    border-right: 1px solid var(--vscode-input-border);
                }

                .hex-input {
                    flex: 1;
                    padding: 8px 12px;
                    background: var(--vscode-input-background);
                    border: none;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 14px;
                    font-weight: 500;
                    letter-spacing: 1px;
                    outline: none;
                }

                .hex-input::placeholder {
                    color: var(--vscode-input-placeholderForeground);
                    font-weight: 400;
                }

                .hex-apply-btn {
                    padding: 8px 18px;
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
                    transform: translateY(-1px);
                }

                .hex-apply-btn:active {
                    transform: translateY(0);
                }

                .hex-info {
                    margin-top: 6px;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    gap: 16px;
                    align-items: center;
                }

                .hex-info .label {
                    color: var(--vscode-descriptionForeground);
                }

                .hex-info .value {
                    color: #4EC9B0;
                    font-family: var(--vscode-editor-font-family);
                    font-weight: 500;
                }

                .hex-info .adjust-badge {
                    font-size: 9px;
                    padding: 1px 6px;
                    border-radius: 3px;
                    background: rgba(255, 193, 7, 0.15);
                    color: #FFC107;
                    font-weight: 600;
                }

                /* ===== Fields Section ===== */
                .fields-section {
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .fields-header {
                    padding: 8px 24px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    background: var(--vscode-panel-background);
                    flex-shrink: 0;
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

                .fields-header-right {
                    display: flex;
                    align-items: center;
                    gap: 8px;
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
                    width: 130px;
                    padding: 3px 8px 3px 26px;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    background: transparent;
                    color: var(--vscode-foreground);
                    font-size: 11px;
                    outline: none;
                    transition: border-color 0.15s, background 0.15s;
                    font-family: var(--vscode-font-family);
                }

                .fields-search-input:focus {
                    border-color: var(--vscode-focusBorder);
                    background: var(--vscode-input-background);
                }

                .fields-search-input::placeholder {
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.7;
                }

                .fields-tree {
                    flex: 1;
                    overflow-y: auto;
                    padding: 2px 0;
                }

                .fields-tree::-webkit-scrollbar {
                    width: 6px;
                }

                .fields-tree::-webkit-scrollbar-thumb {
                    background: var(--vscode-scrollbarSlider-background);
                    border-radius: 3px;
                }

                /* ===== Tree Node ===== */
                .tree-node {
                    user-select: none;
                }

                .tree-row {
                    display: grid;
                    grid-template-columns: 1fr 100px 48px 48px 100px 90px;
                    column-gap: 12px;
                    align-items: center;
                    padding: 4px 24px;
                    cursor: pointer;
                    transition: background 0.1s;
                    border-left: 3px solid transparent;
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
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    color: var(--vscode-descriptionForeground);
                    transition: transform 0.15s;
                    flex-shrink: 0;
                    opacity: 0.6;
                }

                .tree-expand.expanded {
                    transform: rotate(90deg);
                }

                .tree-expand.leaf {
                    visibility: hidden;
                }

                .tree-color-bar {
                    width: 3px;
                    height: 16px;
                    border-radius: 2px;
                    flex-shrink: 0;
                    margin: 0 8px;
                }

                .tree-name {
                    font-size: 13px;
                    color: var(--vscode-foreground);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                    min-width: 0;
                    font-weight: 500;
                }

                .tree-type {
                    font-size: 11px;
                    font-weight: 600;
                    padding: 1px 8px;
                    border-radius: 3px;
                    text-align: center;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-family: var(--vscode-editor-font-family);
                    letter-spacing: 0.3px;
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
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    font-family: var(--vscode-editor-font-family);
                    text-align: right;
                    white-space: nowrap;
                }

                .tree-bits {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    font-family: var(--vscode-editor-font-family);
                    text-align: right;
                    white-space: nowrap;
                }

                .tree-value {
                    width: 100%;
                    padding: 3px 8px;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    font-weight: 500;
                    text-align: right;
                    outline: none;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    -moz-appearance: textfield;
                    appearance: textfield;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tree-value::-webkit-outer-spin-button,
                .tree-value::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                }

                .tree-value:focus {
                    border-color: #4EC9B0;
                    box-shadow: 0 0 0 1px rgba(78, 201, 176, 0.15);
                }

                .tree-hex {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    color: #75BEFF;
                    text-align: right;
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
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

                /* ===== Column Header ===== */
                .tree-header {
                    display: grid;
                    grid-template-columns: 1fr 100px 48px 48px 100px 90px;
                    column-gap: 12px;
                    align-items: center;
                    padding: 5px 24px;
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
                    font-size: 10px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--vscode-descriptionForeground);
                }

                .tree-header .tree-hex {
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

                .tree-header .tree-color-bar {
                    background: none !important;
                }

                /* ===== No Results ===== */
                .no-results {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 24px;
                    text-align: center;
                    flex: 1;
                }

                .no-results-icon {
                    font-size: 32px;
                    opacity: 0.3;
                    margin-bottom: 8px;
                }

                .no-results-text {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }

                /* ===== Animations ===== */
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes slideIn {
                    from { opacity: 0; max-height: 0; }
                    to { opacity: 1; max-height: 200px; }
                }

                .tree-node { animation: fadeIn 0.2s ease; }
                .bitvis-field-block { animation: fadeIn 0.3s ease; }
            </style>
        </head>
        <body>
            <div class="main">
                <!-- Empty State: 始终显示，由 showStruct 消息切换 -->
                <div class="empty-state" id="emptyState" style="display: flex">
                    <div class="empty-icon">⚡</div>
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

                <!-- Content Panel: 初始隐藏 -->
                <div class="content-panel" id="contentPanel" style="display: none">
                    <!-- Top Bar -->
                    <div class="main-topbar">
                        <div class="topbar-left">
                            <div class="topbar-struct-icon">⚡</div>
                            <div class="topbar-info">
                                <h2 id="structName"></h2>
                                <p id="structMeta"></p>
                            </div>
                        </div>
                    </div>

                    <!-- Bit Visualization Grid (32-bit rows) -->
                    <div class="bitvis-section" id="bitvisSection" style="display:none">
                        <div class="bitvis-header">
                            <span class="bitvis-title">Bit Layout</span>
                            <div class="bitvis-legend" id="bitvisLegend"></div>
                        </div>
                        <div id="bitvisRows"></div>
                    </div>

                    <!-- Hex Input -->
                    <div class="hex-section">
                        <div class="hex-row">
                            <div class="hex-input-group">
                                <span class="hex-prefix">0x</span>
                                <input type="text" class="hex-input" id="hexInput" placeholder="Enter hex value..." value="">
                            </div>
                            <button class="hex-apply-btn" id="btnParse">Parse</button>
                        </div>
                        <div class="hex-info" id="hexInfo">
                            <span><span class="label">Type: </span><span class="value" id="hexInfoType">struct</span></span>
                            <span><span class="label">Size: </span><span class="value" id="hexInfoSize"></span></span>
                            <span id="adjustBadge" style="display:none"><span class="adjust-badge">Auto-adjusted</span></span>
                        </div>
                    </div>

                    <!-- Fields Header -->
                    <div class="fields-header">
                        <div class="fields-title">
                            <span>Fields</span>
                            <span class="fields-count" id="fieldsCount">0</span>
                        </div>
                        <div class="fields-header-right">
                            <div class="fields-search">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/></svg>
                                <input type="text" class="fields-search-input" id="fieldsSearchInput" placeholder="Filter...">
                            </div>
                            <button class="collapse-toggle-btn" id="collapseToggleBtn" title="Collapse All">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h4v4H3V3zm0 6h4v4H3V9zm6-6h4v4H9V3zm0 6h4v4H9V9z" opacity="0.3"/><path d="M1.5 1h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1zm0 13h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1z"/></svg>
                                <span id="collapseToggleLabel">Collapse All</span>
                            </button>
                        </div>
                    </div>

                    <!-- Column Header -->
                    <div class="tree-header">
                        <div class="tree-name-group">
                            <span class="tree-indent"></span>
                            <span class="tree-expand leaf">▶</span>
                            <span class="tree-color-bar"></span>
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
                let currentStructName = '';
                let currentFields = [];
                let hideZero = false;
                let allCollapsed = false;

                const ROW_BITS = 32;

                // Add hashCode method to String prototype for consistent coloring
                String.prototype.hashCode = function() {
                    let hash = 0;
                    for (let i = 0; i < this.length; i++) {
                        const char = this.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash;
                    }
                    return Math.abs(hash);
                };

                const FIELD_COLORS = [
                    '#4EC9B0', '#569CD6', '#C586C0', '#DCDCAA',
                    '#CE9178', '#6A9955', '#D16969', '#B5CEA8',
                    '#F44747', '#9CDCFE'
                ];

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

                // HTML-once: 不再内嵌初始状态，通过 webviewReady + showStruct 消息动态初始化
                vscode.postMessage({ command: 'webviewReady' });

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

                        const maxVal = (BigInt(1) << BigInt(bits)) - BigInt(1);

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

                        vscode.postMessage({ command: 'updateField', fieldPath, newValue: newValueBigInt.toString() });
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'showStruct': {
                            // 切换显示新 struct，不需重建 HTML
                            currentStructName = message.structName || '';
                            currentFields = message.fields || [];
                            if (currentStructName) {
                                document.getElementById('emptyState').style.display = 'none';
                                document.getElementById('contentPanel').style.display = 'flex';
                                const iu = message.isUnion;
                                document.getElementById('structName').innerHTML =
                                    currentStructName + ' <span class="type-badge ' + (iu ? 'union' : 'struct') + '">' + (iu ? 'union' : 'struct') + '</span>';
                                document.getElementById('structMeta').textContent =
                                    message.structBits + ' bits \u00b7 ' + Math.ceil(message.structBits / 8) + ' bytes';
                                document.getElementById('hexInfoType').textContent = iu ? 'union' : 'struct';
                                document.getElementById('hexInfoSize').textContent = message.structBits + ' bits';
                                const hexInput = document.getElementById('hexInput');
                                if (hexInput) hexInput.value = message.hexValue || '';
                                const searchInput = document.getElementById('fieldsSearchInput');
                                if (searchInput) searchInput.value = '';
                                if (currentFields.length > 0) {
                                    renderFieldsTree(currentFields);
                                    renderBitVis(currentFields, message.structBits);
                                    expandAll();
                                } else {
                                    document.getElementById('fieldsTree').innerHTML = '';
                                    const bvSection = document.getElementById('bitvisSection');
                                    if (bvSection) bvSection.style.display = 'none';
                                }
                            } else {
                                document.getElementById('emptyState').style.display = 'flex';
                                document.getElementById('contentPanel').style.display = 'none';
                            }
                            break;
                        }
                        case 'setHexValue': {
                            const hexInput = document.getElementById('hexInput');
                            if (hexInput) hexInput.value = message.hexValue;
                            break;
                        }
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
                        case 'setBitVisVisible':
                            const bvSection = document.getElementById('bitvisSection');
                            if (bvSection) bvSection.style.display = message.visible ? 'block' : 'none';
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
                        const total = document.querySelectorAll('.tree-node[data-value]').length;
                        const visible = document.querySelectorAll('.tree-node[data-value]:not(.zero-hidden):not(.search-hidden)').length;
                        countEl.textContent = visible < total ? visible + '/' + total : total;
                    }
                }

                function getFieldColor(fieldType, index) {
                    const colors = {
                        'struct': '#4EC9B0',
                        'union': '#C586C0',
                        'bool': '#569CD6',
                        'uint': '#9CDCFE',
                        'reserved': '#6A9955',
                        'padding': '#6A9955'
                    };
                    return colors[fieldType.toLowerCase()] || FIELD_COLORS[index % FIELD_COLORS.length];
                }

                // ===== Bit Visualization Grid (32-bit rows, per-bit scan) =====

                // Extract all leaf fields from nested structure, preserving the original order
                function collectLeafFields(fields) {
                    const result = [];
                    function walk(list) {
                        list.forEach(f => {
                            if (f.fields && f.fields.length > 0) {
                                if (f.type === 'struct' || f.type === 'union') {
                                    result.push({
                                        name: f.name,
                                        type: f.type,
                                        bits: f.bits,
                                        offset: f.offset
                                    });
                                }
                                walk(f.fields);
                            } else {
                                result.push({
                                    name: f.name,
                                    type: f.type,
                                    bits: f.bits,
                                    offset: f.offset
                                });
                            }
                        });
                    }
                    walk(fields);
                    return result;
                }
                
                // Group sibling fields that have overlapping bit ranges (union detection)
                function groupByOverlap(fieldList) {
                    const groups = [];
                    for (const f of fieldList) {
                        let placed = false;
                        for (const group of groups) {
                            if (group.some(g => f.offset < g.offset + g.bits && f.offset + f.bits > g.offset)) {
                                group.push(f);
                                placed = true;
                                break;
                            }
                        }
                        if (!placed) groups.push([f]);
                    }
                    return groups;
                }
                
                // Collect field lanes: overlapping siblings (union members) are assigned to
                // separate lanes with independent block-splitting. Each field carries
                // memberIndex/memberCount so the renderer can position it vertically:
                //   - Non-union fields: memberCount=1 → span full row height
                //   - Union member k of M: top=k/M, height=1/M of row height
                function collectLanes(fields) {
                    const lanes = [[]];
                    function ensureLane(idx) {
                        while (lanes.length <= idx) lanes.push([]);
                    }
                    function makeField(f, mi, mc) {
                        return { ...f, memberIndex: mi, memberCount: mc };
                    }
                    function walkGroup(fieldList, baseLane, inheritedMi, inheritedMc) {
                        const overlapGroups = groupByOverlap(fieldList);
                        overlapGroups.forEach(group => {
                            if (group.length === 1) {
                                const f = group[0];
                                if (f.type === 'struct' || f.type === 'union') {
                                    ensureLane(baseLane);
                                    lanes[baseLane].push(makeField(f, inheritedMi, inheritedMc));
                                    if (f.fields && f.fields.length > 0) walkGroup(f.fields, baseLane, inheritedMi, inheritedMc);
                                } else if (f.fields && f.fields.length > 0) {
                                    walkGroup(f.fields, baseLane, inheritedMi, inheritedMc);
                                } else {
                                    ensureLane(baseLane);
                                    lanes[baseLane].push(makeField(f, inheritedMi, inheritedMc));
                                }
                            } else {
                                // Union members: Nth member → lane (baseLane + N)
                                group.forEach((f, fi) => {
                                    const targetLane = baseLane + fi;
                                    ensureLane(targetLane);
                                    if (f.type === 'struct' || f.type === 'union') {
                                        lanes[targetLane].push(makeField(f, fi, group.length));
                                        if (f.fields && f.fields.length > 0) walkGroup(f.fields, targetLane, fi, group.length);
                                    } else if (f.fields && f.fields.length > 0) {
                                        walkGroup(f.fields, targetLane, fi, group.length);
                                    } else {
                                        lanes[targetLane].push(makeField(f, fi, group.length));
                                    }
                                });
                            }
                        });
                    }
                    walkGroup(fields, 0, 0, 1);
                    return lanes.filter(l => l.length > 0);
                }
                
                function renderBitVis(fields, totalBits) {
                    const section = document.getElementById('bitvisSection');
                    const rowsContainer = document.getElementById('bitvisRows');
                    const legend = document.getElementById('bitvisLegend');
                    if (!section || !rowsContainer) return;
                
                    section.style.display = 'block';
                    rowsContainer.innerHTML = '';
                    legend.innerHTML = '';
                
                    if (!fields || fields.length === 0 || totalBits <= 0) return;
                
                    // Collect independent rendering lanes (each lane = one union member's fields)
                    const fieldLanes = collectLanes(fields);
                    if (fieldLanes.length === 0) return;
                
                    // Build legend (deduplicated across all lanes)
                    const allLeafFields = fieldLanes.flat();
                    const seenColors = new Set();
                    allLeafFields.forEach((f, fi) => {
                        const color = getFieldColor(f.type, fi);
                        if (!seenColors.has(color)) {
                            seenColors.add(color);
                            const item = document.createElement('span');
                            item.className = 'bitvis-legend-item';
                            item.innerHTML = '<span class="bitvis-legend-dot" style="background:' + color + '"></span>' + f.type;
                            legend.appendChild(item);
                        }
                    });
                
                    // Build a value lookup from currentFields
                    const valueByPath = {};
                    function indexValues(arr, prefix) {
                        if (!arr) return;
                        arr.forEach(f => {
                            const key = prefix ? prefix + '.' + f.name : f.name;
                            valueByPath[key] = { value: f.value, hex: f.hex };
                            if (f.fields) indexValues(f.fields, key);
                        });
                    }
                    indexValues(fields, '');
                
                    // Add header row with bit labels
                    const headerRow = document.createElement('div');
                    headerRow.className = 'bitvis-row';
                    headerRow.style.height = '24px';
                
                    const headerHeader = document.createElement('div');
                    headerHeader.className = 'bitvis-row-header';
                    headerHeader.textContent = '';
                    headerRow.appendChild(headerHeader);
                
                    const headerBody = document.createElement('div');
                    headerBody.className = 'bitvis-row-body';
                
                    const bitsRow = document.createElement('div');
                    bitsRow.className = 'bitvis-bits';
                    bitsRow.style.height = '100%';
                    const bitLabelStep = findLabelStep(ROW_BITS);
                    for (let b = 0; b < ROW_BITS; b += bitLabelStep) {
                        const label = document.createElement('div');
                        label.className = 'bitvis-bit-label';
                        label.style.left = (b / ROW_BITS * 100) + '%';
                        label.textContent = b;
                        bitsRow.appendChild(label);
                    }
                    headerBody.appendChild(bitsRow);
                    headerRow.appendChild(headerBody);
                    rowsContainer.appendChild(headerRow);
                
                    const LANE_HEIGHT = 40;
                    const numRows = Math.ceil(totalBits / ROW_BITS);
                
                    for (let ri = 0; ri < numRows; ri++) {
                        const rowStart = ri * ROW_BITS;
                        const rowEnd = Math.min(rowStart + ROW_BITS, totalBits);
                
                        // For each lane, independently build posBitmap and compute blocks.
                        // This ensures each union member's row is split only by its own fields.
                        const laneBlocksList = fieldLanes.map(laneFields => {
                            const posBitmap = [];
                            for (let p = 0; p < ROW_BITS; p++) posBitmap.push([]);
                
                            laneFields.forEach((f, fi) => {
                                const overlapStart = Math.max(f.offset, rowStart);
                                const overlapEnd = Math.min(f.offset + f.bits, rowEnd);
                                for (let b = overlapStart; b < overlapEnd; b++) {
                                    const localPos = b - rowStart;
                                    if (localPos >= 0 && localPos < ROW_BITS) {
                                        posBitmap[localPos].push({ fi, field: f });
                                    }
                                }
                            });
                
                            const blocks = [];
                            let bp = 0;
                            while (bp < ROW_BITS) {
                                const entry = posBitmap[bp];
                                if (entry.length === 0) { bp++; continue; }
                
                                const currentIndices = entry.map(e => e.fi).sort();
                                const blockStart = bp;
                                bp++;
                
                                while (bp < ROW_BITS) {
                                    const nextEntry = posBitmap[bp];
                                    if (nextEntry.length === 0) break;
                                    const nextIndices = nextEntry.map(e => e.fi).sort();
                                    if (nextIndices.length !== currentIndices.length) break;
                                    const same = currentIndices.every((v, i) => v === nextIndices[i]);
                                    if (!same) break;
                                    bp++;
                                }
                
                                blocks.push({
                                    start: blockStart,
                                    end: bp,
                                    fieldIndices: currentIndices,
                                    fields: entry.map(e => e.field)
                                });
                            }
                            return blocks;
                        });
                
                        // Only include lanes that have blocks in this row
                        const activeLanes = laneBlocksList
                            .map((blocks, laneIdx) => ({ blocks, laneIdx }))
                            .filter(({ blocks }) => blocks.length > 0);
                
                        if (activeLanes.length === 0) continue;
                
                        // Row height = max(memberCount) across all blocks in this row
                        let maxMemberCount = 1;
                        activeLanes.forEach(({ blocks, laneIdx }) => {
                            blocks.forEach(block => {
                                const fi = block.fieldIndices[0];
                                const f = fieldLanes[laneIdx][fi];
                                if (f.memberCount > maxMemberCount) maxMemberCount = f.memberCount;
                            });
                        });
                        const hasUnion = maxMemberCount > 1;
                
                        const row = document.createElement('div');
                        row.className = 'bitvis-row' + (hasUnion ? ' has-union' : '');
                        row.style.height = (maxMemberCount * LANE_HEIGHT) + 'px';
                        row.dataset.rowStart = rowStart;
                        row.dataset.rowEnd = rowEnd;
                
                        const header = document.createElement('div');
                        header.className = 'bitvis-row-header';
                        header.textContent = ri;
                        row.appendChild(header);
                
                        const body = document.createElement('div');
                        body.className = 'bitvis-row-body';
                
                        const fieldArea = document.createElement('div');
                        fieldArea.className = 'bitvis-field-area';
                
                        // Render blocks from all lanes into a single fieldArea.
                        // Each block is absolutely positioned both horizontally (bit position)
                        // and vertically (memberIndex/memberCount).
                        activeLanes.forEach(({ blocks, laneIdx }) => {
                            blocks.forEach(block => {
                                const leftPct = (block.start / ROW_BITS) * 100;
                                const widthPct = ((block.end - block.start) / ROW_BITS) * 100;
                
                                const fi = block.fieldIndices[0];
                                const f = fieldLanes[laneIdx][fi];
                                const color = getFieldColor(f.type, f.name.hashCode());
                
                                const mi = f.memberIndex;
                                const mc = f.memberCount;
                                const topPct = (mi / mc) * 100;
                                const heightPct = (1 / mc) * 100;
                
                                const vStr = f.value !== undefined ? ', value=' + f.value + ' (' + (f.hex||'') + ')' : '';
                
                                const bEl = document.createElement('div');
                                bEl.className = 'bitvis-field-block' + (mc > 1 && mi > 0 ? ' union-variant' : '');
                                bEl.style.left = leftPct + '%';
                                bEl.style.width = widthPct + '%';
                                bEl.style.top = topPct + '%';
                                bEl.style.height = heightPct + '%';
                                bEl.style.background = 'linear-gradient(135deg, ' + color + ', ' + color + 'cc)';
                                bEl.title = f.name + ' (' + f.type + ', ' + f.bits + ' bits @ ' + f.offset + vStr + ')';
                                bEl.dataset.fieldName = f.name;
                
                                if (widthPct > 1) {
                                    const labelContainer = document.createElement('div');
                                    labelContainer.style.display = 'flex';
                                    labelContainer.style.flexDirection = 'column';
                                    labelContainer.style.alignItems = 'center';
                                    labelContainer.style.justifyContent = 'center';
                                    labelContainer.style.padding = '1px';
                
                                    const lbl = document.createElement('span');
                                    lbl.className = 'bitvis-field-block-label';
                                    lbl.textContent = f.name;
                                    lbl.style.fontSize = widthPct > 8 ? '12px' : widthPct > 4 ? '10px' : '8px';
                                    lbl.style.whiteSpace = 'normal';
                                    lbl.style.textAlign = 'center';
                                    lbl.style.lineHeight = '1.2';
                                    labelContainer.appendChild(lbl);
                                    bEl.appendChild(labelContainer);
                                }
                
                                bEl.addEventListener('click', () => scrollToField(f.name));
                                fieldArea.appendChild(bEl);
                            });
                        });
                
                        body.appendChild(fieldArea);
                
                        if (hasUnion) {
                            const unLabel = document.createElement('div');
                            unLabel.className = 'bitvis-union-indicator';
                            unLabel.textContent = 'U';
                            body.appendChild(unLabel);
                        }
                
                        row.appendChild(body);
                        rowsContainer.appendChild(row);
                    }
                }

                function findLabelStep(bits) {
                    if (bits <= 8) return 1;
                    if (bits <= 16) return 2;
                    if (bits <= 32) return 4;
                    return 8;
                }

                function scrollToField(fieldName) {
                    const nodes = document.querySelectorAll('.tree-node');
                    for (const node of nodes) {
                        const nameEl = node.querySelector(':scope > .tree-row .tree-name');
                        if (nameEl && nameEl.textContent === fieldName) {
                            // Expand all ancestors
                            let parent = node.parentElement?.closest('.tree-node');
                            while (parent) {
                                const expand = parent.querySelector(':scope > .tree-row .tree-expand:not(.leaf)');
                                const children = parent.querySelector(':scope > .tree-children');
                                if (expand && children) {
                                    expand.classList.add('expanded');
                                    children.classList.remove('collapsed');
                                }
                                parent = parent.parentElement?.closest('.tree-node');
                            }
                            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            node.querySelector(':scope > .tree-row')?.classList.add('selected');
                            setTimeout(() => {
                                node.querySelector(':scope > .tree-row')?.classList.remove('selected');
                            }, 1500);
                            break;
                        }
                    }
                }

                // ===== Display Results =====
                function displayResults(data) {
                    currentFields = data.fields;
                    if (data.error) {
                        vscode.postMessage({ command: 'alert', text: data.error });
                        return;
                    }
                    const totalBits = data.struct?.bits || currentFields.reduce((sum, f) => sum + f.bits, 0);
                    renderFieldsTree(data.fields);
                    renderBitVis(data.fields, totalBits);
                    expandAll();
                    document.getElementById('contentPanel').style.display = 'flex';
                    document.getElementById('emptyState').style.display = 'none';

                    const badge = document.getElementById('adjustBadge');
                    if (badge) {
                        badge.style.display = data.adjustedValue ? 'inline' : 'none';
                    }
                }

                // ===== Field Tree Renderer =====
                function renderFieldsTree(fields) {
                    const tree = document.getElementById('fieldsTree');
                    if (!tree) return;

                    if (!fields || fields.length === 0) {
                        tree.innerHTML = \`
                            <div class="no-results">
                                <div class="no-results-icon">🔍</div>
                                <div class="no-results-text">No fields to display</div>
                            </div>
                        \`;
                        return;
                    }

                    let html = '';
                    let fieldIndex = { value: 0 };

                    function renderNode(field, depth = 0, parentPath = []) {
                        const hasChildren = field.fields && field.fields.length > 0;
                        const fieldPath = [...parentPath, field.name];
                        const typeClass = field.type === 'struct' ? 'struct' :
                                        field.type === 'union' ? 'union' :
                                        field.type === 'bool' ? 'bool' : 'uint';
                        const typeLabel = field.type || 'anon';
                        const pathJson = JSON.stringify(fieldPath).replace(/"/g, '&quot;');
                        const idx = fieldIndex.value++;
                        const color = getFieldColor(field.type, idx);

                        html += \`
                            <div class="tree-node" data-value="\${field.value}" data-field-idx="\${idx}">
                                <div class="tree-row">
                                    <div class="tree-name-group">
                                        <span class="tree-indent" style="padding-left: \${depth * 20}px"></span>
                                        <span class="tree-expand \${hasChildren ? '' : 'leaf'}">▶</span>
                                        <span class="tree-color-bar" style="background:\${color}"></span>
                                        <span class="tree-name">\${field.name}</span>
                                    </div>
                                    <span class="tree-type \${typeClass}">\${typeLabel}</span>
                                    <span class="tree-offset">@\${field.offset}</span>
                                    <span class="tree-bits">\${field.bits}b</span>
                        \`;

                        if (!hasChildren) {
                            html += \`
                                    <input type="text" class="tree-value" value="\${field.value}" data-path="\${pathJson}" data-bits="\${field.bits}" data-orig="\${field.value}">
                                    <span class="tree-hex">\${field.hex}</span>
                            \`;
                        } else {
                            html += \`
                                    <input type="text" class="tree-value" value="\${field.value}" data-path="\${pathJson}" data-bits="\${field.bits}" data-orig="\${field.value}">
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
