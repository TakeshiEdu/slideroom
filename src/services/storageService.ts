import { openDB, type DBSchema } from "idb";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface SlideRoomDB extends DBSchema {
  blobs: {
    key: string;
    value: Blob;
  };
}

const DB_NAME = "slideroom-storage";
const DB_VERSION = 1;
const SUPABASE_STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "slideroom-uploads";
let browserSupabase: SupabaseClient | undefined;

function canUseServerStorage() {
  return typeof window !== "undefined" && window.location.protocol.startsWith("http");
}

function getBrowserSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  if (!browserSupabase) {
    browserSupabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return browserSupabase;
}

async function requestSignedUpload(storageKey: string, roomId: string) {
  if (!canUseServerStorage()) return undefined;
  const params = new URLSearchParams({ roomId });
  const response = await fetch(`/api/blob/${encodeURIComponent(storageKey)}/upload-url?${params.toString()}`, { method: "POST" });
  if (!response.ok) return undefined;
  return (await response.json()) as { ok: boolean; bucket?: string; path: string; token: string };
}

async function requestSignedDownload(storageKey: string) {
  if (!canUseServerStorage()) return undefined;
  const response = await fetch(`/api/blob/${encodeURIComponent(storageKey)}/download-url`, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) return undefined;
  return (await response.json()) as { ok: boolean; signedUrl: string };
}

async function saveServerBlob(storageKey: string, blob: Blob, roomId: string) {
  if (!canUseServerStorage()) return;

  const supabase = getBrowserSupabase();
  const signedUpload = await requestSignedUpload(storageKey, roomId);
  if (supabase && signedUpload?.token) {
    const { error } = await supabase.storage
      .from(signedUpload.bucket || SUPABASE_STORAGE_BUCKET)
      .uploadToSignedUrl(signedUpload.path, signedUpload.token, blob);
    if (error) throw error;
    return;
  }

  const params = new URLSearchParams({ roomId });
  const response = await fetch(`/api/blob/${encodeURIComponent(storageKey)}?${params.toString()}`, {
    method: "POST",
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Server blob save failed: ${response.status}`);
  }
}

async function getServerBlob(storageKey: string) {
  if (!canUseServerStorage()) return undefined;

  const signedDownload = await requestSignedDownload(storageKey);
  if (signedDownload?.signedUrl) {
    const response = await fetch(signedDownload.signedUrl, { cache: "no-store" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Supabase signed blob load failed: ${response.status}`);
    return response.blob();
  }

  const response = await fetch(`/api/blob/${encodeURIComponent(storageKey)}`, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Server blob load failed: ${response.status}`);
  }
  return response.blob();
}

async function deleteServerBlob(storageKey: string) {
  if (!canUseServerStorage()) return;
  const response = await fetch(`/api/blob/${encodeURIComponent(storageKey)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Server blob delete failed: ${response.status}`);
  }
}

async function getDb() {
  return openDB<SlideRoomDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs");
      }
    },
  });
}

export async function saveBlob(storageKey: string, blob: Blob, roomId: string) {
  if (canUseServerStorage()) {
    await saveServerBlob(storageKey, blob, roomId);
  }

  const db = await getDb();
  await db.put("blobs", blob, storageKey);
}

export async function getBlob(storageKey: string) {
  const db = await getDb();
  const localBlob = await db.get("blobs", storageKey);
  if (localBlob) return localBlob;

  try {
    const serverBlob = await getServerBlob(storageKey);
    if (serverBlob) {
      await db.put("blobs", serverBlob, storageKey);
      return serverBlob;
    }
  } catch (error) {
    console.warn("Server blob load skipped", error);
  }

  return undefined;
}

export async function deleteBlob(storageKey: string) {
  try {
    await deleteServerBlob(storageKey);
  } catch (error) {
    console.warn("Server blob delete skipped", error);
  }

  const db = await getDb();
  await db.delete("blobs", storageKey);
}

export interface SharedStateResponse<T> {
  initialized: boolean;
  updatedAt?: string;
  state: T | null;
}

export async function loadSharedState<T>(options?: { inviteCode?: string }) {
  if (!canUseServerStorage()) return null;
  try {
    const params = new URLSearchParams();
    if (options?.inviteCode) params.set("inviteCode", options.inviteCode);
    const url = params.size > 0 ? `/api/state?${params.toString()}` : "/api/state";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as SharedStateResponse<T>;
    return payload.initialized ? payload.state : null;
  } catch (error) {
    console.warn("Shared state load skipped", error);
    return null;
  }
}

export async function saveSharedState<T>(state: T) {
  if (!canUseServerStorage()) return;
  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error(`Shared state save failed: ${response.status}`);
  } catch (error) {
    console.warn("Shared state save skipped", error);
  }
}

export function saveState<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadState<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function clearState(key: string) {
  localStorage.removeItem(key);
}
