import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMuse } from '../src/native-runner.mjs';

test('native runner validates terminal completion, removes temporary prompts, and kills cancelled processes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-runner-test-'));
  const executable = join(dir, 'muse'); const record = join(dir, 'record');
  const request = { model: 'test', effort: 'low', input: [], tools: [] };
  const write = async body => writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,args}));\n${body}\n`, { mode: 0o700 });
  try {
    await write(`console.log(JSON.stringify({payload_type:'run.terminal.completed',payload:{terminal:'completed',text:'{"kind":"message","text":"ok"}'}}));`);
    assert.match(await runMuse(request, { executable, connection: { mode: 'account' } }), /ok/);
    let saved = JSON.parse(await readFile(record));
    assert.ok(saved.args.includes('--disable-shell')); assert.ok(saved.args.includes('--disable-write')); assert.ok(saved.args.includes('--disable-web-tools'));
    const workspace = saved.args[saved.args.indexOf('--workspace') + 1];
    await assert.rejects(access(workspace));
    await write(`console.log(JSON.stringify({payload_type:'run.terminal.failed',payload:{terminal:'failed',text:'partial'}}));`);
    await assert.rejects(runMuse(request, { executable, connection: { mode: 'account' } }), /did not complete/);
    await write(`setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const run = runMuse(request, { executable, connection: { mode: 'account' }, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(run, /cancelled/);
    saved = JSON.parse(await readFile(record));
    assert.throws(() => process.kill(saved.pid, 0));
    await assert.rejects(access(saved.args[saved.args.indexOf('--workspace') + 1]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
