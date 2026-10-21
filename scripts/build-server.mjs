// Portable private-server build. TypeScript emits Node modules without a native
// compiler service or public server artifacts. Runtime dependencies stay external.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'dist/server');
const stage = path.join(root, 'dist/.server-stage');
fs.rmSync(stage, {recursive:true,force:true});
const options = { rootDir:root, outDir:path.join(stage,'runtime'), module:ts.ModuleKind.CommonJS, moduleResolution:ts.ModuleResolutionKind.Node10, target:ts.ScriptTarget.ES2022, esModuleInterop:true, skipLibCheck:true, strictNullChecks:true, noEmitOnError:true, sourceMap:false, declaration:false, types:['node'] };
const program = ts.createProgram([path.join(root,'server.ts'),path.join(root,'src/server/jobs/worker.ts')],options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if(diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
  fs.rmSync(stage,{recursive:true,force:true});process.exitCode=1;
} else {
  const emitted=program.emit();
  if(emitted.emitSkipped)throw new Error('Private server emission failed');
  fs.writeFileSync(path.join(stage,'runtime/package.json'),'{"type":"commonjs"}\n');
  fs.writeFileSync(path.join(stage,'server.cjs'),"'use strict';\nrequire('./runtime/server.js');\n");
  fs.writeFileSync(path.join(stage,'worker.cjs'),"'use strict';\nrequire('./runtime/src/server/jobs/worker.js');\n");
  for(const file of ['runtime/server.js','runtime/src/server/jobs/worker.js'])if(!fs.existsSync(path.join(stage,file)))throw new Error('Missing private build entry '+file);
  fs.rmSync(target,{recursive:true,force:true});fs.renameSync(stage,target);
  console.log('Built private server and worker modules under dist/server. No server files are public.');
}
