import { db } from "../db/connection";
import {
  createMediaHealthJobRun,
  finishMediaHealthJobRun,
  getMediaHealthDailyByDate,
  type MediaHealthHostStat,
  upsertMediaHealthDaily,
} from "../repositories/media-health-repository";
import { storedMediaFileExists } from "./local-media-storage";
import { resolvePreviewUrl } from "./media-preview-service";

const MOSCOW_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

const DEFAULT_EXTERNAL_SAMPLE_SIZE = 1200;
const DEFAULT_EXTERNAL_CONCURRENCY = 8;

interface SourceCandidateRow {
  id: number;
  yandex_disk_url: string;
  website_url: string;
}

interface SourceCandidate {
  sourceUrl: string;
  host: string;
}

interface LoggerLike {
  info: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
}

export interface MediaHealthSnapshotResult {
  metricDate: string;
  status: "success" | "failed";
  previewCandidatesCount: number;
  previewAliveCount: number;
  previewMissingCount: number;
  previewErrorCount: number;
  previewAlivePercent: number;
  externalSampleRequested: number;
  externalCheckedWithSourceCount: number;
  externalNoSourceCount: number;
  externalAliveCount: number;
  externalNoPreviewCount: number;
  externalErrorCount: number;
  externalAlivePercent: number;
  hostStats: MediaHealthHostStat[];
  errorMessage: string | null;
}

export interface RunMediaHealthSnapshotOptions {
  metricDate?: string;
  triggerType?: "scheduler" | "startup" | "script" | "manual_api";
  externalSampleSize?: number;
  externalConcurrency?: number;
  logger?: LoggerLike;
}

function hasColumn(tableName: string, columnName: string): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function getMoscowDateKey(date = new Date()): string {
  const moscowTimestamp = date.getTime() + MOSCOW_UTC_OFFSET_MS;
  const moscowDate = new Date(moscowTimestamp);
  const year = moscowDate.getUTCFullYear();
  const month = String(moscowDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(moscowDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
}

function extractFirstHttpUrl(rawValue: string): string | null {
  if (!rawValue) {
    return null;
  }

  const match = rawValue.match(/https?:\/\/\S+/i);
  if (!match) {
    return null;
  }

  const cleaned = match[0].replace(/[),.;]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function getSourceCandidate(row: SourceCandidateRow): SourceCandidate | null {
  const sourceUrl =
    extractFirstHttpUrl(row.yandex_disk_url) ??
    extractFirstHttpUrl(row.website_url);

  if (!sourceUrl) {
    return null;
  }

  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return { sourceUrl, host };
  } catch {
    return null;
  }
}

function pickDeterministicSample<T>(items: T[], sampleSize: number): T[] {
  if (sampleSize <= 0 || items.length === 0) {
    return [];
  }

  if (items.length <= sampleSize) {
    return [...items];
  }

  const step = items.length / sampleSize;
  const sample: T[] = [];
  for (let index = 0; index < sampleSize; index += 1) {
    sample.push(items[Math.floor(index * step)]);
  }

  return sample;
}

async function runConcurrentPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const safeConcurrency = Math.max(1, Math.min(32, Math.floor(concurrency)));
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      runWorker(),
    ),
  );
}

async function calculateMediaHealthMetrics(
  externalSampleSize: number,
  externalConcurrency: number,
): Promise<MediaHealthSnapshotResult> {
  const hasCardPreviewPathColumn = hasColumn("vehicle_offers", "card_preview_path");
  const previewRows = hasCardPreviewPathColumn
    ? (db
        .prepare(
          `
            SELECT card_preview_path
            FROM vehicle_offers
            WHERE TRIM(COALESCE(card_preview_path, '')) != ''
          `,
        )
        .all() as Array<{ card_preview_path: string }>)
    : [];

  let previewAliveCount = 0;
  let previewMissingCount = 0;
  let previewErrorCount = 0;
  previewRows.forEach((row) => {
    try {
      if (storedMediaFileExists(row.card_preview_path)) {
        previewAliveCount += 1;
      } else {
        previewMissingCount += 1;
      }
    } catch {
      previewErrorCount += 1;
    }
  });

  const previewCandidatesCount = previewRows.length;

  const hasYandexDiskUrlColumn = hasColumn("vehicle_offers", "yandex_disk_url");
  const hasWebsiteUrlColumn = hasColumn("vehicle_offers", "website_url");
  const sourceRows = db
    .prepare(
      `
        SELECT
          id,
          ${hasYandexDiskUrlColumn ? "yandex_disk_url" : "''"} AS yandex_disk_url,
          ${hasWebsiteUrlColumn ? "website_url" : "''"} AS website_url
        FROM vehicle_offers
        ORDER BY id ASC
      `,
    )
    .all() as SourceCandidateRow[];

  const sampledRows = pickDeterministicSample(sourceRows, externalSampleSize);
  const candidates = sampledRows.map(getSourceCandidate);
  const withSourceCandidates = candidates.filter(
    (item): item is SourceCandidate => item !== null,
  );
  const externalNoSourceCount = sampledRows.length - withSourceCandidates.length;

  let externalAliveCount = 0;
  let externalNoPreviewCount = 0;
  let externalErrorCount = 0;

  const hostStatsByHost = new Map<
    string,
    { total: number; alive: number; noPreview: number; errors: number }
  >();

  await runConcurrentPool(withSourceCandidates, externalConcurrency, async (candidate) => {
    const currentHost = hostStatsByHost.get(candidate.host) ?? {
      total: 0,
      alive: 0,
      noPreview: 0,
      errors: 0,
    };
    currentHost.total += 1;

    try {
      const resolved = await resolvePreviewUrl(candidate.sourceUrl);
      if (resolved.previewUrl) {
        externalAliveCount += 1;
        currentHost.alive += 1;
      } else {
        externalNoPreviewCount += 1;
        currentHost.noPreview += 1;
      }
    } catch {
      externalErrorCount += 1;
      currentHost.errors += 1;
    }

    hostStatsByHost.set(candidate.host, currentHost);
  });

  const hostStats: MediaHealthHostStat[] = Array.from(hostStatsByHost.entries())
    .map(([host, stat]) => ({
      host,
      total: stat.total,
      alive: stat.alive,
      noPreview: stat.noPreview,
      errors: stat.errors,
      alivePercent: toPercent(stat.alive, stat.total),
    }))
    .sort((left, right) => right.total - left.total);

  const externalCheckedWithSourceCount = withSourceCandidates.length;

  return {
    metricDate: getMoscowDateKey(),
    status: "success",
    previewCandidatesCount,
    previewAliveCount,
    previewMissingCount,
    previewErrorCount,
    previewAlivePercent: toPercent(previewAliveCount, previewCandidatesCount),
    externalSampleRequested: sampledRows.length,
    externalCheckedWithSourceCount,
    externalNoSourceCount,
    externalAliveCount,
    externalNoPreviewCount,
    externalErrorCount,
    externalAlivePercent: toPercent(externalAliveCount, externalCheckedWithSourceCount),
    hostStats,
    errorMessage: null,
  };
}

function buildFailedSnapshot(metricDate: string, errorMessage: string): MediaHealthSnapshotResult {
  return {
    metricDate,
    status: "failed",
    previewCandidatesCount: 0,
    previewAliveCount: 0,
    previewMissingCount: 0,
    previewErrorCount: 0,
    previewAlivePercent: 0,
    externalSampleRequested: 0,
    externalCheckedWithSourceCount: 0,
    externalNoSourceCount: 0,
    externalAliveCount: 0,
    externalNoPreviewCount: 0,
    externalErrorCount: 0,
    externalAlivePercent: 0,
    hostStats: [],
    errorMessage,
  };
}

export async function runAndPersistMediaHealthSnapshot(
  options: RunMediaHealthSnapshotOptions = {},
): Promise<MediaHealthSnapshotResult> {
  const metricDate = options.metricDate ?? getMoscowDateKey();
  const triggerType = options.triggerType ?? "scheduler";
  const externalSampleSize =
    options.externalSampleSize ?? DEFAULT_EXTERNAL_SAMPLE_SIZE;
  const externalConcurrency =
    options.externalConcurrency ?? DEFAULT_EXTERNAL_CONCURRENCY;

  const runId = createMediaHealthJobRun(metricDate, triggerType);
  options.logger?.info(
    {
      metricDate,
      triggerType,
      externalSampleSize,
      externalConcurrency,
      runId,
    },
    "media_health_snapshot_started",
  );

  try {
    const snapshot = await calculateMediaHealthMetrics(
      externalSampleSize,
      externalConcurrency,
    );

    snapshot.metricDate = metricDate;

    upsertMediaHealthDaily({
      metricDate,
      status: "success",
      previewCandidatesCount: snapshot.previewCandidatesCount,
      previewAliveCount: snapshot.previewAliveCount,
      previewMissingCount: snapshot.previewMissingCount,
      previewErrorCount: snapshot.previewErrorCount,
      previewAlivePercent: snapshot.previewAlivePercent,
      externalSampleRequested: snapshot.externalSampleRequested,
      externalCheckedWithSourceCount: snapshot.externalCheckedWithSourceCount,
      externalNoSourceCount: snapshot.externalNoSourceCount,
      externalAliveCount: snapshot.externalAliveCount,
      externalNoPreviewCount: snapshot.externalNoPreviewCount,
      externalErrorCount: snapshot.externalErrorCount,
      externalAlivePercent: snapshot.externalAlivePercent,
      hostStats: snapshot.hostStats,
      errorMessage: null,
    });

    finishMediaHealthJobRun(
      runId,
      "success",
      null,
      JSON.stringify({
        previewAlivePercent: snapshot.previewAlivePercent,
        externalAlivePercent: snapshot.externalAlivePercent,
        externalSampleRequested: snapshot.externalSampleRequested,
      }),
    );

    options.logger?.info(
      {
        metricDate,
        runId,
        previewAlivePercent: snapshot.previewAlivePercent,
        externalAlivePercent: snapshot.externalAlivePercent,
      },
      "media_health_snapshot_completed",
    );

    return snapshot;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown media health snapshot error";
    const existingRecord = getMediaHealthDailyByDate(metricDate);
    if (!existingRecord || existingRecord.status !== "success") {
      const failedSnapshot = buildFailedSnapshot(metricDate, errorMessage);
      upsertMediaHealthDaily({
        metricDate,
        status: "failed",
        previewCandidatesCount: failedSnapshot.previewCandidatesCount,
        previewAliveCount: failedSnapshot.previewAliveCount,
        previewMissingCount: failedSnapshot.previewMissingCount,
        previewErrorCount: failedSnapshot.previewErrorCount,
        previewAlivePercent: failedSnapshot.previewAlivePercent,
        externalSampleRequested: failedSnapshot.externalSampleRequested,
        externalCheckedWithSourceCount:
          failedSnapshot.externalCheckedWithSourceCount,
        externalNoSourceCount: failedSnapshot.externalNoSourceCount,
        externalAliveCount: failedSnapshot.externalAliveCount,
        externalNoPreviewCount: failedSnapshot.externalNoPreviewCount,
        externalErrorCount: failedSnapshot.externalErrorCount,
        externalAlivePercent: failedSnapshot.externalAlivePercent,
        hostStats: failedSnapshot.hostStats,
        errorMessage: failedSnapshot.errorMessage,
      });
    }

    finishMediaHealthJobRun(runId, "failed", errorMessage, null);
    options.logger?.error(
      {
        metricDate,
        runId,
        error: errorMessage,
      },
      "media_health_snapshot_failed",
    );

    throw error;
  }
}

export function getTodayMoscowDateKey(): string {
  return getMoscowDateKey();
}
