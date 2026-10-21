// Real worker-thread probes with tsc-emitted code, not a production bundle or Vitest.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
const { JobManager } = require(path.join(root, '.verify-cjs/src/server/jobs/manager.js'));
const { strategy, bars } = require(path.join(root, '.verify-cjs/src/test/fixtures/research.js'));
const { parseBacktestResult } = require(path.join(root, '.verify-cjs/src/shared/contracts/research.js'));
process.env.DATA_MODE = 'demo';
process.env.AI_PROVIDER = 'none';
const managers = [], rows = [];
let folder;
const input = () => ({ strategy:strategy(), bars:bars([[100,101,99,100],[110,112,109,111],[120,121,119,120]]), options:{initialCapital:10000,robustness:false} });
async function terminal(manager,id) {
  const deadline=Date.now()+7000;
  while(Date.now()<deadline) {
    const current=manager.get(id);
    if(current&&!['queued','running'].includes(current.status))return current;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Worker did not reach terminal state within the smoke budget');
}
async function check(name,body) {
  try { await body();rows.push({name,status:'passed'}); }
  catch(error) { rows.push({name,status:'failed',error:String(error.message)}); }
}
(async()=>{
  await check('real worker computes and validates Q01',async()=>{
    const manager=new JobManager({workerPath:path.join(root,'.verify-cjs/src/server/jobs/worker.js'),maxMs:5000,workers:1});managers.push(manager);
    const job=manager.enqueue(input()),done=await terminal(manager,job.id);
    assert.equal(done.status,'succeeded',JSON.stringify(done.error));
    const result=parseBacktestResult(done.result);
    assert.equal(result.metrics.finalEquity,10100);assert.equal(result.trades[0].entryPrice,110);assert.equal(result.trades[0].exitPrice,120);
    await manager.shutdown();
  });
  const base=path.join(root,'src/test/.tmp');fs.mkdirSync(base,{recursive:true});folder=fs.mkdtempSync(path.join(base,'worker-probe-'));
  await check('clean worker exit without result fails before deadline',async()=>{
    const file=path.join(folder,'empty-exit.cjs');fs.writeFileSync(file,'process.exit(0);');
    const manager=new JobManager({workerPath:file,maxMs:5000,workers:1});managers.push(manager);
    const job=manager.enqueue(input()),done=await terminal(manager,job.id);
    assert.equal(done.status,'failed');assert.equal(done.error.code,'WORKER_EXITED');await manager.shutdown();
  });
  await check('empty result message fails closed',async()=>{
    const file=path.join(folder,'empty-result.cjs');fs.writeFileSync(file,"require('node:worker_threads').parentPort.postMessage({type:'result'});");
    const manager=new JobManager({workerPath:file,maxMs:5000,workers:1});managers.push(manager);
    const job=manager.enqueue(input()),done=await terminal(manager,job.id);
    assert.equal(done.status,'failed');assert.equal(done.error.code,'WORKER_EMPTY_RESULT');await manager.shutdown();
  });
})().catch(error=>rows.push({name:'probe infrastructure',status:'failed',error:String(error.message)})).finally(async()=>{
  await Promise.all(managers.map(manager=>manager.shutdown()));
  if(folder)fs.rmSync(folder,{recursive:true,force:true});
  const report={runner:'Real Node workers, TypeScript emission; not production bundle',passed:rows.filter(row=>row.status==='passed').length,failed:rows.filter(row=>row.status==='failed').length,tests:rows};
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
});
