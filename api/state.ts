import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOptions, loadSharedState, readRequestBody, saveSharedState, sendJson } from "./_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    if (request.method === "GET") {
      sendJson(response, 200, await loadSharedState());
      return;
    }

    if (request.method === "PUT") {
      const body = await readRequestBody(request, 10 * 1024 * 1024);
      await saveSharedState(JSON.parse(body.toString("utf8")));
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
