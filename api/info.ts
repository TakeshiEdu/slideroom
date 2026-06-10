import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOptions, ROOM_TTL_HOURS, sendJson, STORAGE_BUCKET } from "./_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    runtime: "vercel",
    storage: "supabase",
    storageBucket: STORAGE_BUCKET,
    roomTtlHours: ROOM_TTL_HOURS,
  });
}
