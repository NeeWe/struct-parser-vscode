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
                localResourceRoots: [extensionUri]
            }
        );

        StructParserPanel.currentPanel = new StructParserPanel(panel, extensionUri);
        return StructParserPanel.currentPanel;
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
                    case 'importJson':
                        await this._importJsonFile();
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
                
                if (!this._structData) {
                    vscode.window.showErrorMessage('Invalid JSON format');
                    return;
                }
                
                // Save to configuration
                const config = vscode.workspace.getConfiguration('structParser');
                await config.update('jsonPath', result[0].fsPath, true);
                
                // Update the webview with new struct list
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
        
        // Handle data width: pad with zeros if smaller, truncate if larger
        const maxValue = (BigInt(1) << BigInt(structDef.size_bits)) - BigInt(1);
        
        if (fullValue > maxValue) {
            // Truncate: keep only the lower bits that fit
            fullValue = fullValue & maxValue;
        }
        
        // Convert to binary, padded to struct size
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
            const fieldBits = binaryValue.substring(
                totalBits - absoluteOffset - field.bits,
                totalBits - absoluteOffset
            );
            const fieldValue = parseInt(fieldBits, 2);
            
            const parsedField: ParsedField = {
                ...field,
                binary: fieldBits,
                value: fieldValue,
                hex: '0x' + fieldValue.toString(16).toUpperCase(),
                fullHexValue: '0x' + fullValue.toString(16).toUpperCase()
            };

            // Handle nested structs/unions
            if (field.children && field.children.length > 0) {
                parsedField.children = this._parseFields(
                    field.children, 
                    fieldBits, 
                    BigInt(fieldValue), 
                    field.bits,
                    0
                );
            }

            return parsedField;
        });
    }

    private _updateFieldValue(fieldPath: string[], newValue: number) {
        if (!this._currentParsedData) return;

        // Update the field value and recalculate
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
            // Validate value range
            const maxValue = (1 << targetField.bits) - 1;
            if (newValue < 0 || newValue > maxValue) {
                this._panel.webview.postMessage({
                    command: 'alert',
                    text: `Value out of range. Must be 0-${maxValue} for ${targetField.bits}-bit field`
                });
                return;
            }

            // Update field
            targetField.value = newValue;
            targetField.hex = '0x' + newValue.toString(16).toUpperCase();
            targetField.binary = newValue.toString(2).padStart(targetField.bits, '0');

            // Recalculate full hex value
            this._recalculateFullValue();

            this._panel.webview.postMessage({
                command: 'updateResult',
                fields: this._currentParsedData.fields,
                hexValue: this._currentParsedData.hexValue,
                fullHexValue: '0x' + BigInt('0x' + this._currentParsedData.hexValue.replace(/^0x/i, '')).toString(16).toUpperCase()
            });
        }
    }

    private _recalculateFullValue() {
        if (!this._currentParsedData) return;

        // Rebuild binary string from fields
        const rebuildBinary = (fields: ParsedField[], totalBits: number): string => {
            let binary = '';
            let currentOffset = 0;

            for (const field of fields) {
                // Pad if there's a gap
                while (currentOffset < field.offset) {
                    binary += '0';
                    currentOffset++;
                }
                
                binary += field.binary;
                currentOffset += field.bits;
            }

            // Pad to total bits
            while (binary.length < totalBits) {
                binary += '0';
            }

            return binary;
        };

        const newBinary = rebuildBinary(this._currentParsedData.fields, this._currentParsedData.struct.size_bits);
        const newValue = BigInt('0b' + newBinary);
        this._currentParsedData.hexValue = '0x' + newValue.toString(16).toUpperCase();
        this._currentParsedData.binaryValue = newBinary;
    }

    private _searchFields(searchTerm: string) {
        if (!this._currentParsedData) return;

        const results: { field: ParsedField; path: string[] }[] = [];
        
        const searchInFields = (fields: (ParsedField | StructField)[], path: string[]) => {
            for (const field of fields) {
                const currentPath = [...path, field.name];
                
                if (field.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    field.type.toLowerCase().includes(searchTerm.toLowerCase())) {
                    results.push({ field: field as ParsedField, path: currentPath });
                }

                if (field.children) {
                    searchInFields(field.children, currentPath);
                }
            }
        };

        searchInFields(this._currentParsedData.fields, []);

        this._panel.webview.postMessage({
            command: 'searchResults',
            results: results
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
                * {
                    box-sizing: border-box;
                }
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    margin: 0;
                }
                .container {
                    max-width: 1000px;
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
                .search-box {
                    display: flex;
                    gap: 10px;
                }
                .search-box input {
                    flex: 1;
                }
                button {
                    padding: 8px 16px;
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
                .info {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    margin-top: 5px;
                }
                .results-section {
                    margin-top: 20px;
                }
                .full-value {
                    padding: 15px;
                    background-color: var(--vscode-textCodeBlock-background);
                    border-radius: 6px;
                    margin-bottom: 20px;
                    font-family: var(--vscode-editor-font-family);
                }
                .full-value .label {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    margin-bottom: 5px;
                }
                .full-value .value {
                    font-size: 18px;
                    font-weight: bold;
                    color: var(--vscode-symbolIcon-colorForeground);
                }
                .tree-node {
                    margin-left: 20px;
                }
                .tree-header {
                    display: flex;
                    align-items: center;
                    padding: 8px;
                    cursor: pointer;
                    border-radius: 4px;
                    transition: background-color 0.2s;
                }
                .tree-header:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .tree-header.expanded {
                    background-color: var(--vscode-list-activeSelectionBackground);
                }
                .expand-icon {
                    width: 16px;
                    height: 16px;
                    margin-right: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    transition: transform 0.2s;
                }
                .expand-icon.expanded {
                    transform: rotate(90deg);
                }
                .field-info {
                    display: flex;
                    align-items: center;
                    flex: 1;
                    gap: 10px;
                }
                .field-name {
                    font-weight: bold;
                    min-width: 150px;
                }
                .field-type {
                    color: var(--vscode-symbolIcon-typeForeground);
                    min-width: 80px;
                }
                .field-bits {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    min-width: 60px;
                }
                .field-binary {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    color: var(--vscode-textPreformat-foreground);
                    flex: 1;
                    word-break: break-all;
                }
                .field-value {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .field-value input {
                    width: 80px;
                    padding: 4px 8px;
                    font-size: 13px;
                }
                .field-hex {
                    font-family: var(--vscode-editor-font-family);
                    color: var(--vscode-numberLiteral-foreground);
                    min-width: 70px;
                }
                .children {
                    display: none;
                }
                .children.expanded {
                    display: block;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    padding: 10px;
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border-radius: 4px;
                }
                .search-results {
                    margin-top: 10px;
                    padding: 10px;
                    background-color: var(--vscode-panel-background);
                    border-radius: 4px;
                }
                .search-result-item {
                    padding: 5px;
                    cursor: pointer;
                    border-radius: 3px;
                }
                .search-result-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .highlight {
                    background-color: var(--vscode-editor-findMatchHighlightBackground);
                    padding: 2px 4px;
                    border-radius: 3px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Struct Parser Viewer</h2>
                
                <div class="input-section">
                    <div class="input-group">
                        <label>Struct Definition:</label>
                        <button onclick="importJson()" style="width: 100%;">Import JSON File</button>
                        <div class="info" id="importStatus">${structNames.length > 0 ? `Loaded ${structNames.length} structs` : 'No struct data loaded - click Import to load'}</div>
                    </div>
                    
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
                    
                    <button onclick="parseValue()" ${structNames.length === 0 ? 'disabled' : ''}>Parse</button>
                </div>
                
                <div class="input-section" id="searchSection" style="display: none;">
                    <div class="input-group">
                        <label>Search Fields:</label>
                        <div class="search-box">
                            <input type="text" id="searchInput" placeholder="Search by field name or type..." />
                            <button onclick="searchFields()">Search</button>
                        </div>
                    </div>
                    <div id="searchResults"></div>
                </div>
                
                <div id="results" class="results-section"></div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentFields = [];
                let expandedNodes = new Set();
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'setHexValue':
                            document.getElementById('hexInput').value = message.hexValue;
                            break;
                        case 'parseResult':
                            displayResults(message);
                            break;
                        case 'updateResult':
                            updateResults(message);
                            break;
                        case 'searchResults':
                            displaySearchResults(message.results);
                            break;
                        case 'jsonImported':
                            updateStructList(message.structNames, message.filePath);
                            break;
                    }
                });
                
                function importJson() {
                    vscode.postMessage({ command: 'importJson' });
                }
                
                function updateStructList(structNames, filePath) {
                    // Update import status
                    const statusDiv = document.getElementById('importStatus');
                    if (statusDiv) {
                        statusDiv.textContent = 'Loaded ' + structNames.length + ' structs from ' + filePath.split('/').pop();
                    }
                    
                    // Update struct select dropdown
                    const select = document.getElementById('structSelect');
                    select.innerHTML = '<option value="">-- Select a struct --</option>' +
                        structNames.map(function(name) { return '<option value="' + name + '">' + name + '</option>'; }).join('');
                    
                    // Enable parse button
                    const parseBtn = document.querySelector('button[onclick="parseValue()"]');
                    if (parseBtn) {
                        parseBtn.disabled = false;
                    }
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
                    
                    vscode.postMessage({
                        command: 'parse',
                        hexValue: hexValue,
                        structName: structName
                    });
                }
                
                function searchFields() {
                    const searchTerm = document.getElementById('searchInput').value.trim();
                    if (!searchTerm) return;
                    
                    vscode.postMessage({
                        command: 'search',
                        searchTerm: searchTerm
                    });
                }
                
                function displayResults(data) {
                    currentFields = data.fields;
                    
                    if (data.error) {
                        document.getElementById('results').innerHTML = '<div class="error">' + data.error + '</div>';
                        document.getElementById('searchSection').style.display = 'none';
                        return;
                    }
                    
                    document.getElementById('searchSection').style.display = 'block';
                    
                    let html = '<div class="full-value">';
                    html += '<div class="label">Full Value' + (data.adjustedValue ? ' <span style="color: var(--vscode-editorWarning-foreground);">(adjusted)</span>' : '') + '</div>';
                    html += '<div class="value">' + data.fullHexValue + '</div>';
                    if (data.adjustedValue) {
                        html += '<div class="info" style="margin-top: 5px;">Input value was truncated/padded to fit struct size</div>';
                    }
                    html += '</div>';
                    
                    html += '<div id="treeRoot">';
                    html += renderTree(data.fields, []);
                    html += '</div>';
                    
                    document.getElementById('results').innerHTML = html;
                }
                
                function renderTree(fields, path) {
                    let html = '';
                    
                    fields.forEach((field, index) => {
                        const currentPath = [...path, field.name];
                        const pathStr = currentPath.join('.');
                        const hasChildren = field.children && field.children.length > 0;
                        const isExpanded = expandedNodes.has(pathStr);
                        
                        html += '<div class="tree-node">';
                        html += '<div class="tree-header ' + (isExpanded ? 'expanded' : '') + '" onclick="toggleNode(\'' + pathStr + '\')">';
                        
                        if (hasChildren) {
                            html += '<span class="expand-icon ' + (isExpanded ? 'expanded' : '') + '">▶</span>';
                        } else {
                            html += '<span class="expand-icon" style="visibility: hidden;">▶</span>';
                        }
                        
                        html += '<div class="field-info">';
                        html += '<span class="field-name">' + field.name + '</span>';
                        html += '<span class="field-type">' + field.type + '</span>';
                        html += '<span class="field-bits">' + field.bits + ' bits</span>';
                        html += '<span class="field-binary">' + field.binary + '</span>';
                        html += '</div>';
                        
                        html += '<div class="field-value">';
                        html += '<input type="number" value="' + field.value + '" ';
                        html += 'min="0" max="' + ((1 << field.bits) - 1) + '" ';
                        html += 'onchange="updateFieldValue(\'' + currentPath.join(',') + '\', this.value)" ';
                        html += 'onclick="event.stopPropagation()" />';
                        html += '<span class="field-hex">' + field.hex + '</span>';
                        html += '</div>';
                        
                        html += '</div>';
                        
                        if (hasChildren) {
                            html += '<div class="children ' + (isExpanded ? 'expanded' : '') + '" id="children-' + pathStr + '">';
                            html += renderTree(field.children, currentPath);
                            html += '</div>';
                        }
                        
                        html += '</div>';
                    });
                    
                    return html;
                }
                
                function toggleNode(pathStr) {
                    if (expandedNodes.has(pathStr)) {
                        expandedNodes.delete(pathStr);
                    } else {
                        expandedNodes.add(pathStr);
                    }
                    // Re-render would be needed here in a real app
                    // For simplicity, we just toggle the class
                    const children = document.getElementById('children-' + pathStr);
                    if (children) {
                        children.classList.toggle('expanded');
                    }
                }
                
                function updateFieldValue(pathStr, newValue) {
                    vscode.postMessage({
                        command: 'updateField',
                        fieldPath: pathStr.split(','),
                        newValue: parseInt(newValue)
                    });
                }
                
                function updateResults(data) {
                    // Update the displayed values without full re-render
                    // This is a simplified version - in production, you'd want more targeted updates
                    const inputs = document.querySelectorAll('.field-value input');
                    inputs.forEach(input => {
                        // Find corresponding field and update
                        // Implementation depends on how you track field-input relationships
                    });
                }
                
                function displaySearchResults(results) {
                    let html = '<div class="search-results">';
                    html += '<div style="font-weight: bold; margin-bottom: 10px;">Search Results:</div>';
                    
                    if (results.length === 0) {
                        html += '<div>No fields found</div>';
                    } else {
                        results.forEach(result => {
                            html += '<div class="search-result-item" onclick="highlightField(\'' + result.path.join('.') + '\')">';
                            html += result.path.join('.');
                            html += ' <span style="color: var(--vscode-descriptionForeground);">(' + result.field.type + ')</span>';
                            html += '</div>';
                        });
                    }
                    
                    html += '</div>';
                    document.getElementById('searchResults').innerHTML = html;
                }
                
                function highlightField(pathStr) {
                    // Expand parent nodes and scroll to field
                    const path = pathStr.split('.');
                    for (let i = 1; i <= path.length; i++) {
                        const partialPath = path.slice(0, i).join('.');
                        expandedNodes.add(partialPath);
                        const children = document.getElementById('children-' + partialPath);
                        if (children) {
                            children.classList.add('expanded');
                        }
                    }
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
