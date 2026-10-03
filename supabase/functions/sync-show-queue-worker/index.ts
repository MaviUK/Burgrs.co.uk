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
function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

function dedupeEpisodeRows(rows: any[]) {
  const byComposite = new Map<string, any>();
  const byTvdb = new Map<string, any>();

  for (const row of rows) {
    const compositeKey = [
      row.show_id,
      row.season_type,
      row.season_number,
      row.episode_number,
    ].join(":");
    const tvdbKey = row.tvdb_id == null ? "" : String(row.tvdb_id);

    if (tvdbKey && byTvdb.has(tvdbKey)) {
      const existing = byTvdb.get(tvdbKey);
      for (const [key, value] of Object.entries(row)) {
        if (existing[key] == null && value != null) existing[key] = value;
      }
      continue;
    }

    if (byComposite.has(compositeKey)) {
      const existing = byComposite.get(compositeKey);
      for (const [key, value] of Object.entries(row)) {
        if (existing[key] == null && value != null) existing[key] = value;
      }
      if (existing.tvdb_id != null) {
        byTvdb.set(String(existing.tvdb_id), existing);
      }
      continue;
    }

    byComposite.set(compositeKey, row);
    if (tvdbKey) byTvdb.set(tvdbKey, row);
  }

  return [...byComposite.values()];
}

function episodeMetadataPatch(row: any) {
  return {
    absolute_number: row.absolute_number,
    name: row.name,
    overview: row.overview,
    aired_date: row.aired_date,
    runtime_minutes: row.runtime_minutes,
    image_url: row.image_url,
    is_special: row.is_special,
    is_premiere: row.is_premiere,
    is_finale: row.is_finale,
    last_synced_at: row.last_synced_at,
    updated_at: row.updated_at,
    season_id: row.season_id,
  };
}

async function upsertEpisodeBatch(batch: any[]) {
  const tvdbIds = batch
    .map((row) => row.tvdb_id)
    .filter((value) => value != null);

  const existingByTvdb = new Map<string, any>();

  if (tvdbIds.length) {
    const { data: existingRows, error: existingError } = await supabase
      .from("episodes")
      .select("tvdb_id,show_id,season_type,season_number,episode_number")
      .in("tvdb_id", tvdbIds);

    if (existingError) throw existingError;

    for (const row of existingRows || []) {
      if (row.tvdb_id != null) existingByTvdb.set(String(row.tvdb_id), row);
    }
  }

  const safeRows: any[] = [];
  const legacyRows: any[] = [];

  for (const row of batch) {
    const existing =
      row.tvdb_id == null ? null : existingByTvdb.get(String(row.tvdb_id));

    if (!existing) {
      safeRows.push(row);
      continue;
    }

    if (String(existing.show_id) !== String(row.show_id)) {
      throw new Error(
        `TVDB episode ${row.tvdb_id} is already linked to another show`
      );
    }

    const sameSlot =
      String(existing.season_type || "") === String(row.season_type || "") &&
      Number(existing.season_number) === Number(row.season_number) &&
      Number(existing.episode_number) === Number(row.episode_number);

    if (sameSlot) safeRows.push(row);
    else legacyRows.push(row);
  }

  if (safeRows.length) {
    const { error } = await supabase.from("episodes").upsert(safeRows, {
      onConflict: "show_id,season_type,season_number,episode_number",
    });

    if (error) throw error;
  }

  for (const row of legacyRows) {
    const { error } = await supabase
      .from("episodes")
      .update(episodeMetadataPatch(row))
      .eq("tvdb_id", row.tvdb_id);

    if (error) throw error;
  }
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

  const rawEpisodeRows = [];
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
    seasonByNumber.set(seasonNumber, season);

    rawEpisodeRows.push({
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

  const episodeRows = dedupeEpisodeRows(rawEpisodeRows);

  for (const season of seasonByNumber.values()) {
    season.episode_count = 0;
    season.aired_from = null;
    season.aired_to = null;
  }

  for (const ep of episodeRows) {
    const season = seasonByNumber.get(Number(ep.season_number));
    if (!season) continue;
    season.episode_count += 1;
    if (ep.aired_date && (!season.aired_from || ep.aired_date < season.aired_from)) {
      season.aired_from = ep.aired_date;
    }
    if (ep.aired_date && (!season.aired_to || ep.aired_date > season.aired_to)) {
      season.aired_to = ep.aired_date;
    }
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
    await upsertEpisodeBatch(batch);
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
        const message = errorMessage(error);
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
