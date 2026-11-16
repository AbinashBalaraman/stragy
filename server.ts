import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { parseConfig } from './src/server/config';

const EXIT_LOG = process.env.SERVER_EXIT_LOG ?? '/tmp/opencode/stragy-server-exit.log';

function scrub(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .slice(0, 4000);
}

function logLifecycle(event: string, detail?: unknown): void {
  const line = JSON.stringify({
    event,
    at: new Date().toISOString(),
    pid: process.pid,
    detail: detail instanceof Error ? { name: detail.name, message: scrub(detail.message), stack: scrub(detail.stack ?? '') } : detail === undefined ? undefined : scrub(String(detail)),
  });
  console.error(line);
  try { appendFileSync(EXIT_LOG, line + '\n'); } catch { /* The exit log is best effort. */ }
}

process.on('uncaughtException', error => { logLifecycle('uncaught_exception', error); process.exit(1); });
process.on('unhandledRejection', reason => { logLifecycle('unhandled_rejection', reason); process.exit(1); });

async function main() {
  const config = parseConfig();
  process.env.DATA_MODE = config.DATA_MODE;
  process.env.AI_PROVIDER = config.AI_PROVIDER;
  const [{ createApp }, { JobManager }, { ResearchRepository }] = await Promise.all([
    import('./src/server/app'), import('./src/server/jobs/manager'), import('./src/server/storage/repository'),
  ]);
  const repository = await ResearchRepository.open({ filePath: config.STORAGE_MODE === 'local-file' ? config.STORAGE_PATH : undefined, maxRuns: config.MAX_STORED_RUNS });
  const jobs = new JobManager({ maxQueue: config.MAX_QUEUE, maxMs: config.MAX_JOB_MS, maxRetained: config.MAX_STORED_RUNS });
  const app = await createApp({ config, enableVite: config.NODE_ENV === 'development', jobs, repository });
  const server = app.listen(config.PORT, config.HOST, () => console.log(JSON.stringify({ event: 'server_ready', port: config.PORT, host: config.HOST, dataMode: config.DATA_MODE, persistence: config.STORAGE_MODE, liveTrading: false })));
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5000); deadline.unref();
    await jobs.shutdown();
    server.close(async () => { await repository.close(); clearTimeout(deadline); process.exit(0); });
  };
  process.on('SIGTERM', () => { logLifecycle('sigterm'); void stop(); }); process.on('SIGINT', () => { logLifecycle('sigint'); void stop(); });
  server.on('error', error => { logLifecycle('server_error', error); process.exitCode = 1; void jobs.shutdown(); });
}
main().catch(error => { logLifecycle('startup_failed', error); process.exitCode = 1; });
