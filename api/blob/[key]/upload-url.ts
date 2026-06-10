import type { IncomingMessage, ServerResponse } from "node:http";
import { getBlobKeyFromUrl, getSupabaseAdmin, handleOptions, sendJson, STORAGE_BUCKET } from "../../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const key = getBlobKeyFromUrl(request, "/upload-url");
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" });
    return;
  }

  try {
    const { data, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUploadUrl(key);
    if (error || !data) throw error || new Error("Signed upload URL was not created");
    sendJson(response, 200, { ok: true, bucket: STORAGE_BUCKET, path: data.path, token: data.token });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
