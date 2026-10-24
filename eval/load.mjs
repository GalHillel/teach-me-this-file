import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = new URL('../', import.meta.url).pathname;
const runs = Number(process.env.LOAD_RUNS || 5);
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);

const app = express();
app.use(express.static(`${root}dist`));
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const url = `http://localhost:${server.address().port}/`;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const browser = await chromium.launch();
const samples = [];
try {
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    let bytes = 0;
    cdp.on('Network.loadingFinished', (event) => {
      bytes += event.encodedDataLength;
    });
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1');
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      return { fcp: paint?.startTime ?? null, lcp: window.__lcp, domContentLoaded: navigation.domContentLoadedEventEnd };
    });
    samples.push({ ...timing, kilobytes: Math.round(bytes / 1024) });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const result = {
  date: new Date().toISOString(),
  conditions: 'setup screen, 390x844, CPU 4x slower, 150 ms latency, 1.6 Mbit/s down, local static server',
  runs,
  medianMs: {
    fcp: Math.round(median(samples.map((sample) => sample.fcp))),
    lcp: Math.round(median(samples.map((sample) => sample.lcp))),
    domContentLoaded: Math.round(median(samples.map((sample) => sample.domContentLoaded))),
  },
  transferredKilobytes: median(samples.map((sample) => sample.kilobytes)),
};
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
