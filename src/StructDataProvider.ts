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

class StructItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly structType: 'struct' | 'union',
        public readonly sizeBits: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = `${structType} ${label} (${sizeBits} bits)`;
        this.description = `${sizeBits} bits`;
        this.iconPath = structType === 'struct' 
            ? new vscode.ThemeIcon('symbol-structure')
            : new vscode.ThemeIcon('symbol-enum');
    }
}

class FieldItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly fieldType: string,
        public readonly bits: number,
        public readonly offset: number
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${fieldType} ${label} (${bits} bits at offset ${offset})`;
        this.description = `${fieldType}, ${bits} bits @ ${offset}`;
        this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
}

export class StructDataProvider implements vscode.TreeDataProvider<StructItem | FieldItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StructItem | FieldItem | undefined | null | void> = new vscode.EventEmitter<StructItem | FieldItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StructItem | FieldItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _structData: StructJson | null = null;

    constructor() {
        this._loadStructData();
    }

    private _loadStructData() {
        const config = vscode.workspace.getConfiguration('structParser');
        const jsonPath = config.get<string>('jsonPath');

        if (jsonPath && fs.existsSync(jsonPath)) {
            try {
                const content = fs.readFileSync(jsonPath, 'utf-8');
                this._structData = JSON.parse(content);
                this._onDidChangeTreeData.fire();
            } catch (error) {
                console.error('Failed to load struct JSON:', error);
            }
        } else {
            // Try to find in workspace
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

    refresh(): void {
        this._loadStructData();
    }

    getTreeItem(element: StructItem | FieldItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: StructItem | FieldItem): Thenable<(StructItem | FieldItem)[]> {
        if (!this._structData) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Return root items (structs and unions)
            const items: StructItem[] = [];
            
            this._structData.structs.forEach(struct => {
                items.push(new StructItem(
                    struct.name,
                    'struct',
                    struct.size_bits,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            });

            this._structData.unions.forEach(union => {
                items.push(new StructItem(
                    union.name,
                    'union',
                    union.size_bits,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            });

            return Promise.resolve(items);
        } else if (element instanceof StructItem) {
            // Return fields for the selected struct/union
            const structDef = this._structData.structs.find(s => s.name === element.label) ||
                             this._structData.unions.find(s => s.name === element.label);
            
            if (structDef) {
                return Promise.resolve(
                    structDef.fields.map(field => new FieldItem(
                        field.name,
                        field.type,
                        field.bits,
                        field.offset
                    ))
                );
            }
        }

        return Promise.resolve([]);
    }
}
