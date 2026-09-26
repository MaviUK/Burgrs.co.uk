import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

function readSecretKey() {
  const direct =
    Netlify.env.get("SUPABASE_SECRET_KEY") ||
    Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (direct) return direct;

  const secretKeysJson = Netlify.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeysJson) return "";

  try {
    const secretKeys = JSON.parse(secretKeysJson);
    return secretKeys?.default || Object.values(secretKeys || {})[0] || "";
  } catch {
    return "";
  }
}

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const supabaseUrl =
    Netlify.env.get("SUPABASE_URL") || Netlify.env.get("VITE_SUPABASE_URL");
  const secretKey = readSecretKey();

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  if (!secretKey) {
    throw new Error("Missing Supabase server secret");
  }

  cachedClient = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}
