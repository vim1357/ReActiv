import { Readable } from "node:stream";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import {
  parseStoredPreviewSourceUrl,
  resolveStoredMediaAbsolutePath,
} from "../services/local-media-storage";
import {
  resolveGalleryUrls,
  resolvePreviewUrl,
} from "../services/media-preview-service";

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/media/card-preview", async (request, reply) => {
    const query = request.query as { path?: string };
    const relativePath = query.path?.trim();

    if (!relativePath) {
      return reply.code(400).send({ message: "path is required" });
    }

    try {
      const absolutePath = resolveStoredMediaAbsolutePath(relativePath);
      if (!fs.existsSync(absolutePath)) {
        return reply.code(404).send({ message: "stored preview not found" });
      }

      const stats = fs.statSync(absolutePath);
      reply
        .code(200)
        .header("Content-Type", "image/jpeg")
        .header("Content-Length", stats.size.toString())
        .header("Last-Modified", stats.mtime.toUTCString())
        .header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

      return reply.send(fs.createReadStream(absolutePath));
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
    const query = request.query as { url?: string };
    const sourceUrl = query.url?.trim();

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

        const stats = fs.statSync(absolutePath);
        reply
          .code(200)
          .header("Content-Type", "image/jpeg")
          .header("Content-Length", stats.size.toString())
          .header("Last-Modified", stats.mtime.toUTCString())
          .header(
            "Cache-Control",
            "public, max-age=86400, stale-while-revalidate=604800",
          );

        return reply.send(fs.createReadStream(absolutePath));
      } catch {
        return reply.code(400).send({ message: "invalid stored preview path" });
      }
    }

    const resolved = await resolvePreviewUrl(sourceUrl);
    if (!resolved.previewUrl) {
      return reply.code(404).send({ message: "preview not found" });
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
