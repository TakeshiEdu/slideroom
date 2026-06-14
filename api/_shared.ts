import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

interface RoomLike {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

interface FileLike {
  roomId?: string;
  storageKey?: string;
}

interface SharedAppState {
  rooms?: RoomLike[];
  members?: Array<{ roomId?: string }>;
  files?: FileLike[];
  slides?: Array<{ roomId?: string }>;
  exportRecords?: Array<{ roomId?: string }>;
  [key: string]: unknown;
}

interface StateRow {
  state: SharedAppState;
  updated_at: string;
}

export const ROOM_TTL_HOURS = Number(process.env.SLIDEROOM_ROOM_TTL_HOURS ?? "24");
export const ROOM_TTL_MS = ROOM_TTL_HOURS * 60 * 60 * 1000;
export const STATE_ID = process.env.SLIDEROOM_STATE_ID ?? "global-dev";
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "slideroom-uploads";
export const MAX_UPLOAD_BYTES = Number(process.env.SLIDEROOM_MAX_UPLOAD_BYTES ?? 300 * 1024 * 1024);

let cachedSupabase: SupabaseClient | undefined;

export function getSupabaseAdmin() {
  if (cachedSupabase) return cachedSupabase;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  cachedSupabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedSupabase;
}

export function getSupabaseUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("Missing SUPABASE_URL");
  return url.replace(/\/$/, "");
}

export function getSupabaseServerAnonKey() {
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY");
  return key;
}

export function setApiHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function handleOptions(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "OPTIONS") return false;
  setApiHeaders(response);
  response.statusCode = 204;
  response.end();
  return true;
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  setApiHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function safeStorageKey(rawKey: string | undefined) {
  const key = decodeURIComponent(rawKey || "");
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  return key;
}

export function getBlobKeyFromUrl(request: IncomingMessage, suffix = "") {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  let value = url.pathname.slice("/api/blob/".length);
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return safeStorageKey(value);
}

export async function readRequestBody(request: IncomingMessage, maxBytes = MAX_UPLOAD_BYTES) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("Payload too large");
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function getRequestCookies(request: IncomingMessage) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) return [decodeURIComponent(part), ""];
        return [
          decodeURIComponent(part.slice(0, separatorIndex)),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

export function appendSetCookie(response: ServerResponse, cookie: string) {
  const current = response.getHeader("Set-Cookie");
  if (!current) {
    response.setHeader("Set-Cookie", cookie);
    return;
  }
  response.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [String(current), cookie]);
}

function getRoomCreatedAt(room: RoomLike) {
  const timestamp = Date.parse(room.createdAt || room.updatedAt || "");
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

async function removeStorageObjects(storageKeys: string[]) {
  if (storageKeys.length === 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(storageKeys);
  if (error) console.warn("Expired storage cleanup skipped", error.message);
}

export async function purgeExpiredRooms(state: SharedAppState): Promise<{ state: SharedAppState; changed: boolean }> {
  const rooms = Array.isArray(state.rooms) ? state.rooms : [];
  const expiredRoomIds = new Set(
    rooms
      .filter((room) => Date.now() - getRoomCreatedAt(room) >= ROOM_TTL_MS)
      .map((room) => room.id),
  );

  if (expiredRoomIds.size === 0) return { state, changed: false };

  const files = Array.isArray(state.files) ? state.files : [];
  const expiredStorageKeys = files
    .filter((file) => file.roomId && expiredRoomIds.has(file.roomId))
    .map((file) => file.storageKey)
    .filter((key): key is string => Boolean(key && safeStorageKey(key)));

  await removeStorageObjects(expiredStorageKeys);

  return {
    changed: true,
    state: {
      ...state,
      rooms: rooms.filter((room) => !expiredRoomIds.has(room.id)),
      members: (state.members || []).filter((member) => !member.roomId || !expiredRoomIds.has(member.roomId)),
      files: files.filter((file) => !file.roomId || !expiredRoomIds.has(file.roomId)),
      slides: (state.slides || []).filter((slide) => !slide.roomId || !expiredRoomIds.has(slide.roomId)),
      exportRecords: (state.exportRecords || []).filter((record) => !record.roomId || !expiredRoomIds.has(record.roomId)),
    },
  };
}

export async function loadSharedState() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_state")
    .select("state, updated_at")
    .eq("id", STATE_ID)
    .maybeSingle<StateRow>();

  if (error) throw error;
  if (!data?.state) return { initialized: false, state: null };
  if (!Array.isArray(data.state.rooms)) return { initialized: false, state: null };

  const purged = await purgeExpiredRooms(data.state);
  if (purged.changed) await saveSharedState(purged.state);

  return {
    initialized: true,
    updatedAt: data.updated_at,
    state: purged.state,
  };
}

export async function saveSharedState(state: SharedAppState) {
  const supabase = getSupabaseAdmin();
  const purged = await purgeExpiredRooms(state);
  const { error } = await supabase.from("app_state").upsert({
    id: STATE_ID,
    state: purged.state,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}
