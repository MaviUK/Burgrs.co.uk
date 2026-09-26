import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clientIp(req: Request) {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "";

  return req.headers.get("x-real-ip")?.trim() || "";
}

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const shareSlug = String(body?.share_slug || "").trim().toLowerCase();
    const guestToken = String(body?.guest_token || "").trim();
    const winnerShowId = String(body?.winner_show_id || "").trim();
    const loserShowId = String(body?.loser_show_id || "").trim();

    if (!shareSlug || !guestToken || !winnerShowId || !loserShowId) {
      return json({ error: "Missing vote data" }, 400);
    }

    const ip = clientIp(req);
    if (!ip) {
      return json({ error: "Could not determine client network" }, 400);
    }

    const bucket = new Date().toISOString().slice(0, 10);
    const networkHash = await sha256(`${bucket}|${ip}|burgrs-rankd-guest-v1`);

    const { data, error } = await supabase.rpc(
      "rankd_record_guest_matchup_vote_server",
      {
        p_share_slug: shareSlug,
        p_guest_token: guestToken,
        p_winner_show_id: winnerShowId,
        p_loser_show_id: loserShowId,
        p_network_hash: networkHash,
      },
    );

    if (error) {
      console.error("guest vote rpc failed", error);
      return json({ error: "Could not record vote" }, 500);
    }

    if (data?.rate_limited) {
      return json(data, 429);
    }

    return json(data, 200);
  } catch (error) {
    console.error("rankd guest vote failed", error);
    return json({ error: "Invalid request" }, 400);
  }
});