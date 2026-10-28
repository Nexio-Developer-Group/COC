import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/**
 * Server-only client. We don't have a service-role key in this environment,
 * so RLS is disabled on all app tables (demo scope, single tenant) and every
 * DB/storage call is made from route handlers only — the browser never
 * imports this module.
 */
export const db = createClient(url, anonKey);
