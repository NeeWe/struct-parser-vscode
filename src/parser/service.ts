import * as fs from 'fs';
import * as path from 'path';
import { GccPreprocessor, PreprocessResult } from './preprocessor';
import { AntlrStructParser } from './antlr_parser';
import { ParseResult, Struct, Union, Field } from './models';

/**
 * 结构体解析服务 - 整合 GCC 预处理和结构体解析
 */
export class StructParserService {
  private preprocessor: GccPreprocessor;
  private parser: AntlrStructParser;
  /** 文件解析缓存：key=filePath, value={mtime, result} */
  private cache = new Map<string, { mtime: number; result: ParseResult }>();

  constructor() {
    this.preprocessor = new GccPreprocessor();
    this.parser = new AntlrStructParser();
  }

  /**
   * 检查 GCC 是否可用
   */
  static isGccAvailable(): boolean {
    return GccPreprocessor.isGccAvailable();
  }

  /**
   * 获取 GCC 版本
   */
  static getGccVersion(): string {
    return GccPreprocessor.getGccVersion();
  }

  /**
   * 从编译配置文件加载配置
   */
  loadCompileConfig(configFile: string): void {
    this.preprocessor.loadCompileConfig(configFile);
  }

  /**
   * 设置预处理器配置
   */
  setPreprocessorConfig(config: {
    includeDirs?: string[];
    defines?: Map<string, string | undefined>;
    includes?: string[];
    imacros?: string[];
  }): void {
    this.preprocessor.setConfig(config);
  }

  /**
   * 清除解析缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 解析单个头文件
   */
  async parseFile(filePath: string): Promise<ParseResult> {
    const errors: string[] = [];

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return {
        structs: [],
        unions: [],
        errors: [`File not found: ${filePath}`],
        success: false
      };
    }

    // 检查缓存
    try {
      const stat = fs.statSync(filePath);
      const cached = this.cache.get(filePath);
      if (cached && cached.mtime === stat.mtimeMs) {
        return cached.result;
      }
    } catch {
      // ignore stat errors
    }

    // 检查 GCC 可用性
    if (!GccPreprocessor.isGccAvailable()) {
      return {
        structs: [],
        unions: [],
        errors: ['GCC is not available. Please install GCC to use this feature.'],
        success: false
      };
    }

    try {
      // Step 1: GCC 预处理（异步，不阻塞主线程）
      const preprocessResult = await this.preprocessor.preprocess(filePath);

      // 只有当完全没有输出内容时才判定为失败
      if (!preprocessResult.success || !preprocessResult.content.trim()) {
        return {
          structs: [],
          unions: [],
          errors: preprocessResult.errors,
          success: false
        };
      }

      // Step 2: 解析结构体（拓扑排序中已包含循环检测）
      const parseResult = this.parser.parseContent(preprocessResult.content);

      // 将预处理阶段的警告/错误信息传递给最终结果
      if (preprocessResult.errors.length > 0) {
        parseResult.errors.unshift(
          'GCC preprocessing warnings:',
          ...preprocessResult.errors.map(e => `  - ${e}`)
        );
      }

      // 缓存结果
      try {
        const stat = fs.statSync(filePath);
        this.cache.set(filePath, { mtime: stat.mtimeMs, result: parseResult });
      } catch {
        // ignore
      }

      return parseResult;
    } catch (error) {
      errors.push(`Error parsing file: ${error instanceof Error ? error.message : String(error)}`);
      return {
        structs: [],
        unions: [],
        errors,
        success: false
      };
    }
  }

  /**
   * 解析字符串内容(用于测试或临时内容)
   */
  parseContent(content: string): ParseResult {
    // 直接使用解析器(跳过预处理)，拓扑排序中已包含循环检测
    return this.parser.parseContent(content);
  }

  /**
   * 解析文件夹中的所有预处理后的头文件
   * AntlrStructParser 内部会自动处理类型收集、拓扑排序和 offset/bits 计算
   */
  async parseDirectory(dirPath: string): Promise<ParseResult> {
    const errors: string[] = [];

    if (!fs.existsSync(dirPath)) {
      return {
        structs: [],
        unions: [],
        errors: [`Directory not found: ${dirPath}`],
        success: false
      };
    }

    try {
      // 拓扑排序中已包含循环检测
      const result = this.parser.parse(dirPath);
      return result;
    } catch (error) {
      errors.push(`Error parsing directory: ${error instanceof Error ? error.message : String(error)}`);
      return {
        structs: [],
        unions: [],
        errors,
        success: false
      };
    }
  }

  /**
   * 批量解析多个头文件并合并结果
   * 使用并行预处理，控制并发数避免资源耗尽
   */
  async parseFiles(filePaths: string[]): Promise<ParseResult> {
    const allErrors: string[] = [];
    let combinedContent = '';

    // 过滤存在的文件
    const validPaths: string[] = [];
    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) {
        allErrors.push(`File not found: ${filePath}`);
      } else {
        validPaths.push(filePath);
      }
    }

    // 并行预处理（控制并发数）
    const CONCURRENCY = 4;
    const preprocessResults = await this.batchPreprocess(validPaths, CONCURRENCY);

    for (let i = 0; i < validPaths.length; i++) {
      const filePath = validPaths[i];
      const preprocessResult = preprocessResults[i];

      // 只要有输出内容就合并，同时收集错误/警告
      if (preprocessResult.content.trim()) {
        combinedContent += '\n' + preprocessResult.content;
      }

      if (preprocessResult.errors.length > 0) {
        allErrors.push(
          `${filePath}: GCC preprocessing warnings:`,
          ...preprocessResult.errors.map(e => `  - ${e}`)
        );
      }
    }

    if (combinedContent) {
      // 拓扑排序中已包含循环检测
      const result = this.parser.parseContent(combinedContent);
      allErrors.push(...result.errors);

      return {
        structs: result.structs,
        unions: result.unions,
        errors: allErrors,
        success: allErrors.length === 0
      };
    }

    return {
      structs: [],
      unions: [],
      errors: allErrors,
      success: false
    };
  }

  /**
   * 并行预处理文件（控制并发数）
   */
  private async batchPreprocess(filePaths: string[], concurrency: number): Promise<PreprocessResult[]> {
    const results: PreprocessResult[] = new Array(filePaths.length);
    let idx = 0;

    const worker = async () => {
      while (idx < filePaths.length) {
        const i = idx++;
        try {
          results[i] = await this.preprocessor.preprocess(filePaths[i]);
        } catch (error) {
          results[i] = {
            content: '',
            errors: [error instanceof Error ? error.message : String(error)],
            success: false
          };
        }
      }
    };

    // 启动 concurrency 个并发 worker
    const workers = Array.from({ length: Math.min(concurrency, filePaths.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
  
  /**
   * 扫描目录中的所有头文件
   */
  scanHeaderFiles(directory: string, recursive: boolean = true): string[] {
    const headerFiles: string[] = [];

    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) {
        return;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && recursive) {
          // 跳过隐藏目录和 node_modules
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            scanDir(fullPath);
          }
        } else if (entry.isFile()) {
          // 检查是否是头文件
          if (entry.name.endsWith('.h') || entry.name.endsWith('.hpp')) {
            headerFiles.push(fullPath);
          }
        }
      }
    };

    scanDir(directory);
    return headerFiles;
  }

  /**
   * 从 command.txt 解析：提取预处理命令 → 扫描头文件 → 解析 → 保存 JSON
   * @param commandTxtPath command.txt 文件路径
   * @param outputPath 输出 JSON 文件路径
   * @returns 解析结果（同时已保存到 outputPath）
   */
  async parseFromCommandTxt(commandTxtPath: string, outputPath: string): Promise<ParseResult> {
    const errors: string[] = [];

    // Step 1: 检查文件存在性
    if (!fs.existsSync(commandTxtPath)) {
      const err = `Command file not found: ${commandTxtPath}`;
      const result: ParseResult = { structs: [], unions: [], errors: [err], success: false };
      fs.writeFileSync(outputPath, this.generateJson(result), 'utf-8');
      return result;
    }

    try {
      // Step 2: 加载编译配置（提取 -preproc 中的 gcc 命令、-I 目录、-D 宏、-macros 文件）
      this.loadCompileConfig(commandTxtPath);
      const config = this.getPreprocessorConfig();

      if (config.includeDirs.length === 0) {
        const err = 'No include directories found in command.txt';
        const result: ParseResult = { structs: [], unions: [], errors: [err], success: false };
        fs.writeFileSync(outputPath, this.generateJson(result), 'utf-8');
        return result;
      }

      // Step 3: 扫描所有 includeDirs 下的头文件（不包括子目录）
      const headerFiles: string[] = [];
      for (const dir of config.includeDirs) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          errors.push(`Include directory not found: ${dir}`);
          continue;
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.h') || entry.name.endsWith('.hpp'))) {
            headerFiles.push(path.join(dir, entry.name));
          }
        }
      }

      if (headerFiles.length === 0) {
        errors.push('No header files (.h/.hpp) found in include directories');
        const result: ParseResult = { structs: [], unions: [], errors, success: false };
        fs.writeFileSync(outputPath, this.generateJson(result), 'utf-8');
        return result;
      }

      // Step 4: 解析头文件（并行预处理 + 合并解析）
      const result = await this.parseFiles(headerFiles);

      // 追加扫描阶段的错误
      if (errors.length > 0) {
        result.errors.unshift(...errors);
        result.success = result.success && errors.length === 0;
      }

      // Step 5: 生成 JSON 并保存
      const json = this.generateJson(result);
      fs.writeFileSync(outputPath, json, 'utf-8');

      return result;
    } catch (error) {
      const errMsg = `Error parsing from command.txt: ${error instanceof Error ? error.message : String(error)}`;
      const result: ParseResult = { structs: [], unions: [], errors: [errMsg], success: false };
      fs.writeFileSync(outputPath, this.generateJson(result), 'utf-8');
      return result;
    }
  }

  /**
   * 扁平化既没名称又没类型的匿名 struct/union：将其字段提取到同一层级（in-place）
   */
  private flattenAnonymous(result: ParseResult): void {
    for (const s of result.structs) {
      s.fields = this.flattenFields(s.fields);
    }
    for (const u of result.unions) {
      u.fields = this.flattenFields(u.fields);
    }
  }

  private flattenFields(fields: Field[]): Field[] {
    const result: Field[] = [];
    for (const field of fields) {
      // 既没名称(type为struct/union, name为空)又没类型的匿名嵌套
      if (field.name === '' && (field.type === 'struct' || field.type === 'union') && (field.nestedStruct || field.nestedUnion)) {
        const nested = field.nestedStruct || field.nestedUnion;
        if (nested) {
          // 递归扁平化嵌套字段
          const flatNested = this.flattenFields(nested.fields);
          for (const nf of flatNested) {
            result.push({
              ...nf,
              offset: nf.offset + field.offset
            });
          }
        }
      } else {
        // 非匿名：递归处理其内部嵌套
        const cloned: Field = { ...field };
        if (field.nestedStruct) {
          cloned.nestedStruct = { ...field.nestedStruct, fields: this.flattenFields(field.nestedStruct.fields) };
        }
        if (field.nestedUnion) {
          cloned.nestedUnion = { ...field.nestedUnion, fields: this.flattenFields(field.nestedUnion.fields) };
        }
        result.push(cloned);
      }
    }
    return result;
  }

  /**
   * 生成 JSON 输出
   */
  generateJson(result: ParseResult): string {
    // 添加一个函数扁平化既没名称有没类型的struct/union
    this.flattenAnonymous(result);

    const lines: string[] = ['{'];
    const meta = {
      totalStructs: result.structs.length,
      totalUnions: result.unions.length,
      totalErrors: result.errors.length,
      success: result.success,
      timestamp: new Date().toISOString()
    };

    // structs
    lines.push('  "structs": [');
    result.structs.forEach((s, i) => {
      this.formatTypeDef(lines, s, '    ', i < result.structs.length - 1);
    });
    lines.push('  ],');

    // unions
    lines.push('  "unions": [');
    result.unions.forEach((u, i) => {
      this.formatTypeDef(lines, u, '    ', i < result.unions.length - 1);
    });
    lines.push('  ],');

    // errors
    if (result.errors.length === 0) {
      lines.push('  "errors": [],');
    } else {
      const errStr = result.errors.map(e => JSON.stringify(e)).join(', ');
      lines.push(`  "errors": [ ${errStr} ],`);
    }

    // metadata (simple object, one line)
    const metaPairs = Object.entries(meta).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    lines.push(`  "metadata": { ${metaPairs.join(', ')} }`);

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * 格式化 struct/union 定义块
   */
  private formatTypeDef(lines: string[], def: Struct | Union, indent: string, hasComma: boolean): void {
    const props = `"name": ${JSON.stringify(def.name)}, "type": ${JSON.stringify(def.name)}, "bits": ${def.bits}, "offset": ${def.offset}, "anonymous": ${def.anonymous}`;
    lines.push(`${indent}{ ${props},`);
    lines.push(`${indent}  "fields": [`);
    def.fields.forEach((f, i) => {
      this.formatField(lines, f, indent + '    ', i < def.fields.length - 1);
    });
    lines.push(`${indent}  ]`);
    lines.push(`${indent}}${hasComma ? ',' : ''}`);
  }

  /**
   * 格式化字段：简单字段单行，复杂字段（含嵌套 fields）多行
   */
  private formatField(lines: string[], field: Field, indent: string, hasComma: boolean): void {
    const comma = hasComma ? ',' : '';
    const nested = field.nestedStruct || field.nestedUnion;
    const props = `"name": ${JSON.stringify(field.name)}, "type": ${JSON.stringify(field.type)}, "bits": ${field.bits}, "offset": ${field.offset}`;

    if (!nested) {
      // 简单字段：单行
      lines.push(`${indent}{ ${props} }${comma}`);
      return;
    }

    // 复杂字段：属性单行 + fields 多行展开
    lines.push(`${indent}{ ${props},`);
    lines.push(`${indent}  "fields": [`);
    nested.fields.forEach((f: Field, i: number) => {
      this.formatField(lines, f, indent + '    ', i < nested.fields.length - 1);
    });
    lines.push(`${indent}  ]`);
    lines.push(`${indent}}${comma}`);
  }

  /**
   * 获取预处理器配置
   */
  getPreprocessorConfig() {
    return this.preprocessor.getConfig();
  }
}
