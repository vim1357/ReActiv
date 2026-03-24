import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { initializeSchema } from "./db/schema";
import { registerAdminUserRoutes } from "./routes/admin-user-routes";
import { registerAdminAlphaMediaRoutes } from "./routes/admin-alpha-media-routes";
import { registerAdminCatalogExportRoutes } from "./routes/admin-catalog-export-routes";
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
import { authenticateRequest, getCsrfHeaderName, hasValidCsrfToken } from "./services/auth-service";
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
const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://reactiv.pro",
  "https://www.reactiv.pro",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const DEFAULT_CSP_REPORT_ONLY_POLICY = [
  "default-src 'self' https: data: blob:",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
].join("; ");
const CSP_REPORT_ENDPOINT_PATH = "/api/security/csp-report";
const BASE_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

const ALWAYS_PUBLIC_PATHS = new Set([
  "/",
  "/landing",
  "/showcase",
  "/health",
  "/sitemap.xml",
  CSP_REPORT_ENDPOINT_PATH,
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

function normalizeOriginValue(rawOrigin: string): string | null {
  const value = rawOrigin.trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveAllowedCorsOrigins(): Set<string> {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const source = configuredOrigins?.length
    ? configuredOrigins
    : DEFAULT_ALLOWED_CORS_ORIGINS;

  const normalizedOrigins = source
    .map(normalizeOriginValue)
    .filter((value): value is string => Boolean(value));

  return new Set(normalizedOrigins);
}

function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: Set<string>,
): boolean {
  // Requests without Origin are typically same-origin or non-browser clients.
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOriginValue(origin);
  if (!normalizedOrigin) {
    return false;
  }

  return allowedOrigins.has(normalizedOrigin);
}

function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function resolveCspReportOnlyPolicy(): string {
  const configuredPolicy = process.env.CSP_REPORT_ONLY_POLICY?.trim();
  if (configuredPolicy) {
    return configuredPolicy;
  }

  return DEFAULT_CSP_REPORT_ONLY_POLICY;
}

function resolveCspEnforcePolicy(reportOnlyPolicy: string): string {
  const configuredPolicy = process.env.CSP_ENFORCE_POLICY?.trim();
  if (configuredPolicy) {
    return configuredPolicy;
  }

  return reportOnlyPolicy;
}

function enrichCspPolicyWithReportUri(policy: string, reportPath: string, enabled: boolean): string {
  if (!enabled) {
    return policy;
  }

  const normalized = policy.toLowerCase();
  if (normalized.includes("report-uri") || normalized.includes("report-to")) {
    return policy;
  }

  const basePolicy = policy.trim().replace(/;+\s*$/u, "");
  return `${basePolicy}; report-uri ${reportPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function sanitizeUrlForLog(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.slice(0, 300);
  }
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const resolved = asString(record[key]);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function mapLegacyCspReport(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !isRecord(payload["csp-report"])) {
    return null;
  }

  const report = payload["csp-report"];
  return {
    source: "legacy",
    documentUri: sanitizeUrlForLog(report["document-uri"]),
    blockedUri: sanitizeUrlForLog(report["blocked-uri"]),
    effectiveDirective: asString(report["effective-directive"]),
    violatedDirective: asString(report["violated-directive"]),
    disposition: asString(report.disposition),
    statusCode: Number.isFinite(Number(report["status-code"]))
      ? Number(report["status-code"])
      : null,
  };
}

function mapReportingApiCspReports(payload: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(payload)) {
    return [];
  }

  const result: Array<Record<string, unknown>> = [];
  payload.forEach((entry) => {
    if (!isRecord(entry) || entry.type !== "csp-violation" || !isRecord(entry.body)) {
      return;
    }

    const body = entry.body;
    result.push({
      source: "reporting-api",
      documentUri: sanitizeUrlForLog(pickFirstString(body, ["documentURL", "document-uri"])),
      blockedUri: sanitizeUrlForLog(pickFirstString(body, ["blockedURL", "blocked-uri"])),
      effectiveDirective: pickFirstString(body, ["effectiveDirective", "effective-directive"]),
      violatedDirective: pickFirstString(body, ["violatedDirective", "violated-directive"]),
      disposition: asString(body.disposition),
      statusCode: Number.isFinite(Number(body.statusCode)) ? Number(body.statusCode) : null,
    });
  });

  return result;
}

initializeSchema();
ensureBootstrapAdmin(app.log);

async function startServer(): Promise<void> {
  const allowedCorsOrigins = resolveAllowedCorsOrigins();
  const cspReportEndpointEnabled = parseBooleanEnv("CSP_REPORT_ENDPOINT_ENABLED", true);
  const cspEnforceEnabled = parseBooleanEnv("CSP_ENFORCE_ENABLED", false);
  const cspReportOnlyPolicy = enrichCspPolicyWithReportUri(
    resolveCspReportOnlyPolicy(),
    CSP_REPORT_ENDPOINT_PATH,
    cspReportEndpointEnabled,
  );
  const cspEnforcePolicy = enrichCspPolicyWithReportUri(
    resolveCspEnforcePolicy(cspReportOnlyPolicy),
    CSP_REPORT_ENDPOINT_PATH,
    cspReportEndpointEnabled,
  );
  const csrfProtectionEnabled = parseBooleanEnv("CSRF_PROTECTION_ENABLED", true);

  await app.register(cors, {
    origin(origin, cb) {
      const allowed = isAllowedCorsOrigin(origin, allowedCorsOrigins);
      if (!allowed && origin) {
        app.log.warn({ origin }, "cors_origin_blocked");
      }

      cb(null, allowed);
    },
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
  app.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "string" },
    (_request, body, done) => {
      if (typeof body !== "string") {
        done(null, {});
        return;
      }

      const normalized = body.trim();
      if (!normalized) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(normalized));
      } catch {
        done(null, { rawBody: normalized.slice(0, 2000) });
      }
    },
  );
  await registerAuthRoutes(app);
  await registerPlatformRoutes(app);

  app.post(CSP_REPORT_ENDPOINT_PATH, async (request, reply) => {
    if (!cspReportEndpointEnabled) {
      return reply.code(404).send({ message: "Not found" });
    }

    const legacyReport = mapLegacyCspReport(request.body);
    const reportingApiReports = mapReportingApiCspReports(request.body);
    const reports = [
      ...(legacyReport ? [legacyReport] : []),
      ...reportingApiReports,
    ];

    if (reports.length === 0) {
      app.log.info(
        { contentType: request.headers["content-type"] ?? null },
        "csp_report_received_unparsed",
      );
      return reply.code(204).send();
    }

    reports.forEach((report) => {
      app.log.info(report, "csp_violation_report");
    });

    return reply.code(204).send();
  });

  app.log.info(
    { csrfProtectionEnabled, cspReportEndpointEnabled, cspEnforceEnabled },
    "security_runtime_config",
  );

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", BASE_PERMISSIONS_POLICY);
    if (cspEnforceEnabled) {
      reply.header("Content-Security-Policy", cspEnforcePolicy);
    } else {
      reply.header("Content-Security-Policy-Report-Only", cspReportOnlyPolicy);
    }

    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    return payload;
  });

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

    if (
      csrfProtectionEnabled &&
      isStateChangingMethod(request.method) &&
      !hasValidCsrfToken(request)
    ) {
      return reply.code(403).send({
        message: `Invalid CSRF token. Send header ${getCsrfHeaderName()}.`,
      });
    }
  });

  await registerImportRoutes(app);
  await registerCatalogRoutes(app);
  await registerFavoriteRoutes(app);
  await registerMediaRoutes(app);
  await registerShareRoutes(app);
  await registerSitemapRoutes(app);
  await registerSiteVerificationRoutes(app);
  await registerAdminUserRoutes(app);
  await registerAdminCatalogExportRoutes(app);
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
