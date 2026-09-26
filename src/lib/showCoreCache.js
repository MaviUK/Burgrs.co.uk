import { supabase } from "./supabase";

const CORE_TTL_MS = 10 * 60 * 1000;
const coreCache = new Map();
const seasonDetailsCache = new Map();
const STORAGE_PREFIX = "burgrs:show-core:v1:";

function normalizeSource(source) {
  return source === "tmdb" ? "tmdb" : "tvdb";
}

function normalizeNumericId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function coreKey(source, id) {
  return `${normalizeSource(source)}:${id}`;
}

function storageKey(source, id) {
  return `${STORAGE_PREFIX}${coreKey(source, id)}`;
}

function readStoredCore(source, id) {
  if (typeof window === "undefined" || !window.sessionStorage) return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey(source, id));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CORE_TTL_MS) {
      window.sessionStorage.removeItem(storageKey(source, id));
      return null;
    }

    // Older builds could persist a negative lookup. Treat any cached value
    // without a real show row as invalid so stale "Show not found" results
    // cannot survive a deployment or a later database insert.
    if (!parsed?.value?.show?.id) {
      window.sessionStorage.removeItem(storageKey(source, id));
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

function writeStoredCore(source, id, value) {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    window.sessionStorage.setItem(
      storageKey(source, id),
      JSON.stringify({ savedAt: Date.now(), value })
    );
  } catch {
    // Session storage is only an acceleration layer. Ignore quota/privacy failures.
  }
}

export function getShowRouteDescriptorFromHref(href) {
  if (!href || typeof window === "undefined") return null;

  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;

    let match = url.pathname.match(/^\/(?:show|my-shows)\/tmdb\/(\d+)\/?$/);
    if (match) {
      return { source: "tmdb", id: Number(match[1]) };
    }

    match = url.pathname.match(/^\/(?:show|my-shows)\/(\d+)\/?$/);
    if (match) {
      return { source: "tvdb", id: Number(match[1]) };
    }
  } catch {
    return null;
  }

  return null;
}

export async function fetchShowCoreCached({ source, id, force = false }) {
  const normalizedSource = normalizeSource(source);
  const numericId = normalizeNumericId(id);

  if (!numericId) {
    return { show: null, episodes: [] };
  }

  const key = coreKey(normalizedSource, numericId);

  if (!force && coreCache.has(key)) {
    return coreCache.get(key);
  }

  if (!force) {
    const stored = readStoredCore(normalizedSource, numericId);
    if (stored) {
      coreCache.set(key, Promise.resolve(stored));
      return stored;
    }
  }

  const request = (async () => {
    let showQuery = supabase
      .from("shows")
      .select("*")
      .limit(1);

    showQuery =
      normalizedSource === "tmdb"
        ? showQuery.eq("tmdb_id", numericId)
        : showQuery.eq("tvdb_id", numericId);

    const { data: show, error: showError } = await showQuery.maybeSingle();
    if (showError) throw showError;

    if (!show?.id) {
      return { show: null, episodes: [] };
    }

    // Keep the first payload deliberately small. Heavy episode artwork,
    // overviews and TMDB ratings are fetched only when a season is opened.
    const { data: episodes, error: episodeError } = await supabase
      .from("episodes")
      .select(`
        id,
        tvdb_id,
        show_id,
        season_number,
        episode_number,
        episode_code,
        name,
        aired_date
      `)
      .eq("show_id", show.id)
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true });

    if (episodeError) throw episodeError;

    const value = {
      show,
      episodes: episodes || [],
    };

    writeStoredCore(normalizedSource, numericId, value);
    return value;
  })();

  coreCache.set(key, request);

  try {
    const value = await request;

    // A show can be missing on the first lookup and then be inserted moments
    // later when the user adds it. Never retain that negative lookup in the
    // in-memory/session cache or the new show will incorrectly stay "not found".
    if (!value?.show?.id) {
      coreCache.delete(key);

      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          window.sessionStorage.removeItem(
            storageKey(normalizedSource, numericId)
          );
        } catch {
          // Best effort only.
        }
      }
    }

    return value;
  } catch (error) {
    coreCache.delete(key);
    throw error;
  }
}

export async function fetchSeasonEpisodeDetailsCached(showId, seasonNumber) {
  if (!showId) return [];

  const numericSeason = Number(seasonNumber);
  if (!Number.isFinite(numericSeason)) return [];

  const key = `${showId}:season:${numericSeason}`;
  if (seasonDetailsCache.has(key)) {
    return seasonDetailsCache.get(key);
  }

  const request = (async () => {
    const { data, error } = await supabase
      .from("episodes")
      .select(`
        id,
        tvdb_id,
        show_id,
        season_number,
        episode_number,
        episode_code,
        name,
        overview,
        aired_date,
        image_url,
        tmdb_vote_average,
        tmdb_vote_count,
        tmdb_still_path
      `)
      .eq("show_id", showId)
      .eq("season_number", numericSeason)
      .order("episode_number", { ascending: true });

    if (error) throw error;
    return data || [];
  })();

  seasonDetailsCache.set(key, request);

  try {
    return await request;
  } catch (error) {
    seasonDetailsCache.delete(key);
    throw error;
  }
}

export function prefetchShowCoreFromHref(href) {
  const route = getShowRouteDescriptorFromHref(href);
  if (!route) return Promise.resolve(null);

  return fetchShowCoreCached(route).catch((error) => {
    console.warn("Show prefetch failed", error);
    return null;
  });
}

export function clearShowCoreCache({ source, id } = {}) {
  if (!source || !id) {
    coreCache.clear();
    seasonDetailsCache.clear();
    return;
  }

  const normalizedSource = normalizeSource(source);
  const numericId = normalizeNumericId(id);
  if (!numericId) return;

  coreCache.delete(coreKey(normalizedSource, numericId));

  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(storageKey(normalizedSource, numericId));
    } catch {
      // Best effort only.
    }
  }
}
