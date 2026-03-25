import { Readable } from "node:stream";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import {
  parseStoredPreviewSourceUrl,
  resolveStoredMediaAbsolutePath,
} from "../services/local-media-storage";
import {
  isAllowedMediaRemoteUrl,
  resolveGalleryUrls,
  resolvePreviewUrl,
} from "../services/media-preview-service";

const PREVIEW_MIN_WIDTH = 160;
const PREVIEW_MAX_WIDTH = 640;

function parseRequestedPreviewWidth(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const width = Math.floor(parsed);
  if (width < PREVIEW_MIN_WIDTH) {
    return PREVIEW_MIN_WIDTH;
  }
  if (width >= PREVIEW_MAX_WIDTH) {
    return null;
  }

  return width;
}

function buildVariantPreviewAbsolutePath(
  sourceAbsolutePath: string,
  width: number,
): string {
  const sourceParsed = path.parse(sourceAbsolutePath);
  const extension = sourceParsed.ext || ".jpg";
  return path.join(sourceParsed.dir, `${sourceParsed.name}.w${width}${extension}`);
}

async function ensurePreviewVariantAbsolutePath(
  sourceAbsolutePath: string,
  width: number | null,
): Promise<string> {
  if (!width) {
    return sourceAbsolutePath;
  }

  const variantAbsolutePath = buildVariantPreviewAbsolutePath(sourceAbsolutePath, width);

  const sourceStats = await fsPromises.stat(sourceAbsolutePath);
  let variantStats: fs.Stats | null = null;

  try {
    variantStats = await fsPromises.stat(variantAbsolutePath);
  } catch {
    variantStats = null;
  }

  if (variantStats && variantStats.isFile() && variantStats.size > 0) {
    if (variantStats.mtimeMs >= sourceStats.mtimeMs) {
      return variantAbsolutePath;
    }
  }

  await sharp(sourceAbsolutePath)
    .rotate()
    .resize({
      width,
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 70,
      mozjpeg: true,
      progressive: true,
    })
    .toFile(variantAbsolutePath);

  return variantAbsolutePath;
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/media/card-preview", async (request, reply) => {
    const query = request.query as { path?: string; w?: string };
    const relativePath = query.path?.trim();
    const requestedWidth = parseRequestedPreviewWidth(query.w);

    if (!relativePath) {
      return reply.code(400).send({ message: "path is required" });
    }

    try {
      const absolutePath = resolveStoredMediaAbsolutePath(relativePath);
      if (!fs.existsSync(absolutePath)) {
        return reply.code(404).send({ message: "stored preview not found" });
      }

      const servedAbsolutePath = await ensurePreviewVariantAbsolutePath(
        absolutePath,
        requestedWidth,
      );
      const stats = fs.statSync(servedAbsolutePath);
      if (!stats.isFile() || stats.size <= 0) {
        return reply.code(404).send({ message: "stored preview is empty" });
      }

      reply
        .code(200)
        .header("Content-Type", "image/jpeg")
        .header("Content-Length", stats.size.toString())
        .header("Last-Modified", stats.mtime.toUTCString())
        .header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

      return reply.send(fs.createReadStream(servedAbsolutePath));
    } catch {
      return reply.code(400).send({ message: "invalid stored preview path" });
    }
  });

  app.get("/api/media/preview", async (request, reply) => {
    const query = request.query as { url?: string };
    const sourceUrl = query.url?.trim();

    if (!sourceUrl) {
      return reply.code(400).send({ message: "url is required" });
    }

    const result = await resolvePreviewUrl(sourceUrl);
    return reply.code(200).send(result);
  });

  app.get("/api/media/preview-image", async (request, reply) => {
    const query = request.query as { url?: string; w?: string };
    const sourceUrl = query.url?.trim();
    const requestedWidth = parseRequestedPreviewWidth(query.w);

    if (!sourceUrl) {
      return reply.code(400).send({ message: "url is required" });
    }

    const storedPreviewRelativePath = parseStoredPreviewSourceUrl(sourceUrl);
    if (storedPreviewRelativePath) {
      try {
        const absolutePath = resolveStoredMediaAbsolutePath(storedPreviewRelativePath);
        if (!fs.existsSync(absolutePath)) {
          return reply.code(404).send({ message: "stored preview not found" });
        }

        const servedAbsolutePath = await ensurePreviewVariantAbsolutePath(
          absolutePath,
          requestedWidth,
        );
        const stats = fs.statSync(servedAbsolutePath);
        if (!stats.isFile() || stats.size <= 0) {
          return reply.code(404).send({ message: "stored preview is empty" });
        }

        reply
          .code(200)
          .header("Content-Type", "image/jpeg")
          .header("Content-Length", stats.size.toString())
          .header("Last-Modified", stats.mtime.toUTCString())
          .header(
            "Cache-Control",
            "public, max-age=86400, stale-while-revalidate=604800",
          );

        return reply.send(fs.createReadStream(servedAbsolutePath));
      } catch {
        return reply.code(400).send({ message: "invalid stored preview path" });
      }
    }

    const resolved = await resolvePreviewUrl(sourceUrl);
    if (!resolved.previewUrl) {
      return reply.code(404).send({ message: "preview not found" });
    }
    if (!isAllowedMediaRemoteUrl(resolved.previewUrl)) {
      return reply.code(400).send({ message: "unsupported preview source" });
    }

    try {
      const imageResponse = await fetch(resolved.previewUrl, { method: "GET" });
      if (!imageResponse.ok) {
        return reply.code(404).send({ message: "preview fetch failed" });
      }

      const contentType =
        imageResponse.headers.get("content-type") ?? "image/jpeg";
      const cacheControl =
        imageResponse.headers.get("cache-control") ??
        "public, max-age=1800, stale-while-revalidate=86400";
      const contentLength = imageResponse.headers.get("content-length");
      const etag = imageResponse.headers.get("etag");
      const lastModified = imageResponse.headers.get("last-modified");
      const responseBody = imageResponse.body;

      if (!responseBody) {
        return reply.code(502).send({ message: "preview body missing" });
      }

      reply
        .code(200)
        .header("Content-Type", contentType)
        .header("Cache-Control", cacheControl);

      if (contentLength) {
        reply.header("Content-Length", contentLength);
      }
      if (etag) {
        reply.header("ETag", etag);
      }
      if (lastModified) {
        reply.header("Last-Modified", lastModified);
      }

      return reply.send(Readable.fromWeb(responseBody as any));
    } catch {
      return reply.code(500).send({ message: "preview fetch failed" });
    }
  });

  app.get("/api/media/gallery", async (request, reply) => {
    const query = request.query as { url?: string };
    const sourceUrl = query.url?.trim();

    if (!sourceUrl) {
      return reply.code(400).send({ message: "url is required" });
    }

    const result = await resolveGalleryUrls(sourceUrl);
    return reply
      .code(200)
      .header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
      .send(result);
  });
}
