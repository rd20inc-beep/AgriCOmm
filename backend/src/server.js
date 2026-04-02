const config = require('./config');
const createApp = require('./app');
const automationService = require('./services/automationService');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[RiceFlow ERP] Server running in ${config.env} mode on port ${config.port}`);
});

let schedulerBusy = false;
let schedulerTimer = null;

function startScheduler() {
  if (config.env === 'test') return;

  const runScheduledTasks = async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      const results = await automationService.runDueScheduledTasks();
      if (results.length > 0) {
        console.log(`[RiceFlow ERP] Scheduled task runner processed ${results.length} task(s).`);
      }
    } catch (err) {
      console.error('[RiceFlow ERP] Scheduled task runner error:', err.message);
    } finally {
      schedulerBusy = false;
    }
  };

  // Run once after startup, then hourly.
  setTimeout(runScheduledTasks, 30 * 1000);
  schedulerTimer = setInterval(runScheduledTasks, 60 * 60 * 1000);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
}

startScheduler();

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  if (schedulerTimer) clearInterval(schedulerTimer);
  server.close(() => {
    process.exit(1);
  });
});
