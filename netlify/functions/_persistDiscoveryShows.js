import { getSupabaseAdmin } from "./_supabaseAdmin.js";

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function sameValue(a, b) {
  if (a == null && b == null) return true;
  return String(a ?? "") === String(b ?? "");
}

function buildMergedRow(show, existing) {
  const tvdbId = normalizePositiveNumber(
    show?.tvdb_id ?? show?.tvdbId ?? null
  );
  const tmdbId = normalizePositiveNumber(
    show?.tmdb_id ?? show?.tmdbId ?? show?.id ?? null
  );

  if (!tvdbId) return null;

  const name =
    normalizeText(existing?.name) ||
    normalizeText(show?.name) ||
    normalizeText(show?.title) ||
    "Unknown title";
  const overview =
    normalizeText(show?.overview) ?? normalizeText(existing?.overview);
  const posterUrl =
    normalizeText(show?.poster_url) ||
    normalizeText(show?.image) ||
    normalizeText(show?.image_url) ||
    normalizeText(existing?.poster_url);
  const firstAired =
    normalizeDate(
      show?.first_aired ??
        show?.first_air_date ??
        show?.premiere_date ??
        show?.aired_date
    ) ?? normalizeDate(existing?.first_aired);

  const tmdbVoteAverage =
    Number.isFinite(Number(show?.tmdb_vote_average ?? show?.vote_average))
      ? Number(show?.tmdb_vote_average ?? show?.vote_average)
      : existing?.tmdb_vote_average ?? null;
  const tmdbVoteCount =
    Number.isFinite(Number(show?.tmdb_vote_count ?? show?.vote_count))
      ? Number(show?.tmdb_vote_count ?? show?.vote_count)
      : existing?.tmdb_vote_count ?? null;

  const externalIds =
    existing?.external_ids && typeof existing.external_ids === "object"
      ? existing.external_ids
      : {
          tvdb_id: tvdbId,
          ...(tmdbId ? { tmdb_id: tmdbId } : {}),
        };

  return {
    tvdb_id: tvdbId,
    tmdb_id: existing?.tmdb_id ?? tmdbId,
    name,
    overview,
    poster_url: posterUrl,
    first_aired: firstAired,
    tmdb_vote_average: tmdbVoteAverage,
    tmdb_vote_count: tmdbVoteCount,
    tmdb_rating_synced_at:
      tmdbVoteAverage != null || tmdbVoteCount != null
        ? new Date().toISOString()
        : existing?.tmdb_rating_synced_at ?? null,
    external_ids: externalIds,
    updated_at: new Date().toISOString(),
  };
}

function rowNeedsWrite(existing, next) {
  if (!existing) return true;

  return (
    !sameValue(existing.tmdb_id, next.tmdb_id) ||
    !sameValue(existing.name, next.name) ||
    !sameValue(existing.overview, next.overview) ||
    !sameValue(existing.poster_url, next.poster_url) ||
    !sameValue(existing.first_aired, next.first_aired) ||
    !sameValue(existing.tmdb_vote_average, next.tmdb_vote_average) ||
    !sameValue(existing.tmdb_vote_count, next.tmdb_vote_count)
  );
}

export async function persistDiscoveryShows(shows = []) {
  const supabase = getSupabaseAdmin();
  const unique = new Map();

  for (const show of Array.isArray(shows) ? shows : []) {
    const tvdbId = normalizePositiveNumber(
      show?.tvdb_id ?? show?.tvdbId ?? null
    );
    if (!tvdbId) continue;
    unique.set(String(tvdbId), show);
  }

  if (!unique.size) {
    return { persisted: 0, insertedOrUpdated: 0, skippedWithoutTvdb: shows.length };
  }

  const tvdbIds = [...unique.keys()].map(Number);
  const { data: existingRows, error: existingError } = await supabase
    .from("shows")
    .select(
      "id, tvdb_id, tmdb_id, name, overview, poster_url, first_aired, tmdb_vote_average, tmdb_vote_count, tmdb_rating_synced_at, external_ids"
    )
    .in("tvdb_id", tvdbIds);

  if (existingError) throw existingError;

  const existingByTvdb = new Map(
    (existingRows || []).map((row) => [String(row.tvdb_id), row])
  );

  const rowsToWrite = [];
  for (const [tvdbId, show] of unique.entries()) {
    const existing = existingByTvdb.get(tvdbId) || null;
    const next = buildMergedRow(show, existing);
    if (next && rowNeedsWrite(existing, next)) rowsToWrite.push(next);
  }

  if (rowsToWrite.length) {
    const { error: upsertError } = await supabase
      .from("shows")
      .upsert(rowsToWrite, { onConflict: "tvdb_id" });

    if (upsertError) throw upsertError;
  }

  return {
    persisted: unique.size,
    insertedOrUpdated: rowsToWrite.length,
    skippedWithoutTvdb: Math.max(0, (shows?.length || 0) - unique.size),
  };
}
