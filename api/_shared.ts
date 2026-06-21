import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface RoomLike {
  id: string;
  title?: string;
  className?: string;
  teamName?: string;
  description?: string;
  status?: string;
  accessMode?: string;
  hostUserId?: string;
  inviteCode?: string;
  inviteUrl?: string;
  presentationAt?: string;
  deadlineAt?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
}

interface FileLike {
  id?: string;
  roomId?: string;
  ownerUserId?: string;
  name?: string;
  storageKey?: string;
  extension?: string;
  size?: number;
}

interface SharedAppState {
  rooms?: RoomLike[];
  members?: Array<{ id?: string; roomId?: string; userId?: string; role?: string; name?: string; joinedAt?: string }>;
  files?: FileLike[];
  slides?: Array<{ id?: string; roomId?: string; ownerUserId?: string; fileId?: string }>;
  exportRecords?: Array<{ id?: string; roomId?: string; fileName?: string; format?: string; status?: string }>;
  [key: string]: unknown;
}

interface AuditEventInput {
  actorUserId?: string | null;
  roomId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

interface StateRow {
  state: SharedAppState;
  updated_at: string;
}

interface AppAdminRow {
  user_id: string;
  role: "owner" | "admin" | "support";
  created_at?: string;
}

export const ROOM_TTL_HOURS = Number(process.env.SLIDEROOM_ROOM_TTL_HOURS ?? "24");
export const ROOM_TTL_MS = ROOM_TTL_HOURS * 60 * 60 * 1000;
export const STATE_ID = process.env.SLIDEROOM_STATE_ID ?? "global-dev";
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "slideroom-uploads";
export const MAX_UPLOAD_BYTES = Number(process.env.SLIDEROOM_MAX_UPLOAD_BYTES ?? 300 * 1024 * 1024);
export const MAX_STATE_BYTES = 1024 * 1024;
export const MAX_ROOMS_PER_USER = Number(process.env.SLIDEROOM_MAX_ROOMS_PER_USER ?? "20");
export const MAX_MEMBERS_PER_ROOM = Number(process.env.SLIDEROOM_MAX_MEMBERS_PER_ROOM ?? "100");
export const MAX_FILES_PER_ROOM = Number(process.env.SLIDEROOM_MAX_FILES_PER_ROOM ?? "60");
export const MAX_SLIDES_PER_ROOM = Number(process.env.SLIDEROOM_MAX_SLIDES_PER_ROOM ?? "500");
export const MAX_EXPORT_RECORDS_PER_ROOM = Number(process.env.SLIDEROOM_MAX_EXPORT_RECORDS_PER_ROOM ?? "30");
export const MAX_ROOM_STORAGE_BYTES = Number(process.env.SLIDEROOM_MAX_ROOM_STORAGE_BYTES ?? 1024 * 1024 * 1024);
export const ADMIN_EMAILS = (process.env.SLIDEROOM_ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
export const ACCESS_COOKIE = "slideroom-access-token";
export const REFRESH_COOKIE = "slideroom-refresh-token";
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_ID_LENGTH = 96;
const MAX_TEXT_LENGTH = 500;
const MAX_AUDIT_METADATA_BYTES = 4096;
const MAX_AUDIT_EVENTS_PER_STATE_SAVE = 50;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

let cachedSupabase: SupabaseClient | undefined;

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface SupabaseSessionResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

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
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error("Missing SUPABASE_ANON_KEY");
  return key;
}

function isSameOriginRequest(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: IncomingMessage) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "same-origin" || fetchSite === "none") return;
  if (origin && isSameOriginRequest(request)) return;
  throw new HttpError(403, "Cross-origin request rejected");
}

export function setApiHeaders(response: ServerResponse, request?: IncomingMessage) {
  if (request && isSameOriginRequest(request) && request.headers.origin) {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
}

export function handleOptions(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "OPTIONS") return false;
  setApiHeaders(response, request);
  response.statusCode = 204;
  response.end();
  return true;
}

export function sendJson(response: ServerResponse, status: number, body: unknown, request?: IncomingMessage) {
  setApiHeaders(response, request);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function safeStorageKey(rawKey: string | undefined) {
  const key = decodeURIComponent(rawKey || "");
  if (key.length < 3 || key.length > 240) return null;
  if (key.includes("\\") || key.includes("//")) return null;
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (!segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))) return null;
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

export function isSecureRequest(request: IncomingMessage) {
  return request.headers["x-forwarded-proto"] === "https" || request.headers.host?.includes("vercel.app");
}

export function cookieOptions(request: IncomingMessage, maxAge: number) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    isSecureRequest(request) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function setAuthCookies(response: ServerResponse, request: IncomingMessage, session: SupabaseSessionResponse) {
  if (session.access_token) {
    appendSetCookie(response, `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; ${cookieOptions(request, session.expires_in || 3600)}`);
  }
  if (session.refresh_token) {
    appendSetCookie(response, `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; ${cookieOptions(request, REFRESH_MAX_AGE)}`);
  }
}

export function clearAuthCookies(response: ServerResponse, request: IncomingMessage) {
  appendSetCookie(response, `${ACCESS_COOKIE}=; ${cookieOptions(request, 0)}`);
  appendSetCookie(response, `${REFRESH_COOKIE}=; ${cookieOptions(request, 0)}`);
}

export function getClientIp(request: IncomingMessage) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) return forwardedFor.split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
}

export function checkRateLimit(request: IncomingMessage, scope: string, limit: number, windowMs = RATE_LIMIT_WINDOW_MS) {
  const key = `${scope}:${getClientIp(request)}`;
  const nowMs = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    rateLimitBuckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, "Too many requests");
  }
}

function hashRateLimitKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashAuditValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function checkDurableRateLimit(request: IncomingMessage, scope: string, limit: number, windowMs = RATE_LIMIT_WINDOW_MS) {
  checkRateLimit(request, scope, limit, windowMs);

  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const rateKey = hashRateLimitKey(`${scope}:${getClientIp(request)}`);
  const { data, error } = await getSupabaseAdmin()
    .rpc("check_rate_limit", {
      rate_key: rateKey,
      max_count: limit,
      window_seconds: windowSeconds,
    });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    throw new HttpError(429, "Too many requests");
  }
}

function cleanAuditText(value: unknown, maxLength = 240) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function cleanAuditMetadata(metadata: Record<string, unknown> = {}) {
  const cleaned = Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key.slice(0, 80), value]),
  );
  const bytes = Buffer.byteLength(JSON.stringify(cleaned), "utf8");
  if (bytes <= MAX_AUDIT_METADATA_BYTES) return cleaned;
  return {
    truncated: true,
    originalBytes: bytes,
  };
}

export async function recordAuditEvent(request: IncomingMessage, event: AuditEventInput) {
  try {
    const clientIp = getClientIp(request);
    const userAgent = cleanAuditText(request.headers["user-agent"], 500);
    const metadata = cleanAuditMetadata({
      ...(event.metadata ?? {}),
      ipHash: hashAuditValue(clientIp),
    });

    const { error } = await getSupabaseAdmin()
      .from("audit_logs")
      .insert({
        actor_user_id: event.actorUserId ?? null,
        room_id: event.roomId ?? null,
        action: event.action,
        target_type: event.targetType ?? null,
        target_id: event.targetId ?? null,
        ip_address: null,
        user_agent: userAgent ?? null,
        metadata,
      });

    if (error) console.warn("Audit log insert skipped", error.message);
  } catch (error) {
    console.warn("Audit log insert skipped", error instanceof Error ? error.message : String(error));
  }
}

async function supabaseAuth<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const anonKey = getSupabaseServerAnonKey();
  const headers = new Headers(init.headers);
  headers.set("apikey", anonKey);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${getSupabaseUrl()}/auth/v1${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase Auth error ${response.status}`;
    throw new HttpError(response.status, message);
  }
  return payload as T;
}

export async function refreshAuthSession(request: IncomingMessage, response: ServerResponse) {
  const refreshToken = getRequestCookies(request)[REFRESH_COOKIE];
  if (!refreshToken) return null;
  const session = await supabaseAuth<SupabaseSessionResponse>("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  setAuthCookies(response, request, session);
  return session.access_token || null;
}

export async function getAccessToken(request: IncomingMessage, response: ServerResponse) {
  return getRequestCookies(request)[ACCESS_COOKIE] || await refreshAuthSession(request, response);
}

export async function getAuthenticatedUser(request: IncomingMessage, response: ServerResponse) {
  let accessToken = getRequestCookies(request)[ACCESS_COOKIE];
  try {
    if (!accessToken) accessToken = await refreshAuthSession(request, response) || undefined;
    if (!accessToken) return null;
    return await supabaseAuth<SupabaseAuthUser>("/user", { method: "GET" }, accessToken);
  } catch {
    accessToken = await refreshAuthSession(request, response) || undefined;
    if (!accessToken) return null;
    return supabaseAuth<SupabaseAuthUser>("/user", { method: "GET" }, accessToken);
  }
}

export async function requireAuthenticatedUser(request: IncomingMessage, response: ServerResponse) {
  const user = await getAuthenticatedUser(request, response);
  if (!user) throw new HttpError(401, "Not authenticated");
  return user;
}

export async function getAdminRole(user: SupabaseAuthUser) {
  const email = user.email?.trim().toLowerCase();
  if (email && ADMIN_EMAILS.includes(email)) return "owner";

  const { data, error } = await getSupabaseAdmin()
    .from("app_admins")
    .select("user_id, role, created_at")
    .eq("user_id", user.id)
    .maybeSingle<AppAdminRow>();

  if (error) throw error;
  return data?.role ?? null;
}

export async function requireAdminUser(request: IncomingMessage, response: ServerResponse) {
  const user = await requireAuthenticatedUser(request, response);
  const role = await getAdminRole(user);
  if (!role) throw new HttpError(403, "Admin access required");
  return { user, role };
}

function getRoomCreatedAt(room: RoomLike) {
  const timestamp = Date.parse(room.createdAt || room.updatedAt || "");
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toArray<T>(value: T[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function isSafeId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9._-]+$/.test(value);
}

function cleanText(value: unknown, fallback = "", maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function cleanIsoDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function cleanNonNegativeInteger(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function createEmptySharedState(): SharedAppState {
  return {
    rooms: [],
    members: [],
    files: [],
    slides: [],
    exportRecords: [],
    settings: {},
  };
}

function getRoomIdsForUser(state: SharedAppState, userId?: string) {
  if (!userId) return new Set<string>();
  const roomIds = new Set<string>();
  toArray(state.rooms).forEach((room) => {
    if (room.id && room.hostUserId === userId) roomIds.add(room.id);
  });
  toArray(state.members).forEach((member) => {
    if (member.roomId && member.userId === userId) roomIds.add(member.roomId);
  });
  return roomIds;
}

function isRoomAdmin(state: SharedAppState, roomId: string, userId: string) {
  const room = toArray(state.rooms).find((candidate) => candidate.id === roomId);
  if (room?.hostUserId === userId) return true;
  return toArray(state.members).some((member) => (
    member.roomId === roomId &&
    member.userId === userId &&
    (member.role === "host" || member.role === "admin")
  ));
}

function isRoomParticipant(state: SharedAppState, roomId: string, userId: string) {
  const room = toArray(state.rooms).find((candidate) => candidate.id === roomId);
  if (room?.hostUserId === userId) return true;
  return toArray(state.members).some((member) => member.roomId === roomId && member.userId === userId);
}

function filterStateByRoomIds(state: SharedAppState, roomIds: Set<string>) {
  if (roomIds.size === 0) return createEmptySharedState();
  return {
    ...createEmptySharedState(),
    rooms: toArray(state.rooms).filter((room) => room.id && roomIds.has(room.id)),
    members: toArray(state.members).filter((member) => member.roomId && roomIds.has(member.roomId)),
    files: toArray(state.files).filter((file) => file.roomId && roomIds.has(file.roomId)),
    slides: toArray(state.slides).filter((slide) => slide.roomId && roomIds.has(slide.roomId)),
    exportRecords: toArray(state.exportRecords).filter((record) => record.roomId && roomIds.has(record.roomId)),
    settings: state.settings && isRecord(state.settings) ? state.settings : {},
  };
}

export function filterSharedStateForUser(state: SharedAppState, userId?: string) {
  return filterStateByRoomIds(state, getRoomIdsForUser(state, userId));
}

export function filterSharedStateForInvite(state: SharedAppState, inviteCode: string, userId?: string) {
  const normalized = inviteCode.trim().toUpperCase();
  const room = toArray(state.rooms).find((candidate) => candidate.inviteCode?.toUpperCase() === normalized);
  if (!room?.id) return createEmptySharedState();
  if (room.accessMode === "authenticated" && !userId) {
    return {
      ...createEmptySharedState(),
      rooms: [room],
    };
  }
  return filterStateByRoomIds(state, new Set([room.id]));
}

function sanitizeRoom(input: RoomLike, userId: string, existing?: RoomLike): RoomLike | null {
  if (!isSafeId(input.id)) return null;
  const createdAt = cleanIsoDate(input.createdAt) || existing?.createdAt || new Date().toISOString();
  const updatedAt = cleanIsoDate(input.updatedAt) || new Date().toISOString();
  const inviteCode = cleanText(input.inviteCode, existing?.inviteCode || "", 16).toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(inviteCode)) return null;

  return {
    id: input.id,
    title: cleanText(input.title, existing?.title || "Untitled", 140),
    className: cleanText(input.className, existing?.className || "", 140),
    teamName: cleanText(input.teamName, existing?.teamName || "", 140) || undefined,
    description: cleanText(input.description, existing?.description || "", 500) || undefined,
    status: ["draft", "in_progress", "waiting", "ready", "completed", "archived"].includes(String(input.status)) ? input.status : existing?.status || "draft",
    accessMode: input.accessMode === "authenticated" ? "authenticated" : "invite",
    hostUserId: existing?.hostUserId || userId,
    inviteCode,
    inviteUrl: cleanText(input.inviteUrl, existing?.inviteUrl || "", 300),
    presentationAt: cleanIsoDate(input.presentationAt),
    deadlineAt: cleanIsoDate(input.deadlineAt),
    createdAt,
    updatedAt,
    archivedAt: cleanIsoDate(input.archivedAt),
  };
}

function sanitizeItem<T extends { id?: string; roomId?: string }>(item: T, roomIds: Set<string>) {
  if (!isSafeId(item.id) || !item.roomId || !roomIds.has(item.roomId)) return null;
  return item;
}

export function storageKeyBelongsToRoom(storageKey: string, roomId: string) {
  return (storageKey.startsWith(`rooms/${roomId}/files/`) && storageKey.endsWith(".pptx")) || /^upload-file-[A-Za-z0-9_-]+$/.test(storageKey) || /^upload-[A-Za-z0-9_-]+$/.test(storageKey);
}

function sanitizeFile(item: FileLike, roomIds: Set<string>, userId: string, existing?: FileLike, adminRoomIds = new Set<string>()): FileLike | null {
  const sanitized = sanitizeItem(item, roomIds);
  if (!sanitized) return null;
  const ownerUserId = adminRoomIds.has(item.roomId!) ? cleanText(item.ownerUserId, existing?.ownerUserId || userId, MAX_ID_LENGTH) : userId;
  const storageKey = item.storageKey ? safeStorageKey(item.storageKey) : undefined;
  const size = cleanNonNegativeInteger(item.size, existing?.size ?? 0);
  if (storageKey && !storageKeyBelongsToRoom(storageKey, item.roomId!)) return null;
  if (item.extension && item.extension !== "pptx") return null;
  if (size > MAX_UPLOAD_BYTES) return null;
  return {
    ...item,
    ownerUserId,
    extension: "pptx",
    size,
    storageKey,
  };
}

function countByRoom<T extends { roomId?: string }>(items: T[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    if (!item.roomId) return;
    counts.set(item.roomId, (counts.get(item.roomId) ?? 0) + 1);
  });
  return counts;
}

function sumFileBytesByRoom(files: FileLike[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    if (!file.roomId) return;
    totals.set(file.roomId, (totals.get(file.roomId) ?? 0) + cleanNonNegativeInteger(file.size));
  });
  return totals;
}

function enforceQuota(condition: boolean, message: string, status = 422) {
  if (!condition) throw new HttpError(status, message);
}

function enforceSharedStateQuotas(state: SharedAppState, userId: string, affectedRoomIds: Set<string>) {
  const rooms = toArray(state.rooms);
  const hostedRoomIds = rooms
    .filter((room) => room.hostUserId === userId)
    .map((room) => room.id)
    .filter((id): id is string => Boolean(id));

  enforceQuota(hostedRoomIds.length <= MAX_ROOMS_PER_USER, "Room limit exceeded");

  const roomIdsToCheck = new Set([...affectedRoomIds, ...hostedRoomIds]);
  const membersByRoom = countByRoom(toArray(state.members));
  const filesByRoom = countByRoom(toArray(state.files));
  const slidesByRoom = countByRoom(toArray(state.slides));
  const exportsByRoom = countByRoom(toArray(state.exportRecords));
  const bytesByRoom = sumFileBytesByRoom(toArray(state.files));

  roomIdsToCheck.forEach((roomId) => {
    enforceQuota((membersByRoom.get(roomId) ?? 0) <= MAX_MEMBERS_PER_ROOM, "Room member limit exceeded");
    enforceQuota((filesByRoom.get(roomId) ?? 0) <= MAX_FILES_PER_ROOM, "Room file limit exceeded");
    enforceQuota((slidesByRoom.get(roomId) ?? 0) <= MAX_SLIDES_PER_ROOM, "Room slide limit exceeded");
    enforceQuota((exportsByRoom.get(roomId) ?? 0) <= MAX_EXPORT_RECORDS_PER_ROOM, "Export history limit exceeded");
    enforceQuota((bytesByRoom.get(roomId) ?? 0) <= MAX_ROOM_STORAGE_BYTES, "Room storage limit exceeded", 413);
  });
}

function indexById<T extends { id?: string }>(items: T[]) {
  return new Map(items.filter((item) => item.id).map((item) => [item.id!, item]));
}

function roomChanged(before: RoomLike, after: RoomLike) {
  return (
    before.title !== after.title ||
    before.className !== after.className ||
    before.teamName !== after.teamName ||
    before.description !== after.description ||
    before.status !== after.status ||
    before.accessMode !== after.accessMode ||
    before.presentationAt !== after.presentationAt ||
    before.deadlineAt !== after.deadlineAt ||
    before.archivedAt !== after.archivedAt
  );
}

function pushAuditEvent(events: AuditEventInput[], event: AuditEventInput) {
  if (events.length < MAX_AUDIT_EVENTS_PER_STATE_SAVE) {
    events.push(event);
    return false;
  }
  return true;
}

export async function recordSharedStateAuditEvents(
  request: IncomingMessage,
  actorUserId: string,
  before: SharedAppState,
  after: SharedAppState,
) {
  const events: AuditEventInput[] = [];
  let truncated = false;
  const beforeRooms = indexById(toArray(before.rooms));
  const afterRooms = indexById(toArray(after.rooms));
  const beforeMembers = indexById(toArray(before.members));
  const afterMembers = indexById(toArray(after.members));
  const beforeFiles = indexById(toArray(before.files));
  const afterFiles = indexById(toArray(after.files));
  const beforeExports = indexById(toArray(before.exportRecords));
  const afterExports = indexById(toArray(after.exportRecords));

  afterRooms.forEach((room, roomId) => {
    const previous = beforeRooms.get(roomId);
    if (!previous) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId,
        action: "room.created",
        targetType: "room",
        targetId: roomId,
        metadata: { title: room.title, accessMode: room.accessMode },
      }) || truncated;
    } else if (roomChanged(previous, room)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId,
        action: "room.updated",
        targetType: "room",
        targetId: roomId,
        metadata: { status: room.status, accessMode: room.accessMode },
      }) || truncated;
    }
  });

  beforeRooms.forEach((room, roomId) => {
    if (!afterRooms.has(roomId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId,
        action: "room.deleted",
        targetType: "room",
        targetId: roomId,
        metadata: { title: room.title },
      }) || truncated;
    }
  });

  afterMembers.forEach((member, memberId) => {
    if (!beforeMembers.has(memberId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId: member.roomId,
        action: "member.added",
        targetType: "member",
        targetId: memberId,
        metadata: { role: member.role },
      }) || truncated;
    }
  });

  beforeMembers.forEach((member, memberId) => {
    if (!afterMembers.has(memberId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId: member.roomId,
        action: "member.removed",
        targetType: "member",
        targetId: memberId,
        metadata: { role: member.role },
      }) || truncated;
    }
  });

  afterFiles.forEach((file, fileId) => {
    if (!beforeFiles.has(fileId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId: file.roomId,
        action: "file.added",
        targetType: "file",
        targetId: fileId,
        metadata: { name: file.name, size: cleanNonNegativeInteger(file.size) },
      }) || truncated;
    }
  });

  beforeFiles.forEach((file, fileId) => {
    if (!afterFiles.has(fileId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId: file.roomId,
        action: "file.removed",
        targetType: "file",
        targetId: fileId,
        metadata: { name: file.name, size: cleanNonNegativeInteger(file.size) },
      }) || truncated;
    }
  });

  afterExports.forEach((record, recordId) => {
    if (!beforeExports.has(recordId)) {
      truncated = pushAuditEvent(events, {
        actorUserId,
        roomId: record.roomId,
        action: "export.created",
        targetType: "export",
        targetId: recordId,
        metadata: { fileName: record.fileName, format: record.format, status: record.status },
      }) || truncated;
    }
  });

  if (truncated) {
    events.push({
      actorUserId,
      action: "audit.truncated",
      targetType: "state",
      metadata: { maxEvents: MAX_AUDIT_EVENTS_PER_STATE_SAVE },
    });
  }

  await Promise.all(events.map((event) => recordAuditEvent(request, event)));
}

export function canUserAccessRoom(state: SharedAppState, roomId: string, userId?: string) {
  return Boolean(userId && isRoomParticipant(state, roomId, userId));
}

export function canUserMutateRoom(state: SharedAppState, roomId: string, userId: string) {
  return isRoomParticipant(state, roomId, userId);
}

export function canUserAccessStorageKey(state: SharedAppState, storageKey: string, userId?: string) {
  if (!userId) return false;
  const file = toArray(state.files).find((candidate) => candidate.storageKey === storageKey);
  return Boolean(file?.roomId && isRoomParticipant(state, file.roomId, userId));
}

export function canUserWriteStorageKey(state: SharedAppState, storageKey: string, userId: string) {
  const file = toArray(state.files).find((candidate) => candidate.storageKey === storageKey);
  if (!file?.roomId) return false;
  return file.ownerUserId === userId || isRoomAdmin(state, file.roomId, userId);
}

export function canUserUploadToRoom(state: SharedAppState, roomId: string, userId: string) {
  return isRoomParticipant(state, roomId, userId);
}

export function getRoomIdFromRequestQuery(request: IncomingMessage) {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  const roomId = url.searchParams.get("roomId") || "";
  return isSafeId(roomId) ? roomId : null;
}

export function mergeAuthorizedSharedState(current: SharedAppState, incoming: SharedAppState, userId: string): SharedAppState {
  if (!isRecord(incoming)) throw new HttpError(400, "Invalid state payload");

  const currentRooms = toArray(current.rooms);
  const incomingRooms = toArray(incoming.rooms);
  const currentRoomById = new Map(currentRooms.filter((room) => room.id).map((room) => [room.id!, room]));
  const incomingRoomById = new Map(incomingRooms.filter((room) => room.id).map((room) => [room.id!, room]));
  const adminRoomIds = new Set(currentRooms.filter((room) => room.id && isRoomAdmin(current, room.id, userId)).map((room) => room.id!));
  const participantRoomIds = getRoomIdsForUser(current, userId);
  const joinableRoomIds = new Set(
    currentRooms
      .filter((room) => (
        room.id &&
        room.accessMode !== "authenticated" &&
        incoming.members?.some((member) => member.roomId === room.id && member.userId === userId)
      ))
      .map((room) => room.id!),
  );

  const newOwnedRooms = incomingRooms
    .filter((room) => room.id && !currentRoomById.has(room.id) && room.hostUserId === userId)
    .map((room) => sanitizeRoom(room, userId))
    .filter((room): room is RoomLike => Boolean(room));

  const newOwnedRoomIds = new Set(newOwnedRooms.map((room) => room.id));
  const writableRoomIds = new Set([...participantRoomIds, ...joinableRoomIds, ...newOwnedRoomIds].filter(Boolean) as string[]);
  const deletedRoomIds = new Set(
    [...adminRoomIds].filter((roomId) => !incomingRoomById.has(roomId)),
  );

  const nextRooms = currentRooms
    .filter((room) => room.id && !deletedRoomIds.has(room.id))
    .map((room) => {
      if (!room.id || !adminRoomIds.has(room.id)) return room;
      const incomingRoom = incomingRoomById.get(room.id);
      return incomingRoom ? sanitizeRoom(incomingRoom, userId, room) || room : room;
    })
    .concat(newOwnedRooms);

  const nextRoomIds = new Set(nextRooms.map((room) => room.id).filter((id): id is string => Boolean(id)));
  const adminOrNewRoomIds = new Set([...adminRoomIds, ...newOwnedRoomIds].filter((roomId) => !deletedRoomIds.has(roomId)));
  const memberWritableRoomIds = new Set([...writableRoomIds].filter((roomId) => !deletedRoomIds.has(roomId) && nextRoomIds.has(roomId)));

  const keepCollection = <T extends { roomId?: string }>(items: T[], roomIds: Set<string>) => (
    items.filter((item) => !item.roomId || !roomIds.has(item.roomId))
  );

  const incomingMembers = toArray(incoming.members)
    .filter((member) => member.roomId && memberWritableRoomIds.has(member.roomId))
    .filter((member) => adminOrNewRoomIds.has(member.roomId!) || member.userId === userId)
    .filter((member) => isSafeId(member.id))
    .map((member) => ({
      ...member,
      userId: adminOrNewRoomIds.has(member.roomId!) ? member.userId : userId,
      role: adminOrNewRoomIds.has(member.roomId!) && ["host", "admin", "member", "viewer"].includes(String(member.role)) ? member.role : "member",
      name: cleanText(member.name, "Member", 120),
      joinedAt: cleanIsoDate(member.joinedAt) || new Date().toISOString(),
    }));

  const existingFileById = new Map(toArray(current.files).filter((file) => file.id).map((file) => [file.id!, file]));
  const incomingFiles = toArray(incoming.files)
    .filter((file) => file.roomId && memberWritableRoomIds.has(file.roomId))
    .filter((file) => adminOrNewRoomIds.has(file.roomId!) || file.ownerUserId === userId)
    .map((file) => sanitizeFile(file, memberWritableRoomIds, userId, existingFileById.get(file.id || ""), adminOrNewRoomIds))
    .filter((file): file is FileLike => Boolean(file));
  const nextFiles = keepCollection(toArray(current.files), memberWritableRoomIds).concat(incomingFiles);
  const nextFileById = new Map(nextFiles.filter((file) => file.id).map((file) => [file.id!, file]));

  const incomingSlides = toArray(incoming.slides)
    .filter((slide) => slide.roomId && memberWritableRoomIds.has(slide.roomId))
    .filter((slide) => adminOrNewRoomIds.has(slide.roomId!) || slide.ownerUserId === userId)
    .filter((slide) => sanitizeItem(slide, memberWritableRoomIds))
    .filter((slide) => slide.fileId && nextFileById.get(slide.fileId)?.roomId === slide.roomId);

  const incomingExports = toArray(incoming.exportRecords)
    .filter((record) => record.roomId && adminOrNewRoomIds.has(record.roomId));

  const nextState = {
    ...createEmptySharedState(),
    rooms: nextRooms,
    members: keepCollection(toArray(current.members), memberWritableRoomIds).concat(incomingMembers),
    files: nextFiles,
    slides: keepCollection(toArray(current.slides), memberWritableRoomIds).concat(incomingSlides),
    exportRecords: keepCollection(toArray(current.exportRecords), adminOrNewRoomIds).concat(incomingExports),
    settings: current.settings && isRecord(current.settings) ? current.settings : {},
  };

  enforceSharedStateQuotas(nextState, userId, new Set([...memberWritableRoomIds, ...adminOrNewRoomIds]));
  return nextState;
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
