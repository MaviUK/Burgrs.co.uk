import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, 10) : null;
}
function normalizeNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
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
async function fetchAllEpisodes(seriesId: number, token: string) {
  const rows: any[] = [];
  for (let page = 0; page < 100; page += 1) {
    const payload = await tvdbJson(`/series/${seriesId}/episodes/default?page=${page}`, token);
    const eps = payload?.data?.episodes || [];
    rows.push(...eps);
    if (!payload?.links?.next || eps.length === 0) break;
  }
  return rows;
}
function pickArtwork(series: any, types: number[]) {
  for (const type of types) {
    const hit = Array.isArray(series?.artworks)
      ? series.artworks.find((a: any) => Number(a?.type) === type && a?.image)
      : null;
    if (hit?.image) return hit.image;
  }
  return null;
}
function remoteIds(series: any) {
  const result: Record<string, unknown> = {};
  for (const item of Array.isArray(series?.remoteIds) ? series.remoteIds : []) {
    const key = String(item?.sourceName || item?.type || item?.id || "remote").toLowerCase();
    result[key] = item?.id ?? item?.sourceId ?? item;
  }
  return result;
}
async function syncOne(job: any, token: string) {
  const now = new Date().toISOString();
  const seriesPayload = await tvdbJson(`/series/${job.tvdb_id}/extended`, token);
  const series = seriesPayload?.data;
  if (!series) throw new Error("TVDB returned no series data");
  const episodes = await fetchAllEpisodes(Number(job.tvdb_id), token);

  const showUpdate = {
    name: series?.name ?? job.show_name,
    slug: series?.slug ?? null,
    original_name: series?.originalName ?? null,
    overview: typeof series?.overview === "string" && series.overview.trim() ? series.overview.trim() : null,
    status: series?.status?.name ?? series?.status ?? null,
    original_country: series?.originalCountry ?? series?.country ?? null,
    original_language: series?.originalLanguage ?? null,
    first_aired: normalizeDate(series?.firstAired),
    last_aired: normalizeDate(series?.lastAired),
    next_aired: normalizeDate(series?.nextAired),
    runtime_minutes: normalizeNumber(series?.averageRuntime ?? series?.runtime),
    network: series?.latestNetwork?.name ?? series?.originalNetwork?.name ?? null,
    content_rating: Array.isArray(series?.contentRatings) && series.contentRatings.length
      ? (series.contentRatings[0]?.name ?? series.contentRatings[0]?.rating ?? null)
      : null,
    genres: Array.isArray(series?.genres) ? series.genres.map((g: any) => g?.name ?? g).filter(Boolean) : [],
    aliases: Array.isArray(series?.aliases) ? series.aliases.map((a: any) => a?.name ?? a).filter(Boolean) : [],
    poster_url: series?.image ?? pickArtwork(series, [2]) ?? null,
    backdrop_url: pickArtwork(series, [3, 8]) ?? null,
    banner_url: pickArtwork(series, [1]) ?? null,
    external_ids: remoteIds(series),
    rating_average: normalizeNumber(series?.score),
    last_synced_at: now,
    updated_at: now,
  };

  const { error: showError } = await supabase.from("shows").update(showUpdate).eq("id", job.show_id);
  if (showError) throw showError;

  const seasonByNumber = new Map<number, any>();
  for (const season of Array.isArray(series?.seasons) ? series.seasons : []) {
    const number = Number(season?.number);
    if (!Number.isFinite(number) || number < 0) continue;
    seasonByNumber.set(number, {
      show_id: job.show_id,
      tvdb_id: normalizeNumber(season?.id),
      season_type: "official",
      season_number: number,
      name: season?.name || (number === 0 ? "Specials" : `Season ${number}`),
      image_url: season?.image || null,
      episode_count: 0,
      aired_from: null,
      aired_to: null,
      last_synced_at: now,
      updated_at: now,
    });
  }

  const episodeRows = [];
  for (const ep of episodes) {
    const seasonNumber = Number(ep?.seasonNumber);
    const episodeNumber = Number(ep?.number);
    if (!Number.isFinite(seasonNumber) || seasonNumber < 0 || !Number.isFinite(episodeNumber) || episodeNumber <= 0) continue;

    const aired = normalizeDate(ep?.aired);
    const season = seasonByNumber.get(seasonNumber) || {
      show_id: job.show_id,
      tvdb_id: null,
      season_type: "official",
      season_number: seasonNumber,
      name: seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`,
      image_url: null,
      episode_count: 0,
      aired_from: null,
      aired_to: null,
      last_synced_at: now,
      updated_at: now,
    };
    season.episode_count += 1;
    if (aired && (!season.aired_from || aired < season.aired_from)) season.aired_from = aired;
    if (aired && (!season.aired_to || aired > season.aired_to)) season.aired_to = aired;
    seasonByNumber.set(seasonNumber, season);

    episodeRows.push({
      tvdb_id: normalizeNumber(ep?.id),
      show_id: job.show_id,
      season_type: "official",
      season_number: seasonNumber,
      episode_number: episodeNumber,
      absolute_number: normalizeNumber(ep?.absoluteNumber),
      name: ep?.name || `Episode ${episodeNumber}`,
      overview: typeof ep?.overview === "string" && ep.overview.trim() ? ep.overview.trim() : null,
      aired_date: aired,
      runtime_minutes: normalizeNumber(ep?.runtime),
      image_url: ep?.image || null,
      is_special: seasonNumber === 0,
      is_premiere: episodeNumber === 1,
      is_finale: String(ep?.finaleType || "").toLowerCase().includes("season") || String(ep?.finaleType || "").toLowerCase().includes("series"),
      last_synced_at: now,
      updated_at: now,
    });
  }

  const seasonRows = [...seasonByNumber.values()];
  if (seasonRows.length) {
    const { error } = await supabase.from("seasons").upsert(seasonRows, {
      onConflict: "show_id,season_type,season_number",
    });
    if (error) throw error;
  }

  const { data: savedSeasons, error: savedSeasonError } = await supabase
    .from("seasons")
    .select("id,season_number")
    .eq("show_id", job.show_id)
    .eq("season_type", "official");
  if (savedSeasonError) throw savedSeasonError;
  const seasonIds = new Map((savedSeasons || []).map((s: any) => [Number(s.season_number), s.id]));

  for (let i = 0; i < episodeRows.length; i += 250) {
    const batch = episodeRows.slice(i, i + 250).map((ep: any) => ({
      ...ep,
      season_id: seasonIds.get(Number(ep.season_number)) || null,
    }));
    const { error } = await supabase.from("episodes").upsert(batch, {
      onConflict: "show_id,season_type,season_number,episode_number",
    });
    if (error) throw error;
  }

  return { episodes: episodeRows.length, seasons: seasonRows.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST required" });
  try {
    if (!(await validateSecret(req))) return json(401, { error: "Unauthorized" });

    const { data: jobs, error: claimError } = await supabase.rpc("claim_show_sync_batch", { p_limit: 6 });
    if (claimError) throw claimError;
    if (!jobs?.length) return json(200, { ok: true, claimed: 0, synced: 0 });

    const token = await tvdbToken();
    const results = [];
    let synced = 0;

    for (const job of jobs) {
      try {
        const stats = await syncOne(job, token);
        await supabase.rpc("complete_show_sync", {
          p_show_id: job.show_id,
          p_generation: job.generation,
        });
        synced += 1;
        results.push({ show_id: job.show_id, tvdb_id: job.tvdb_id, ok: true, ...stats });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase.rpc("fail_show_sync", {
          p_show_id: job.show_id,
          p_generation: job.generation,
          p_error: message,
        });
        results.push({ show_id: job.show_id, tvdb_id: job.tvdb_id, ok: false, error: message });
      }
    }

    return json(200, { ok: true, claimed: jobs.length, synced, results });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
