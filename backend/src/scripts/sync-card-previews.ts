import fs from "node:fs/promises";
import sharp from "sharp";
import { initializeSchema } from "../db/schema";
import {
  buildCardPreviewRelativePath,
  ensureMediaStorageRoot,
  ensureStoredMediaParentDirectory,
  storedMediaFileExists,
} from "../services/local-media-storage";
import { resolvePreviewUrl } from "../services/media-preview-service";
import {
  listVehicleOfferMediaCandidatesByTenant,
  updateVehicleOfferCardPreviewPathsByOfferCode,
  type VehicleOfferMediaCandidate,
} from "../repositories/vehicle-offer-repository";

const KNOWN_TENANTS = ["gpb", "reso", "alpha"] as const;
const DEFAULT_LIMIT = 500;
const DEFAULT_CONCURRENCY = 4;
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 480;
const FETCH_TIMEOUT_MS = 20_000;

interface SyncOptions {
  tenantIds: string[];
  limit: number;
  concurrency: number;
  force: boolean;
}

interface PreviewSyncCandidate extends VehicleOfferMediaCandidate {
  previewSourceUrl: string | null;
}

function parseOptions(argv: string[]): SyncOptions {
  const options: SyncOptions = {
    tenantIds: [...KNOWN_TENANTS],
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    force: false,
  };

  argv.forEach((argument) => {
    if (argument.startsWith("--tenant=")) {
      const value = argument.slice("--tenant=".length).trim();
      options.tenantIds = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return;
    }

    if (argument.startsWith("--limit=")) {
      const value = Number(argument.slice("--limit=".length));
      if (Number.isFinite(value) && value > 0) {
        options.limit = Math.floor(value);
      }
      return;
    }

    if (argument.startsWith("--concurrency=")) {
      const value = Number(argument.slice("--concurrency=".length));
      if (Number.isFinite(value) && value > 0) {
        options.concurrency = Math.max(1, Math.floor(value));
      }
      return;
    }

    if (argument === "--force") {
      options.force = true;
    }
  });

  if (options.tenantIds.length === 0) {
    options.tenantIds = [...KNOWN_TENANTS];
  }

  return options;
}

function extractPreviewSourceUrl(rawValue: string | null): string | null {
  const trimmed = rawValue?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const matches = trimmed.match(/https?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);

  if (cleaned.length > 0) {
    return cleaned[0];
  }

  return trimmed;
}

function buildCandidates(options: SyncOptions): PreviewSyncCandidate[] {
  const candidates: PreviewSyncCandidate[] = [];

  options.tenantIds.forEach((tenantId) => {
    const rows = listVehicleOfferMediaCandidatesByTenant(tenantId);
    rows.forEach((row) => {
      if (!options.force && row.cardPreviewPath && storedMediaFileExists(row.cardPreviewPath)) {
        return;
      }

      const previewSourceUrl = extractPreviewSourceUrl(row.yandexDiskUrl);
      if (!previewSourceUrl) {
        return;
      }

      candidates.push({
        ...row,
        previewSourceUrl,
      });
    });
  });

  return candidates.slice(0, options.limit);
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

async function createThumbnailBuffer(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .rotate()
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
      fit: "cover",
      position: "entropy",
      withoutEnlargement: false,
    })
    .jpeg({
      quality: 72,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer();
}

async function processCandidate(candidate: PreviewSyncCandidate): Promise<{
  tenantId: string;
  offerCode: string;
  relativePath: string;
} | null> {
  try {
    const resolved = await resolvePreviewUrl(candidate.previewSourceUrl ?? "");
    if (!resolved.previewUrl) {
      console.log("card_preview_skip_no_preview", {
        tenantId: candidate.tenantId,
        offerCode: candidate.offerCode,
      });
      return null;
    }

    const originalBuffer = await fetchBuffer(resolved.previewUrl);
    const thumbnailBuffer = await createThumbnailBuffer(originalBuffer);
    const relativePath = buildCardPreviewRelativePath(
      candidate.tenantId,
      candidate.offerCode,
    );
    const absolutePath = ensureStoredMediaParentDirectory(relativePath);
    await fs.writeFile(absolutePath, thumbnailBuffer);

    return {
      tenantId: candidate.tenantId,
      offerCode: candidate.offerCode,
      relativePath,
    };
  } catch (error) {
    console.log("card_preview_sync_failed", {
      tenantId: candidate.tenantId,
      offerCode: candidate.offerCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

async function main(): Promise<void> {
  initializeSchema();
  ensureMediaStorageRoot();

  const options = parseOptions(process.argv.slice(2));
  const candidates = buildCandidates(options);

  const updatesByTenant = new Map<string, Array<{ offerCode: string; cardPreviewPath: string }>>();
  let processed = 0;

  let currentIndex = 0;
  async function worker(): Promise<void> {
    while (currentIndex < candidates.length) {
      const candidate = candidates[currentIndex];
      currentIndex += 1;

      const result = await processCandidate(candidate);
      processed += 1;

      if (processed % 25 === 0 || processed === candidates.length) {
        console.log("card_preview_sync_progress", {
          processed,
          total: candidates.length,
        });
      }

      if (!result) {
        continue;
      }

      if (!updatesByTenant.has(result.tenantId)) {
        updatesByTenant.set(result.tenantId, []);
      }

      updatesByTenant.get(result.tenantId)?.push({
        offerCode: result.offerCode,
        cardPreviewPath: result.relativePath,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, Math.max(candidates.length, 1)) }, () =>
      worker(),
    ),
  );

  let updatedRowsTotal = 0;
  updatesByTenant.forEach((updates, tenantId) => {
    updatedRowsTotal += updateVehicleOfferCardPreviewPathsByOfferCode(
      tenantId,
      updates,
    );
  });

  console.log("card_preview_sync_result", {
    tenantIds: options.tenantIds,
    candidatesTotal: candidates.length,
    updatedRowsTotal,
    tenantsUpdated: Array.from(updatesByTenant.keys()),
    force: options.force,
  });
}

void main().catch((error) => {
  console.log("card_preview_sync_failed", {
    error: error instanceof Error ? error.message : "unknown_error",
  });
  process.exitCode = 1;
});
