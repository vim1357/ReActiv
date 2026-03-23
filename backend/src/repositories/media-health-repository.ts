import { db } from "../db/connection";

export type MediaHealthDailyStatus = "success" | "failed";
export type MediaHealthRunStatus = "running" | "success" | "failed";

export interface MediaHealthHostStat {
  host: string;
  total: number;
  alive: number;
  noPreview: number;
  errors: number;
  alivePercent: number;
}

export interface UpsertMediaHealthDailyInput {
  metricDate: string;
  status: MediaHealthDailyStatus;
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

export interface MediaHealthDailyRecord {
  metricDate: string;
  status: MediaHealthDailyStatus;
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
  createdAt: string;
  updatedAt: string;
}

export interface MediaHealthJobRunRecord {
  id: number;
  metricDate: string;
  triggerType: string;
  status: MediaHealthRunStatus;
  errorMessage: string | null;
  detailsJson: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface MediaHealthDailyDbRow {
  metric_date: string;
  status: string;
  preview_candidates_count: number;
  preview_alive_count: number;
  preview_missing_count: number;
  preview_error_count: number;
  preview_alive_percent: number;
  external_sample_requested: number;
  external_checked_with_source_count: number;
  external_no_source_count: number;
  external_alive_count: number;
  external_no_preview_count: number;
  external_error_count: number;
  external_alive_percent: number;
  host_stats_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface MediaHealthJobRunDbRow {
  id: number;
  metric_date: string;
  trigger_type: string;
  status: string;
  error_message: string | null;
  details_json: string | null;
  started_at: string;
  finished_at: string | null;
}

function parseHostStats(raw: string): MediaHealthHostStat[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        host: String(item.host ?? ""),
        total: Number(item.total ?? 0),
        alive: Number(item.alive ?? 0),
        noPreview: Number(item.noPreview ?? 0),
        errors: Number(item.errors ?? 0),
        alivePercent: Number(item.alivePercent ?? 0),
      }))
      .filter((item) => item.host.length > 0);
  } catch {
    return [];
  }
}

function mapMediaHealthDailyRow(row: MediaHealthDailyDbRow): MediaHealthDailyRecord {
  return {
    metricDate: row.metric_date,
    status: row.status === "failed" ? "failed" : "success",
    previewCandidatesCount: row.preview_candidates_count,
    previewAliveCount: row.preview_alive_count,
    previewMissingCount: row.preview_missing_count,
    previewErrorCount: row.preview_error_count,
    previewAlivePercent: row.preview_alive_percent,
    externalSampleRequested: row.external_sample_requested,
    externalCheckedWithSourceCount: row.external_checked_with_source_count,
    externalNoSourceCount: row.external_no_source_count,
    externalAliveCount: row.external_alive_count,
    externalNoPreviewCount: row.external_no_preview_count,
    externalErrorCount: row.external_error_count,
    externalAlivePercent: row.external_alive_percent,
    hostStats: parseHostStats(row.host_stats_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMediaHealthJobRunRow(row: MediaHealthJobRunDbRow): MediaHealthJobRunRecord {
  return {
    id: row.id,
    metricDate: row.metric_date,
    triggerType: row.trigger_type,
    status:
      row.status === "running"
        ? "running"
        : row.status === "failed"
          ? "failed"
          : "success",
    errorMessage: row.error_message,
    detailsJson: row.details_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function upsertMediaHealthDaily(input: UpsertMediaHealthDailyInput): void {
  const nowIso = new Date().toISOString();
  const hostStatsJson = JSON.stringify(input.hostStats);

  db.prepare(
    `
      INSERT INTO media_health_daily (
        metric_date,
        status,
        preview_candidates_count,
        preview_alive_count,
        preview_missing_count,
        preview_error_count,
        preview_alive_percent,
        external_sample_requested,
        external_checked_with_source_count,
        external_no_source_count,
        external_alive_count,
        external_no_preview_count,
        external_error_count,
        external_alive_percent,
        host_stats_json,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(metric_date) DO UPDATE SET
        status = excluded.status,
        preview_candidates_count = excluded.preview_candidates_count,
        preview_alive_count = excluded.preview_alive_count,
        preview_missing_count = excluded.preview_missing_count,
        preview_error_count = excluded.preview_error_count,
        preview_alive_percent = excluded.preview_alive_percent,
        external_sample_requested = excluded.external_sample_requested,
        external_checked_with_source_count = excluded.external_checked_with_source_count,
        external_no_source_count = excluded.external_no_source_count,
        external_alive_count = excluded.external_alive_count,
        external_no_preview_count = excluded.external_no_preview_count,
        external_error_count = excluded.external_error_count,
        external_alive_percent = excluded.external_alive_percent,
        host_stats_json = excluded.host_stats_json,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.metricDate,
    input.status,
    input.previewCandidatesCount,
    input.previewAliveCount,
    input.previewMissingCount,
    input.previewErrorCount,
    input.previewAlivePercent,
    input.externalSampleRequested,
    input.externalCheckedWithSourceCount,
    input.externalNoSourceCount,
    input.externalAliveCount,
    input.externalNoPreviewCount,
    input.externalErrorCount,
    input.externalAlivePercent,
    hostStatsJson,
    input.errorMessage,
    nowIso,
    nowIso,
  );
}

export function getMediaHealthDailyByDate(metricDate: string): MediaHealthDailyRecord | null {
  const row = db
    .prepare(
      `
      SELECT *
      FROM media_health_daily
      WHERE metric_date = ?
      LIMIT 1
    `,
    )
    .get(metricDate) as MediaHealthDailyDbRow | undefined;

  if (!row) {
    return null;
  }

  return mapMediaHealthDailyRow(row);
}

export function listMediaHealthDaily(limit = 30): MediaHealthDailyRecord[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(120, Math.floor(limit))) : 30;
  const rows = db
    .prepare(
      `
      SELECT *
      FROM media_health_daily
      ORDER BY metric_date DESC
      LIMIT ?
    `,
    )
    .all(safeLimit) as MediaHealthDailyDbRow[];

  return rows.reverse().map(mapMediaHealthDailyRow);
}

export function createMediaHealthJobRun(
  metricDate: string,
  triggerType: string,
): number {
  const result = db
    .prepare(
      `
      INSERT INTO media_health_job_runs (
        metric_date,
        trigger_type,
        status,
        started_at
      )
      VALUES (?, ?, 'running', ?)
    `,
    )
    .run(metricDate, triggerType, new Date().toISOString());

  return Number(result.lastInsertRowid);
}

export function finishMediaHealthJobRun(
  id: number,
  status: Exclude<MediaHealthRunStatus, "running">,
  errorMessage: string | null,
  detailsJson: string | null,
): void {
  db.prepare(
    `
      UPDATE media_health_job_runs
      SET
        status = ?,
        error_message = ?,
        details_json = ?,
        finished_at = ?
      WHERE id = ?
    `,
  ).run(status, errorMessage, detailsJson, new Date().toISOString(), id);
}

export function listRecentMediaHealthJobRuns(limit = 20): MediaHealthJobRunRecord[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 20;
  const rows = db
    .prepare(
      `
      SELECT *
      FROM media_health_job_runs
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `,
    )
    .all(safeLimit) as MediaHealthJobRunDbRow[];

  return rows.map(mapMediaHealthJobRunRow);
}
