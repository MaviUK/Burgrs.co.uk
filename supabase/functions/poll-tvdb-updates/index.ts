import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
async function validateSecret(req: Request) {
  const secret = req.headers.get("x-burgrs-show-sync-secret") || "";
  const { data, error } = await supabase.rpc("validate_show_sync_secret", { p_secret: secret });
  if (error) throw error;
  return data === true;
}
async function tvdbToken() {
  const key = Deno.env.get("TVDB_API_KEY");
  if (!key) throw new Error("Missing TVDB_API_KEY");
  const r = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ apikey: key }),
  });
  const body = await r.json();
  if (!r.ok || !body?.data?.token) throw new Error(`TVDB login failed: ${r.status}`);
  return body.data.token;
}
async function tvdbJson(path: string, token: string) {
  const r = await fetch(`https://api4.thetvdb.com/v4${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TVDB ${path} failed: ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function resolveSeriesTvdbId(update: any, token: string) {
  const type = String(update?.entityType || update?.recordType || "").toLowerCase();
  if (type === "series") return Number(update?.recordId) || null;
  if (type === "episodes" || type === "episode") {
    return Number(update?.seriesId) || null;
  }
  if (type === "seasons" || type === "season") {
    const seasonId = Number(update?.recordId);
    if (!seasonId) return null;
    try {
      const payload = await tvdbJson(`/seasons/${seasonId}/extended`, token);
      return Number(payload?.data?.seriesId) || null;
    } catch {
      return null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST required" });

  try {
    if (!(await validateSecret(req))) return json(401, { error: "Unauthorized" });
    const token = await tvdbToken();

    const { data: state, error: stateError } = await supabase
      .from("tvdb_update_state")
      .select("since_epoch,page")
      .eq("singleton", true)
      .single();
    if (stateError) throw stateError;

    let since = Number(state?.since_epoch || Math.floor(Date.now() / 1000) - 3600);
    let page = Number(state?.page || 0);
    let pagesProcessed = 0;
    let totalUpdates = 0;
    let maxTimestamp = since;
    const tvdbSeriesIds = new Set<number>();
    const seenSeasonIds = new Set<number>();
    let hasNext = false;

    while (pagesProcessed < 5) {
      const payload = await tvdbJson(
        `/updates?since=${encodeURIComponent(String(since))}&page=${page}`,
        token,
      );
      const updates = Array.isArray(payload?.data) ? payload.data : [];
      totalUpdates += updates.length;

      for (const update of updates) {
        const stamp = Number(update?.timeStamp || 0);
        if (stamp > maxTimestamp) maxTimestamp = stamp;

        const type = String(update?.entityType || update?.recordType || "").toLowerCase();
        if (!["series","episodes","episode","seasons","season"].includes(type)) continue;

        if ((type === "seasons" || type === "season")) {
          const seasonId = Number(update?.recordId);
          if (seasonId && seenSeasonIds.has(seasonId)) continue;
          if (seasonId) seenSeasonIds.add(seasonId);
        }

        const seriesTvdbId = await resolveSeriesTvdbId(update, token);
        if (seriesTvdbId) tvdbSeriesIds.add(seriesTvdbId);
      }

      hasNext = Boolean(payload?.links?.next);
      pagesProcessed += 1;
      if (!hasNext) break;
      page += 1;
    }

    let queued = 0;
    if (tvdbSeriesIds.size) {
      const { data: shows, error: showError } = await supabase
        .from("shows")
        .select("id,tvdb_id")
        .in("tvdb_id", [...tvdbSeriesIds]);
      if (showError) throw showError;

      const ids = (shows || []).map((s: any) => s.id);
      if (ids.length) {
        const { data: count, error: queueError } = await supabase.rpc("enqueue_show_syncs", {
          p_show_ids: ids,
          p_priority: 95,
          p_reason: "tvdb_update_feed",
        });
        if (queueError) throw queueError;
        queued = Number(count || 0);
      }
    }

    if (hasNext) {
      const { error } = await supabase
        .from("tvdb_update_state")
        .update({
          page,
          last_success_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("singleton", true);
      if (error) throw error;
    } else {
      const nextSince = Math.max(since, maxTimestamp - 2);
      const { error } = await supabase
        .from("tvdb_update_state")
        .update({
          since_epoch: nextSince,
          page: 0,
          last_success_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("singleton", true);
      if (error) throw error;
    }

    return json(200, {
      ok: true,
      since,
      pages_processed: pagesProcessed,
      updates_seen: totalUpdates,
      matched_series: tvdbSeriesIds.size,
      queue_rows_touched: queued,
      more_pages: hasNext,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("tvdb_update_state").update({
      last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    }).eq("singleton", true);
    return json(500, { error: message });
  }
});
