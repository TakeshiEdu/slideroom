import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getBlobKeyFromUrl,
  getSupabaseAdmin,
  handleOptions,
  readRequestBody,
  sendJson,
  setApiHeaders,
  STORAGE_BUCKET,
} from "../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  const key = getBlobKeyFromUrl(request);
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" });
    return;
  }

  const supabase = getSupabaseAdmin();
  const storage = supabase.storage.from(STORAGE_BUCKET);

  try {
    if (request.method === "GET") {
      const { data, error } = await storage.download(key);
      if (error || !data) {
        sendJson(response, 404, { ok: false, error: error?.message || "Blob not found" });
        return;
      }

      const bytes = Buffer.from(await data.arrayBuffer());
      setApiHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", data.type || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.end(bytes);
      return;
    }

    if (request.method === "POST") {
      const body = await readRequestBody(request);
      const { error } = await storage.upload(key, body, {
        contentType: request.headers["content-type"] || "application/octet-stream",
        upsert: true,
      });
      if (error) throw error;
      sendJson(response, 200, { ok: true, key, size: body.length });
      return;
    }

    if (request.method === "DELETE") {
      const { error } = await storage.remove([key]);
      if (error) throw error;
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
