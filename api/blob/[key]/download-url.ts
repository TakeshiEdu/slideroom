import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canUserAccessStorageKey,
  checkRateLimit,
  getBlobKeyFromUrl,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  requireAuthenticatedUser,
  sendJson,
  STORAGE_BUCKET,
} from "../../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
    return;
  }

  const key = getBlobKeyFromUrl(request, "/download-url");
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" }, request);
    return;
  }

  try {
    checkRateLimit(request, "blob:download-url", 120);
    const user = await requireAuthenticatedUser(request, response);
    const loaded = await loadSharedState();
    if (!canUserAccessStorageKey(loaded.state ?? {}, key, user.id)) {
      sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
      return;
    }

    const { data, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUrl(key, 5 * 60);
    if (error || !data) throw error || new Error("Signed download URL was not created");
    sendJson(response, 200, { ok: true, signedUrl: data.signedUrl }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
