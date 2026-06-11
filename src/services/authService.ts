import { createClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";
import type { UserProfile } from "../types";

let browserSupabase: SupabaseClient | undefined;

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

export async function requestPasswordResetEmail(email: string) {
  const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/#/account`,
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
