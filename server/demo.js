import express from 'express';

process.env.DEMO_MODE = 'true';

const { createApp } = await import('./app.js');
const { createMockProvider } = await import('./providers/mock.js');

const port = Number(process.env.PORT) || 4400;
const provider = createMockProvider({ delayMs: 25 });
const api = createApp({ providerFor: () => ({ provider, usesServerKey: false }) });
const dist = new URL('../dist/', import.meta.url).pathname;

const site = express();
site.use(api);
site.use(express.static(dist));
site.get(/.*/, (req, res) => res.sendFile(`${dist}index.html`));
site.listen(port, () => {
  console.log(`offline demo on http://localhost:${port} (scripted replies, no AI model)`);
});
