import { existsSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('./dist/server/server.cjs',import.meta.url));
if(!existsSync(entry)||!existsSync(new URL('./dist/client/index.html',import.meta.url))||!existsSync(new URL('./dist/server/worker.cjs',import.meta.url))){console.error('Build artifacts missing. Run npm run build before startup.');process.exit(1);}
const startedAt=Date.now();
const exitLog=process.env.SERVER_EXIT_LOG??'/tmp/opencode/stragy-server-exit.log';
function record(event,detail){
  const line=JSON.stringify({event,at:new Date().toISOString(),pid:process.pid,uptimeMs:Date.now()-startedAt,...detail});
  console.error(line);
  try{appendFileSync(exitLog,line+'\n');}catch{/* best effort */}
}
const child=spawn(process.execPath,[entry],{stdio:'inherit',env:{...process.env,NODE_ENV:process.env.NODE_ENV||'production'}});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{record('launcher_signal',{signal:sig});child.kill(sig);});
child.on('error',error=>{record('child_spawn_error',{message:error.message});process.exit(1);});
child.on('exit',(code,signal)=>{record('child_exit',{code,signal});process.exit(code??(signal?1:0));});
