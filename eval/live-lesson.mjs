import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { SAMPLES } from '../src/samples/index.js';
process.env.AI_API_KEY ||= 'unused-placeholder';
process.env.RATE_LIMIT_PER_MINUTE ||= '100000';
const { createApp } = await import('../server/app.js');
const { createMockProvider } = await import('../server/providers/mock.js');
const { createRemoteProvider } = await import('./remote-provider.js');

const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const language = arg('lang', 'en');
const dir = resolve(arg('dir', `eval/results/live-${language}`));
const [width, height] = arg('viewport', language === 'he' ? '390x844' : '1280x800').split('x').map(Number);
const providerName = arg('provider', 'mock');
const siteUrl = arg('url', null);
const lessonLanguage = arg('lesson-language', null);
const filePath = arg('file', null);
const teacherPrompt = arg('prompt', null);
const apiKey = process.env.LIVE_LESSON_KEY ?? null;
const root = new URL('../', import.meta.url).pathname;
const stateFile = `${dir}/state.json`;
const commandFile = `${dir}/command.json`;
const logFile = `${dir}/turns.jsonl`;

mkdirSync(dir, { recursive: true });
rmSync(commandFile, { force: true });

const provider = siteUrl ? null : providerName === 'remote'
  ? await createRemoteProvider({ url: process.env.EVAL_REMOTE_URL, models: process.env.EVAL_REMOTE_MODELS || null })
  : createMockProvider({ delayMs: 4 });

const turns = [];
const parseEvents = (text) => text.split('\n\n').map((block) => block.split('\n')).filter(([eventLine, dataLine]) => eventLine?.startsWith('event: ') && dataLine?.startsWith('data: ')).map(([eventLine, dataLine]) => ({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) }));
const outer = express();
outer.use((req, res, next) => {
  if (req.method !== 'POST' || req.path !== '/api/turns') return next();
  const entry = { at: new Date().toISOString(), kind: req.body?.kind, events: [] };
  const write = res.write.bind(res);
  res.write = (chunk, ...rest) => {
    for (const block of String(chunk).split('\n\n')) {
      const [eventLine, dataLine] = block.split('\n');
      if (eventLine?.startsWith('event: ') && dataLine?.startsWith('data: ')) entry.events.push({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
    }
    return write(chunk, ...rest);
  };
  turns.push(entry);
  return next();
});
outer.use(express.json({ limit: '2mb' }));
outer.use(createApp({ providerFor: () => ({ provider, usesServerKey: false }) }));
outer.use(express.static(`${root}dist`));
outer.use((req, res) => res.sendFile(`${root}dist/index.html`));
const server = siteUrl ? null : await new Promise((done) => {
  const listening = outer.listen(0, () => done(listening));
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 600, isMobile: width < 600 });
await context.addInitScript((code) => localStorage.setItem('tmtf.uiLanguage', code), language);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let pendingTurn = null;
if (siteUrl) {
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !response.url().endsWith('/api/turns')) return;
    const entry = { at: new Date().toISOString(), kind: JSON.parse(response.request().postData() ?? '{}').kind, status: response.status(), events: [] };
    turns.push(entry);
    pendingTurn = response.text().then((text) => { entry.events = parseEvents(text); }).catch(() => {});
  });
}

const waitTutorDone = (before) => page.waitForFunction((count) => {
  const articles = document.querySelectorAll('article');
  return document.querySelector('[role=alert]') || (articles.length > count && articles[articles.length - 1].getAttribute('aria-busy') === 'false');
}, before, { timeout: 120000 });

const storedChat = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('tmtf.chat') ?? 'null')?.chat ?? null);

let source = null;

const report = async (status) => {
  await pendingTurn;
  const chat = await storedChat();
  const last = turns.at(-1);
  const update = last?.events.find((item) => item.event === 'progress')?.data;
  const tutor = await page.locator('article').last().innerText().catch(() => '');
  const counter = await page.evaluate(() => document.querySelector('[role=progressbar]')?.previousElementSibling?.textContent.trim() ?? null);
  const alert = await page.locator('[role=alert]').first().innerText().catch(() => null);
  const state = {
    status,
    turn: turns.length,
    move: update?.move ?? null,
    reason: update?.reason ?? null,
    assessment: update?.assessment ?? null,
    counter,
    alert,
    progress: chat?.progress ? { status: chat.progress.status, currentStep: chat.progress.currentStep, phases: chat.progress.steps.map((step) => `${step.status}/${step.phase}/${step.outcome ?? '-'}`), evidence: (chat.progress.evidence ?? []).map((entry) => `${entry.step}:${entry.question ?? 'gap'}:${entry.support ?? '-'}:${entry.verdict ?? '-'}`) } : null,
    tutor,
    tutorDirection: await lastBody().evaluate((node) => getComputedStyle(node).direction).catch(() => null),
    source,
    errors,
  };
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  if (last) writeFileSync(logFile, `${JSON.stringify({ ...last, tutor })}\n`, { flag: 'a' });
};

const nextCommand = async () => {
  while (!existsSync(commandFile)) await new Promise((done) => setTimeout(done, 500));
  const command = JSON.parse(readFileSync(commandFile, 'utf8'));
  rmSync(commandFile, { force: true });
  return command;
};

const sample = SAMPLES.find((item) => (language === 'he' ? /[֐-׿]/.test(item.text) : !/[֐-׿]/.test(item.text)));
const lastBody = () => page.locator('article').last().locator('div[dir=auto]').first();
await page.goto(siteUrl ?? `http://localhost:${server.address().port}`);
try {
  if (apiKey) {
    await page.locator('header button.btn-secondary').click();
    await page.locator('#api-key').fill(apiKey);
    await page.locator('dialog[open] button[type=submit]').click();
  }
  await page.locator('input[type=file]').setInputFiles(filePath ?? { name: sample.fileName, mimeType: 'text/markdown', buffer: Buffer.from(sample.text) });
  await page.waitForSelector('p.text-success');
  if (teacherPrompt) await page.locator('#teacher-prompt').fill(teacherPrompt);
  if (lessonLanguage) await page.locator('#lesson-language').selectOption(lessonLanguage);
  await page.locator('main button.btn-primary').last().click();
  await page.waitForFunction(() => document.querySelector('[role=progressbar]') || document.querySelector('[role=alert]'), null, { timeout: 180000 });
  await waitTutorDone(0).catch(() => {});
} catch (error) {
  await page.screenshot({ path: `${dir}/setup-failed.png` });
  writeFileSync(`${dir}/setup-failed.txt`, `${error.message}\n\n${await page.locator('body').innerText().catch(() => '')}`);
  throw error;
}
await report('started');

for (;;) {
  const command = await nextCommand();
  if (command.type === 'stop') break;
  const before = await page.locator('article').count();
  if (command.type === 'button') {
    await page.getByRole('button', { name: command.name, exact: true }).click();
  } else if (command.type === 'source') {
    const link = page.locator('article').last().locator('button.cite-chip, div.mt-2 button').first();
    await link.click();
    const panel = page.locator('dialog[open]');
    await panel.waitFor();
    source = { text: (await panel.innerText()).slice(0, 600), direction: await panel.locator('[dir]').last().evaluate((node) => getComputedStyle(node).direction).catch(() => null) };
    await page.keyboard.press('Escape');
    await report('source');
    source = null;
    continue;
  } else if (command.type === 'reload') {
    await page.reload();
    await page.waitForSelector('article');
    await report('reloaded');
    continue;
  } else {
    await page.locator('#answer').fill(command.text);
    await page.locator('#answer').press('Enter');
    if (command.stopAfterMs) {
      await page.waitForTimeout(command.stopAfterMs);
      await page.keyboard.press('Escape');
    }
  }
  await waitTutorDone(before).catch(() => {});
  await report('waiting');
}

await page.screenshot({ path: `${dir}/end.png`, fullPage: false });
await report('stopped');
await browser.close();
await provider?.close?.();
server?.close();
