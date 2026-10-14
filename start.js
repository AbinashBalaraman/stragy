import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('./dist/server/server.cjs',import.meta.url));
if(!existsSync(entry)||!existsSync(new URL('./dist/client/index.html',import.meta.url))||!existsSync(new URL('./dist/server/worker.cjs',import.meta.url))){console.error('Build artifacts missing. Run npm run build before startup.');process.exit(1);}
const child=spawn(process.execPath,[entry],{stdio:'inherit',env:{...process.env,NODE_ENV:process.env.NODE_ENV||'production'}});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>child.kill(sig));
child.on('error',()=>process.exit(1));
child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
