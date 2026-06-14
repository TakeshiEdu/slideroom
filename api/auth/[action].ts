import type { IncomingMessage, ServerResponse } from "node:http";
import {
  appendSetCookie,
  getRequestCookies,
  getSupabaseServerAnonKey,
  getSupabaseUrl,
  handleOptions,
  readRequestBody,
  sendJson,
} from "../_shared.js";

const ACCESS_COOKIE = "slideroom-access-token";
const REFRESH_COOKIE = "slideroom-refresh-token";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

interface SupabaseUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

interface SupabaseSessionResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: SupabaseUser;
}

function isSecureRequest(request: IncomingMessage) {
  return request.headers["x-forwarded-proto"] === "https" || request.headers.host?.includes("vercel.app");
}

function cookieOptions(request: IncomingMessage, maxAge: number) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    isSecureRequest(request) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function setAuthCookies(response: ServerResponse, request: IncomingMessage, session: SupabaseSessionResponse) {
  if (session.access_token) {
    appendSetCookie(response, `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; ${cookieOptions(request, session.expires_in || 3600)}`);
  }
  if (session.refresh_token) {
    appendSetCookie(response, `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; ${cookieOptions(request, REFRESH_MAX_AGE)}`);
  }
}

function clearAuthCookies(response: ServerResponse, request: IncomingMessage) {
  appendSetCookie(response, `${ACCESS_COOKIE}=; ${cookieOptions(request, 0)}`);
  appendSetCookie(response, `${REFRESH_COOKIE}=; ${cookieOptions(request, 0)}`);
}

function toUserProfile(user: SupabaseUser) {
  const metadataName = user.user_metadata?.display_name || user.user_metadata?.name;
  const name = typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split("@")[0] || "ユーザー";

  return {
    id: user.id,
    name,
    email: user.email,
    avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const body = await readRequestBody(request, 1024 * 1024);
  if (body.length === 0) return {} as T;
  return JSON.parse(body.toString("utf8")) as T;
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
    throw new Error(message);
  }
  return payload as T;
}

async function refreshSession(request: IncomingMessage, response: ServerResponse) {
  const refreshToken = getRequestCookies(request)[REFRESH_COOKIE];
  if (!refreshToken) return null;
  const session = await supabaseAuth<SupabaseSessionResponse>("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  setAuthCookies(response, request, session);
  return session.access_token || null;
}

async function getAccessToken(request: IncomingMessage, response: ServerResponse) {
  return getRequestCookies(request)[ACCESS_COOKIE] || await refreshSession(request, response);
}

async function getUserWithRefresh(request: IncomingMessage, response: ServerResponse) {
  let accessToken = getRequestCookies(request)[ACCESS_COOKIE];
  try {
    if (!accessToken) accessToken = await refreshSession(request, response) || undefined;
    if (!accessToken) return null;
    return await supabaseAuth<SupabaseUser>("/user", { method: "GET" }, accessToken);
  } catch {
    accessToken = await refreshSession(request, response) || undefined;
    if (!accessToken) return null;
    return supabaseAuth<SupabaseUser>("/user", { method: "GET" }, accessToken);
  }
}

function getAction(request: IncomingMessage) {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  return decodeURIComponent(url.pathname.slice("/api/auth/".length));
}

function withRedirect(path: string, redirectTo?: string) {
  if (!redirectTo) return path;
  return `${path}?redirect_to=${encodeURIComponent(redirectTo)}`;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (handleOptions(request, response)) return;

  try {
    const action = getAction(request);

    if (request.method === "GET" && action === "user") {
      const user = await getUserWithRefresh(request, response);
      sendJson(response, 200, { ok: true, user: user ? toUserProfile(user) : null });
      return;
    }

    if (request.method === "POST" && action === "login") {
      const input = await readJsonBody<{ email: string; password: string }>(request);
      const session = await supabaseAuth<SupabaseSessionResponse>("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({
          email: input.email?.trim().toLowerCase(),
          password: input.password,
        }),
      });
      setAuthCookies(response, request, session);
      sendJson(response, 200, { ok: true, user: session.user ? toUserProfile(session.user) : null });
      return;
    }

    if (request.method === "POST" && action === "signup") {
      const input = await readJsonBody<{ name: string; email: string; password: string; emailRedirectTo?: string }>(request);
      const session = await supabaseAuth<SupabaseSessionResponse>(withRedirect("/signup", input.emailRedirectTo), {
        method: "POST",
        body: JSON.stringify({
          email: input.email?.trim().toLowerCase(),
          password: input.password,
          data: { display_name: input.name?.trim() },
          gotrue_meta_security: {},
        }),
      });
      setAuthCookies(response, request, session);
      sendJson(response, 200, { ok: true, user: session.user ? toUserProfile(session.user) : null });
      return;
    }

    if (request.method === "POST" && action === "verify-otp") {
      const input = await readJsonBody<{ email: string; token: string }>(request);
      const session = await supabaseAuth<SupabaseSessionResponse>("/verify", {
        method: "POST",
        body: JSON.stringify({
          type: "signup",
          email: input.email?.trim().toLowerCase(),
          token: input.token?.trim(),
        }),
      });
      setAuthCookies(response, request, session);
      sendJson(response, 200, { ok: true, user: session.user ? toUserProfile(session.user) : null });
      return;
    }

    if (request.method === "POST" && action === "session") {
      const session = await readJsonBody<SupabaseSessionResponse>(request);
      setAuthCookies(response, request, session);
      const user = session.user || (session.access_token ? await supabaseAuth<SupabaseUser>("/user", { method: "GET" }, session.access_token) : null);
      sendJson(response, 200, { ok: true, user: user ? toUserProfile(user) : null });
      return;
    }

    if (request.method === "POST" && action === "logout") {
      const accessToken = getRequestCookies(request)[ACCESS_COOKIE];
      if (accessToken) {
        try {
          await supabaseAuth("/logout", { method: "POST", body: "{}" }, accessToken);
        } catch {
          // Clear local cookies even if the remote session was already invalid.
        }
      }
      clearAuthCookies(response, request);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && action === "profile-name") {
      const accessToken = await getAccessToken(request, response);
      if (!accessToken) {
        sendJson(response, 401, { ok: false, error: "Not authenticated" });
        return;
      }
      const input = await readJsonBody<{ name: string }>(request);
      const user = await supabaseAuth<SupabaseUser>("/user", {
        method: "PUT",
        body: JSON.stringify({ data: { display_name: input.name?.trim() } }),
      }, accessToken);
      sendJson(response, 200, { ok: true, user: toUserProfile(user) });
      return;
    }

    if (request.method === "POST" && action === "password") {
      const accessToken = await getAccessToken(request, response);
      if (!accessToken) {
        sendJson(response, 401, { ok: false, error: "Not authenticated" });
        return;
      }
      const input = await readJsonBody<{ password: string }>(request);
      await supabaseAuth<SupabaseUser>("/user", {
        method: "PUT",
        body: JSON.stringify({ password: input.password }),
      }, accessToken);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && action === "email") {
      const accessToken = await getAccessToken(request, response);
      if (!accessToken) {
        sendJson(response, 401, { ok: false, error: "Not authenticated" });
        return;
      }
      const input = await readJsonBody<{ email: string; emailRedirectTo?: string }>(request);
      await supabaseAuth<SupabaseUser>(withRedirect("/user", input.emailRedirectTo), {
        method: "PUT",
        body: JSON.stringify({
          email: input.email?.trim().toLowerCase(),
        }),
      }, accessToken);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && action === "password-reset") {
      const input = await readJsonBody<{ email: string; redirectTo?: string }>(request);
      await supabaseAuth(withRedirect("/recover", input.redirectTo), {
        method: "POST",
        body: JSON.stringify({
          email: input.email?.trim().toLowerCase(),
          gotrue_meta_security: {},
        }),
      });
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && action === "resend") {
      const input = await readJsonBody<{ email: string; emailRedirectTo?: string }>(request);
      await supabaseAuth(withRedirect("/resend", input.emailRedirectTo), {
        method: "POST",
        body: JSON.stringify({
          type: "signup",
          email: input.email?.trim().toLowerCase(),
        }),
      });
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Auth action not found" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
