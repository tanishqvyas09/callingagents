/**
 * Server-side Supabase client
 *
 * Uses the SERVICE ROLE key — never exposed to the browser.
 * Only import this in Next.js API routes (app/api/**) or server components.
 *
 * The service role key bypasses Row Level Security, allowing the API routes
 * to INSERT call results into ngo_call_results without needing a user session.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[supabase-server] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set."
    );
  }
  if (!_client) {
    _client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}

// Lazy proxy so existing `supabaseServer.xxx` call sites keep working
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabaseServer()[prop as keyof SupabaseClient];
  },
});
