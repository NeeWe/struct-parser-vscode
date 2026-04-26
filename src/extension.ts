import * as vscode from 'vscode';
import { StructParserPanel } from './StructParserPanel';
import { StructSelectorProvider } from './StructSelectorProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Struct Parser extension is now active');

    // Create and register the sidebar webview provider
    const structSelectorProvider = new StructSelectorProvider(context.extensionUri);
    
    // Register the webview view
    const selectorView = vscode.window.registerWebviewViewProvider(
        StructSelectorProvider.viewType,
        structSelectorProvider
    );

    // Register the main command to open the viewer
    const openViewerCommand = vscode.commands.registerCommand('structParser.openViewer', () => {
        StructParserPanel.createOrShow(context.extensionUri);
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

    // Handle struct selection from sidebar
    context.subscriptions.push(
        structSelectorProvider.onStructSelected((struct) => {
            const panel = StructParserPanel.createOrShow(context.extensionUri, struct.type);
            panel.showStructDefinition(struct);
        })
    );

    // Broadcast global hide-zero toggle to all open panels
    context.subscriptions.push(
        structSelectorProvider.onHideZeroChanged((hideZero) => {
            StructParserPanel.panels.forEach(panel => {
                panel.setHideZero(hideZero);
            });
        })
    );

    // Broadcast global bitvis toggle to all open panels
    context.subscriptions.push(
        structSelectorProvider.onBitVisChanged((visible) => {
            StructParserPanel.panels.forEach(panel => {
                panel.setBitVisVisible(visible);
            });
        })
    );

    context.subscriptions.push(
        openViewerCommand, 
        parseFromHexCommand, 
        selectorView
    );
}

export function deactivate() {}
