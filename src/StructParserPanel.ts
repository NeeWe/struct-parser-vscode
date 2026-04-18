import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
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

export class StructParserPanel {
    public static currentPanel: StructParserPanel | undefined;
    public static readonly viewType = 'structParser';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _structData: StructJson | null = null;

    public static createOrShow(extensionUri: vscode.Uri): StructParserPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (StructParserPanel.currentPanel) {
            StructParserPanel.currentPanel._panel.reveal(column);
            return StructParserPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            StructParserPanel.viewType,
            'Struct Parser',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        StructParserPanel.currentPanel = new StructParserPanel(panel, extensionUri);
        return StructParserPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Load struct data
        this._loadStructData();

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'parse':
                        this._parseHexValue(message.hexValue, message.structName);
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
            // Try to find in workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const possiblePaths = [
                    path.join(workspaceFolders[0].uri.fsPath, 'output.json'),
                    path.join(workspaceFolders[0].uri.fsPath, 'structs.json'),
                    path.join(workspaceFolders[0].uri.fsPath, 'struct-parser.yaml'),
                ];

                for (const tryPath of possiblePaths) {
                    const jsonTryPath = tryPath.replace('.yaml', '.json');
                    if (fs.existsSync(jsonTryPath)) {
                        try {
                            const content = fs.readFileSync(jsonTryPath, 'utf-8');
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

    public parseHexValue(hexValue: string) {
        this._panel.webview.postMessage({
            command: 'setHexValue',
            hexValue: hexValue
        });
    }

    private _parseHexValue(hexValue: string, structName: string) {
        if (!this._structData) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: 'No struct data loaded. Please configure structParser.jsonPath in settings.'
            });
            return;
        }

        // Find the struct definition
        const structDef = this._structData.structs.find(s => s.name === structName) ||
                         this._structData.unions.find(s => s.name === structName);

        if (!structDef) {
            this._panel.webview.postMessage({
                command: 'parseResult',
                error: `Struct '${structName}' not found`
            });
            return;
        }

        // Convert hex to binary
        const hexClean = hexValue.replace(/^0x/i, '');
        const binaryValue = BigInt('0x' + hexClean).toString(2).padStart(structDef.size_bits, '0');

        // Parse each field
        const parsedFields = structDef.fields.map(field => {
            const fieldBits = binaryValue.substring(
                structDef.size_bits - field.offset - field.bits,
                structDef.size_bits - field.offset
            );
            const fieldValue = parseInt(fieldBits, 2);
            
            return {
                ...field,
                binary: fieldBits,
                value: fieldValue,
                hex: '0x' + fieldValue.toString(16).toUpperCase()
            };
        });

        this._panel.webview.postMessage({
            command: 'parseResult',
            struct: structDef,
            fields: parsedFields,
            hexValue: hexValue,
            binaryValue: binaryValue
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
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .input-section {
                    margin-bottom: 20px;
                    padding: 15px;
                    background-color: var(--vscode-panel-background);
                    border-radius: 6px;
                }
                .input-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                }
                input, select {
                    width: 100%;
                    padding: 8px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 14px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                button {
                    padding: 10px 20px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .results-section {
                    margin-top: 20px;
                }
                .field-row {
                    display: flex;
                    align-items: center;
                    padding: 10px;
                    margin-bottom: 8px;
                    background-color: var(--vscode-panel-background);
                    border-radius: 4px;
                    border-left: 4px solid var(--vscode-focusBorder);
                }
                .field-name {
                    width: 150px;
                    font-weight: bold;
                }
                .field-type {
                    width: 80px;
                    color: var(--vscode-symbolIcon-typeForeground);
                }
                .field-bits {
                    width: 60px;
                    text-align: center;
                }
                .field-binary {
                    flex: 1;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    color: var(--vscode-textPreformat-foreground);
                    word-break: break-all;
                }
                .field-value {
                    width: 100px;
                    text-align: right;
                    font-family: var(--vscode-editor-font-family);
                }
                .field-hex {
                    width: 80px;
                    text-align: right;
                    font-family: var(--vscode-editor-font-family);
                    color: var(--vscode-numberLiteral-foreground);
                }
                .header-row {
                    display: flex;
                    padding: 10px;
                    font-weight: bold;
                    border-bottom: 2px solid var(--vscode-panel-border);
                    margin-bottom: 10px;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    padding: 10px;
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border-radius: 4px;
                }
                .info {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    margin-top: 5px;
                }
                .binary-display {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    word-break: break-all;
                    padding: 10px;
                    background-color: var(--vscode-textCodeBlock-background);
                    border-radius: 4px;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Struct Parser Viewer</h2>
                
                <div class="input-section">
                    <div class="input-group">
                        <label for="hexInput">Hex Value:</label>
                        <input type="text" id="hexInput" placeholder="0x1234ABCD or 1234ABCD" />
                        <div class="info">Enter hex value (with or without 0x prefix)</div>
                    </div>
                    
                    <div class="input-group">
                        <label for="structSelect">Select Struct:</label>
                        <select id="structSelect">
                            <option value="">-- Select a struct --</option>
                            ${structNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                        </select>
                    </div>
                    
                    <button onclick="parseValue()">Parse</button>
                </div>
                
                <div id="results" class="results-section"></div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'setHexValue':
                            document.getElementById('hexInput').value = message.hexValue;
                            break;
                        case 'parseResult':
                            displayResults(message);
                            break;
                    }
                });
                
                function parseValue() {
                    const hexValue = document.getElementById('hexInput').value.trim();
                    const structName = document.getElementById('structSelect').value;
                    
                    if (!hexValue) {
                        vscode.postMessage({
                            command: 'alert',
                            text: 'Please enter a hex value'
                        });
                        return;
                    }
                    
                    if (!structName) {
                        vscode.postMessage({
                            command: 'alert',
                            text: 'Please select a struct'
                        });
                        return;
                    }
                    
                    vscode.postMessage({
                        command: 'parse',
                        hexValue: hexValue,
                        structName: structName
                    });
                }
                
                function displayResults(data) {
                    const resultsDiv = document.getElementById('results');
                    
                    if (data.error) {
                        resultsDiv.innerHTML = '<div class="error">' + data.error + '</div>';
                        return;
                    }
                    
                    let html = '<h3>Parsed: ' + data.struct.name + '</h3>';
                    html += '<div class="binary-display">Binary: ' + data.binaryValue + '</div>';
                    html += '<div class="header-row">';
                    html += '<div class="field-name">Field</div>';
                    html += '<div class="field-type">Type</div>';
                    html += '<div class="field-bits">Bits</div>';
                    html += '<div class="field-binary">Binary</div>';
                    html += '<div class="field-value">Value</div>';
                    html += '<div class="field-hex">Hex</div>';
                    html += '</div>';
                    
                    data.fields.forEach(field => {
                        html += '<div class="field-row">';
                        html += '<div class="field-name">' + field.name + '</div>';
                        html += '<div class="field-type">' + field.type + '</div>';
                        html += '<div class="field-bits">' + field.bits + '</div>';
                        html += '<div class="field-binary">' + field.binary + '</div>';
                        html += '<div class="field-value">' + field.value + '</div>';
                        html += '<div class="field-hex">' + field.hex + '</div>';
                        html += '</div>';
                    });
                    
                    resultsDiv.innerHTML = html;
                }
            </script>
        </body>
        </html>`;
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
