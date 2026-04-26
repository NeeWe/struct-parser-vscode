import * as vscode from 'vscode';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    value?: number;
    hex?: string;
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

export interface StructSet {
    name: string;
    data: StructJson;
    importedAt: number;
    source?: string;
}

const STRUCT_SETS_KEY = 'structParser.structSets';
const ACTIVE_SET_KEY = 'structParser.activeStructSet';

export function getStructSets(context: vscode.ExtensionContext): StructSet[] {
    return context.globalState.get<StructSet[]>(STRUCT_SETS_KEY) || [];
}

export function saveStructSet(context: vscode.ExtensionContext, name: string, data: StructJson, source?: string): void {
    const sets = getStructSets(context);
    const existingIndex = sets.findIndex(s => s.name === name);
    const newSet: StructSet = { name, data, importedAt: Date.now(), source };
    if (existingIndex >= 0) {
        sets[existingIndex] = newSet;
    } else {
        sets.push(newSet);
    }
    context.globalState.update(STRUCT_SETS_KEY, sets);
}

export function deleteStructSet(context: vscode.ExtensionContext, name: string): void {
    const sets = getStructSets(context).filter(s => s.name !== name);
    context.globalState.update(STRUCT_SETS_KEY, sets);
    const active = context.globalState.get<string>(ACTIVE_SET_KEY);
    if (active === name) {
        context.globalState.update(ACTIVE_SET_KEY, undefined);
    }
}

export function getActiveStructSetName(context: vscode.ExtensionContext): string | undefined {
    return context.globalState.get<string>(ACTIVE_SET_KEY);
}

export function setActiveStructSet(context: vscode.ExtensionContext, name: string | undefined): void {
    context.globalState.update(ACTIVE_SET_KEY, name);
}

export function getActiveStructData(context: vscode.ExtensionContext): StructJson | null {
    const name = getActiveStructSetName(context);
    if (!name) { return null; }
    const sets = getStructSets(context);
    const set = sets.find(s => s.name === name);
    return set ? set.data : null;
}
