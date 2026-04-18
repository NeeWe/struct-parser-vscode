import * as vscode from 'vscode';
import { StructParserPanel } from './StructParserPanel';
import { StructExplorerProvider } from './StructExplorerProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Struct Parser extension is now active');

    // Create and register the sidebar tree data provider
    const structExplorerProvider = new StructExplorerProvider(context.extensionUri);
    
    // Register the tree view in the explorer sidebar
    const treeView = vscode.window.createTreeView('structExplorer', {
        treeDataProvider: structExplorerProvider,
        showCollapseAll: true
    });

    // Register the main command to open the viewer
    const openViewerCommand = vscode.commands.registerCommand('structParser.openViewer', () => {
        StructParserPanel.createOrShow(context.extensionUri);
    });

    // Register command to open viewer with specific struct
    const openViewerWithStructCommand = vscode.commands.registerCommand('structParser.openViewerWithStruct', (structName: string) => {
        const panel = StructParserPanel.createOrShow(context.extensionUri);
        panel.selectStruct(structName);
    });

    // Register command to parse selected hex value
    const parseFromHexCommand = vscode.commands.registerCommand('structParser.parseFromHex', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();
        
        // Clean up the hex string (remove 0x prefix, spaces, etc.)
        const hexValue = selectedText.replace(/^0x/i, '').replace(/\s/g, '');
        
        if (!/^[0-9A-Fa-f]+$/.test(hexValue)) {
            vscode.window.showErrorMessage('Selected text is not a valid hex value');
            return;
        }

        // Show the panel and parse the value
        const panel = StructParserPanel.createOrShow(context.extensionUri);
        panel.parseHexValue(hexValue);
    });

    // Register command to import JSON from sidebar
    const importJsonCommand = vscode.commands.registerCommand('structParser.importJson', async () => {
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
                const fs = await import('fs');
                const content = fs.readFileSync(result[0].fsPath, 'utf-8');
                const structData = JSON.parse(content);
                
                // Save to configuration
                const config = vscode.workspace.getConfiguration('structParser');
                await config.update('jsonPath', result[0].fsPath, true);
                
                // Refresh the tree view
                structExplorerProvider.refresh(structData);
                
                // Also update panel if it's open
                if (StructParserPanel.currentPanel) {
                    StructParserPanel.currentPanel.refreshStructList(structData);
                }
                
                vscode.window.showInformationMessage(`Loaded ${structData.structs?.length || 0} structs from ${result[0].fsPath.split('/').pop()}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load JSON: ${error}`);
            }
        }
    });

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('structParser.refresh', () => {
        structExplorerProvider.loadFromConfig();
    });

    context.subscriptions.push(
        openViewerCommand, 
        openViewerWithStructCommand,
        parseFromHexCommand, 
        importJsonCommand,
        refreshCommand,
        treeView
    );
}

export function deactivate() {}
