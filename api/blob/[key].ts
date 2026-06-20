import type { IncomingMessage, ServerResponse } from "node:http";
import { validatePptxUpload } from "../_pptxValidation.js";
import {
  canUserAccessStorageKey,
  canUserUploadToRoom,
  canUserWriteStorageKey,
  checkRateLimit,
  getBlobKeyFromUrl,
  getRoomIdFromRequestQuery,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  readRequestBody,
  requireAuthenticatedUser,
  requireSameOrigin,
  sendJson,
  setApiHeaders,
  storageKeyBelongsToRoom,
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
    requireSameOrigin(request);
    const user = await requireAuthenticatedUser(request, response);
    const loaded = await loadSharedState();
    const state = loaded.state ?? {};

    if (request.method === "GET") {
      checkRateLimit(request, "blob:get", 120);
      if (!canUserAccessStorageKey(state, key, user.id)) {
        sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
        return;
      }

      const { data, error } = await storage.download(key);
      if (error || !data) {
        sendJson(response, 404, { ok: false, error: error?.message || "Blob not found" }, request);
        return;
      }

      const bytes = Buffer.from(await data.arrayBuffer());
      setApiHeaders(response, request);
      response.statusCode = 200;
      response.setHeader("Content-Type", data.type || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.end(bytes);
      return;
    }

    if (request.method === "POST") {
      checkRateLimit(request, "blob:post", 30);
      const roomId = getRoomIdFromRequestQuery(request);
      if (!roomId || !storageKeyBelongsToRoom(key, roomId) || !canUserUploadToRoom(state, roomId, user.id)) {
        sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
        return;
      }

      const body = await readRequestBody(request);
      validatePptxUpload(body, {
        storageKey: key,
        contentType: request.headers["content-type"],
      });
      const { error } = await storage.upload(key, body, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
      if (error) throw error;
      sendJson(response, 200, { ok: true, key, size: body.length }, request);
      return;
    }

    if (request.method === "DELETE") {
      checkRateLimit(request, "blob:delete", 60);
      if (!canUserWriteStorageKey(state, key, user.id)) {
        sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
        return;
      }

      const { error } = await storage.remove([key]);
      if (error) throw error;
      sendJson(response, 200, { ok: true }, request);
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
