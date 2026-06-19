import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canUserUploadToRoom,
  checkRateLimit,
  getBlobKeyFromUrl,
  getRoomIdFromRequestQuery,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  requireAuthenticatedUser,
  requireSameOrigin,
  sendJson,
  storageKeyBelongsToRoom,
  STORAGE_BUCKET,
} from "../../_shared.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
    return;
  }

  const key = getBlobKeyFromUrl(request, "/upload-url");
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" }, request);
    return;
  }

  try {
    requireSameOrigin(request);
    checkRateLimit(request, "blob:upload-url", 30);
    const user = await requireAuthenticatedUser(request, response);
    const roomId = getRoomIdFromRequestQuery(request);
    const loaded = await loadSharedState();
    if (!roomId || !storageKeyBelongsToRoom(key, roomId) || !canUserUploadToRoom(loaded.state ?? {}, roomId, user.id)) {
      sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
      return;
    }

    const { data, error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUploadUrl(key);
    if (error || !data) throw error || new Error("Signed upload URL was not created");
    sendJson(response, 200, { ok: true, bucket: STORAGE_BUCKET, path: data.path, token: data.token }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
