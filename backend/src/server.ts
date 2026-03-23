import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { initializeSchema } from "./db/schema";
import { registerAdminUserRoutes } from "./routes/admin-user-routes";
import { registerAdminAlphaMediaRoutes } from "./routes/admin-alpha-media-routes";
import { registerAdminHighlightsRoutes } from "./routes/admin-highlights-routes";
import { registerAdminResoMediaRoutes } from "./routes/admin-reso-media-routes";
import { registerActivityRoutes } from "./routes/activity-routes";
import { registerAuthRoutes } from "./routes/auth-routes";
import { registerCatalogRoutes } from "./routes/catalog-routes";
import { registerImportRoutes } from "./routes/import-routes";
import { registerMediaRoutes } from "./routes/media-routes";
import { registerPlatformRoutes } from "./routes/platform-routes";
import { registerShareRoutes } from "./routes/share-routes";
import { registerFavoriteRoutes } from "./routes/favorite-routes";
import { registerSitemapRoutes } from "./routes/sitemap-routes";
import { registerSiteVerificationRoutes } from "./routes/site-verification-routes";
import { getPlatformMode } from "./repositories/platform-settings-repository";
import { authenticateRequest } from "./services/auth-service";
import { ensureBootstrapAdmin } from "./startup/bootstrap-admin";
import { startMediaHealthScheduler } from "./services/media-health-scheduler";

const app = Fastify({
  logger: true,
  bodyLimit: 20 * 1024 * 1024,
});

app.get("/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const ALWAYS_PUBLIC_PATHS = new Set([
  "/",
  "/landing",
  "/showcase",
  "/health",
  "/sitemap.xml",
  "/api/auth/login",
  "/api/platform/mode",
  "/api/public/activity/events",
  "/api/admin/reso-media/candidates",
  "/api/admin/reso-media/bulk-update",
  "/api/admin/alpha-media/candidates",
  "/api/admin/alpha-media/bulk-update",
]);
const ALWAYS_PUBLIC_PREFIXES = ["/showcase/"];
const ALWAYS_PUBLIC_DYNAMIC_PREFIXES = ["/sitemaps/"];

const OPEN_MODE_PUBLIC_PREFIXES = [
  "/api/catalog/summary",
  "/api/catalog/items",
  "/api/catalog/filters",
  "/api/media/preview",
  "/api/media/preview-image",
  "/api/media/card-preview",
  "/api/media/gallery",
];

function isOpenModePublicPath(requestPath: string): boolean {
  return OPEN_MODE_PUBLIC_PREFIXES.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`),
  );
}

initializeSchema();
ensureBootstrapAdmin(app.log);

async function startServer(): Promise<void> {
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });
  await registerAuthRoutes(app);
  await registerPlatformRoutes(app);

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }

    const requestPath = request.raw.url?.split("?")[0] ?? "";
    if (ALWAYS_PUBLIC_PATHS.has(requestPath)) {
      return;
    }
    if (ALWAYS_PUBLIC_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
      return;
    }
    if (ALWAYS_PUBLIC_DYNAMIC_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
      return;
    }
    if (
      requestPath.startsWith("/yandex_") &&
      requestPath.endsWith(".html")
    ) {
      return;
    }

    if (isOpenModePublicPath(requestPath) && getPlatformMode() === "open") {
      return;
    }

    const authUser = authenticateRequest(request);
    if (!authUser) {
      return reply.code(401).send({ message: "Требуется авторизация" });
    }

    request.authUser = authUser;
  });

  await registerImportRoutes(app);
  await registerCatalogRoutes(app);
  await registerFavoriteRoutes(app);
  await registerMediaRoutes(app);
  await registerShareRoutes(app);
  await registerSitemapRoutes(app);
  await registerSiteVerificationRoutes(app);
  await registerAdminUserRoutes(app);
  await registerAdminHighlightsRoutes(app);
  await registerAdminResoMediaRoutes(app);
  await registerAdminAlphaMediaRoutes(app);
  await registerActivityRoutes(app);

  try {
    await app.listen({ port, host });
    startMediaHealthScheduler(app.log);
    app.log.info({ port, host }, "Server started");
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void startServer();
