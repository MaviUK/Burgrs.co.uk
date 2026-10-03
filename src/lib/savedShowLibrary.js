import { supabase } from "./supabase";

const PAGE_SIZE = 1000;
const FILTER_BATCH_SIZE = 100;

function uniqueValues(values) {
  return Array.from(
    new Set(
      (values || [])
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => String(value))
    )
  );
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchFilteredRows(userId, column, values) {
  const rows = [];

  for (const batch of chunkArray(values, FILTER_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("my_show_library_flat")
      .select("show_id, tvdb_id, tmdb_id, watch_status")
      .eq("user_id", userId)
      .in(column, batch);

    if (error) throw error;
    rows.push(...(data || []));
  }

  return rows;
}

export async function fetchSavedShowRows(
  userId,
  { showIds = [], tvdbIds = [], tmdbIds = [], watchStatus = null } = {}
) {
  if (!userId) return [];

  const normalizedShowIds = uniqueValues(showIds);
  const normalizedTvdbIds = uniqueValues(tvdbIds);
  const normalizedTmdbIds = uniqueValues(tmdbIds);
  const hasFilters =
    normalizedShowIds.length ||
    normalizedTvdbIds.length ||
    normalizedTmdbIds.length;

  let rows = [];

  if (hasFilters) {
    const groups = await Promise.all([
      normalizedShowIds.length
        ? fetchFilteredRows(userId, "show_id", normalizedShowIds)
        : Promise.resolve([]),
      normalizedTvdbIds.length
        ? fetchFilteredRows(userId, "tvdb_id", normalizedTvdbIds)
        : Promise.resolve([]),
      normalizedTmdbIds.length
        ? fetchFilteredRows(userId, "tmdb_id", normalizedTmdbIds)
        : Promise.resolve([]),
    ]);

    rows = groups.flat();
  } else {
    let from = 0;

    while (true) {
      let query = supabase
        .from("my_show_library_flat")
        .select("show_id, tvdb_id, tmdb_id, watch_status")
        .eq("user_id", userId)
        .range(from, from + PAGE_SIZE - 1);

      if (watchStatus) {
        query = query.eq("watch_status", watchStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      const page = data || [];
      rows.push(...page);

      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  const deduped = new Map();

  for (const row of rows) {
    if (watchStatus && row.watch_status !== watchStatus) continue;
    const key = row.show_id
      ? `show:${row.show_id}`
      : row.tvdb_id
        ? `tvdb:${row.tvdb_id}`
        : row.tmdb_id
          ? `tmdb:${row.tmdb_id}`
          : null;

    if (key) deduped.set(key, row);
  }

  return Array.from(deduped.values());
}

export function getSavedExternalIdSets(rows) {
  return {
    show: new Set(
      (rows || [])
        .map((row) => row?.show_id)
        .filter(Boolean)
        .map(String)
    ),
    tvdb: new Set(
      (rows || [])
        .map((row) => row?.tvdb_id)
        .filter(Boolean)
        .map(String)
    ),
    tmdb: new Set(
      (rows || [])
        .map((row) => row?.tmdb_id)
        .filter(Boolean)
        .map(String)
    ),
  };
}
