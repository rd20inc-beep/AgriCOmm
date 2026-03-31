const os = require('os');
const db = require('../config/database');

/**
 * System Health Monitoring — Phase 10 (Enterprise)
 * Runs diagnostic checks and stores results.
 */
const healthService = {
  // ═══════════════════════════════════════════════════════════════════
  // RUN ALL CHECKS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Execute all health checks and persist results.
   */
  async runAllChecks() {
    const checks = [];
    checks.push(await this.checkDatabase());
    checks.push(await this.checkMemory());
    checks.push(await this.checkMemory());
    checks.push(await this.checkApiResponse());
    checks.push(await this.checkPendingJobs());
    checks.push(await this.checkOverdueAlerts());

    // Persist each check
    for (const check of checks) {
      await db('system_health').insert({
        check_type: check.checkType,
        status: check.status,
        value: check.value,
        threshold: check.threshold,
        details: JSON.stringify(check.details),
        checked_at: db.fn.now(),
      });
    }

    return checks;
  },

  // ═══════════════════════════════════════════════════════════════════
  // INDIVIDUAL CHECKS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Database connectivity and response time check.
   * Healthy < 100ms, Warning < 500ms, Critical >= 500ms or error.
   */
  async checkDatabase() {
    const start = Date.now();
    try {
      await db.raw('SELECT 1');
      const elapsed = Date.now() - start;

      let status = 'Healthy';
      if (elapsed >= 500) status = 'Critical';
      else if (elapsed >= 100) status = 'Warning';

      return {
        checkType: 'database',
        status,
        value: `${elapsed}ms`,
        threshold: '<100ms Healthy, <500ms Warning',
        details: { responseTimeMs: elapsed },
      };
    } catch (err) {
      return {
        checkType: 'database',
        status: 'Critical',
        value: 'unreachable',
        threshold: '<100ms Healthy, <500ms Warning',
        details: { error: err.message },
      };
    }
  },

  /**
   * Memory pressure check using OS memory stats.
   * Healthy < 80% used, Warning < 90%, Critical >= 90%.
   */
  async checkMemory() {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

      let status = 'Healthy';
      if (usedPercent >= 90) status = 'Critical';
      else if (usedPercent >= 80) status = 'Warning';

      return {
        checkType: 'memory',
        status,
        value: `${usedPercent}% used`,
        threshold: '<80% Healthy, <90% Warning',
        details: {
          totalBytes: totalMem,
          freeBytes: freeMem,
          usedPercent,
        },
      };
    } catch (err) {
      return {
        checkType: 'memory',
        status: 'Warning',
        value: 'unknown',
        threshold: '<80% Healthy, <90% Warning',
        details: { error: err.message },
      };
    }
  },

  /**
   * Node.js heap memory check.
   * Healthy if heapUsed < 80% of heapTotal.
   */
  async checkMemory() {
    const mem = process.memoryUsage();
    const heapUsedPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    let status = 'Healthy';
    if (heapUsedPercent >= 90) status = 'Critical';
    else if (heapUsedPercent >= 80) status = 'Warning';

    return {
      checkType: 'memory',
      status,
      value: `${heapUsedPercent}% heap used`,
      threshold: '<80% Healthy, <90% Warning',
      details: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
        heapUsedPercent,
      },
    };
  },

  /**
   * API self-check — measure internal response time.
   */
  async checkApiResponse() {
    const start = Date.now();
    try {
      // Self-check: just run a lightweight DB query as proxy
      await db.raw('SELECT NOW()');
      const elapsed = Date.now() - start;

      let status = 'Healthy';
      if (elapsed >= 1000) status = 'Critical';
      else if (elapsed >= 300) status = 'Warning';

      return {
        checkType: 'api_response',
        status,
        value: `${elapsed}ms`,
        threshold: '<300ms Healthy, <1000ms Warning',
        details: { responseTimeMs: elapsed },
      };
    } catch (err) {
      return {
        checkType: 'api_response',
        status: 'Critical',
        value: 'error',
        threshold: '<300ms Healthy, <1000ms Warning',
        details: { error: err.message },
      };
    }
  },

  /**
   * Count jobs stuck in 'Running' for more than 30 minutes.
   */
  async checkPendingJobs() {
    try {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const [{ count }] = await db('background_jobs')
        .where({ status: 'Running' })
        .where('started_at', '<', thirtyMinAgo)
        .count('id as count');

      const stuckCount = parseInt(count, 10);
      let status = 'Healthy';
      if (stuckCount >= 5) status = 'Critical';
      else if (stuckCount >= 1) status = 'Warning';

      return {
        checkType: 'queue_depth',
        status,
        value: `${stuckCount} stuck jobs`,
        threshold: '0 Healthy, >=1 Warning, >=5 Critical',
        details: { stuckJobCount: stuckCount },
      };
    } catch (err) {
      return {
        checkType: 'queue_depth',
        status: 'Healthy',
        value: '0 stuck jobs',
        threshold: '0 Healthy, >=1 Warning, >=5 Critical',
        details: { note: 'Could not check — table may not exist yet' },
      };
    }
  },

  /**
   * Count open alerts older than 7 days.
   */
  async checkOverdueAlerts() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Check if alerts table exists
      const hasTable = await db.schema.hasTable('alerts');
      if (!hasTable) {
        return {
          checkType: 'overdue_alerts',
          status: 'Healthy',
          value: '0 overdue',
          threshold: '0 Healthy, >=5 Warning, >=20 Critical',
          details: { note: 'Alerts table not present' },
        };
      }

      const [{ count }] = await db('alerts')
        .where('status', 'Open')
        .where('created_at', '<', sevenDaysAgo)
        .count('id as count');

      const overdueCount = parseInt(count, 10);
      let status = 'Healthy';
      if (overdueCount >= 20) status = 'Critical';
      else if (overdueCount >= 5) status = 'Warning';

      return {
        checkType: 'overdue_alerts',
        status,
        value: `${overdueCount} overdue`,
        threshold: '0 Healthy, >=5 Warning, >=20 Critical',
        details: { overdueAlertCount: overdueCount },
      };
    } catch (err) {
      return {
        checkType: 'overdue_alerts',
        status: 'Healthy',
        value: '0 overdue',
        threshold: '0 Healthy, >=5 Warning, >=20 Critical',
        details: { note: 'Could not check alerts' },
      };
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // HISTORY & METRICS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get health check history for a given type.
   */
  async getHealthHistory(checkType, limit = 50) {
    const query = db('system_health').orderBy('checked_at', 'desc').limit(limit);
    if (checkType) query.where({ check_type: checkType });
    return query;
  },

  /**
   * Get aggregated system metrics.
   */
  async getSystemMetrics() {
    const mem = process.memoryUsage();
    const poolInfo = db.client.pool || {};

    // Count records in key tables for operational overview
    const [jobsCount] = await db('background_jobs').count('id as count');
    const [pendingJobs] = await db('background_jobs').where({ status: 'Pending' }).count('id as count');
    const [runningJobs] = await db('background_jobs').where({ status: 'Running' }).count('id as count');

    return {
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
      os: {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
        freeMemMB: Math.round(os.freemem() / 1024 / 1024),
        loadAverage: os.loadavg(),
      },
      pool: {
        numUsed: poolInfo.numUsed ? poolInfo.numUsed() : null,
        numFree: poolInfo.numFree ? poolInfo.numFree() : null,
        numPendingAcquires: poolInfo.numPendingAcquires ? poolInfo.numPendingAcquires() : null,
        numPendingCreates: poolInfo.numPendingCreates ? poolInfo.numPendingCreates() : null,
      },
      jobs: {
        total: parseInt(jobsCount.count, 10),
        pending: parseInt(pendingJobs.count, 10),
        running: parseInt(runningJobs.count, 10),
      },
    };
  },
};

/**
 * Format seconds into human-readable uptime string.
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = healthService;
