import { createClient } from "@supabase/supabase-js";

// Lu avant createClient : supabase-js vide le fragment de l'URL après avoir ouvert la session.
export const AUTH_HASH = window.location.hash;

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const TRACKFIT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trackfit`;
