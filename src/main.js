// Starts the Inventory Scanner. Settings come from environment variables,
// set in docker-compose.yml and (for API credentials) an optional .env file.
//
//   PORT              port to listen on (default 3000)
//   HOST              address to listen on (default 0.0.0.0, all)
//   DATA_DIR          folder holding scans.db (default ./data)
//   TRUST_PROXY       "1" = take the client address from X-Forwarded-For (only behind a reverse proxy)
//   DISPLAY_TIMEZONE  time zone for the local-time columns of the CSV exports (default UTC), e.g. America/New_York
//   APP_SUBTITLE      optional line under the page title, e.g. your organisation (default: none)
//   DELL_* / CISCO_*  optional API credentials for the Analyze page (see README.md)

import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const app = await startServer({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? fileURLToPath(new URL('../data/', import.meta.url)),
  trustProxy: process.env.TRUST_PROXY === '1',
  timeZone: process.env.DISPLAY_TIMEZONE || 'UTC',
  subtitle: process.env.APP_SUBTITLE ?? '',
});

console.log(
  `${new Date().toISOString()} inventory-scanner listening on port ${app.port}, ` +
  `database ${app.store.file}, trust proxy ${process.env.TRUST_PROXY === '1' ? 'on' : 'off'}`,
);

// Docker stops the container with SIGTERM. Finish open requests and close
// the database cleanly; give up after 5 seconds.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`${new Date().toISOString()} ${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 5000).unref();
    app.close().then(() => process.exit(0));
  });
}
