import { readFileSync, writeFileSync } from 'node:fs';

process.env.AI_API_KEY ||= 'mock-server-key';
process.env.RATE_LIMIT_PER_MINUTE ||= '100000';
const print = console.log;
console.log = () => {};
import { createRequire } from 'node:module';
import express from 'express';

const { createApp } = await import('../../server/app.js');
const { createMockProvider } = await import('../../server/providers/mock.js');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url).pathname;
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const strict = process.argv.includes('--strict');
const reportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9);

const VIEWPORTS = [
  [320, 640], [360, 740], [375, 667], [390, 844], [430, 932],
  [540, 720], [768, 1024], [820, 1180], [1024, 768], [1280, 800],
  [1440, 900], [1920, 1080], [2560, 1440], [844, 390], [667, 375],
];
const LESSON_VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 800], [1920, 1080], [844, 390]];

const FIXTURE = [
  '# Plants and light',
  '',
  'Photosynthesis is the process plants use to make food. Leaves take in carbon dioxide through stomata and roots take in water.',
  '',
  'Chlorophyll in the chloroplasts absorbs red and blue light and reflects green light, which is why leaves look green.',
  '',
  'Using light energy, the plant turns carbon dioxide and water into glucose and oxygen. The oxygen leaves through the stomata.',
].join('\n');

const vercelHeaders = () => {
  const config = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8'));
  return (config.headers ?? []).flatMap((rule) => rule.headers);
};

const startServer = () => {
  const outer = express();
  const headers = vercelHeaders();
  outer.use((req, res, next) => {
    headers.forEach(({ key, value }) => res.set(key, value));
    next();
  });
  const provider = createMockProvider({ delayMs: 4 });
  outer.use(createApp({ providerFor: () => ({ provider, usesServerKey: false }) }));
  outer.use(express.static(`${root}dist`));
  outer.use((req, res) => res.sendFile(`${root}dist/index.html`));
  return new Promise((resolve) => {
    const server = outer.listen(0, () => resolve(server));
  });
};

const audit = async (page) => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null))));
  await page.evaluate(axeSource);
  const layout = await page.evaluate(() => {
    const width = Math.min(window.innerWidth, Math.round(window.visualViewport?.width ?? window.innerWidth));
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width < 2 || rect.height < 2) return false;
      if (element.closest('.sr-only') || element.closest('[aria-hidden="true"]')) return false;
      return true;
    };
    const describe = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[${(element.getAttribute('aria-label') || element.innerText || element.getAttribute('placeholder') || '').trim().slice(0, 30)}]`;
    const controls = [...document.querySelectorAll('button, a[href], input:not([type=file]), select, textarea, summary')]
      .filter((element) => !element.closest('dialog:not([open])'))
      .filter(visible);
    const offscreen = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > width + 1 || rect.left < -1;
    });
    const smallTargets = controls.filter((element) => {
      if (element.tagName === 'A' && element.closest('p, li')) return false;
      if (element.tagName === 'SELECT' && getComputedStyle(element).opacity === '0') {
        const rect = element.parentElement.getBoundingClientRect();
        return Math.min(rect.width, rect.height) < 24;
      }
      const rect = element.getBoundingClientRect();
      return Math.min(rect.width, rect.height) < 24;
    });
    const tinyText = [...document.querySelectorAll('body *')]
      .filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()))
      .filter(visible)
      .filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12);
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - width),
      offscreen: offscreen.map(describe),
      smallTargets: smallTargets.map(describe),
      tinyText: tinyText.map(describe).slice(0, 5),
    };
  });
  const axe = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, sample: violation.nodes[0]?.target?.join(' ') }));
  });
  return { ...layout, axe };
};

const openApp = async (browser, viewport, language) => {
  const touch = viewport[0] < 900 && viewport[1] < 1200 && viewport[0] !== 1024;
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, hasTouch: touch, isMobile: touch && viewport[0] < 600 });
  await context.addInitScript((code) => localStorage.setItem('tmtf.uiLanguage', code), language);
  const page = await context.newPage();
  const errors = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== 'localhost' && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) externalRequests.add(host);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { context, page, errors };
};

const uploadFixture = async (page) => {
  await page.locator('input[type=file]').setInputFiles({ name: 'plants.md', mimeType: 'text/markdown', buffer: Buffer.from(FIXTURE) });
  await page.waitForSelector('p.text-success');
};

const waitTutorDone = (page, before) => page.waitForFunction((count) => {
  const articles = document.querySelectorAll('article');
  return document.querySelector('[role=alert]') || (articles.length > count && articles[articles.length - 1].getAttribute('aria-busy') === 'false');
}, before, { timeout: 20000 });

const answer = async (page, text) => {
  const before = await page.locator('article').count();
  await page.locator('#answer').fill(text);
  await page.locator('#answer').press('Enter');
  await waitTutorDone(page, before);
};

const startLesson = async (page) => {
  await uploadFixture(page);
  await page.locator('main button.btn-primary').last().click();
  await page.waitForFunction(() => document.querySelector('[role=progressbar]') || document.querySelector('[role=alert]'), null, { timeout: 20000 });
  const alert = await page.locator('[role=alert]').first().innerText().catch(() => null);
  if (alert) throw new Error(`lesson did not start: ${alert}`);
  await waitTutorDone(page, 0);
};

const results = [];
const record = (screen, viewport, language, data, extra = {}) => results.push({ screen, viewport: viewport.join('x'), language, ...data, ...extra });

const externalRequests = new Set();
let keyboard = null;
const features = [];
let pdfStructure = null;
let renamed = null;
const server = await startServer();
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

try {
  for (const language of ['en', 'he']) {
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openApp(browser, viewport, language);
      await page.goto(base);
      await page.waitForSelector('h1');
      record('setup', viewport, language, await audit(page));
      await uploadFixture(page);
      record('setup-file', viewport, language, await audit(page), { errors: [...errors] });
      await context.close();
    }
  }

  for (const language of ['en', 'he']) {
    for (const viewport of LESSON_VIEWPORTS) {
      const { context, page, errors } = await openApp(browser, viewport, language);
      const blocked = [];
      const step = async (name, action) => {
        try {
          await action();
        } catch (error) {
          blocked.push(`${name}: ${error.message.split('\n')[0].slice(0, 120)}`);
          await page.keyboard.press('Escape').catch(() => {});
        }
      };
      await page.goto(base);
      await page.waitForSelector('h1');
      await startLesson(page);
      record('lesson-start', viewport, language, await audit(page));
      let helped = false;
      await step('ask for a hint', async () => {
        const count = await page.locator('article').count();
        await page.locator('form [role=group] button').first().click({ timeout: 3000 });
        await waitTutorDone(page, count);
        helped = await page.locator('form [role=group]').count() > 0;
      });
      await answer(page, 'I think it is wrong');
      await answer(page, 'Still wrong, sorry');
      await answer(page, 'Wrong again');
      const recheckShown = await page.locator('[role=note]').count() > 0;
      await answer(page, 'Plants use light to make glucose from carbon dioxide and water.');
      record('lesson-progress', viewport, language, await audit(page), { recheckShown });

      const planButton = page.locator('section button.btn-ghost.lg\\:hidden');
      if (await planButton.isVisible()) {
        await step('open plan sheet', async () => {
          await planButton.click({ timeout: 3000 });
          await page.waitForSelector('dialog[open]', { timeout: 3000 });
          record('plan-dialog', viewport, language, await audit(page));
          await page.keyboard.press('Escape');
        });
      }
      await step('open source panel', async () => {
        await page.locator('article button').first().click({ timeout: 3000 });
        await page.waitForSelector('dialog[open]', { timeout: 3000 });
        record('source-dialog', viewport, language, await audit(page));
        await page.keyboard.press('Escape');
      });
      await answer(page, 'there is a gap in this answer');
      const detourShown = await page.locator('[role=note]').filter({ hasText: language === 'he' ? 'רעיון קודם' : 'earlier idea' }).count() > 0;
      record('detour', viewport, language, await audit(page), { detourShown });
      const inFinal = async () => (await page.locator('#answer').getAttribute('placeholder')) === (language === 'he' ? 'תשובה מהזיכרון' : 'Answer from memory');
      for (let turn = 0; turn < 6 && !(await inFinal()); turn += 1) {
        await answer(page, 'Leaves take in carbon dioxide and roots take in water to make glucose and oxygen.');
      }
      const finalShown = await inFinal();
      record('final-check', viewport, language, await audit(page), { finalShown });
      await answer(page, 'This is a wrong answer');
      for (let turn = 0; turn < 4 && !(await page.locator('#summary-title').count()); turn += 1) {
        await answer(page, 'Leaves take in carbon dioxide and roots take in water to make glucose and oxygen.');
      }
      record('lesson-complete', viewport, language, await audit(page), {
        completed: Boolean(await page.locator('#summary-title').count()),
        helped,
      });

      let reviewed = false;
      await step('practise weak steps', async () => {
        await page.locator('section[aria-labelledby="summary-title"] button.btn-primary').click({ timeout: 3000 });
        await waitTutorDone(page, (await page.locator('article').count()) - 1);
        await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.previousElementSibling?.textContent.match(/\d/), null, { timeout: 5000 });
        record('review', viewport, language, await audit(page));
        await answer(page, 'Leaves take in carbon dioxide and roots take in water to make glucose.');
        reviewed = await page.locator('section[aria-labelledby="summary-title"] p').filter({ hasText: language === 'he' ? 'תרגול:' : 'Practice:' }).count() > 0;
      });
      record('review-done', viewport, language, await audit(page), { reviewed, errors: [...errors], blocked });

      await page.reload();
      await page.waitForSelector('article');
      record('lesson-restored', viewport, language, await audit(page), {
        restored: (await page.locator('article').count()) > 0,
      });
      await context.close();
    }
  }

  pdfStructure = await (async () => {
    const maker = await browser.newPage();
    const paragraph = (topic) => `<p>${Array.from({ length: 7 }, (_, i) => `${topic} sentence ${i + 1} explains one more detail about how living cells work and why it matters for the body.`).join(' ')}</p>`;
    await maker.setContent(`<html><body style="font-family: sans-serif; font-size: 12px">
      <h1 style="font-size: 26px">Cell Respiration</h1>${paragraph('Respiration')}${paragraph('Glucose')}
      <h2 style="font-size: 20px; page-break-before: always">Photosynthesis</h2>${paragraph('Chloroplast')}${paragraph('Light')}
      <h2 style="font-size: 20px; page-break-before: always">Cell Division</h2>${paragraph('Mitosis')}${paragraph('DNA')}
    </body></html>`);
    const pdf = await maker.pdf({
      format: 'A5',
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size: 8px; width: 100%; text-align: center">Biology Handbook - Grade 9</div>',
      footerTemplate: '<div style="font-size: 8px; width: 100%; text-align: center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '2cm', bottom: '2cm', left: '1.5cm', right: '1.5cm' },
    });
    await maker.close();
    const { context, page } = await openApp(browser, [1280, 800], 'en');
    await page.goto(base);
    await page.waitForSelector('h1');
    await page.locator('input[type=file]').setInputFiles({ name: 'biology.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForSelector('p.text-success', { timeout: 20000 });
    const status = await page.locator('p.text-success').innerText();
    await page.locator('main button.btn-primary').last().click();
    await page.waitForSelector('[role=progressbar]', { timeout: 20000 });
    const chunks = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tmtf.lesson')).lesson.document.chunks);
    await context.close();
    return {
      status,
      chunks: chunks.length,
      sections: [...new Set(chunks.map((chunk) => chunk.section).filter(Boolean))],
      headerLeft: chunks.some((chunk) => chunk.text.includes('Biology Handbook')),
      footerLeft: chunks.some((chunk) => /Page \d+ of \d+/.test(chunk.text)),
    };
  })();

  renamed = await (async () => {
    const { context, page } = await openApp(browser, [1280, 800], 'en');
    await page.goto(base);
    await page.waitForSelector('h1');
    await page.locator('input[type=file]').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>this is not a pdf</html>') });
    await page.waitForSelector('[role=alert]', { timeout: 10000 });
    const text = await page.locator('[role=alert]').innerText();
    await context.close();
    return text;
  })();

  keyboard = await (async () => {
    const { context, page } = await openApp(browser, [1280, 800], 'en');
    await page.goto(base);
    await page.waitForSelector('h1');
    await startLesson(page);
    await page.locator('a[href="#answer"]').focus();
    const skipVisible = await page.locator('a[href="#answer"]').evaluate((element) => element.getBoundingClientRect().width > 20);
    await page.keyboard.press('Enter');
    const skipFocusesAnswer = await page.evaluate(() => document.activeElement?.id === 'answer');
    await page.locator('#answer').fill('Please explain slowly with an example');
    await page.locator('#answer').press('Enter');
    await page.waitForSelector('.streaming-caret', { timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.body.innerText.includes('Stopped before the end'), null, { timeout: 5000 });
    const stepAfterStop = await page.locator('[role=progressbar]').evaluate((element) => element.previousElementSibling.innerText);
    await context.close();
    return { skipVisible, skipFocusesAnswer, escapeStops: true, stepAfterStop };
  })().catch((error) => ({ error: error.message.split('\n')[0] }));

  for (const [viewport, language, sampleIndex] of [[[1280, 800], 'en', 0], [[390, 844], 'he', 1]]) {
    const { context, page } = await openApp(browser, viewport, language);
    const result = { viewport: viewport.join('x'), language };
    try {
      await page.goto(base);
      await page.waitForSelector('h1');
      await page.locator('main div.flex-wrap button[lang]').nth(sampleIndex).click();
      await page.waitForSelector('p.text-success', { timeout: 10000 });
      result.sampleLoaded = await page.locator('p.text-success').innerText();
      result.lessonLanguage = await page.locator('#lesson-language').inputValue();
      await page.locator('main button.btn-primary').last().click();
      await page.waitForSelector('[role=progressbar]', { timeout: 20000 });
      await waitTutorDone(page, 0);
      await page.getByRole('button', { name: language === 'he' ? 'חיפוש בקובץ' : 'Search the file' }).click();
      await page.waitForSelector('dialog[open] #document-search', { timeout: 5000 });
      record('document-panel', viewport, language, await audit(page));
      result.sectionsListed = await page.locator('dialog[open] li').count();
      await page.locator('dialog[open] button[aria-pressed]').first().click();
      result.conceptResults = await page.locator('dialog[open] li').count();
      await page.locator('#document-search').fill(language === 'he' ? 'עננים' : 'chlorophyll');
      result.searchResults = await page.locator('dialog[open] li').count();
      result.highlighted = await page.locator('dialog[open] li mark').count();
      const go = page.locator('dialog[open] li button.btn-secondary').first();
      if (await go.count()) {
        await go.click();
        result.jumpedToStep = await page.locator('dialog[open]').count() === 0;
      }
      if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] button[aria-label]').first().click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 3000 });
      for (let turn = 0; turn < 10 && !(await page.locator('#summary-title').count()); turn += 1) await answer(page, 'Leaves take in carbon dioxide and water and make glucose.');
      const download = page.waitForEvent('download', { timeout: 5000 });
      await page.locator('section[aria-labelledby="summary-title"] button').filter({ hasText: language === 'he' ? 'הורדת סיכום' : 'Download notes' }).click();
      const file = await download;
      result.notesFile = file.suggestedFilename();
    } catch (error) {
      result.error = error.message.split('\n')[0].slice(0, 160);
    }
    features.push(result);
    await context.close();
  }

  const { context, page } = await openApp(browser, [1280, 800], 'en');
  await page.goto(base);
  await page.waitForSelector('h1');
  await page.locator('header button.btn-secondary').click();
  await page.waitForSelector('dialog[open]');
  record('settings-dialog', [1280, 800], 'en', await audit(page));
  await context.close();
} finally {
  await browser.close();
  server.close();
}

const summary = {
  checks: results.length,
  pdfStructure,
  renamedPdf: renamed,
  keyboard,
  features,
  externalRequests: [...externalRequests],
  overflow: results.filter((row) => row.overflow > 0).map((row) => `${row.screen} ${row.viewport} ${row.language} +${row.overflow}px`),
  offscreen: results.filter((row) => row.offscreen.length).map((row) => `${row.screen} ${row.viewport} ${row.language}: ${row.offscreen.join(', ')}`),
  smallTargets: [...new Set(results.flatMap((row) => row.smallTargets.map((item) => `${row.screen}: ${item}`)))],
  tinyText: [...new Set(results.flatMap((row) => row.tinyText.map((item) => `${row.screen}: ${item}`)))],
  axe: Object.values(results.flatMap((row) => row.axe.map((violation) => ({ ...violation, where: `${row.screen} ${row.viewport} ${row.language}` })))
    .reduce((all, violation) => {
      const entry = all[violation.id] ?? { id: violation.id, impact: violation.impact, screens: 0, sample: violation.sample, where: violation.where };
      entry.screens += 1;
      all[violation.id] = entry;
      return all;
    }, {})),
  lessonCompleted: results.filter((row) => row.screen === 'lesson-complete').every((row) => row.completed),
  helpActions: results.filter((row) => row.screen === 'lesson-complete').every((row) => row.helped),
  detourShown: results.filter((row) => row.screen === 'detour').every((row) => row.detourShown),
  finalCheckShown: results.filter((row) => row.screen === 'final-check').every((row) => row.finalShown),
  lessonRestored: results.filter((row) => row.screen === 'lesson-restored').every((row) => row.restored),
  recheckShown: results.filter((row) => row.screen === 'lesson-progress').every((row) => row.recheckShown),
  reviewCompleted: results.filter((row) => row.screen === 'review-done').every((row) => row.reviewed),
  pageErrors: [...new Set(results.flatMap((row) => row.errors ?? []))],
  blocked: results.flatMap((row) => (row.blocked ?? []).map((item) => `${row.viewport} ${row.language} ${item}`)),
};

print(JSON.stringify(summary, null, 2));
if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);

const serious = summary.axe.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
const failed = features.some((item) => item.error || !item.notesFile || !item.searchResults) || !keyboard?.escapeStops || !keyboard?.skipFocusesAnswer || !pdfStructure || pdfStructure.headerLeft || pdfStructure.footerLeft || pdfStructure.sections.length < 3 || !summary.recheckShown || !summary.reviewCompleted || !summary.helpActions || !summary.detourShown || !summary.finalCheckShown || summary.blocked.length || summary.overflow.length || summary.offscreen.length || serious.length || !summary.lessonCompleted || !summary.lessonRestored || summary.pageErrors.length;
if (strict && failed) process.exit(1);
