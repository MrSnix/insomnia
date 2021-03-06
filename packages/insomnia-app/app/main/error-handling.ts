export function init() {
  process.on('uncaughtException', err => {
    console.error('[catcher] Uncaught exception:', err.stack);
  });
  process.on('unhandledRejection', (err: Error) => {
    console.error('[catcher] Unhandled rejection:', err.stack);
  });
}
