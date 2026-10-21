import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile();

const { createApp } = await import('./app.js');
const { config } = await import('./config.js');

createApp().listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
