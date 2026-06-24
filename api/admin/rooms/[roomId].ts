import type { IncomingMessage, ServerResponse } from "node:http";
import {
  checkDurableRateLimit,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  readRequestBody,
  recordAuditEvent,
  requireAdminUser,
  requireSameOrigin,
  safeStorageKey,
  saveSharedState,
  sendJson,
  STORAGE_BUCKET,
} from "../../_shared.js";

interface RoomLike {
  id: string;
  title?: string;
}

interface RoomScoped {
  roomId?: string;
}

interface FileLike extends RoomScoped {
  storageKey?: string;
}

interface SharedStateShape {
  rooms?: RoomLike[];
  members?: RoomScoped[];
  files?: FileLike[];
  slides?: RoomScoped[];
  exportRecords?: RoomScoped[];
  [key: string]: unknown;
}

function getRoomId(request: IncomingMessage) {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const raw = parts.at(-1);
  if (!raw) return null;
  const roomId = decodeURIComponent(raw);
  if (roomId.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(roomId)) return null;
  return roomId;
}

function toArray<T>(value: T[] | undefined) {
  return Array.isArray(value) ? value : [];
}

async function removeStorageObjects(storageKeys: string[]) {
  if (storageKeys.length === 0) return { attempted: 0, removed: 0 };
  const { error } = await getSupabaseAdmin().storage.from(STORAGE_BUCKET).remove(storageKeys);
  if (error) {
    console.warn("Admin room storage cleanup skipped", error.message);
    return { attempted: storageKeys.length, removed: 0, error: error.message };
  }
  return { attempted: storageKeys.length, removed: storageKeys.length };
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    requireSameOrigin(request);
    if (request.method !== "DELETE") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
      return;
    }

    await checkDurableRateLimit(request, "admin:room-delete", 12);
    const admin = await requireAdminUser(request, response);
    const roomId = getRoomId(request);
    if (!roomId) {
      sendJson(response, 400, { ok: false, error: "Invalid room id" }, request);
      return;
    }

    const body = await readRequestBody(request, 4096).catch(() => Buffer.from("{}"));
    const payload = JSON.parse(body.toString("utf8") || "{}") as { reason?: string };
    const loaded = await loadSharedState();
    const state = (loaded.state ?? {}) as SharedStateShape;
    const rooms = toArray(state.rooms);
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) {
      sendJson(response, 404, { ok: false, error: "Room not found" }, request);
      return;
    }

    const files = toArray(state.files);
    const storageKeys = files
      .filter((file) => file.roomId === roomId)
      .map((file) => file.storageKey)
      .filter((key): key is string => Boolean(key && safeStorageKey(key)));

    const nextState: SharedStateShape = {
      ...state,
      rooms: rooms.filter((candidate) => candidate.id !== roomId),
      members: toArray(state.members).filter((member) => member.roomId !== roomId),
      files: files.filter((file) => file.roomId !== roomId),
      slides: toArray(state.slides).filter((slide) => slide.roomId !== roomId),
      exportRecords: toArray(state.exportRecords).filter((record) => record.roomId !== roomId),
    };

    const storage = await removeStorageObjects(storageKeys);
    await saveSharedState(nextState as Parameters<typeof saveSharedState>[0]);
    await recordAuditEvent(request, {
      actorUserId: admin.user.id,
      roomId,
      action: "admin.room_deleted",
      targetType: "room",
      targetId: roomId,
      metadata: {
        title: room.title,
        role: admin.role,
        reason: payload.reason?.slice(0, 240),
        storage,
        files: files.filter((file) => file.roomId === roomId).length,
      },
    });

    sendJson(response, 200, {
      ok: true,
      room: { id: roomId, title: room.title },
      storage,
    }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
