import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  listMediaHealthDaily,
  listRecentMediaHealthJobRuns,
} from "../repositories/media-health-repository";
import { getCardFillnessSummary } from "../repositories/card-fillness-repository";
import { runAndPersistMediaHealthSnapshot } from "../services/media-health-snapshot-service";

const mediaHealthQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(120).default(30),
});

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

export async function registerAdminHighlightsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/admin/highlights/card-fillness", async (request, reply) => {
    if (rejectIfNotAdmin(request, reply)) {
      return;
    }

    try {
      const summary = getCardFillnessSummary();
      return reply.code(200).send(summary);
    } catch {
      return reply
        .code(500)
        .send({ message: "Failed to fetch card fillness metrics" });
    }
  });

  app.get("/api/admin/highlights/media-health", async (request, reply) => {
    if (rejectIfNotAdmin(request, reply)) {
      return;
    }

    try {
      const query = mediaHealthQuerySchema.parse(request.query);
      const history = listMediaHealthDaily(query.days);
      const recentRuns = listRecentMediaHealthJobRuns(20);

      return reply.code(200).send({
        history,
        latest: history.length > 0 ? history[history.length - 1] : null,
        recentRuns,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Invalid query params",
          errors: error.flatten(),
        });
      }

      return reply.code(500).send({ message: "Failed to fetch media health metrics" });
    }
  });

  app.post("/api/admin/highlights/media-health/run", async (request, reply) => {
    if (rejectIfNotAdmin(request, reply)) {
      return;
    }

    try {
      const snapshot = await runAndPersistMediaHealthSnapshot({
        triggerType: "manual_api",
        logger: app.log,
      });

      return reply.code(200).send({ snapshot });
    } catch {
      return reply
        .code(500)
        .send({ message: "Failed to run media health snapshot" });
    }
  });
}
