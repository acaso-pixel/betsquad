import { createClient } from "@supabase/supabase-js";

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseUrl = rawUrl && rawUrl.startsWith("http") ? rawUrl : "https://placeholder-domain-betsquad.supabase.co";
const supabaseAnonKey = rawKey && rawKey.length > 10 ? rawKey : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummykeybetsquad";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);