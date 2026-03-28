/**
 * Supabase client + NGO student data helpers
 *
 * Reads from:
 *   public.campaign_results  — student_name, contact_number, age, school_id
 *   public.campaign_schools  — name (school name), address, city, state
 *
 * Phone validation:
 *   - Strip all non-digit/separator characters
 *   - Students enter only 10-digit numbers — accept exactly 10 digits
 *   - First digit must be 6–9 (valid Indian mobile prefix)
 *   - Normalise to E.164 format: +91XXXXXXXXXX
 *   - Numbers stored with a +91 prefix (13 chars like +919179487733) are also accepted
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NgoStudent {
  id: string;
  student_name: string;
  contact_number: string;        // raw from DB
  contact_e164: string;          // normalised: +91XXXXXXXXXX
  age: number | null;
  school_id: string | null;
  school_name: string | null;
  school_address: string | null;
  school_city: string | null;
  school_state: string | null;
}

// ─── Phone Validation ─────────────────────────────────────────────────────────

/**
 * Fuzzy 10-digit Indian mobile number validator.
 *
 * Students enter numbers as plain 10-digit strings (e.g. "9876543210").
 * Some records may be stored with a +91 prefix ("9179487733" is 10 digits
 * and must NOT be treated as a country-code + 8-digit number).
 *
 * Rules:
 *  1. Strip whitespace, dashes, dots, parentheses, leading +
 *  2. Remove any remaining non-digit characters
 *  3. If exactly 13 digits and starts with "91" → strip the leading "91"
 *     (handles +91XXXXXXXXXX stored without the + but as 12 raw digits,
 *      only when the remaining 10 digits start with 6–9)
 *  4. Must be exactly 10 digits
 *  5. First digit must be 6–9 (valid Indian mobile prefix)
 *
 * Returns the E.164 form "+91XXXXXXXXXX" on success, null on failure.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Step 1: remove separators and leading +
  let cleaned = raw.replace(/[\s\-.()+]/g, "");

  // Step 2: remove any remaining non-digit characters
  cleaned = cleaned.replace(/\D/g, "");

  // Step 3: handle +91XXXXXXXXXX stored as 12 digits "91XXXXXXXXXX"
  // ONLY strip the "91" prefix when:
  //   - total length is exactly 12
  //   - starts with "91"
  //   - the remaining 10 digits start with 6–9 (i.e. it really is a CC+number)
  // This deliberately does NOT affect 10-digit numbers like "9179487733" (length 10).
  if (cleaned.length === 12 && cleaned.startsWith("91") && /^91[6-9]/.test(cleaned)) {
    cleaned = cleaned.slice(2);
  }

  // Step 4: must be exactly 10 digits
  if (cleaned.length !== 10) return null;

  // Step 5: Indian mobile numbers start with 6, 7, 8, or 9
  if (!/^[6-9]/.test(cleaned)) return null;

  return `+91${cleaned}`;
}

/**
 * Returns true if the raw phone string can be normalised to a valid
 * 10-digit Indian mobile number.
 */
export function isValidIndianPhone(raw: string | null | undefined): boolean {
  return normalisePhone(raw) !== null;
}

// ─── Supabase Queries ─────────────────────────────────────────────────────────

/**
 * Fetch all students from campaign_results that have a valid 10-digit
 * Indian contact number, joined with their school info from campaign_schools.
 *
 * Filters applied server-side:
 *   - is_deleted = false
 *   - contact_number is not null
 *
 * Phone validation (10-digit fuzzy) is applied in JS after fetch because
 * Supabase/Postgres regex would be complex and we want the normalised E.164 form.
 *
 * @param search - optional name or school search string
 * @param limit  - max rows to return (default 200)
 */
export async function fetchNgoStudents(
  search?: string,
  limit = 200
): Promise<{ data: NgoStudent[]; error: string | null }> {
  try {
    let query = supabase
      .from("campaign_results")
      .select(`
        id,
        student_name,
        contact_number,
        age,
        school_id,
        campaign_schools!school_id (
          name,
          address,
          city,
          state
        )
      `)
      .eq("is_deleted", false)
      .not("contact_number", "is", null)
      .order("student_name", { ascending: true })
      .limit(limit * 3); // fetch extra — many will be filtered out by phone validation

    // Apply name / school search filter if provided
    if (search && search.trim().length > 0) {
      const term = search.trim();
      // ilike for case-insensitive partial match on student name
      query = query.ilike("student_name", `%${term}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[supabase] fetchNgoStudents error:", error);
      return { data: [], error: error.message };
    }

    // Post-process: validate phone + shape the response
    const students: NgoStudent[] = [];

    for (const row of data ?? []) {
      const e164 = normalisePhone(row.contact_number);
      if (!e164) continue; // skip invalid numbers

      // campaign_schools is a joined object (single row since school_id is FK)
      const school = Array.isArray(row.campaign_schools)
        ? row.campaign_schools[0]
        : row.campaign_schools;

      students.push({
        id:             row.id,
        student_name:   row.student_name,
        contact_number: row.contact_number,
        contact_e164:   e164,
        age:            row.age ?? null,
        school_id:      row.school_id ?? null,
        school_name:    school?.name ?? null,
        school_address: school?.address ?? null,
        school_city:    school?.city ?? null,
        school_state:   school?.state ?? null,
      });

      if (students.length >= limit) break;
    }

    return { data: students, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: [], error: msg };
  }
}
