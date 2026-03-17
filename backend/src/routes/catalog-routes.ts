import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { parseCatalogQuery } from "../catalog/catalog-query";
import { getLatestSuccessfulImportBatch } from "../repositories/import-batch-repository";
import {
  findCatalogItemById,
  getCatalogFiltersMetadata,
  searchCatalogItems,
} from "../repositories/catalog-repository";

function sanitizeCatalogItemForRole<
  T extends {
    responsiblePerson?: string;
    websiteUrl?: string;
    daysOnSale?: number | null;
  },
>(item: T, role: string | undefined): T {
  if (role === "admin" || role === "stock_owner") {
    return item;
  }

  return {
    ...item,
    ...(Object.prototype.hasOwnProperty.call(item, "responsiblePerson")
      ? { responsiblePerson: "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "websiteUrl")
      ? { websiteUrl: "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "daysOnSale")
      ? { daysOnSale: null }
      : {}),
  };
}

function sanitizeCatalogFiltersForRole(
  metadata: Record<string, unknown>,
  role: string | undefined,
): Record<string, unknown> {
  if (role === "admin" || role === "stock_owner") {
    return metadata;
  }

  return {
    ...metadata,
    responsiblePerson: [],
    websiteUrl: [],
    daysOnSaleMin: null,
    daysOnSaleMax: null,
  };
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/catalog/summary", async (_request, reply) => {
    try {
      const latestImportBatch = getLatestSuccessfulImportBatch();

      return reply.code(200).send({
        newThisWeekCount: latestImportBatch?.added_rows ?? 0,
      });
    } catch {
      return reply.code(500).send({ message: "Failed to fetch catalog summary" });
    }
  });

  app.get("/api/catalog/items", async (request, reply) => {
    try {
      const query = parseCatalogQuery(request.query);
      const result = searchCatalogItems(query);
      const items = result.items.map((item) =>
        sanitizeCatalogItemForRole(item, request.authUser?.role),
      );

      return reply.code(200).send({
        items,
        newThisWeekCount: result.newThisWeekCount,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Invalid query params",
          errors: error.flatten(),
        });
      }

      return reply.code(500).send({ message: "Failed to fetch catalog items" });
    }
  });

  app.get("/api/catalog/filters", async (request, reply) => {
    try {
      const metadata = getCatalogFiltersMetadata();
      return reply
        .code(200)
        .send(sanitizeCatalogFiltersForRole(metadata, request.authUser?.role));
    } catch {
      return reply.code(500).send({ message: "Failed to fetch filter metadata" });
    }
  });

  app.get("/api/catalog/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).send({ message: "Invalid catalog item id" });
    }

    try {
      const item = findCatalogItemById(parsedId);
      if (!item) {
        return reply.code(404).send({ message: "Catalog item not found" });
      }

      return reply
        .code(200)
        .send(sanitizeCatalogItemForRole(item, request.authUser?.role));
    } catch {
      return reply.code(500).send({ message: "Failed to fetch catalog item" });
    }
  });
}
