import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface PreprocessResult {
  content: string;
  errors: string[];
  success: boolean;
}

export interface CompileConfig {
  includeDirs: string[];
  defines: Map<string, string | undefined>;
  includes: string[];
  imacros: string[];
}

/**
 * GCC 预处理器 - 调用系统 GCC 进行预处理
 */
export class GccPreprocessor {
  private config: CompileConfig = {
    includeDirs: [],
    defines: new Map(),
    includes: [],
    imacros: []
  };

  /**
   * 检查 GCC 是否可用
   */
  static isGccAvailable(): boolean {
    try {
      const result = cp.execSync('gcc --version', { encoding: 'utf-8' });
      return result.includes('gcc') || result.includes('clang');
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取 GCC 版本信息
   */
  static getGccVersion(): string {
    try {
      const result = cp.execSync('gcc --version', { encoding: 'utf-8' });
      return result.split('\n')[0];
    } catch (error) {
      return 'GCC not available';
    }
  }

  /**
   * 从编译配置文件加载配置
   * 支持两种格式:
   * 1. 纯 gcc 命令: gcc -E -P -I./include -DFEATURE_A
   * 2. command.txt 格式: xxx -preproc "gcc -E -x c -macros file.txt -I dir1 dir2 ..."
   */
  loadCompileConfig(configFile: string): void {
    if (!fs.existsSync(configFile)) {
      throw new Error(`Config file not found: ${configFile}`);
    }

    const content = fs.readFileSync(configFile, 'utf-8').trim();
    const baseDir = path.dirname(configFile);

    // 尝试提取 -preproc "..." 中的 gcc 命令
    const preprocMatch = content.match(/-preproc\s+"([^"]+)"/);
    if (preprocMatch) {
      this.parseGccCommand(preprocMatch[1], baseDir);
    } else {
      // 直接当作 gcc 命令解析
      this.parseGccCommand(content, baseDir);
    }
  }

  /**
   * 解析 GCC 命令
   * @param command gcc 命令字符串
   * @param baseDir 用于将相对路径转为绝对路径的基准目录
   */
  private parseGccCommand(command: string, baseDir: string = process.cwd()): void {
    // 重置配置
    this.config = {
      includeDirs: [],
      defines: new Map(),
      includes: [],
      imacros: []
    };

    const args = this.tokenizeCommand(command);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '-I' || arg.startsWith('-I')) {
        // 包含目录: -Idir 或 -I dir（支持连续多个目录）
        let dir: string | undefined;
        if (arg.length > 2) {
          dir = arg.substring(2);
        } else if (i + 1 < args.length) {
          dir = args[++i];
        }
        if (dir) {
          // 可能 -I 后面跟多个目录（非标准 gcc 但在用户场景中常见）
          this.addIncludeDir(this.resolvePath(dir, baseDir));
          // 继续读取后续非选项参数作为目录
          while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
            this.addIncludeDir(this.resolvePath(args[++i], baseDir));
          }
        }
      } else if (arg.startsWith('-D')) {
        // 宏定义: -DNAME 或 -DNAME=value
        const define = arg.length > 2 ? arg.substring(2) : args[++i];
        if (define) {
          const eqIndex = define.indexOf('=');
          if (eqIndex >= 0) {
            this.config.defines.set(define.substring(0, eqIndex), define.substring(eqIndex + 1));
          } else {
            this.config.defines.set(define, undefined);
          }
        }
      } else if (arg === '-include' && i + 1 < args.length) {
        // 强制包含文件
        this.config.includes.push(this.resolvePath(args[++i], baseDir));
      } else if ((arg === '-imacros' || arg === '-macros') && i + 1 < args.length) {
        // 宏定义文件（-macros 是用户自定义别名，实际对应 gcc -imacros）
        const macrosFile = this.resolvePath(args[++i], baseDir);
        this.config.imacros.push(macrosFile);
        // 同时读取文件中的宏定义并合并到 defines
        this.loadMacrosFromFile(macrosFile);
      }
    }
  }

  /**
   * 将相对路径转为绝对路径
   */
  private resolvePath(p: string, baseDir: string): string {
    if (path.isAbsolute(p)) {
      return p;
    }
    return path.resolve(baseDir, p);
  }

  /**
   * 添加包含目录（去重）
   */
  private addIncludeDir(dir: string): void {
    if (!this.config.includeDirs.includes(dir)) {
      this.config.includeDirs.push(dir);
    }
  }

  /**
   * 从宏定义文件加载宏（支持 #define NAME value 和 NAME=value 格式）
   */
  private loadMacrosFromFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        // 格式1: #define NAME value
        const defineMatch = trimmed.match(/^#define\s+(\w+)\s*(.*)$/);
        if (defineMatch) {
          const name = defineMatch[1];
          const value = defineMatch[2].trim();
          this.config.defines.set(name, value || undefined);
          continue;
        }

        // 格式2: NAME=value
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const name = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          if (/^[A-Za-z_]\w*$/.test(name)) {
            this.config.defines.set(name, value || undefined);
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  /**
   * 将命令字符串分割为参数数组
   */
  private tokenizeCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  /**
   * 预处理单个头文件（异步，不阻塞主线程）
   */
  async preprocess(filePath: string): Promise<PreprocessResult> {
    if (!GccPreprocessor.isGccAvailable()) {
      return {
        content: '',
        errors: ['GCC is not available'],
        success: false
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        content: '',
        errors: [`File not found: ${filePath}`],
        success: false
      };
    }

    try {
      // 构建 GCC 命令
      const args = this.buildGccArgs(filePath);

      // 异步执行 GCC 预处理（不阻塞事件循环）
      const result = await this.spawnGccAsync(args);

      if (result.error) {
        return {
          content: '',
          errors: [result.error],
          success: false
        };
      }

      // 收集 stderr 中的错误/警告信息
      const stderrErrors = result.stderr
        ? result.stderr.split('\n').filter(line => line.trim())
        : [];

      if (result.exitCode !== 0) {
        // GCC 返回错误，但 stdout 可能仍有部分预处理内容
        // 采用"尽力而为"策略：只要有输出内容，就返回内容并附带错误信息
        if (result.stdout && result.stdout.trim().length > 0) {
          return {
            content: result.stdout,
            errors: stderrErrors.length > 0 ? stderrErrors : ['GCC preprocessing completed with warnings'],
            success: true
          };
        }

        // stdout 为空，才是真正的失败
        return {
          content: '',
          errors: stderrErrors.length > 0 ? stderrErrors : ['GCC preprocessing failed'],
          success: false
        };
      }

      // GCC 完全成功，但 stderr 可能有警告
      return {
        content: result.stdout,
        errors: stderrErrors,
        success: true
      };
    } catch (error) {
      return {
        content: '',
        errors: [error instanceof Error ? error.message : String(error)],
        success: false
      };
    }
  }

  /**
   * 异步执行 GCC 子进程（非阻塞）
   */
  private spawnGccAsync(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    return new Promise((resolve) => {
      const child = cp.spawn('gcc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let killed = false;

      // 设置超时
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, 30000);

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          resolve({ stdout, stderr, exitCode: 1, error: 'GCC preprocessing timed out (30s)' });
        } else {
          resolve({ stdout, stderr, exitCode: code });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: 1, error: err.message });
      });
    });
  }

  /**
   * 构建 GCC 命令行参数
   */
  private buildGccArgs(filePath: string): string[] {
    const args: string[] = [
      '-E',  // 只预处理
      '-P',  // 不生成 #line 指令
      '-x', 'c',  // 指定语言为 C
      filePath
    ];

    // 添加包含目录
    for (const dir of this.config.includeDirs) {
      args.push('-I', dir);
    }

    // 添加宏定义
    for (const [name, value] of this.config.defines) {
      if (value !== undefined) {
        args.push('-D', `${name}=${value}`);
      } else {
        args.push('-D', name);
      }
    }

    // 添加强制包含文件
    for (const file of this.config.includes) {
      args.push('-include', file);
    }

    // 添加宏定义文件
    for (const file of this.config.imacros) {
      args.push('-imacros', file);
    }

    return args;
  }

  /**
   * 直接预处理字符串内容(通过临时文件)
   */
  async preprocessContent(content: string, workingDir?: string): Promise<PreprocessResult> {
    const tempDir = workingDir || process.cwd();
    const tempFile = path.join(tempDir, `.temp_${Date.now()}.h`);

    try {
      // 写入临时文件
      fs.writeFileSync(tempFile, content, 'utf-8');

      // 预处理
      const result = await this.preprocess(tempFile);

      return result;
    } finally {
      // 清理临时文件
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        // 忽略清理错误
      }
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): CompileConfig {
    return { ...this.config };
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<CompileConfig>): void {
    if (config.includeDirs) {
      this.config.includeDirs = config.includeDirs;
    }
    if (config.defines) {
      this.config.defines = new Map(config.defines);
    }
    if (config.includes) {
      this.config.includes = config.includes;
    }
    if (config.imacros) {
      this.config.imacros = config.imacros;
    }
  }
}
