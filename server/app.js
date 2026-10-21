import express from 'express';
import { config } from './config.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, serverKey: Boolean(config.serverApiKey) });
  });

  return app;
};
