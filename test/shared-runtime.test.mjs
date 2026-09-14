import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedRuntime } from '../src/shared-runtime.mjs';

test('Remote and all tasks retain one native process; only the finished discovery probe disables Remote', async t => {
  const root = await mkdtemp(join(tmpdir(), 'muse-shared-process-')), executable = join(root, 'native'), calls = join(root, 'calls.jsonl');
  await writeFile(executable, `#!${process.execPath}
const {createInterface}=require('node:readline');const {appendFileSync}=require('node:fs');
const record=data=>appendFileSync(process.env.MUSE_FIXTURE_CALLS,JSON.stringify({pid:process.pid,disabled:process.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED,...data})+'\\n');
record({event:'start'});process.on('exit',()=>record({event:'exit'}));
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;record({method:m.method});let result={};
if(m.method==='account/read')result={account:{type:'chatgpt'}};
if(m.method==='config/read')result={config:{model:'fixture'},origins:{}};
if(m.method==='remoteControl/enable'||m.method==='remoteControl/status/read')result={status:process.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED==='1'?'disabled':'connected'};
if(m.method==='thread/start')result={thread:{id:'fixture-'+m.id,model:m.params.model}};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');});
`, { mode: 0o700 });
  let runtime, seq = 0; const replies = new Map();
  t.after(async () => { await runtime?.stop(); await rm(root, { recursive: true, force: true }); });
  runtime = await createSharedRuntime({ executable, stateRoot: join(root, 'bridge'), env: { ...process.env, MUSE_FIXTURE_CALLS: calls, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '0' },
    discover: async () => [{ modelId: 'fixture' }], connection: { mode: 'account' },
    emit: message => { replies.get(message.id)?.(message); replies.delete(message.id); },
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; replies.set(id, response => response.error ? reject(new Error(response.error.message)) : resolve(response.result)); void runtime.receive({ id, method, params });
  });
  await request('initialize', { clientInfo: { name: 'fixture', version: '1' } });
  await runtime.receive({ method: 'initialized', params: {} });
  for (const model of ['fixture', 'muse/fixture', 'fixture']) await request('thread/start', { model });
  assert.equal((await request('remoteControl/enable')).status, 'connected');
  assert.equal((await runtime.peer.request('remoteControl/status/read', {})).status, 'connected');
  await runtime.stop();
  const log = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const starts = log.filter(row => row.event === 'start'); assert.equal(starts.length, 2);
  const [probe, main] = starts;
  assert.equal(probe.disabled, '1'); assert.equal(main.disabled, '0');
  assert.ok(log.findIndex(row => row.pid === probe.pid && row.event === 'exit') < log.findIndex(row => row.pid === main.pid && row.event === 'start'));
  assert.ok(log.filter(row => row.method?.startsWith('thread/') || row.method?.startsWith('remoteControl/')).every(row => row.pid === main.pid));
});
