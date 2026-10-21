import 'dotenv/config';
import { parseConfig } from './src/server/config';

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
  process.on('SIGTERM', () => { void stop(); }); process.on('SIGINT', () => { void stop(); });
  server.on('error', () => { console.error('Server could not start. Check host/port/configuration.'); process.exitCode = 1; void jobs.shutdown(); });
}
main().catch(() => { console.error('Startup failed. Check validated configuration, storage, and build artifacts. No provider login was attempted.'); process.exitCode = 1; });
