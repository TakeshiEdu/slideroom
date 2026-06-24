import type { IncomingMessage, ServerResponse } from "node:http";
import {
  checkDurableRateLimit,
  handleOptions,
  HttpError,
  requireAdminUser,
  requireSameOrigin,
  sendJson,
} from "../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    requireSameOrigin(request);
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
      return;
    }

    await checkDurableRateLimit(request, "admin:me", 60);
    const admin = await requireAdminUser(request, response);

    sendJson(response, 200, {
      ok: true,
      admin: {
        id: admin.user.id,
        email: admin.user.email,
        role: admin.role,
      },
    }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
