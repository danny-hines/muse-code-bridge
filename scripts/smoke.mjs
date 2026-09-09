import { MuseBridge } from '../src/bridge.mjs';
const bridge = new MuseBridge();
try {
  console.log(JSON.stringify(await bridge.status(), null, 2));
  if (process.argv.includes('--live')) {
    const started = await bridge.start({ workspace: process.cwd(), role: 'consult', reasoning_effort: 'low', prompt: 'This is a connection smoke test. Do not use tools. Remember the word apricot and reply exactly MUSE_BRIDGE_OK.' });
    console.log(JSON.stringify(started));
    let result;
    do { result = await bridge.poll({ session_id: started.session_id, wait_seconds: 20 }); console.log(JSON.stringify(result)); } while (result.status === 'running');
    if (result.status !== 'completed') throw new Error(`Live smoke test ended with ${result.status}`);
    await bridge.send({ session_id: started.session_id, message: 'What word did I ask you to remember? Reply only with that word; do not use tools.', reasoning_effort: 'low' });
    do { result = await bridge.poll({ session_id: started.session_id, wait_seconds: 20 }); console.log(JSON.stringify(result)); } while (result.status === 'running');
    if (result.status !== 'completed' || !result.items.some(i => i.kind === 'agentMessage' && /apricot/i.test(i.text))) throw new Error('Session continuity check failed.');
  }
} finally { bridge.close(); }
