import type { UserProfile } from "../types";

const authRedirectNoticeKey = "slideroom-auth-redirect-notice";

export interface AuthRedirectNotice {
  kind: "email-change-pending" | "email-change-complete" | "error" | "info";
  message: string;
}

interface AuthResponse {
  ok: boolean;
  user?: UserProfile | null;
  error?: string;
}

function canUseAuthApi() {
  return typeof window !== "undefined" && window.location.protocol.startsWith("http");
}

function clearLegacySupabaseAuthStorage() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (key.includes("supabase.auth.token") || /^sb-.+-auth-token$/.test(key)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
}

async function authFetch<T extends AuthResponse>(path: string, init: RequestInit = {}) {
  if (!canUseAuthApi()) throw new Error("認証APIを利用できません。");
  const response = await fetch(`/api/auth/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json()) as T;
  if (!response.ok || !payload.ok) throw new Error(payload.error || `認証APIエラー: ${response.status}`);
  return payload;
}

export function isAuthConfigured() {
  return canUseAuthApi();
}

function storeAuthRedirectNotice(notice: AuthRedirectNotice) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(authRedirectNoticeKey, JSON.stringify(notice));
}

export function consumeAuthRedirectNotice(): AuthRedirectNotice | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(authRedirectNoticeKey);
  if (!raw) return null;
  window.sessionStorage.removeItem(authRedirectNoticeKey);

  try {
    return JSON.parse(raw) as AuthRedirectNotice;
  } catch {
    return null;
  }
}

function noticeFromRedirectParams(params: URLSearchParams): AuthRedirectNotice | null {
  const error = params.get("error_description") || params.get("error");
  if (error) {
    return {
      kind: "error",
      message: decodeURIComponent(error.replace(/\+/g, " ")),
    };
  }

  const message = params.get("message");
  if (!message) return null;

  const normalized = decodeURIComponent(message.replace(/\+/g, " "));
  if (normalized.toLowerCase().includes("other email")) {
    return {
      kind: "email-change-pending",
      message: "もう一方のメールアドレスは確認できました。メールアドレス変更を完了するには、もう一方のメールに届いた確認リンクも開いてください。",
    };
  }

  return {
    kind: normalized.toLowerCase().includes("email") ? "email-change-complete" : "info",
    message: normalized,
  };
}

function authRedirectTo(path: string) {
  return `${window.location.origin}/#/${path}`;
}

export async function recoverSessionFromRedirectHash() {
  if (!isAuthConfigured()) return;
  clearLegacySupabaseAuthStorage();
  const hash = window.location.hash;
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  const notice = noticeFromRedirectParams(hashParams);
  if (notice) {
    storeAuthRedirectNotice(notice);
  }

  const encodedFragment = hash.match(/%23(.+)$/)?.[1];
  const directFragment = hash.match(/#\/[^#]+#(.+)$/)?.[1];
  const authFragment = encodedFragment ? decodeURIComponent(encodedFragment) : directFragment;
  if (!authFragment || !authFragment.includes("access_token=")) {
    if (notice) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/account`);
    }
    return;
  }

  const params = new URLSearchParams(authFragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return;

  await authFetch("session", {
    method: "POST",
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in") || 3600),
    }),
  });

  const cleanHash = hash.replace(/%23.*$/i, "").replace(/#([^#]*)#.*$/, "#$1");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${cleanHash}`);
}

export async function getCurrentAuthUser() {
  if (!isAuthConfigured()) return null;
  const payload = await authFetch<AuthResponse>("user", { method: "GET" });
  return payload.user ?? null;
}

export async function signUpWithEmail(input: { name: string; email: string; password: string }) {
  const payload = await authFetch<AuthResponse>("signup", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      emailRedirectTo: authRedirectTo("login"),
    }),
  });
  return payload.user ?? null;
}

export async function verifyEmailOtp(input: { email: string; token: string }) {
  const payload = await authFetch<AuthResponse>("verify-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!payload.user) throw new Error("メール認証を完了できませんでした。");
  return payload.user;
}

export async function signInWithEmail(input: { email: string; password: string }) {
  const payload = await authFetch<AuthResponse>("login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!payload.user) throw new Error("ログインできませんでした。");
  return payload.user;
}

export async function signOut() {
  if (!isAuthConfigured()) return;
  await authFetch("logout", { method: "POST", body: "{}" });
}

export async function updateProfileName(name: string) {
  const payload = await authFetch<AuthResponse>("profile-name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!payload.user) throw new Error("ユーザー情報を更新できませんでした。");
  return payload.user;
}

export async function updateAuthPassword(password: string) {
  await authFetch("password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function requestEmailChange(newEmail: string) {
  await authFetch("email", {
    method: "POST",
    body: JSON.stringify({
      email: newEmail,
      emailRedirectTo: authRedirectTo("account"),
    }),
  });
}

export async function requestPasswordResetEmail(email: string) {
  await authFetch("password-reset", {
    method: "POST",
    body: JSON.stringify({
      email,
      redirectTo: authRedirectTo("reset-password"),
    }),
  });
}

export async function resendEmailVerification(email: string) {
  await authFetch("resend", {
    method: "POST",
    body: JSON.stringify({
      email,
      emailRedirectTo: authRedirectTo("account"),
    }),
  });
}

export function subscribeToAuthChanges(_callback: (user: UserProfile | null) => void) {
  return () => undefined;
}
