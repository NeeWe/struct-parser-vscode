/**
 * Struct Parser - TypeScript 实现 (基于 ANTLR4)
 * 
 * C-style struct/union parser with GCC preprocessing
 * 用于 VSCode 插件的核心解析功能
 */

export { GccPreprocessor } from './preprocessor';
export { AntlrStructParser } from './antlr_parser';
export { StructParserService } from './service';
export { 
  Field, 
  Struct, 
  Union, 
  ParseResult,
  TYPE_SIZES,
  getTypeBits 
} from './models';

// 导出类型
export type { CompileConfig, PreprocessResult } from './preprocessor';

// Worker 文件路径（供外部使用 Worker Thread 隔离时引用）
export const WORKER_PATH = require.resolve('./worker');
