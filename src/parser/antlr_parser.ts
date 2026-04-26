import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { ParseTreeWalker } from 'antlr4ts/tree/ParseTreeWalker';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import * as fs from 'fs';
import * as path from 'path';
import { StructParserLexer } from './generated/antlr4/StructParserLexer';
import { StructParserParser } from './generated/antlr4/StructParserParser';
import { StructParserListener } from './generated/antlr4/StructParserListener';
import { Field, Struct, Union, ParseResult, getTypeBits } from './models';

/**
 * 基于 ANTLR4 的结构体解析器
 *
 * 解析流程（三阶段）：
 * 1. 收集(Collect): 扫描文件夹中所有头文件，用 ANTLR 解析出所有 struct/union 定义，存入 typeRegistry
 * 2. 排序(Sort): 分析类型间依赖关系，进行拓扑排序，保证被依赖的类型先解析
 * 3. 计算(Calculate): 按拓扑顺序计算每个类型的 offset 和 bits
 */
export class AntlrStructParser {
  private typeRegistry: Map<string, Struct | Union> = new Map();
  private errors: string[] = [];

  /**
   * 解析文件夹中的所有头文件
   * @param dirPath 包含预处理后的头文件的文件夹路径
   */
  parse(dirPath: string): ParseResult {
    this.reset();

    try {
      // Phase 1: 扫描并收集所有类型定义
      const files = this.scanHeaderFiles(dirPath);
      if (files.length === 0) {
        this.errors.push(`No header files (.h/.hpp) found in: ${dirPath}`);
      }

      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          this.collectTypes(content);
        } catch (err) {
          this.errors.push(`Error reading ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 2 & 3: 拓扑排序并计算
      return this.sortAndCalculate();
    } catch (error) {
      this.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      return this.buildResult(false);
    }
  }

  /**
   * 解析字符串内容（用于测试或单个文件内容）
   */
  parseContent(content: string): ParseResult {
    this.reset();

    try {
      // Phase 1: 收集类型
      this.collectTypes(content);

      // Phase 2 & 3: 拓扑排序并计算
      return this.sortAndCalculate();
    } catch (error) {
      this.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      return this.buildResult(false);
    }
  }

  /**
   * 检测循环引用（委托给 topologicalSort，保留向后兼容）
   */
  detectCircularReferences(): string[] {
    const sortResult = this.topologicalSort();
    return sortResult.errors || [];
  }

  // ==================== Private Methods ====================

  private reset(): void {
    this.typeRegistry.clear();
    this.errors = [];
  }

  private scanHeaderFiles(dirPath: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      this.errors.push(`Not a valid directory: ${dirPath}`);
      return files;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.h') || entry.name.endsWith('.hpp'))) {
        files.push(path.join(dirPath, entry.name));
      }
    }
    return files;
  }

  /**
   * Phase 1: 收集 - 从内容中提取所有 struct/union 定义到 typeRegistry
   */
  private collectTypes(content: string): void {
    const inputStream = CharStreams.fromString(content);
    const lexer = new StructParserLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new StructParserParser(tokenStream);

    parser.removeErrorListeners();
    const errorListener = new StructParseErrorListener();
    parser.addErrorListener(errorListener);

    const tree = parser.program();

    const extractor = new TypeExtractor();
    ParseTreeWalker.DEFAULT.walk(extractor, tree);

    // 将命名类型添加到注册表（匿名类型不进入注册表）
    for (const typeDef of extractor.types) {
      if (typeDef.name && !typeDef.anonymous) {
        this.typeRegistry.set(typeDef.name, typeDef);
      }
    }

    this.errors.push(...errorListener.errors, ...extractor.errors);
  }

  /**
   * Phase 2 & 3: 拓扑排序 + 计算 offset/bits
   */
  private sortAndCalculate(): ParseResult {
    // Phase 2: 拓扑排序
    const sortResult = this.topologicalSort();
    if (!sortResult.success) {
      this.errors.push(...sortResult.errors!);
      return this.buildResult(false);
    }

    // Phase 3: 按拓扑顺序计算 offset 和 bits
    for (const typeName of sortResult.order!) {
      const typeDef = this.typeRegistry.get(typeName);
      if (typeDef) {
        this.calculateOffsetsAndSizes(typeDef);
      }
    }

    return this.buildResult();
  }

  /**
   * Phase 2: 拓扑排序 - 确保依赖的类型先被计算
   */
  private topologicalSort(): { success: boolean; order?: string[]; errors?: string[] } {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const order: string[] = [];
    const errors: string[] = [];
    const path: string[] = [];

    const visit = (typeName: string): boolean => {
      if (inStack.has(typeName)) {
        const cycleStart = path.indexOf(typeName);
        const cycle = path.slice(cycleStart).concat(typeName);
        errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
        return false;
      }
      if (visited.has(typeName)) return true;

      const typeDef = this.typeRegistry.get(typeName);
      if (!typeDef) return true;

      inStack.add(typeName);
      path.push(typeName);

      // 检查字段中的类型引用
      for (const field of typeDef.fields) {
        const refName = this.getFieldReferenceType(field);
        if (refName && this.typeRegistry.has(refName)) {
          if (!visit(refName)) {
            return false;
          }
        }
      }

      path.pop();
      inStack.delete(typeName);
      visited.add(typeName);
      order.push(typeName);
      return true;
    };

    for (const [name] of this.typeRegistry) {
      if (!visited.has(name)) {
        if (!visit(name)) {
          return { success: false, errors };
        }
      }
    }

    return { success: true, order };
  }

  /**
   * 获取字段引用的类型名（如果不是引用则返回 null）
   */
  private getFieldReferenceType(field: Field): string | null {
    // 匿名嵌套结构不是引用
    if (field.nestedStruct || field.nestedUnion) return null;

    // 基础类型不是引用
    if (getTypeBits(field.type) !== null) return null;

    // 特殊类型名不是引用
    if (field.type === 'anonymous_struct' || field.type === 'anonymous_union') return null;

    return field.type;
  }

  /**
   * Phase 3: 计算类型的 offset 和 bits
   */
  private calculateOffsetsAndSizes(typeDef: Struct | Union, baseOffset: number = 0): void {
    let currentOffset = baseOffset;

    for (const field of typeDef.fields) {
      field.offset = currentOffset;

      if (field.nestedStruct) {
        // 匿名 struct：递归计算
        this.calculateOffsetsAndSizes(field.nestedStruct, field.offset);
        field.bits = field.nestedStruct.bits;
      } else if (field.nestedUnion) {
        // 匿名 union：递归计算
        this.calculateOffsetsAndSizes(field.nestedUnion, field.offset);
        field.bits = field.nestedUnion.bits;
      } else {
        const refType = this.typeRegistry.get(field.type);
        if (refType) {
          // 引用已定义的类型：拷贝并调整 offset（无需重新 calculate）
          field.bits = refType.bits;
          if (refType.type === 'struct') {
            field.nestedStruct = this.cloneWithOffset(refType, field.offset) as Struct;
          } else {
            field.nestedUnion = this.cloneWithOffset(refType, field.offset) as Union;
          }
        } else {
          // 基础类型
          const bits = getTypeBits(field.type);
          if (bits !== null) {
            field.bits = bits;
          }
        }
      }

      if (typeDef.type === 'struct') {
        currentOffset += field.bits;
      }
    }

    // 计算类型总大小
    if (typeDef.type === 'struct') {
      typeDef.bits = currentOffset - baseOffset;
    } else {
      typeDef.bits = this.maxBits(typeDef.fields);
    }
    typeDef.offset = baseOffset;
  }

  /**
   * 拷贝类型定义并调整所有字段的 offset（递归），不重新计算 bits
   */
  private cloneWithOffset(typeDef: Struct | Union, newOffset: number): Struct | Union {
    const offsetDelta = newOffset - typeDef.offset;
    return {
      name: typeDef.name,
      type: typeDef.type,
      bits: typeDef.bits,
      offset: newOffset,
      anonymous: typeDef.anonymous,
      fields: typeDef.fields.map(f => this.adjustFieldOffset(f, offsetDelta))
    };
  }

  /**
   * 递归调整字段的 offset（仅加偏移量，不重算 bits）
   */
  private adjustFieldOffset(field: Field, delta: number): Field {
    const adjusted: Field = {
      name: field.name,
      type: field.type,
      bits: field.bits,
      offset: field.offset + delta
    };
    if (field.nestedStruct) {
      adjusted.nestedStruct = this.cloneWithOffset(field.nestedStruct, field.nestedStruct.offset + delta) as Struct;
    }
    if (field.nestedUnion) {
      adjusted.nestedUnion = this.cloneWithOffset(field.nestedUnion, field.nestedUnion.offset + delta) as Union;
    }
    return adjusted;
  }

  private maxBits(fields: Field[]): number {
    let max = 0;
    for (const f of fields) {
      if (f.bits > max) max = f.bits;
    }
    return max;
  }

  private buildResult(forceSuccess: boolean | null = null): ParseResult {
    const structs: Struct[] = [];
    const unions: Union[] = [];

    for (const [, typeDef] of this.typeRegistry) {
      if (!typeDef.anonymous) {
        if (typeDef.type === 'struct') structs.push(typeDef);
        else unions.push(typeDef);
      }
    }

    return {
      structs,
      unions,
      errors: this.errors,
      success: forceSuccess !== null ? forceSuccess : this.errors.length === 0
    };
  }
}

// ==================== ANTLR Listeners ====================

/**
 * 错误监听器
 */
class StructParseErrorListener {
  errors: string[] = [];

  syntaxError(
    _recognizer: any,
    _offendingSymbol: any,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: any
  ): void {
    this.errors.push(`Line ${line}:${charPositionInLine} - ${msg}`);
  }
}

/**
 * Phase 1 类型提取器 - 从 AST 中提取 struct/union 定义
 * 不计算 offset 和 bits，只收集结构
 */
class TypeExtractor implements StructParserListener {
  types: Array<Struct | Union> = [];
  errors: string[] = [];

  enterStructDeclaration(ctx: any): void {
    const name = ctx.Identifier()?.text || '';
    const fields = this.extractFields(ctx.fieldList());

    this.types.push({
      name,
      type: 'struct',
      bits: 0,
      offset: 0,
      anonymous: !name,
      fields
    });
  }

  enterUnionDeclaration(ctx: any): void {
    const name = ctx.Identifier()?.text || '';
    const fields = this.extractFields(ctx.fieldList());

    this.types.push({
      name,
      type: 'union',
      bits: 0,
      offset: 0,
      anonymous: !name,
      fields
    });
  }

  // 实现接口所需的空方法
  visitTerminal(_node: TerminalNode): void {}
  visitErrorNode(_node: TerminalNode): void {}
  enterEveryRule(_ctx: any): void {}
  exitEveryRule(_ctx: any): void {}

  private extractFields(fieldListCtx: any): Field[] {
    const fields: Field[] = [];
    if (!fieldListCtx) return fields;

    const fieldContexts = fieldListCtx.field();
    if (!fieldContexts) return fields;

    for (const fieldCtx of fieldContexts) {
      const field = this.parseField(fieldCtx);
      if (field) {
        fields.push(field);
      }
    }

    return fields;
  }

  private parseField(fieldCtx: any): Field | null {
    try {
      // 基础类型: uintN name;
      const typeSpecifier = fieldCtx.typeSpecifier();
      const fieldName = fieldCtx.fieldName();

      if (typeSpecifier && fieldName) {
        const typeName = typeSpecifier.text;
        return {
          name: fieldName.text,
          type: typeName,
          bits: 0,
          offset: 0
        };
      }

      // 匿名结构体: struct { ... } name?
      if (fieldCtx.children && fieldCtx.children[0]?.text === 'struct' && fieldCtx.fieldList()) {
        const fieldListCtx = fieldCtx.fieldList();
        const fieldNameNode = fieldCtx.fieldName();
        const nestedFields = this.extractFields(fieldListCtx);

        const nestedStruct: Struct = {
          name: '',
          type: 'struct',
          bits: 0,
          offset: 0,
          anonymous: true,
          fields: nestedFields
        };

        return {
          name: fieldNameNode ? fieldNameNode.text : '',
          type: 'struct',
          bits: 0,
          offset: 0,
          nestedStruct
        };
      }

      // 匿名联合体: union { ... } name?
      if (fieldCtx.children && fieldCtx.children[0]?.text === 'union' && fieldCtx.fieldList()) {
        const fieldListCtx = fieldCtx.fieldList();
        const fieldNameNode = fieldCtx.fieldName();
        const nestedFields = this.extractFields(fieldListCtx);

        const nestedUnion: Union = {
          name: '',
          type: 'union',
          bits: 0,
          offset: 0,
          anonymous: true,
          fields: nestedFields
        };

        return {
          name: fieldNameNode ? fieldNameNode.text : '',
          type: 'union',
          bits: 0,
          offset: 0,
          nestedUnion
        };
      }

      // 标准 C 语法: struct/union Name name; 或 类型引用: TypeName name;
      const structOrUnion = fieldCtx.children?.[0]?.text;
      const identifier = fieldCtx.Identifier?.();

      if (fieldName) {
        const name = fieldName.text;

        if ((structOrUnion === 'struct' || structOrUnion === 'union') && identifier) {
          // struct TypeName fieldName; 或 union TypeName fieldName;
          return {
            name,
            type: identifier.text,
            bits: 0,
            offset: 0
          };
        }

        // 类型引用: TypeName fieldName;
        if (identifier) {
          return {
            name,
            type: identifier.text,
            bits: 0,
            offset: 0
          };
        }
      }

      return null;
    } catch (error) {
      this.errors.push(`Error parsing field: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
