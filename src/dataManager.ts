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

export interface StructJson {
    structs: StructDef[];
    unions: StructDef[];
}

/** 仅包含元数据，不含具体数据 */
export interface StructSetMeta {
    name: string;
    importedAt: number;
    source?: string;
}

/** 包含元数据和具体数据（仅内部使用） */
export interface StructSet extends StructSetMeta {
    data: StructJson;
}

// 元数据索引 key（仅存储 name/importedAt/source，不存具体数据）
const INDEX_KEY = 'structParser.structSets';
const ACTIVE_KEY = 'structParser.activeStructSet';
// 每个 struct set 的数据单独存储，避免全量加载
const DATA_KEY_PREFIX = 'structParser.data.';

// 模块级内存缓存，避免重复从 globalState 反序列化
const _dataCache = new Map<string, StructJson>();
let _metaCache: StructSetMeta[] | null = null;

function _dataKey(name: string): string {
    return DATA_KEY_PREFIX + name;
}

/**
 * 返回所有结构集的元数据（不包含具体数据）。
 * 使用内存缓存，避免重复反序列化全量数据。
 */
export function getStructSets(context: vscode.ExtensionContext): StructSetMeta[] {
    if (_metaCache !== null) { return _metaCache; }

    const stored = context.globalState.get<any[]>(INDEX_KEY) || [];

    // 自动迁移：旧格式将全量数据嵌入 structSets，新格式仅存元数据
    if (stored.length > 0 && 'data' in stored[0]) {
        const metaOnly: StructSetMeta[] = [];
        for (const s of stored as StructSet[]) {
            const meta: StructSetMeta = { name: s.name, importedAt: s.importedAt, source: s.source };
            metaOnly.push(meta);
            // 将数据写入独立 key（异步，不需要等待）
            context.globalState.update(_dataKey(s.name), s.data);
            _dataCache.set(s.name, s.data);
        }
        // 更新索引为仅元数据
        context.globalState.update(INDEX_KEY, metaOnly);
        _metaCache = metaOnly;
        return _metaCache;
    }

    _metaCache = stored as StructSetMeta[];
    return _metaCache;
}

/**
 * 获取指定结构集的具体数据。
 * 优先读内存缓存，其次才读 globalState。
 */
export function getStructSetData(context: vscode.ExtensionContext, name: string): StructJson | null {
    if (_dataCache.has(name)) {
        return _dataCache.get(name)!;
    }
    const data = context.globalState.get<StructJson>(_dataKey(name));
    if (data) {
        _dataCache.set(name, data);
        return data;
    }
    return null;
}

/**
 * 保存结构集：元数据写入索引，具体数据写入独立 key。
 * 避免将全量大数据合并写入单个 globalState key。
 */
export async function saveStructSet(
    context: vscode.ExtensionContext,
    name: string,
    data: StructJson,
    source?: string
): Promise<void> {
    const meta = getStructSets(context);
    const newMeta: StructSetMeta = { name, importedAt: Date.now(), source };
    const existingIndex = meta.findIndex(s => s.name === name);
    if (existingIndex >= 0) {
        meta[existingIndex] = newMeta;
    } else {
        meta.push(newMeta);
    }
    _metaCache = meta;
    _dataCache.set(name, data);
    // 并行写入元数据和具体数据
    await Promise.all([
        context.globalState.update(INDEX_KEY, meta),
        context.globalState.update(_dataKey(name), data)
    ]);
}

/**
 * 删除指定结构集及其独立存储的数据。
 */
export async function deleteStructSet(context: vscode.ExtensionContext, name: string): Promise<void> {
    const meta = getStructSets(context).filter(s => s.name !== name);
    _metaCache = meta;
    _dataCache.delete(name);
    const active = context.globalState.get<string>(ACTIVE_KEY);
    await Promise.all([
        context.globalState.update(INDEX_KEY, meta),
        context.globalState.update(_dataKey(name), undefined),
        ...(active === name ? [context.globalState.update(ACTIVE_KEY, undefined)] : [])
    ]);
}

/**
 * 清除所有结构集（包括元数据、具体数据、激活标记）。
 */
export async function clearAllStructSets(context: vscode.ExtensionContext): Promise<void> {
    const meta = getStructSets(context);
    _metaCache = [];
    _dataCache.clear();
    await Promise.all([
        context.globalState.update(INDEX_KEY, undefined),
        context.globalState.update(ACTIVE_KEY, undefined),
        ...meta.map(s => context.globalState.update(_dataKey(s.name), undefined))
    ]);
}

export function getActiveStructSetName(context: vscode.ExtensionContext): string | undefined {
    return context.globalState.get<string>(ACTIVE_KEY);
}

export async function setActiveStructSet(
    context: vscode.ExtensionContext,
    name: string | undefined
): Promise<void> {
    await context.globalState.update(ACTIVE_KEY, name);
}

/**
 * 获取当前激活结构集的具体数据。
 * 仅加载当前活跍的集合，不会反序列化全量数据。
 */
export function getActiveStructData(context: vscode.ExtensionContext): StructJson | null {
    const name = getActiveStructSetName(context);
    if (!name) { return null; }
    return getStructSetData(context, name);
}
