import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { parseCatalogQuery } from "../catalog/catalog-query";
import { searchCatalogItems } from "../repositories/catalog-repository";

const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 10_000;

interface CatalogExportItem {
  id: number;
  brand: string;
  model: string;
}

function rejectIfNotAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (request.authUser?.role === "admin") {
    return false;
  }

  void reply.code(403).send({ message: "Forbidden" });
  return true;
}

function buildFileName(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `catalog-export-min-${iso}.json`;
}

export async function registerAdminCatalogExportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/admin/catalog/export-min", async (request, reply) => {
    if (rejectIfNotAdmin(request, reply)) {
      return;
    }

    try {
      const parsedQuery = parseCatalogQuery(request.query);
      const exportItems: CatalogExportItem[] = [];
      let total = 0;

      for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
        const response = searchCatalogItems({
          ...parsedQuery,
          page,
          pageSize: EXPORT_PAGE_SIZE,
        });

        if (page === 1) {
          total = response.total;
        }

        response.items.forEach((item) => {
          exportItems.push({
            id: item.id,
            brand: item.brand,
            model: item.model,
          });
        });

        if (exportItems.length >= total || response.items.length === 0) {
          break;
        }
      }

      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${buildFileName()}"`,
      );

      return reply.code(200).send(exportItems);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Invalid query params",
          errors: error.flatten(),
        });
      }

      return reply.code(500).send({ message: "Failed to export catalog JSON" });
    }
  });
}
