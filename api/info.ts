import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handleOptions,
  MAX_EXPORT_RECORDS_PER_ROOM,
  MAX_FILES_PER_ROOM,
  MAX_MEMBERS_PER_ROOM,
  MAX_ROOM_STORAGE_BYTES,
  MAX_ROOMS_PER_USER,
  MAX_SLIDES_PER_ROOM,
  MAX_STATE_BYTES,
  MAX_UPLOAD_BYTES,
  ROOM_TTL_HOURS,
  sendJson,
  STORAGE_BUCKET,
} from "./_shared.js";

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
    limits: {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxStateBytes: MAX_STATE_BYTES,
      maxRoomsPerUser: MAX_ROOMS_PER_USER,
      maxMembersPerRoom: MAX_MEMBERS_PER_ROOM,
      maxFilesPerRoom: MAX_FILES_PER_ROOM,
      maxSlidesPerRoom: MAX_SLIDES_PER_ROOM,
      maxExportRecordsPerRoom: MAX_EXPORT_RECORDS_PER_ROOM,
      maxRoomStorageBytes: MAX_ROOM_STORAGE_BYTES,
    },
  });
}
