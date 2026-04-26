/**
 * Worker Thread - 将解析逻辑隔离到独立线程，不阻塞 Extension Host 主线程
 *
 * 使用方式：
 *   const worker = new Worker('./worker.js', { workerData: { type: 'file', path: '/path/to/file.h' } });
 *   worker.on('message', (result: ParseResult) => { ... });
 */
import { parentPort, workerData } from 'worker_threads';
import { StructParserService } from './service';

interface WorkerRequest {
  type: 'file' | 'files' | 'directory' | 'content';
  path?: string;
  paths?: string[];
  content?: string;
  config?: {
    includeDirs?: string[];
    defines?: Record<string, string | undefined>;
    includes?: string[];
    imacros?: string[];
  };
}

async function run() {
  const request = workerData as WorkerRequest;
  const service = new StructParserService();

  // 应用配置
  if (request.config) {
    const defines = request.config.defines
      ? new Map(Object.entries(request.config.defines))
      : undefined;
    service.setPreprocessorConfig({
      ...request.config,
      defines
    });
  }

  try {
    let result;
    switch (request.type) {
      case 'file':
        result = await service.parseFile(request.path!);
        break;
      case 'files':
        result = await service.parseFiles(request.paths!);
        break;
      case 'directory':
        result = await service.parseDirectory(request.path!);
        break;
      case 'content':
        result = service.parseContent(request.content!);
        break;
      default:
        result = { structs: [], unions: [], errors: [`Unknown request type: ${request.type}`], success: false };
    }
    parentPort?.postMessage(result);
  } catch (error) {
    parentPort?.postMessage({
      structs: [],
      unions: [],
      errors: [error instanceof Error ? error.message : String(error)],
      success: false
    });
  }
}

run();
