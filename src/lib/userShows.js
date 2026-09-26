import { supabase } from "./supabase";
import { saveShowToDatabaseComplete } from "./saveShowToDatabaseComplete";
import { clearShowCoreCache } from "./showCoreCache";

const MY_SHOWS_CACHE_PREFIX = "trackt_my_shows_cache_v1";
const MY_SHOWS_LAST_CACHE_KEY = `${MY_SHOWS_CACHE_PREFIX}:last`;
const DASHBOARD_CACHE_PREFIX = "trackt_dashboard_cache_v6_SAVED_SHOW_ID_LINKS";
const DASHBOARD_PUBLIC_CACHE_KEY = `${DASHBOARD_CACHE_PREFIX}:public`;

function normalizePositiveNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getResolvedTvdbId(show) {
  return normalizePositiveNumber(
    show?.tvdb_id ??
      show?.resolved_tvdb_id ??
      show?.mapped_tvdb_id ??
      show?.show_tvdb_id ??
      show?.tvdb ??
      null
  );
}

function getResolvedTmdbId(show) {
  return normalizePositiveNumber(
    show?.tmdb_id ??
      show?.resolved_tmdb_id ??
      show?.mapped_tmdb_id ??
      show?.series_tmdb_id ??
      show?.show_tmdb_id ??
      show?.tmdb ??
      (show?.source === "tmdb" ? show?.id : null)
  );
}

export function clearUserShowCaches(userId) {
  if (typeof window === "undefined") return;

  try {
    if (userId) {
      window.localStorage.removeItem(`${MY_SHOWS_CACHE_PREFIX}:${userId}`);
      window.localStorage.removeItem(`${DASHBOARD_CACHE_PREFIX}:${userId}`);
    }

    window.localStorage.removeItem(MY_SHOWS_LAST_CACHE_KEY);
    window.localStorage.removeItem(DASHBOARD_PUBLIC_CACHE_KEY);
  } catch (error) {
    console.warn("Failed clearing user show caches:", error);
  }
}

export async function addShowToUserList(show) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;

  if (!user) {
    throw new Error("You must be logged in to add a show.");
  }

  if (!show || typeof show !== "object") {
    throw new Error("Missing show details.");
  }

  const tvdbId = getResolvedTvdbId(show);
  const tmdbId = getResolvedTmdbId(show);

  const normalizedShow = {
    ...show,
    tvdb_id: tvdbId,
    tmdb_id: tmdbId,
    first_air_date: show?.first_air_date || show?.first_aired || null,
    first_aired: show?.first_air_date || show?.first_aired || null,
    poster_url:
      show?.poster_url ||
      show?.posterUrl ||
      show?.image_url ||
      show?.image ||
      null,
    backdrop_url:
      show?.backdrop_url ||
      show?.backdropUrl ||
      show?.background_url ||
      show?.backgroundUrl ||
      show?.banner_url ||
      show?.bannerUrl ||
      show?.fanart_url ||
      null,
    name: show?.name || show?.title || show?.show_name || "Unknown show",
    overview: show?.overview || null,
    status: show?.status || null,
  };

  if (!normalizedShow.tvdb_id && !normalizedShow.tmdb_id) {
    throw new Error("This show is missing both TVDB and TMDB IDs.");
  }

  const savedShow = await saveShowToDatabaseComplete(normalizedShow);

  if (!savedShow?.id) {
    throw new Error("Failed to save show to database.");
  }

  const savedTvdbId = getResolvedTvdbId(savedShow) || tvdbId;
  const savedTmdbId = getResolvedTmdbId(savedShow) || tmdbId;

  // The details page may have cached a negative lookup before this show existed
  // locally. Clear both possible route keys immediately after the save.
  if (savedTvdbId) {
    clearShowCoreCache({ source: "tvdb", id: savedTvdbId });
  }
  if (savedTmdbId) {
    clearShowCoreCache({ source: "tmdb", id: savedTmdbId });
  }

  const upsertPayload = {
    user_id: user.id,
    show_id: savedShow.id,
    watch_status: "watchlist",
    tmdb_id: savedTmdbId,
  };

  const { error } = await supabase.from("user_shows_new").upsert(upsertPayload, {
    onConflict: "user_id,show_id",
  });

  if (error) throw error;

  clearUserShowCaches(user.id);

  return savedShow;
}
