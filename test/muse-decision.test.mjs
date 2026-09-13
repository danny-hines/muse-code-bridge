import test from 'node:test';
import assert from 'node:assert/strict';
import { MuseDecisionReader } from '../src/muse-decision.mjs';
const request = { model: 'model-m', toolChoice: 'auto', tools: [{ key: 'probe', name: 'probe', type: 'function' }] };
const event = (type, payload = {}, run = 'root') => ({ schema_version: 1, payload_schema_version: 1, payload_type: type, payload: { run_stream: { id: run }, ...payload } });
const intent = '{"kind":"tool_call","name":"probe","arguments":{}}';
function setup({ parent = null, model = request.model, lastEvent = 'response.completed' } = {}) {
  const reader = new MuseDecisionReader(request);
  reader.consume(event('run.lifecycle.started'));
  reader.consume(event('task.lifecycle.proposed', { task_id: 't', event: { task_kind: 'model.meta.response' } }));
  reader.consume(event('task.lifecycle.side_effect_intent', { task_id: 't', event: { operation: 'model.meta.response', parent_task_id: parent } }));
  const succeeded = () => reader.consume(event('task.lifecycle.status', { task_id: 't', event: { details: { phase: 'stream_succeeded', facets: [{ kind: 'producer', detail: { kind: 'provider', provider: 'meta', model, stream: { last_wire_event_type: lastEvent } } }] } } }));
  const complete = () => reader.consume(event('task.lifecycle.completed', { task_id: 't' }));
  return { reader, succeeded, complete, output: text => reader.consume(event('run.output.delta', { text })) };
}
test('handoff requires a complete validated decision and a confirmed successful model response', () => {
  const s = setup();
  assert.equal(s.output(intent.slice(0, 12)), null); assert.equal(s.complete(), null);
  assert.equal(s.output(intent.slice(12)), null); assert.equal(s.complete(), null);
  assert.equal(s.succeeded(), null); assert.equal(s.complete(), intent);
});
test('partial, concatenated, and unoffered tool decisions never become handoffs', () => {
  for (const output of [intent.slice(0, -1), intent + '{"kind":"message","text":"wait"}', intent.replace('probe', 'unoffered')]) {
    const s = setup(); s.output(output); s.succeeded(); assert.equal(s.complete(), null);
  }
});
test('failed streams, another model, and child tasks cannot authorize a handoff', () => {
  for (const options of [{ lastEvent: 'error' }, { model: 'another-model' }, { parent: 'parent-task' }]) {
    const s = setup(options); s.output(intent); s.succeeded(); assert.equal(s.complete(), null);
  }
  const s = setup(); s.reader.consume(event('run.output.delta', { text: intent }, 'child-run')); s.succeeded(); assert.equal(s.complete(), null);
});
test('a failed or cancelled run cannot later produce a decision', () => {
  for (const terminal of ['failed', 'cancelled', 'incomplete']) {
    const s = setup(); s.output(intent); s.reader.consume(event(`run.terminal.${terminal}`)); s.succeeded(); assert.equal(s.complete(), null);
  }
});
