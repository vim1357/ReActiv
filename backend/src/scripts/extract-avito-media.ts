import fs from "node:fs/promises";
import path from "node:path";

interface InputItem {
  offerCode: string;
  url: string;
}

interface ExtractResultItem {
  offerCode: string;
  url: string;
  statusCode: number | null;
  blocked: boolean;
  mediaUrls: string[];
  error: string | null;
}

interface BulkUpdateResponse {
  acceptedItems: number;
  updatedRows: number;
}

interface ScriptOptions {
  inputPath: string | null;
  singleUrl: string | null;
  singleOfferCode: string;
  outputPath: string;
  concurrency: number;
  timeoutMs: number;
  userAgent: string;
  saveHtmlDir: string | null;
  updateApiBaseUrl: string | null;
  updateEndpoint: string;
  updateToken: string | null;
  updateBatchSize: number;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "data/avito-media-extract-result.json",
);

function resolveCliPath(rawPath: string | null): string | null {
  if (!rawPath) {
    return null;
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  // When script is executed via `npm --prefix backend ...`,
  // process.cwd() becomes `<repo>/backend`, while user usually passes
  // paths relative to the original shell directory.
  const baseDir = process.env.INIT_CWD?.trim() || process.cwd();
  return path.resolve(baseDir, rawPath);
}

function parseNumberArg(name: string, fallback: number): number {
  const inline = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (inline) {
    const parsedInline = Number(inline.slice(name.length + 3));
    if (!Number.isFinite(parsedInline) || parsedInline <= 0) {
      return fallback;
    }
    return Math.floor(parsedInline);
  }

  const standaloneIndex = process.argv.findIndex((item) => item === `--${name}`);
  if (standaloneIndex >= 0 && standaloneIndex + 1 < process.argv.length) {
    const parsedStandalone = Number(process.argv[standaloneIndex + 1]);
    if (!Number.isFinite(parsedStandalone) || parsedStandalone <= 0) {
      return fallback;
    }
    return Math.floor(parsedStandalone);
  }

  return fallback;
}

function parseStringArg(name: string): string | null {
  const inline = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (inline) {
    const valueInline = inline.slice(name.length + 3).trim();
    return valueInline || null;
  }

  const standaloneIndex = process.argv.findIndex((item) => item === `--${name}`);
  if (standaloneIndex >= 0 && standaloneIndex + 1 < process.argv.length) {
    const valueStandalone = process.argv[standaloneIndex + 1].trim();
    return valueStandalone || null;
  }

  return null;
}

function parseOptions(): ScriptOptions {
  const positionalArgs = process.argv
    .slice(2)
    .filter((value) => !value.startsWith("--"));
  const positionalUrl = positionalArgs[0] ?? null;
  const positionalOfferCode = positionalArgs[1] ?? null;
  const positionalOutPath = positionalArgs[2] ?? null;

  return {
    inputPath: resolveCliPath(parseStringArg("input")),
    singleUrl: parseStringArg("url") ?? positionalUrl,
    singleOfferCode:
      parseStringArg("offer-code") ?? positionalOfferCode ?? "single_offer",
    outputPath: parseStringArg("out") || positionalOutPath
      ? (resolveCliPath(parseStringArg("out") ?? positionalOutPath) as string)
      : DEFAULT_OUTPUT_PATH,
    concurrency: parseNumberArg("concurrency", 2),
    timeoutMs: parseNumberArg("timeout", 20_000),
    userAgent: parseStringArg("user-agent") ?? DEFAULT_USER_AGENT,
    saveHtmlDir: resolveCliPath(parseStringArg("save-html-dir")),
    updateApiBaseUrl: parseStringArg("update-api-base"),
    updateEndpoint: parseStringArg("update-endpoint") ?? "/admin/alpha-media/bulk-update",
    updateToken: parseStringArg("token") ?? process.env.ALPHA_MEDIA_SYNC_TOKEN ?? null,
    updateBatchSize: parseNumberArg("update-batch", 100),
  };
}

function validateOptions(options: ScriptOptions): void {
  const hasInput = Boolean(options.inputPath);
  const hasSingleUrl = Boolean(options.singleUrl);
  if (!hasInput && !hasSingleUrl) {
    throw new Error(
      "Provide --input=<file> or --url=<avito_url>. " +
        "Optional: --offer-code=<value> for single URL mode.",
    );
  }
}

function normalizeUrl(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function readInputItems(options: ScriptOptions): Promise<InputItem[]> {
  if (options.singleUrl) {
    const url = normalizeUrl(options.singleUrl);
    if (!url) {
      throw new Error("Invalid --url value");
    }

    return [
      {
        offerCode: options.singleOfferCode.trim() || "single_offer",
        url,
      },
    ];
  }

  const inputPath = path.resolve(process.cwd(), options.inputPath as string);
  const content = await fs.readFile(inputPath, "utf8");
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as Array<{
      offerCode?: unknown;
      offer_code?: unknown;
      url?: unknown;
      websiteUrl?: unknown;
      website_url?: unknown;
    }>;

    return parsed
      .map((item, index) => {
        const offerCodeRaw = item.offerCode ?? item.offer_code ?? `row_${index + 1}`;
        const urlRaw = item.url ?? item.websiteUrl ?? item.website_url ?? "";
        const url = normalizeUrl(String(urlRaw));
        return {
          offerCode: String(offerCodeRaw).trim(),
          url,
        };
      })
      .filter((item): item is InputItem => Boolean(item.offerCode && item.url));
  }

  // TXT/TSV/CSV fallback: each non-empty line is either:
  // - offerCode<tab>url
  // - offerCode;url
  // - just url
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: InputItem[] = [];
  lines.forEach((line, index) => {
    let offerCode = `row_${index + 1}`;
    let urlCandidate = line;

    if (line.includes("\t")) {
      const [left, right] = line.split("\t", 2);
      offerCode = left.trim() || offerCode;
      urlCandidate = right?.trim() ?? "";
    } else if (line.includes(";")) {
      const [left, right] = line.split(";", 2);
      offerCode = left.trim() || offerCode;
      urlCandidate = right?.trim() ?? "";
    }

    const url = normalizeUrl(urlCandidate);
    if (!url) {
      return;
    }

    items.push({ offerCode, url });
  });

  return items;
}

function extractJsonLdImageUrls(html: string): string[] {
  const urls: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null = scriptRegex.exec(html);
  while (match) {
    const raw = match[1]?.trim();
    if (!raw) {
      match = scriptRegex.exec(html);
      continue;
    }

    try {
      const payload = JSON.parse(raw) as unknown;
      const stack = [payload];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
          continue;
        }

        if (Array.isArray(current)) {
          current.forEach((item) => stack.push(item));
          continue;
        }

        const objectValue = current as Record<string, unknown>;
        const imageValue = objectValue.image;
        if (typeof imageValue === "string") {
          urls.push(imageValue);
        } else if (Array.isArray(imageValue)) {
          imageValue.forEach((item) => {
            if (typeof item === "string") {
              urls.push(item);
            }
          });
        }

        Object.values(objectValue).forEach((value) => stack.push(value));
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }

    match = scriptRegex.exec(html);
  }

  return urls;
}

function extractImageUrlsFromEscapedJson(html: string): string[] {
  const escapedUrlRegex =
    /https:\\\/\\\/[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)(?:\\\?[^"'\\\s]*)?/gi;

  const matches = html.match(escapedUrlRegex) ?? [];
  return matches.map((value) =>
    value.replace(/\\\//g, "/").replace(/\\u002F/gi, "/"),
  );
}

function extractImageUrlsByRegex(html: string): string[] {
  const directImageRegex =
    /https?:\/\/[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>]*)?/gi;
  return html.match(directImageRegex) ?? [];
}

function extractOgImageUrl(html: string): string[] {
  const match = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  );
  if (!match || !match[1]) {
    return [];
  }

  return [match[1]];
}

function filterImageUrls(urls: string[]): string[] {
  return unique(
    urls
      .map((raw) => raw.trim())
      .map((raw) => normalizeUrl(raw))
      .filter((value): value is string => Boolean(value)),
  );
}

function looksBlockedByCaptcha(html: string, statusCode: number): boolean {
  if (statusCode === 429 || statusCode === 403) {
    return true;
  }

  const normalized = html.toLowerCase();
  return (
    normalized.includes("доступ ограничен") ||
    normalized.includes("проблема с ip") ||
    normalized.includes("captcha") ||
    normalized.includes("капча")
  );
}

async function fetchHtml(url: string, timeoutMs: number, userAgent: string): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
      headers: {
        "user-agent": userAgent,
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractSingle(
  item: InputItem,
  options: ScriptOptions,
): Promise<ExtractResultItem> {
  try {
    const response = await fetchHtml(item.url, options.timeoutMs, options.userAgent);
    const html = await response.text();

    if (options.saveHtmlDir) {
      await fs.mkdir(options.saveHtmlDir, { recursive: true });
      const htmlPath = path.join(
        options.saveHtmlDir,
        `${sanitizeFileName(item.offerCode)}.html`,
      );
      await fs.writeFile(htmlPath, html);
    }

    const rawUrls = [
      ...extractJsonLdImageUrls(html),
      ...extractImageUrlsFromEscapedJson(html),
      ...extractImageUrlsByRegex(html),
      ...extractOgImageUrl(html),
    ];

    const mediaUrls = filterImageUrls(rawUrls);
    const blocked = looksBlockedByCaptcha(html, response.status);

    return {
      offerCode: item.offerCode,
      url: item.url,
      statusCode: response.status,
      blocked,
      mediaUrls,
      error: null,
    };
  } catch (error) {
    return {
      offerCode: item.offerCode,
      url: item.url,
      statusCode: null,
      blocked: false,
      mediaUrls: [],
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({
    length: Math.max(1, Math.min(concurrency, items.length)),
  }).map(async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  });

  await Promise.all(workers);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function maybeBulkUpdate(
  extracted: ExtractResultItem[],
  options: ScriptOptions,
): Promise<{ sent: number; updatedRows: number }> {
  if (!options.updateApiBaseUrl) {
    return { sent: 0, updatedRows: 0 };
  }

  if (!options.updateToken) {
    throw new Error(
      "Bulk update requested, but token is missing. Set --token=... or ALPHA_MEDIA_SYNC_TOKEN.",
    );
  }

  const updates = extracted
    .filter((item) => item.mediaUrls.length > 0)
    .map((item) => ({
      offerCode: item.offerCode,
      mediaUrls: item.mediaUrls,
    }));

  const chunks = chunkArray(updates, options.updateBatchSize);
  let updatedRowsTotal = 0;
  for (const chunk of chunks) {
    const response = await fetch(
      `${options.updateApiBaseUrl.replace(/\/+$/, "")}${options.updateEndpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reso-media-token": options.updateToken,
        },
        body: JSON.stringify({ items: chunk }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bulk update failed: status=${response.status}, body=${body}`);
    }

    const payload = (await response.json()) as BulkUpdateResponse;
    updatedRowsTotal += payload.updatedRows;
  }

  return {
    sent: updates.length,
    updatedRows: updatedRowsTotal,
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  validateOptions(options);

  const items = await readInputItems(options);
  if (items.length === 0) {
    throw new Error("No valid input items found");
  }

  const results: ExtractResultItem[] = [];
  let processed = 0;
  await runConcurrently(items, options.concurrency, async (item) => {
    const result = await extractSingle(item, options);
    results.push(result);
    processed += 1;

    if (processed % 10 === 0 || processed === items.length) {
      console.log(
        JSON.stringify({
          stage: "extract_progress",
          processed,
          total: items.length,
        }),
      );
    }
  });

  const sortedResults = [...results].sort((left, right) =>
    left.offerCode.localeCompare(right.offerCode),
  );
  const withMedia = sortedResults.filter((item) => item.mediaUrls.length > 0).length;
  const blockedCount = sortedResults.filter((item) => item.blocked).length;
  const errorCount = sortedResults.filter((item) => item.error !== null).length;

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(
    options.outputPath,
    JSON.stringify(
      {
        meta: {
          generatedAtUtc: new Date().toISOString(),
          total: sortedResults.length,
          withMedia,
          blockedCount,
          errorCount,
        },
        items: sortedResults,
      },
      null,
      2,
    ),
    "utf8",
  );

  const bulkUpdateResult = await maybeBulkUpdate(sortedResults, options);

  console.log(
    JSON.stringify({
      stage: "done",
      outputPath: options.outputPath,
      total: sortedResults.length,
      withMedia,
      blockedCount,
      errorCount,
      bulkUpdateSent: bulkUpdateResult.sent,
      bulkUpdatedRows: bulkUpdateResult.updatedRows,
    }),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      stage: "failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }),
  );
  process.exitCode = 1;
});
