import { parseMuseOutput } from './native-protocol.mjs';

// Muse's terminal text can concatenate several model messages. For a model
// adapter, the handoff boundary is one successfully completed Meta response,
// not completion of Muse's outer agent loop. Never use a streaming JSON prefix.
export class MuseDecisionReader {
  constructor(request) { this.request = request; this.root = null; this.text = ''; this.tasks = new Map(); }
  consume(event) {
    const p = event.payload;
    if (this.finished || !p || event.schema_version !== 1 || event.payload_schema_version !== 1) return null;
    if (event.payload_type === 'run.lifecycle.started' && !this.root) { this.root = p.run_stream?.id; return null; }
    if (!this.root || p.run_stream?.id !== this.root) return null;
    if (event.payload_type?.startsWith('run.terminal.')) { this.finished = true; return null; }
    if (event.payload_type === 'run.output.delta' && typeof p.text === 'string') this.text += p.text;
    if (event.payload_type === 'task.lifecycle.proposed' && p.event?.task_kind === 'model.meta.response') this.tasks.set(p.task_id, { rootTask: false, completedResponse: false });
    const task = this.tasks.get(p.task_id);
    if (!task) return null;
    if (event.payload_type === 'task.lifecycle.side_effect_intent' && p.event?.operation === 'model.meta.response' && p.event.parent_task_id === null) task.rootTask = true;
    if (event.payload_type === 'task.lifecycle.status' && p.event?.details?.phase === 'stream_succeeded') {
      task.completedResponse = p.event.details.facets?.some(f => f.kind === 'producer' && f.detail?.kind === 'provider'
        && f.detail.provider === 'meta' && f.detail.model === this.request.model && f.detail.stream?.last_wire_event_type === 'response.completed') === true;
    }
    if (event.payload_type !== 'task.lifecycle.completed' || !task.rootTask || !task.completedResponse) return null;
    const text = this.text.trim();
    // Multiple objects, partial JSON, unoffered tools, or wrong tool choices fail
    // validation. We never select an arbitrary object out of concatenated output.
    try { parseMuseOutput(text, this.request); } catch { return null; }
    return text;
  }
}
