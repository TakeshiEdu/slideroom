import type { IncomingMessage, ServerResponse } from "node:http";
import { validatePptxUpload } from "../../_pptxValidation.js";
import {
  canUserUploadToRoom,
  checkDurableRateLimit,
  getBlobKeyFromUrl,
  getRoomIdFromRequestQuery,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  recordAuditEvent,
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

  const key = getBlobKeyFromUrl(request, "/validate");
  if (!key) {
    sendJson(response, 400, { ok: false, error: "Invalid storage key" }, request);
    return;
  }

  const supabase = getSupabaseAdmin();
  const storage = supabase.storage.from(STORAGE_BUCKET);

  try {
    requireSameOrigin(request);
    await checkDurableRateLimit(request, "blob:validate", 30);
    const user = await requireAuthenticatedUser(request, response);
    const roomId = getRoomIdFromRequestQuery(request);
    const loaded = await loadSharedState();
    if (!roomId || !storageKeyBelongsToRoom(key, roomId) || !canUserUploadToRoom(loaded.state ?? {}, roomId, user.id)) {
      sendJson(response, 403, { ok: false, error: "Forbidden" }, request);
      return;
    }

    const { data, error } = await storage.download(key);
    if (error || !data) {
      sendJson(response, 404, { ok: false, error: error?.message || "Blob not found" }, request);
      return;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      const summary = validatePptxUpload(buffer, {
        storageKey: key,
        contentType: data.type,
      });
      sendJson(response, 200, { ok: true, key, summary }, request);
    } catch (validationError) {
      await storage.remove([key]);
      await recordAuditEvent(request, {
        actorUserId: user.id,
        roomId,
        action: "storage.validation_failed",
        targetType: "storage_object",
        targetId: key,
        metadata: { reason: validationError instanceof Error ? validationError.message : String(validationError) },
      });
      throw validationError;
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
