import { AppError } from './errors.js';

const TEXT_LIMIT = 60000;
const isText = (value) => typeof value === 'string' && value.length <= TEXT_LIMIT;
const isMessage = (message) => ['user', 'assistant'].includes(message?.role) && isText(message.content);

export const readEvalCall = (body) => {
  const { op, task = 'json', system, prompt, messages } = body ?? {};
  if (op === 'json' && isText(system) && isText(prompt) && typeof task === 'string') return { op, task, system, prompt };
  if (op === 'text' && isText(system) && Array.isArray(messages) && messages.length <= 40 && messages.every(isMessage)) return { op, system, messages };
  throw new AppError('invalid_request', 'Send op "json" with system and prompt, or op "text" with system and messages.');
};

export const evalModelCall = async ({ provider, call, signal }) => {
  const metas = [];
  const onMeta = (meta) => metas.push(meta);
  const started = Date.now();
  if (call.op === 'json') {
    const result = await provider.generateJson({ task: call.task, system: call.system, prompt: call.prompt, signal, onMeta });
    return { result, metas, ms: Date.now() - started };
  }
  let text = '';
  for await (const piece of provider.streamText({ system: call.system, messages: call.messages, signal, onMeta })) text += piece;
  return { text, metas, ms: Date.now() - started };
};
