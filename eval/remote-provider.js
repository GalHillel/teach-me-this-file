import { resolveProvider } from '../server/providers/index.js';

export const callFromPage = (page) => async (body) => {
  const reply = await page.evaluate(async (payload) => {
    const response = await fetch('/api/eval/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, body);
  if (reply.status !== 200) {
    const error = new Error(reply.body?.error?.message ?? `HTTP ${reply.status}`);
    error.code = reply.body?.error?.code ?? 'provider_unavailable';
    throw error;
  }
  return reply.body;
};

export const createRemoteProvider = async ({ url, models = null }) => {
  if (!url) throw new Error('EVAL_REMOTE_URL is not set');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const call = callFromPage(page);
  const usage = { calls: 0, charsIn: 0, charsOut: 0 };
  const count = (sent, received) => {
    usage.calls += 1;
    usage.charsIn += sent;
    usage.charsOut += received;
  };
  return {
    name: 'remote',
    model: models,
    host: new URL(page.url()).host,
    usage,
    async generateJson({ task, system, prompt, onMeta }) {
      const body = await call({ op: 'json', task, system, prompt });
      count(system.length + prompt.length, JSON.stringify(body.result ?? '').length);
      for (const meta of body.metas) onMeta?.(meta);
      return body.result;
    },
    async *streamText({ system, messages, onMeta }) {
      const body = await call({ op: 'text', system, messages });
      count(system.length + messages.reduce((sum, message) => sum + message.content.length, 0), (body.text ?? '').length);
      for (const meta of body.metas) onMeta?.(meta);
      yield body.text;
    },
    close: () => browser.close(),
  };
};

export const evalProvider = async ({ name, apiKey }) => (name === 'remote'
  ? createRemoteProvider({ url: process.env.EVAL_REMOTE_URL, models: process.env.EVAL_REMOTE_MODELS || null })
  : resolveProvider({ apiKey, provider: name }).provider);
