import type { IncomingMessage, ServerResponse } from "node:http";
import {
  checkRateLimit,
  filterSharedStateForInvite,
  filterSharedStateForUser,
  getAuthenticatedUser,
  handleOptions,
  HttpError,
  loadSharedState,
  MAX_STATE_BYTES,
  mergeAuthorizedSharedState,
  readRequestBody,
  requireSameOrigin,
  saveSharedState,
  sendJson,
} from "./_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    requireSameOrigin(request);
    if (request.method === "GET") {
      checkRateLimit(request, "state:get", 120);
      const loaded = await loadSharedState();
      if (!loaded.initialized || !loaded.state) {
        sendJson(response, 200, loaded, request);
        return;
      }

      const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
      const inviteCode = url.searchParams.get("inviteCode");
      const user = await getAuthenticatedUser(request, response);
      const state = inviteCode
        ? filterSharedStateForInvite(loaded.state, inviteCode, user?.id)
        : filterSharedStateForUser(loaded.state, user?.id);

      sendJson(response, 200, { ...loaded, state }, request);
      return;
    }

    if (request.method === "PUT") {
      checkRateLimit(request, "state:put", 40);
      const user = await getAuthenticatedUser(request, response);
      if (!user) {
        sendJson(response, 401, { ok: false, error: "Not authenticated" }, request);
        return;
      }

      const body = await readRequestBody(request, MAX_STATE_BYTES);
      const incoming = JSON.parse(body.toString("utf8"));
      const loaded = await loadSharedState();
      const current = loaded.state ?? {};
      await saveSharedState(mergeAuthorizedSharedState(current, incoming, user.id));
      sendJson(response, 200, { ok: true }, request);
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
