/**
 * Server-side Supabase client
 *
 * Uses the SERVICE ROLE key — never exposed to the browser.
 * Only import this in Next.js API routes (app/api/**) or server components.
 *
 * The service role key bypasses Row Level Security, allowing the API routes
 * to INSERT call results into ngo_call_results without needing a user session.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL          = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn(
    "[supabase-server] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
    "Supabase write operations will fail. Set SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    // Disable automatic token refresh — not needed for service role
    autoRefreshToken: false,
    persistSession:   false,
  },
});
