import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiProvider } from '../server/providers/gemini.js';
import { detectProvider, resolveProvider } from '../server/providers/index.js';
import { createOpenAiCompatibleProvider } from '../server/providers/openaiCompatible.js';

const sseResponse = (events) =>
  new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const collect = async (iterator) => {
  let text = '';
  for await (const part of iterator) text += part;
  return text;
};

afterEach(() => vi.restoreAllMocks());

describe('provider selection', () => {
  it('detects the provider from the key prefix', () => {
    expect(detectProvider('AIzaSyExample')).toBe('gemini');
    expect(detectProvider('gsk_example')).toBe('groq');
    expect(detectProvider('sk-or-v1-example')).toBe('openrouter');
    expect(detectProvider('sk-example')).toBe(null);
  });

  it('lets the user pick a provider for an unknown key format', () => {
    expect(resolveProvider({ apiKey: 'custom-key', provider: 'groq' }).name).toBe('groq');
  });
});

describe('Gemini provider', () => {
  it('streams text and skips thought parts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse([
      { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'student' }] }, finishReason: 'STOP' }] },
    ]));
    const provider = createGeminiProvider({ apiKey: 'AIzaTest', models: ['gemini-test'] });
    const text = await collect(provider.streamText({ system: 'sys', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }));
    expect(text).toBe('Hello student');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/models/gemini-test:streamGenerateContent?alt=sse');
    const body = JSON.parse(options.body);
    expect(body.contents.map((content) => content.role)).toEqual(['user', 'model']);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
  });

  it('parses JSON answers, even inside code fences', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ text: '```json\n{"verdict":"partial"}\n```' }] } }],
    }));
    const provider = createGeminiProvider({ apiKey: 'AIzaTest', models: ['gemini-test'] });
    expect(await provider.generateJson({ system: 's', prompt: 'p' })).toEqual({ verdict: 'partial' });
  });

  it('maps a quota error and a blocked prompt', async () => {
    const quota = '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"58s"}]}}';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(quota, { status: 429 }));
    const provider = createGeminiProvider({ apiKey: 'AIzaTest', models: ['gemini-test'] });
    await expect(provider.generateJson({ system: 's', prompt: 'p' })).rejects.toMatchObject({ code: 'rate_limited' });

    fetch.mockResolvedValueOnce(Response.json({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(provider.generateJson({ system: 's', prompt: 'p' })).rejects.toMatchObject({ code: 'blocked' });
  });

  it('retries once after a short rate-limit wait', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"details":[{"retryDelay":"0.01s"}]}}', { status: 429 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: '{"verdict":"correct"}' }] } }] }));
    const provider = createGeminiProvider({ apiKey: 'AIzaTest', models: ['flash'] });
    expect(await provider.generateJson({ system: 's', prompt: 'p' })).toEqual({ verdict: 'correct' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('Gemini model fallback', () => {
  it('moves to the next model when one is overloaded or unavailable', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
    const provider = createGeminiProvider({ apiKey: 'AIzaTest', models: ['a', 'b', 'c'] });
    expect(await provider.generateJson({ task: 'plan', system: 's', prompt: 'p' })).toEqual({ ok: true });
    expect(fetch.mock.calls.map(([url]) => url.split('/models/')[1].split(':')[0])).toEqual(['a', 'b', 'c']);
  });

  it('does not fall back when the key is invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    const provider = createGeminiProvider({ apiKey: 'AIzaBad', models: ['a', 'b'] });
    await expect(provider.generateJson({ task: 'plan', system: 's', prompt: 'p' })).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI-compatible provider', () => {
  it('streams deltas until [DONE]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse([
      { choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { content: 'Bon' } }] },
      { choices: [{ delta: { content: 'jour' } }] },
      '[DONE]',
    ]));
    const provider = createOpenAiCompatibleProvider({ name: 'groq', apiKey: 'gsk_test', model: 'llama' });
    expect(await collect(provider.streamText({ system: 's', messages: [{ role: 'user', content: 'hi' }] }))).toBe('Bonjour');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options.headers.authorization).toBe('Bearer gsk_test');
    expect(JSON.parse(options.body).messages[0]).toEqual({ role: 'system', content: 's' });
  });

  it('maps an invalid key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"bad key"}', { status: 401 }));
    const provider = createOpenAiCompatibleProvider({ name: 'openrouter', apiKey: 'sk-or-x', model: 'm' });
    await expect(provider.generateJson({ system: 's', prompt: 'p' })).rejects.toMatchObject({ code: 'invalid_key' });
  });
});
