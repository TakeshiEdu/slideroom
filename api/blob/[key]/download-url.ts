import type { IncomingMessage, ServerResponse } from "node:http";
import { getBlobKeyFromUrl, getSupabaseAdmin, handleOptions, sendJson, STORAGE_BUCKET } from "../../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const key = getBlobKeyFromUrl(request, "/download-url");
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" });
    return;
  }

  try {
    const { data, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUrl(key, 60 * 60);
    if (error || !data) throw error || new Error("Signed download URL was not created");
    sendJson(response, 200, { ok: true, signedUrl: data.signedUrl });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
