import * as vscode from 'vscode';
import { StructParserPanel } from './StructParserPanel';
import { StructSelectorProvider } from './StructSelectorProvider';
import { StructParserService } from './parser/service';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Struct Parser extension is now active');

    // Share context with panel for globalState access
    StructParserPanel.context = context;

    // Create and register the sidebar webview provider
    const structSelectorProvider = new StructSelectorProvider(context.extensionUri, context);
    
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
    
    // Register command to parse from command.txt
    const parseFromCommandTxtCommand = vscode.commands.registerCommand('structParser.parseFromCommandTxt', async () => {
        const commandUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Command files': ['txt'], 'All files': ['*'] },
            title: 'Select command.txt file'
        });

        if (!commandUri || commandUri.length === 0) {
            return;
        }

        const commandFile = commandUri[0].fsPath;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const outputDir = workspaceFolders ? workspaceFolders[0].uri.fsPath : path.dirname(commandFile);
        const outputFile = path.join(outputDir, 'structs_output.json');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Parsing structs from command.txt...',
            cancellable: false
        }, async (progress) => {
            try {
                const service = new StructParserService();
                const result = await service.parseFromCommandTxt(commandFile, outputFile);

                if (result.success) {
                    const totalTypes = result.structs.length + result.unions.length;
                    vscode.window.showInformationMessage(
                        'Parsed ' + totalTypes + ' types (' + result.structs.length + ' structs, ' + result.unions.length + ' unions)'
                    );
                    await structSelectorProvider.loadFromPath(outputFile);
                } else {
                    vscode.window.showErrorMessage(
                        'Parse failed: ' + result.errors.slice(0, 3).join('; ')
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    'Error: ' + (error instanceof Error ? error.message : String(error))
                );
            }
        });
    });
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
            // 同步当前 BitView 开关状态到 panel（新 panel 默认为 true，需与侧边栏保持一致）
            panel.setBitVisVisible(structSelectorProvider.showBitVis);
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

    // Refresh all panels when cached struct set changes
    context.subscriptions.push(
        structSelectorProvider.onStructSetChanged(() => {
            StructParserPanel.panels.forEach(panel => {
                panel.refreshStructData();
            });
        })
    );

    context.subscriptions.push(
        openViewerCommand,
        parseFromCommandTxtCommand,
        parseFromHexCommand,
        selectorView
    );
}

export function deactivate() {}
