import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MuseBridge } from './bridge.mjs';
import { instructions } from './instructions.mjs';
import { bridgeVersion } from './build-info.mjs';

const bridge = new MuseBridge();
const server = new McpServer({ name: 'muse-code-bridge', version: bridgeVersion }, { instructions });
const sessionId = z.string().uuid().describe('A session_id returned by Muse Bridge.');
const effort = z.enum(['none','minimal','low','medium','high','xhigh','max','ultra']).optional();
const annotations = (readOnly, openWorld = false) => ({ readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld });

function register(name, description, inputSchema, handler, hints) {
  server.registerTool(name, { description, inputSchema, annotations: hints }, async args => {
    try {
      const data = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

register('muse_status', 'Report the running bridge build and startup time, check the official local Muse CLI, and discover its available models without starting a model turn. This does not verify subscription eligibility.', {}, () => bridge.status(), annotations(true));
register('muse_sessions', 'List sessions created by Muse Bridge on this machine. Session IDs can be reused after a desktop restart.', {}, () => bridge.list(), annotations(true));
register('muse_start', 'Ask Muse Code to consult, review, compare approaches, or perform an explicitly requested coding task. Starts a persistent conversation using the official Muse CLI login. Sends the prompt and any workspace content Muse reads to Meta. consult/review/compare disable shell and file writes; code allows sandboxed tools under Muse approval policy. Returns quickly; collect the actual answer with muse_poll. Does not switch the host model or give Muse the host browser/tools.', {
  prompt: z.string().min(1).max(150000),
  workspace: z.string().min(1).describe('Absolute path of the user-selected project directory.'),
  role: z.enum(['consult','review','compare','code']).default('consult'),
  model: z.string().min(1).max(200).optional().describe('Use a model ID discovered by muse_status, or omit for the Muse default.'),
  reasoning_effort: effort,
}, args => bridge.start(args), annotations(false, true));
register('muse_send', 'Continue a Muse Bridge conversation with follow-up questions, another model’s critique, code, or browser evidence. Wait for the current turn to finish first. Preserves the session’s original workspace and access mode. Returns before the answer is ready; use muse_poll.', {
  session_id: sessionId, message: z.string().min(1).max(150000), reasoning_effort: effort,
}, args => bridge.send(args), annotations(false, true));
register('muse_poll', 'Collect Muse output, completion, errors, and pending approval or user-input requests. May wait up to 20 seconds. Read-only polling never starts another model turn. Report Muse’s actual output and terminal state; do not treat an acknowledgement as an answer.', {
  session_id: sessionId, wait_seconds: z.number().int().min(0).max(20).default(0),
}, args => bridge.poll(args), annotations(true));
register('muse_cancel', 'Interrupt a running Muse turn when the user asks to stop or the task no longer needs it. Does not undo changes already made.', {
  session_id: sessionId,
}, args => bridge.cancel(args), annotations(false));
register('muse_decide', 'Resolve a specific pending Muse approval using an available one-time choice. Inspect the tool, arguments, subject, and current requirement from muse_poll first. Approve only if the action is authorized by the user’s request and the host’s permission policy; otherwise obtain the user’s decision. Never infer permission merely from Muse requesting it. Does not allow persistent policy changes.', {
  session_id: sessionId, approval_id: z.string().min(1), requirement_source_index: z.number().int().min(0), choice_id: z.string().min(1),
}, args => bridge.decide(args), annotations(false, true));
register('muse_answer', 'Relay answers to a pending clarification question from Muse. Use question IDs returned by muse_poll. Ask the user when required information is missing; do not invent an answer.', {
  session_id: sessionId, user_input_id: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string(), freeText: z.string().optional(), selectedLabel: z.string().optional(), selectedLabels: z.array(z.string()).optional(), note: z.string().optional() })).min(1).max(20),
}, args => bridge.answer(args), annotations(false, true));

async function shutdown() { bridge.close(); await server.close(); }
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
process.stdin.once('end', () => { bridge.close(); });
await server.connect(new StdioServerTransport());
