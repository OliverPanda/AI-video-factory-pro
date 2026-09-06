import { listRunJobs } from '../../workbench/dataSources/runJobRepository.js';
import { syncGatewayLedger } from './syncGatewayLedger.js';

function parsePositiveMs(value, fallbackMs) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
}

function isEnabled(env = process.env) {
  return String(env.GATEWAY_SYNC_ENABLED || 'false').trim().toLowerCase() === 'true'
    && String(env.GATEWAY_SYNC_SCHEDULE_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export function startGatewaySyncScheduler({
  workspaceRoot,
  tempProjectsDir,
  logger = console,
  intervalMs,
} = {}) {
  if (!isEnabled(process.env)) {
    return { stop() {} };
  }

  const tickIntervalMs = parsePositiveMs(
    intervalMs ?? process.env.GATEWAY_SYNC_INTERVAL_MS,
    5 * 60 * 1000
  );

  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      const runJobs = listRunJobs({ tempProjectsDir });
      if (!runJobs.length) {
        return;
      }
      const result = await syncGatewayLedger({
        runJobs,
        gatewayFamily: process.env.GATEWAY_SYNC_FAMILY || 'auto',
        gatewayBaseUrl: process.env.GATEWAY_SYNC_BASE_URL || '',
        gatewayApiKey: process.env.GATEWAY_SYNC_API_KEY || '',
        gatewayPath: process.env.GATEWAY_SYNC_PATH || '',
      });
      logger.info?.(
        '[gateway-sync-scheduler]',
        `synced events=${result.scannedEventCount} matched=${result.matchedCount} unmatched=${result.unmatchedCount}`
      );
    } catch (error) {
      logger.error?.(
        '[gateway-sync-scheduler]',
        error?.message || 'gateway_sync_scheduler_failed'
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, tickIntervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  void runOnce();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

export default {
  startGatewaySyncScheduler,
};
