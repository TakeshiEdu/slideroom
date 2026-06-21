import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ADMIN_EMAILS,
  checkDurableRateLimit,
  getSupabaseAdmin,
  handleOptions,
  HttpError,
  loadSharedState,
  MAX_EXPORT_RECORDS_PER_ROOM,
  MAX_FILES_PER_ROOM,
  MAX_MEMBERS_PER_ROOM,
  MAX_ROOM_STORAGE_BYTES,
  MAX_ROOMS_PER_USER,
  MAX_SLIDES_PER_ROOM,
  MAX_STATE_BYTES,
  MAX_UPLOAD_BYTES,
  recordAuditEvent,
  requireAdminUser,
  requireSameOrigin,
  ROOM_TTL_HOURS,
  ROOM_TTL_MS,
  sendJson,
} from "../_shared.js";

interface RoomSummary {
  id?: string;
  title?: string;
  status?: string;
  accessMode?: string;
  hostUserId?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface FileSummary {
  roomId?: string;
  size?: number;
}

interface RoomScoped {
  roomId?: string;
}

function toArray<T>(value: T[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function countBy<T>(items: T[], getKey: (item: T) => string | undefined) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function roomAgeMs(room: RoomSummary) {
  const createdAt = Date.parse(room.createdAt || room.updatedAt || "");
  return Date.now() - (Number.isNaN(createdAt) ? Date.now() : createdAt);
}

function summarizeState(state: Record<string, unknown>) {
  const rooms = toArray(state.rooms as RoomSummary[] | undefined);
  const members = toArray(state.members as RoomScoped[] | undefined);
  const files = toArray(state.files as FileSummary[] | undefined);
  const slides = toArray(state.slides as RoomScoped[] | undefined);
  const exportRecords = toArray(state.exportRecords as RoomScoped[] | undefined);
  const storageBytes = files.reduce((total, file) => total + Math.max(0, Math.floor(file.size ?? 0)), 0);

  const filesByRoom = countBy(files, (file) => file.roomId);
  const slidesByRoom = countBy(slides, (slide) => slide.roomId);
  const membersByRoom = countBy(members, (member) => member.roomId);

  return {
    totals: {
      rooms: rooms.length,
      members: members.length,
      files: files.length,
      slides: slides.length,
      exportRecords: exportRecords.length,
      storageBytes,
      expiredRoomCandidates: rooms.filter((room) => roomAgeMs(room) >= ROOM_TTL_MS).length,
    },
    roomsByStatus: countBy(rooms, (room) => room.status || "unknown"),
    roomsByAccessMode: countBy(rooms, (room) => room.accessMode || "invite"),
    largestRooms: rooms
      .map((room) => ({
        id: room.id,
        title: room.title,
        status: room.status,
        accessMode: room.accessMode,
        files: room.id ? filesByRoom[room.id] ?? 0 : 0,
        slides: room.id ? slidesByRoom[room.id] ?? 0 : 0,
        members: room.id ? membersByRoom[room.id] ?? 0 : 0,
        updatedAt: room.updatedAt,
      }))
      .sort((a, b) => (b.files + b.slides + b.members) - (a.files + a.slides + a.members))
      .slice(0, 20),
  };
}

async function loadRecentAuditLogs() {
  const { data, error } = await getSupabaseAdmin()
    .from("audit_logs")
    .select("id, actor_user_id, room_id, action, target_type, target_id, user_agent, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

async function loadRecentUsageEvents() {
  const { data, error } = await getSupabaseAdmin()
    .from("usage_events")
    .select("id, user_id, room_id, event_type, quantity, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    requireSameOrigin(request);
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" }, request);
      return;
    }

    await checkDurableRateLimit(request, "admin:overview", 30);
    const admin = await requireAdminUser(request, response);
    const loaded = await loadSharedState();
    const state = (loaded.state ?? {}) as Record<string, unknown>;
    const [auditLogs, usageEvents] = await Promise.all([
      loadRecentAuditLogs(),
      loadRecentUsageEvents(),
    ]);

    await recordAuditEvent(request, {
      actorUserId: admin.user.id,
      action: "admin.overview_viewed",
      targetType: "admin",
      metadata: { role: admin.role },
    });

    sendJson(response, 200, {
      ok: true,
      admin: {
        id: admin.user.id,
        email: admin.user.email,
        role: admin.role,
        envBootstrapEnabled: ADMIN_EMAILS.length > 0,
      },
      summary: summarizeState(state),
      limits: {
        roomTtlHours: ROOM_TTL_HOURS,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        maxStateBytes: MAX_STATE_BYTES,
        maxRoomsPerUser: MAX_ROOMS_PER_USER,
        maxMembersPerRoom: MAX_MEMBERS_PER_ROOM,
        maxFilesPerRoom: MAX_FILES_PER_ROOM,
        maxSlidesPerRoom: MAX_SLIDES_PER_ROOM,
        maxExportRecordsPerRoom: MAX_EXPORT_RECORDS_PER_ROOM,
        maxRoomStorageBytes: MAX_ROOM_STORAGE_BYTES,
      },
      recentAuditLogs: auditLogs,
      recentUsageEvents: usageEvents,
    }, request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) }, request);
  }
}
