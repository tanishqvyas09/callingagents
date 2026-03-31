/**
 * Central config for which student table to query.
 *
 * Set USE_TEST_TABLE = true  → reads from "test_student_sheets" (5 test records)
 * Set USE_TEST_TABLE = false → reads from "student_answer_sheets" (production)
 *
 * Toggle this single flag to switch between test and production data.
 */

export const USE_TEST_TABLE = true;

export const STUDENT_TABLE = USE_TEST_TABLE
  ? "test_student_sheets"
  : "student_answer_sheets";

/**
 * The test table has no FK to campaign_schools, so we skip that join.
 * Production table has campaign_schools!school_id ( name, city, state ).
 */
export const SCHOOL_JOIN = USE_TEST_TABLE
  ? ""
  : ",\n          campaign_schools!school_id ( name, city, state )";
