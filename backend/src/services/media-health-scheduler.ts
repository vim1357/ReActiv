import type { FastifyBaseLogger } from "fastify";
import { getMediaHealthDailyByDate } from "../repositories/media-health-repository";
import {
  getTodayMoscowDateKey,
  runAndPersistMediaHealthSnapshot,
} from "./media-health-snapshot-service";

const MOSCOW_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_HOUR_MSK = 4;

function getMsUntilNextScheduledRun(): number {
  const nowUtcMs = Date.now();
  const nowMoscowMs = nowUtcMs + MOSCOW_UTC_OFFSET_MS;
  const nextRunMoscow = new Date(nowMoscowMs);
  nextRunMoscow.setUTCHours(SCHEDULE_HOUR_MSK, 0, 0, 0);

  if (nextRunMoscow.getTime() <= nowMoscowMs) {
    nextRunMoscow.setUTCDate(nextRunMoscow.getUTCDate() + 1);
  }

  const nextRunUtcMs = nextRunMoscow.getTime() - MOSCOW_UTC_OFFSET_MS;
  return Math.max(1_000, nextRunUtcMs - nowUtcMs);
}

export function startMediaHealthScheduler(logger: FastifyBaseLogger): void {
  let isRunning = false;

  async function run(triggerType: "scheduler" | "startup"): Promise<void> {
    if (isRunning) {
      logger.info({ triggerType }, "media_health_scheduler_skip_already_running");
      return;
    }

    isRunning = true;
    try {
      await runAndPersistMediaHealthSnapshot({
        triggerType,
        logger,
      });
    } catch (error) {
      logger.error({ error, triggerType }, "media_health_scheduler_run_failed");
    } finally {
      isRunning = false;
    }
  }

  const todayDateKey = getTodayMoscowDateKey();
  const todayRecord = getMediaHealthDailyByDate(todayDateKey);
  if (!todayRecord) {
    void run("startup");
  }

  const msUntilNextRun = getMsUntilNextScheduledRun();
  logger.info(
    { msUntilNextRun, scheduleHourMsk: SCHEDULE_HOUR_MSK },
    "media_health_scheduler_started",
  );

  setTimeout(() => {
    void run("scheduler");

    setInterval(() => {
      void run("scheduler");
    }, DAILY_INTERVAL_MS);
  }, msUntilNextRun);
}
