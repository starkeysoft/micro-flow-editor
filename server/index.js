// Entry point for `npm start`, the CLI and the Docker image.
import { start } from './server.js';

const { close } = await start();

const shutdown = () => close().finally(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
