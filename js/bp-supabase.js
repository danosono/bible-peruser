// Supabase client + auth/session helpers for the reader-suggestion feature
// (js/bp-suggest.js, js/bp-admin.js). Talks to the SAME shared Supabase
// project used by the other Gospel Go games (single auth.users, single
// sign-on) — only the bp_-prefixed tables/functions below belong to this app.
//
// No build step in this repo, so the Supabase client is imported at runtime
// from a version-pinned CDN URL rather than vendored as a committed file
// (vendoring a large minified bundle by hand risks silent truncation/corruption;
// a pinned CDN import is still fully lazy — nothing loads until a suggestion
// UI element is actually used — and is trivial to bump deliberately later).
const SUPABASE_JS_CDN_URL = "https://esm.sh/@supabase/supabase-js@2.45.4";

// Fill these in from your Supabase project (Project Settings -> API).
// The anon/publishable key is safe to expose client-side by design — all
// real access control is enforced server-side via Row Level Security.
export const BP_SUPABASE_URL = "https://akajfgobhzkadiigydkh.supabase.co";
export const BP_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYWpmZ29iaHprYWRpaWd5ZGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5NzA1NjEsImV4cCI6MjA3NDU0NjU2MX0.Rz3duZlc1i_u2_wfJurbP9FNWz6BhfqshOS3pHySp_A";

let clientPromise = null;
function getClient() {
  if (!BP_SUPABASE_URL || !BP_SUPABASE_ANON_KEY) {
    return Promise.reject(
      new Error(
        "Bible Peruser suggestions are not configured yet (missing Supabase URL/anon key in js/bp-supabase.js).",
      ),
    );
  }
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS_CDN_URL).then(({ createClient }) =>
      createClient(BP_SUPABASE_URL, BP_SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    );
  }
  return clientPromise;
}

// Cached per session so repeated icon renders don't each round-trip to the
// server; cleared on any auth state change (sign in/out/token refresh).
let flagCache = null; // { userId, isAdmin, isBanned }
let enabledCache = null; // suggestionsEnabled is meaningful for anon too

async function ensureAuthListener() {
  const client = await getClient();
  if (ensureAuthListener._wired) return client;
  ensureAuthListener._wired = true;
  client.auth.onAuthStateChange(() => {
    flagCache = null;
  });
  return client;
}

export async function getSession() {
  const client = await ensureAuthListener();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function signInWithEmail(email) {
  const client = await getClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function verifyOtp(email, token) {
  const client = await getClient();
  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
  return data.session || null;
}

export async function signOut() {
  const client = await getClient();
  // scope: "local" clears this browser's session without a network round
  // trip to revoke it server-side. Using the default "global" scope here
  // POSTs to /auth/v1/logout, which 403s (and leaves the local session
  // intact, so the UI silently stays "signed in") whenever the stored
  // session is already stale — e.g. an expired/rotated refresh token.
  await client.auth.signOut({ scope: "local" });
  flagCache = null;
}

async function loadFlags() {
  const client = await ensureAuthListener();
  const session = await getSession();
  const userId = session?.user?.id || null;
  if (flagCache && flagCache.userId === userId) return flagCache;

  if (!userId) {
    flagCache = { userId: null, isAdmin: false, isBanned: false };
    return flagCache;
  }

  const [adminRes, bannedRes] = await Promise.all([
    client.rpc("bp_is_admin"),
    client.rpc("bp_is_banned"),
  ]);
  flagCache = {
    userId,
    isAdmin: adminRes.error ? false : !!adminRes.data,
    isBanned: bannedRes.error ? false : !!bannedRes.data,
  };
  return flagCache;
}

export async function isAdmin() {
  return (await loadFlags()).isAdmin;
}

export async function isBanned() {
  return (await loadFlags()).isBanned;
}

export async function suggestionsEnabled() {
  if (enabledCache !== null) return enabledCache;
  try {
    const client = await getClient();
    const { data, error } = await client.rpc("bp_suggestions_enabled");
    enabledCache = error ? true : data !== false;
  } catch {
    // Config missing / offline: fail open on visibility (the icons just
    // won't do anything useful), the DB trigger is the real enforcement.
    enabledCache = true;
  }
  return enabledCache;
}

// Postgres/PostgREST error -> friendly, never-raw-DB-text user message.
export function mapSupabaseError(err) {
  const code = err?.code || "";
  const message = String(err?.message || "");
  if (code === "23505") {
    return "Thanks — someone has already suggested this exact change and it's waiting for review.";
  }
  if (message.includes("BP_RATE_PENDING")) {
    return "You have 5 suggestions awaiting review. Please wait for those before sending more.";
  }
  if (message.includes("BP_RATE_DAILY")) {
    return "You've reached today's limit of 10 suggestions. Please try again tomorrow.";
  }
  if (message.includes("BP_NO_LINKS")) {
    return "Links and web addresses aren't accepted — please describe the source in words instead.";
  }
  if (message.includes("BP_BANNED")) {
    return "Your account is no longer able to submit suggestions.";
  }
  if (message.includes("BP_SUGGESTIONS_DISABLED")) {
    return "Suggestions are temporarily turned off. Please check back later.";
  }
  if (message.includes("Token has expired or is invalid")) {
    return "That code is incorrect or has expired. Double-check the 6 digits from the email, or send a new one.";
  }
  if (message.includes("For security purposes") || message.includes("rate limit")) {
    return "Please wait a moment before requesting another code.";
  }
  if (
    message.includes("BP_AUTH_REQUIRED") ||
    code === "42501" ||
    code === "PGRST301"
  ) {
    return "Your sign-in expired. Please sign in again.";
  }
  return "Something went wrong sending your suggestion. Please try again later.";
}

export { getClient };
