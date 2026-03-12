const RESO_API_URL = "https://admin.resoleasing.com/api/sales-catalog";
const DEFAULT_APP_API_BASE_URL = "https://api.reactiv.pro/api";
const DEFAULT_CANDIDATE_LIMIT = 10000;
const DEFAULT_FETCH_CONCURRENCY = 6;
const DEFAULT_UPDATE_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 12000;

interface CandidateResponse {
  items: Array<{ offerCode: string; hasMedia: boolean }>;
  total: number;
}

interface ResoCardResponse {
  photos?: {
    ORIGINAL?: Array<string | null>;
    BIG?: Array<string | null>;
  };
}

interface BulkUpdateResponse {
  acceptedItems: number;
  updatedRows: number;
}

function parseNumberArg(name: string, fallback: number): number {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) {
    return fallback;
  }
  const parsed = Number(arg.split("=")[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizePhotoUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("/")) {
    return `https://api-sale.resoleasing.com${value}`;
  }
  return `https://api-sale.resoleasing.com/${value}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }).map(
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]);
      }
    },
  );

  await Promise.all(workers);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function main(): Promise<void> {
  const token = process.env.RESO_MEDIA_SYNC_TOKEN?.trim();
  if (!token) {
    throw new Error("RESO_MEDIA_SYNC_TOKEN env var is required");
  }

  const appApiBaseUrl = (process.env.REACTIV_API_BASE_URL ?? DEFAULT_APP_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const limit = parseNumberArg("limit", DEFAULT_CANDIDATE_LIMIT);
  const concurrency = parseNumberArg("concurrency", DEFAULT_FETCH_CONCURRENCY);
  const batchSize = parseNumberArg("batch", DEFAULT_UPDATE_BATCH_SIZE);

  const candidatesUrl = new URL(`${appApiBaseUrl}/admin/reso-media/candidates`);
  candidatesUrl.searchParams.set("onlyMissingMedia", "true");
  candidatesUrl.searchParams.set("limit", String(limit));

  const candidateResponse = await fetchWithTimeout(
    candidatesUrl.toString(),
    {
      method: "GET",
      headers: {
        "x-reso-media-token": token,
      },
    },
    DEFAULT_TIMEOUT_MS,
  );
  if (!candidateResponse.ok) {
    throw new Error(`Failed to fetch candidates: ${candidateResponse.status}`);
  }

  const candidatesPayload = (await candidateResponse.json()) as CandidateResponse;
  const candidates = candidatesPayload.items.map((item) => item.offerCode.trim().toUpperCase());

  let fetchErrorCount = 0;
  let noMediaCount = 0;
  const updates: Array<{ offerCode: string; mediaUrls: string[] }> = [];

  await runConcurrently(candidates, concurrency, async (offerCode) => {
    const resoUrl = new URL(RESO_API_URL);
    resoUrl.searchParams.set("vin", offerCode);

    try {
      const response = await fetchWithTimeout(
        resoUrl.toString(),
        { method: "GET" },
        DEFAULT_TIMEOUT_MS,
      );
      if (!response.ok) {
        fetchErrorCount += 1;
        return;
      }

      const payload = (await response.json()) as ResoCardResponse;
      const mediaUrls = [
        ...(payload.photos?.ORIGINAL ?? []),
        ...(payload.photos?.BIG ?? []),
      ]
        .map((value) => normalizePhotoUrl(value))
        .filter((value): value is string => Boolean(value));
      const uniqueUrls = [...new Set(mediaUrls)]
        .filter((value) => isValidHttpUrl(value))
        .slice(0, 200);

      if (uniqueUrls.length === 0) {
        noMediaCount += 1;
        return;
      }

      updates.push({
        offerCode,
        mediaUrls: uniqueUrls,
      });
    } catch {
      fetchErrorCount += 1;
    }
  });

  const chunks = chunkArray(updates, batchSize);
  let updatedRowsTotal = 0;
  let failedItems = 0;

  const sendBulkUpdate = async (
    items: Array<{ offerCode: string; mediaUrls: string[] }>,
  ): Promise<BulkUpdateResponse> => {
    const bulkUpdateResponse = await fetchWithTimeout(
      `${appApiBaseUrl}/admin/reso-media/bulk-update`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reso-media-token": token,
        },
        body: JSON.stringify({ items }),
      },
      DEFAULT_TIMEOUT_MS,
    );

    if (!bulkUpdateResponse.ok) {
      const body = await bulkUpdateResponse.text();
      throw new Error(`Failed bulk update: ${bulkUpdateResponse.status} body=${body}`);
    }

    return (await bulkUpdateResponse.json()) as BulkUpdateResponse;
  };

  for (const chunk of chunks) {
    try {
      const payload = await sendBulkUpdate(chunk);
      updatedRowsTotal += payload.updatedRows;
      continue;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      // eslint-disable-next-line no-console
      console.error("reso_media_sync_chunk_failed", {
        chunkSize: chunk.length,
        error: message,
      });
    }

    for (const item of chunk) {
      try {
        const payload = await sendBulkUpdate([item]);
        updatedRowsTotal += payload.updatedRows;
      } catch (error) {
        failedItems += 1;
        // eslint-disable-next-line no-console
        console.error("reso_media_sync_item_failed", {
          offerCode: item.offerCode,
          urls: item.mediaUrls.length,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log("reso_media_sync_result", {
    candidatesTotal: candidates.length,
    updatesPrepared: updates.length,
    noMediaCount,
    fetchErrorCount,
    updatedRowsTotal,
    failedItems,
    batchesSent: chunks.length,
    appApiBaseUrl,
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown_error";
  // eslint-disable-next-line no-console
  console.error("reso_media_sync_failed", { error: message });
  process.exitCode = 1;
});
