import { createClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";
import type { UserProfile } from "../types";

let browserSupabase: SupabaseClient | undefined;
const authRedirectNoticeKey = "slideroom-auth-redirect-notice";

export interface AuthRedirectNotice {
  kind: "email-change-pending" | "email-change-complete" | "error" | "info";
  message: string;
}

export function isAuthConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabaseBrowserClient() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("認証設定が完了していません。管理者にお問い合わせください。");
  }

  if (!browserSupabase) {
    browserSupabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }

  return browserSupabase;
}

function displayNameFromUser(user: SupabaseUser) {
  const metadataName = user.user_metadata?.display_name || user.user_metadata?.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] || "ユーザー";
}

export function toUserProfile(user: SupabaseUser): UserProfile {
  return {
    id: user.id,
    name: displayNameFromUser(user),
    email: user.email,
    avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}

export async function getCurrentAuthUser() {
  if (!isAuthConfigured()) return null;
  const { data, error } = await getSupabaseBrowserClient().auth.getUser();
  if (error || !data.user) return null;
  return toUserProfile(data.user);
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
      message: "片方のメールアドレスは確認できました。メールアドレス変更を完了するには、もう一方のメールに届いた確認リンクも開いてください。",
    };
  }

  return {
    kind: normalized.toLowerCase().includes("email") ? "email-change-complete" : "info",
    message: normalized,
  };
}

export async function recoverSessionFromRedirectHash() {
  if (!isAuthConfigured()) return;
  const hash = window.location.hash;
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  const notice = noticeFromRedirectParams(hashParams);
  if (notice) {
    storeAuthRedirectNotice(notice);
  }

  const encodedFragment = hash.match(/%23(.+)$/)?.[1];
  const directFragment = hash.match(/#\/[^#]+#(.+)$/)?.[1];
  const authFragment = encodedFragment ? decodeURIComponent(encodedFragment) : directFragment;
  const shouldRefreshSession = Boolean(notice);
  if (!authFragment || !authFragment.includes("access_token=")) {
    if (shouldRefreshSession) {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (data.session) await getSupabaseBrowserClient().auth.refreshSession();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/account`);
    }
    return;
  }

  const params = new URLSearchParams(authFragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return;

  const { error } = await getSupabaseBrowserClient().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;

  const cleanHash = hash.replace(/%23.*$/i, "").replace(/#([^#]*)#.*$/, "#$1");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${cleanHash}`);
}

export async function signUpWithEmail(input: { name: string; email: string; password: string }) {
  const { data, error } = await getSupabaseBrowserClient().auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        display_name: input.name.trim(),
      },
      emailRedirectTo: `${window.location.origin}/#/login`,
    },
  });
  if (error) throw error;
  return data.user ? toUserProfile(data.user) : null;
}

export async function verifyEmailOtp(input: { email: string; token: string }) {
  const { data, error } = await getSupabaseBrowserClient().auth.verifyOtp({
    type: "signup",
    email: input.email.trim().toLowerCase(),
    token: input.token.trim(),
  });
  if (error) throw error;
  if (!data.user) throw new Error("メール認証を完了できませんでした。");
  return toUserProfile(data.user);
}

export async function signInWithEmail(input: { email: string; password: string }) {
  const { data, error } = await getSupabaseBrowserClient().auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });
  if (error) throw error;
  if (!data.user) throw new Error("ログインできませんでした。");
  return toUserProfile(data.user);
}

export async function signOut() {
  if (!isAuthConfigured()) return;
  const { error } = await getSupabaseBrowserClient().auth.signOut();
  if (error) throw error;
}

export async function updateProfileName(name: string) {
  const { data, error } = await getSupabaseBrowserClient().auth.updateUser({
    data: { display_name: name.trim() },
  });
  if (error) throw error;
  if (!data.user) throw new Error("ユーザー情報を更新できませんでした。");
  return toUserProfile(data.user);
}

export async function updateAuthPassword(password: string) {
  const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
  if (error) throw error;
}

export async function requestEmailChange(newEmail: string) {
  const { error } = await getSupabaseBrowserClient().auth.updateUser(
    { email: newEmail.trim().toLowerCase() },
    { emailRedirectTo: `${window.location.origin}/#/account` },
  );
  if (error) throw error;
}

export async function requestPasswordResetEmail(email: string) {
  const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/#/reset-password`,
  });
  if (error) throw error;
}

export async function resendEmailVerification(email: string) {
  const { error } = await getSupabaseBrowserClient().auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: `${window.location.origin}/#/account`,
    },
  });
  if (error) throw error;
}

export function subscribeToAuthChanges(callback: (user: UserProfile | null) => void) {
  if (!isAuthConfigured()) return () => undefined;

  const {
    data: { subscription },
  } = getSupabaseBrowserClient().auth.onAuthStateChange((_event, session) => {
    callback(session?.user ? toUserProfile(session.user) : null);
  });

  return () => subscription.unsubscribe();
}
