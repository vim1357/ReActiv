import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  getCsrfTokenForRequest,
  getSessionCookieName,
  issueCsrfToken,
  loginWithPassword,
  logoutRequest,
} from "../services/auth-service";

const loginBodySchema = z.object({
  login: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    try {
      const payload = loginBodySchema.parse(request.body);
      const loginResult = loginWithPassword(payload.login, payload.password);

      if (!loginResult) {
        return reply.code(401).send({ message: "Неверный логин или пароль" });
      }

      reply.setCookie(getSessionCookieName(), loginResult.sessionToken, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: loginResult.sessionMaxAgeSeconds,
      });

      return reply.code(200).send({
        user: loginResult.user,
        csrfToken: issueCsrfToken(loginResult.sessionToken),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Некорректный запрос",
          errors: error.flatten(),
        });
      }

      return reply.code(500).send({ message: "Ошибка авторизации" });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ message: "Требуется авторизация" });
    }

    const csrfToken = getCsrfTokenForRequest(request);
    if (!csrfToken) {
      return reply.code(401).send({ message: "Требуется авторизация" });
    }

    return reply.code(200).send({
      user: request.authUser,
      csrfToken,
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    logoutRequest(request);

    reply.clearCookie(getSessionCookieName(), {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return reply.code(200).send({ message: "Выход выполнен" });
  });
}
