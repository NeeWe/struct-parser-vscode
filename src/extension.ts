import * as vscode from 'vscode';
import { StructParserPanel } from './StructParserPanel';
import { StructDataProvider } from './StructDataProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Struct Parser extension is now active');

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

    // Register tree data provider for struct list
    const structDataProvider = new StructDataProvider();
    vscode.window.registerTreeDataProvider('structList', structDataProvider);

    context.subscriptions.push(openViewerCommand, parseFromHexCommand);
}

export function deactivate() {}
