/**
 * Paginated fetch utility for Supabase
 *
 * Supabase caps `.select()` results at 1000 rows by default.
 * This helper fetches ALL matching rows by paginating in chunks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

/**
 * Fetch every row that matches a query by iterating in PAGE_SIZE chunks.
 *
 * You pass a callback that receives (from, to) range indices and must
 * return the Supabase query with `.range(from, to)` applied.
 *
 * Usage:
 * ```ts
 * const rows = await fetchAll((from, to) =>
 *   supabaseServer
 *     .from("student_answer_sheets")
 *     .select("id, contact_number")
 *     .eq("is_deleted", false)
 *     .eq("campaign_type", "post")
 *     .range(from, to)
 * );
 * ```
 */
export async function fetchAll<T = Record<string, unknown>>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryFn(from, to);

    if (error) {
      console.error("[fetchAll] Supabase error at offset", from, error);
      throw error;
    }

    if (!data || data.length === 0) break;

    all.push(...data);

    // If we got fewer than PAGE_SIZE rows, we've reached the end
    if (data.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return all;
}

/**
 * Convenience: fetch count only (faster than fetching all rows).
 */
export async function fetchCount(
  client: SupabaseClient,
  table: string,
  filters?: Record<string, unknown>
): Promise<number> {
  let query = client.from(table).select("id", { count: "exact", head: true });

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value as string);
    }
  }

  const { count, error } = await query;
  if (error) {
    console.error("[fetchCount] error:", error);
    return 0;
  }
  return count ?? 0;
}
