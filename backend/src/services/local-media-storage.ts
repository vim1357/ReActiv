import fs from "node:fs";
import path from "node:path";

const STORED_PREVIEW_PREFIX = "stored-preview:";

function resolveMediaStorageRoot(): string {
  const configured = process.env.MEDIA_STORAGE_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  return path.resolve(process.cwd(), "data/media");
}

const mediaStorageRoot = resolveMediaStorageRoot();

function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function encodeOfferCodeForFileName(offerCode: string): string {
  return Buffer.from(offerCode, "utf8").toString("base64url");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function ensureMediaStorageRoot(): void {
  ensureDirectoryExists(mediaStorageRoot);
}

export function buildCardPreviewRelativePath(tenantId: string, offerCode: string): string {
  return normalizeRelativePath(
    path.posix.join("card-previews", tenantId, `${encodeOfferCodeForFileName(offerCode)}.jpg`),
  );
}

export function resolveStoredMediaAbsolutePath(relativePath: string): string {
  ensureMediaStorageRoot();

  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(mediaStorageRoot, normalizedRelativePath);
  const relativeFromRoot = path.relative(mediaStorageRoot, absolutePath);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error("Invalid media path");
  }

  return absolutePath;
}

export function ensureStoredMediaParentDirectory(relativePath: string): string {
  const absolutePath = resolveStoredMediaAbsolutePath(relativePath);
  ensureDirectoryExists(path.dirname(absolutePath));
  return absolutePath;
}

export function buildStoredPreviewSourceUrl(relativePath: string): string {
  return `${STORED_PREVIEW_PREFIX}${normalizeRelativePath(relativePath)}`;
}

export function parseStoredPreviewSourceUrl(sourceUrl: string): string | null {
  if (!sourceUrl.startsWith(STORED_PREVIEW_PREFIX)) {
    return null;
  }

  const relativePath = normalizeRelativePath(
    sourceUrl.slice(STORED_PREVIEW_PREFIX.length).trim(),
  );

  return relativePath || null;
}

export function storedMediaFileExists(relativePath: string | null): boolean {
  if (!relativePath) {
    return false;
  }

  try {
    return fs.existsSync(resolveStoredMediaAbsolutePath(relativePath));
  } catch {
    return false;
  }
}
