export type AdminRole = "owner" | "admin" | "support";

export interface AdminSession {
  id: string;
  email?: string;
  role: AdminRole;
}

export interface AdminRoomSummary {
  id?: string;
  title?: string;
  status?: string;
  accessMode?: string;
  files: number;
  slides: number;
  members: number;
  updatedAt?: string;
}

export interface AdminOverviewResponse {
  ok: true;
  admin: AdminSession & {
    envBootstrapEnabled: boolean;
  };
  summary: {
    totals: {
      rooms: number;
      members: number;
      files: number;
      slides: number;
      exportRecords: number;
      storageBytes: number;
      expiredRoomCandidates: number;
    };
    roomsByStatus: Record<string, number>;
    roomsByAccessMode: Record<string, number>;
    largestRooms: AdminRoomSummary[];
  };
  limits: Record<string, number>;
  recentAuditLogs: Array<Record<string, unknown>>;
  recentUsageEvents: Array<Record<string, unknown>>;
}

interface AdminMeResponse {
  ok: true;
  admin: AdminSession;
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function adminFetch<T>(path: string) {
  const response = await fetch(`/api/admin/${path}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Admin API error: ${response.status}`;
    throw new AdminApiError(response.status, message);
  }
  return payload as T;
}

let sessionPromise: Promise<AdminSession | null> | undefined;

export function getAdminSession() {
  if (!sessionPromise) {
    sessionPromise = adminFetch<AdminMeResponse>("me")
      .then((payload) => payload.admin)
      .catch((error) => {
        if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      });
  }
  return sessionPromise;
}

export function loadAdminOverview() {
  return adminFetch<AdminOverviewResponse>("overview");
}

export function deleteAdminRoom(roomId: string, reason?: string) {
  return fetch(`/api/admin/rooms/${encodeURIComponent(roomId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  }).then(async (response) => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      throw new AdminApiError(response.status, payload?.error || `Admin API error: ${response.status}`);
    }
    return payload as { ok: true; room: { id: string; title?: string }; storage?: { attempted: number; removed: number } };
  });
}
