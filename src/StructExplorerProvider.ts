import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
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

class StructTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly structType: 'struct' | 'union' | 'category',
        public readonly sizeBits?: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(label, collapsibleState);
        
        if (structType === 'category') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (structType === 'struct') {
            this.iconPath = new vscode.ThemeIcon('symbol-structure');
            this.tooltip = `Struct ${label} (${sizeBits} bits)`;
            this.description = `${sizeBits} bits`;
            this.command = {
                command: 'structParser.openViewerWithStruct',
                title: 'Open with Struct',
                arguments: [label]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-enum');
            this.tooltip = `Union ${label} (${sizeBits} bits)`;
            this.description = `${sizeBits} bits`;
            this.command = {
                command: 'structParser.openViewerWithStruct',
                title: 'Open with Struct',
                arguments: [label]
            };
        }
    }
}

export class StructExplorerProvider implements vscode.TreeDataProvider<StructTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StructTreeItem | undefined | null | void> = new vscode.EventEmitter<StructTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StructTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _structData: StructJson | null = null;
    private _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this.loadFromConfig();
    }

    public loadFromConfig() {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPath = config.get<string>('jsonPath');

        if (jsonPath && fs.existsSync(jsonPath)) {
            try {
                const content = fs.readFileSync(jsonPath, 'utf-8');
                this._structData = JSON.parse(content);
                this._onDidChangeTreeData.fire();
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
                            this._onDidChangeTreeData.fire();
                            break;
                        } catch (error) {
                            // Continue to next path
                        }
                    }
                }
            }
        }
    }

    public refresh(structData: StructJson) {
        this._structData = structData;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: StructTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: StructTreeItem): Thenable<StructTreeItem[]> {
        if (!this._structData) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Return root categories
            const items: StructTreeItem[] = [];
            
            if (this._structData.structs && this._structData.structs.length > 0) {
                items.push(new StructTreeItem(
                    'Structs',
                    'category',
                    undefined,
                    vscode.TreeItemCollapsibleState.Expanded
                ));
            }

            if (this._structData.unions && this._structData.unions.length > 0) {
                items.push(new StructTreeItem(
                    'Unions',
                    'category',
                    undefined,
                    vscode.TreeItemCollapsibleState.Expanded
                ));
            }

            return Promise.resolve(items);
        } else if (element.label === 'Structs') {
            return Promise.resolve(
                this._structData.structs.map(struct => new StructTreeItem(
                    struct.type,
                    'struct',
                    struct.bits
                ))
            );
        } else if (element.label === 'Unions') {
            return Promise.resolve(
                this._structData.unions.map(union => new StructTreeItem(
                    union.type,
                    'union',
                    union.bits
                ))
            );
        }

        return Promise.resolve([]);
    }
}
